import React from 'react';
import {Image, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {ProximityLevel} from '../models/game';
import {PROXIMITY_ORDER, PROXIMITY_TIER_BY_LEVEL} from '../config/gameConfig';
import {colors} from '../theme';

/**
 * The painted HUD, driven by live game state.
 *
 * The kit's bars ship with mock values baked into the art ("115", "01:22",
 * "GETTING WARMER"). Those were erased from the source PNGs, leaving frames
 * with empty cells; the numbers below are positioned as percentages of the
 * frame so they stay put at any size.
 */

// --- hud-bar.png, 448x81 native ------------------------------------------
const HUD_BAR_RATIO = 448 / 81;
/** Cell centres as a fraction of the frame width. */
const HUD_CELLS = [0.239, 0.578, 0.884] as const;

interface HudBarProps {
  coins: string;
  power: string;
  time: string;
  width: number;
  style?: StyleProp<ViewStyle>;
}

export function HudBar({coins, power, time, width, style}: HudBarProps) {
  const height = width / HUD_BAR_RATIO;
  const values = [coins, power, time];
  return (
    <View style={[{width, height}, style]}>
      <Image
        source={require('../assets/hud-bar.png')}
        style={{width, height}}
        resizeMode="contain"
        fadeDuration={0}
      />
      {HUD_CELLS.map((centre, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.cell, {left: width * (centre - 0.16), width: width * 0.32}]}>
          <Text
            style={[styles.cellValue, {fontSize: height * 0.34}]}
            numberOfLines={1}
            allowFontScaling={false}>
            {values[i]}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- hud-proximity.png, 430x117 native ------------------------------------
const PROX_RATIO = 430 / 117;
/** Segment track geometry, measured off the native art. */
const TRACK_LEFT = 115 / 430;
const TRACK_PITCH = 41.4 / 430;
const SEGMENT_W = 38 / 430;
const SEGMENT_TOP = 70 / 117;
const SEGMENT_H = 26 / 117;
const SEGMENTS = 6;

/**
 * How many of the six painted slots light up for a tier.
 *
 * The game has seven tiers and the art has six slots, so the two coldest share
 * the first slot; from there each tier lights one more.
 */
function filledSegments(level: ProximityLevel): number {
  const index = PROXIMITY_ORDER.indexOf(level);
  if (index < 0) {
    return 0;
  }
  return Math.min(SEGMENTS, Math.max(1, index));
}

interface ProximityBarProps {
  level: ProximityLevel;
  width: number;
  style?: StyleProp<ViewStyle>;
}

export function ProximityBar({level, width, style}: ProximityBarProps) {
  const height = width / PROX_RATIO;
  const tier = PROXIMITY_TIER_BY_LEVEL[level];
  const filled = filledSegments(level);
  const accent = tier?.color ?? colors.gold;

  return (
    <View style={[{width, height}, style]}>
      <Image
        source={require('../assets/hud-proximity.png')}
        style={{width, height}}
        resizeMode="contain"
        fadeDuration={0}
      />

      <Text
        style={[
          styles.tierLabel,
          {
            color: accent,
            fontSize: height * 0.19,
            top: height * 0.27,
            left: width * TRACK_LEFT,
            width: width * (TRACK_PITCH * SEGMENTS),
          },
        ]}
        numberOfLines={1}
        allowFontScaling={false}>
        {(tier?.label ?? '').toUpperCase()}
      </Text>

      {Array.from({length: SEGMENTS}, (_, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: width * (TRACK_LEFT + i * TRACK_PITCH),
            top: height * SEGMENT_TOP,
            width: width * SEGMENT_W,
            height: height * SEGMENT_H,
            borderRadius: height * 0.05,
            backgroundColor: accent,
            opacity: i < filled ? 0.95 : 0,
          }}
        />
      ))}
    </View>
  );
}

// --- badge art, ~114 square native ---------------------------------------
interface BadgeProps {
  kind: 'energy' | 'lens';
  count: number;
  size: number;
  style?: StyleProp<ViewStyle>;
}

const BADGE_ART = {
  energy: require('../assets/badge-energy.png'),
  lens: require('../assets/badge-lens.png'),
};

/** A round kit badge with its count drawn into the small corner disc. */
export function HudBadge({kind, count, size, style}: BadgeProps) {
  return (
    <View style={[{width: size, height: size}, style]}>
      <Image
        source={BADGE_ART[kind]}
        style={{width: size, height: size}}
        resizeMode="contain"
        fadeDuration={0}
      />
      <Text
        style={[
          styles.badgeCount,
          {
            // The disc sits at roughly (0.80, 0.82) of the badge.
            left: size * 0.66,
            top: size * 0.68,
            width: size * 0.28,
            fontSize: size * 0.17,
          },
        ]}
        numberOfLines={1}
        allowFontScaling={false}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellValue: {
    fontWeight: '900',
    color: colors.text,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  tierLabel: {
    position: 'absolute',
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: 1.1,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  badgeCount: {
    position: 'absolute',
    textAlign: 'center',
    fontWeight: '900',
    color: colors.text,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
});
