/**
 * theme.ts
 * -----------------------------------------------------------------------------
 * Design tokens. Nothing outside this file hard-codes a colour, radius, font
 * size or spacing value.
 *
 * SEMANTIC COLOUR RULES (deliberate, not decorative)
 *
 *   indigo  primary actions, navigation, brand
 *   green   PRESENT / active / healthy
 *   amber   LEFT / warning / needs attention
 *   slate   ABSENT / idle / neutral
 *   red     DESTRUCTIVE ACTIONS AND ERRORS ONLY
 *
 * ABSENT uses slate, never red: an employee who has not arrived yet has done
 * nothing wrong, and colouring it red would misrepresent the data. LEFT uses
 * amber rather than red for the same reason - they attended.
 * -----------------------------------------------------------------------------
 */

import { Platform } from 'react-native';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  /** Furthest-back app background. */
  background: string;
  /** Card / raised surface. */
  surface: string;
  /** One step further raised: nested cards, inputs, chips. */
  surfaceRaised: string;
  /** Subtle fill for inactive chips and skeletons. */
  surfaceMuted: string;
  /** Header / hero band behind the greeting. */
  surfaceHeader: string;

  border: string;
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Text on a saturated accent fill. */
  textOnAccent: string;

  primary: string;
  primaryPressed: string;
  primarySoft: string;
  primaryBorderSoft: string;

  success: string;
  successSoft: string;
  successBorder: string;

  warning: string;
  warningSoft: string;
  warningBorder: string;

  error: string;
  errorPressed: string;
  errorSoft: string;

  info: string;
  infoSoft: string;

  accent: string;
  accentSoft: string;

  /** Bottom tab bar. */
  tabBar: string;
  tabBarBorder: string;
  tabActive: string;
  tabInactive: string;

  skeleton: string;
  /** Scrim behind modals. */
  scrim: string;
}

/**
 * Dark palette: near-black slate rather than pure black, so elevation reads as
 * surface contrast. Indigo primary keeps it enterprise rather than consumer.
 */
const darkColors: ThemeColors = {
  background: '#0A0E14',
  surface: '#131A23',
  surfaceRaised: '#1B2430',
  surfaceMuted: '#232E3C',
  surfaceHeader: '#0F141B',

  border: '#212C39',
  borderStrong: '#33414F',

  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textOnAccent: '#FFFFFF',

  primary: '#5B6CFF',
  primaryPressed: '#4A59E0',
  primarySoft: '#161C3A',
  primaryBorderSoft: '#2E3A75',

  // Brighter, more saturated green than a muted teal — the mockup uses green as
  // the hero colour for PRESENT and it has to read as confident, not tentative.
  success: '#22C55E',
  successSoft: '#0D2818',
  successBorder: '#15803D',

  warning: '#F59E0B',
  warningSoft: '#2A1F08',
  warningBorder: '#B45309',

  error: '#EF4444',
  errorPressed: '#C62F2F',
  errorSoft: '#2C1214',

  info: '#5B6CFF',
  infoSoft: '#161C3A',

  accent: '#8B5CF6',
  accentSoft: '#1C1533',

  tabBar: '#0F141B',
  tabBarBorder: '#1C2431',
  tabActive: '#22C55E',
  tabInactive: '#64748B',

  skeleton: '#1B2430',
  scrim: 'rgba(0,0,0,0.66)',
};

/**
 * Gradient stops for primary call-to-action buttons: indigo into violet.
 * Rendered by <Gradient/> as interpolated slices, so no native module and no
 * extra dependency is involved.
 */
export const gradients = {
  primary: ['#4F46E5', '#7C3AED'] as const,
  success: ['#16A34A', '#22C55E'] as const,
  avatar: ['#6366F1', '#8B5CF6'] as const,
};

/** Light palette: cool grey ground so white cards lift off it. */
const lightColors: ThemeColors = {
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#EEF1F6',
  surfaceHeader: '#FFFFFF',

  border: '#E2E7EF',
  borderStrong: '#C7D0DD',

  textPrimary: '#0F1729',
  textSecondary: '#4B5768',
  textMuted: '#7A8698',
  textOnAccent: '#FFFFFF',

  primary: '#3D5AF1',
  primaryPressed: '#2F49CC',
  primarySoft: '#EBEFFE',
  primaryBorderSoft: '#C3CEFB',

  success: '#0E9F6E',
  successSoft: '#E3F8F0',
  successBorder: '#9BE0C8',

  warning: '#C27803',
  warningSoft: '#FDF6E3',
  warningBorder: '#EBCF8A',

  error: '#E02424',
  errorPressed: '#B91C1C',
  errorSoft: '#FDECEC',

  info: '#3D5AF1',
  infoSoft: '#EBEFFE',

  accent: '#7C5CE0',
  accentSoft: '#F0EBFC',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E4E9F0',
  tabActive: '#3D5AF1',
  tabInactive: '#8494A8',

  skeleton: '#E7ECF3',
  scrim: 'rgba(15,23,41,0.45)',
};

/* =============================================================================
 * SPACING — a 4pt scale. Only these values are used anywhere.
 * ========================================================================== */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Horizontal gutter for every screen. One value, used everywhere. */
export const SCREEN_PADDING = 20;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const CARD_RADIUS = radius.lg;
export const BUTTON_RADIUS = radius.md;

export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

/* =============================================================================
 * TYPOGRAPHY
 * -----------------------------------------------------------------------------
 * Weights are used sparingly: bold is reserved for numbers and page titles, so
 * it still means something when it appears.
 * ========================================================================== */

export const fonts = {
  /** Diagnostics only - RSSI, UUIDs, IDs, log lines. Never body copy. */
  mono: Platform.select({
    android: 'monospace',
    ios: 'Menlo',
    default: 'monospace',
  }) as string,
};

export const typography = {
  /** Page title, e.g. "Attendance". */
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 34 },
  /** Big metric numbers. */
  metric: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.8, lineHeight: 36 },
  /**
   * The count inside a StatTile. Tabular-width digits are not available without
   * a custom font, so counts are zero-padded at the call site instead to stop
   * the tiles shifting as values cross 9/10.
   */
  statNumber: { fontSize: 32, fontWeight: '700' as const, letterSpacing: -1, lineHeight: 38 },
  /** The hero PRESENT/ABSENT word on the employee home card. */
  hero: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6, lineHeight: 36 },
  /** Section title. */
  title: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 25 },
  /** Card title. */
  heading: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
  /** Default body. */
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, lineHeight: 21 },
  /** Secondary text under a title. */
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  captionMedium: { fontSize: 13, fontWeight: '500' as const, lineHeight: 18 },
  /** Status labels and eyebrow headings. */
  label: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4, lineHeight: 16 },
  /** ALL-CAPS eyebrow. */
  overline: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.9, lineHeight: 14 },
};

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fonts: typeof fonts;
  iconSize: typeof iconSize;
  screenPadding: number;
  cardRadius: number;
  buttonRadius: number;
  shadow: (level: 1 | 2 | 3) => object;
}

function makeShadow(mode: ThemeMode) {
  return (level: 1 | 2 | 3) => {
    // Shadows read as muddy smears on dark backgrounds, so dark mode uses
    // surface contrast and hairline borders for depth instead.
    if (mode === 'dark') {
      return { elevation: level };
    }
    const map = {
      1: { elevation: 1, shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      2: { elevation: 2, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
      3: { elevation: 5, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
    };
    return { shadowColor: '#0F1729', ...map[level] };
  };
}

export function buildTheme(mode: ThemeMode): Theme {
  return {
    mode,
    colors: mode === 'dark' ? darkColors : lightColors,
    spacing,
    radius,
    typography,
    fonts,
    iconSize,
    screenPadding: SCREEN_PADDING,
    cardRadius: CARD_RADIUS,
    buttonRadius: BUTTON_RADIUS,
    shadow: makeShadow(mode),
  };
}

export const darkTheme = buildTheme('dark');
export const lightTheme = buildTheme('light');
