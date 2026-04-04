// ── Central theme design tokens ─────────────────────────────────────────────
// Single source of truth for all colors used across the UI.
// Import T, D, dk, and antdTokens from here instead of duplicating per-file.

// Light theme tokens
export const T = {
  // Brand
  orange:       '#F97316',
  orangeLight:  '#FFF7ED',
  orangeBorder: '#FDBA74',

  // Stone palette (Tailwind stone)
  stone50:  '#FAFAF9',
  stone100: '#F5F5F4',
  stone200: '#E7E5E4',
  stone300: '#D6D3D1',
  stone400: '#A8A29E',
  stone500: '#78716C',
  stone600: '#57534E',
  stone700: '#44403C',
  stone800: '#292524',
  stone900: '#1C1917',

  white: '#FFFFFF',

  // Semantic – light backgrounds
  red:        '#DC2626',
  redLight:   '#FEF2F2',
  redBorder:  '#FECACA',

  green:       '#16A34A',
  greenLight:  '#F0FDF4',
  greenBorder: '#BBF7D0',

  blue:      '#2563EB',
  blueLight: '#EFF6FF',
  blueBorder: '#BFDBFE',

  amber:       '#D97706',
  amberLight:  '#FFFBEB',
  amberBorder: '#FDE68A',

  purple:       '#7C3AED',
  purpleLight:  '#F5F3FF',
  purpleBorder: '#DDD6FE',

  teal:       '#0891B2',
  tealLight:  '#ECFEFF',
  tealBorder: '#A5F3FC',

  // Severity scale (used by SEVERITY_CONFIG, STRIDE, risk bars)
  orangeHigh:       '#EA580C',  // "high" severity — orange-600
  orangeHighLight:  '#FFF7ED',
  orangeHighBorder: '#FED7AA',

  lime:       '#65A30D',  // "low" severity — lime-600
  limeLight:  '#F7FEE7',
  limeBorder: '#D9F99D',

  gray:       '#6B7280',  // "info" severity — gray-500
  grayLight:  '#F9FAFB',
  grayBorder: '#E5E7EB',

  // STRIDE category accent colors
  pink:   '#DB2777',  // ElevationOfPrivilege
  indigo: '#4338CA',  // SERVICE trust boundary
  violet: '#7E22CE',  // IDENTITY trust boundary

  // Misc semantic
  emerald:       '#059669',  // encrypted / success variant
  emeraldLight:  '#ECFDF5',
  emeraldBorder: 'rgba(16,185,129,0.3)',
  cyan:       '#06b6d4',  // encrypted data flow
};

// Dark theme tokens
export const D = {
  bg:         '#1C1917',
  bgSub:      '#211F1E',
  bgCard:     '#292524',
  bgHover:    '#332E2B',
  border:     '#292524',
  borderSub:  '#3C3836',
  text:       '#F5F5F4',
  textMuted:  '#A8A29E',
  textFaint:  '#57534E',

  orangeLight:  'rgba(249,115,22,0.12)',
  orangeBorder: 'rgba(249,115,22,0.3)',
  blueLight:    'rgba(37,99,235,0.15)',
  blueBorder:   'rgba(37,99,235,0.3)',
  redLight:     'rgba(220,38,38,0.15)',
  redBorder:    'rgba(220,38,38,0.3)',
  greenLight:   'rgba(22,163,74,0.15)',
  greenBorder:  'rgba(22,163,74,0.3)',
  amberLight:   'rgba(217,119,6,0.15)',
  amberBorder:  'rgba(217,119,6,0.3)',

  purpleLight:  'rgba(124,58,237,0.15)',
  purpleBorder: 'rgba(124,58,237,0.3)',

  tealLight:  'rgba(8,145,178,0.15)',
  tealBorder: 'rgba(8,145,178,0.3)',

  orangeHighLight:  'rgba(234,88,12,0.12)',
  orangeHighBorder: 'rgba(234,88,12,0.3)',
  limeLight:  'rgba(101,163,13,0.12)',
  limeBorder: 'rgba(101,163,13,0.3)',
};

// Helper: pick dark or light value based on current theme
export const dk = (isDark: boolean, light: string, dark: string): string =>
  isDark ? dark : light;

// Ant Design ConfigProvider token overrides
export const antdTokens = {
  colorPrimary:    T.orange,
  colorLink:       T.orange,
  colorLinkHover:  '#fb923c',
  colorLinkActive: '#ea6c0a',
};
