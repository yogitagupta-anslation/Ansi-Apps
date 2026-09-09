import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Text, View, type ViewStyle} from 'react-native';
import {avatarHue, avatarInitial, radius, spacing, typography} from '../../config/theme';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';
import {AppText, DenseText} from '../AppText';
import {Icon, type IconName} from './Icon';
import {useReduceMotion} from '../Motion';

/**
 * Small presentational building blocks shared by the redesigned screens.
 *
 * Deliberately built from plain Views and Unicode glyphs rather than an icon font:
 * adding react-native-vector-icons would mean another native dependency to link and
 * another way for a release build to break, for shapes that are four rectangles and a
 * tick.
 */

// ---------------------------------------------------------------- signal bars

interface SignalBarsProps {
  /** RSSI in dBm, or null when the platform cannot report it. */
  rssi: number | null;
  size?: 'sm' | 'md';
  color?: string;
}

/** Four ascending bars, filled according to RSSI. Never implies a distance. */
export function SignalBars({rssi, size = 'md', color}: SignalBarsProps) {
  const styles = useStyles();
  const theme = useTheme();
  const filled = rssi === null ? 0 : rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
  const tint =
    color ??
    (filled >= 3 ? theme.ok : filled === 2 ? theme.warn : theme.error);
  const unit = size === 'sm' ? 3 : 4;

  return (
    <View style={styles.bars}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              width: unit,
              height: unit * (i + 2),
              backgroundColor: i < filled ? tint : theme.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

// --------------------------------------------------------------------- avatar

/** Circular Bluetooth badge used as the peer avatar. */
export function PeerAvatar({size = 44, muted}: {size?: number; muted?: boolean}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          // A soft tint rather than a solid accent disc. At the sizes this is used —
          // one per row — a fully saturated circle is the loudest thing on the screen
          // and pulls attention away from the name beside it.
          backgroundColor: muted ? theme.surfaceAlt : theme.accentSoft,
          borderColor: muted ? theme.border : theme.accent + '55',
        },
      ]}>
      <Text
        style={[
          styles.avatarBt,
          muted ? styles.avatarBtMuted : styles.avatarBtActive,
          {fontSize: size * 0.44},
        ]}>
        ✦
      </Text>
    </View>
  );
}

/**
 * The avatar used everywhere a person appears: nearby, in a chat header, on a
 * conversation row, in the hero's stack.
 *
 * An initial in a tinted disc rather than the old Bluetooth glyph. The glyph was the
 * same on every row, which meant a list of six people had six identical marks and the
 * avatar column carried no information at all. A letter plus a stable hue makes a row
 * findable by shape before it is read.
 *
 * The presence dot lives here rather than in each caller because it must sit on the
 * disc's edge, and every caller that drew it separately had to re-derive the same
 * offsets. `ring` is the colour it is punched out of — white on a card, the accent
 * inside the hero — so the dot keeps a clean edge on any ground.
 */
export function InitialAvatar({
  name,
  seed,
  size = 40,
  online,
  ring,
  bg,
  fg,
}: {
  name: string | null | undefined;
  /** Identity the hue is derived from. Falls back to the name when there is no id. */
  seed?: string | null;
  size?: number;
  /** Draws the presence dot. Omit entirely where presence is not the point. */
  online?: boolean;
  ring?: string;
  /** Overrides, for the two places the hue is fixed by the design rather than derived. */
  bg?: string;
  fg?: string;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const hue = avatarHue(theme, seed || name || '');
  const dot = Math.round(size * 0.3);

  return (
    <View style={{width: size, height: size}}>
      <View
        style={[
          styles.initialAvatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg ?? hue.bg,
          },
        ]}>
        <Text
          style={[
            styles.initialAvatarText,
            {color: fg ?? hue.fg, fontSize: Math.round(size * 0.375)},
          ]}
          maxFontSizeMultiplier={1}>
          {avatarInitial(name)}
        </Text>
      </View>
      {online === undefined ? null : (
        <View
          style={[
            styles.presenceDot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: online ? theme.ok : theme.textFaint,
              borderColor: ring ?? theme.surface,
            },
          ]}
        />
      )}
    </View>
  );
}

/**
 * A group has no initial worth showing — every member has one and none of them is the
 * group's. So it gets the people mark on the same disc instead, which also makes a
 * group instantly separable from a person in a mixed list.
 */
export function GroupAvatar({
  size = 40,
  online,
  ring,
}: {
  size?: number;
  online?: boolean;
  ring?: string;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const dot = Math.round(size * 0.3);
  return (
    <View style={{width: size, height: size}}>
      <View
        style={[
          styles.initialAvatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.tilePurple,
          },
        ]}>
        <Icon name="people" color={theme.tilePurpleFg} size={Math.round(size * 0.45)} />
      </View>
      {online === undefined ? null : (
        <View
          style={[
            styles.presenceDot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: online ? theme.ok : theme.textFaint,
              borderColor: ring ?? theme.surface,
            },
          ]}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------------------- pill

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone?: string;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const colour = tone ?? theme.ok;
  return (
    <View style={[styles.pill, {borderColor: colour + '55', backgroundColor: colour + '1f'}]}>
      <DenseText style={[styles.pillText, {color: colour}]} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

// ------------------------------------------------------------------ info tile

/** One cell of the two-column device-details grid. */
export function InfoTile({
  label,
  value,
  valueColor,
  check,
  mono,
  icon,
}: {
  label: string;
  value: string;
  valueColor?: string;
  /** Renders a green tick before the label, for the yes/no GATT rows. */
  check?: boolean;
  mono?: boolean;
  /** A small glyph before the label, for the Radio grid's per-field icons. */
  icon?: IconName;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.tile}>
      <View style={styles.tileHeader}>
        {icon && <Icon name={icon} color={theme.textDim} size={13} />}
        {check && <Text style={styles.tick}>✓</Text>}
        <DenseText style={styles.tileLabel} numberOfLines={1}>
          {label}
        </DenseText>
        {check && (
          <DenseText style={[styles.tileInlineValue, {color: valueColor ?? theme.ok}]}>
            {value}
          </DenseText>
        )}
      </View>
      {!check && (
        <DenseText
          style={[
            styles.tileValue,
            mono && styles.mono,
            valueColor ? {color: valueColor} : null,
          ]}
          numberOfLines={2}
          selectable>
          {value}
        </DenseText>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ stat card

export function StatCard({
  glyph,
  value,
  label,
  tint,
}: {
  glyph: string;
  value: number;
  label: string;
  tint: readonly [string, string];
}) {
  const styles = useStyles();
  const reduced = useReduceMotion();
  const flash = useRef(new Animated.Value(0)).current;
  const previous = useRef(value);

  /**
   * A tick when the number moves.
   *
   * These counters update while you watch them, and a figure that changes silently from
   * 41 to 42 is a change you will miss — which matters here, because the question this
   * screen answers is usually "is anything happening at all?". A brief lift and a fading
   * wash behind the value says yes without a log line.
   *
   * Only on an increase: these are monotonic counters, so a decrease means they were
   * reset, and animating a reset would suggest traffic that did not happen.
   */
  useEffect(() => {
    const rose = value > previous.current;
    previous.current = value;
    if (!rose || reduced) {
      return;
    }
    flash.setValue(1);
    const anim = Animated.timing(flash, {
      toValue: 0,
      duration: 620,
      easing: Easing.out(Easing.quad),
      // Drives backgroundColor as well as transform, which the native driver cannot.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [value, reduced, flash]);

  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, {backgroundColor: tint[1]}]}>
        <Text style={[styles.statGlyph, {color: tint[0]}]}>{glyph}</Text>
      </View>
      <View style={styles.statText}>
        <Animated.View
          style={[
            styles.statFlash,
            {
              backgroundColor: tint[1],
              opacity: flash,
              transform: [
                {scaleX: flash.interpolate({inputRange: [0, 1], outputRange: [0.8, 1]})},
              ],
            },
          ]}
          pointerEvents="none"
        />
        <DenseText style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
          {String(value)}
        </DenseText>
        <DenseText style={styles.statLabel} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </DenseText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- leader row

/**
 * `label ········ value`, with the dots filling the gap.
 *
 * The leader is a flexible dotted rule rather than padded text, so it cannot be clipped
 * by font scaling the way a fixed-width label would.
 */
export function LeaderRow({
  label,
  value,
  badge,
  mono,
  icon,
}: {
  label: string;
  value: string;
  badge?: boolean;
  mono?: boolean;
  /** A small glyph before the label, for the Session list's per-metric icons. */
  icon?: IconName;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.leaderRow}>
      {icon && <Icon name={icon} color={theme.textDim} size={13} />}
      <DenseText style={styles.leaderLabel} numberOfLines={1}>
        {label}
      </DenseText>
      <View style={styles.leader} />
      {badge ? (
        <View style={styles.badge}>
          <DenseText style={styles.badgeText}>{value}</DenseText>
        </View>
      ) : (
        <DenseText
          style={[styles.leaderValue, mono && styles.mono]}
          numberOfLines={1}
          selectable>
          {value}
        </DenseText>
      )}
    </View>
  );
}

// ------------------------------------------------------------------- section

export function Section({
  title,
  glyph,
  icon,
  right,
  children,
  style,
}: {
  title: string;
  glyph?: string;
  /** Preferred over `glyph` — a shared-set vector icon instead of a Unicode symbol. */
  icon?: IconName;
  right?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHeader}>
        {icon ? (
          <Icon name={icon} color={theme.textDim} size={14} />
        ) : glyph ? (
          <Text style={styles.sectionGlyph}>{glyph}</Text>
        ) : null}
        <AppText style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </AppText>
        <View style={styles.spacer} />
        {right}
      </View>
      {children}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  bars: {flexDirection: 'row', alignItems: 'flex-end', gap: 2},
  bar: {borderRadius: 1},

  avatar: {borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  initialAvatar: {alignItems: 'center', justifyContent: 'center'},
  initialAvatarText: {fontWeight: '700'},
  presenceDot: {position: 'absolute', right: -1, bottom: -1, borderWidth: 2},
  avatarBt: {fontWeight: '700', marginTop: -2},
  avatarBtActive: {color: t.accent},
  avatarBtMuted: {color: t.textDim},

  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
  },
  pillText: {...typography.caption, fontWeight: '600'},

  tile: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: t.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tileHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  tick: {color: t.ok, fontSize: 13, fontWeight: '700'},
  tileLabel: {...typography.caption, color: t.textDim, flexShrink: 1},
  tileInlineValue: {...typography.caption, fontWeight: '700', marginLeft: 'auto'},
  tileValue: {...typography.caption, color: t.text, marginTop: 2},
  mono: {fontFamily: 'monospace'},

  statFlash: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: -2,
    height: 22,
    borderRadius: radius.sm,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: t.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statGlyph: {fontSize: 13, fontWeight: '700'},
  statText: {flexShrink: 1},
  statValue: {...typography.numeric, fontSize: 18, color: t.text},
  statLabel: {...typography.caption, color: t.textDim},

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  leaderLabel: {...typography.caption, color: t.textDim, flexShrink: 0},
  leader: {
    flex: 1,
    borderBottomWidth: 1,
    borderStyle: 'dotted',
    borderColor: t.border,
    marginBottom: 3,
  },
  leaderValue: {
    ...typography.caption,
    color: t.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  badge: {
    backgroundColor: t.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {color: t.accent, fontSize: 11, fontWeight: '700'},

  section: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  // Muted rather than accent-coloured: with eight sections on the Debug screen, eight
  // blue glyphs is eight things asking for attention at once.
  sectionGlyph: {fontSize: 12, color: t.textDim},
  sectionTitle: {...typography.overline, color: t.textDim, flexShrink: 1},
  spacer: {flex: 1},
}));
