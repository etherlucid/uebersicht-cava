// Shared Desktop Windowing, Multi-Monitor Topology, Snapping & Z-Order Engine
// Used across uebersicht-now-playing, uebersicht-cava, uebersicht-shell, and uebersicht-sticker.

export const SNAP_THRESHOLD = 6;
export const SNAP_EDGE_TOLERANCE = 3;
export const SNAP_MARGIN_X = 15;
export const SNAP_MARGIN_TOP = 14;
export const SNAP_MARGIN_BOTTOM = 14;

export const WIDGET_ORDER_KEY = 'uebersicht_widget_order';
export const DEFAULT_WIDGET_ORDER = ['sticker', 'cava', 'shell', 'nowplaying'];
export const TOPOLOGY_STORAGE_KEY = 'uebersicht_screens_topology_v2';

export const WIDGET_MENU_PORTS = {
  nowplaying: 41421,
  cava: 41422,
  shell: 41423,
  sticker: 41424,
};

export const openWidgetContextMenu = (widgetName, payloadObj, fallbackCmd, runFn, onAction) => {
  const port = WIDGET_MENU_PORTS[widgetName];
  const body = typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj);

  const handleOutput = (rawOut) => {
    if (!rawOut || !onAction) return;
    const trimmed = String(rawOut).trim();
    if (!trimmed) return;
    try {
      const res = JSON.parse(trimmed);
      if (res && res.action) {
        onAction(res);
      }
    } catch (e) {}
  };

  if (port && typeof fetch !== 'undefined') {
    fetch(`http://127.0.0.1:${port}/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
      .then((resp) => {
        if (!resp.ok) throw new Error('Menu daemon HTTP error');
        return resp.text();
      })
      .then((text) => {
        handleOutput(text);
      })
      .catch(() => {
        if (runFn && fallbackCmd) {
          runFn(fallbackCmd, (err, out) => {
            if (!err && out) handleOutput(out);
          });
        }
      });
    return;
  }

  if (runFn && fallbackCmd) {
    runFn(fallbackCmd, (err, out) => {
      if (!err && out) handleOutput(out);
    });
  }
};

// ---------------------------------------------------------------------------
// 1. Z-Index / Layer Ordering
// ---------------------------------------------------------------------------

export const getWidgetZIndex = (widgetId) => {
  try {
    const raw = localStorage.getItem(WIDGET_ORDER_KEY);
    let order = raw ? JSON.parse(raw) : [...DEFAULT_WIDGET_ORDER];
    if (!Array.isArray(order)) order = [...DEFAULT_WIDGET_ORDER];
    let idx = order.indexOf(widgetId);
    if (idx === -1) {
      order.push(widgetId);
      localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(order));
      idx = order.length - 1;
    }
    return 100 + idx * 50;
  } catch (e) {
    return 100;
  }
};

export const reorderWidget = (widgetId, action) => {
  try {
    const raw = localStorage.getItem(WIDGET_ORDER_KEY);
    let order = raw ? JSON.parse(raw) : [...DEFAULT_WIDGET_ORDER];
    if (!Array.isArray(order)) order = [...DEFAULT_WIDGET_ORDER];
    if (!order.includes(widgetId)) {
      order.push(widgetId);
    }
    const idx = order.indexOf(widgetId);
    if (action === 'ORDER_FRONT' || action === 'BRING_TO_FRONT') {
      order.splice(idx, 1);
      order.push(widgetId);
    } else if (action === 'ORDER_BACK' || action === 'SEND_TO_BACK') {
      order.splice(idx, 1);
      order.unshift(widgetId);
    } else if (action === 'ORDER_FORWARD' || action === 'BRING_FORWARD') {
      if (idx < order.length - 1) {
        const temp = order[idx];
        order[idx] = order[idx + 1];
        order[idx + 1] = temp;
      }
    } else if (action === 'ORDER_BACKWARD' || action === 'SEND_BACKWARD') {
      if (idx > 0) {
        const temp = order[idx];
        order[idx] = order[idx - 1];
        order[idx - 1] = temp;
      }
    }
    localStorage.setItem(WIDGET_ORDER_KEY, JSON.stringify(order));
    broadcastGlobalEvent({ type: 'ORDER_CHANGED', order });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('uebersicht:order-changed', { detail: { order } }));
    }
  } catch (e) {}
};

// ---------------------------------------------------------------------------
// 2. Cross-WebView BroadcastChannel + localStorage Sync Bus
// ---------------------------------------------------------------------------

let syncChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    syncChannel = new BroadcastChannel('uebersicht_multi_screen_sync');
  }
} catch (e) {}

export const broadcastWidgetMessage = (widgetName, payload) => {
  const packet = {
    ...payload,
    widget: widgetName,
    _ts: Date.now() + Math.random(),
  };
  try {
    if (syncChannel) {
      syncChannel.postMessage(packet);
    }
  } catch (e) {}
  try {
    if (typeof localStorage !== 'undefined' && payload.type !== 'CROSS_SCREEN_DRAG_PREVIEW') {
      localStorage.setItem(`uebersicht_sync_packet_${widgetName}`, JSON.stringify(packet));
    } else if (typeof localStorage !== 'undefined' && payload.type === 'CROSS_SCREEN_DRAG_PREVIEW') {
      localStorage.setItem(`uebersicht_drag_preview_${widgetName}`, JSON.stringify(packet));
    }
  } catch (e) {}
};

const broadcastGlobalEvent = (payload) => {
  const packet = {
    ...payload,
    widget: '*',
    _ts: Date.now() + Math.random(),
  };
  try {
    if (syncChannel) {
      syncChannel.postMessage(packet);
    }
  } catch (e) {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('uebersicht_sync_packet_global', JSON.stringify(packet));
    }
  } catch (e) {}
};

// ---------------------------------------------------------------------------
// 3. Display Topology & Screen Identification
// ---------------------------------------------------------------------------

let cachedTopology = null;

export const normalizeTopology = (rawScreens) => {
  if (!Array.isArray(rawScreens) || rawScreens.length === 0) return [];
  const mainScreen = rawScreens.find((s) => s.isMain) || rawScreens[0];
  const mainH = Number(mainScreen?.h) || 1080;

  return rawScreens.map((s, idx) => {
    const id = Number(s.id ?? idx);
    const x = Number(s.x) || 0;
    const y = Number(s.y) || 0;
    const w = Number(s.w) || 1920;
    const h = Number(s.h) || 1080;
    // Convert macOS AppKit bottom-left origin to Quartz top-left desktop coordinates
    const topLeftX = x;
    const topLeftY = mainH - (y + h);
    return {
      index: idx,
      id,
      screenId: `screen_${id}`,
      name: s.name || `Display ${idx + 1}`,
      isMain: Boolean(s.isMain),
      x,
      y,
      w,
      h,
      topLeftX,
      topLeftY,
    };
  });
};

export const getScreensTopology = () => {
  if (cachedTopology && cachedTopology.length > 0) {
    return cachedTopology;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(TOPOLOGY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedTopology = parsed;
          return parsed;
        }
      }
    }
  } catch (e) {}
  return [];
};

export const updateScreensTopology = (rawScreens) => {
  const normalized = normalizeTopology(rawScreens);
  if (normalized.length === 0) return [];
  cachedTopology = normalized;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOPOLOGY_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (e) {}
  return normalized;
};

export const getMainScreenId = (topology = getScreensTopology()) => {
  if (topology && topology.length > 0) {
    const main = topology.find((s) => s.isMain) || topology[0];
    return main.screenId;
  }
  return 'screen_2';
};

/**
 * Normalizes any screen identifier (screen_2, screen_0, screen_2560x1080, 0, 1, 'main', etc.)
 * against topology to its canonical `screen_<id>` string.
 */
export const normalizeScreenId = (identifier, topology = getScreensTopology()) => {
  if (!identifier) return null;
  if (identifier === 'all') return 'all';

  const str = String(identifier).trim();

  if (topology && topology.length > 0) {
    // 1. Exact match on screenId (e.g. "screen_2", "screen_3")
    const exact = topology.find((s) => s.screenId === str);
    if (exact) return exact.screenId;

    // 2. Match on numeric CGDirectDisplayID (e.g. 2 or 3 or "screen_2") or index (0, 1)
    const numMatch = str.match(/^screen_(\d+)$/) || str.match(/^(\d+)$/);
    if (numMatch) {
      const val = Number(numMatch[1]);
      // First check if it matches an id (CGDirectDisplayID)
      const byId = topology.find((s) => s.id === val);
      if (byId) return byId.screenId;
      // Second check if it matches an index (0, 1)
      const byIndex = topology.find((s) => s.index === val);
      if (byIndex) return byIndex.screenId;
    }

    // 3. Match on resolution (e.g. "screen_2560x1080" or "screen_1080x1920")
    const resMatch = str.match(/(\d+)x(\d+)/);
    if (resMatch) {
      const rw = Number(resMatch[1]);
      const rh = Number(resMatch[2]);
      const byRes = topology.find((s) => (s.w === rw && s.h === rh) || (s.w === rh && s.h === rw));
      if (byRes) return byRes.screenId;
    }

    // 4. Match on keywords
    if (str === 'main' || str === 'screen_main' || str.toLowerCase().includes('main')) {
      const main = topology.find((s) => s.isMain) || topology[0];
      return main.screenId;
    }
    if (str === 'secondary' || str === 'screen_secondary' || str.toLowerCase().includes('second')) {
      const sec = topology.find((s) => !s.isMain) || topology[1] || topology[0];
      return sec.screenId;
    }

    // 5. Match by display name (e.g. "LG", "ASUS")
    const byName = topology.find((s) => s.name && s.name.toLowerCase().includes(str.toLowerCase()));
    if (byName) return byName.screenId;

    // Fallback: main screen
    const main = topology.find((s) => s.isMain) || topology[0];
    return main.screenId;
  }

  // Pre-topology hardcoded heuristics matching user's LG (2560x1080) and ASUS (1080x1920)
  if (str === 'screen_2' || str === 'screen_0' || str === 'main' || str.includes('2560') || str.toLowerCase().includes('lg')) {
    return 'screen_2';
  }
  if (str === 'screen_3' || str === 'screen_1' || str === 'secondary' || str.includes('1080') || str.toLowerCase().includes('asus')) {
    return 'screen_3';
  }
  return str;
};

/**
 * Determines which display the current WebView is running on.
 * In Übersicht, the WebView URL pathname is `/<screenId>` where screenId is
 * the CGDirectDisplayID (e.g. /2 for LG, /3 for ASUS).
 * Guaranteed to return the canonical `screen_<id>` matching topology.
 */
export const getScreenId = () => {
  let matchedNum = null;
  try {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      const match = window.location.pathname.match(/\/(\d+)/);
      if (match) {
        matchedNum = parseInt(match[1], 10);
      } else {
        const parts = window.location.pathname.split('/').filter(Boolean);
        if (parts.length > 0 && !isNaN(Number(parts[0]))) {
          matchedNum = parseInt(parts[0], 10);
        }
      }
    }
  } catch (e) {}

  const winW = (typeof window !== 'undefined') ? (window.innerWidth || (window.screen && window.screen.width)) : null;
  const winH = (typeof window !== 'undefined') ? (window.innerHeight || (window.screen && window.screen.height)) : null;

  const topology = getScreensTopology();

  if (topology && topology.length > 0) {
    // 1. PRIMARY MATCH: CGDirectDisplayID from Übersicht URL (/2 -> screen_2, /3 -> screen_3)
    if (matchedNum !== null) {
      const byId = topology.find((s) => s.id === matchedNum);
      if (byId) return byId.screenId;
      const byIndex = topology.find((s) => s.index === matchedNum);
      if (byIndex) return byIndex.screenId;
    }

    // 2. SECONDARY MATCH: Exact screen viewport dimensions
    if (winW && winH) {
      const byRes = topology.find((s) => s.w === winW && s.h === winH);
      if (byRes) return byRes.screenId;
      const byRotated = topology.find((s) => s.w === winH && s.h === winW);
      if (byRotated) return byRotated.screenId;
    }

    // Fallback: main display
    const main = topology.find((s) => s.isMain) || topology[0];
    return main.screenId;
  }

  // Pre-topology fallback matching user's LG (2560x1080) and ASUS (1080x1920)
  if (matchedNum === 2 || winW === 2560) return 'screen_2';
  if (matchedNum === 3 || winW === 1080 || winH === 1920) return 'screen_3';
  if (matchedNum !== null) return `screen_${matchedNum}`;
  return 'screen_2';
};

/**
 * Resolves any saved screen identifier to a currently connected canonical screenId.
 */
export const resolveActiveScreen = (savedScreenId, topology = getScreensTopology()) => {
  if (savedScreenId === 'all') return 'all';
  if (!savedScreenId) return getMainScreenId(topology);
  return normalizeScreenId(savedScreenId, topology);
};

/**
 * Strictly determines whether the current WebView screen should render a widget/instance
 * assigned to `targetScreenId`. Guaranteed to match at most ONE monitor (unless 'all').
 */
export const isScreenActive = (currentScreenId, targetScreenId) => {
  if (targetScreenId === 'all') return true;

  const topology = getScreensTopology();
  const current = normalizeScreenId(currentScreenId || getScreenId(), topology);
  const target = normalizeScreenId(targetScreenId, topology);

  if (current && target && current === target) {
    return true;
  }

  // FAILSAFE 1: If targetScreenId is not set or resolves to null, always show on main display!
  if (!target || target === 'screen_main') {
    const main = getMainScreenId(topology);
    if (current === main) return true;
  }

  // FAILSAFE 2: If only 1 monitor is connected, always show!
  if (topology && topology.length <= 1) {
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// 4. Snapping & Cross-Monitor Geometry Calculations
// ---------------------------------------------------------------------------

export const calculateSnappedPosition = (
  rawX,
  rawY,
  cardWidth,
  cardHeight,
  bypassSnap = false,
  allowOverflow = true,
  margins = {}
) => {
  const winW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920;
  const winH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080;

  const marginX = margins.marginX ?? SNAP_MARGIN_X;
  const marginTop = margins.marginTop ?? SNAP_MARGIN_TOP;
  const marginBottom = margins.marginBottom ?? SNAP_MARGIN_BOTTOM;
  const threshold = margins.threshold ?? SNAP_THRESHOLD;
  const tolerance = margins.tolerance ?? SNAP_EDGE_TOLERANCE;

  const maxX = Math.max(0, winW - cardWidth);
  const maxY = Math.max(0, winH - cardHeight);

  let newX = allowOverflow ? rawX : Math.max(0, Math.min(maxX, rawX));
  let newY = allowOverflow ? rawY : Math.max(0, Math.min(maxY, rawY));

  if (!bypassSnap && newX >= 0 && newX <= maxX && newY >= 0 && newY <= maxY) {
    const snapTop = marginTop;
    const snapBottom = Math.max(0, winH - cardHeight - marginBottom);
    const snapLeft = marginX;
    const snapRight = Math.max(0, winW - cardWidth - marginX);

    if (newX >= snapLeft - tolerance && newX <= snapLeft + threshold) {
      newX = snapLeft;
    } else if (newX >= snapRight - threshold && newX <= snapRight + tolerance) {
      newX = snapRight;
    }

    if (newY >= snapTop - tolerance && newY <= snapTop + threshold) {
      newY = snapTop;
    } else if (newY >= snapBottom - threshold && newY <= snapBottom + tolerance) {
      newY = snapBottom;
    }
  }

  return { x: Math.round(newX), y: Math.round(newY) };
};

/**
 * Given a card being dragged on `currentScreenId` at local `(curX, curY)`,
 * checks if the card overlaps another display in `topology` and returns its
 * local coordinates on that other display for real-time cross-bezel rendering.
 * Supports both object argument and positional argument signatures.
 */
export const computeCrossScreenPreview = (arg1, curX, curY, cardW, cardH, extra = {}) => {
  let currentScreenId = arg1;
  let x = curX;
  let y = curY;
  let w = cardW;
  let h = cardH;
  let meta = extra || {};

  if (typeof arg1 === 'object' && arg1 !== null) {
    const {
      currentScreenId: cid,
      curX: cx,
      curY: cy,
      cardW: cw,
      cardH: ch,
      ...rest
    } = arg1;
    currentScreenId = cid;
    x = cx;
    y = cy;
    w = cw;
    h = ch;
    meta = rest;
  }

  const topology = getScreensTopology();
  if (!topology || topology.length <= 1) return null;

  const sourceScreenId = normalizeScreenId(currentScreenId, topology);
  const source = topology.find((s) => s.screenId === sourceScreenId);
  if (!source) return null;

  const globalLeft = source.topLeftX + x;
  const globalTop = source.topLeftY + y;
  const globalRight = globalLeft + w;
  const globalBottom = globalTop + h;

  for (const s of topology) {
    if (s.screenId === sourceScreenId) continue;
    const sLeft = s.topLeftX;
    const sTop = s.topLeftY;
    const sRight = sLeft + s.w;
    const sBottom = sTop + s.h;

    const overlapsX = globalRight > sLeft && globalLeft < sRight;
    const overlapsY = globalBottom > sTop && globalTop < sBottom;
    const crossedHorizontally =
      overlapsX &&
      (globalLeft < source.topLeftX || globalRight > source.topLeftX + source.w);

    if (overlapsX && (overlapsY || crossedHorizontally)) {
      const rawLocalX = Math.round(globalLeft - sLeft);
      const rawLocalY = Math.round(globalTop - sTop);
      const clampedY = overlapsY
        ? rawLocalY
        : Math.max(0, Math.min(Math.max(0, s.h - h), rawLocalY));
      return {
        ...meta,
        targetScreen: s.screenId,
        x: rawLocalX,
        y: clampedY,
        w,
        h,
      };
    }
  }

  return null;
};

/**
 * Resolves the final screen and local `(x, y)` when a drag finishes (`END_DRAG`).
 * Uses real display arrangement geometry so dragging across any monitor border
 * (left, right, top, bottom, or offset vertical monitor) lands at the exact
 * physical position where the user released the card.
 * Supports both object argument and positional argument signatures.
 */
export const resolveDragEndAcrossScreens = (arg1, ...rest) => {
  let opts = {};
  if (typeof arg1 === 'object' && arg1 !== null) {
    opts = arg1;
  } else {
    opts = {
      currentScreenId: arg1,
      curX: rest[0],
      curY: rest[1],
      cardW: rest[2],
      cardH: rest[3],
      clientX: rest[4],
      clientY: rest[5],
      bypassSnap: rest[6],
      margins: rest[7],
    };
  }

  const {
    currentScreenId: rawScreenId,
    curX,
    curY,
    cardW,
    cardH,
    clientX,
    clientY,
    bypassSnap = false,
    margins = {},
  } = opts;

  const winW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920;
  const winH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080;

  const marginX = margins.marginX ?? SNAP_MARGIN_X;
  const marginTop = margins.marginTop ?? SNAP_MARGIN_TOP;
  const marginBottom = margins.marginBottom ?? SNAP_MARGIN_BOTTOM;

  const topology = getScreensTopology();
  const currentScreenId = normalizeScreenId(rawScreenId, topology);
  const source = topology.find((s) => s.screenId === currentScreenId);

  if (source && topology.length > 1) {
    const globalCardX = source.topLeftX + curX;
    const globalCardY = source.topLeftY + curY;
    const centerGlobalX = globalCardX + cardW / 2;
    const centerGlobalY = globalCardY + cardH / 2;

    const cursorGlobalX = typeof clientX === 'number' ? source.topLeftX + clientX : centerGlobalX;
    const cursorGlobalY = typeof clientY === 'number' ? source.topLeftY + clientY : centerGlobalY;

    // 1. Check if either the cursor or the card center is inside another screen's bounds
    let dest = topology.find(
      (s) =>
        s.screenId !== currentScreenId &&
        cursorGlobalX >= s.topLeftX &&
        cursorGlobalX <= s.topLeftX + s.w &&
        cursorGlobalY >= s.topLeftY &&
        cursorGlobalY <= s.topLeftY + s.h
    );

    if (!dest) {
      dest = topology.find(
        (s) =>
          s.screenId !== currentScreenId &&
          centerGlobalX >= s.topLeftX &&
          centerGlobalX <= s.topLeftX + s.w &&
          centerGlobalY >= s.topLeftY &&
          centerGlobalY <= s.topLeftY + s.h
      );
    }

    // 2. Horizontal fallback if dragged off left/right edge
    if (!dest && (centerGlobalX < source.topLeftX || centerGlobalX > source.topLeftX + source.w)) {
      dest = topology.find(
        (s) =>
          s.screenId !== currentScreenId &&
          centerGlobalX >= s.topLeftX &&
          centerGlobalX <= s.topLeftX + s.w
      );
    }

    if (dest && dest.screenId !== currentScreenId) {
      const rawDestX = globalCardX - dest.topLeftX;
      const rawDestY = globalCardY - dest.topLeftY;

      const maxDestX = Math.max(0, dest.w - cardW);
      const maxDestY = Math.max(0, dest.h - cardH);

      let finalX = Math.max(0, Math.min(maxDestX, Math.round(rawDestX)));
      let finalY = Math.max(0, Math.min(maxDestY, Math.round(rawDestY)));

      if (!bypassSnap) {
        const snapTop = marginTop;
        const snapBottom = Math.max(0, dest.h - cardH - marginBottom);
        const snapLeft = marginX;
        const snapRight = Math.max(0, dest.w - cardW - marginX);
        const threshold = margins.threshold ?? SNAP_THRESHOLD;
        const tolerance = margins.tolerance ?? SNAP_EDGE_TOLERANCE;

        if (finalX >= snapLeft - tolerance && finalX <= snapLeft + threshold) {
          finalX = snapLeft;
        } else if (finalX >= snapRight - threshold && finalX <= snapRight + tolerance) {
          finalX = snapRight;
        }

        if (finalY >= snapTop - tolerance && finalY <= snapTop + threshold) {
          finalY = snapTop;
        } else if (finalY >= snapBottom - threshold && finalY <= snapBottom + tolerance) {
          finalY = snapBottom;
        }
      }

      return {
        targetScreen: dest.screenId,
        x: finalX,
        y: finalY,
        crossedScreen: true,
      };
    }
  }

  // Stayed on current screen: clamp cleanly within current screen bounds
  const snapped = calculateSnappedPosition(curX, curY, cardW, cardH, bypassSnap, false, margins);
  const finalX = Math.max(0, Math.min(Math.max(0, winW - cardW), snapped.x));
  const finalY = Math.max(0, Math.min(Math.max(0, winH - cardH), snapped.y));

  return {
    targetScreen: currentScreenId,
    x: Math.round(finalX),
    y: Math.round(finalY),
    crossedScreen: false,
  };
};

// ---------------------------------------------------------------------------
// 5. Lifecycle & Listener Registration
// ---------------------------------------------------------------------------

export const initWidgetDesktopSync = (opts = {}) => {
  if (typeof window === 'undefined') return;

  const widgetName = opts.widgetName || opts.widgetId || 'widget';
  const guardKey = `__uebersicht_desktop_sync_${widgetName}`;
  if (window[guardKey]) return;
  window[guardKey] = true;

  const run = opts.run || (typeof window !== 'undefined' ? window.run : null);
  let helperCommand = opts.helperCommand;
  if (!helperCommand && opts.helperPaths && Array.isArray(opts.helperPaths)) {
    helperCommand = opts.helperPaths.map((p) => `"${p}" --screens 2>/dev/null`).join(' || ');
  }
  if (!helperCommand) {
    helperCommand = `"$HOME/Library/Application Support/Übersicht/widgets/${widgetName}.widget/menu_helper" --screens 2>/dev/null || "./${widgetName}.widget/menu_helper" --screens 2>/dev/null`;
  }

  const getDispatch = opts.getDispatch;
  const onSyncPacket = opts.onSyncPacket;
  const onScreensUpdated = opts.onScreensUpdated;
  const storageKeys = opts.storageKeys || [];
  const onStorageEvent = opts.onStorageEvent;

  let lastProcessedTs = 0;

  const handlePacket = (data) => {
    if (!data) return;
    if (data._ts && data._ts === lastProcessedTs) return;
    if (data._ts) lastProcessedTs = data._ts;

    const dispatch = getDispatch ? getDispatch() : null;
    if (!dispatch) return;

    if (data.widget === '*' && data.type === 'ORDER_CHANGED') {
      dispatch({ type: 'ORDER_CHANGED' });
      return;
    }

    if (data.widget === widgetName && onSyncPacket) {
      onSyncPacket(data, dispatch);
    }
  };

  if (syncChannel) {
    syncChannel.addEventListener('message', (event) => {
      handlePacket(event.data);
    });
  }

  window.addEventListener('storage', (event) => {
    if (!event.key || !event.newValue) return;
    if (
      event.key === `uebersicht_sync_packet_${widgetName}` ||
      event.key === `uebersicht_drag_preview_${widgetName}` ||
      event.key === 'uebersicht_sync_packet_global'
    ) {
      try {
        const parsed = JSON.parse(event.newValue);
        handlePacket(parsed);
      } catch (e) {}
    } else if (event.key === TOPOLOGY_STORAGE_KEY) {
      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedTopology = parsed;
          const dispatch = getDispatch ? getDispatch() : null;
          if (dispatch) {
            dispatch({ type: 'TOPOLOGY_UPDATED', topology: parsed });
          }
        }
      } catch (e) {}
    } else if (storageKeys.includes(event.key) && onStorageEvent) {
      const dispatch = getDispatch ? getDispatch() : null;
      if (dispatch) {
        onStorageEvent(event, dispatch);
      }
    }
  });

  window.addEventListener('uebersicht:order-changed', () => {
    const dispatch = getDispatch ? getDispatch() : null;
    if (dispatch) {
      dispatch({ type: 'ORDER_CHANGED' });
    }
  });

  const applyScreensOutput = (out) => {
    if (!out) return;
    try {
      const rawScreens = JSON.parse(out.trim());
      const normalized = updateScreensTopology(rawScreens);
      const dispatch = getDispatch ? getDispatch() : null;
      if (onScreensUpdated && dispatch) {
        onScreensUpdated(normalized, dispatch);
      } else if (dispatch) {
        dispatch({ type: 'TOPOLOGY_UPDATED', topology: normalized });
      }
    } catch (e) {}
  };

  const refreshScreensTopology = () => {
    const port = WIDGET_MENU_PORTS[widgetName];
    if (port && typeof fetch !== 'undefined') {
      fetch(`http://127.0.0.1:${port}/screens`, { method: 'GET' })
        .then((resp) => {
          if (!resp.ok) throw new Error('Daemon not ready');
          return resp.text();
        })
        .then((out) => applyScreensOutput(out))
        .catch(() => {
          if (!run || !helperCommand) return;
          try {
            run(helperCommand, (err, out) => {
              if (!err && out) applyScreensOutput(out);
            });
          } catch (e) {}
        });
      return;
    }
    if (!run || !helperCommand) return;
    try {
      run(helperCommand, (err, out) => {
        if (!err && out) applyScreensOutput(out);
      });
    } catch (e) {}
  };

  refreshScreensTopology();
  window.addEventListener('resize', refreshScreensTopology);
  setTimeout(refreshScreensTopology, 1200);
};
