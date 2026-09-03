import { TextStyle } from 'react-native';
import { Verdict } from '../types/game';

// Shared design tokens for the Higher or Lower UI.
// Single source of truth for color/spacing/radius so screens stay consistent.
//
// Two palettes with identical keys. Components never import a palette directly:
// they take one from `useTheme()` / `useThemedStyles()` so the whole tree
// re-styles when the scheme flips. See theme/ThemeProvider.tsx.

const dark = {
  /** Lets the few genuinely non-color decisions (glow strength, status bar,
   *  keyboard appearance) follow the scheme without a second lookup. */
  isDark: true,

  background: '#070A12',
  backgroundAlt: '#0D1322',
  /** Backdrop gradient behind every screen. */
  screenGradient: ['#0B1026', '#070A12', '#0A0F1E'] as [string, string, string],

  panel: 'rgba(19, 25, 41, 0.78)',
  panelBorder: 'rgba(255, 255, 255, 0.08)',
  panelBorderStrong: 'rgba(124, 107, 255, 0.40)',

  card: 'rgba(30, 38, 58, 0.62)',
  cardBorder: 'rgba(255, 255, 255, 0.07)',

  textPrimary: '#F4F6FB',
  textSecondary: '#AEB8CE',
  textMuted: '#6C7791',

  accent: '#7C6BFF',
  accentGlow: 'rgba(124, 107, 255, 0.45)',
  accentDim: 'rgba(124, 107, 255, 0.16)',
  /** Text/icon sitting on top of a filled accent or success surface. */
  onAccent: '#FFFFFF',
  onSuccess: '#052616',

  // Verdict colors. Amber points up, blue points down, green ends the round.
  higher: '#FFB020',
  higherGlow: 'rgba(255, 176, 32, 0.35)',
  lower: '#3FA9FF',
  lowerGlow: 'rgba(63, 169, 255, 0.35)',
  correct: '#2FE08A',
  correctGlow: 'rgba(47, 224, 138, 0.40)',

  gold: '#FFC94A',
  /** Wash behind a winning row. */
  goldTint: 'rgba(255, 201, 74, 0.10)',
  correctTint: 'rgba(47, 224, 138, 0.12)',
  correctBorder: 'rgba(47, 224, 138, 0.35)',
  danger: '#FF5A5A',

  buttonSecondary: 'rgba(52, 62, 88, 0.55)',
  buttonSecondaryBorder: 'rgba(255, 255, 255, 0.10)',

  inputBackground: 'rgba(14, 19, 34, 0.7)',
  inputBorder: 'rgba(124, 107, 255, 0.55)',

  divider: 'rgba(255, 255, 255, 0.08)',
  /** Empty portion of a progress track or range bar. */
  track: 'rgba(255, 255, 255, 0.07)',
  /** Faint fill behind chips and tiles. */
  wash: 'rgba(255, 255, 255, 0.03)',

  /** Blur radius for the glow behind the big readouts. */
  numberGlow: 28,
};

export type Palette = typeof dark;

const light: Palette = {
  isDark: false,

  background: '#F4F6FC',
  backgroundAlt: '#E9EEF9',
  screenGradient: ['#FFFFFF', '#F2F5FD', '#EAF0FB'],

  panel: 'rgba(255, 255, 255, 0.92)',
  panelBorder: 'rgba(17, 24, 48, 0.10)',
  panelBorderStrong: 'rgba(91, 75, 214, 0.38)',

  card: 'rgba(255, 255, 255, 0.86)',
  cardBorder: 'rgba(17, 24, 48, 0.10)',

  textPrimary: '#121829',
  textSecondary: '#495472',
  textMuted: '#79849D',

  accent: '#5B4BD6',
  accentGlow: 'rgba(91, 75, 214, 0.28)',
  accentDim: 'rgba(91, 75, 214, 0.10)',
  onAccent: '#FFFFFF',
  onSuccess: '#FFFFFF',

  // Darkened so the words stay legible as text on a pale wash.
  higher: '#B06A00',
  higherGlow: 'rgba(255, 176, 32, 0.20)',
  lower: '#0B6CCB',
  lowerGlow: 'rgba(63, 169, 255, 0.16)',
  correct: '#0E8A53',
  correctGlow: 'rgba(15, 138, 83, 0.16)',

  gold: '#9A6B00',
  goldTint: 'rgba(255, 201, 74, 0.20)',
  correctTint: 'rgba(15, 138, 83, 0.12)',
  correctBorder: 'rgba(15, 138, 83, 0.35)',
  danger: '#C33028',

  buttonSecondary: 'rgba(17, 24, 48, 0.06)',
  buttonSecondaryBorder: 'rgba(17, 24, 48, 0.14)',

  inputBackground: '#FFFFFF',
  inputBorder: 'rgba(91, 75, 214, 0.45)',

  divider: 'rgba(17, 24, 48, 0.10)',
  track: 'rgba(17, 24, 48, 0.08)',
  wash: 'rgba(17, 24, 48, 0.03)',

  // A halo around dark text on a white page just looks like a printing fault.
  numberGlow: 0,
};

export const palettes = { dark, light } as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const fonts: Record<'title' | 'label' | 'numeric', TextStyle> = {
  title: {
    fontWeight: '800',
    letterSpacing: 1,
  },
  label: {
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  // Digits line up column-wise so the big readouts don't jitter as they change.
  numeric: {
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
};

/** The color a verdict is spoken in: amber up, blue down, green done. */
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
