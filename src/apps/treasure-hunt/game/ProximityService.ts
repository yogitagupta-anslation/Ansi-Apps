/**
 * Hot/cold feedback.
 *
 * THE most important rule in this codebase lives here: proximity to the
 * treasure is computed from VIRTUAL (x, y) coordinates and nothing else. BLE
 * RSSI is never an input. Two phones sitting on the same table can be at
 * opposite ends of the virtual world, and the game must say so.
 *
 * Thresholds come from PROXIMITY_TIERS in config/gameConfig.ts and can be
 * retuned without touching this file.
 */
import {
  DISTANCE_BAND_SIZE,
  DISTANCE_BAND_SIZE_BOOSTED,
  HINT_BEARING_QUANTISE_DEG,
  HINT_BEARING_QUANTISE_DEG_BOOSTED,
  PROXIMITY_TIERS,
  PROXIMITY_TIER_BY_LEVEL,
} from '../config/gameConfig';
import {ProximityLevel, type ProximityReport, type ProximityTier} from '../models/game';
import {bearingDeg, distance, type Position} from '../models/geometry';

/**
 * Straight-line distance between a player and a treasure, both in virtual
 * world units. This is the exact formula from the game design:
 *   sqrt((px - tx)^2 + (py - ty)^2)
 */
export function treasureDistance(player: Position, treasure: Position): number {
  return distance(player, treasure);
}

/** Map a virtual distance onto a proximity tier. */
export function proximityTierForDistance(dist: number): ProximityTier {
  for (const tier of PROXIMITY_TIERS) {
    if (dist < tier.maxDistance) {
      return tier;
    }
  }
  // PROXIMITY_TIERS ends with an Infinity bound, so this is unreachable in
  // practice; kept so the function is total.
  return PROXIMITY_TIERS[PROXIMITY_TIERS.length - 1] as ProximityTier;
}

export function proximityLevelForDistance(dist: number): ProximityLevel {
  return proximityTierForDistance(dist).level;
}

export function tierFor(level: ProximityLevel): ProximityTier {
  return PROXIMITY_TIER_BY_LEVEL[level];
}

/** 0 (freezing) .. 1 (found). Drives meters and glow intensity. */
export function proximityIntensity(level: ProximityLevel): number {
  const order = [
    ProximityLevel.VeryFar,
    ProximityLevel.Far,
    ProximityLevel.GettingClose,
    ProximityLevel.Warm,
    ProximityLevel.Hot,
    ProximityLevel.VeryHot,
    ProximityLevel.Found,
  ];
  const index = order.indexOf(level);
  return index < 0 ? 0 : index / (order.length - 1);
}

/**
 * Build the report the host sends to one player.
 *
 * Deliberately lossy. The player receives a tier and a quantised distance band,
 * never the raw distance and never the treasure coordinates -- otherwise a
 * modified client could trivially solve the hunt. A Radar power-up narrows the
 * band; a Hint adds a coarse bearing.
 */
export function buildProximityReport(
  playerPosition: Position,
  treasurePosition: Position,
  options: {radarActive?: boolean; hintActive?: boolean} = {},
): ProximityReport {
  const {radarActive = false, hintActive = false} = options;

  const dist = treasureDistance(playerPosition, treasurePosition);
  const level = proximityLevelForDistance(dist);

  const bandSize = radarActive ? DISTANCE_BAND_SIZE_BOOSTED : DISTANCE_BAND_SIZE;
  const distanceBand = Math.floor(dist / bandSize) * bandSize;

  const report: ProximityReport = {
    level,
    distanceBand,
    boosted: radarActive,
  };

  if (hintActive || radarActive) {
    const quantise = radarActive
      ? HINT_BEARING_QUANTISE_DEG_BOOSTED
      : HINT_BEARING_QUANTISE_DEG;
    const raw = bearingDeg(playerPosition, treasurePosition);
    report.bearingDeg = (Math.round(raw / quantise) * quantise) % 360;
  }

  return report;
}

/**
 * Levels at which the treasure reveals itself on the map.
 *
 * Anything colder keeps it hidden, so players navigate by the hot/cold reading
 * alone until they are genuinely on top of it.
 */
export const REVEAL_LEVELS: ReadonlySet<ProximityLevel> = new Set([
  ProximityLevel.VeryHot,
  ProximityLevel.Found,
]);

export function shouldRevealTreasure(level: ProximityLevel): boolean {
  return REVEAL_LEVELS.has(level);
}

/** Has this player reached the treasure? Host-side authority check. */
export function hasReachedTreasure(
  playerPosition: Position,
  treasurePosition: Position,
  foundRadius: number,
): boolean {
  return treasureDistance(playerPosition, treasurePosition) <= foundRadius;
}
