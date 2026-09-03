/**
 * The hub's own palette.
 *
 * Deliberately separate from the three apps' theme systems. The hub is the frame,
 * not one of the pictures: it keeps a single quiet identity while each app inside
 * it goes on owning its own colours. Every per-app accent lives in the registry,
 * so the hub renders BLE Chat's purple and Higher or Lower's amber without
 * importing anything from either app.
 */

import { useColorScheme } from 'react-native';
import { useMemo } from 'react';

export interface HubPalette {
  isDark: boolean;
  /** Page ground. */
  bg: string;
  /** Cards, chips, the search field. */
  surface: string;
  /** A card sitting on top of another card. */
  surfaceRaised: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  /** The hub's own accent — used for the wordmark and the active chip. */
  accent: string;
  /** Same hue at low alpha, for glows and pressed states. */
  accentSoft: string;
}

const dark: HubPalette = {
  isDark: true,
  bg: '#070A12',
  surface: '#121826',
  surfaceRaised: '#1B2334',
  border: '#232C40',
  text: '#F2F5FA',
  textDim: '#98A3B8',
  textFaint: '#5E6A80',
  accent: '#7C6CFF',
  accentSoft: 'rgba(124,108,255,0.16)',
};

const light: HubPalette = {
  isDark: false,
  bg: '#F4F6FB',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#E1E6F0',
  text: '#131722',
  textDim: '#5B6579',
  textFaint: '#8B93A5',
  accent: '#5B4BE0',
  accentSoft: 'rgba(91,75,224,0.12)',
};

export function useHubTheme(): HubPalette {
  const scheme = useColorScheme();
  return useMemo(() => (scheme === 'light' ? light : dark), [scheme]);
}

export const radius = { sm: 10, md: 14, lg: 20, xl: 26 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
