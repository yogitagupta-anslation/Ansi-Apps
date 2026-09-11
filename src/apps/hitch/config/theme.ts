import {useColorScheme} from 'react-native';
import {useMemo} from 'react';

/**
 * Hitch's palette.
 *
 * Built around a single warm green, because the app's one repeated moment is "somebody
 * nearby is available" and green is what that already means everywhere else. Amber
 * carries "waiting" — searching, arriving, reconnecting — and red is reserved for
 * cancelling and for the emergency control, which must never share a colour with an
 * ordinary destructive action.
 *
 * Both themes are defined in full rather than derived, so a colour can be read straight
 * out of the file instead of computed in the reader's head.
 */
export interface HitchTheme {
  isDark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  divider: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  ok: string;
  warn: string;
  error: string;
  /** The schematic map's ground, roads and route line. */
  mapGround: string;
  mapRoad: string;
  mapRoute: string;
  mapWater: string;
  mapPark: string;
}

const light: HitchTheme = {
  isDark: false,
  bg: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F0EB',
  border: '#E2E0D9',
  divider: '#EAE8E2',
  text: '#17171A',
  textDim: '#5C5C66',
  textFaint: '#8E8E99',
  accent: '#0F7B54',
  accentSoft: 'rgba(15,123,84,0.12)',
  onAccent: '#FFFFFF',
  ok: '#0F7B54',
  warn: '#A8620E',
  error: '#B42318',
  mapGround: '#EDEBE4',
  mapRoad: '#FFFFFF',
  mapRoute: '#0F7B54',
  mapWater: '#CFE3EC',
  mapPark: '#DCE7D5',
};

const dark: HitchTheme = {
  isDark: true,
  bg: '#101013',
  surface: '#1A1A1F',
  surfaceAlt: '#24242B',
  border: '#33333C',
  divider: '#26262E',
  text: '#F5F5F4',
  textDim: '#A1A1AC',
  textFaint: '#71717C',
  // Lifted for a dark ground: #0F7B54 on #101013 is legible as a fill but muddy as text.
  accent: '#34D399',
  accentSoft: 'rgba(52,211,153,0.16)',
  onAccent: '#08110D',
  ok: '#34D399',
  warn: '#E0A458',
  error: '#F87171',
  mapGround: '#191920',
  mapRoad: '#2A2A33',
  mapRoute: '#34D399',
  mapWater: '#1B2A33',
  mapPark: '#1C261D',
};

export function useHitchTheme(): HitchTheme {
  const scheme = useColorScheme();
  return useMemo(() => (scheme === 'dark' ? dark : light), [scheme]);
}

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32};
export const radius = {sm: 8, md: 12, lg: 16, xl: 24, pill: 999};

export const type = {
  display: {fontSize: 28, fontWeight: '600' as const, letterSpacing: -0.8},
  title: {fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.4},
  heading: {fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2},
  body: {fontSize: 15, fontWeight: '400' as const},
  label: {fontSize: 13.5, fontWeight: '500' as const},
  caption: {fontSize: 12, fontWeight: '400' as const},
  overline: {fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.9},
};
