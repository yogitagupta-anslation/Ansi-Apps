import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Racer } from '../types/game';
import { verdictIcon } from '../game/engine';
import { formatDuration } from '../util/format';
import { Palette, radius, spacing, tabular, type, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface DuelPanelProps {
  you: Racer;
  them: Racer;
  /** Fewest guesses a perfect player would need. */
  par: number;
  winnerId: string | null;
  /** Round start, epoch ms — the panel runs its own clock from it. */
  startedAt: number;
  running: boolean;
  /** Blind rounds hide the opponent's actual number. */
  hideGuesses?: boolean;
}

/**
 * Head-to-head. With one opponent there is no leaderboard to read -- there is
 * only "am I ahead?" -- so the two of you sit side by side with the same three
 * numbers each.
 */
export default function DuelPanel({ you, them, par, winnerId, startedAt, running, hideGuesses }: DuelPanelProps) {
  const styles = useThemedStyles(makeStyles);
  const [now, setNow] = useState(() => Date.now());

  // Ticking here rather than in the parent keeps the re-render to this panel.
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;

  return (
    <View style={styles.wrap}>
      <Side racer={you} label="YOU" par={par} winner={winnerId === you.id} elapsedMs={elapsedMs} align="flex-start" />
      <View style={styles.divider}>
        <Text style={styles.vs}>VS</Text>
      </View>
      <Side
        racer={them}
        label={them.name.toUpperCase()}
        par={par}
        winner={winnerId === them.id}
        elapsedMs={elapsedMs}
        align="flex-end"
        hideGuess={hideGuesses}
      />
    </View>
  );
}

function Side({
  racer,
  label,
  par,
  winner,
  elapsedMs,
  align,
  hideGuess,
}: {
  racer: Racer;
  label: string;
  par: number;
  winner: boolean;
  elapsedMs: number;
  align: 'flex-start' | 'flex-end';
  hideGuess?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const last = racer.guesses[racer.guesses.length - 1] ?? null;
  const done = racer.finishedAt !== null;
  const progress = Math.min(1, racer.guesses.length / Math.max(1, par));
  const tone = racer.kind === 'you' ? colors.accent : colors.textSecondary;

  return (
    <View style={[styles.side, { alignItems: align }]}>
      <View style={styles.nameRow}>
        {winner ? <Ionicons name="trophy" size={12} color={colors.gold} /> : null}
        <Text style={[styles.name, winner && styles.nameWin]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      <Text style={[styles.count, { color: tone }]}>{racer.guesses.length}</Text>
      <Text style={styles.countLabel}>{racer.guesses.length === 1 ? 'guess' : 'guesses'}</Text>

      <Text style={[styles.time, racer.offline && styles.timeOff]}>
        {racer.offline
          ? 'reconnecting…'
          : done
            ? formatDuration(racer.finishedAt ?? 0)
            : racer.eliminated
              ? 'out'
              : formatDuration(elapsedMs)}
      </Text>

      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: tone }]} />
      </View>

      {last ? (
        <Text style={[styles.last, { color: verdictColor(last.verdict, colors) }]}>
          {hideGuess ? '•••' : last.value.toLocaleString('en-US')} {verdictIcon(last.verdict)}
        </Text>
      ) : (
        <Text style={styles.lastIdle}>—</Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  side: {
    flex: 1,
    gap: 1,
  },
  divider: {
    paddingHorizontal: spacing.sm,
  },
  vs: {
    ...type.micro,
    color: colors.textMuted,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...type.micro,
    color: colors.textMuted,
  },
  nameWin: {
    color: colors.gold,
  },
  count: {
    ...type.numDisplay,
    ...tabular,
    fontSize: 26,
    lineHeight: 30,
  },
  countLabel: {
    ...type.micro,
    letterSpacing: 0,
    color: colors.textMuted,
    marginTop: -spacing.xxs,
  },
  time: {
    ...type.numCaption,
    ...tabular,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  timeOff: {
    color: colors.higher,
  },
  bar: {
    height: 5,
    alignSelf: 'stretch',
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  last: {
    ...type.numCaption,
    ...tabular,
    marginTop: spacing.xxs,
  },
  lastIdle: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
});
