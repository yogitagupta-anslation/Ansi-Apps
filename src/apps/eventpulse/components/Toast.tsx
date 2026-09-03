/**
 * Toast — a single line, briefly.
 *
 * Used for the things that happen away from the user's eye: a request queued
 * offline, a block taking effect, a profile saved. It never carries anything
 * the user must act on — that belongs on screen, not in a message that
 * disappears.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dismissToast, sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space } from '../theme/tokens';
import { AppText } from './primitives';

const VISIBLE_MS = 3_200;

export function Toast(): React.ReactElement | null {
  const { colors } = useTheme();
  const toast = useStore(sessionStore, (state) => state.toast);
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    if (!toast) return;

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(offset, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(offset, { toValue: 12, duration: 200, useNativeDriver: true }),
      ]).start(() => dismissToast(toast.id));
    }, VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [toast, opacity, offset]);

  if (!toast) return null;

  const borderColor =
    toast.tone === 'error' ? colors.danger : toast.tone === 'success' ? colors.accent : colors.border;

  return (
    <SafeAreaView edges={['bottom']} style={styles.wrapper} pointerEvents="none">
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          styles.toast,
          { backgroundColor: colors.surfaceElevated, borderColor, opacity, transform: [{ translateY: offset }] },
          elevation.medium,
        ]}
      >
        <AppText variant="caption">{toast.text}</AppText>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 72,
    alignItems: 'center',
  },
  toast: {
    maxWidth: '90%',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
