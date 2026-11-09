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

export const getScreenId = () => {
  try {
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      const match = window.location.pathname.match(/\/(\d+)/);
      if (match) return `screen_${match[1]}`;
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts.length > 0 && !isNaN(Number(parts[0]))) {
        return `screen_${parts[0]}`;
      }
    }
  } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.screen) {
      return `screen_${window.screen.width}x${window.screen.height}`;
    }
  } catch (e) {}
  return 'screen_main';
};

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
  return getScreenId();
};

/**
 * Resolves any saved screen identifier to a currently connected screenId.
 * - If savedScreenId matches a connected screen in topology, returns it as-is.
 * - If savedScreenId is stale (e.g. from an unplugged monitor or old display ID),
 *   falls back cleanly to the main screen so widgets are never lost or duplicated.
 */
export const resolveActiveScreen = (savedScreenId, topology = getScreensTopology()) => {
  if (savedScreenId === 'all') return 'all';
  if (topology && topology.length > 0) {
    if (savedScreenId && topology.some((s) => s.screenId === savedScreenId)) {
      return savedScreenId;
    }
    return getMainScreenId(topology);
  }
  return savedScreenId || getScreenId();
};

/**
 * Strictly determines whether the current WebView screen should render a widget/instance
 * assigned to `targetScreenId`. Guaranteed to match at most ONE monitor (unless 'all').
 */
export const isScreenActive = (currentScreenId, targetScreenId) => {
  if (targetScreenId === 'all') return true;

  const topology = getScreensTopology();
  if (topology.length > 0) {
    const resolvedTarget = resolveActiveScreen(targetScreenId, topology);
    return currentScreenId === resolvedTarget;
  }

  // Fallback before topology is first populated
  if (targetScreenId && currentScreenId === targetScreenId) {
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
 */
export const computeCrossScreenPreview = ({
  currentScreenId,
  curX,
  curY,
  cardW,
  cardH,
}) => {
  const topology = getScreensTopology();
  if (!topology || topology.length <= 1) return null;

  const source = topology.find((s) => s.screenId === currentScreenId);
  if (!source) return null;

  const globalLeft = source.topLeftX + curX;
  const globalTop = source.topLeftY + curY;
  const globalRight = globalLeft + cardW;
  const globalBottom = globalTop + cardH;

  for (const s of topology) {
    if (s.screenId === currentScreenId) continue;
    const sLeft = s.topLeftX;
    const sTop = s.topLeftY;
    const sRight = sLeft + s.w;
    const sBottom = sTop + s.h;

    const overlapsX = globalRight > sLeft && globalLeft < sRight;
    const overlapsY = globalBottom > sTop && globalTop < sBottom;
    if (overlapsX && overlapsY) {
      return {
        targetScreen: s.screenId,
        x: Math.round(globalLeft - sLeft),
        y: Math.round(globalTop - sTop),
        w: cardW,
        h: cardH,
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
 */
export const resolveDragEndAcrossScreens = ({
  currentScreenId,
  curX,
  curY,
  cardW,
  cardH,
  clientX,
  clientY,
  bypassSnap = false,
  margins = {},
}) => {
  const winW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920;
  const winH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080;

  const marginX = margins.marginX ?? SNAP_MARGIN_X;
  const marginTop = margins.marginTop ?? SNAP_MARGIN_TOP;
  const marginBottom = margins.marginBottom ?? SNAP_MARGIN_BOTTOM;

  const topology = getScreensTopology();
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

    // 2. Horizontal fallback if dragged off left/right edge at a Y outside shorter screen's vertical span
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

      let finalX = Math.max(marginX, Math.min(Math.max(marginX, maxDestX - marginX), Math.round(rawDestX)));
      let finalY = Math.max(marginTop, Math.min(Math.max(marginTop, maxDestY - marginBottom), Math.round(rawDestY)));

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

export const initWidgetDesktopSync = ({
  widgetName,
  helperCommand,
  run,
  getDispatch,
  onSyncPacket,
  onScreensUpdated,
}) => {
  if (typeof window === 'undefined') return;
  const guardKey = `__uebersicht_desktop_sync_${widgetName}`;
  if (window[guardKey]) return;
  window[guardKey] = true;

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
    }
  });

  window.addEventListener('uebersicht:order-changed', () => {
    const dispatch = getDispatch ? getDispatch() : null;
    if (dispatch) {
      dispatch({ type: 'ORDER_CHANGED' });
    }
  });

  const refreshScreensTopology = () => {
    if (!run || !helperCommand) return;
    run(helperCommand, (err, out) => {
      if (err || !out) return;
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
    });
  };

  refreshScreensTopology();
  window.addEventListener('resize', refreshScreensTopology);
  setTimeout(refreshScreensTopology, 1200);
};
