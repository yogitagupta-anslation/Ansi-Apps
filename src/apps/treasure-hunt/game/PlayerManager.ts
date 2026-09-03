/**
 * The roster: who is in the match, where they are, and what they are holding.
 *
 * Movement authority
 * ------------------
 * Players simulate their own movement locally so the D-pad feels instant, then
 * report the result. The host re-validates every reported position against the
 * world (bounds, obstacles, max speed) and keeps its own copy as the truth. A
 * client that reports an impossible jump gets clamped, not trusted.
 */
import {SPEED_BOOST_MULTIPLIER, TIMING} from '../config/gameConfig';
import type {GameConfig} from '../models/game';
import {distance, type Position} from '../models/geometry';
import {
  PlayerConnectionState,
  PlayerStatus,
  createPlayer,
  type ActivePowerUp,
  type Avatar,
  type Player,
} from '../models/player';
import {ItemKind, type GameWorld} from '../models/world';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {resolveMovement} from './WorldGenerator';

const log = createLogger('PlayerManager');

export interface PlayerManagerEvents {
  playerAdded: Player;
  playerRemoved: {playerId: string; reason: string};
  playerUpdated: Player;
  rosterChanged: Player[];
  connectionChanged: {playerId: string; state: PlayerConnectionState};
}

export class PlayerManager {
  readonly events = new Emitter<PlayerManagerEvents>();

  private players = new Map<string, Player>();
  private lastTagAt = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  add(init: {
    id: string;
    name: string;
    avatar: Avatar;
    isHost?: boolean;
    peerId?: string;
    spawnPoint: Position;
    teamId?: string;
  }): Player {
    const existing = this.players.get(init.id);
    if (existing) {
      // Reconnect: keep score and inventory, rebind the link.
      existing.connection = PlayerConnectionState.Connected;
      existing.lastSeenAt = Date.now();
      if (init.peerId) {
        existing.peerId = init.peerId;
      }
      // The peer restarts its seq counter, so drop the old high-water mark.
      existing.lastMoveSeq = -1;
      log.info(
        `[POSITION TRACE] source=RECONNECT_KEEPS_POSITION playerId=${existing.id}` +
          ` peerId=${existing.peerId ?? '-'}` +
          ` old=(${existing.position.x.toFixed(2)},${existing.position.y.toFixed(2)})` +
          ` new=(unchanged) requestedSpawn=` +
          `(${init.spawnPoint.x.toFixed(2)},${init.spawnPoint.y.toFixed(2)})` +
          ` phase=${this.traceContext.phase} role=${this.traceContext.role}`,
      );
      this.emitUpdated(existing);
      log.info(`player ${init.id} rejoined`);
      return {...existing};
    }

    const player = createPlayer({
      id: init.id,
      name: init.name,
      avatar: init.avatar,
      isHost: init.isHost ?? false,
      position: {...init.spawnPoint},
      lastSeenAt: Date.now(),
      ...(init.peerId ? {peerId: init.peerId} : {}),
      ...(init.teamId ? {teamId: init.teamId} : {}),
    });

    this.players.set(player.id, player);
    log.info(
      `[POSITION TRACE] source=PLAYER_CREATED playerId=${player.id}` +
        ` peerId=${player.peerId ?? '-'} old=(-,-)` +
        ` new=(${player.position.x.toFixed(2)},${player.position.y.toFixed(2)})` +
        ` phase=${this.traceContext.phase} seed=${this.traceContext.seed}` +
        ` role=${this.traceContext.role}`,
    );
    log.info(`player ${player.id} (${player.name}) joined`);
    this.events.emit('playerAdded', {...player});
    this.emitRoster();
    return {...player};
  }

  remove(playerId: string, reason: string): void {
    if (!this.players.delete(playerId)) {
      return;
    }
    this.lastTagAt.delete(playerId);
    log.info(`player ${playerId} removed: ${reason}`);
    this.events.emit('playerRemoved', {playerId, reason});
    this.emitRoster();
  }

  get(playerId: string): Player | undefined {
    const player = this.players.get(playerId);
    return player ? {...player} : undefined;
  }

  list(): Player[] {
    return Array.from(this.players.values()).map(player => ({...player}));
  }

  get count(): number {
    return this.players.size;
  }

  get activeCount(): number {
    let total = 0;
    for (const player of this.players.values()) {
      if (player.connection !== PlayerConnectionState.Disconnected) {
        total++;
      }
    }
    return total;
  }

  has(playerId: string): boolean {
    return this.players.has(playerId);
  }

  findByPeerId(peerId: string): Player | undefined {
    for (const player of this.players.values()) {
      if (player.peerId === peerId) {
        return {...player};
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Movement
  // -------------------------------------------------------------------------

  /**
   * Effective movement speed, accounting for an active Speed Boost.
   * Shared by the local simulation and the host's anti-cheat check so the two
   * can never disagree about what is possible.
   */
  speedFor(playerId: string, config: GameConfig, atMs = Date.now()): number {
    const player = this.players.get(playerId);
    if (!player) {
      return config.moveSpeed;
    }
    const boosted = player.activePowerUps.some(
      p => p.kind === ItemKind.Energy && p.expiresAt > atMs,
    );
    return boosted ? config.moveSpeed * SPEED_BOOST_MULTIPLIER : config.moveSpeed;
  }

  /**
   * Advance a player locally from a direction vector. Used by the device that
   * owns the player, every simulation tick.
   * @param direction unit-ish vector; magnitude is clamped to 1.
   */
  applyLocalMovement(
    playerId: string,
    direction: Position,
    deltaSec: number,
    world: GameWorld,
    config: GameConfig,
  ): Position | null {
    const player = this.players.get(playerId);
    if (!player) {
      return null;
    }

    const magnitude = Math.hypot(direction.x, direction.y);
    if (magnitude < 0.001) {
      return {...player.position};
    }

    // Normalise so diagonal input is not faster than straight input.
    const scale = Math.min(magnitude, 1) / magnitude;
    const speed = this.speedFor(playerId, config);
    const target: Position = {
      x: player.position.x + direction.x * scale * speed * deltaSec,
      y: player.position.y + direction.y * scale * speed * deltaSec,
    };

    const resolved = resolveMovement(player.position, target, world);
    this.writePosition(player, resolved, 'LOCAL_MOVE');
    return {...resolved};
  }

  /**
   * Host side: accept a position reported by a remote player.
   *
   * Rejects stale packets by sequence number, then clamps the move to what is
   * physically possible in the elapsed time. A generous 2x tolerance absorbs
   * jitter and a late packet without letting a client teleport.
   *
   * @returns the accepted position, or null if the update was stale.
   */
  applyRemoteMovement(
    playerId: string,
    reported: Position,
    seq: number,
    world: GameWorld,
    config: GameConfig,
  ): Position | null {
    const player = this.players.get(playerId);
    if (!player) {
      return null;
    }

    if (seq <= player.lastMoveSeq) {
      return null;
    }

    const now = Date.now();
    const elapsedSec = Math.max(0.05, (now - player.lastSeenAt) / 1000);
    const maxTravel = this.speedFor(playerId, config, now) * elapsedSec * 2;
    const requested = distance(player.position, reported);

    let target = reported;
    if (requested > maxTravel) {
      // Move as far along the requested direction as the budget allows.
      const t = maxTravel / requested;
      target = {
        x: player.position.x + (reported.x - player.position.x) * t,
        y: player.position.y + (reported.y - player.position.y) * t,
      };
      log.debug(
        `clamped ${playerId}: asked for ${requested.toFixed(1)}u, allowed ${maxTravel.toFixed(1)}u`,
      );
    }

    // The world still gets the final say on obstacles and bounds.
    const resolved = resolveMovement(player.position, target, world);

    this.writePosition(player, resolved, `REMOTE_MOVE seq=${seq}`);
    player.lastMoveSeq = seq;
    player.lastSeenAt = now;

    return {...resolved};
  }

  /** Force a position without validation -- host applying its own authority. */
  setPosition(playerId: string, position: Position): void {
    const player = this.players.get(playerId);
    if (player) {
      this.writePosition(player, position, 'SET_POSITION');
    }
  }

  /* ----------------------------- POSITION TRACE ---------------------------
   * TEMPORARY diagnostic. Every write to a player's position goes through
   * writePosition() so the trace cannot miss one. Remove once the stale-spawn
   * investigation is closed.
   * ---------------------------------------------------------------------- */

  /** Set by GameManager so the trace can name the phase/seed it happened in. */
  traceContext: {phase: string; seed: number; role: string; localId: string} = {
    phase: '?',
    seed: 0,
    role: '?',
    localId: '?',
  };

  private lastTraceAt = new Map<string, number>();

  private writePosition(player: Player, next: Position, source: string): void {
    const from = player.position;
    const moved = from.x !== next.x || from.y !== next.y;
    // Per-frame sources would drown the log, so they report at most once a
    // second; everything else is always traced.
    const noisy = source === 'LOCAL_MOVE' || source === 'REMOTE_MOVE';
    const now = Date.now();
    const key = `${source}:${player.id}`;
    const due = (this.lastTraceAt.get(key) ?? 0) + 1000 <= now;
    if (moved && (!noisy || due)) {
      this.lastTraceAt.set(key, now);
      log.info(
        `[POSITION TRACE] source=${source} playerId=${player.id}` +
          ` peerId=${player.peerId ?? '-'}` +
          ` old=(${from.x.toFixed(2)},${from.y.toFixed(2)})` +
          ` new=(${next.x.toFixed(2)},${next.y.toFixed(2)})` +
          ` phase=${this.traceContext.phase} seed=${this.traceContext.seed}` +
          ` role=${this.traceContext.role}` +
          ` isLocal=${player.id === this.traceContext.localId}`,
      );
    }
    player.position = {...next};
  }

  /**
   * Wipe every player's per-match state and park them on the new spawn.
   *
   * Identity is deliberately preserved -- id, name, avatar, host flag, peer
   * binding, team and connection all survive, because a rematch is the same
   * people playing again. Everything a match accumulates does not: this used
   * to reset only the position, so inventory, active power-ups and the
   * collected-item set were carried into the next hunt (they were cleared
   * nowhere else in the codebase).
   *
   * Called at every new-match boundary, so it is the one place that decides
   * what "a fresh match" means for a player.
   */
  resetForNewMatch(spawnPoint: Position): void {
    for (const player of this.players.values()) {
      this.writePosition(player, spawnPoint, 'RESET_FOR_NEW_MATCH');
      // Drop the peer's movement high-water mark, or the first move of the new
      // match looks stale and gets rejected.
      player.lastMoveSeq = -1;
      player.inventory = [];
      player.activePowerUps = [];
      player.collectedItemIds = [];
    }
    this.emitRoster();
  }

  // -------------------------------------------------------------------------
  // Inventory, power-ups, status
  // -------------------------------------------------------------------------

  addToInventory(playerId: string, kind: ItemKind): void {
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }
    player.inventory.push(kind);
    this.emitUpdated(player);
  }

  /** Remove one of `kind` from the bag. Returns false if none was held. */
  consumeFromInventory(playerId: string, kind: ItemKind): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }
    const index = player.inventory.indexOf(kind);
    if (index < 0) {
      return false;
    }
    player.inventory.splice(index, 1);
    this.emitUpdated(player);
    return true;
  }

  activatePowerUp(playerId: string, kind: ItemKind, durationMs: number): ActivePowerUp | null {
    const player = this.players.get(playerId);
    if (!player) {
      return null;
    }
    const expiresAt = Date.now() + durationMs;

    // Re-activating an already-running power-up extends it rather than stacking.
    const existing = player.activePowerUps.find(p => p.kind === kind);
    if (existing) {
      existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      this.emitUpdated(player);
      return {...existing};
    }

    const active: ActivePowerUp = {kind, expiresAt};
    player.activePowerUps.push(active);
    this.emitUpdated(player);
    return {...active};
  }

  hasActivePowerUp(playerId: string, kind: ItemKind, atMs = Date.now()): boolean {
    const player = this.players.get(playerId);
    if (!player) {
      return false;
    }
    return player.activePowerUps.some(p => p.kind === kind && p.expiresAt > atMs);
  }

  /** Drop expired power-ups. Returns the players whose effects changed. */
  expirePowerUps(atMs = Date.now()): Player[] {
    const changed: Player[] = [];
    for (const player of this.players.values()) {
      const before = player.activePowerUps.length;
      player.activePowerUps = player.activePowerUps.filter(p => p.expiresAt > atMs);
      if (player.activePowerUps.length !== before) {
        changed.push({...player});
        this.emitUpdated(player);
      }
    }
    return changed;
  }

  markItemCollected(playerId: string, itemId: string): void {
    const player = this.players.get(playerId);
    if (player && !player.collectedItemIds.includes(itemId)) {
      player.collectedItemIds.push(itemId);
    }
  }

  setStatus(playerId: string, status: PlayerStatus): void {
    const player = this.players.get(playerId);
    if (player && player.status !== status) {
      player.status = status;
      this.emitUpdated(player);
    }
  }

  setConnection(playerId: string, state: PlayerConnectionState): void {
    const player = this.players.get(playerId);
    if (!player || player.connection === state) {
      return;
    }
    player.connection = state;
    if (state === PlayerConnectionState.Connected) {
      player.lastSeenAt = Date.now();
    }
    this.events.emit('connectionChanged', {playerId, state});
    this.emitUpdated(player);
  }

  setTeam(playerId: string, teamId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.teamId = teamId;
      this.emitUpdated(player);
    }
  }

  touch(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.lastSeenAt = Date.now();
    }
  }

  /** Players the host has not heard from within the timeout. */
  findStale(timeoutMs = TIMING.peerTimeoutMs, atMs = Date.now()): Player[] {
    const cutoff = atMs - timeoutMs;
    return this.list().filter(
      player =>
        !player.isHost &&
        player.connection === PlayerConnectionState.Connected &&
        player.lastSeenAt < cutoff,
    );
  }

  /** Tag cooldown gate, so one player cannot spam another. */
  canTag(playerId: string, atMs = Date.now()): boolean {
    const last = this.lastTagAt.get(playerId) ?? 0;
    return atMs - last >= TIMING.tagCooldownMs;
  }

  recordTag(playerId: string, atMs = Date.now()): void {
    this.lastTagAt.set(playerId, atMs);
  }

  /** Other players within tag range of this one. */
  playersNear(playerId: string, radius = TIMING.tagRadius): Player[] {
    const source = this.players.get(playerId);
    if (!source) {
      return [];
    }
    return this.list().filter(
      other =>
        other.id !== playerId &&
        other.connection === PlayerConnectionState.Connected &&
        distance(source.position, other.position) <= radius,
    );
  }

  private emitUpdated(player: Player): void {
    this.events.emit('playerUpdated', {...player});
    this.emitRoster();
  }

  private emitRoster(): void {
    this.events.emit('rosterChanged', this.list());
  }

  clear(): void {
    this.players.clear();
    this.lastTagAt.clear();
    this.emitRoster();
  }

  dispose(): void {
    this.players.clear();
    this.lastTagAt.clear();
    this.events.removeAllListeners();
  }
}
