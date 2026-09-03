/**
 * Design tokens.
 *
 * The look this encodes: dark, spatial, calm. A conference hall is dim, the
 * phone is out for hours, and the thing on screen is a live radar of real
 * people — so the canvas recedes and the people are the only bright objects on
 * it. Colour is reserved for presence, category and action; everything else is
 * a neutral. That is the whole system.
 *
 * Both themes are first-class. Every colour below is defined per theme —
 * including the map canvas, which is deep in dark and a tinted grey in light so
 * the radar always reads as a surface you are looking into rather than a hole
 * or a sheet of paper. The only shared values are the presence colours, because
 * green/amber/red must mean the same thing in any light.
 */

import { Platform } from 'react-native';

export type ThemeName = 'dark' | 'light';

export interface Palette {
  /** App background. */
  background: string;
  /** Cards, sheets, bars. */
  surface: string;
  surfaceElevated: string;
  surfaceSunken: string;
  /** Hairlines and dividers. */
  border: string;
  borderStrong: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;

  /** The single accent. Used for the user, primary actions and selection. */
  accent: string;
  accentSoft: string;
  accentText: string;

  /** Presence. */
  available: string;
  maybe: string;
  busy: string;
  offline: string;

  danger: string;
  warning: string;
  success: string;

  /** Map-only colours; identical in both themes so the radar always reads. */
  mapCanvas: string;
  mapGrid: string;
  mapRing: string;
  mapZone: string;
  mapZoneText: string;
  mapGlow: string;
  /** Plate behind a person's name on the map. Quiet, borderless. */
  mapLabel: string;

  scrim: string;
}

/**
 * Presence colours are shared: green/amber/red mean the same thing whatever the
 * ambient light, and re-hueing them per theme would break the one piece of
 * colour the user has to read instantly.
 */
const presence = {
  maybe: '#F5C451',
  busy: '#FF6B6B',
  offline: '#6B7280',
  warning: '#F5C451',
};

export const palettes: Record<ThemeName, Palette> = {
  /**
   * Values from the EventPulse design system (Figma, "Product Design Refresh").
   * Background, surface, accent, muted and danger are taken verbatim; the rest
   * are derived to sit consistently between them.
   */
  dark: {
    ...presence,
    background: '#070B1B',
    surface: '#18212C',
    surfaceElevated: '#212C39',
    surfaceSunken: '#0E1622',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    textPrimary: '#EEF2F6',
    textSecondary: '#8D9AAA',
    textTertiary: 'rgba(141, 154, 170, 0.62)',
    textInverse: '#070B1B',
    accent: '#52D3AA',
    accentSoft: 'rgba(82, 211, 170, 0.14)',
    accentText: '#05261C',
    available: '#52D3AA',
    danger: '#FF6B6B',
    success: '#52D3AA',
    scrim: 'rgba(3, 5, 12, 0.66)',

    // "Map is the hero" — the canvas is the background itself, so nothing
    // frames the radar and avatars are the only lit objects on it.
    mapCanvas: '#070B1B',
    mapGrid: 'rgba(255, 255, 255, 0.035)',
    mapRing: 'rgba(255, 255, 255, 0.07)',
    mapZone: 'rgba(255, 255, 255, 0.05)',
    mapZoneText: 'rgba(141, 154, 170, 0.55)',
    mapGlow: 'rgba(82, 211, 170, 0.18)',
    mapLabel: 'rgba(7, 11, 27, 0.74)',
  },
  light: {
    ...presence,
    background: '#F6F8FA',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceSunken: '#EDF1F5',
    border: 'rgba(10, 15, 20, 0.09)',
    borderStrong: 'rgba(10, 15, 20, 0.18)',
    textPrimary: '#0D141A',
    textSecondary: 'rgba(13, 20, 26, 0.64)',
    textTertiary: 'rgba(13, 20, 26, 0.42)',
    textInverse: '#FFFFFF',
    // The design system is dark-only. #52D3AA on white is roughly 2.2:1, which
    // fails for text and for the accent-on-white button — the most-tapped
    // control in the app — so light keeps a darkened mint of the same family.
    accent: '#0E8F5E',
    accentSoft: 'rgba(14, 143, 94, 0.12)',
    accentText: '#FFFFFF',
    available: '#0E8F5E',
    danger: '#C7362F',
    success: '#0E8F5E',
    scrim: 'rgba(10, 15, 20, 0.42)',

    /**
     * The map canvas is *tinted*, not white.
     *
     * It sits one step below `background` so the radar still reads as a
     * distinct surface you are looking into, and so white avatar bubbles and
     * cluster pucks have something to sit on. A pure-white canvas loses every
     * one of those edges.
     */
    mapCanvas: '#E4EAF0',
    mapGrid: 'rgba(10, 15, 20, 0.045)',
    mapRing: 'rgba(10, 15, 20, 0.13)',
    mapZone: 'rgba(10, 15, 20, 0.06)',
    mapZoneText: 'rgba(13, 20, 26, 0.50)',
    mapGlow: 'rgba(14, 143, 94, 0.20)',
    mapLabel: 'rgba(255, 255, 255, 0.86)',
  },
};

/** 4-point spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.2 },
  /** Map labels: small but never below the legibility floor. */
  mapName: { fontSize: 13, lineHeight: 16, fontWeight: '600' as const, letterSpacing: -0.1 },
  mapMeta: { fontSize: 11, lineHeight: 13, fontWeight: '500' as const },
  /**
   * Section eyebrows: small, upper-case, widely tracked, monospaced.
   *
   * The design leans on these hard — "WORTH WALKING OVER", "WHAT LEAVES YOUR
   * PHONE", "BAND ONLY · NO EXACT DISTANCE". They do a specific job: they label
   * a region without competing with its contents, and the mono face makes them
   * read as machine annotation rather than as prose the user has to weigh.
   *
   * The design specifies IBM Plex Mono. Shipping it means `expo-font` plus TTFs
   * in the bundle; until then this uses the platform mono, which preserves the
   * effect (tracked, upper-case, mechanical) if not the exact letterforms.
   */
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600' as const,
    letterSpacing: 1.5,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  /** Numerals that need to line up in a row — match scores, counts, byte sizes. */
  mono: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600' as const,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
} as const;

/**
 * Elevation. Soft and wide rather than dark and tight — the UI should feel like
 * panels floating over the map, not boxes stacked on paper.
 */
export const elevation = {
  none: {},
  low: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 3 },
    default: {},
  }),
  medium: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 8 },
    default: {},
  }),
  high: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.38,
      shadowRadius: 34,
      shadowOffset: { width: 0, height: 18 },
    },
    android: { elevation: 16 },
    default: {},
  }),
} as const;

/**
 * Motion. Everything is short and eased; the brief calls for "subtle" and a
 * spatial map punishes bounce — a person node that overshoots reads as a person
 * who moved.
 */
export const motion = {
  appear: 260,
  disappear: 200,
  select: 180,
  layout: 320,
  /** How long a person node takes to glide to a new position. */
  reposition: 520,
} as const;

/**
 * Category accents, per theme.
 *
 * These are not decoration: a selected filter chip fills with the category
 * colour and puts label text on top of it. The dark-theme set is bright enough
 * to glow on a near-black canvas — and far too pale to carry white text on a
 * white sheet. So the light set is the same twelve hues, darkened and
 * saturated until each one clears contrast against white.
 */
export const categoryColors: Record<ThemeName, Record<string, string>> = {
  dark: {
    engineer: '#5AA9FF',
    data: '#9D7BFF',
    product: '#FFB35A',
    design: '#FF7BC8',
    founder: '#3DDC97',
    investor: '#5AE0D0',
    recruiter: '#FF9B6B',
    student: '#8FD35A',
    speaker: '#FFD75A',
    mentor: '#7BE0A8',
    organizer: '#B0BBC6',
    other: '#8A97A3',
  },
  light: {
    engineer: '#1D6FD0',
    data: '#6B41C7',
    product: '#B96A00',
    design: '#C0347F',
    founder: '#0E8F5E',
    investor: '#0F7F78',
    recruiter: '#C4562A',
    student: '#4B7C1C',
    speaker: '#98761A',
    mentor: '#1E8055',
    organizer: '#5A6773',
    other: '#5F6B76',
  },
};

/**
 * Category colour for a theme. `theme` is optional so the dark set stays the
 * default for callers that genuinely sit on the map canvas in both themes.
 */
export function categoryColor(category: string, theme: ThemeName = 'dark'): string {
  const set = categoryColors[theme];
  return set[category] ?? set.other;
}

/**
 * Event banner tint. Dark themes want a deep band behind light text; light
 * themes want a pale one behind dark text, so the lightness flips rather than
 * the hue.
 */
export function bannerColor(hue: number, theme: ThemeName, live: boolean): string {
  if (theme === 'light') return `hsl(${hue}, 62%, ${live ? 88 : 93}%)`;
  return `hsl(${hue}, 55%, ${live ? 32 : 22}%)`;
}

/** Presence dot colour for an availability value. */
export function availabilityColor(palette: Palette, availability: string): string {
  switch (availability) {
    case 'available':
      return palette.available;
    case 'maybe':
      return palette.maybe;
    case 'busy':
      return palette.busy;
    default:
      return palette.offline;
  }
}
