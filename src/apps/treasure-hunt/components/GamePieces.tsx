import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {ProximityLevel} from '../models/game';
import {PROXIMITY_TIER_BY_LEVEL} from '../config/gameConfig';
import {proximityIntensity} from '../game/ProximityService';
import {alpha, colors, elevate, radius, spacing, typography} from '../theme';

/** A small rounded stat chip, used for the timer and coin count in the header. */
export function StatPill({
  icon,
  value,
  tint = colors.gold,
}: {
  icon: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={[styles.pill, {borderColor: alpha(tint, 0.5)}]}>
      <Text style={styles.pillIcon}>{icon}</Text>
      <Text style={[typography.pill, {color: colors.text}]}>{value}</Text>
    </View>
  );
}

/** The gold "YOU'RE GETTING WARMER!" ribbon above the map. */
export function ProximityBanner({level}: {level: ProximityLevel}) {
  const tier = PROXIMITY_TIER_BY_LEVEL[level];
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 10,
    }).start();
  }, [level, pop]);

  const scale = pop.interpolate({inputRange: [0, 1], outputRange: [0.92, 1]});

  return (
    <Animated.View
      accessibilityRole="text"
      accessibilityLabel={`Treasure proximity: ${tier.label}`}
      style={[
        styles.banner,
        {
          backgroundColor: alpha(tier.color, 0.18),
          borderColor: alpha(tier.color, 0.75),
          transform: [{scale}],
        },
      ]}>
      <Text style={styles.bannerIcon}>{tier.glyph}</Text>
      <Text style={[styles.bannerText, {color: tier.color}]} numberOfLines={1}>
        {tier.label}
      </Text>
    </Animated.View>
  );
}

interface DialProps {
  label: string;
  value: string;
  icon?: string;
  tint?: string;
  onPress?: () => void;
  /** Renders the animated proximity ring instead of a flat icon. */
  proximity?: ProximityLevel;
}

/** One of the three circular readouts along the bottom of the game screen. */
export function StatDial({label, value, icon, tint = colors.gold, proximity}: DialProps) {
  const tier = proximity ? PROXIMITY_TIER_BY_LEVEL[proximity] : null;
  const color = tier ? tier.color : tint;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!tier) {
      return;
    }
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: tier.pulseMs * 2,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, tier]);

  const rotate = sweep.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const intensity = proximity ? proximityIntensity(proximity) : 0;

  return (
    <View style={styles.dialWrap}>
      <View
        style={[
          styles.dial,
          {
            borderColor: alpha(color, 0.7),
            backgroundColor: tier ? colors.radarFill : alpha(color, 0.12),
          },
          elevate(3),
        ]}>
        {tier ? (
          <View key="radar" style={styles.dialInner}>
            <View
              style={[
                styles.dialRing,
                {borderColor: alpha(color, 0.35 + intensity * 0.4)},
              ]}
            />
            <Animated.View style={[styles.dialSweep, {transform: [{rotate}]}]}>
              <View style={[styles.dialSweepArm, {backgroundColor: color}]} />
            </Animated.View>
            <Text style={styles.dialGlyph}>{tier.glyph}</Text>
          </View>
        ) : (
          <View key="plain" style={styles.dialInner}>
            <Text style={styles.dialGlyph}>{icon}</Text>
            <Text style={[styles.dialValue, {color}]}>{value}</Text>
          </View>
        )}
      </View>
      <Text style={styles.dialLabel} numberOfLines={1}>
        {label}
      </Text>
      {tier ? (
        <Text style={[styles.dialSub, {color}]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/** A determinate progress bar, used while the world is generated. */
export function ProgressBar({progress}: {progress: number}) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, {width: `${clamped * 100}%`}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceRaised,
  },
  pillIcon: {
    fontSize: 14,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  bannerIcon: {
    fontSize: 15,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dialWrap: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  dial: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dialInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
  },
  dialSweep: {
    position: 'absolute',
    width: 68,
    height: 68,
    alignItems: 'center',
  },
  dialSweepArm: {
    width: 2,
    height: 34,
    transformOrigin: 'bottom',
  },
  dialGlyph: {
    fontSize: 20,
  },
  dialValue: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 1,
  },
  dialLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  dialSub: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.blue,
    borderRadius: 4,
  },
});
