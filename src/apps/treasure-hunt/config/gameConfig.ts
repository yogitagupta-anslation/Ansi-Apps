/**
 * Every tunable number in the game lives here. Nothing in src/game hard-codes a
 * threshold -- change a value in this file and the whole engine follows.
 */
import {GameMode, ProximityLevel} from '../models/game';
import type {GameConfig, ProximityTier} from '../models/game';
import {ItemKind} from '../models/world';

/**
 * Worlds are landscape-shaped, matching the play area. A square world in a wide
 * viewport leaves the camera nowhere to travel horizontally.
 */
export const DEFAULT_WORLD_SIZE = {width: 90, height: 50};

/**
 * World units visible down the height of the viewport. The renderer derives its
 * zoom from this, so the play area feels the same on any screen.
 */
export const VISIBLE_WORLD_HEIGHT = 20;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  mode: GameMode.SharedTreasure,
  worldSize: DEFAULT_WORLD_SIZE,
  durationSec: 300,
  maxPlayers: 8,
  obstacleCount: 26,
  coinCount: 18,
  gemCount: 4,
  powerUpCount: 6,
  minTreasureSpawnDistance: 35,
  treasureFoundRadius: 3,
  itemPickupRadius: 2.2,
  moveSpeed: 14,
  showOtherPlayers: true,
  teamCount: 2,
};

/**
 * Proximity bands, ordered nearest-first. `maxDistance` is an exclusive upper
 * bound: the first tier whose bound the distance falls under is the match.
 *
 * These distances are VIRTUAL world units measured between (x, y) coordinates.
 * BLE signal strength (RSSI) is never consulted -- see docs/ARCHITECTURE.md.
 */
export const PROXIMITY_TIERS: readonly ProximityTier[] = [
  {
    level: ProximityLevel.Found,
    maxDistance: 3,
    glyph: '💎',
    label: 'TREASURE FOUND!',
    color: '#FFD24A',
    pulseMs: 320,
  },
  {
    level: ProximityLevel.VeryHot,
    maxDistance: 8,
    glyph: '🔥🔥',
    label: 'IT IS RIGHT HERE!',
    color: '#FF3B2F',
    pulseMs: 460,
  },
  {
    level: ProximityLevel.Hot,
    maxDistance: 15,
    glyph: '🔥',
    label: 'BURNING HOT',
    color: '#FF6B2C',
    pulseMs: 640,
  },
  {
    level: ProximityLevel.Warm,
    maxDistance: 25,
    glyph: '🟠',
    label: 'GETTING WARMER',
    color: '#FFA22C',
    pulseMs: 880,
  },
  {
    level: ProximityLevel.GettingClose,
    maxDistance: 40,
    glyph: '🟡',
    label: 'ON THE TRAIL',
    color: '#F2D64B',
    pulseMs: 1150,
  },
  {
    level: ProximityLevel.Far,
    maxDistance: 60,
    glyph: '🔵',
    label: 'COLD',
    color: '#4AA8FF',
    pulseMs: 1450,
  },
  {
    level: ProximityLevel.VeryFar,
    maxDistance: Number.POSITIVE_INFINITY,
    glyph: '❄️',
    label: 'FREEZING',
    color: '#8FB6D9',
    pulseMs: 1800,
  },
];

export const PROXIMITY_TIER_BY_LEVEL: Record<ProximityLevel, ProximityTier> =
  PROXIMITY_TIERS.reduce((acc, tier) => {
    acc[tier.level] = tier;
    return acc;
  }, {} as Record<ProximityLevel, ProximityTier>);

/** Ordered far -> near, handy for rendering a progress meter. */
export const PROXIMITY_ORDER: readonly ProximityLevel[] = [
  ProximityLevel.VeryFar,
  ProximityLevel.Far,
  ProximityLevel.GettingClose,
  ProximityLevel.Warm,
  ProximityLevel.Hot,
  ProximityLevel.VeryHot,
  ProximityLevel.Found,
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export const SCORING = {
  treasureFound: 100,
  firstFinderBonus: 50,
  coin: 10,
  gem: 25,
  powerUp: 20,
  /** Deducted when another player tags you and your shield is down. */
  taggedPenalty: 15,
  /** Awarded per full second left on the clock when you find the treasure. */
  timeBonusPerSecond: 0,
} as const;

export const ITEM_POINTS: Record<ItemKind, number> = {
  [ItemKind.Coin]: SCORING.coin,
  [ItemKind.Gem]: SCORING.gem,
  [ItemKind.Energy]: SCORING.powerUp,
  [ItemKind.Shield]: SCORING.powerUp,
  [ItemKind.Hint]: SCORING.powerUp,
  [ItemKind.DoublePoints]: SCORING.powerUp,
  [ItemKind.Radar]: SCORING.powerUp,
};

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------

export interface PowerUpSpec {
  kind: ItemKind;
  label: string;
  /** Fits the narrow tray slot; label is used everywhere else. */
  short: string;
  glyph: string;
  description: string;
  durationMs: number;
  color: string;
}

export const POWERUP_SPECS: Partial<Record<ItemKind, PowerUpSpec>> = {
  [ItemKind.Radar]: {
    kind: ItemKind.Radar,
    label: 'Treasure Radar',
    short: 'Radar',
    glyph: '🔍',
    description: 'Sharpens proximity readings and narrows the distance band.',
    durationMs: 15000,
    color: '#39E6C3',
  },
  [ItemKind.Hint]: {
    kind: ItemKind.Hint,
    label: 'Hint',
    short: 'Hint',
    glyph: '🧭',
    description: 'Reveals a rough bearing toward the treasure.',
    durationMs: 10000,
    color: '#6FA8FF',
  },
  [ItemKind.Energy]: {
    kind: ItemKind.Energy,
    label: 'Speed Boost',
    short: 'Speed',
    glyph: '⚡',
    description: 'Moves your hunter faster through the world.',
    durationMs: 12000,
    color: '#FFD24A',
  },
  [ItemKind.DoublePoints]: {
    kind: ItemKind.DoublePoints,
    label: 'Double Points',
    short: '2x Pts',
    glyph: '🔥',
    description: 'Doubles every point you bank while it burns.',
    durationMs: 20000,
    color: '#FF6B2C',
  },
  [ItemKind.Shield]: {
    kind: ItemKind.Shield,
    label: 'Shield',
    short: 'Shield',
    glyph: '🛡',
    description: 'Blocks tags from rival hunters.',
    durationMs: 18000,
    color: '#A78BFA',
  },
};

/** Multiplier applied to moveSpeed while Speed Boost is active. */
export const SPEED_BOOST_MULTIPLIER = 1.75;

/** Multiplier applied to points banked while Double Points is active. */
export const DOUBLE_POINTS_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------

export const WORLD_GEN = {
  /** Obstacles are rectangles sized within this range (virtual units). */
  obstacleMinSize: 3,
  obstacleMaxSize: 9,
  /** Keep generated content this far inside the world edge. */
  edgeMargin: 4,
  /** Minimum gap between an item and any obstacle. */
  itemClearance: 1.5,
  /** Minimum gap between two items. */
  itemSpacing: 4,
  /** Radius kept clear of obstacles around the spawn point. */
  spawnClearRadius: 8,
  /** Give up placing a single entity after this many attempts. */
  maxPlacementAttempts: 220,
  /** Player collision radius used for obstacle tests. */
  playerRadius: 1.2,
} as const;

// ---------------------------------------------------------------------------
// Simulation timing
// ---------------------------------------------------------------------------

export const TIMING = {
  /** Local movement simulation tick. */
  simulationHz: 30,
  /**
   * How often the engine publishes positions to the UI. The simulation runs
   * faster than this; re-rendering React at the full simulation rate would
   * burn frames for motion the eye cannot resolve.
   */
  renderHz: 15,
  /** How often a player reports its position to the host. */
  movementSendHz: 10,
  /** Skip a movement send if the player moved less than this. */
  movementEpsilon: 0.15,
  /** How often the host broadcasts a full GAME_STATE digest. */
  stateBroadcastHz: 4,
  /** How often the host recomputes and pushes proximity to each player. */
  proximityHz: 5,
  /** Countdown shown between START and movement unlock. */
  countdownSec: 3,
  /** Host keeps a dropped slot alive this long before evicting the player. */
  reconnectGraceMs: 30000,
  /** Player considered stale if the host hears nothing for this long. */
  peerTimeoutMs: 12000,
  /** Tag cooldown so players cannot spam-tag each other. */
  tagCooldownMs: 5000,
  /** Distance within which one player can tag another. */
  tagRadius: 4,
} as const;

/**
 * Distance is reported to players quantised into bands so the exact value never
 * leaks the treasure position. A Radar power-up narrows the band.
 */
export const DISTANCE_BAND_SIZE = 5;
export const DISTANCE_BAND_SIZE_BOOSTED = 2;

/** Hint bearing is rounded to this many degrees -- deliberately imprecise. */
export const HINT_BEARING_QUANTISE_DEG = 45;
export const HINT_BEARING_QUANTISE_DEG_BOOSTED = 15;
