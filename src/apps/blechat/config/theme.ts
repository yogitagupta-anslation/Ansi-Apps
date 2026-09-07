import {Platform} from 'react-native';

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
  /**
   * The accent at reading weight, for accent-coloured TEXT sitting on the page.
   *
   * Shared interests are the case that needs it: they are marked by colour rather than
   * by a filled chip, and on dark the full accent at 13px on a near-black ground is
   * brighter than the name above it.
   */
  accentQuiet: string;

  ok: string;
  warn: string;
  error: string;
  purple: string;
  amber: string;
  neutral: string;
  /** The faint mark between two words that are not a list. */
  separator: string;

  bubbleOut: string;
  bubbleOutText: string;
  bubbleIn: string;
  bubbleInText: string;
  /** Timestamp/tick text inside an INCOMING bubble. */
  bubbleMeta: string;
  /**
   * The same, inside an outgoing one.
   *
   * Separate from `onAccentDim` because the outgoing bubble does not follow the accent:
   * it holds #4C3FE0 in both modes so that "mine" never changes meaning, while the dark
   * palette's accent lifts to a pale violet that takes dark ink. Sharing one token would
   * put near-black timestamps on a dark violet bubble the moment the theme flipped.
   */
  bubbleOutMeta: string;

  /** Scrim behind the scanning banner. */
  bannerFrom: string;
  bannerTo: string;

  // ---- vivid system (Home + shared chrome) --------------------------------
  /**
   * The three-stop brand gradient used on the wordmark and the primary button —
   * near-black through graphite to a light slate. Kept as an explicit tuple rather than
   * derived from `accent`, because a gradient needs deliberately chosen stops, not one
   * colour faded. The spread matters on the wordmark, where the lightest stop is what
   * separates "Chat" from the near-black "BLE" beside it.
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

  // Two grounds do all the elevation work. Warm-neutral rather than blue-tinted: a
  // blue-grey ground is what made the old screens read as a dashboard.
  bg: '#0C0C0E',
  surface: '#18181B',
  surfaceAlt: '#1E1E22',
  // Rows sit on the page, not on a tile of their own — see the note on `card`.
  card: '#0C0C0E',
  border: '#26262B',
  divider: '#1E1E22',

  text: '#F4F4F5',
  textDim: '#9A9AA3',
  textFaint: '#71717A',
  // Ink on a filled accent follows the ACCENT's luminance, not the mode. The lifted
  // accent below is light, so it takes dark ink; assuming white on any accent is the
  // mistake this replaces.
  onAccent: '#18181B',
  onAccentDim: 'rgba(24,24,27,0.72)',

  // One flat accent, and it appears on ONE action per screen.
  //
  // The previous graphite avoided competing with status by having no chroma at all,
  // which also left nothing to mark the single action that matters on a screen. The
  // discipline now lives in frequency rather than in saturation: status keeps green,
  // amber and red, and the accent is rationed hard enough not to crowd them.
  accent: '#8B7CF6',
  accentSoft: 'rgba(139,124,246,0.16)',
  // A dimmer accent for text that must sit on the page rather than on a fill — shared
  // interests, mostly, where full accent on every row would be the crowding above.
  accentQuiet: '#A99BFF',

  ok: '#34D399',
  warn: '#FBBF24',
  error: '#F87171',
  purple: '#A78BFA',
  amber: '#FBBF24',
  neutral: '#52525B',
  // The faint mark between two words that are not a list — an interest separator.
  separator: '#3F3F46',

  // The one colour that must mean "mine" identically in both modes, so it does NOT
  // lift with the rest of the dark palette. White ink on it in both modes too.
  bubbleOut: '#4C3FE0',
  bubbleOutText: '#FFFFFF',
  // A fill, never a border: on a dark ground a hairline round a bubble is louder than
  // the bubble.
  bubbleIn: '#1E1E22',
  bubbleInText: '#F4F4F5',
  bubbleMeta: 'rgba(244,244,245,0.62)',
  bubbleOutMeta: 'rgba(255,255,255,0.72)',

  bannerFrom: 'rgba(139,124,246,0.12)',
  bannerTo: 'rgba(139,124,246,0.04)',

  // Flat. Kept as a tuple because the type says so and several call sites read three
  // stops, but every stop is the accent now — the near-black-to-violet ramp was on
  // every hero and every button, which is precisely why nothing could stand out.
  gradient: ['#8B7CF6', '#8B7CF6', '#8B7CF6'],
  tileBlue: 'rgba(91,155,255,0.14)',
  tileBlueFg: '#5B9BFF',
  tileGreen: 'rgba(52,211,153,0.14)',
  tileGreenFg: '#34D399',
  tilePurple: 'rgba(139,124,246,0.16)',
  tilePurpleFg: '#A99BFF',
  tileAmber: 'rgba(251,191,36,0.14)',
  tileAmberFg: '#FBBF24',
  glow: 'rgba(139,124,246,0.14)',
};

export const lightTheme: Theme = {
  name: 'light',
  isDark: false,

  // Warm, not blue. The greys carry a little yellow so the page reads as paper rather
  // than as a control panel.
  bg: '#FBFBF9',
  // Reserved for a real boundary — a sheet or an overlay, the two places a raised
  // surface still earns its edge.
  surface: '#FFFFFF',
  // "Sunk": received bubbles and inset fills.
  surfaceAlt: '#F2F1EC',
  card: '#FBFBF9',
  border: '#E4E3DE',
  divider: '#EDECE7',

  text: '#17171A',
  textDim: '#6E6E76',
  textFaint: '#8E8D95',
  // This accent is dark, so it takes white — the inverse of the dark palette's, and
  // the reason this is a per-palette token rather than a constant.
  onAccent: '#FFFFFF',
  onAccentDim: 'rgba(255,255,255,0.78)',

  accent: '#4C3FE0',
  accentSoft: 'rgba(76,63,224,0.10)',
  accentQuiet: '#4C3FE0',

  ok: '#0F7B54',
  warn: '#A8620E',
  error: '#B42318',
  purple: '#6D4AE0',
  amber: '#A8620E',
  neutral: '#8E8D95',
  separator: '#C6C5BE',

  // Identical to dark, deliberately: "mine" is the one thing that must not change
  // meaning between the two modes.
  bubbleOut: '#4C3FE0',
  bubbleOutText: '#FFFFFF',
  // The sunk grey, filled rather than outlined. A white bubble on an off-white page
  // needed a border to exist at all, and that border was one more box.
  bubbleIn: '#F2F1EC',
  bubbleInText: '#17171A',
  bubbleMeta: 'rgba(23,23,26,0.55)',
  bubbleOutMeta: 'rgba(255,255,255,0.72)',

  bannerFrom: 'rgba(76,63,224,0.07)',
  bannerTo: 'rgba(76,63,224,0.02)',

  gradient: ['#4C3FE0', '#4C3FE0', '#4C3FE0'],
  tileBlue: 'rgba(37,99,235,0.10)',
  tileBlueFg: '#2563EB',
  tileGreen: 'rgba(15,123,84,0.10)',
  tileGreenFg: '#0F7B54',
  tilePurple: 'rgba(76,63,224,0.10)',
  tilePurpleFg: '#4C3FE0',
  tileAmber: 'rgba(168,98,14,0.10)',
  tileAmberFg: '#A8620E',
  glow: 'rgba(76,63,224,0.08)',
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
    // Not `accent`: the chrome accent is a neutral now, and a neutral cannot be one of
    // five colours whose entire job is to be told apart.
    theme.tileBlueFg,
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
    tx: [theme.tileBlueFg, soft(theme.tileBlueFg)] as const,
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
  /** The tail corner of a bubble, and nothing else. */
  sm: 6,
  md: 10,
  lg: 14,
  /** Bubbles. */
  xl: 19,
  /** Fully rounded, for chips, pills and every action button. */
  pill: 999,
};

/**
 * The monospace face.
 *
 * Mono is a semantic choice here, not a decorative one: it is reserved for things that
 * are a MEASUREMENT — dBm, MTU, byte counts, pairing codes, clock times. Those want
 * tabular figures so a column of them aligns and stops jittering as it updates, and the
 * change of face is what tells you at a glance that a value is measured rather than
 * written.
 *
 * The interface face is deliberately left unset, so text renders in the platform's own
 * UI font. The design calls for Geist, which would mean adding a font package — a change
 * outside this app's folder. Every role below routes through this module, so adopting it
 * later is a one-file edit rather than a sweep.
 */
export const fonts = {
  mono: Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'}),
};

/**
 * Type scale.
 *
 * One scale, applied everywhere, is most of what separates a designed screen from an
 * assembled one — sizes chosen per component drift apart and the hierarchy stops reading.
 *
 * Two rules run through it. Weight tops out at 500 except on `display`: heavy weight with
 * tight tracking was doing the shouting, and hierarchy reads better from size and colour.
 * And prose never goes below 13 — `caption` used to be 12, which put supporting text one
 * step below comfortable on a screen that is mostly supporting text. Only the mono roles
 * go smaller, because a measurement is scanned rather than read.
 *
 * Line heights are deliberately generous; `AppText` caps the font-scale multiplier rather
 * than pinning line height, so these still reflow when the system font is enlarged.
 */
export const typography = {
  display: {fontSize: 30, fontWeight: '600' as const, letterSpacing: -1},
  title: {fontSize: 21, fontWeight: '500' as const, letterSpacing: -0.4},
  /** A person's name in a row or a header. */
  headline: {fontSize: 16, fontWeight: '500' as const},
  body: {fontSize: 15, fontWeight: '400' as const, lineHeight: 22},
  callout: {fontSize: 13, fontWeight: '500' as const},
  /** Secondary prose. The floor for anything that is read rather than scanned. */
  caption: {fontSize: 13, fontWeight: '400' as const},
  /** Section headers and other all-caps labels. */
  overline: {
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },

  // ---- measurements ------------------------------------------------------------
  /** The default for a measured value shown beside prose. */
  mono: {fontFamily: fonts.mono, fontSize: 13, fontWeight: '400' as const},
  /** Inside a dense row, where the value trails a status word. */
  monoSmall: {fontFamily: fonts.mono, fontSize: 12, fontWeight: '400' as const},
  /** Clock times, step counters, and other position markers. */
  monoTiny: {fontFamily: fonts.mono, fontSize: 11, fontWeight: '400' as const},

  /** Figures that should not jitter as they count up. */
  numeric: {fontFamily: fonts.mono, fontSize: 22, fontWeight: '500' as const, letterSpacing: -0.5},
};

/**
 * Elevation.
 *
 * Level 1 is now nothing at all. A shadow is a claim that something floats, and almost
 * nothing in this app does: rows, sections and helper text sit on the page and are
 * separated by space and a hairline. Leaving the function in place — rather than deleting
 * the call sites — keeps that decision in one spot, so it can be revisited without
 * hunting for it.
 *
 * Level 2 survives for the things that genuinely float: a sheet, a menu, the marker
 * pinned over a bubble. Android needs `elevation`, iOS the shadow properties, so both
 * are set.
 */
export function elevation(theme: Theme, level: 0 | 1 | 2 = 1) {
  if (level !== 2) {
    return {};
  }
  return {
    shadowColor: '#000',
    shadowOpacity: theme.isDark ? 0.4 : 0.14,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
    elevation: 6,
  };
}
