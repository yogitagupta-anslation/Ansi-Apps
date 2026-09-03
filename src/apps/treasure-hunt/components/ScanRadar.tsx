import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {alpha, colors} from '../theme';

interface Props {
  size?: number;
  /** Number of hosts found; drives the blips shown around the dial. */
  contacts?: number;
  active?: boolean;
}

/** Fixed blip placements, so the dial does not jitter between renders. */
const BLIPS = [
  {angle: 35, radius: 0.72, size: 5},
  {angle: 110, radius: 0.45, size: 4},
  {angle: 200, radius: 0.82, size: 6},
  {angle: 285, radius: 0.58, size: 4},
  {angle: 325, radius: 0.35, size: 5},
];

/**
 * The blue "scanning for games nearby" dial on the Join screen.
 *
 * Purely decorative feedback that a BLE scan is running. It does not plot the
 * physical position of anything -- BLE gives no direction, and this game has no
 * concept of real-world position.
 */
export function ScanRadar({size = 220, contacts = 0, active = true}: Props) {
  const sweep = useRef(new Animated.Value(0)).current;
  const ping = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      sweep.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, sweep]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ping, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, ping]);

  const rotate = sweep.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const pingScale = ping.interpolate({inputRange: [0, 1], outputRange: [0.25, 1]});
  const pingOpacity = ping.interpolate({inputRange: [0, 1], outputRange: [0.5, 0]});

  const half = size / 2;
  const visibleBlips = BLIPS.slice(0, Math.min(contacts, BLIPS.length));

  return (
    <View style={[styles.wrap, {width: size, height: size}]}>
      <View style={[styles.dial, {width: size, height: size, borderRadius: half}]} />

      {[0.75, 0.5, 0.25].map(fraction => (
        <View
          key={fraction}
          style={[
            styles.ring,
            {
              width: size * fraction,
              height: size * fraction,
              borderRadius: (size * fraction) / 2,
            },
          ]}
        />
      ))}

      {/* Cross hairs. */}
      <View style={[styles.axis, {width: size, height: 1}]} />
      <View style={[styles.axis, {width: 1, height: size}]} />

      {/* Expanding ping. */}
      <Animated.View
        style={[
          styles.ping,
          {
            width: size,
            height: size,
            borderRadius: half,
            transform: [{scale: pingScale}],
            opacity: pingOpacity,
          },
        ]}
      />

      {/* Rotating sweep wedge, approximated with tapering bars. */}
      <Animated.View
        style={[styles.sweepWrap, {width: size, height: size, transform: [{rotate}]}]}>
        {[0, 1, 2, 3, 4].map(index => (
          <View
            key={index}
            style={[
              styles.sweepBar,
              {
                height: half,
                opacity: 0.5 - index * 0.09,
                transform: [{rotate: `${index * 4}deg`}],
              },
            ]}
          />
        ))}
      </Animated.View>

      {visibleBlips.map((blip, index) => {
        const radians = (blip.angle * Math.PI) / 180;
        return (
          <View
            key={index}
            style={[
              styles.blip,
              {
                width: blip.size,
                height: blip.size,
                borderRadius: blip.size / 2,
                left: half + Math.cos(radians) * half * blip.radius - blip.size / 2,
                top: half + Math.sin(radians) * half * blip.radius - blip.size / 2,
              },
            ]}
          />
        );
      })}

      {/* Bluetooth badge at the centre. */}
      <View style={styles.hub}>
        <Text style={styles.hubGlyph}>🔷</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dial: {
    position: 'absolute',
    backgroundColor: alpha(colors.blue, 0.1),
    borderWidth: 1.5,
    borderColor: alpha(colors.blue, 0.45),
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: alpha(colors.blue, 0.25),
  },
  axis: {
    position: 'absolute',
    backgroundColor: alpha(colors.blue, 0.18),
  },
  ping: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: alpha(colors.cyan, 0.8),
  },
  sweepWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  sweepBar: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: colors.cyan,
    transformOrigin: 'bottom',
  },
  blip: {
    position: 'absolute',
    backgroundColor: colors.cyan,
  },
  hub: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.blue, 0.28),
    borderWidth: 2,
    borderColor: colors.blueBright,
  },
  hubGlyph: {
    fontSize: 24,
  },
});
