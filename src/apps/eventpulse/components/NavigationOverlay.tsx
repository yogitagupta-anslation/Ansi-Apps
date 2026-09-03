/**
 * NavigationOverlay — "Find me", without lying about direction.
 *
 * The whole design hinges on one rule: **no arrow until we have earned one.**
 * While the bearing estimator is still acquiring, the overlay shows a slow
 * sweep and asks the user to turn — it never points somewhere plausible. Once
 * confidence clears the threshold the sweep resolves into an arrow, and the
 * arrow's own opacity tracks how sure we are.
 *
 * Everything else on screen is a thing we genuinely measure: the proximity
 * band, whether the signal is strengthening, and whether they are still here.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import type { NavigationState } from '../navigation/NavigationService';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { SignalBars } from './StatusIndicator';
import { AppText, Button } from './primitives';

export function NavigationOverlay({
  state,
  targetName,
  targetAvatar,
  onExit,
  onOpenProfile,
}: {
  state: NavigationState;
  targetName: string;
  targetAvatar: React.ComponentProps<typeof Avatar>['avatar'];
  onExit: () => void;
  onOpenProfile: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  const hasBearing = state.relativeBearing !== null;
  const arrived = state.phase === 'arrived';
  const lost = state.phase === 'lost';

  // Fire once on the transition, not on every re-render while still arrived.
  const announced = useRef(false);
  useEffect(() => {
    if (arrived && !announced.current) {
      announced.current = true;
      haptics.arrived();
    } else if (!arrived) {
      announced.current = false;
    }
  }, [arrived]);

  return (
    <>
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation.low,
        ]}
      >
        <Pressable onPress={onExit} hitSlop={12} accessibilityRole="button" accessibilityLabel="Stop finding">
          <AppText variant="bodyStrong" tone="secondary">
            ← Back
          </AppText>
        </Pressable>
        <AppText variant="bodyStrong">{`Finding ${targetName}`}</AppText>
        <View style={styles.topBarSpacer} />
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: arrived ? colors.accent : lost ? colors.danger : colors.border,
          },
          elevation.medium,
        ]}
      >
        <View style={styles.cardHeader}>
          <Pressable onPress={onOpenProfile} accessibilityRole="button" style={styles.identity}>
            <Avatar avatar={targetAvatar} name={targetName} size="list" />
            <View>
              <AppText variant="heading">{targetName}</AppText>
              <View style={styles.metaRow}>
                <SignalBars band={state.band} confidence={0.6 + state.bearingConfidence * 0.4} />
                <AppText variant="caption" tone="secondary">
                  {lost ? 'Out of range' : `${state.bandLabel} · about ${state.rangeLabel}`}
                </AppText>
              </View>
            </View>
          </Pressable>
        </View>

        <View style={styles.indicator}>
          {hasBearing && !arrived && !lost ? (
            <DirectionArrow bearing={state.relativeBearing ?? 0} confidence={state.bearingConfidence} />
          ) : arrived ? (
            <ArrivedMark />
          ) : lost ? (
            <AppText variant="display">📡</AppText>
          ) : (
            <AcquiringSweep />
          )}
        </View>

        <AppText variant="heading" style={styles.centered}>
          {state.guidance}
        </AppText>

        {state.directionLabel && !arrived && !lost ? (
          <AppText variant="caption" tone="secondary" style={styles.centered}>
            {`They are ${state.directionLabel}`}
          </AppText>
        ) : null}

        {!hasBearing && !arrived && !lost ? (
          <AppText variant="caption" tone="tertiary" style={styles.centered}>
            Bluetooth gives distance, not direction — EventPulse works the direction out from how
            the signal changes as you move.
          </AppText>
        ) : null}

        <Button label={arrived ? 'Done' : 'Stop finding'} variant="secondary" onPress={onExit} />
      </View>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Indicators
 * ------------------------------------------------------------------ */

function DirectionArrow({
  bearing,
  confidence,
}: {
  bearing: number;
  confidence: number;
}): React.ReactElement {
  const { colors } = useTheme();
  const rotation = useRef(new Animated.Value(bearing)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: bearing,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rotation, bearing]);

  const spin = rotation.interpolate({
    inputRange: [-180, 180],
    outputRange: ['-180deg', '180deg'],
  });

  return (
    <Animated.View
      accessibilityLabel={`Direction indicator, ${Math.round(bearing)} degrees`}
      style={[
        styles.arrow,
        {
          borderColor: colors.accent,
          // Confidence is visible, not hidden: a tentative arrow looks tentative.
          opacity: 0.55 + 0.45 * confidence,
          transform: [{ rotate: spin }],
        },
      ]}
    >
      <AppText variant="display" tone="accent">
        ↑
      </AppText>
    </Animated.View>
  );
}

function AcquiringSweep(): React.ReactElement {
  const { colors } = useTheme();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={[
        styles.sweep,
        { borderColor: colors.border, borderTopColor: colors.accent, transform: [{ rotate }] },
      ]}
    />
  );
}

function ArrivedMark(): React.ReactElement {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <Animated.View style={[styles.arrived, { borderColor: colors.accent, transform: [{ scale }] }]}>
      <AppText variant="display" tone="accent">
        ✓
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  topBarSpacer: { width: 52 },
  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.xl,
    gap: space.md,
    alignItems: 'stretch',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  indicator: { alignItems: 'center', justifyContent: 'center', height: 92 },
  arrow: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweep: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
  },
  arrived: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
});
