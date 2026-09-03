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
  /** Separator *inside* a card — lighter than `border`, which outlines it. */
  divider: string;

  text: string;
  textDim: string;
  /**
   * The third text tone. Two greys is one too few for these screens: a card
   * routinely carries a name, a supporting line, and a timestamp or unit that
   * must not compete with either. Without this, that third thing borrows
   * `textDim` and the supporting line stops reading as the more important one.
   */
  textFaint: string;
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
  divider: '#1e2632',

  text: '#eef2f7',
  textDim: '#8b97a8',
  textFaint: '#66738a',
  onAccent: '#ffffff',
  onAccentDim: 'rgba(255,255,255,0.74)',

  // The indigo from the brand gradient's middle stop rather than a stock blue: the
  // accent, the outgoing bubble and the wordmark are then demonstrably the same
  // colour, which is what makes the chrome read as one app rather than three.
  accent: '#8B7CFF',
  accentSoft: 'rgba(139,124,255,0.16)',

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
  divider: '#eef1f6',

  text: '#141a24',
  textDim: '#6b7688',
  textFaint: '#98a1b0',
  onAccent: '#ffffff',
  // The accent stays dark blue in light mode, so this remains a light tint.
  onAccentDim: 'rgba(255,255,255,0.78)',

  accent: '#4C3FE0',
  accentSoft: '#EEF2FF',

  ok: '#059669',
  warn: '#b45309',
  error: '#dc2626',
  purple: '#7c3aed',
  amber: '#b45309',
  neutral: '#64748b',

  bubbleOut: '#4C3FE0',
  bubbleOutText: '#ffffff',
  // White on the page's off-white ground, separated by a hairline rather than a fill:
  // a grey bubble against a grey thread makes every incoming message look muted, which
  // is the wrong emphasis for the half of the conversation you did not write.
  bubbleIn: '#ffffff',
  bubbleInText: '#141a24',
  bubbleMeta: 'rgba(15,23,42,0.55)',

  bannerFrom: 'rgba(22,104,227,0.08)',
  bannerTo: 'rgba(126,34,206,0.06)',

  gradient: ['#241E4E', '#4C3FE0', '#9B6BFF'],
  tileBlue: '#DBEAFE',
  tileBlueFg: '#2563EB',
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

/**
 * The tint an avatar wears, derived from the peer's id.
 *
 * Same reasoning as `speakerTint`: keyed on identity rather than list position, so
 * somebody is the same colour whether or not they are currently connected, in the
 * nearby list or the chat header, and across restarts. Four hues is deliberate — enough
 * that a screenful of avatars reads as varied, few enough that the colour stays a weak
 * recognition cue rather than pretending to encode something.
 */
export function avatarHue(theme: Theme, seed: string): {bg: string; fg: string} {
  const palette = [
    {bg: theme.tileBlue, fg: theme.tileBlueFg},
    {bg: theme.tileGreen, fg: theme.tileGreenFg},
    {bg: theme.tileAmber, fg: theme.tileAmberFg},
    {bg: theme.tilePurple, fg: theme.tilePurpleFg},
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1_000_003;
  }
  return palette[hash % palette.length];
}

/**
 * The letter an avatar shows. Falls back to a bullet rather than a letter for an
 * unnamed peer — an invented initial would be a claim about somebody we cannot make.
 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '•';
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
