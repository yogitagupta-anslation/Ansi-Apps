import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import Button from '../components/Button';
import BigNumber from '../components/BigNumber';
import { Racer, RoundSummary } from '../types/game';
import { verdictIcon, verdictLabel } from '../game/engine';
import { ModifierId, modifierById } from '../game/modifiers';
import { qualityBand, searchQuality } from '../game/search';
import { rankRacers, scoreRound } from '../game/scoring';
import { Achievement } from '../game/progress';
import { formatDuration, plural } from '../util/format';
import { feedback } from '../util/feedback';
import { Palette, fonts, radius, spacing, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface ResultScreenProps {
  summary: RoundSummary;
  youId: string;
  onPlayAgain: () => void;
  playAgainLabel?: string;
  onHome: () => void;
  /** Shown under the headline while a match is still running. */
  matchLine?: string | null;
  /** Badges this round earned, celebrated once. */
  unlocked?: Achievement[];
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export default function ResultScreen({
  summary,
  youId,
  onPlayAgain,
  playAgainLabel = 'Play again',
  onHome,
  matchLine,
  unlocked = [],
}: ResultScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  useEffect(() => {
    if (unlocked.length > 0) feedback.unlock();
  }, [unlocked]);

  const ranked = rankRacers(summary);
  const you = summary.racers.find((r) => r.id === youId);
  const winner = summary.racers.find((r) => r.id === summary.winnerId);
  const youWon = summary.winnerId === youId;

  const yourScore = you ? scoreRound(you, summary) : null;
  const quality = you ? searchQuality(you.guesses) : 0;
  const band = qualityBand(quality);

  /** How you stack up against the racer directly beside you on the board. */
  const comparisons = (() => {
    if (!you || ranked.length < 2) return [];
    const myIndex = ranked.findIndex((r) => r.id === youId);
    const rival = ranked[myIndex === 0 ? 1 : myIndex - 1];
    if (!rival) return [];
    const lines: string[] = [];

    if (you.finishedAt !== null && rival.finishedAt !== null) {
      const gap = Math.abs(you.finishedAt - rival.finishedAt);
      lines.push(
        `⚡ ${formatDuration(gap)} ${you.finishedAt < rival.finishedAt ? 'faster than' : 'behind'} ${rival.name}`,
      );
    }
    const guessGap = rival.guesses.length - you.guesses.length;
    if (guessGap !== 0) {
      lines.push(
        `🧠 ${plural(Math.abs(guessGap), 'guess')} ${guessGap > 0 ? 'better than' : 'more than'} ${rival.name}`,
      );
    }
    return lines;
  })();

  return (
    <Screen
      footer={
        <>
          <Button label={playAgainLabel} icon="refresh" onPress={onPlayAgain} />
          <Button label="Back to menu" variant="secondary" onPress={onHome} />
        </>
      }
      scroll
    >
      <View style={[styles.headline, youWon ? styles.headlineWin : styles.headlineLose]}>
        <Ionicons name={youWon ? 'trophy' : 'flag'} size={20} color={youWon ? colors.gold : colors.textSecondary} />
        <Text style={[styles.headlineText, youWon && styles.headlineTextWin]}>
          {youWon ? 'YOU WIN' : winner ? `${winner.name.toUpperCase()} WINS` : 'ROUND OVER'}
        </Text>
      </View>

      {matchLine ? <Text style={styles.matchLine}>{matchLine}</Text> : null}

      {unlocked.length > 0 ? (
        <View style={styles.unlockedRow}>
          {unlocked.map((badge) => (
            <View key={badge.id} style={styles.unlocked}>
              <Text style={styles.unlockedIcon}>{badge.icon}</Text>
              <View>
                <Text style={styles.unlockedName}>{badge.name}</Text>
                <Text style={styles.unlockedTag}>ACHIEVEMENT UNLOCKED</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.target}>
        <BigNumber value={String(summary.target)} caption="🎯 THE NUMBER WAS" tone={colors.gold} />
      </View>

      {you ? (
        <View style={styles.yourCard}>
          <View style={styles.yourTop}>
            <View>
              <Text style={styles.yourName}>{you.name}</Text>
              <Text style={styles.yourMeta}>
                {you.finishedAt !== null
                  ? `${plural(you.guesses.length, 'guess')} · ${formatDuration(you.finishedAt)}`
                  : you.eliminated
                    ? `${plural(you.guesses.length, 'guess')} · eliminated`
                    : `${plural(you.guesses.length, 'guess')} · didn't finish`}
              </Text>
            </View>
            <View style={styles.scoreBox}>
              <Text style={styles.scoreValue}>{yourScore?.total ?? 0}</Text>
              <Text style={styles.scoreLabel}>SCORE</Text>
            </View>
          </View>

          <View style={styles.qualityRow}>
            <Text style={styles.qualityLabel}>SEARCH QUALITY</Text>
            <Text style={[styles.qualityValue, { color: colors.accent }]}>{Math.round(quality * 100)}%</Text>
          </View>
          <View style={styles.qualityBar}>
            <View style={[styles.qualityFill, { width: `${Math.round(quality * 100)}%` }]} />
          </View>
          <Text style={styles.qualityHint}>
            {band.label} — {band.hint}
          </Text>

          {comparisons.map((line) => (
            <Text key={line} style={styles.compare}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaItem}>
          Range {summary.range.min.toLocaleString('en-US')}–{summary.range.max.toLocaleString('en-US')}
        </Text>
        <Text style={styles.metaItem}>Par {summary.parGuesses}</Text>
        <Text style={styles.metaItem}>
          {summary.mode === 'efficiency'
            ? 'Fewest guesses'
            : summary.mode === 'elimination'
              ? 'Survival'
              : summary.mode === 'sudden'
                ? 'Sudden death'
                : 'Speed'}
        </Text>
      </View>

      {summary.modifiers.length > 0 ? (
        <View style={styles.modRow}>
          {summary.modifiers.map((id) => {
            const modifier = modifierById(id as ModifierId);
            return (
              <Text key={id} style={styles.modChip}>
                {modifier.icon} {modifier.name}
              </Text>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>STANDINGS</Text>
      <View style={styles.board}>
        {ranked.map((racer, index) => (
          <StandingRow
            key={racer.id}
            racer={racer}
            place={ORDINALS[index] ?? `${index + 1}th`}
            score={scoreRound(racer, summary).total}
            isYou={racer.id === youId}
            isWinner={racer.id === summary.winnerId}
          />
        ))}
      </View>

      {yourScore && yourScore.lines.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>SCORE BREAKDOWN</Text>
          <View style={styles.panel}>
            {yourScore.lines.map((line, index) => (
              <View key={`${line.label}-${index}`} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{line.label}</Text>
                <Text
                  style={[
                    styles.breakdownPoints,
                    { color: line.points >= 0 ? colors.correct : colors.danger },
                  ]}
                >
                  {line.points >= 0 ? '+' : ''}
                  {line.points}
                </Text>
              </View>
            ))}
            <View style={[styles.breakdownRow, styles.breakdownTotal]}>
              <Text style={styles.breakdownTotalLabel}>Total</Text>
              <Text style={styles.breakdownTotalValue}>{yourScore.total}</Text>
            </View>
          </View>
        </>
      ) : null}

      {you && you.guesses.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>YOUR ROUND</Text>
          <View style={styles.panel}>
            {you.guesses.map((guess, index) => (
              <View key={`${guess.value}-${index}`} style={styles.logRow}>
                <Text style={styles.logIndex}>{index + 1}</Text>
                <Text style={styles.logValue}>{guess.value.toLocaleString('en-US')}</Text>
                <Text style={[styles.logVerdict, { color: verdictColor(guess.verdict, colors) }]}>
                  {verdictIcon(guess.verdict)} {verdictLabel(guess.verdict)}
                </Text>
                <Text style={styles.logImpact}>
                  {guess.wagered ? '🎲 ' : ''}
                  {guess.eliminated > 0 ? `−${guess.eliminated.toLocaleString('en-US')}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function StandingRow({
  racer,
  place,
  score,
  isYou,
  isWinner,
}: {
  racer: Racer;
  place: string;
  score: number;
  isYou: boolean;
  isWinner: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.row, isWinner && styles.rowWinner]}>
      <Text style={styles.place}>{place}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {racer.name}
          {isYou ? ' (you)' : ''}
        </Text>
        <Text style={styles.rowMeta}>
          {plural(racer.guesses.length, 'guess')}
          {racer.finishedAt !== null
            ? ` · ${formatDuration(racer.finishedAt)}`
            : racer.eliminated
              ? ' · eliminated'
              : " · didn't finish"}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowScore, isWinner && styles.rowScoreWin]}>{score}</Text>
        {isWinner ? <Ionicons name="trophy" size={13} color={colors.gold} /> : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    marginTop: spacing.md,
  },
  headlineWin: {
    borderColor: colors.gold,
    backgroundColor: colors.goldTint,
  },
  headlineLose: {
    borderColor: colors.divider,
    backgroundColor: colors.wash,
  },
  headlineText: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 18,
    letterSpacing: 3,
  },
  headlineTextWin: {
    color: colors.gold,
  },
  matchLine: {
    ...fonts.label,
    color: colors.accent,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  unlockedRow: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  unlocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.goldTint,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  unlockedIcon: {
    fontSize: 20,
  },
  unlockedName: {
    ...fonts.label,
    color: colors.gold,
    fontSize: 13,
  },
  unlockedTag: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 8,
  },
  target: {
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  yourCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
    gap: 6,
    marginBottom: spacing.md,
  },
  yourTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  yourName: {
    ...fonts.title,
    color: colors.textPrimary,
    fontSize: 17,
  },
  yourMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  scoreBox: {
    alignItems: 'flex-end',
  },
  scoreValue: {
    ...fonts.numeric,
    color: colors.accent,
    fontSize: 30,
  },
  scoreLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 9,
  },
  qualityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  qualityLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
  },
  qualityValue: {
    ...fonts.numeric,
    fontSize: 14,
  },
  qualityBar: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  qualityFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  qualityHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  compare: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  metaItem: {
    color: colors.textMuted,
    fontSize: 11,
  },
  modRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.md,
  },
  modChip: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDim,
    overflow: 'hidden',
  },
  sectionLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  board: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  rowWinner: {
    borderColor: colors.gold,
    backgroundColor: colors.goldTint,
  },
  place: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 11,
    width: 26,
  },
  rowBody: {
    flex: 1,
  },
  rowName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 2,
    minWidth: 46,
  },
  rowScore: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 17,
  },
  rowScoreWin: {
    color: colors.gold,
  },
  panel: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  breakdownLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  breakdownPoints: {
    ...fonts.numeric,
    fontSize: 13,
  },
  breakdownTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    marginTop: 4,
    paddingTop: 8,
  },
  breakdownTotalLabel: {
    ...fonts.label,
    color: colors.textPrimary,
    fontSize: 12,
  },
  breakdownTotalValue: {
    ...fonts.numeric,
    color: colors.accent,
    fontSize: 18,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  logIndex: {
    ...fonts.numeric,
    color: colors.textMuted,
    fontSize: 11,
    width: 16,
  },
  logValue: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 15,
    width: 62,
  },
  logVerdict: {
    ...fonts.label,
    fontSize: 11,
    flex: 1,
  },
  logImpact: {
    ...fonts.numeric,
    color: colors.textMuted,
    fontSize: 11,
  },
});
