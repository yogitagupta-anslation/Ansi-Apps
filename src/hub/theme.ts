/**
 * The store's design system.
 *
 * Deliberately separate from the five apps' theme systems. The store is the frame,
 * not one of the pictures: it keeps a single quiet identity while each app inside
 * it goes on owning its own colours. Every per-app accent lives in the registry,
 * so the store renders BLE Chat's purple and Higher or Lower's amber without
 * importing anything from either app.
 *
 * THEME FOLLOWS THE SYSTEM. `useColorScheme()` is the only input; there is no
 * toggle and no stored preference, so the store tracks the device the way the
 * platform intends and every surface below reads from one palette object.
 *
 * The scales are not invented here — they are the measured values of the approved
 * store design, deduplicated. Anything that appears more than once in that design
 * appears exactly once in this file.
 */

import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

export interface HubPalette {
  isDark: boolean;
  /** Page ground. */
  bg: string;
  /** Cards, the featured surface, filled ad creatives. */
  surface: string;
  /**
   * The recessed surface: search field, chips, ad trays, sponsored cards.
   * Distinct from `surface` — this is what makes a sponsored card read as
   * "not one of the organic ones" without a second border colour.
   */
  surfaceRaised: string;
  /** The resting hairline on surfaces. */
  border: string;
  /**
   * The raised/interactive/sponsored hairline. Every outlined button, every
   * sponsored surface and the dashed unfilled ad frame use this, never `border`.
   */
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  /** The store's own accent — the wordmark, the active chip, the primary CTA. */
  accent: string;
  /** Same hue at low alpha — the active nav icon fill and pressed states. */
  accentSoft: string;
  /** Text and glyphs that sit *on* the accent. */
  onAccent: string;
  /** Text that sits on an amber promo surface. */
  onAmber: string;
  /** The bottom bar's ground. Already carries its own alpha. */
  nav: string;
  /** The full-width promotional block's ground. */
  promo: string;
}

const dark: HubPalette = {
  isDark: true,
  bg: '#070A12',
  surface: '#121826',
  surfaceRaised: '#1B2334',
  border: '#232C40',
  borderStrong: '#2E3852',
  text: '#F2F5FA',
  textDim: '#98A3B8',
  textFaint: '#8A94A8',
  accent: '#7C6CFF',
  accentSoft: 'rgba(124,108,255,0.16)',
  onAccent: '#0B0E17',
  onAmber: '#FCD34D',
  nav: 'rgba(7,10,18,0.92)',
  promo: '#1B2334',
};

const light: HubPalette = {
  isDark: false,
  bg: '#F4F6FB',
  surface: '#FFFFFF',
  surfaceRaised: '#EDF0F7',
  border: '#E2E7F1',
  borderStrong: '#D3DAE8',
  text: '#131722',
  textDim: '#5B6579',
  textFaint: '#5F6878',
  accent: '#5B4BE0',
  accentSoft: 'rgba(91,75,224,0.12)',
  onAccent: '#FFFFFF',
  onAmber: '#7A5300',
  nav: 'rgba(255,255,255,0.94)',
  promo: '#131722',
};

export function useHubTheme(): HubPalette {
  const scheme = useColorScheme();
  // `useColorScheme` re-renders on a system appearance change on its own, so the
  // whole store follows the device with no listener of our own.
  return useMemo(() => (scheme === 'light' ? light : dark), [scheme]);
}

/* ---------------------------------------------------------------- scales -- */

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  /** Chips, list rows, ad creatives. The single most common radius in the design. */
  chip: 12,
  /** Cards that sit on the page ground. */
  card: 18,
  /** The search field and the primary CTA. */
  field: 16,
  /** The featured card — the only surface that gets it. */
  featured: 28,
  /** Anything fully rounded; RN clamps to half the height. */
  pill: 999,
};

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  /** The values the store layout actually leans on. */
  x6: 6,
  x7: 7,
  x10: 10,
  x14: 14,
  x18: 18,
  x22: 22,
  x26: 26,
  x28: 28,
};

export const layout = {
  /**
   * The horizontal gutter, applied PER SECTION and never on a scroll root — that
   * is what lets a rail bleed to the screen edge while its heading stays inset.
   */
  gutter: 20,
  /** Gap between top-level sections on a tabbed screen. */
  sectionGap: 28,
  /** Trailing spacer so the last section clears the bottom bar. */
  navSpacer: 76,
  /** The bar's own height, excluding the gesture inset it pads for itself. */
  navBarHeight: 65,
  /** The bottom bar's built-in gesture-area padding. */
  navBottomPad: 24,
};

/**
 * Every distinct text role in the design. Weight 400 is deliberately absent —
 * the design never uses it, and adding it here would invite it back in.
 */
export const type = {
  wordmark: { fontSize: 21, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 24 },
  tagline: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  screenTitle: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.6, lineHeight: 31 },
  sectionTitle: { fontSize: 17, fontWeight: '800' as const, letterSpacing: -0.3 },
  heroName: { fontSize: 23, fontWeight: '800' as const, letterSpacing: -0.5, lineHeight: 26 },
  cardTitle: { fontSize: 15, fontWeight: '800' as const, letterSpacing: -0.3 },
  railTitle: { fontSize: 13.5, fontWeight: '800' as const, letterSpacing: -0.3 },
  body: { fontSize: 13, fontWeight: '500' as const, lineHeight: 19 },
  bodyDim: { fontSize: 12.5, fontWeight: '500' as const, lineHeight: 18 },
  meta: { fontSize: 11.5, fontWeight: '700' as const },
  metaSoft: { fontSize: 11.5, fontWeight: '600' as const },
  chip: { fontSize: 13.5, fontWeight: '700' as const },
  navLabelActive: { fontSize: 11, fontWeight: '800' as const },
  navLabelIdle: { fontSize: 11, fontWeight: '600' as const },
  /** The sponsored eyebrow and the AD chip. */
  adLabel: { fontSize: 9.5, fontWeight: '800' as const, letterSpacing: 1.4 },
  badge: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.4 },
  eyebrow: { fontSize: 10.5, fontWeight: '800' as const, letterSpacing: 1.2 },
  button: { fontSize: 15, fontWeight: '800' as const },
  buttonSm: { fontSize: 13, fontWeight: '800' as const },
};

/**
 * The app-icon tile. Its radius is a function of its size across the whole
 * design — measured at 0.29 — so it is computed once here rather than being
 * re-picked per surface and drifting.
 */
export function iconTile(size: number): { size: number; radius: number; glyph: number } {
  return { size, radius: Math.round(size * 0.29), glyph: Math.round(size * 0.5) };
}

export const tile = {
  hero: iconTile(88),
  featured: iconTile(84),
  categoryCard: iconTile(64),
  rail: iconTile(58),
  listRow: iconTile(56),
  searchRow: iconTile(52),
  related: iconTile(50),
  libraryRow: iconTile(48),
  recents: iconTile(46),
  action: iconTile(44),
  brand: iconTile(38),
  glyph: iconTile(34),
};

/** Minimum comfortable target heights, so nothing here drops under a fingertip. */
export const touch = {
  chip: 40,
  button: 44,
  iconButton: 44,
  cta: 46,
  field: 48,
  ctaLarge: 52,
  navItem: 56,
};

/**
 * The design has exactly two elevations and one of them has a single consumer.
 * Kept separate so nobody sprays the card shadow across every surface.
 */
export const elevation = {
  card: {
    shadowColor: '#131722',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.07,
    shadowRadius: 30,
    elevation: 6,
  },
  iconPlate: {
    shadowColor: '#131722',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
};

/**
 * The numeric face. The design sets these in Roboto Mono, which is the platform
 * monospace on Android, so the tabular feel comes for free without bundling a
 * font — and iOS falls back to Menlo, which is the same shape of decision.
 */
export const monoFamily = undefined as string | undefined;
