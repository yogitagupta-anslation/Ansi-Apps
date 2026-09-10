import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import OptionGrid from '../components/OptionGrid';
import ModifierPicker from '../components/ModifierPicker';
import SegmentedControl from '../components/SegmentedControl';
import { RANGE_PRESETS, formatRange, presetPar, useSettings } from '../settings/SettingsProvider';
import { AI_PROFILES } from '../game/ai';
import { parGuesses } from '../game/engine';
import { resolveRules } from '../game/modifiers';
import { Difficulty } from '../types/game';
import { Palette, radius, spacing, type } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

interface SoloSetupScreenProps {
  onBack: () => void;
  onStart: () => void;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'adaptive'];

export default function SoloSetupScreen({ onBack, onStart }: SoloSetupScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { rangeId, setRangeId, difficulty, setDifficulty, range, modifiers, toggleModifierId, matchRounds, setMatchRounds } =
    useSettings();
  const profile = AI_PROFILES[difficulty];
  const rules = resolveRules(range, modifiers);

  return (
    <Screen
      title="Solo"
      subtitle="You versus the machine"
      onBack={onBack}
      scroll
      footer={<Button label="Start round" icon="play" onPress={onStart} />}
    >
      <View style={styles.section}>
        <Text style={styles.label}>NUMBER RANGE</Text>
        <OptionGrid
          options={RANGE_PRESETS.map((preset) => ({
            value: preset.id,
            title: preset.label,
            meta: `par ${presetPar(preset)}`,
            subtitle: formatRange(preset.range),
          }))}
          value={rangeId}
          onChange={setRangeId}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>OPPONENT</Text>
        <OptionGrid
          options={DIFFICULTIES.map((id) => ({
            value: id,
            title: AI_PROFILES[id].name,
            subtitle: AI_PROFILES[id].blurb,
          }))}
          value={difficulty}
          onChange={setDifficulty}
        />
        <Text style={styles.hint}>
          Guesses every {(profile.thinkMs[0] / 1000).toFixed(1)}–{(profile.thinkMs[1] / 1000).toFixed(1)}s
          {profile.adaptive ? ' — until it works out how fast you are' : ''}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>LENGTH</Text>
        <SegmentedControl
          segments={[
            { value: '1', label: 'Single', hint: 'one round' },
            { value: '3', label: 'Best of 3', hint: 'first to 2' },
          ]}
          value={String(matchRounds)}
          onChange={(v) => setMatchRounds(Number(v))}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.modHead}>
          <Text style={styles.label}>MODIFIERS</Text>
          <Text style={styles.modCount}>
            {modifiers.length === 0 ? 'none — pure higher/lower' : `${modifiers.length} on · +${modifiers.length * 15}% score`}
          </Text>
        </View>
        <ModifierPicker active={modifiers} onToggle={toggleModifierId} />
      </View>

      <View style={styles.brief}>
        <Text style={styles.briefTitle}>The round</Text>
        <Text style={styles.briefLine}>
          One number between {range.min.toLocaleString('en-US')} and {range.max.toLocaleString('en-US')} is hidden from
          both of you.
        </Text>
        <Text style={styles.briefLine}>
          You both guess at the same time — no turns. Every guess comes back HIGHER or LOWER
          {rules.heat ? ', plus how close you landed' : ''}.
        </Text>
        <Text style={styles.briefLine}>
          {rules.guessLimit !== null
            ? `${rules.guessLimit} guesses each — run out and you are eliminated.`
            : `A perfect player needs ${parGuesses(range)} guesses, but there is no limit — take as many as you like.`}
        </Text>
        {rules.movesEvery ? (
          <Text style={styles.briefLine}>
            The number moves every {rules.movesEvery} guesses — always somewhere your answers still allow.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  label: {
    ...type.label,
    color: colors.textMuted,
  },
  modHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modCount: {
    ...type.micro,
    color: colors.accent,
  },
  hint: {
    ...type.caption,
    color: colors.textMuted,
  },
  brief: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  briefTitle: {
    ...type.label,
    color: colors.accent,
    marginBottom: spacing.xxs,
  },
  briefLine: {
    ...type.sub,
    color: colors.textSecondary,
  },
});
