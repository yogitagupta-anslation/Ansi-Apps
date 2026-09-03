/**
 * Deterministic virtual world generation.
 *
 * The whole point: given the same seed and config, every device produces a
 * byte-identical world. That is what lets the host ship a 4-byte seed over BLE
 * instead of kilobytes of geometry.
 *
 * Nothing in this file touches GPS, maps, or physical space. A "world" is a
 * rectangle of abstract units with rectangles (obstacles) and points (items)
 * scattered inside it.
 *
 * Treasure placement lives in TreasureManager and uses a SEPARATE seed that is
 * never transmitted, so a player cannot regenerate the world and read the
 * answer off it.
 */
import {WORLD_GEN} from '../config/gameConfig';
import {
  circleIntersectsRect,
  distance,
  type Position,
  type Rect,
  type Size,
} from '../models/geometry';
import {
  DecorKind,
  ItemKind,
  ObstacleKind,
  type Decor,
  type GameWorld,
  type Obstacle,
  type WorldItem,
} from '../models/world';
import type {GameConfig} from '../models/game';
import {createRng, deriveSeed, type Rng} from '../utils/prng';
import {itemId, obstacleId} from '../utils/id';
import {createLogger} from '../utils/logger';

const log = createLogger('WorldGenerator');

/**
 * Scenery mix. Trees dominate so the world reads as woodland; ruins are rare
 * enough to feel like a landmark when you find one.
 *
 * `size` is the span in world units, and `aspect` lets logs lie flat and
 * ponds spread wide instead of everything being a square block.
 */
const SCENERY: ReadonlyArray<{
  kind: ObstacleKind;
  weight: number;
  size: [number, number];
  aspect: [number, number];
}> = [
  // Kinds with painted art from the UI kit carry most of the weight, so the
  // world reads as drawn scenery rather than a field of glyphs. Tree, Bush,
  // Pond and Ruin have no sprite yet and stay deliberately sparse.
  {kind: ObstacleKind.Tree, weight: 20, size: [4, 7], aspect: [0.85, 1.15]},
  {kind: ObstacleKind.Rock, weight: 15, size: [3, 6], aspect: [1.0, 1.4]},
  {kind: ObstacleKind.Bush, weight: 11, size: [3, 5], aspect: [0.9, 1.3]},
  {kind: ObstacleKind.Log, weight: 11, size: [5, 9], aspect: [1.3, 1.8]},
  {kind: ObstacleKind.Stump, weight: 10, size: [3, 5], aspect: [1.1, 1.5]},
  {kind: ObstacleKind.Pond, weight: 8, size: [6, 11], aspect: [1.3, 2.0]},
  {kind: ObstacleKind.Crystal, weight: 7, size: [3, 5], aspect: [0.9, 1.15]},
  {kind: ObstacleKind.Standing, weight: 6, size: [3, 5], aspect: [0.95, 1.2]},
  {kind: ObstacleKind.Barrel, weight: 6, size: [3, 4], aspect: [1.1, 1.35]},
  {kind: ObstacleKind.Lantern, weight: 4, size: [3, 5], aspect: [0.7, 0.9]},
  {kind: ObstacleKind.Ruin, weight: 2, size: [5, 8], aspect: [0.9, 1.2]},
];

const SCENERY_TOTAL_WEIGHT = SCENERY.reduce((sum, entry) => sum + entry.weight, 0);

function pickScenery(rng: Rng) {
  let roll = rng.float(0, SCENERY_TOTAL_WEIGHT);
  for (const entry of SCENERY) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry;
    }
  }
  return SCENERY[0] as (typeof SCENERY)[number];
}

const DECOR_KINDS: readonly DecorKind[] = [
  DecorKind.Flower,
  DecorKind.Grass,
  DecorKind.Grass,
  DecorKind.Pebble,
  DecorKind.Mushroom,
  DecorKind.Leaf,
  DecorKind.Shard,
  DecorKind.Bone,
];

/** Does this circle overlap any obstacle, allowing for a clearance margin? */
export function collidesWithObstacles(
  position: Position,
  radius: number,
  obstacles: readonly Obstacle[],
): boolean {
  for (const obstacle of obstacles) {
    if (circleIntersectsRect(position, radius, obstacle.bounds)) {
      return true;
    }
  }
  return false;
}

/** True when the point sits inside the world, respecting the edge margin. */
export function isInsideWorld(position: Position, size: Size, margin = 0): boolean {
  return (
    position.x >= margin &&
    position.y >= margin &&
    position.x <= size.width - margin &&
    position.y <= size.height - margin
  );
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * The spawn point is the centre of the world. Fixed rather than random so every
 * player starts on equal footing and the treasure distance rule has a stable
 * anchor.
 */
export function computeSpawnPoint(size: Size): Position {
  return {x: size.width / 2, y: size.height / 2};
}

function generateObstacles(
  rng: Rng,
  size: Size,
  count: number,
  spawnPoint: Position,
): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const {edgeMargin, spawnClearRadius, maxPlacementAttempts} = WORLD_GEN;

  for (let i = 0; i < count; i++) {
    let placed = false;

    for (let attempt = 0; attempt < maxPlacementAttempts && !placed; attempt++) {
      const scenery = pickScenery(rng);
      const span = rng.float(scenery.size[0], scenery.size[1]);
      const aspect = rng.float(scenery.aspect[0], scenery.aspect[1]);
      const width = span * aspect;
      const height = span;

      if (width >= size.width - edgeMargin * 2 || height >= size.height - edgeMargin * 2) {
        continue;
      }

      const bounds: Rect = {
        x: rng.float(edgeMargin, size.width - edgeMargin - width),
        y: rng.float(edgeMargin, size.height - edgeMargin - height),
        width,
        height,
      };

      // Keep the spawn area walkable, or players start wedged inside a rock.
      const centre = {x: bounds.x + width / 2, y: bounds.y + height / 2};
      if (distance(centre, spawnPoint) < spawnClearRadius + Math.max(width, height) / 2) {
        continue;
      }

      // Overlapping scenery reads as one blob and can seal off regions.
      if (obstacles.some(existing => rectsOverlap(bounds, existing.bounds, 1.5))) {
        continue;
      }

      obstacles.push({id: obstacleId(i), kind: scenery.kind, bounds});
      placed = true;
    }

    if (!placed) {
      // A crowded world is fine; a hung generator is not.
      log.debug(`gave up placing scenery ${i} after ${maxPlacementAttempts} attempts`);
    }
  }

  return obstacles;
}

/**
 * Scatter flowers, grass and pebbles across open ground.
 *
 * Decor never collides and is never transmitted -- it is regenerated from the
 * shared world seed, so it costs nothing over BLE but makes the world feel
 * inhabited rather than like a diagram.
 */
function generateDecor(
  rng: Rng,
  size: Size,
  obstacles: readonly Obstacle[],
  count: number,
): Decor[] {
  const decor: Decor[] = [];
  const margin = WORLD_GEN.edgeMargin / 2;

  for (let i = 0; i < count; i++) {
    const position: Position = {
      x: rng.float(margin, size.width - margin),
      y: rng.float(margin, size.height - margin),
    };
    // Skip anything that would sit on top of solid scenery.
    if (collidesWithObstacles(position, 0.8, obstacles)) {
      continue;
    }
    decor.push({
      id: `D${String(i).padStart(3, '0')}`,
      kind: rng.pick(DECOR_KINDS),
      position,
      scale: rng.float(0.75, 1.25),
    });
  }

  return decor;
}

/**
 * Find a free point: inside the world, clear of obstacles, and not on top of
 * anything already placed.
 * @returns null when no spot could be found within the attempt budget.
 */
export function findFreePosition(
  rng: Rng,
  size: Size,
  obstacles: readonly Obstacle[],
  occupied: readonly Position[],
  options: {
    minSpacing?: number;
    clearance?: number;
    minDistanceFrom?: {point: Position; distance: number};
    attempts?: number;
  } = {},
): Position | null {
  const {
    minSpacing = WORLD_GEN.itemSpacing,
    clearance = WORLD_GEN.itemClearance,
    minDistanceFrom,
    attempts = WORLD_GEN.maxPlacementAttempts,
  } = options;

  const margin = WORLD_GEN.edgeMargin;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate: Position = {
      x: rng.float(margin, size.width - margin),
      y: rng.float(margin, size.height - margin),
    };

    if (collidesWithObstacles(candidate, clearance, obstacles)) {
      continue;
    }
    if (minDistanceFrom && distance(candidate, minDistanceFrom.point) < minDistanceFrom.distance) {
      continue;
    }
    if (occupied.some(point => distance(candidate, point) < minSpacing)) {
      continue;
    }

    return candidate;
  }

  return null;
}

function generateItems(
  rng: Rng,
  size: Size,
  obstacles: readonly Obstacle[],
  spawnPoint: Position,
  config: GameConfig,
): WorldItem[] {
  const items: WorldItem[] = [];
  const occupied: Position[] = [spawnPoint];

  const plan: Array<{kind: ItemKind; count: number}> = [
    {kind: ItemKind.Coin, count: config.coinCount},
    {kind: ItemKind.Gem, count: config.gemCount},
  ];

  // Power-up types are spread evenly, remainder distributed from the front.
  const powerUpKinds = [
    ItemKind.Radar,
    ItemKind.Hint,
    ItemKind.Energy,
    ItemKind.DoublePoints,
    ItemKind.Shield,
  ];
  const perKind = Math.floor(config.powerUpCount / powerUpKinds.length);
  const remainder = config.powerUpCount % powerUpKinds.length;
  powerUpKinds.forEach((kind, index) => {
    const count = perKind + (index < remainder ? 1 : 0);
    if (count > 0) {
      plan.push({kind, count});
    }
  });

  let index = 0;
  for (const {kind, count} of plan) {
    for (let i = 0; i < count; i++) {
      const position = findFreePosition(rng, size, obstacles, occupied, {
        // Keep the first few steps from being a free jackpot.
        minDistanceFrom: {point: spawnPoint, distance: 6},
      });
      if (!position) {
        log.debug(`no room left for ${kind} #${i}`);
        continue;
      }
      occupied.push(position);
      items.push({id: itemId(index++), kind, position});
    }
  }

  return items;
}

/**
 * Build the full world from a seed.
 *
 * Each generation pass draws from its own derived sub-stream, so changing the
 * coin count does not shift where the obstacles land. That keeps worlds stable
 * across config tweaks and makes bugs reproducible.
 */
export function generateWorld(seed: number, config: GameConfig): GameWorld {
  const size = config.worldSize;
  const spawnPoint = computeSpawnPoint(size);

  const obstacleRng = createRng(deriveSeed(seed, 'obstacles'));
  const itemRng = createRng(deriveSeed(seed, 'items'));
  const decorRng = createRng(deriveSeed(seed, 'decor'));

  const obstacles = generateObstacles(obstacleRng, size, config.obstacleCount, spawnPoint);
  const items = generateItems(itemRng, size, obstacles, spawnPoint, config);
  // Decor density scales with area so a big world does not look bare.
  const decorCount = Math.round((size.width * size.height) / 90);
  const decor = generateDecor(decorRng, size, obstacles, decorCount);

  log.info(
    `world ${seed}: ${obstacles.length} scenery, ${decor.length} decor, ` +
      `${items.length} items, ${size.width}x${size.height}`,
  );

  return {
    seed,
    size,
    obstacles,
    decor,
    items,
    // Populated by TreasureManager on the host only.
    treasures: [],
    spawnPoint,
  };
}

/**
 * Resolve a desired move against the world.
 *
 * Axes are tested independently so a player sliding along a wall keeps moving
 * instead of sticking, which is what makes the D-pad feel right.
 */
export function resolveMovement(
  from: Position,
  to: Position,
  world: Pick<GameWorld, 'obstacles' | 'size'>,
  radius = WORLD_GEN.playerRadius,
): Position {
  const clampToWorld = (p: Position): Position => ({
    x: Math.min(Math.max(p.x, radius), world.size.width - radius),
    y: Math.min(Math.max(p.y, radius), world.size.height - radius),
  });

  const target = clampToWorld(to);

  if (!collidesWithObstacles(target, radius, world.obstacles)) {
    return target;
  }

  const slideX = clampToWorld({x: target.x, y: from.y});
  if (!collidesWithObstacles(slideX, radius, world.obstacles)) {
    return slideX;
  }

  const slideY = clampToWorld({x: from.x, y: target.y});
  if (!collidesWithObstacles(slideY, radius, world.obstacles)) {
    return slideY;
  }

  // Boxed in on both axes -- stay put.
  return from;
}
