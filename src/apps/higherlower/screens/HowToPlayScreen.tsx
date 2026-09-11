import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import { judge, verdictIcon, verdictLabel } from '../game/engine';
import { MODIFIERS } from '../game/modifiers';
import { RANGE_PRESETS, formatRange, presetPar } from '../settings/SettingsProvider';
import { Palette, glyph, radius, spacing, tabular, type, verdictColor } from '../theme/tokens';
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
          One phone hosts and gets a four-letter room code; everyone else types it on their Join screen, or picks the
          room off the list of what their radio can hear. The host decides how many phones may join, holds the start
          button, and sends the hidden number to all of them at once. Every guess is relayed as it is made, so each lane
          shows the others closing in. The host picks the mode:
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
    ...type.label,
    color: colors.accent,
  },
  body: {
    ...type.sub,
    color: colors.textSecondary,
  },
  // Weight comes from the family, never from fontWeight: Android will not
  // synthesise a bold face for a custom family and silently renders regular.
  bold: {
    fontFamily: type.body.fontFamily,
    color: colors.textPrimary,
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
    ...type.micro,
    color: colors.textMuted,
  },
  targetValue: {
    ...type.numDisplay,
    ...tabular,
    color: colors.gold,
  },
  targetHint: {
    ...type.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  exampleGuess: {
    ...type.numTitle,
    ...tabular,
    color: colors.textPrimary,
    width: 48,
  },
  exampleVerdict: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  exampleIcon: {
    fontSize: glyph.sm,
  },
  exampleVerdictText: {
    ...type.micro,
  },
  caption: {
    ...type.caption,
    color: colors.textMuted,
  },
  table: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    gap: spacing.sm,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tableKey: {
    ...type.caption,
    fontFamily: type.body.fontFamily,
    color: colors.textPrimary,
    width: 80,
  },
  tableMid: {
    ...type.numCaption,
    ...tabular,
    color: colors.textSecondary,
    flex: 1,
  },
  tableValue: {
    ...type.numCaption,
    ...tabular,
    color: colors.accent,
  },
  points: {
    ...type.numCaption,
    ...tabular,
    width: 56,
  },
  pointsGood: {
    color: colors.correct,
  },
  pointsBad: {
    color: colors.danger,
  },
  scoreLabel: {
    ...type.caption,
    color: colors.textSecondary,
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
    fontSize: glyph.md,
    width: 24,
  },
  modBody: {
    flex: 1,
  },
  modName: {
    ...type.body,
    color: colors.textPrimary,
  },
  modBlurb: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
});
