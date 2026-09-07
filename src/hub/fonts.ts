/**
 * The hub's two font families, loaded at runtime.
 *
 * Only the six faces the type scale actually names are requested. Pulling a family in
 * wholesale would put four unused weights into the bundle, and every one of them is a
 * file the app has to parse before it draws.
 *
 * Loading can fail — a corrupt asset, a device out of memory — and `useFonts` reports
 * that separately from "still loading". The hub treats both as "carry on": the type
 * scale's families simply do not resolve and React Native falls back to the system face,
 * which is a slightly plainer launcher rather than a launcher that never appears.
 */

import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

export function useHubFonts(): boolean {
  const [loaded, error] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  return loaded || error !== null;
}
