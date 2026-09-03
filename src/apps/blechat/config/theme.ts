/**
 * Semantic colour tokens.
 *
 * Components never reference a raw hex value; they ask the theme for a role
 * ("surface", "textDim", "danger"). That is what makes a second palette possible without
 * touching a single component, and what stops a hardcoded dark grey from surviving into
 * light mode.
 */
export interface Theme {
  name: 'dark' | 'light';
  /** True when the palette is dark, for status-bar and elevation decisions. */
  isDark: boolean;

  bg: string;
  /** Cards and raised panels. */
  surface: string;
  /** A panel on top of a panel. */
  surfaceAlt: string;
  /** Tiles inside a card. */
  card: string;
  border: string;

  text: string;
  textDim: string;
  /** Text on top of an accent-filled surface. */
  onAccent: string;
  /** Secondary text on an accent-filled surface (timestamps, ticks). */
  onAccentDim: string;

  accent: string;
  accentSoft: string;

  ok: string;
  warn: string;
  error: string;
  purple: string;
  amber: string;
  neutral: string;

  bubbleOut: string;
  bubbleOutText: string;
  bubbleIn: string;
  bubbleInText: string;
  /** Timestamp/tick text inside a bubble. */
  bubbleMeta: string;

  /** Scrim behind the scanning banner. */
  bannerFrom: string;
  bannerTo: string;

  // ---- vivid system (Home + shared chrome) --------------------------------
  /**
   * The three-stop brand gradient used on the wordmark and the primary button —
   * navy through indigo to violet. Kept as an explicit tuple rather than derived from
   * `accent`, because a gradient needs deliberately chosen stops, not one colour faded.
   */
  gradient: readonly [string, string, string];
  /** Soft icon-tile backgrounds, one per hue, paired with the matching text/icon colour. */
  tileBlue: string;
  tileBlueFg: string;
  tileGreen: string;
  tileGreenFg: string;
  tilePurple: string;
  tilePurpleFg: string;
  tileAmber: string;
  tileAmberFg: string;
  /** A faint ring behind a circular icon, for the glow the Bluetooth badge sits in. */
  glow: string;
}

export const darkTheme: Theme = {
  name: 'dark',
  isDark: true,

  // Lifted off pure black so a card reads as a surface rather than a hole. Neutral-cool
  // rather than blue-tinted: the accent should be the only thing with real chroma.
  bg: '#0b0f16',
  surface: '#141a24',
  surfaceAlt: '#1b2330',
  card: '#171e29',
  border: '#252d3a',

  text: '#eef2f7',
  textDim: '#8b97a8',
  onAccent: '#ffffff',
  onAccentDim: 'rgba(255,255,255,0.74)',

  // Deeper and less saturated than a stock blue. Used sparingly, it reads as considered
  // rather than loud, which is most of what "trustworthy" means visually.
  accent: '#3b82f6',
  accentSoft: 'rgba(59,130,246,0.14)',

  ok: '#34d399',
  warn: '#fbbf24',
  error: '#f87171',
  purple: '#a78bfa',
  amber: '#fbbf24',
  neutral: '#64748b',

  // The gradient's middle stop, flat: the outgoing bubble is the one place in the chat
  // itself that ties back to the brand identity on Home, rather than a generic blue that
  // could belong to any app.
  bubbleOut: '#4C3FE0',
  bubbleOutText: '#ffffff',
  bubbleIn: '#1b2330',
  bubbleInText: '#eef2f7',
  bubbleMeta: 'rgba(255,255,255,0.6)',

  bannerFrom: 'rgba(47,129,247,0.14)',
  bannerTo: 'rgba(168,85,247,0.10)',

  gradient: ['#241E4E', '#4C3FE0', '#9B6BFF'],
  tileBlue: 'rgba(59,130,246,0.16)',
  tileBlueFg: '#5B9BFF',
  tileGreen: 'rgba(34,197,94,0.16)',
  tileGreenFg: '#34D399',
  tilePurple: 'rgba(139,92,246,0.18)',
  tilePurpleFg: '#B794FF',
  tileAmber: 'rgba(245,158,11,0.16)',
  tileAmberFg: '#FBBF24',
  glow: 'rgba(139,92,246,0.16)',
};

export const lightTheme: Theme = {
  name: 'light',
  isDark: false,

  bg: '#f7f8fa',
  surface: '#ffffff',
  surfaceAlt: '#f1f3f7',
  card: '#fbfcfd',
  border: '#e3e7ee',

  text: '#141a24',
  textDim: '#6b7688',
  onAccent: '#ffffff',
  // The accent stays dark blue in light mode, so this remains a light tint.
  onAccentDim: 'rgba(255,255,255,0.78)',

  accent: '#2563eb',
  accentSoft: 'rgba(37,99,235,0.08)',

  ok: '#059669',
  warn: '#b45309',
  error: '#dc2626',
  purple: '#7c3aed',
  amber: '#b45309',
  neutral: '#64748b',

  // Same brand tie-in as dark mode, a shade deeper for contrast against a light card.
  bubbleOut: '#4433C7',
  bubbleOutText: '#ffffff',
  // An incoming bubble in light mode must not be white-on-white.
  bubbleIn: '#eef1f6',
  bubbleInText: '#141a24',
  bubbleMeta: 'rgba(15,23,42,0.55)',

  bannerFrom: 'rgba(22,104,227,0.08)',
  bannerTo: 'rgba(126,34,206,0.06)',

  gradient: ['#241E4E', '#4C3FE0', '#9B6BFF'],
  tileBlue: '#DBEAFE',
  tileBlueFg: '#3B82F6',
  tileGreen: '#DCFCE7',
  tileGreenFg: '#16A34A',
  tilePurple: '#EDE9FE',
  tilePurpleFg: '#7C3AED',
  tileAmber: '#FEF3C7',
  tileAmberFg: '#D97706',
  glow: '#EEF2FF',
};

export type ThemeMode = 'system' | 'light' | 'dark';

export function themeForMode(mode: ThemeMode, systemIsDark: boolean): Theme {
  if (mode === 'light') {
    return lightTheme;
  }
  if (mode === 'dark') {
    return darkTheme;
  }
  return systemIsDark ? darkTheme : lightTheme;
}

/**
 * A stable colour for a speaker in a group conversation.
 *
 * Derived from the peerId rather than from position in the member list, so somebody keeps
 * the same colour whether or not they are currently connected, and across restarts. The
 * palette is drawn from the existing accent colours so a busy group still looks like the
 * rest of the app.
 */
export function speakerTint(theme: Theme, peerId: string): string {
  const palette = [
    theme.accent,
    theme.ok,
    theme.purple,
    theme.amber,
    theme.error,
  ];
  // Plain arithmetic rather than bit twiddling: the modulus keeps it well inside the
  // safe integer range, and the only property needed is that it is deterministic.
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) {
    hash = (hash * 31 + peerId.charCodeAt(i)) % 1_000_003;
  }
  return palette[hash % palette.length];
}

/** Icon colour / icon background pairs for the packet stat cards. */
export function tintsFor(theme: Theme) {
  const soft = (hex: string) => hex + (theme.isDark ? '24' : '1f');
  return {
    tx: [theme.accent, soft(theme.accent)] as const,
    rx: [theme.ok, soft(theme.ok)] as const,
    ack: [theme.purple, soft(theme.purple)] as const,
    failed: [theme.error, soft(theme.error)] as const,
    dupes: [theme.amber, soft(theme.amber)] as const,
    dropped: [theme.neutral, soft(theme.neutral)] as const,
    // Rejections that mean somebody is misbehaving, not that the link is flaky.
    rejected: [theme.warn, soft(theme.warn)] as const,
  };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  /** Fully rounded, for chips and status pills. */
  pill: 999,
};

/**
 * Type scale.
 *
 * One scale, applied everywhere, is most of what separates a designed screen from an
 * assembled one — sizes chosen per component drift apart and the hierarchy stops reading.
 * Line heights are deliberately generous; `AppText` caps the font-scale multiplier rather
 * than pinning line height, so these still reflow when the system font is enlarged.
 */
export const typography = {
  display: {fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5},
  title: {fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3},
  headline: {fontSize: 16, fontWeight: '600' as const, letterSpacing: -0.2},
  body: {fontSize: 15, fontWeight: '400' as const},
  callout: {fontSize: 13, fontWeight: '500' as const},
  caption: {fontSize: 12, fontWeight: '400' as const},
  /** Section headers and other all-caps labels. */
  overline: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
  /** Figures that should not jitter as they count up. */
  numeric: {fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.5},
};

/**
 * Elevation.
 *
 * Restrained on purpose: a border plus a barely-there shadow reads as a considered
 * surface, where a heavy drop shadow reads as a demo. Android needs `elevation`, iOS the
 * shadow properties, so both are set.
 */
export function elevation(theme: Theme, level: 0 | 1 | 2 = 1) {
  if (level === 0) {
    return {};
  }
  return {
    shadowColor: '#000',
    shadowOpacity: theme.isDark ? 0.32 : 0.06,
    shadowRadius: level === 1 ? 8 : 16,
    shadowOffset: {width: 0, height: level === 1 ? 2 : 6},
    elevation: level === 1 ? 2 : 6,
  };
}
