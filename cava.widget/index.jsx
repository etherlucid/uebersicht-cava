import { React } from 'uebersicht';
import { theme, settings } from './lib/config.js';

export const refreshFrequency = 60; // Poll bridge every 60ms (~16 FPS)

export const command = `python3 "$HOME/Library/Application Support/Übersicht/widgets/cava.widget/cava_bridge.py" 2>/dev/null || python3 "cava.widget/cava_bridge.py" 2>/dev/null`;

const POS_KEY = 'cava_widget_position';
const SIZE_KEY = 'cava_widget_size';
const SCREEN_MARGIN = 2;
const DEFAULT_BARS_COUNT = settings.barsCount || 28;

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

// CAVA terminal color interpolation:
// Interpolates gradient stops row-by-row across totalBands (terminal lines)
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

  // Smooth gradient
  return `linear-gradient(to top, ${colors.join(', ')})`;
}

const getInitialPosition = () => {
  try {
    const saved = localStorage.getItem(POS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        const maxX = Math.max(SCREEN_MARGIN, (window.innerWidth || 1920) - 380);
        const maxY = Math.max(SCREEN_MARGIN, (window.innerHeight || 1080) - 140);
        return {
          x: Math.max(SCREEN_MARGIN, Math.min(maxX, parsed.x)),
          y: Math.max(SCREEN_MARGIN, Math.min(maxY, parsed.y)),
        };
      }
    }
  } catch (e) {}
  return { x: 50, y: 380 };
};

const getInitialSize = () => {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.w === 'number' && typeof parsed.h === 'number') {
        return {
          w: Math.max(180, Math.min((window.innerWidth || 1920) - 20, parsed.w)),
          h: Math.max(70, Math.min((window.innerHeight || 1080) - 20, parsed.h)),
        };
      }
    }
  } catch (e) {}
  return { w: 380, h: 140 };
};

const initialPos = getInitialPosition();
const initialSize = getInitialSize();

export const initialState = {
  x: initialPos.x,
  y: initialPos.y,
  w: initialSize.w,
  h: initialSize.h,
  isDragging: false,
  isResizing: false,
  dragStartX: 0,
  dragStartY: 0,
  startPosX: 0,
  startPosY: 0,
  resizeStartX: 0,
  resizeStartY: 0,
  startW: 0,
  startH: 0,
  bars: new Array(DEFAULT_BARS_COUNT).fill(0),
};

export const updateState = (event, previousState) => {
  if (!previousState) return initialState;

  // Handle stdout from cava_bridge.py
  if (event.output && typeof event.output === 'string') {
    const parts = event.output.trim().split(';').filter(Boolean);
    if (parts.length > 0) {
      const parsedBars = parts.map((val) => {
        const num = parseInt(val, 10);
        return isNaN(num) ? 0 : Math.max(0, Math.min(100, num));
      });
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
      dragStartX: event.clientX,
      dragStartY: event.clientY,
      startPosX: previousState.x,
      startPosY: previousState.y,
    };
  }

  if (event.type === 'MOVE_DRAG' && previousState.isDragging) {
    const deltaX = event.clientX - previousState.dragStartX;
    const deltaY = event.clientY - previousState.dragStartY;
    const maxX = Math.max(SCREEN_MARGIN, window.innerWidth - previousState.w - SCREEN_MARGIN);
    const maxY = Math.max(SCREEN_MARGIN, window.innerHeight - previousState.h - SCREEN_MARGIN);

    const newX = Math.max(SCREEN_MARGIN, Math.min(maxX, previousState.startPosX + deltaX));
    const newY = Math.max(SCREEN_MARGIN, Math.min(maxY, previousState.startPosY + deltaY));

    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x: newX, y: newY }));
    } catch (e) {}

    return {
      ...previousState,
      x: newX,
      y: newY,
    };
  }

  if (event.type === 'END_DRAG') {
    return {
      ...previousState,
      isDragging: false,
    };
  }

  if (event.type === 'START_RESIZE') {
    return {
      ...previousState,
      isResizing: true,
      resizeStartX: event.clientX,
      resizeStartY: event.clientY,
      startW: previousState.w,
      startH: previousState.h,
    };
  }

  if (event.type === 'MOVE_RESIZE' && previousState.isResizing) {
    const deltaW = event.clientX - previousState.resizeStartX;
    const deltaH = event.clientY - previousState.resizeStartY;

    const maxW = Math.max(180, window.innerWidth - previousState.x - SCREEN_MARGIN);
    const maxH = Math.max(70, window.innerHeight - previousState.y - SCREEN_MARGIN);

    const newW = Math.max(180, Math.min(maxW, previousState.startW + deltaW));
    const newH = Math.max(70, Math.min(maxH, previousState.startH + deltaH));

    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify({ w: newW, h: newH }));
    } catch (e) {}

    return {
      ...previousState,
      w: newW,
      h: newH,
    };
  }

  if (event.type === 'END_RESIZE') {
    return {
      ...previousState,
      isResizing: false,
    };
  }

  return previousState;
};

export const render = (state, dispatch) => {
  const {
    x = 50,
    y = 380,
    w = 380,
    h = 140,
    isDragging,
    isResizing,
    bars = [],
  } = state || {};

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-no-drag="true"]')) return;

    e.preventDefault();
    dispatch({ type: 'START_DRAG', clientX: e.clientX, clientY: e.clientY });

    const onMouseMove = (moveEvent) => {
      dispatch({ type: 'MOVE_DRAG', clientX: moveEvent.clientX, clientY: moveEvent.clientY });
    };

    const onMouseUp = () => {
      dispatch({ type: 'END_DRAG' });
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

    dispatch({ type: 'START_RESIZE', clientX: e.clientX, clientY: e.clientY });

    const onMouseMove = (moveEvent) => {
      dispatch({ type: 'MOVE_RESIZE', clientX: moveEvent.clientX, clientY: moveEvent.clientY });
    };

    const onMouseUp = () => {
      dispatch({ type: 'END_RESIZE' });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const positionStyle = {
    position: 'absolute',
    top: `${y}px`,
    left: `${x}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: 997,
    cursor: isDragging ? 'grabbing' : isResizing ? 'se-resize' : 'grab',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    boxSizing: 'border-box',
  };

  const barsData = bars.length > 0 ? bars : new Array(DEFAULT_BARS_COUNT).fill(0);
  const minHeight = typeof settings.minBarHeightPct === 'number' ? settings.minBarHeightPct : 2;
  const bandCount = settings.bandCount || 24;
  const gradientCss = getGradientCss(theme.gradient, settings.gradientMode, bandCount);
  const gapPx = settings.barGap !== undefined ? settings.barGap : 3;
  const radiusPx = settings.barCornerRadius || 0;

  return (
    <div style={positionStyle} onMouseDown={handleMouseDown}>
      <div style={windowStyle}>
        {/* Optional Title Bar (hidden by default) */}
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

        {/* Terminal Visualizer Body with Fixed Vertical Row-Banded Regions */}
        <div style={terminalBodyStyle}>
          <div style={{ ...barsContainerStyle, gap: `${gapPx}px` }}>
            {barsData.map((val, idx) => {
              // Calculate clipped percentage from top:
              // Fixed gradient spans 100% of height across all interpolated terminal rows.
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

        {/* Resize Handle */}
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
  transition: 'clip-path 0.055s ease-out, -webkit-clip-path 0.055s ease-out',
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
