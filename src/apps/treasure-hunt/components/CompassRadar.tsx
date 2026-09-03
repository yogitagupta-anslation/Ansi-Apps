import React, {useEffect, useRef} from 'react';
import {Animated, Easing, Image, StyleSheet, Text, View} from 'react-native';
import {ProximityLevel} from '../models/game';
import {PROXIMITY_TIER_BY_LEVEL} from '../config/gameConfig';
import {proximityIntensity} from '../game/ProximityService';
import {TreasureChest} from './TreasureChest';
import {alpha, colors, typography} from '../theme';

interface Props {
  level: ProximityLevel;
  /** Virtual-world bearing to the treasure; only set while Hint/Radar is up. */
  bearingDeg?: number;
  /** Quantised distance band, used to place the marker along the ray. */
  distanceBand: number;
  size?: number;
}

/**
 * The painted dial, 327x273 native.
 *
 * The bezel is circular but the ivy spills past it, so the art is wider than
 * it is tall. The dial's centre still lands at the image centre, and its
 * interior radius is 96/327 of the width.
 */
const DIAL = require('../assets/compass-dial.png');
const DIAL_RATIO = 273 / 327;
const DIAL_RADIUS = 96 / 327;

/**
 * The needle from the kit: a red blade toward the bearing and a pale tail
 * behind it. Drawn rather than sliced, because it has to rotate independently
 * of the dial it sits on.
 */
function Needle({length}: {length: number}) {
  const w = Math.max(6, length * 0.16);
  return (
    <View pointerEvents="none" style={styles.needle}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: length,
          borderLeftColor: colors.transparent,
          borderRightColor: colors.transparent,
          borderBottomColor: '#E0342B',
        }}
      />
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderTopWidth: length * 0.72,
          borderLeftColor: colors.transparent,
          borderRightColor: colors.transparent,
          borderTopColor: '#C9D4E4',
        }}
      />
      <View style={[styles.needleHub, {width: w * 0.9, height: w * 0.9, borderRadius: w}]} />
    </View>
  );
}

/**
 * The full-screen treasure radar.
 *
 * The compass letters describe the VIRTUAL world's axes, not magnetic north:
 * "N" is simply -Y in game space. A treasure marker is drawn only when the host
 * has actually supplied a bearing (a Hint or Radar power-up is running). With
 * no bearing the dial shows range only and makes no directional claim.
 */
export function CompassRadar({level, bearingDeg, distanceBand, size = 260}: Props) {
  const tier = PROXIMITY_TIER_BY_LEVEL[level];
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: Math.max(1400, tier.pulseMs * 2),
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, tier.pulseMs]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1, duration: tier.pulseMs, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0, duration: tier.pulseMs, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, tier.pulseMs]);

  const rotate = sweep.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const markerScale = pulse.interpolate({inputRange: [0, 1], outputRange: [0.9, 1.12]});

  const width = size;
  const height = size * DIAL_RATIO;
  const cx = width / 2;
  const cy = height / 2;
  const radius = width * DIAL_RADIUS;

  const intensity = proximityIntensity(level);
  // Nearer treasure sits closer to the middle of the dial.
  const markerRadius = radius * (0.88 - intensity * 0.58);

  const markerPosition = (() => {
    if (bearingDeg === undefined) {
      return null;
    }
    // Bearing is clockwise from "north" (-Y), matching bearingDeg().
    const radians = ((bearingDeg - 90) * Math.PI) / 180;
    return {
      left: cx + Math.cos(radians) * markerRadius - 20,
      top: cy + Math.sin(radians) * markerRadius - 20,
    };
  })();

  return (
    <View style={[styles.wrap, {width, height}]}>
      <Image
        source={DIAL}
        style={{width, height}}
        resizeMode="contain"
        fadeDuration={0}
      />

      {/* Sweep, clipped to the dial interior so it never crosses the bezel. */}
      <View
        style={[
          styles.sweepClip,
          {
            left: cx - radius,
            top: cy - radius,
            width: radius * 2,
            height: radius * 2,
            borderRadius: radius,
          },
        ]}
        pointerEvents="none">
        <Animated.View
          style={[
            styles.sweepWrap,
            {width: radius * 2, height: radius * 2, transform: [{rotate}]},
          ]}>
          {[0, 1, 2, 3].map(index => (
            <View
              key={index}
              style={[
                styles.sweepBar,
                {
                  height: radius,
                  opacity: 0.32 - index * 0.07,
                  transform: [{rotate: `${index * 5}deg`}],
                },
              ]}
            />
          ))}
        </Animated.View>
      </View>

      {/* The player sits at the centre of their own dial. */}
      <View style={[styles.player, {left: cx - 13, top: cy - 13}]}>
        <Text style={styles.playerGlyph}>▲</Text>
      </View>

      {/* The needle only appears once the host has supplied a real bearing. */}
      {bearingDeg !== undefined ? (
        <View
          pointerEvents="none"
          style={[
            styles.needleWrap,
            {
              left: cx - radius,
              top: cy - radius,
              width: radius * 2,
              height: radius * 2,
              transform: [{rotate: `${bearingDeg}deg`}],
            },
          ]}>
          <Needle length={radius * 0.62} />
        </View>
      ) : null}

      {markerPosition ? (
        <Animated.View
          style={[styles.marker, markerPosition, {transform: [{scale: markerScale}]}]}>
          <View style={[styles.markerHalo, {backgroundColor: alpha(tier.color, 0.35)}]} />
          <TreasureChest size={26} />
        </Animated.View>
      ) : null}

      {bearingDeg === undefined ? (
        <View style={[styles.noFix, {top: height + 6}]}>
          <Text style={styles.noFixText}>
            {level === ProximityLevel.Found ? 'ON THE TREASURE' : 'RANGE ONLY'}
          </Text>
          <Text style={styles.noFixHint}>Use 🧭 Hint or 🔍 Radar for a bearing</Text>
        </View>
      ) : null}

      <Text style={[styles.band, {color: tier.color, top: cy + radius * 0.34}]}>
        {level === ProximityLevel.Found ? 'HERE' : `~${distanceBand}u`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sweepClip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  sweepWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  needleWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  needle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  needleHub: {
    position: 'absolute',
    backgroundColor: '#F2F5FA',
    borderWidth: 1.5,
    borderColor: '#1A2130',
  },
  sweepBar: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: colors.radarSweep,
    transformOrigin: 'bottom',
  },
  marker: {
    position: 'absolute',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerHalo: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  player: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.cyan, 0.25),
    borderWidth: 2,
    borderColor: colors.cyan,
  },
  playerGlyph: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '900',
    marginTop: -1,
  },
  noFix: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 2,
  },
  noFixText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: colors.textDim,
  },
  noFixHint: {
    fontSize: 9,
    color: colors.textMuted,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    ...typography.score,
    fontSize: 15,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
});
