import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Guess } from '../types/game';
import { verdictIcon } from '../game/engine';
import { Palette, glyph, radius, spacing, tabular, type, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

/** Your own trail of guesses, newest first so the latest never scrolls away. */
export default function GuessHistory({ guesses }: { guesses: Guess[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (guesses.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Your guesses show up here</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {[...guesses].reverse().map((guess, index) => (
        <View
          key={`${guess.value}-${guesses.length - index}`}
          style={[styles.chip, { borderColor: verdictColor(guess.verdict, colors) }]}
        >
          <Text style={[styles.value, { color: verdictColor(guess.verdict, colors) }]}>{guess.value}</Text>
          <Text style={styles.icon}>{verdictIcon(guess.verdict)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  scroll: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.wash,
  },
  value: {
    ...type.numBody,
    ...tabular,
  },
  icon: {
    fontSize: glyph.sm,
  },
  empty: {
    height: 34,
    justifyContent: 'center',
  },
  emptyText: {
    ...type.caption,
    color: colors.textMuted,
  },
});
