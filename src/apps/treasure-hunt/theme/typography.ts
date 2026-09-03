import {Platform, type TextStyle} from 'react-native';
import {colors} from './colors';

/**
 * Chunky condensed display type for a game feel, with the platform system
 * stack as the body face. No font files are bundled.
 */
const displayFamily = Platform.select({
  ios: 'Avenir Next Condensed',
  android: 'sans-serif-condensed',
  default: 'System',
});

const monoFamily = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const typography = {
  /** Screen headers in the top bar. */
  screenTitle: {
    fontFamily: displayFamily,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.text,
    textTransform: 'uppercase',
  } as TextStyle,

  /** Big gold headline, e.g. the loading screen. */
  hero: {
    fontFamily: displayFamily,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2,
    color: colors.gold,
  } as TextStyle,

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  } as TextStyle,

  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
  } as TextStyle,

  body: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  } as TextStyle,

  bodyMuted: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  } as TextStyle,

  /** Text inside a chunky action button. */
  button: {
    fontFamily: displayFamily,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  } as TextStyle,

  /** The four-digit lobby code. */
  gameCode: {
    fontFamily: displayFamily,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 8,
    color: colors.gold,
  } as TextStyle,

  score: {
    fontFamily: monoFamily,
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  } as TextStyle,

  pill: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  } as TextStyle,
};
