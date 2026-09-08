/**
 * RadarPulse.tsx
 * -----------------------------------------------------------------------------
 * Concentric rings that pulse outward while a scan is running.
 *
 * IMPORTANT: this is a decoration for the SCANNING ACTIVITY, not a radar. The
 * rings carry no positional meaning — BLE gives no bearing, and RSSI is not a
 * distance. Nothing is ever drawn at an angle or a radius that implies "the
 * employee is over there", because that would be a fabricated reading.
 *
 * The animation is driven by useNativeDriver so it runs on the UI thread and
 * keeps ticking while JavaScript is busy handling scan callbacks — which, during
 * an active scan, it frequently is.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '../theme/ThemeContext';

const RING_COUNT = 3;

export function RadarPulse({
  active,
  size = 220,
  color,
}: {
  /** When false the rings hold still, so a stopped scanner never looks busy. */
  active: boolean;
  size?: number;
  color?: string;
}) {
  const t = useTheme();
  const tint = color ?? t.colors.primary;

  // One driver per ring, started at staggered offsets to give a travelling wave.
  const drivers = useRef(
    Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
  ).current;

  useEffect(() => {
    if (!active) {
      drivers.forEach(d => d.stopAnimation(() => d.setValue(0)));
      return;
    }

    const loops = drivers.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          // Stagger: ring i starts a third of a cycle after ring i-1.
          Animated.delay((i * 2400) / RING_COUNT),
          Animated.timing(d, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach(l => l.start());

    // Stop only: resetting a native-driven value after the view is gone
    // throws "Animated node with tag (parent) does not exist".
    return () => {
      loops.forEach(l => l.stop());
    };
  }, [active, drivers]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* Static guide rings, so the shape still reads when the scan is stopped. */}
      {[1, 0.68, 0.36].map(scale => (
        <View
          key={scale}
          style={[
            styles.ring,
            {
              width: size * scale,
              height: size * scale,
              borderRadius: (size * scale) / 2,
              borderColor: t.colors.border,
            },
          ]}
        />
      ))}

      {drivers.map((d, i) => (
        <Animated.View
          key={i}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: tint,
              // Expand from the centre out, fading as it goes.
              transform: [{ scale: d.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
              opacity: d.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
            },
          ]}
        />
      ))}

      <View
        style={[
          styles.core,
          { backgroundColor: t.colors.primarySoft, borderColor: tint },
        ]}>
        <Icon name="bluetooth" size={30} color={tint} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center' },
  ring: { borderWidth: StyleSheet.hairlineWidth * 2, position: 'absolute' },
  core: {
    alignItems: 'center',
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
});
