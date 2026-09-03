/**
 * The virtual world: a bounded 2D grid holding obstacles, collectible items and
 * the treasure. Generated deterministically from a numeric seed so that every
 * device can rebuild an identical world from a handful of bytes.
 */
import type {Position, Rect, Size} from './geometry';

/** Solid scenery. A player cannot walk through any of these. */
export enum ObstacleKind {
  Tree = 'TREE',
  Rock = 'ROCK',
  Pond = 'POND',
  Bush = 'BUSH',
  Log = 'LOG',
  Ruin = 'RUIN',
  /** A cracked shard of arcane crystal, lit from within. */
  Crystal = 'CRYSTAL',
  /** A hanging lantern on a post, marking an old trail. */
  Lantern = 'LANTERN',
  /** A carved standing stone left by whoever buried the treasure. */
  Standing = 'STANDING_STONE',
  Barrel = 'BARREL',
  Stump = 'STUMP',
}

export const OBSTACLE_GLYPH: Record<ObstacleKind, string> = {
  [ObstacleKind.Tree]: '🌲',
  [ObstacleKind.Rock]: '🪨',
  [ObstacleKind.Pond]: '💧',
  [ObstacleKind.Bush]: '🌳',
  [ObstacleKind.Log]: '🪵',
  [ObstacleKind.Ruin]: '🏛',
  [ObstacleKind.Crystal]: '💎',
  [ObstacleKind.Lantern]: '🏮',
  [ObstacleKind.Standing]: '🗿',
  [ObstacleKind.Barrel]: '🛢',
  [ObstacleKind.Stump]: '🪵',
};

/**
 * Purely visual scenery: flowers, grass tufts, pebbles. These do not collide
 * and are never synchronised -- every device regenerates them from the shared
 * world seed, so they cost nothing over BLE.
 */
export enum DecorKind {
  Flower = 'FLOWER',
  Grass = 'GRASS',
  Pebble = 'PEBBLE',
  Mushroom = 'MUSHROOM',
  Leaf = 'LEAF',
  /** A tiny glimmer of crystal dust on the floor. */
  Shard = 'SHARD',
  Bone = 'BONE',
}

export const DECOR_GLYPH: Record<DecorKind, string> = {
  [DecorKind.Flower]: '🌸',
  [DecorKind.Grass]: '🌿',
  [DecorKind.Pebble]: '🪨',
  [DecorKind.Mushroom]: '🍄',
  [DecorKind.Leaf]: '🍃',
  [DecorKind.Shard]: '✦',
  [DecorKind.Bone]: '🦴',
};

export interface Decor {
  id: string;
  kind: DecorKind;
  position: Position;
  /** Render scale, so scenery does not look stamped from one template. */
  scale: number;
}

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  /** Axis-aligned bounding box in virtual world units. */
  bounds: Rect;
}

export enum ItemKind {
  Coin = 'COIN',
  Gem = 'GEM',
  Energy = 'ENERGY',
  Shield = 'SHIELD',
  Hint = 'HINT',
  DoublePoints = 'DOUBLE_POINTS',
  Radar = 'RADAR',
}

export const ITEM_GLYPH: Record<ItemKind, string> = {
  [ItemKind.Coin]: '🪙',
  [ItemKind.Gem]: '💠',
  [ItemKind.Energy]: '⚡',
  [ItemKind.Shield]: '🛡',
  [ItemKind.Hint]: '🧭',
  [ItemKind.DoublePoints]: '🔥',
  [ItemKind.Radar]: '🔍',
};

export const ITEM_LABEL: Record<ItemKind, string> = {
  [ItemKind.Coin]: 'Coin',
  [ItemKind.Gem]: 'Rare Gem',
  [ItemKind.Energy]: 'Speed Boost',
  [ItemKind.Shield]: 'Shield',
  [ItemKind.Hint]: 'Hint',
  [ItemKind.DoublePoints]: 'Double Points',
  [ItemKind.Radar]: 'Treasure Radar',
};

/** Items that grant an activatable power-up rather than raw score. */
export const POWERUP_ITEMS: readonly ItemKind[] = [
  ItemKind.Energy,
  ItemKind.Shield,
  ItemKind.Hint,
  ItemKind.DoublePoints,
  ItemKind.Radar,
];

export function isPowerUpItem(kind: ItemKind): boolean {
  return POWERUP_ITEMS.includes(kind);
}

export interface WorldItem {
  id: string;
  kind: ItemKind;
  position: Position;
  /** Set once some player picks it up. Host is the authority on this field. */
  collectedBy?: string;
  collectedAt?: number;
}

export interface Treasure {
  id: string;
  position: Position;
  /** Which player this treasure belongs to; undefined = shared by everyone. */
  ownerId?: string;
  foundBy?: string;
  foundAt?: number;
}

/**
 * A fully materialised virtual world.
 *
 * `treasures` is present on the host, and on a player only after the treasure
 * has been revealed (found / game over). See docs/ARCHITECTURE.md -- "Treasure
 * secrecy" for why treasure placement is deliberately NOT derivable from the
 * world seed that players receive.
 */
export interface GameWorld {
  seed: number;
  size: Size;
  obstacles: Obstacle[];
  /** Non-colliding scenery; visual only. */
  decor: Decor[];
  items: WorldItem[];
  treasures: Treasure[];
  /** Where players are dropped in when the hunt begins. */
  spawnPoint: Position;
}

/** The world minus anything secret -- this is what a joining player rebuilds. */
export type PublicWorld = Omit<GameWorld, 'treasures'> & {
  treasures: Treasure[];
};
