import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import { judge, verdictIcon, verdictLabel } from '../game/engine';
import { MODIFIERS } from '../game/modifiers';
import { RANGE_PRESETS, formatRange, presetPar } from '../settings/SettingsProvider';
import { Palette, fonts, radius, spacing, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

/** The worked example, judged by the real engine so the docs cannot drift. */
const EXAMPLE_TARGET = 37;
const EXAMPLE_GUESSES = [50, 42, 39, 38, 37];

const SCORE_LINES = [
  { points: '+100', label: 'Found the number' },
  { points: '+50', label: 'At or under par' },
  { points: '+25', label: 'Fast finish' },
  { points: '−10', label: 'Each guess over par' },
  { points: '−15', label: 'A risky guess that missed' },
  { points: '+15%', label: 'Per modifier you played with' },
];

export default function HowToPlayScreen({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <Screen title="How to play" onBack={onBack} scroll>
      <Section title="The idea">
        <Text style={styles.body}>
          The app hides one number. You guess. It tells you whether to go higher or lower. Keep going until you land on
          it — in as few guesses as you can, as fast as you can.
        </Text>
      </Section>

      <Section title="A round, start to finish">
        <View style={styles.example}>
          <View style={styles.targetRow}>
            <Text style={styles.targetLabel}>🎯 TARGET</Text>
            <Text style={styles.targetValue}>{EXAMPLE_TARGET}</Text>
            <Text style={styles.targetHint}>hidden from everyone</Text>
          </View>

          {EXAMPLE_GUESSES.map((value) => {
            const verdict = judge(value, EXAMPLE_TARGET);
            return (
              <View key={value} style={styles.exampleRow}>
                <Text style={styles.exampleGuess}>{value}</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.textMuted} />
                <View style={[styles.exampleVerdict, { borderColor: verdictColor(verdict, colors) }]}>
                  <Text style={styles.exampleIcon}>{verdictIcon(verdict)}</Text>
                  <Text style={[styles.exampleVerdictText, { color: verdictColor(verdict, colors) }]}>
                    {verdictLabel(verdict)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={styles.caption}>
          HIGHER and LOWER describe where your next guess should go, not where the number sits.
        </Text>
      </Section>

      <Section title="Guess impact">
        <Text style={styles.body}>
          After every guess the board shows how many numbers you just ruled out. Guessing the middle of what is still
          possible removes half the field; guessing near an edge removes almost nothing. Chase the biggest cut and the
          rest looks after itself.
        </Text>
        <Text style={styles.body}>
          The bar under the verdict is that cut, and the result screen turns your whole round into a{' '}
          <Text style={styles.bold}>search quality</Text> percentage.
        </Text>
      </Section>

      <Section title="Ranges and par">
        <View style={styles.table}>
          {RANGE_PRESETS.map((preset) => (
            <View key={preset.id} style={styles.tableRow}>
              <Text style={styles.tableKey}>{preset.label}</Text>
              <Text style={styles.tableMid}>{formatRange(preset.range)}</Text>
              <Text style={styles.tableValue}>par {presetPar(preset)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.caption}>
          Par is what a perfect binary search needs. There is no limit on guesses — par is a benchmark, not a budget.
        </Text>
      </Section>

      <Section title="Modifiers">
        <Text style={styles.body}>
          Plain higher/lower has exactly one optimal strategy. Each modifier breaks a different assumption that strategy
          leans on, and every one you switch on is worth 15% more score.
        </Text>
        <View style={styles.mods}>
          {MODIFIERS.map((modifier) => (
            <View key={modifier.id} style={styles.modRow}>
              <Text style={styles.modIcon}>{modifier.icon}</Text>
              <View style={styles.modBody}>
                <Text style={styles.modName}>{modifier.name}</Text>
                <Text style={styles.modBlurb}>{modifier.blurb}</Text>
              </View>
            </View>
          ))}
        </View>
      </Section>

      <Section title="Score">
        <View style={styles.table}>
          {SCORE_LINES.map((line) => (
            <View key={line.label} style={styles.tableRow}>
              <Text style={[styles.points, line.points.startsWith('−') ? styles.pointsBad : styles.pointsGood]}>
                {line.points}
              </Text>
              <Text style={styles.scoreLabel}>{line.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.caption}>
          Speed still decides the winner, but score rewards the smarter round — so a slow, surgical run is worth
          something even when you lose the race.
        </Text>
      </Section>

      <Section title="Solo">
        <Text style={styles.body}>
          You and a bot get the same hidden number at the same moment. It is not turn-based — the bot guesses on its own
          clock while you type. Rookie wanders, Bisector halves the range perfectly, and Mirror watches how you play and
          retunes itself to match. Whoever gets there first wins, but the round stays open until you have both found it.
        </Text>
      </Section>

      <Section title="Multiplayer">
        <Text style={styles.body}>
          One phone hosts and sends the hidden number to everyone in Bluetooth range. Every guess is relayed as it is
          made, so each lane shows the others closing in. The host picks the mode:
        </Text>
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.tableKey}>Speed</Text>
            <Text style={styles.scoreLabel}>First correct guess wins</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableKey}>Fewest</Text>
            <Text style={styles.scoreLabel}>Fewest guesses wins, time breaks ties</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableKey}>Survival</Text>
            <Text style={styles.scoreLabel}>Par guesses each — run out and you are eliminated</Text>
          </View>
        </View>
        <Text style={styles.caption}>
          Play a single round or best of three. Nobody is cut off when someone wins: everyone finishes, and the results
          list what each player took.
        </Text>
      </Section>

      <Section title="Daily challenge">
        <Text style={styles.body}>
          One round a day, generated from the date — same range, same twists, same hidden number on every phone. Your
          best score for the day is kept on your profile.
        </Text>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...fonts.label,
    color: colors.accent,
    fontSize: 11,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  bold: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  example: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    gap: spacing.sm,
  },
  targetRow: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  targetLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
  },
  targetValue: {
    ...fonts.numeric,
    color: colors.gold,
    fontSize: 40,
  },
  targetHint: {
    color: colors.textMuted,
    fontSize: 10,
    fontStyle: 'italic',
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  exampleGuess: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 20,
    width: 44,
  },
  exampleVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  exampleIcon: {
    fontSize: 11,
  },
  exampleVerdictText: {
    ...fonts.label,
    fontSize: 12,
  },
  caption: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  table: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    gap: 6,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tableKey: {
    ...fonts.label,
    color: colors.textPrimary,
    fontSize: 12,
    width: 74,
  },
  tableMid: {
    ...fonts.numeric,
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  tableValue: {
    ...fonts.numeric,
    color: colors.accent,
    fontSize: 12,
  },
  points: {
    ...fonts.numeric,
    fontSize: 13,
    width: 52,
  },
  pointsGood: {
    color: colors.correct,
  },
  pointsBad: {
    color: colors.danger,
  },
  scoreLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  mods: {
    gap: spacing.sm,
  },
  modRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  modIcon: {
    fontSize: 15,
    width: 22,
  },
  modBody: {
    flex: 1,
  },
  modName: {
    ...fonts.label,
    color: colors.textPrimary,
    fontSize: 12,
  },
  modBlurb: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
});
