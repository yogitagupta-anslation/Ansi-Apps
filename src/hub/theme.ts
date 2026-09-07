/**
 * The hub's own palette and type scale.
 *
 * Deliberately separate from the five apps' theme systems. The hub is the store, not one
 * of the things on its shelves: it keeps a single quiet identity in violet while each app
 * goes on owning its own colour. The rule the design sets is narrow and worth stating —
 * **hub violet owns the chrome and the active tab; an app's own accent appears only
 * inside that app's card, its detail page and its running session.** Everything here
 * exists to make that rule easy to follow rather than remembered.
 */

import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

export interface HubPalette {
  isDark: boolean;
  /** Page ground. */
  bg: string;
  /** Cards, the search field, chips. */
  surface: string;
  /** A surface sitting on another surface — stat cells, inset rows. */
  surfaceAlt: string;
  border: string;
  /** Separator inside a card, lighter than the outline around it. */
  divider: string;
  text: string;
  textDim: string;
  textFaint: string;
  /** Hub violet: chrome, the active tab, focus rings, the eyebrow. */
  accent: string;
  /** Same hue at low alpha, for tinted grounds. */
  accentSoft: string;
  /** A filled chip that has to read as selected against the ground. */
  chipOn: string;
  chipOnText: string;
  ok: string;
  warn: string;
  /** Lifted card shadow; nil in dark, where elevation is a lighter surface instead. */
  shadowOpacity: number;
}

const dark: HubPalette = {
  isDark: true,
  // OLED-friendly rather than merely dark: a true-ish black ground makes the app
  // accents on the cards the brightest thing on the screen, which is the point.
  bg: '#0C0F17',
  surface: '#141A26',
  surfaceAlt: '#1B2333',
  border: '#242C3E',
  divider: '#1E2632',
  text: '#F2F5FA',
  textDim: '#98A3B8',
  textFaint: '#5E6A80',
  accent: '#7C6CFF',
  accentSoft: 'rgba(124,108,255,0.16)',
  chipOn: '#7C6CFF',
  chipOnText: '#0B1020',
  ok: '#34D399',
  warn: '#FBBF24',
  shadowOpacity: 0,
};

const light: HubPalette = {
  isDark: false,
  bg: '#F4F6FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F9',
  border: '#E1E6F0',
  divider: '#EDF0F6',
  text: '#0F1523',
  textDim: '#5B6579',
  textFaint: '#8B93A5',
  // Deeper than the dark set's violet: the same hue at #7C6CFF on white is too light to
  // carry a label, and the design calls for "deeper accents for contrast on white".
  accent: '#5B4BE0',
  accentSoft: 'rgba(91,75,224,0.10)',
  // Violet, like the dark set. The design's rule is that hub violet owns the chrome, and
  // a filter chip is chrome; giving light mode a near-black selection instead would make
  // the same control mean something different in the two themes.
  chipOn: '#5B4BE0',
  // White on this violet, dark ink on the brighter one above — each is the readable
  // direction for its own fill.
  chipOnText: '#FFFFFF',
  ok: '#059669',
  warn: '#B45309',
  shadowOpacity: 0.06,
};

export type HubThemeMode = 'system' | 'light' | 'dark';

export function paletteFor(mode: HubThemeMode, systemIsDark: boolean): HubPalette {
  if (mode === 'light') return light;
  if (mode === 'dark') return dark;
  // Dark is the default the design is drawn in, so an unknown system preference
  // resolves that way rather than to light.
  return systemIsDark ? dark : light;
}

export function useSystemIsDark(): boolean {
  const scheme = useColorScheme();
  return useMemo(() => scheme !== 'light', [scheme]);
}

/**
 * Two families, each with one job.
 *
 * Space Grotesk carries names and numbers — the things you scan for and compare.
 * Manrope carries body and labels — the things you read. Nothing drops below 11px and
 * body sits at 14, so the smallest text on screen is still text rather than decoration.
 *
 * The `*_FALLBACK` stacks matter: the families are loaded at runtime and a screen that
 * renders before they arrive must still be laid out in something sane rather than
 * whatever the platform picks by default.
 */
export const font = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  body: 'Manrope_500Medium',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyExtra: 'Manrope_800ExtraBold',
} as const;

export const typeScale = {
  /** Screen titles: "Hey, Alex", "Shared with every app". */
  title: { fontFamily: font.displayBold, fontSize: 28, letterSpacing: -0.8 },
  /** An app's name at the top of its detail page. */
  headline: { fontFamily: font.displayBold, fontSize: 22, letterSpacing: -0.5 },
  /** Names in a list, and the featured app's name. */
  name: { fontFamily: font.display, fontSize: 17, letterSpacing: -0.3 },
  nameSmall: { fontFamily: font.display, fontSize: 15, letterSpacing: -0.2 },
  /** Figures in the stat strip and the count chips. */
  figure: { fontFamily: font.displayBold, fontSize: 18, letterSpacing: -0.4 },
  body: { fontFamily: font.body, fontSize: 14, lineHeight: 21 },
  bodyStrong: { fontFamily: font.bodySemi, fontSize: 14, lineHeight: 21 },
  meta: { fontFamily: font.body, fontSize: 12, lineHeight: 17 },
  metaStrong: { fontFamily: font.bodySemi, fontSize: 12, lineHeight: 17 },
  /** Section eyebrows: "APP HUB", "FEATURED THIS WEEK", "HUB SETTINGS". */
  eyebrow: {
    fontFamily: font.bodyExtra,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
  /** The floor. Nothing in the hub is smaller than this. */
  micro: { fontFamily: font.bodySemi, fontSize: 11, lineHeight: 15 },
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, xxl: 26, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 };

/** Card lift. A no-op in dark, where a lighter surface does the separating instead. */
export function lift(t: HubPalette, level: 1 | 2 = 1) {
  if (t.shadowOpacity === 0) return {};
  return {
    shadowColor: '#0F1523',
    shadowOpacity: t.shadowOpacity,
    shadowRadius: level === 1 ? 8 : 18,
    shadowOffset: { width: 0, height: level === 1 ? 2 : 6 },
    elevation: level === 1 ? 2 : 5,
  };
}
