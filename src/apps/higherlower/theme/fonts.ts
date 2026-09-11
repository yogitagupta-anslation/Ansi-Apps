/**
 * The two families this game is set in.
 *
 *   Plus Jakarta Sans  500/600/700/800   every word
 *   Space Grotesk      500/600/700       every figure
 *
 * The split is the whole point. This is a game about reading numbers under time
 * pressure: guesses, ranges, counts, clocks. Space Grotesk's figures are wide,
 * evenly weighted and genuinely tabular, so a guess of 1111 occupies the same
 * box as 8888 and the readout does not jitter as it is typed. Words get Jakarta,
 * which is quieter and narrower and stays out of the numbers' way.
 *
 * WHY BY NAME AND NOT BY WEIGHT. Android does not synthesise weights for a
 * custom family: `fontWeight: '800'` on "PlusJakartaSans" silently renders the
 * regular face. So every weight is registered as its own family and chosen by
 * name — which is why `type` in tokens.ts sets `fontFamily` and never sets
 * `fontWeight` beside it.
 *
 * These are asset-only packages already carried by this binary for the
 * Attendance app, so adding them here costs no download and no native rebuild.
 */

import {
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

export const FONT_ASSETS = {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
};

export const family = {
  /** Body copy, hints, captions. */
  medium: 'PlusJakartaSans_500Medium',
  /** Buttons, list rows, anything that needs to be picked out at a glance. */
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  /** Screen titles and the wordmark. */
  extrabold: 'PlusJakartaSans_800ExtraBold',

  /** Figures: guesses, ranges, counts, clocks, room codes. */
  numMedium: 'SpaceGrotesk_500Medium',
  numSemibold: 'SpaceGrotesk_600SemiBold',
  numBold: 'SpaceGrotesk_700Bold',
} as const;
