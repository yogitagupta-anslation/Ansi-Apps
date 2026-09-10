import { Platform, TextStyle, ViewStyle } from 'react-native';
import { Verdict } from '../types/game';
import { family } from './fonts';

/**
 * Shared design tokens for the Higher or Lower UI.
 *
 * Single source of truth for colour, type, spacing, radius and elevation, so
 * screens stay consistent. Nothing below this file invents a font size, a gap
 * or a shadow: if a value is needed twice it is named here once.
 *
 * Two palettes with identical keys. Components never import a palette directly —
 * they take one from `useTheme()` / `useThemedStyles()` so the whole tree
 * restyles when the scheme flips. See theme/ThemeProvider.tsx.
 */

/* ==========================================================================
 * Colour
 *
 * The game has three semantic colours and they are never used decoratively:
 *
 *   amber   HIGHER — aim up
 *   blue    LOWER  — aim down
 *   green   CORRECT — the round is over
 *
 * Violet is the interface: it marks what you can press, never what a number
 * did. Gold belongs to the daily challenge and to a win, and nothing else.
 * Red is reserved for failure and destructive actions, which is why an
 * eliminated player is dimmed rather than reddened — they played, they lost.
 * ========================================================================== */

const dark = {
  /** Lets the few genuinely non-colour decisions (glow strength, keyboard
   *  appearance, shadow opacity) follow the scheme without a second lookup. */
  isDark: true,

  background: '#05070E',
  backgroundAlt: '#0B1020',
  /** Backdrop gradient behind every screen. */
  screenGradient: ['#0D1330', '#070A16', '#05070E'] as [string, string, string],

  /**
   * Three surface levels, and they are genuinely distinguishable — the previous
   * palette had `panel` and `card` within a few percent of each other, so a
   * tappable card and a static panel read identically.
   *
   *   panel    static grouping: settings blocks, fact lists, summaries
   *   card     a thing you can press
   *   raised   a card sitting on a card, and the keypad's keys
   */
  panel: 'rgba(16, 22, 40, 0.72)',
  panelBorder: 'rgba(255, 255, 255, 0.07)',
  panelBorderStrong: 'rgba(139, 124, 255, 0.42)',

  card: 'rgba(28, 36, 60, 0.72)',
  cardBorder: 'rgba(255, 255, 255, 0.09)',

  raised: 'rgba(40, 50, 78, 0.78)',
  raisedBorder: 'rgba(255, 255, 255, 0.11)',

  textPrimary: '#F2F5FC',
  textSecondary: '#A9B4CD',
  // Measured against `card` over the gradient rather than against the page
  // ground, because that is where captions actually sit: the old #6B7793 came
  // out at 3.7:1 there, and this is the colour every hint and caption uses.
  textMuted: '#7A86A3',

  accent: '#8B7CFF',
  accentGlow: 'rgba(139, 124, 255, 0.45)',
  accentDim: 'rgba(139, 124, 255, 0.16)',
  /** Text/icon sitting on top of a filled accent or success surface. */
  onAccent: '#FFFFFF',
  onSuccess: '#042414',

  higher: '#FFB020',
  higherGlow: 'rgba(255, 176, 32, 0.35)',
  higherTint: 'rgba(255, 176, 32, 0.13)',
  lower: '#42AEFF',
  lowerGlow: 'rgba(66, 174, 255, 0.35)',
  lowerTint: 'rgba(66, 174, 255, 0.13)',
  correct: '#2FE08A',
  correctGlow: 'rgba(47, 224, 138, 0.40)',

  gold: '#FFC94A',
  /** Wash behind a winning row and behind the daily card. */
  goldTint: 'rgba(255, 201, 74, 0.10)',
  goldBorder: 'rgba(255, 201, 74, 0.42)',
  correctTint: 'rgba(47, 224, 138, 0.12)',
  correctBorder: 'rgba(47, 224, 138, 0.35)',
  danger: '#FF6B6B',
  dangerTint: 'rgba(255, 107, 107, 0.12)',
  dangerBorder: 'rgba(255, 107, 107, 0.38)',

  buttonSecondary: 'rgba(52, 62, 90, 0.60)',
  buttonSecondaryBorder: 'rgba(255, 255, 255, 0.12)',

  inputBackground: 'rgba(10, 15, 28, 0.78)',
  inputBorder: 'rgba(139, 124, 255, 0.55)',

  divider: 'rgba(255, 255, 255, 0.08)',
  /** Empty portion of a progress track or range bar. */
  track: 'rgba(255, 255, 255, 0.08)',
  /** Faint fill behind chips and tiles. */
  wash: 'rgba(255, 255, 255, 0.04)',

  /** Blur radius for the glow behind the big readouts. */
  numberGlow: 28,
  /** How hard elevation presses. Dark grounds swallow a soft shadow. */
  shadowOpacity: 0.45,
  shadowColor: '#000000',
};

export type Palette = typeof dark;

const light: Palette = {
  isDark: false,

  background: '#F1F4FB',
  backgroundAlt: '#E4EAF6',
  screenGradient: ['#FFFFFF', '#F3F6FD', '#E9EFFA'],

  // Opaque rather than translucent: stacking three washes of white over a pale
  // gradient is what made every light-mode surface look like the same surface.
  panel: '#FFFFFF',
  panelBorder: 'rgba(17, 24, 48, 0.09)',
  panelBorderStrong: 'rgba(88, 71, 214, 0.36)',

  card: '#FFFFFF',
  cardBorder: 'rgba(17, 24, 48, 0.11)',

  // Elevation reads as *lighter* in both schemes, so a raised surface on a pale
  // page is white and earns its edge from the border, not from a grey fill —
  // #F4F7FD keys on the gradient's own #F3F6FD were all but invisible.
  raised: '#FFFFFF',
  raisedBorder: 'rgba(17, 24, 48, 0.16)',

  textPrimary: '#0F1526',
  textSecondary: '#46516E',
  // 3.6:1 before, on white. Captions are 12px body text and need 4.5:1.
  textMuted: '#626D85',

  accent: '#5847D6',
  accentGlow: 'rgba(88, 71, 214, 0.26)',
  accentDim: 'rgba(88, 71, 214, 0.10)',
  onAccent: '#FFFFFF',
  onSuccess: '#FFFFFF',

  // Darkened so the words stay legible as text on a pale wash.
  higher: '#9C5B00',
  higherGlow: 'rgba(255, 176, 32, 0.20)',
  higherTint: 'rgba(255, 176, 32, 0.18)',
  lower: '#0A63BC',
  lowerGlow: 'rgba(66, 174, 255, 0.16)',
  lowerTint: 'rgba(66, 174, 255, 0.14)',
  correct: '#0C7E4B',
  correctGlow: 'rgba(12, 126, 75, 0.16)',

  gold: '#8A5E00',
  goldTint: 'rgba(255, 201, 74, 0.22)',
  goldBorder: 'rgba(180, 130, 0, 0.42)',
  correctTint: 'rgba(12, 126, 75, 0.11)',
  correctBorder: 'rgba(12, 126, 75, 0.32)',
  danger: '#BF2A22',
  dangerTint: 'rgba(191, 42, 34, 0.09)',
  dangerBorder: 'rgba(191, 42, 34, 0.32)',

  buttonSecondary: '#FFFFFF',
  buttonSecondaryBorder: 'rgba(17, 24, 48, 0.15)',

  inputBackground: '#FFFFFF',
  inputBorder: 'rgba(88, 71, 214, 0.45)',

  divider: 'rgba(17, 24, 48, 0.10)',
  track: 'rgba(17, 24, 48, 0.09)',
  wash: 'rgba(17, 24, 48, 0.035)',

  // A halo around dark text on a white page just looks like a printing fault.
  numberGlow: 0,
  shadowOpacity: 0.10,
  shadowColor: '#0F1526',
};

export const palettes = { dark, light } as const;

/* ==========================================================================
 * Geometry
 * ========================================================================== */

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  /** Optical nudges only — a gap between a glyph and its own label. */
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/**
 * The smallest thing a thumb should have to hit.
 *
 * 44 is Apple's floor and Android's is 48dp; the larger of the two is the one
 * worth honouring. Anything interactive either measures this or carries
 * `hitSlop` that brings it up to this — there is no third option.
 */
export const HIT_SLOP = 12;
export const MIN_TOUCH = 48;

/* ==========================================================================
 * Elevation
 *
 * Three steps, and each one means something:
 *
 *   sunken   nothing — a static panel sits flat on the page
 *   raised   this responds to a press
 *   lifted   this is the most important thing on the screen right now
 * ========================================================================== */

type Elevation = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

export function elevation(level: 'raised' | 'lifted', colors: Palette): Elevation {
  const raised = level === 'raised';
  return {
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: raised ? 2 : 8 },
    shadowOpacity: colors.shadowOpacity * (raised ? 0.7 : 1),
    shadowRadius: raised ? 8 : 20,
    // Android draws its own shadow from this alone and ignores the rest.
    elevation: raised ? 2 : 8,
  };
}

/* ==========================================================================
 * Type
 *
 * One scale, seven steps, no sizes outside it. Every entry names a family
 * rather than a weight — see fonts.ts for why that is not optional on Android.
 *
 * The `num` variants are the same steps set in Space Grotesk, for anything a
 * player reads as a quantity. The rule: if it would change when the game state
 * changes, it is a figure.
 * ========================================================================== */

export const type = {
  /** The wordmark, and the revealed number on the result screen. */
  display: { fontFamily: family.extrabold, fontSize: 40, lineHeight: 44, letterSpacing: 0.5 },
  /** Screen titles. */
  title: { fontFamily: family.extrabold, fontSize: 22, lineHeight: 28 },
  /** Card titles, section headings that carry real weight. */
  heading: { fontFamily: family.bold, fontSize: 17, lineHeight: 22 },
  /** The default. Row titles, button labels, anything read at a glance. */
  body: { fontFamily: family.semibold, fontSize: 15, lineHeight: 20 },
  /** Supporting copy: subtitles, hints, explanations. Reads as prose. */
  sub: { fontFamily: family.medium, fontSize: 13, lineHeight: 19 },
  /** Metadata under a row, and dense secondary detail. */
  caption: { fontFamily: family.medium, fontSize: 12, lineHeight: 16 },
  /** ALL-CAPS SECTION LABELS. Never a sentence. */
  label: { fontFamily: family.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
  /** Pills and tags. The floor — nothing in this app is smaller. */
  micro: { fontFamily: family.bold, fontSize: 10, lineHeight: 13, letterSpacing: 0.8 },

  /** Figures, at the same steps. */
  numDisplay: { fontFamily: family.numBold, fontSize: 40, lineHeight: 46 },
  numTitle: { fontFamily: family.numBold, fontSize: 22, lineHeight: 27 },
  numHeading: { fontFamily: family.numSemibold, fontSize: 17, lineHeight: 22 },
  numBody: { fontFamily: family.numSemibold, fontSize: 15, lineHeight: 20 },
  numCaption: { fontFamily: family.numMedium, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

/**
 * Emoji sizes.
 *
 * The modifier, badge and reaction glyphs come from game data rather than from
 * an icon set, so they are content and not chrome — but they were still being
 * set at 11, 15, 16, 18 and 20 for the same job. Three steps, chosen by how
 * close the reader is to the thing:
 *
 *   sm   inside a chip, beside its own label
 *   md   a list row
 *   lg   a card the glyph is the subject of
 */
export const glyph = { sm: 12, md: 16, lg: 20 } as const;

/**
 * Tabular figures, for readouts that must not jitter as they change.
 *
 * Space Grotesk's digits are already monospaced by design, so this is belt and
 * braces — but it costs nothing and covers the fallback face on a device where
 * the font did not load.
 */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * The letter-spacing a large figure wants.
 *
 * Big type needs negative tracking or the digits drift apart; small type needs
 * none. Applied by the components that set their own size — BigNumber and the
 * room code — rather than baked into the scale.
 */
export function trackingFor(fontSize: number): number {
  if (fontSize >= 64) return -2;
  if (fontSize >= 32) return -1;
  return 0;
}

/* ==========================================================================
 * Semantics
 * ========================================================================== */

/** The colour a verdict is spoken in: amber up, blue down, green done. */
export function verdictColor(verdict: Verdict, colors: Palette): string {
  if (verdict === 'higher') return colors.higher;
  if (verdict === 'lower') return colors.lower;
  return colors.correct;
}

/** The wash behind that verdict. */
export function verdictGlow(verdict: Verdict, colors: Palette): string {
  if (verdict === 'higher') return colors.higherGlow;
  if (verdict === 'lower') return colors.lowerGlow;
  return colors.correctGlow;
}

/** The faint fill behind a verdict-tinted row. */
export function verdictTint(verdict: Verdict, colors: Palette): string {
  if (verdict === 'higher') return colors.higherTint;
  if (verdict === 'lower') return colors.lowerTint;
  return colors.correctTint;
}

/**
 * Monospaced-digit support on the fallback face.
 *
 * iOS honours `fontVariant` on the system font; older Android reliably does not,
 * which is the other reason figures are set in Space Grotesk rather than left to
 * the platform.
 */
export const platformNumeric: TextStyle = Platform.select({
  ios: tabular,
  default: {},
}) as TextStyle;
