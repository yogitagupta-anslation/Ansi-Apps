import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {colors, elevate, radius, spacing} from '../theme';

/** The gold banner across the top of the treasure-found screen. */
export function Ribbon({label}: {label: string}) {
  const drop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(drop, {
      toValue: 1,
      useNativeDriver: true,
      speed: 10,
      bounciness: 12,
    }).start();
  }, [drop]);

  const translateY = drop.interpolate({inputRange: [0, 1], outputRange: [-40, 0]});

  return (
    <Animated.View style={[styles.wrap, {opacity: drop, transform: [{translateY}]}]}>
      <View style={styles.tailLeft} />
      <View style={[styles.body, elevate(6)]}>
        <Text style={styles.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.tailRight} />
    </Animated.View>
  );
}

/**
 * A burst of celebratory confetti.
 *
 * Positions are fixed rather than random so the layout is stable across
 * re-renders; each piece just animates outward and fades.
 */
const CONFETTI = [
  {x: -110, y: -30, color: colors.gold, delay: 0},
  {x: -70, y: -90, color: colors.cyan, delay: 90},
  {x: -20, y: -120, color: colors.green, delay: 40},
  {x: 40, y: -105, color: colors.orange, delay: 140},
  {x: 95, y: -60, color: colors.violet, delay: 60},
  {x: 120, y: 10, color: colors.gold, delay: 180},
  {x: -125, y: 40, color: colors.green, delay: 120},
  {x: 80, y: 70, color: colors.cyan, delay: 20},
];

export function Confetti() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {CONFETTI.map((piece, index) => {
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, piece.x],
        });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, piece.y],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.15, 0.8, 1],
          outputRange: [0, 1, 0.8, 0],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${(index % 2 === 0 ? 1 : -1) * 320}deg`],
        });
        return (
          <Animated.View
            key={index}
            style={[
              styles.confetti,
              {
                backgroundColor: piece.color,
                opacity,
                transform: [{translateX}, {translateY}, {rotate}],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
  },
  body: {
    backgroundColor: colors.frameGold,
    borderWidth: 2,
    borderColor: colors.goldDeep,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xxl,
  },
  text: {
    color: colors.goldInk,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  tailLeft: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderRightWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: colors.goldDeep,
  },
  tailRight: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.goldDeep,
  },
  confettiLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confetti: {
    position: 'absolute',
    width: 9,
    height: 13,
    borderRadius: 2,
  },
});
