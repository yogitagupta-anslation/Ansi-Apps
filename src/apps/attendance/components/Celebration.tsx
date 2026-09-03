/**
 * Celebration.tsx
 * -----------------------------------------------------------------------------
 * The success moment: a check mark that springs in, with confetti.
 *
 * Confetti is a fixed set of plain Views with randomised start offsets, animated
 * on the native driver. No particle library and no SVG — for a one-shot
 * celebration that plays for under two seconds, a dependency would cost more
 * than it returns.
 *
 * Respects reduce-motion: when the OS asks for less animation the confetti is
 * skipped entirely and the check simply appears. Motion this large is exactly
 * what that setting exists to suppress.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';

const PIECE_COUNT = 26;

interface Piece {
  left: number;
  delay: number;
  drift: number;
  size: number;
  color: string;
  spin: number;
}

export function Celebration({ playing = true }: { playing?: boolean }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);

  const pop = useRef(new Animated.Value(0)).current;
  const fall = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(on => {
      if (!cancelled) {
        setReduceMotion(on);
      }
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const pieces = useMemo<Piece[]>(() => {
    const palette = [
      t.colors.success,
      t.colors.warning,
      t.colors.primary,
      t.colors.accent,
      t.colors.error,
    ];
    // Deterministic-enough spread without needing Math.random reproducibility.
    return Array.from({ length: PIECE_COUNT }, (_, i) => ({
      left: ((i * 37) % 100) / 100,
      delay: (i % 7) * 90,
      drift: (((i * 53) % 60) - 30) * 2,
      size: 6 + ((i * 13) % 6),
      color: palette[i % palette.length],
      spin: ((i * 71) % 4) + 1,
    }));
  }, [t.colors]);

  useEffect(() => {
    if (!playing) {
      return;
    }
    Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 90,
      useNativeDriver: true,
    }).start();

    if (!reduceMotion) {
      Animated.timing(fall, {
        toValue: 1,
        duration: 1900,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
  }, [playing, reduceMotion, pop, fall]);

  return (
    <View style={styles.wrap} pointerEvents="none">
      {!reduceMotion && playing
        ? pieces.map((p, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                left: p.left * (width - 40),
                width: p.size,
                height: p.size * 1.6,
                backgroundColor: p.color,
                borderRadius: 1.5,
                opacity: fall.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
                transform: [
                  {
                    translateY: fall.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-30, 300],
                    }),
                  },
                  {
                    translateX: fall.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, p.drift],
                    }),
                  },
                  {
                    rotate: fall.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', p.spin * 360 + 'deg'],
                    }),
                  },
                ],
              }}
            />
          ))
        : null}

      <Animated.View
        style={[
          styles.badge,
          {
            backgroundColor: t.colors.success,
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          },
        ]}>
        <Icon name="check" size={54} color={t.colors.textOnAccent} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', height: 210, justifyContent: 'center', width: '100%' },
  badge: {
    alignItems: 'center',
    borderRadius: 60,
    height: 120,
    justifyContent: 'center',
    width: 120,
  },
});
