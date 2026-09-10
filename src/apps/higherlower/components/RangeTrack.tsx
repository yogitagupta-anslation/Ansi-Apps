import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Guess, Range } from '../types/game';
import { rangeSize } from '../game/engine';
import { Palette, radius, spacing, tabular, type, verdictColor } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface RangeTrackProps {
  range: Range;
  /** What is still possible after the feedback so far. */
  known: Range;
  guesses: Guess[];
}

/**
 * The narrowing bar -- a picture of the player's own reasoning.
 *
 * Everything ruled out is greyed; what survives is lit, and it slides closed as
 * the round goes on. Seeing the field collapse by half is what makes "guess the
 * middle" feel like a move rather than a maths lesson.
 *
 * The lit part used to carry the word POSSIBLE. A ten-pixel label inside a
 * sixteen-pixel bar reads as a squeeze rather than a caption, and it said what
 * the count directly above it already says -- so the bar is now just a bar.
 */
export default function RangeTrack({ range, known, guesses }: RangeTrackProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  const span = Math.max(1, rangeSize(range) - 1);
  const frac = (value: number) => (value - range.min) / span;
  const remaining = rangeSize(known);

  const leftPx = frac(known.min) * width;
  const widthPx = Math.max(width > 0 ? 6 : 0, (frac(known.max) - frac(known.min)) * width);

  const left = useRef(new Animated.Value(0)).current;
  const size = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (width === 0) return;
    Animated.parallel([
      Animated.timing(left, { toValue: leftPx, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(size, { toValue: widthPx, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [leftPx, widthPx, width, left, size]);

  return (
    <View style={styles.wrap}>
      <View style={styles.labels}>
        <Text style={styles.edge}>{range.min.toLocaleString('en-US')}</Text>
        <Text style={styles.remaining}>
          {remaining > 1 ? `${remaining.toLocaleString('en-US')} numbers remain` : 'one number remains'}
        </Text>
        <Text style={styles.edge}>{range.max.toLocaleString('en-US')}</Text>
      </View>

      <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.window, { left, width: size }]} />

        {guesses.map((guess, index) => {
          const isLast = index === guesses.length - 1;
          return (
            <View
              key={`${guess.value}-${index}`}
              style={[
                styles.tick,
                {
                  left: frac(guess.value) * width,
                  backgroundColor: verdictColor(guess.verdict, colors),
                  opacity: isLast ? 1 : 0.4,
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  edge: {
    ...type.numCaption,
    ...tabular,
    color: colors.textMuted,
  },
  remaining: {
    ...type.label,
    color: colors.textSecondary,
  },
  track: {
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    borderWidth: 1,
    borderColor: colors.divider,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  window: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    // No border. An outlined pill on a track reads as a control you can drag,
    // and this is a readout -- the fill alone says which part is still live.
    backgroundColor: colors.accentDim,
  },
  tick: {
    position: 'absolute',
    width: 3,
    height: 20,
    marginLeft: -1.5,
    borderRadius: 2,
  },
});
