/**
 * Treasure placement and discovery -- host authority only.
 *
 * Treasure secrecy
 * ----------------
 * The world seed IS shared with players so they can rebuild terrain and items
 * locally. Treasure placement therefore uses a SEPARATE seed that never leaves
 * the host. If the treasure came from the shared seed, any player could
 * regenerate the world offline and read the answer straight off it.
 *
 * Placement rules (all enforced here):
 *   - inside the world bounds, respecting the edge margin
 *   - never inside an obstacle
 *   - at least config.minTreasureSpawnDistance from the spawn point
 *   - not stacked on top of an existing item or another treasure
 */
import {WORLD_GEN} from '../config/gameConfig';
import type {GameConfig} from '../models/game';
import {GameMode} from '../models/game';
import type {Position} from '../models/geometry';
import type {GameWorld, Treasure} from '../models/world';
import {createRng, deriveSeed, generateSeed, type Rng} from '../utils/prng';
import {treasureId as makeTreasureId} from '../utils/id';
import {createLogger} from '../utils/logger';
import {findFreePosition} from './WorldGenerator';
import {hasReachedTreasure} from './ProximityService';

const log = createLogger('TreasureManager');

export interface TreasurePlacementResult {
  treasures: Treasure[];
  /** Kept on the host so respawns stay deterministic within a match. */
  treasureSeed: number;
}

export class TreasureManager {
  private treasureSeed: number;
  private rng: Rng;
  private treasures: Treasure[] = [];
  private spawnCounter = 0;

  /**
   * @param treasureSeed omit to generate a fresh secret seed. Passing one is
   *        for tests and for replaying a match locally.
   */
  constructor(treasureSeed: number = generateSeed()) {
    this.treasureSeed = treasureSeed;
    this.rng = createRng(deriveSeed(treasureSeed, 'treasure'));
  }

  /** The secret seed. Never send this to a player. */
  get seed(): number {
    return this.treasureSeed;
  }

  getTreasures(): Treasure[] {
    return this.treasures.map(treasure => ({...treasure}));
  }

  getTreasure(id: string): Treasure | undefined {
    return this.treasures.find(treasure => treasure.id === id);
  }

  /** The treasure a given player is hunting, honouring per-player ownership. */
  treasureForPlayer(playerId: string): Treasure | undefined {
    const owned = this.treasures.find(
      treasure => treasure.ownerId === playerId && !treasure.foundBy,
    );
    if (owned) {
      return owned;
    }
    return this.treasures.find(treasure => !treasure.ownerId && !treasure.foundBy);
  }

  /**
   * Place the treasures for a new match.
   * @param playerIds needed by Individual Hunt, which gives everyone their own.
   */
  placeInitial(world: GameWorld, config: GameConfig, playerIds: string[]): Treasure[] {
    this.treasures = [];
    this.spawnCounter = 0;

    if (config.mode === GameMode.IndividualHunt) {
      for (const playerId of playerIds) {
        const treasure = this.spawnOne(world, config, playerId);
        if (treasure) {
          this.treasures.push(treasure);
        }
      }
    } else {
      const treasure = this.spawnOne(world, config);
      if (treasure) {
        this.treasures.push(treasure);
      }
    }

    log.info(
      `placed ${this.treasures.length} treasure(s) for ${config.mode} ` +
        `(secret seed ${this.treasureSeed})`,
    );
    return this.getTreasures();
  }

  /**
   * Choose a valid treasure position and build the treasure.
   * @returns null when the world is so crowded no legal spot exists.
   */
  private spawnOne(
    world: GameWorld,
    config: GameConfig,
    ownerId?: string,
  ): Treasure | null {
    // Everything already occupying space: items and previously placed treasure.
    const occupied: Position[] = [
      ...world.items.filter(item => !item.collectedBy).map(item => item.position),
      ...this.treasures.map(treasure => treasure.position),
    ];

    const position = findFreePosition(this.rng, world.size, world.obstacles, occupied, {
      minSpacing: WORLD_GEN.itemSpacing,
      clearance: WORLD_GEN.itemClearance,
      minDistanceFrom: {
        point: world.spawnPoint,
        distance: config.minTreasureSpawnDistance,
      },
    });

    if (!position) {
      // Retry with the spawn-distance rule relaxed rather than shipping a
      // treasure-less match. A close treasure beats no treasure.
      log.warn('no spot satisfied the spawn-distance rule; relaxing it');
      const fallback = findFreePosition(this.rng, world.size, world.obstacles, occupied, {
        minSpacing: WORLD_GEN.itemSpacing / 2,
        clearance: WORLD_GEN.itemClearance,
        minDistanceFrom: {
          point: world.spawnPoint,
          distance: config.minTreasureSpawnDistance / 2,
        },
      });
      if (!fallback) {
        log.error('could not place a treasure anywhere in this world');
        return null;
      }
      return this.buildTreasure(fallback, ownerId);
    }

    return this.buildTreasure(position, ownerId);
  }

  private buildTreasure(position: Position, ownerId?: string): Treasure {
    const treasure: Treasure = {
      id: makeTreasureId(this.spawnCounter++),
      position,
    };
    if (ownerId) {
      treasure.ownerId = ownerId;
    }
    return treasure;
  }

  /**
   * Timed Hunt: replace a collected treasure with a fresh one somewhere else.
   * @returns the new treasure, or null if the world has no room left.
   */
  respawn(world: GameWorld, config: GameConfig, ownerId?: string): Treasure | null {
    const treasure = this.spawnOne(world, config, ownerId);
    if (treasure) {
      this.treasures.push(treasure);
      log.info(`respawned treasure ${treasure.id}`);
    }
    return treasure;
  }

  /**
   * Host-authoritative discovery check.
   * @returns the treasure this player just reached, or null.
   */
  checkFound(
    playerId: string,
    playerPosition: Position,
    config: GameConfig,
  ): Treasure | null {
    for (const treasure of this.treasures) {
      if (treasure.foundBy) {
        continue;
      }
      // In Individual Hunt a player can only find their own treasure.
      if (treasure.ownerId && treasure.ownerId !== playerId) {
        continue;
      }
      if (hasReachedTreasure(playerPosition, treasure.position, config.treasureFoundRadius)) {
        return treasure;
      }
    }
    return null;
  }

  /** Record the find. Returns false if someone else already claimed it. */
  markFound(treasureId: string, playerId: string): boolean {
    const treasure = this.treasures.find(t => t.id === treasureId);
    if (!treasure || treasure.foundBy) {
      return false;
    }
    treasure.foundBy = playerId;
    treasure.foundAt = Date.now();
    log.info(`treasure ${treasureId} found by ${playerId}`);
    return true;
  }

  /** True when nothing is left to find. */
  get allFound(): boolean {
    return this.treasures.length > 0 && this.treasures.every(t => Boolean(t.foundBy));
  }

  get foundCount(): number {
    return this.treasures.filter(t => t.foundBy).length;
  }

  /** Positions to reveal once the match ends. */
  revealAll(): Array<{treasureId: string; position: Position}> {
    return this.treasures.map(t => ({treasureId: t.id, position: t.position}));
  }

  reset(): void {
    this.treasures = [];
    this.spawnCounter = 0;
    this.treasureSeed = generateSeed();
    this.rng = createRng(deriveSeed(this.treasureSeed, 'treasure'));
  }
}
