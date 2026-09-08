/**
 * theme.ts
 * -----------------------------------------------------------------------------
 * Design tokens for v3 "Orbit". Nothing outside this file hard-codes a colour,
 * radius, font size or spacing value.
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
 *
 * THE APP STORES NO THEME. v3 follows the system appearance and nothing else,
 * so there is no preference, no toggle and no persisted mode — see ThemeContext.
 *
 * TINTS. Dark mode needs a lighter primary/accent for text and strokes than the
 * fill colour that reads well on a light ground, so `primaryTint`, `accentTint`
 * and `errorTint` exist alongside the base. In light mode several of them
 * collapse onto a single value; that is the design's intent, not a mistake.
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
  /** Recessed fill: inactive chips, wells, skeletons. */
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
  /** The readable primary for strokes and text, especially on dark. */
  primaryTint: string;
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
  errorTint: string;
  errorPressed: string;
  errorSoft: string;

  info: string;
  infoSoft: string;

  accent: string;
  accentTint: string;
  accentSoft: string;

  /** Plate behind an illustration. */
  illustration: string;

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
 * Dark palette: soft dual-tone depth over near-black, so elevation reads as
 * surface contrast plus the neumorphic pair rather than a drop shadow.
 */
const darkColors: ThemeColors = {
  background: '#0A0E14',
  surface: '#131A23',
  surfaceRaised: '#1B2430',
  surfaceMuted: '#1A2331',
  surfaceHeader: '#0F141B',

  border: '#212C39',
  borderStrong: '#33414F',

  textPrimary: '#F8FAFC',
  textSecondary: '#AFBBCC',
  textMuted: '#7E8CA1',
  textOnAccent: '#FFFFFF',

  primary: '#4A5AE8',
  primaryTint: '#8592FF',
  primaryPressed: '#3E4CC9',
  primarySoft: '#161C3A',
  primaryBorderSoft: '#2E3A75',

  success: '#22C55E',
  successSoft: '#0D2818',
  successBorder: '#15803D',

  warning: '#F59E0B',
  warningSoft: '#2A1F08',
  warningBorder: '#B45309',

  error: '#EF4444',
  errorTint: '#F87171',
  errorPressed: '#C62F2F',
  errorSoft: '#2C1214',

  info: '#4A5AE8',
  infoSoft: '#161C3A',

  accent: '#8B5CF6',
  accentTint: '#A78BFA',
  accentSoft: '#1D1533',

  illustration: '#101821',

  tabBar: '#0F141B',
  tabBarBorder: '#1C2431',
  tabActive: '#8592FF',
  tabInactive: '#7E8CA1',

  skeleton: '#1B2430',
  scrim: 'rgba(0,0,0,0.66)',
};

/** Light palette: cool grey ground so the near-white cards can lift off it. */
const lightColors: ThemeColors = {
  background: '#EFF2F7',
  surface: '#FBFCFE',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#E7ECF3',
  surfaceHeader: '#FBFCFE',

  border: '#E2E7EF',
  borderStrong: '#C7D0DD',

  textPrimary: '#0F1729',
  textSecondary: '#3A4658',
  textMuted: '#5B6879',
  textOnAccent: '#FFFFFF',

  primary: '#3349D8',
  primaryTint: '#3349D8',
  primaryPressed: '#2A3CB4',
  primarySoft: '#EBEFFE',
  primaryBorderSoft: '#C3CEFB',

  success: '#07734F',
  successSoft: '#E3F8F0',
  successBorder: '#9BE0C8',

  warning: '#8F5602',
  warningSoft: '#FDF6E3',
  warningBorder: '#EBCF8A',

  error: '#E02424',
  errorTint: '#C81E1E',
  errorPressed: '#B91C1C',
  errorSoft: '#FDECEC',

  info: '#3349D8',
  infoSoft: '#EBEFFE',

  accent: '#7C5CE0',
  accentTint: '#6742C8',
  accentSoft: '#F0EBFC',

  illustration: '#FBFCFE',

  tabBar: '#FBFCFE',
  tabBarBorder: '#E4E9F0',
  tabActive: '#3349D8',
  tabInactive: '#5B6879',

  skeleton: '#E7ECF3',
  scrim: 'rgba(15,23,41,0.45)',
};

/**
 * Gradient stops. Kept for the few surfaces that still ramp; v3 leans on
 * neumorphic depth rather than gradient fills.
 */
export const gradients = {
  primary: ['#4F46E5', '#7C3AED'] as const,
  success: ['#16A34A', '#22C55E'] as const,
  avatar: ['#6366F1', '#8B5CF6'] as const,
};

/* =============================================================================
 * SPACING
 * ========================================================================== */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  x3: 3,
  x5: 5,
  x6: 6,
  x7: 7,
  x9: 9,
  x10: 10,
  x13: 13,
  x14: 14,
  x18: 18,
  x22: 22,
  x26: 26,
  x28: 28,
  x30: 30,
  x34: 34,
} as const;

/** Horizontal gutter for every screen. One value, used everywhere. */
export const SCREEN_PADDING = 20;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
  tile: 11,
  control: 14,
  card: 18,
  hero: 20,
  radar: 22,
} as const;

export const CARD_RADIUS = radius.card;
export const BUTTON_RADIUS = radius.control;

export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

/* =============================================================================
 * TYPOGRAPHY
 * -----------------------------------------------------------------------------
 * Three real families, loaded at startup by AttendanceApp. Android ignores
 * numeric fontWeight on a custom family, so weight is selected by FAMILY NAME
 * and `fontWeight` is never set alongside one.
 * ========================================================================== */

export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
  /** Figures: clocks, counts, rates, RSSI. */
  numMedium: 'SpaceGrotesk_500Medium',
  numSemibold: 'SpaceGrotesk_600SemiBold',
  numBold: 'SpaceGrotesk_700Bold',
  /** Identifiers and diagnostics. Never body copy. */
  mono: 'IBMPlexMono_400Regular',
} as const;

/** The font asset map handed to `useFonts`. */
export { FONT_ASSETS } from './fonts';

export const fonts = {
  /** Kept for callers that ask for a monospace face by name. */
  mono: Platform.select({
    android: fontFamily.mono,
    ios: fontFamily.mono,
    default: fontFamily.mono,
  }) as string,
};

/**
 * Every text role in the approved design, measured from it.
 *
 * lineHeight is set ONLY where the design declares one — imposing one on the
 * ~80% of text that leaves it at browser-normal would grow every vertical
 * rhythm the layout was measured against.
 */
export const typography = {
  /** Page title: "History", "Employees". */
  display: { fontFamily: fontFamily.bold, fontSize: 26, letterSpacing: -0.7, lineHeight: 34 },
  /** The line under a page title. */
  subtitle: { fontFamily: fontFamily.regular, fontSize: 13 },
  /** Identity name on a hero header. */
  identity: { fontFamily: fontFamily.bold, fontSize: 21, letterSpacing: -0.4, lineHeight: 28 },
  /** The one hero word per screen. */
  hero: { fontFamily: fontFamily.extrabold, fontSize: 30, letterSpacing: -0.9, lineHeight: 34.5 },
  /** A big figure. */
  metric: { fontFamily: fontFamily.numBold, fontSize: 30, letterSpacing: -1, lineHeight: 38 },
  /** The count inside a StatTile. */
  statNumber: { fontFamily: fontFamily.numBold, fontSize: 27, letterSpacing: -1, lineHeight: 34 },
  /** Section title: "Today", "In range now". */
  title: { fontFamily: fontFamily.bold, fontSize: 16 },
  /** Card title and list-row name. */
  heading: { fontFamily: fontFamily.semibold, fontSize: 14.5 },
  /** Default body. */
  body: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19.5 },
  bodyMedium: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 19.5 },
  bodyStrong: { fontFamily: fontFamily.bold, fontSize: 13.5 },
  /** The explanatory paragraph under a heading. */
  paragraph: { fontFamily: fontFamily.regular, fontSize: 14.5, lineHeight: 21.75 },
  /** Secondary text under a title. */
  caption: { fontFamily: fontFamily.regular, fontSize: 12.5, lineHeight: 18.75 },
  captionMedium: { fontFamily: fontFamily.medium, fontSize: 12.5 },
  /** Status labels. */
  label: { fontFamily: fontFamily.bold, fontSize: 11, letterSpacing: 0.3 },
  /** ALL-CAPS eyebrow above a value. */
  overline: { fontFamily: fontFamily.bold, fontSize: 10.5, letterSpacing: 0.8 },
  /** The label above a grouped card. */
  groupLabel: { fontFamily: fontFamily.extrabold, fontSize: 10, letterSpacing: 1 },
  /** Bottom tab bar. */
  tabLabel: { fontFamily: fontFamily.bold, fontSize: 10.5, letterSpacing: 0.2 },
  /** Empty-state title. */
  emptyTitle: { fontFamily: fontFamily.bold, fontSize: 17, letterSpacing: -0.3, lineHeight: 23 },
  /** Empty-state body. */
  emptyBody: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 20.15 },
  /** The orbit node captions. */
  orbitNode: { fontFamily: fontFamily.extrabold, fontSize: 10, letterSpacing: 0.9 },
};

/** Space Grotesk carries tabular figures, which is why the design chose it. */
export const numeric = { fontVariant: ['tabular-nums' as const] };

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  fonts: typeof fonts;
  iconSize: typeof iconSize;
  screenPadding: number;
  cardRadius: number;
  buttonRadius: number;
  shadow: (level: 1 | 2 | 3) => object;
  /**
   * The raised half of the neumorphic pair.
   *
   * The design casts two shadows — a dark one down-right and a light one
   * up-left. React Native gives a view exactly one shadow, so this renders the
   * dark side; the light side is carried by the surface being lighter than the
   * ground, which both palettes already arrange.
   */
  neu: object;
  /**
   * The recessed well. React Native has no inset shadow at all, so a well is
   * expressed the way the design's own level-0 node already does it: the muted
   * fill with a hairline border, one step darker than the surface around it.
   */
  neuIn: (colors: ThemeColors) => object;
}

function makeShadow(mode: ThemeMode) {
  return (level: 1 | 2 | 3) => {
    if (mode === 'dark') {
      // Shadows read as muddy smears on dark grounds; depth comes from surface
      // contrast and hairlines instead.
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

function makeNeu(mode: ThemeMode) {
  return mode === 'dark'
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 7, height: 7 },
        shadowOpacity: 0.55,
        shadowRadius: 18,
        elevation: 8,
      }
    : {
        shadowColor: '#0F1729',
        shadowOffset: { width: 7, height: 7 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 4,
      };
}

function makeNeuIn(colors: ThemeColors) {
  return {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  };
}

export function buildTheme(mode: ThemeMode): Theme {
  const colors = mode === 'dark' ? darkColors : lightColors;
  return {
    mode,
    colors,
    spacing,
    radius,
    typography,
    fontFamily,
    fonts,
    iconSize,
    screenPadding: SCREEN_PADDING,
    cardRadius: CARD_RADIUS,
    buttonRadius: BUTTON_RADIUS,
    shadow: makeShadow(mode),
    neu: makeNeu(mode),
    neuIn: makeNeuIn,
  };
}

export const darkTheme = buildTheme('dark');
export const lightTheme = buildTheme('light');
