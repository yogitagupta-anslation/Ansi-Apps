import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Racer } from '../types/game';
import { verdictIcon } from '../game/engine';
import { Palette, fonts, radius, spacing, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface RacerLaneProps {
  racer: Racer;
  isWinner: boolean;
  /** Fewest guesses a perfect player would need -- the bar's full width. */
  par: number;
  /** True while the round is live and this racer has not finished. */
  active: boolean;
  /** Personality line for a bot, shown while it thinks. */
  note?: string | null;
}

/**
 * One opponent's live lane: how many guesses they have burned, what they just
 * tried, and whether they are mid-think. This is the whole point of relaying
 * guesses over BLE -- you get to watch the other players close in.
 */
export default function RacerLane({ racer, isWinner, par, active, note }: RacerLaneProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const last = racer.guesses[racer.guesses.length - 1] ?? null;
  const count = racer.guesses.length;
  const progress = Math.min(1, count / Math.max(1, par));

  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (!active) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const tint = racer.kind === 'you' ? colors.accent : colors.textSecondary;

  return (
    <View style={[styles.row, isWinner && styles.rowWinner]}>
      <View style={[styles.avatar, { borderColor: tint }]}>
        <Text style={[styles.initial, { color: tint }]}>{racer.name.slice(0, 1).toUpperCase()}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {racer.name}
          </Text>
          {racer.kind === 'ai' ? <Text style={styles.tag}>AI</Text> : null}
          {isWinner ? <Ionicons name="trophy" size={13} color={colors.gold} /> : null}
          {racer.eliminated ? <Text style={styles.out}>OUT</Text> : null}
          {racer.offline ? <Text style={styles.off}>📡 RECONNECTING</Text> : null}
        </View>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
        </View>
      </View>

      <View style={styles.right}>
        {active && note ? <Text style={styles.note} numberOfLines={1}>{note}</Text> : null}
        {last ? (
          <Text style={[styles.lastGuess, { color: verdictColor(last.verdict, colors) }]}>
            {last.value} {verdictIcon(last.verdict)}
          </Text>
        ) : (
          <Animated.Text style={[styles.waiting, { opacity: active ? pulse : 0.35 }]}>
            {active ? 'thinking…' : 'waiting'}
          </Animated.Text>
        )}
        <Text style={styles.count}>{count === 1 ? '1 guess' : `${count} guesses`}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  rowWinner: {
    borderColor: colors.gold,
    backgroundColor: colors.goldTint,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    ...fonts.title,
    fontSize: 13,
  },
  body: {
    flex: 1,
    gap: 6,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
  tag: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 9,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  bar: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  right: {
    alignItems: 'flex-end',
    minWidth: 74,
  },
  lastGuess: {
    ...fonts.numeric,
    fontSize: 16,
  },
  waiting: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  note: {
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
    maxWidth: 120,
  },
  out: {
    ...fonts.label,
    color: colors.danger,
    fontSize: 9,
  },
  off: {
    ...fonts.label,
    color: colors.higher,
    fontSize: 9,
  },
  count: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
});
