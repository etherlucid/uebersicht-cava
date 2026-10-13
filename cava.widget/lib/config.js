// CAVA Widget Configuration
// Edit colors, gradient stops, and visualizer settings here.

export const theme = {
  // Window frame appearance (matches your iTerm2 Gruvbox profile)
  bg: 'rgba(28, 27, 25, 0.90)',
  cardBorder: 'rgba(255, 255, 255, 0.12)',

  // Color gradient stops (matching ~/.config/cava/config)
  // Ordered from bottom (low amplitude) to top (peak amplitude)
  gradient: [
    '#59cc33', // 1: Green base
    '#80cc33', // 2
    '#a6cc33', // 3
    '#cccc33', // 4: Yellow mid
    '#cca633', // 5
    '#cc8033', // 6
    '#cc5933', // 7
    '#cc3333', // 8: Red peak
  ],

  // Glow shadow behind active bars (only applied when settings.enableGlow is true)
  barGlow: '0 0 6px rgba(89, 204, 51, 0.35)',
};

export const settings = {
  // Title bar
  showTitleBar: false, // Set to true to restore the window titlebar

  // Gradient style: 'banded' for sharp discrete terminal row steps, 'smooth' for continuous blend
  gradientMode: 'banded',

  // Number of discrete horizontal color bands (terminal character lines)
  // In terminal CAVA, the gradient stops are interpolated row-by-row across the terminal height.
  bandCount: 24,

  // Glow effect: set to true to enable outer glow around bars
  enableGlow: false,

  // Bar corner radius in px: 0 for sharp terminal blocks, or 1-2 for rounded tops
  barCornerRadius: 0,

  // Visualizer bars
  barsCount: 28,      // Number of frequency bars
  barGap: 3,          // Gap in pixels between bars
  minBarHeightPct: 2, // Height percentage of idle bar heads (set to 0 for no idle bar)
};

export default { theme, settings };
