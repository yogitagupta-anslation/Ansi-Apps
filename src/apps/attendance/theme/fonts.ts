/**
 * fonts.ts
 * -----------------------------------------------------------------------------
 * The three families the approved design specifies, and only the weights it
 * actually uses.
 *
 *   Plus Jakarta Sans  400/500/600/700/800   all UI text
 *   Space Grotesk      500/600/700           every figure: clocks, counts, rates
 *   IBM Plex Mono      400                   identifiers and diagnostics
 *
 * WHY BY NAME AND NOT BY WEIGHT. Android does not synthesise weights for a
 * custom family: `fontWeight: '800'` on "PlusJakartaSans" silently renders the
 * regular face. So every weight is registered as its own family and selected by
 * name — which is why `typography` sets `fontFamily` and never `fontWeight`.
 *
 * These are asset-only packages. `expo-font` is already present through `expo`
 * and already autolinked, so loading them needs no native rebuild.
 * -----------------------------------------------------------------------------
 */

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';

export const FONT_ASSETS = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  IBMPlexMono_400Regular,
};
