import { React, run } from 'uebersicht';
import { theme, settings } from './lib/config.js';
import {
  getWidgetZIndex,
  reorderWidget,
  getScreenId,
  resolveActiveScreen,
  isScreenActive,
  calculateSnappedPosition,
  computeCrossScreenPreview,
  resolveDragEndAcrossScreens,
  broadcastWidgetMessage,
  initWidgetDesktopSync,
} from './lib/desktop.js';

export const refreshFrequency = 40; // Poll bridge every 40ms (~25 FPS)

export const command = `"$HOME/Library/Application Support/Übersicht/widgets/cava.widget/cava_poll" "$HOME/Library/Application Support/Übersicht/widgets/cava.widget/cava_bridge.py" 2>/dev/null || ./cava.widget/cava_poll 2>/dev/null || python3 "$HOME/Library/Application Support/Übersicht/widgets/cava.widget/cava_bridge.py" 2>/dev/null`;

const POS_KEY = 'cava_widget_position';
const STORAGE_INSTANCES_KEY = 'cava_widget_instances_v2';
const SIZE_KEY = 'cava_widget_size';
const STORAGE_SNAP_KEY = 'cava_widget_enable_snap';
const STORAGE_ACTIVE_SCREEN_KEY = 'cava_active_screen';
const SCREEN_MARGIN = 0;
const SNAP_THRESHOLD = settings.snapThreshold !== undefined ? settings.snapThreshold : 6;
const SNAP_EDGE_TOLERANCE = 3;
const SNAP_MARGIN_X = settings.snapMarginX !== undefined ? settings.snapMarginX : 15;
const SNAP_MARGIN_TOP = settings.snapMarginTop !== undefined ? settings.snapMarginTop : 14;
const SNAP_MARGIN_BOTTOM = settings.snapMarginBottom !== undefined ? settings.snapMarginBottom : 14;
const DEFAULT_BARS_COUNT = settings.barsCount || 28;

const SNAP_MARGINS = {
  marginX: SNAP_MARGIN_X,
  marginTop: SNAP_MARGIN_TOP,
  marginBottom: SNAP_MARGIN_BOTTOM,
  threshold: SNAP_THRESHOLD,
  tolerance: SNAP_EDGE_TOLERANCE,
};

const getInitialSnapping = () => {
  try {
    const saved = localStorage.getItem(STORAGE_SNAP_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  } catch (e) {}
  return settings.enableSnapping !== undefined ? settings.enableSnapping : true;
};

function hexToRgb(h) {
  const clean = h.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb) {
  const r = Math.round(Math.max(0, Math.min(255, rgb[0])))
    .toString(16)
    .padStart(2, '0');
  const g = Math.round(Math.max(0, Math.min(255, rgb[1])))
    .toString(16)
    .padStart(2, '0');
  const b = Math.round(Math.max(0, Math.min(255, rgb[2])))
    .toString(16)
    .padStart(2, '0');
  return `#${r}${g}${b}`;
}

function interpolateBands(stops, totalBands) {
  if (!stops || stops.length === 0) return ['#59cc33'];
  if (stops.length === 1 || totalBands <= 1) return [stops[0]];

  const stopRgbs = stops.map(hexToRgb);
  const nStops = stopRgbs.length;
  const bands = [];

  for (let b = 0; b < totalBands; b++) {
    const t = b / (totalBands - 1);
    const pos = t * (nStops - 1);
    const idx = Math.min(nStops - 2, Math.floor(pos));
    const frac = pos - idx;
    const c1 = stopRgbs[idx];
    const c2 = stopRgbs[idx + 1];

    const interp = [
      c1[0] + (c2[0] - c1[0]) * frac,
      c1[1] + (c2[1] - c1[1]) * frac,
      c1[2] + (c2[2] - c1[2]) * frac,
    ];
    bands.push(rgbToHex(interp));
  }

  return bands;
}

function getGradientCss(colors, mode, bandCount = 24) {
  if (!colors || colors.length === 0) return '#59cc33';
  if (colors.length === 1) return colors[0];

  if (mode === 'banded') {
    const bands = interpolateBands(colors, bandCount);
    const n = bands.length;
    const step = 100 / n;
    const stops = [];
    for (let i = 0; i < n; i++) {
      const start = (i * step).toFixed(2);
      const end = ((i + 1) * step).toFixed(2);
      stops.push(`${bands[i]} ${start}%`, `${bands[i]} ${end}%`);
    }
    return `linear-gradient(to top, ${stops.join(', ')})`;
  }

  return `linear-gradient(to top, ${colors.join(', ')})`;
}

const getActiveScreen = () => {
  try {
    const saved = localStorage.getItem(STORAGE_ACTIVE_SCREEN_KEY);
    if (saved) return resolveActiveScreen(saved);
  } catch (e) {}
  return resolveActiveScreen(null);
};

const getInitialInstances = () => {
  const screenId = getScreenId();
  try {
    const savedCanonical = localStorage.getItem(STORAGE_INSTANCES_KEY);
    if (savedCanonical) {
      const parsed = JSON.parse(savedCanonical);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}

  try {
    const saved = localStorage.getItem(`${POS_KEY}_instances_${screenId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {}

  try {
    const saved = localStorage.getItem(`${POS_KEY}_${screenId}`) || localStorage.getItem(POS_KEY);
    const savedSize = localStorage.getItem(`${SIZE_KEY}_${screenId}`) || localStorage.getItem(SIZE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const parsedSize = savedSize ? JSON.parse(savedSize) : null;
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return [{
          id: 'default',
          x: Math.max(SCREEN_MARGIN, parsed.x),
          y: Math.max(SCREEN_MARGIN, parsed.y),
          w: parsedSize?.w || 380,
          h: parsedSize?.h || 140,
        }];
      }
    }
  } catch (e) {}

  return [{
    id: 'default',
    x: SNAP_MARGIN_X,
    y: SNAP_MARGIN_TOP,
    w: 380,
    h: 140,
  }];
};

const saveInstances = (instances, targetScreenId) => {
  const screenId = targetScreenId || getScreenId();
  try {
    localStorage.setItem(STORAGE_INSTANCES_KEY, JSON.stringify(instances));
    localStorage.setItem(`${POS_KEY}_instances_${screenId}`, JSON.stringify(instances));
    if (instances && instances[0]) {
      const posJson = JSON.stringify({ x: instances[0].x, y: instances[0].y });
      const sizeJson = JSON.stringify({ w: instances[0].w, h: instances[0].h });
      localStorage.setItem(`${POS_KEY}_${screenId}`, posJson);
      localStorage.setItem(POS_KEY, posJson);
      localStorage.setItem(`${SIZE_KEY}_${screenId}`, sizeJson);
      localStorage.setItem(SIZE_KEY, sizeJson);
    }
  } catch (e) {}
};

const initialInstances = getInitialInstances();

export const initialState = {
  instances: initialInstances,
  activeScreen: getActiveScreen(),
  x: initialInstances[0]?.x ?? SNAP_MARGIN_X,
  y: initialInstances[0]?.y ?? SNAP_MARGIN_TOP,
  w: initialInstances[0]?.w ?? 380,
  h: initialInstances[0]?.h ?? 140,
  enableSnapping: getInitialSnapping(),
  isDragging: false,
  draggingInstanceId: null,
  isResizing: false,
  resizingInstanceId: null,
  dragStartX: 0,
  dragStartY: 0,
  startPosX: 0,
  startPosY: 0,
  lastClientX: 0,
  lastClientY: 0,
  lastBypassSnap: false,
  crossScreenPreview: null,
  resizeStartX: 0,
  resizeStartY: 0,
  startW: 0,
  startH: 0,
  bars: new Array(DEFAULT_BARS_COUNT).fill(0),
};

export const updateState = (event, previousState) => {
  if (!previousState) return initialState;

  if (event.output && typeof event.output === 'string') {
    const parts = event.output.trim().split(';').filter(Boolean);
    if (parts.length > 0) {
      const parsedBars = parts.map((val) => {
        const num = parseInt(val, 10);
        return isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
      });

      if (previousState.bars && previousState.bars.length === parsedBars.length) {
        let changed = false;
        for (let i = 0; i < parsedBars.length; i++) {
          if (parsedBars[i] !== previousState.bars[i]) {
            changed = true;
            break;
          }
        }
        if (!changed) {
          return previousState;
        }
      }

      return {
        ...previousState,
        bars: parsedBars,
      };
    }
  }

  if (event.type === 'START_DRAG') {
    return {
      ...previousState,
      isDragging: true,
      draggingInstanceId: event.instanceId,
      dragStartX: event.clientX,
      dragStartY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startPosX: event.startPosX !== undefined ? event.startPosX : previousState.x,
      startPosY: event.startPosY !== undefined ? event.startPosY : previousState.y,
      startW: event.w || previousState.w || 380,
      startH: event.h || previousState.h || 140,
    };
  }

  if (event.type === 'MOVE_DRAG' && previousState.isDragging && previousState.draggingInstanceId) {
    const deltaX = event.clientX - previousState.dragStartX;
    const deltaY = event.clientY - previousState.dragStartY;
    const cardW = previousState.startW || previousState.w || 380;
    const cardH = previousState.startH || previousState.h || 140;

    const bypassSnap = previousState.enableSnapping === false || event.bypassSnap || event.metaKey;
    const { x: newX, y: newY } = calculateSnappedPosition(
      previousState.startPosX + deltaX,
      previousState.startPosY + deltaY,
      cardW,
      cardH,
      bypassSnap,
      true,
      SNAP_MARGINS
    );

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (inst.id === previousState.draggingInstanceId) {
        return { ...inst, x: newX, y: newY };
      }
      return inst;
    });

    const currentScreenId = getScreenId();
    const preview = computeCrossScreenPreview({
      currentScreenId,
      curX: newX,
      curY: newY,
      cardW,
      cardH,
    });

    broadcastWidgetMessage('cava', {
      type: 'CROSS_SCREEN_DRAG_PREVIEW',
      preview,
    });

    return {
      ...previousState,
      instances: updatedInstances,
      x: updatedInstances[0]?.x ?? newX,
      y: updatedInstances[0]?.y ?? newY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastBypassSnap: bypassSnap,
    };
  }

  if (event.type === 'END_DRAG') {
    const draggingId = previousState.draggingInstanceId;
    const currentInst = (previousState.instances || []).find((i) => i.id === draggingId) || previousState.instances?.[0];
    const cardW = previousState.startW || previousState.w || 380;
    const cardH = previousState.startH || previousState.h || 140;
    const curX = currentInst?.x ?? previousState.x ?? 0;
    const curY = currentInst?.y ?? previousState.y ?? 0;
    const currentScreenId = getScreenId();

    const resolution = resolveDragEndAcrossScreens({
      currentScreenId,
      curX,
      curY,
      cardW,
      cardH,
      clientX: event.clientX ?? previousState.lastClientX,
      clientY: event.clientY ?? previousState.lastClientY,
      bypassSnap: previousState.lastBypassSnap,
      margins: SNAP_MARGINS,
    });

    const targetScreen = resolution.targetScreen || currentScreenId;
    const finalX = resolution.x;
    const finalY = resolution.y;

    try {
      localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, targetScreen);
    } catch (e) {}

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (!draggingId || inst.id === draggingId) {
        return { ...inst, x: finalX, y: finalY };
      }
      return inst;
    });

    saveInstances(updatedInstances, targetScreen);

    broadcastWidgetMessage('cava', {
      type: 'CROSS_SCREEN_DRAG_PREVIEW',
      preview: null,
    });

    broadcastWidgetMessage('cava', {
      type: 'ACTIVE_SCREEN_CHANGED',
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    });

    return {
      ...previousState,
      isDragging: false,
      draggingInstanceId: null,
      crossScreenPreview: null,
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    };
  }

  if (event.type === 'MOVE_TO_SCREEN') {
    const targetScreen = resolveActiveScreen(event.screenId || getScreenId());
    try {
      localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, targetScreen);
    } catch (e) {}

    const defaultX = SNAP_MARGIN_X;
    const defaultY = SNAP_MARGIN_TOP;
    const finalX = event.x !== undefined ? event.x : defaultX;
    const finalY = event.y !== undefined ? event.y : defaultY;

    const updatedInstances = (previousState.instances || []).map((inst) => ({
      ...inst,
      x: finalX,
      y: finalY,
    }));
    saveInstances(updatedInstances, targetScreen);

    broadcastWidgetMessage('cava', {
      type: 'ACTIVE_SCREEN_CHANGED',
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    });

    return {
      ...previousState,
      crossScreenPreview: null,
      activeScreen: targetScreen,
      instances: updatedInstances,
      x: finalX,
      y: finalY,
    };
  }

  if (event.type === 'SYNC_ACTIVE_SCREEN') {
    let updatedInstances = previousState.instances;
    if (Array.isArray(event.instances) && event.instances.length > 0) {
      updatedInstances = event.instances;
    } else if (typeof event.x === 'number' && typeof event.y === 'number') {
      updatedInstances = (previousState.instances || []).map((inst) => ({
        ...inst,
        x: event.x,
        y: event.y,
      }));
    }
    return {
      ...previousState,
      crossScreenPreview: null,
      activeScreen: resolveActiveScreen(event.activeScreen),
      instances: updatedInstances,
      x: event.x !== undefined ? event.x : (updatedInstances[0]?.x ?? previousState.x),
      y: event.y !== undefined ? event.y : (updatedInstances[0]?.y ?? previousState.y),
    };
  }

  if (event.type === 'CROSS_SCREEN_DRAG_PREVIEW') {
    return {
      ...previousState,
      crossScreenPreview: event.preview || null,
    };
  }

  if (event.type === 'TOPOLOGY_UPDATED') {
    const resolved = resolveActiveScreen(previousState.activeScreen, event.topology);
    if (resolved !== previousState.activeScreen) {
      try {
        localStorage.setItem(STORAGE_ACTIVE_SCREEN_KEY, resolved);
      } catch (e) {}
    }
    return {
      ...previousState,
      activeScreen: resolved,
    };
  }

  if (event.type === 'START_RESIZE') {
    return {
      ...previousState,
      isResizing: true,
      resizingInstanceId: event.instanceId,
      resizeStartX: event.clientX,
      resizeStartY: event.clientY,
      startW: event.startW !== undefined ? event.startW : previousState.w,
      startH: event.startH !== undefined ? event.startH : previousState.h,
      startPosX: event.startPosX !== undefined ? event.startPosX : previousState.x,
      startPosY: event.startPosY !== undefined ? event.startPosY : previousState.y,
    };
  }

  if (event.type === 'MOVE_RESIZE' && previousState.isResizing && previousState.resizingInstanceId) {
    const deltaW = event.clientX - previousState.resizeStartX;
    const deltaH = event.clientY - previousState.resizeStartY;

    const currentX = previousState.startPosX !== undefined ? previousState.startPosX : previousState.x;
    const currentY = previousState.startPosY !== undefined ? previousState.startPosY : previousState.y;

    const winW = window.innerWidth || 1920;
    const winH = window.innerHeight || 1080;
    const maxW = Math.max(180, winW - currentX);
    const maxH = Math.max(70, winH - currentY);

    let newW = Math.round(Math.max(180, Math.min(maxW, previousState.startW + deltaW)));
    let newH = Math.round(Math.max(70, Math.min(maxH, previousState.startH + deltaH)));

    if (previousState.enableSnapping !== false && !event.bypassSnap && !event.metaKey) {
      const snapW = winW - currentX - SNAP_MARGIN_X;
      const snapH = winH - currentY - SNAP_MARGIN_BOTTOM;
      if (newW >= snapW - SNAP_THRESHOLD && newW <= snapW + SNAP_EDGE_TOLERANCE && snapW >= 180) {
        newW = snapW;
      }
      if (newH >= snapH - SNAP_THRESHOLD && newH <= snapH + SNAP_EDGE_TOLERANCE && snapH >= 70) {
        newH = snapH;
      }
    }

    const updatedInstances = (previousState.instances || []).map((inst) => {
      if (inst.id === previousState.resizingInstanceId) {
        return { ...inst, w: newW, h: newH };
      }
      return inst;
    });

    return {
      ...previousState,
      instances: updatedInstances,
      w: updatedInstances[0]?.w ?? newW,
      h: updatedInstances[0]?.h ?? newH,
    };
  }

  if (event.type === 'END_RESIZE') {
    saveInstances(previousState.instances, previousState.activeScreen);
    return {
      ...previousState,
      isResizing: false,
      resizingInstanceId: null,
    };
  }

  if (event.type === 'TOGGLE_SNAPPING') {
    const nextVal = previousState.enableSnapping === false ? true : false;
    const screenId = getScreenId();
    try {
      localStorage.setItem(`${STORAGE_SNAP_KEY}_${screenId}`, String(nextVal));
      localStorage.setItem(STORAGE_SNAP_KEY, String(nextVal));
    } catch (e) {}
    return {
      ...previousState,
      enableSnapping: nextVal,
    };
  }

  if (event.type === 'RESET_POSITION') {
    const defaultX = SNAP_MARGIN_X;
    const defaultY = SNAP_MARGIN_TOP;
    const targetId = event.instanceId;
    const updatedInstances = (previousState.instances || []).map((i) => {
      if (i.id === targetId || (!targetId && i.id === (previousState.instances?.[0]?.id || 'default'))) {
        return { ...i, x: defaultX, y: defaultY };
      }
      return i;
    });
    saveInstances(updatedInstances, previousState.activeScreen);
    return {
      ...previousState,
      instances: updatedInstances,
      x: updatedInstances[0]?.x ?? defaultX,
      y: updatedInstances[0]?.y ?? defaultY,
    };
  }

  if (event.type === 'DUPLICATE_WIDGET') {
    const current = previousState.instances && previousState.instances.length > 0
      ? previousState.instances
      : [{ id: 'default', x: previousState.x || SNAP_MARGIN_X, y: previousState.y || SNAP_MARGIN_TOP, w: previousState.w || 380, h: previousState.h || 140 }];
    const target = current.find((i) => i.id === event.instanceId) || current[current.length - 1];
    const newInst = {
      ...target,
      id: `inst_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      x: (target.x || SNAP_MARGIN_X) + 30,
      y: (target.y || SNAP_MARGIN_TOP) + 30,
    };
    const updatedInstances = [...current, newInst];
    saveInstances(updatedInstances, previousState.activeScreen);
    return {
      ...previousState,
      instances: updatedInstances,
    };
  }

  if (event.type === 'REMOVE_WIDGET') {
    const current = previousState.instances || [];
    if (current.length > 1) {
      const updatedInstances = current.filter((i) => i.id !== event.instanceId);
      saveInstances(updatedInstances, previousState.activeScreen);
      return {
        ...previousState,
        instances: updatedInstances,
      };
    } else {
      const wid = event.widgetId || 'cava-widget-index-jsx';
      run(`osascript -e 'tell application id "tracesOf.Uebersicht" to set hidden of widget id "${wid}" to true'`);
      return previousState;
    }
  }

  if (event.type === 'ORDER_CHANGED') {
    return {
      ...previousState,
      orderTick: Date.now(),
    };
  }

  return previousState;
};

let currentDispatch = null;

initWidgetDesktopSync({
  widgetName: 'cava',
  helperCommand: `"$HOME/Library/Application Support/Übersicht/widgets/cava.widget/menu_helper" --screens 2>/dev/null || "./cava.widget/menu_helper" --screens 2>/dev/null`,
  run,
  getDispatch: () => currentDispatch,
  onSyncPacket: (data, dispatch) => {
    if (data.type === 'ACTIVE_SCREEN_CHANGED') {
      dispatch({
        type: 'SYNC_ACTIVE_SCREEN',
        activeScreen: data.activeScreen,
        instances: data.instances,
        x: data.x,
        y: data.y,
      });
    } else if (data.type === 'CROSS_SCREEN_DRAG_PREVIEW') {
      dispatch({
        type: 'CROSS_SCREEN_DRAG_PREVIEW',
        preview: data.preview,
      });
    }
  },
});

export const render = (state, dispatch) => {
  currentDispatch = dispatch;
  const currentScreenId = getScreenId();
  const activeScreen = state?.activeScreen || getActiveScreen();
  const isCurrentActive = isScreenActive(currentScreenId, activeScreen);
  const preview = state?.crossScreenPreview;

  if (!isCurrentActive && (!preview || preview.targetScreen !== currentScreenId)) {
    return <div style={{ display: 'none' }} />;
  }

  if (!isCurrentActive && preview && preview.targetScreen === currentScreenId) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          transform: `translate3d(${preview.x}px, ${preview.y}px, 0)`,
          width: `${preview.w}px`,
          height: `${preview.h}px`,
          borderRadius: '16px',
          backgroundColor: theme.bg,
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1.5px solid rgba(255, 255, 255, 0.28)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      />
    );
  }

  const {
    enableSnapping = true,
    bars = [],
  } = state || {};

  const instances = (state && state.instances && state.instances.length > 0)
    ? state.instances
    : [{
        id: 'default',
        x: state?.x ?? SNAP_MARGIN_X,
        y: state?.y ?? SNAP_MARGIN_TOP,
        w: state?.w ?? 380,
        h: state?.h ?? 140,
      }];

  const barsData = bars.length > 0 ? bars : new Array(DEFAULT_BARS_COUNT).fill(0);
  const minHeight = typeof settings.minBarHeightPct === 'number' ? settings.minBarHeightPct : 2;
  const bandCount = settings.bandCount || 24;
  const gradientCss = getGradientCss(theme.gradient, settings.gradientMode, bandCount);
  const gapPx = settings.barGap !== undefined ? settings.barGap : 3;
  const radiusPx = settings.barCornerRadius || 0;

  return (
    <React.Fragment>
      {instances.map((instance) => {
        const x = instance.x ?? 50;
        const y = instance.y ?? 380;
        const w = instance.w ?? 380;
        const h = instance.h ?? 140;
        const isDragging = state?.isDragging && state?.draggingInstanceId === instance.id;
        const isResizing = state?.isResizing && state?.resizingInstanceId === instance.id;

        const handleMouseDown = (e) => {
          if (e.button !== 0) return;
          if (e.target.closest('[data-no-drag="true"]')) return;

          e.preventDefault();
          dispatch({
            type: 'START_DRAG',
            instanceId: instance.id,
            clientX: e.clientX,
            clientY: e.clientY,
            startPosX: x,
            startPosY: y,
            w,
            h,
          });

          let rafId = null;
          let latestMove = null;

          const flushMove = () => {
            rafId = null;
            if (!latestMove) return;
            dispatch({
              type: 'MOVE_DRAG',
              clientX: latestMove.clientX,
              clientY: latestMove.clientY,
              bypassSnap: latestMove.bypassSnap,
            });
          };

          const onMouseMove = (moveEvent) => {
            latestMove = {
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              bypassSnap: moveEvent.metaKey || moveEvent.altKey || moveEvent.shiftKey,
            };
            if (!rafId) {
              rafId = window.requestAnimationFrame(flushMove);
            }
          };

          const onMouseUp = (upEvent) => {
            if (rafId) {
              window.cancelAnimationFrame(rafId);
              rafId = null;
            }
            dispatch({
              type: 'END_DRAG',
              clientX: upEvent.clientX,
              clientY: upEvent.clientY,
            });
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };

        const handleResizeStart = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();

          dispatch({
            type: 'START_RESIZE',
            instanceId: instance.id,
            clientX: e.clientX,
            clientY: e.clientY,
            startW: w,
            startH: h,
            startPosX: x,
            startPosY: y,
          });

          let rafId = null;
          let latestResize = null;

          const flushResize = () => {
            rafId = null;
            if (!latestResize) return;
            dispatch({
              type: 'MOVE_RESIZE',
              clientX: latestResize.clientX,
              clientY: latestResize.clientY,
              bypassSnap: latestResize.bypassSnap,
            });
          };

          const onMouseMove = (moveEvent) => {
            latestResize = {
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              bypassSnap: moveEvent.metaKey || moveEvent.altKey || moveEvent.shiftKey,
            };
            if (!rafId) {
              rafId = window.requestAnimationFrame(flushResize);
            }
          };

          const onMouseUp = () => {
            if (rafId) {
              window.cancelAnimationFrame(rafId);
              rafId = null;
            }
            dispatch({ type: 'END_RESIZE' });
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        };

        const handleContextMenu = (e) => {
          e.preventDefault();
          e.stopPropagation();

          const payload = JSON.stringify({
            instanceId: instance.id,
            enableSnapping: enableSnapping !== false,
            screenId: currentScreenId,
            x: Math.round(x),
            y: Math.round(y),
          });

          const helperPath = '$HOME/Library/Application Support/Übersicht/widgets/cava.widget/menu_helper';
          const fallbackPath = './cava.widget/menu_helper';
          const escapedPayload = payload.replace(/'/g, "'\\''");
          const cmd = `"${helperPath}" '${escapedPayload}' 2>/dev/null || "${fallbackPath}" '${escapedPayload}' 2>/dev/null`;

          run(cmd, (err, output) => {
            if (err || !output) return;
            try {
              const res = JSON.parse(output.trim());
              if (!res || !res.action) return;

              if (res.action === 'TOGGLE_SNAPPING') {
                dispatch({ type: 'TOGGLE_SNAPPING' });
              } else if (res.action === 'RESET_POSITION') {
                dispatch({ type: 'RESET_POSITION', instanceId: res.instanceId || instance.id });
              } else if (res.action === 'RELOAD_WIDGET') {
                const wid = res.widgetId || 'cava-widget-index-jsx';
                run(`osascript -e 'tell application id "tracesOf.Uebersicht" to reload widget id "${wid}"' 2>/dev/null || osascript -e 'tell application id "tracesOf.Uebersicht" to refresh'`);
              } else if (res.action === 'REMOVE_WIDGET') {
                dispatch({ type: 'REMOVE_WIDGET', instanceId: res.instanceId || instance.id, widgetId: res.widgetId || 'cava-widget-index-jsx' });
              } else if (res.action === 'DUPLICATE_WIDGET') {
                dispatch({ type: 'DUPLICATE_WIDGET', instanceId: res.instanceId || instance.id });
              } else if (res.action === 'MOVE_TO_SCREEN') {
                dispatch({ type: 'MOVE_TO_SCREEN', screenId: res.screenId, instanceId: res.instanceId || instance.id });
              } else if (res.action === 'ORDER_FRONT' || res.action === 'ORDER_FORWARD' || res.action === 'ORDER_BACKWARD' || res.action === 'ORDER_BACK') {
                reorderWidget('cava', res.action);
                dispatch({ type: 'ORDER_CHANGED' });
              }
            } catch (parseErr) {}
          });
        };

        const positionStyle = {
          position: 'fixed',
          top: 0,
          left: 0,
          transform: `translate3d(${x}px, ${y}px, 0)`,
          willChange: isDragging || isResizing ? 'transform, width, height' : 'auto',
          width: `${w}px`,
          height: `${h}px`,
          zIndex: isDragging ? 9999 : getWidgetZIndex('cava'),
          cursor: isDragging ? 'grabbing' : isResizing ? 'se-resize' : 'grab',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          boxSizing: 'border-box',
        };

        return (
          <div key={instance.id} style={positionStyle} onMouseDown={handleMouseDown} onContextMenu={handleContextMenu}>
            <div style={windowStyle}>
              {settings.showTitleBar && (
                <div style={titleBarStyle}>
                  <div style={trafficLightsStyle}>
                    <span style={{ ...dotStyle, backgroundColor: '#ff5f56' }} />
                    <span style={{ ...dotStyle, backgroundColor: '#ffbd2e' }} />
                    <span style={{ ...dotStyle, backgroundColor: '#27c93f' }} />
                  </div>
                  <div style={titleTextStyle}>{settings.title || 'cava'}</div>
                  <div style={statusLabelStyle}>tap</div>
                </div>
              )}

              <div style={terminalBodyStyle}>
                <div style={{ ...barsContainerStyle, gap: `${gapPx}px` }}>
                  {barsData.map((val, idx) => {
                    const heightPct = Math.max(minHeight, Math.min(100, val));
                    const clipTop = (100 - heightPct).toFixed(2);
                    const clipStyle = radiusPx > 0
                      ? `inset(${clipTop}% 0 0 0 round ${radiusPx}px ${radiusPx}px 0 0)`
                      : `inset(${clipTop}% 0 0 0)`;

                    return (
                      <div key={idx} style={barColumnStyle}>
                        <div
                          style={{
                            ...barFillStyle,
                            background: gradientCss,
                            clipPath: clipStyle,
                            WebkitClipPath: clipStyle,
                            filter: settings.enableGlow
                              ? `drop-shadow(0 0 4px ${theme.gradient[0] || '#59cc33'})`
                              : 'none',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                data-no-drag="true"
                style={resizeHandleStyle}
                onMouseDown={handleResizeStart}
                title="Drag to resize"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="8" cy="8" r="1" fill="rgba(255,255,255,0.35)" />
                  <circle cx="8" cy="4" r="1" fill="rgba(255,255,255,0.35)" />
                  <circle cx="4" cy="8" r="1" fill="rgba(255,255,255,0.35)" />
                </svg>
              </div>
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
};

export const className = `
  font-family: -apple-system, BlinkMacSystemFont, "SF Mono", Menlo, Monaco, Consolas, monospace;
`;

const windowStyle = {
  position: 'relative',
  width: '100%',
  height: '100%',
  backgroundColor: theme.bg,
  backdropFilter: 'blur(28px) saturate(180%)',
  WebkitBackdropFilter: 'blur(28px) saturate(180%)',
  borderRadius: '16px',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.3)',
  border: `1px solid ${theme.cardBorder}`,
  boxSizing: 'border-box',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const titleBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  backgroundColor: 'rgba(0, 0, 0, 0.15)',
  cursor: 'grab',
  flexShrink: 0,
};

const trafficLightsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  width: '48px',
};

const dotStyle = {
  width: '9px',
  height: '9px',
  borderRadius: '50%',
  display: 'inline-block',
};

const titleTextStyle = {
  fontSize: '11px',
  fontWeight: '600',
  color: 'rgba(252, 232, 195, 0.70)',
  letterSpacing: '0.2px',
};

const statusLabelStyle = {
  fontSize: '10px',
  color: 'rgba(252, 232, 195, 0.40)',
  width: '48px',
  textAlign: 'right',
  fontFamily: '"SF Mono", Menlo, monospace',
};

const terminalBodyStyle = {
  flex: 1,
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const barsContainerStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'space-between',
};

const barColumnStyle = {
  flex: 1,
  height: '100%',
  minWidth: '2px',
};

const barFillStyle = {
  width: '100%',
  height: '100%',
  transition: 'clip-path 0.04s ease-out, -webkit-clip-path 0.04s ease-out',
  willChange: 'clip-path',
};

const resizeHandleStyle = {
  position: 'absolute',
  bottom: 0,
  right: 0,
  width: '18px',
  height: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'se-resize',
  zIndex: 10,
};
