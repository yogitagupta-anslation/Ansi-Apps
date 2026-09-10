import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Guess } from '../types/game';
import { guessQuality } from '../game/search';
import { heatLabel } from '../game/engine';
import { Palette, radius, spacing, tabular, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface GuessImpactProps {
  guess: Guess;
  /** Candidates that were still standing before this guess. */
  before: number;
  /** Blind rounds hide the counts and leave only the proximity read. */
  hideCounts?: boolean;
}

/**
 * What that guess actually bought you.
 *
 * Showing "you ruled out 49 of 99" after every guess is the whole teaching
 * mechanism: players work out on their own that the middle removes the most,
 * and start hunting for the biggest cut instead of the luckiest number.
 */
export default function GuessImpact({ guess, before, hideCounts = false }: GuessImpactProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const quality = guessQuality(guess);
  const share = before > 0 ? Math.min(1, guess.eliminated / before) : 0;

  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [guess, grow]);

  const barWidth = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.round(share * 100)}%`] });
  const tone = quality >= 0.9 ? colors.correct : quality >= 0.6 ? colors.accent : colors.higher;

  if (hideCounts) {
    return guess.heat ? (
      <View style={styles.wrap}>
        <Text style={[styles.heat, { color: tone }]}>{heatLabel(guess.heat)}</Text>
      </View>
    ) : null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headline}>
        <Text style={styles.lead}>You ruled out </Text>
        <Text style={[styles.count, { color: tone }]}>{guess.eliminated.toLocaleString('en-US')}</Text>
        <Text style={styles.lead}> of {before.toLocaleString('en-US')}</Text>
      </View>

      <View style={styles.bar}>
        <Animated.View style={[styles.barFill, { width: barWidth, backgroundColor: tone }]} />
      </View>

      {guess.heat ? <Text style={[styles.heat, { color: tone }]}>{heatLabel(guess.heat)}</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'stretch',
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  lead: {
    ...type.caption,
    color: colors.textMuted,
  },
  count: {
    ...type.numHeading,
    ...tabular,
  },
  bar: {
    height: 6,
    alignSelf: 'stretch',
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  heat: {
    ...type.label,
    marginTop: spacing.xxs,
  },
});
