import React from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Screen from '../components/Screen';
import SegmentedControl from '../components/SegmentedControl';
import OptionGrid from '../components/OptionGrid';
import { RANGE_PRESETS, formatRange, presetPar, useSettings } from '../settings/SettingsProvider';
import { AI_PROFILES } from '../game/ai';
import { Difficulty } from '../types/game';
import { MIN_TOUCH, Palette, radius, spacing, type } from '../theme/tokens';
import { Appearance, useTheme, useThemedStyles } from '../theme/ThemeProvider';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard', 'adaptive'];

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { colors, appearance, setAppearance, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { playerName, setPlayerName, rangeId, setRangeId, difficulty, setDifficulty, haptics, setHaptics, sound, setSound } =
    useSettings();

  return (
    <Screen title="Settings" onBack={onBack} scroll>
      <View style={styles.section}>
        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          value={playerName}
          onChangeText={(text) => setPlayerName(text.slice(0, 12))}
          placeholder="You"
          placeholderTextColor={colors.textMuted}
          maxLength={12}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Your display name"
          style={styles.input}
        />
        <Text style={styles.hint}>Shown to other players in the lobby and on their race lanes.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>DEFAULT RANGE</Text>
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
        <Text style={styles.hint}>Used for solo rounds, and for multiplayer rounds you host.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>SOLO OPPONENT</Text>
        <OptionGrid
          options={DIFFICULTIES.map((id) => ({
            value: id,
            title: AI_PROFILES[id].name,
            subtitle: AI_PROFILES[id].blurb,
          }))}
          value={difficulty}
          onChange={setDifficulty}
        />
        <Text style={styles.hint}>Used for solo rounds. Mirror retunes itself to how you play.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>APPEARANCE</Text>
        <SegmentedControl segments={APPEARANCES} value={appearance} onChange={setAppearance} />
        <Text style={styles.hint}>
          {appearance === 'system'
            ? `Following your phone — currently ${scheme}.`
            : `Always ${appearance}, whatever the phone is set to.`}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Sound</Text>
          <Text style={styles.hint}>Clicks for keys, a rise or fall for every verdict, a fanfare for the win.</Text>
        </View>
        <Switch
          value={sound}
          onValueChange={setSound}
          accessibilityLabel="Sound effects"
          trackColor={{ false: colors.buttonSecondary, true: colors.accent }}
          thumbColor={colors.textPrimary}
        />
      </View>

      <View style={[styles.row, styles.rowSpaced]}>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Haptics</Text>
          <Text style={styles.hint}>A tap for every verdict, a buzz when the round ends.</Text>
        </View>
        <Switch
          value={haptics}
          onValueChange={setHaptics}
          accessibilityLabel="Haptic feedback"
          trackColor={{ false: colors.buttonSecondary, true: colors.accent }}
          thumbColor={colors.textPrimary}
        />
      </View>

      <Text style={styles.footnote}>Settings live for this session only — they reset when the app restarts.</Text>
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
  input: {
    borderRadius: radius.md,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.textPrimary,
    ...type.body,
    // Android centres a TextInput's text against the input box, not against the
    // line box -- a lineHeight here rides the text high and leaves the caret
    // behind. Padding does the vertical spacing instead.
    lineHeight: undefined,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
  },
  hint: {
    ...type.caption,
    color: colors.textMuted,
  },
  rowSpaced: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH + spacing.md,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...type.body,
    color: colors.textPrimary,
  },
  footnote: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
