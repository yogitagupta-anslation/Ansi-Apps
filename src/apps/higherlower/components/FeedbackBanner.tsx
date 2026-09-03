import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Verdict } from '../types/game';
import { verdictIcon, verdictLabel } from '../game/engine';
import { Palette, fonts, radius, spacing, verdictColor, verdictGlow } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface FeedbackBannerProps {
  verdict: Verdict | null;
  /** Changes whenever a new verdict lands, so repeats still replay the pop. */
  nonce: number;
  /** Shown in place of a verdict before the first guess. */
  idleText?: string;
}

/**
 * "⬇️ LOWER" / "🎯 CORRECT!" -- the app's answer to a guess. It pops on every
 * new verdict so a repeated direction still reads as a fresh response.
 */
export default function FeedbackBanner({ verdict, nonce, idleText = 'Take a guess' }: FeedbackBannerProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!verdict) return;
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.back(2)),
      useNativeDriver: true,
    }).start();
  }, [verdict, nonce, pop]);

  if (!verdict) {
    return (
      <View style={[styles.banner, styles.idle]}>
        <Text style={styles.idleText}>{idleText}</Text>
      </View>
    );
  }

  const tint = verdictColor(verdict, colors);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLabel={verdictLabel(verdict)}
      style={[
        styles.banner,
        {
          borderColor: tint,
          backgroundColor: verdictGlow(verdict, colors),
          opacity: pop,
          transform: [{ scale }],
        },
      ]}
    >
      <Text style={styles.icon}>{verdictIcon(verdict)}</Text>
      <Text style={[styles.label, { color: tint }]}>{verdictLabel(verdict)}</Text>
    </Animated.View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    minWidth: 190,
  },
  idle: {
    borderColor: colors.divider,
    backgroundColor: 'transparent',
  },
  idleText: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 13,
  },
  icon: {
    fontSize: 18,
  },
  label: {
    ...fonts.label,
    fontSize: 20,
    letterSpacing: 2,
  },
});
