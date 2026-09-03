/**
 * The game engine and the only thing the UI talks to.
 *
 * Authority model
 * ---------------
 * The host is the referee. It owns treasure placement, item collection, scoring
 * and the clock. Players simulate their own movement locally so controls feel
 * instant, then report it; the host re-validates and corrects. Everything a
 * player learns about the world beyond its own position arrives from the host.
 *
 * That split is what keeps the game honest without a server: a modified client
 * can lie about where it is, but the host clamps impossible moves and is the
 * only device that knows where the treasure actually is.
 *
 * The same class runs in both roles. `role` selects which half of the message
 * handlers are wired up.
 */
import {
  DEFAULT_GAME_CONFIG,
  POWERUP_SPECS,
  TIMING,
} from '../config/gameConfig';
import {
  GameMode,
  GamePhase,
  ProximityLevel,
  type GameConfig,
  type GameState,
  type MatchResult,
  type ProximityReport,
} from '../models/game';
import {distance, type Position} from '../models/geometry';
import {
  PlayerConnectionState,
  PlayerStatus,
  type Avatar,
  type Player,
  type Team,
} from '../models/player';
import {ItemKind, isPowerUpItem, type GameWorld, type WorldItem} from '../models/world';
import {
  MessageType,
  PROTOCOL_VERSION,
  PlayerActionKind,
  type GameEndPayload,
  type GameJoinAcceptedPayload,
  type GameJoinPayload,
  type GameJoinRejectedPayload,
  type GameStartPayload,
  type GameStatePayload,
  type ItemCollectedPayload,
  type PlayerActionPayload,
  type PlayerJoinedPayload,
  type PlayerLeftPayload,
  type PlayerMovePayload,
  type LobbyStatePayload,
  type PlayerSummary,
  type PowerUpUsedPayload,
  type ProximityUpdatePayload,
  type ScoreUpdatePayload,
  type TreasureFoundPayload,
} from '../models/messages';
import {
  BleAdapterState,
  BleLinkState,
  BleManager,
  BleRole,
  type BleError,
} from '../ble/BleManager';
import type {Transport} from '../ble/transport/Transport';
import type {BlePeer, DiscoveredHost} from '../ble/BleTypes';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {TickLoop} from '../utils/time';
import {gameId as newGameId, playerIdFromIndex} from '../utils/id';
import {generateSeed} from '../utils/prng';

import {GameTimer} from './GameTimer';
import {LobbyManager} from './LobbyManager';
import {PlayerManager} from './PlayerManager';
import {PowerUpManager} from './PowerUpManager';
import {ScoreManager} from './ScoreManager';
import {TreasureManager} from './TreasureManager';
import {buildProximityReport, shouldRevealTreasure} from './ProximityService';
import {generateWorld} from './WorldGenerator';
import {createGameMode, type GameModeStrategy, type ModeContext} from './modes';

const log = createLogger('GameManager');

/**
 * How often the host re-offers the open lobby to connected peers.
 *
 * Slow enough to be nearly free on a BLE link, fast enough that a player
 * whose link blipped during a rematch rejoins the lobby within a beat.
 */
const LOBBY_HEARTBEAT_MS = 3000;

export type GameRole = 'HOST' | 'PLAYER';

export interface GameManagerEvents {
  stateChanged: GameState;
  phaseChanged: GamePhase;
  worldReady: GameWorld;
  rosterChanged: Player[];
  /** Local player's hot/cold reading. */
  proximityChanged: ProximityReport;
  itemCollected: {item: WorldItem; playerId: string; points: number; isLocal: boolean};
  powerUpActivated: {playerId: string; kind: ItemKind; expiresAt: number; isLocal: boolean};
  treasureFound: TreasureFoundPayload;
  countdownTick: {secondsLeft: number};
  timerTick: {remainingMs: number};
  matchEnded: MatchResult;
  hostsChanged: DiscoveredHost[];
  connectionChanged: {connected: boolean; reconnecting: boolean};
  adapterStateChanged: BleAdapterState;
  linkStateChanged: BleLinkState;
  notice: {kind: 'info' | 'warn' | 'error'; message: string};
  error: BleError | Error;
}

export interface LocalProfile {
  name: string;
  avatar: Avatar;
}

export class GameManager {
  readonly events = new Emitter<GameManagerEvents>();

  readonly lobby = new LobbyManager();
  readonly players = new PlayerManager();
  readonly scores = new ScoreManager();
  readonly timer = new GameTimer();
  readonly powerUps: PowerUpManager;

  private treasures = new TreasureManager();
  private mode: GameModeStrategy = createGameMode(GameMode.SharedTreasure);
  private ble: BleManager | null = null;

  private role: GameRole = 'PLAYER';
  private profile: LocalProfile = {name: 'Hunter', avatar: '🦊'};

  private world: GameWorld | null = null;
  private worldSeed = 0;
  private phase: GamePhase = GamePhase.Idle;
  private gameCode = '';
  private matchId = '';
  /** Host: re-offers the lobby to peers that missed it. See setPhase. */
  private lobbyHeartbeat: ReturnType<typeof setInterval> | null = null;
  /**
   * Bumped for every match. Stamped on outgoing gameplay traffic and checked
   * on the way in, so a packet from the previous hunt cannot mutate this one.
   */
  private matchEpoch = 0;
  private hostId = '';
  private localPlayerId = '';
  private teams: Team[] = [];
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private winnerId: string | null = null;
  private winningTeamId: string | null = null;
  private config: GameConfig = {...DEFAULT_GAME_CONFIG};

  private transportFactory: ((role: BleRole) => Transport) | undefined;

  /** Current movement vector for the local player, set by drag gestures. */
  private moveDirection: Position = {x: 0, y: 0};
  private simulation: TickLoop | null = null;
  private lastMoveSentAt = 0;
  private lastSentPosition: Position | null = null;
  private lastStateBroadcastAt = 0;
  private lastProximityPushAt = 0;
  private lastRenderPushAt = 0;
  private lastProximityLevel: ProximityLevel | null = null;
  /** Treasure disclosed to the local player because they are close. */
  private revealedTreasure: {treasureId: string; position: Position} | null = null;
  private unsubscribers: Array<() => void> = [];
  private nextPlayerIndex = 0;
  private disposed = false;

  constructor() {
    this.powerUps = new PowerUpManager(this.players);
    this.wireInternalEvents();
  }

  // -------------------------------------------------------------------------
  // Public read-only surface
  // -------------------------------------------------------------------------

  get currentPhase(): GamePhase {
    return this.phase;
  }

  get currentRole(): GameRole {
    return this.role;
  }

  get currentWorld(): GameWorld | null {
    return this.world;
  }

  get code(): string {
    return this.gameCode;
  }

  /**
   * Supply the BLE transport instead of probing the radio.
   *
   * Integration tests use this to run both roles over an in-memory link. The
   * app never calls it, so production still probes the real stack and still
   * fails loudly when the hardware cannot host.
   */
  setTransportFactory(factory: (role: BleRole) => Transport): void {
    this.transportFactory = factory;
  }

  get localId(): string {
    return this.localPlayerId;
  }

  get isHost(): boolean {
    return this.role === 'HOST';
  }

  get bleManager(): BleManager | null {
    return this.ble;
  }

  getState(): GameState {
    const playerRecord: Record<string, Player> = {};
    for (const player of this.players.list()) {
      playerRecord[player.id] = {...player, score: this.scores.scoreFor(player.id)};
    }
    const teamRecord: Record<string, Team> = {};
    for (const team of this.teams) {
      teamRecord[team.id] = {...team};
    }

    return {
      gameId: this.matchId,
      gameCode: this.gameCode,
      phase: this.phase,
      config: this.config,
      world: this.world,
      players: playerRecord,
      teams: teamRecord,
      hostId: this.hostId,
      localPlayerId: this.localPlayerId,
      startedAt: this.startedAt,
      endsAt: this.timer.endsAt,
      finishedAt: this.finishedAt,
      winnerId: this.winnerId,
      winningTeamId: this.winningTeamId,
      recentScoreEvents: this.scores.getHistory(),
    };
  }

  getLocalPlayer(): Player | undefined {
    return this.localPlayerId ? this.players.get(this.localPlayerId) : undefined;
  }

  /** Items still on the map. */
  getRemainingItems(): WorldItem[] {
    return this.world?.items.filter(item => !item.collectedBy) ?? [];
  }

  /**
   * Treasures the local device is allowed to RENDER.
   *
   * Three ways a chest becomes visible, and no others:
   *   1. it has been found,
   *   2. the match is over and the host has revealed everything,
   *   3. this player is close enough that it reveals itself (VERY_HOT or nearer).
   *
   * That holds for the host too. The host is also a player, and drawing an
   * unfound treasure on its own map would simply hand it the answer -- it still
   * KNOWS the position internally, because it has to referee the find.
   */
  getVisibleTreasures(): Array<{id: string; position: Position; foundBy?: string}> {
    const revealAll = this.phase === GamePhase.Finished;

    const source =
      this.role === 'HOST' ? this.treasures.getTreasures() : this.world?.treasures ?? [];

    const visible = source
      .filter(treasure => revealAll || Boolean(treasure.foundBy))
      .map(treasure => ({
        id: treasure.id,
        position: treasure.position,
        ...(treasure.foundBy ? {foundBy: treasure.foundBy} : {}),
      }));

    // The close-range reveal, if it is not already in the list.
    const reveal = this.revealedTreasure;
    if (reveal && !visible.some(entry => entry.id === reveal.treasureId)) {
      visible.push({id: reveal.treasureId, position: reveal.position});
    }

    return visible;
  }

  private setPhase(phase: GamePhase): void {
    if (this.phase === phase) {
      return;
    }
    this.phase = phase;
    // Keep the position trace labelled with the live phase/seed.
    this.players.traceContext = {
      phase,
      seed: this.worldSeed,
      role: this.role,
      localId: this.localPlayerId,
    };
    if (this.role === 'HOST') {
      if (phase === GamePhase.Lobby) {
        this.startLobbyHeartbeat();
      } else {
        this.stopLobbyHeartbeat();
      }
    }
    log.info(`phase -> ${phase}`);
    this.events.emit('phaseChanged', phase);
    this.emitState();
  }

  private emitState(): void {
    if (!this.disposed) {
      this.events.emit('stateChanged', this.getState());
    }
  }

  private notify(kind: 'info' | 'warn' | 'error', message: string): void {
    this.events.emit('notice', {kind, message});
  }

  /**
   * Release any existing BLE stack before building a new one.
   *
   * The two roles use different transports, so switching from Join to Host (or
   * back) must not leave the previous one alive: it would keep a scanner or an
   * advertiser registered with the native stack, and the next start would fail
   * with "Already advertising" or a stuck scan.
   */
  private async teardownBle(): Promise<void> {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    if (this.ble) {
      const previous = this.ble;
      this.ble = null;
      try {
        await previous.shutdown();
      } catch (err) {
        log.warn('previous BLE manager did not shut down cleanly', err);
      }
    }
  }

  private wireInternalEvents(): void {
    this.players.events.on('rosterChanged', roster => {
      this.events.emit('rosterChanged', roster);
      this.emitState();
    });

    this.timer.events.on('countdownTick', payload => {
      this.events.emit('countdownTick', payload);
    });

    this.timer.events.on('tick', payload => {
      this.events.emit('timerTick', payload);
    });

    this.timer.events.on('expired', () => {
      if (this.role === 'HOST') {
        this.endMatch('TIME_UP');
      }
    });

    this.scores.events.on('scoreChanged', () => this.emitState());
  }

  // =========================================================================
  // HOST
  // =========================================================================

  /**
   * Create a hunt: generate the world, place nothing yet, and start advertising.
   * The treasure is placed at match start so late joiners cannot change it.
   */
  async createGame(config: Partial<GameConfig>, profile: LocalProfile): Promise<{
    gameCode: string;
    worldSeed: number;
  }> {
    this.role = 'HOST';
    this.profile = profile;
    this.config = {...DEFAULT_GAME_CONFIG, ...config};
    this.mode = createGameMode(this.config.mode);
    this.matchId = newGameId();

    // World seed is public: players rebuild terrain and items from it.
    this.worldSeed = generateSeed();
    this.world = generateWorld(this.worldSeed, this.config);

    // Treasure seed is private and generated independently.
    this.treasures = new TreasureManager();

    this.gameCode = this.lobby.openLobby();

    this.hostId = playerIdFromIndex(this.nextPlayerIndex++);
    this.localPlayerId = this.hostId;
    this.players.clear();
    this.scores.reset();
    this.players.add({
      id: this.hostId,
      name: profile.name,
      avatar: profile.avatar,
      isHost: true,
      spawnPoint: this.world.spawnPoint,
    });
    this.scores.register(this.hostId);

    await this.teardownBle();
    this.ble = new BleManager({
      role: BleRole.Peripheral,
      localId: this.hostId,
      ...(this.transportFactory ? {transportFactory: this.transportFactory} : {}),
    });
    this.registerHostHandlers();
    this.wireBleEvents();

    const adapterState = await this.ble.initialize();
    this.events.emit('adapterStateChanged', adapterState);
    await this.ble.startAdvertising(this.gameCode);

    this.setPhase(GamePhase.Lobby);
    this.events.emit('worldReady', this.world);
    log.info(`hosting ${this.gameCode}, world seed ${this.worldSeed}`);

    return {gameCode: this.gameCode, worldSeed: this.worldSeed};
  }

  /**
   * Start a single-device practice hunt.
   *
   * This is NOT a simulated multiplayer session and it does NOT fake Bluetooth:
   * no transport is created at all, so every `this.ble?.` call below is simply
   * a no-op. The full game engine -- world generation, treasure placement,
   * movement, collision, items, power-ups, scoring, proximity -- runs exactly
   * as it does when hosting, minus the network layer.
   *
   * It exists for two honest reasons: practice, and the fact that the Android
   * emulator has no BLE radio, so multiplayer can only be exercised on real
   * hardware (see docs/BLE-CAPABILITY-MATRIX.md).
   */
  async startSoloGame(
    config: Partial<GameConfig>,
    profile: LocalProfile,
  ): Promise<void> {
    this.role = 'HOST';
    this.profile = profile;
    this.config = {...DEFAULT_GAME_CONFIG, ...config};
    this.mode = createGameMode(this.config.mode);
    this.matchId = newGameId();
    await this.teardownBle();

    this.worldSeed = generateSeed();
    this.world = generateWorld(this.worldSeed, this.config);
    this.treasures = new TreasureManager();

    this.gameCode = 'SOLO';
    this.hostId = playerIdFromIndex(0);
    this.localPlayerId = this.hostId;
    this.nextPlayerIndex = 1;

    this.players.clear();
    this.scores.reset();
    this.players.add({
      id: this.hostId,
      name: profile.name,
      avatar: profile.avatar,
      isHost: true,
      spawnPoint: this.world.spawnPoint,
    });
    this.scores.register(this.hostId);

    this.setPhase(GamePhase.Lobby);
    this.events.emit('worldReady', this.world);

    // Straight into the hunt; there is nobody to wait for.
    this.treasures.placeInitial(this.world, this.config, [this.hostId]);
    this.players.setStatus(this.hostId, PlayerStatus.Hunting);
    this.setPhase(GamePhase.Countdown);
    this.timer.startCountdown(TIMING.countdownSec, () => this.beginPlaying());

    log.info(`solo hunt started, world seed ${this.worldSeed}`);
  }

  /** Host: begin the hunt. */
  async startMatch(): Promise<void> {
    if (this.role !== 'HOST' || !this.world) {
      throw new Error('only the host can start the match');
    }
    if (this.phase !== GamePhase.Lobby) {
      throw new Error(`cannot start from phase ${this.phase}`);
    }

    /*
     * Close the lobby, but leave the advertiser running.
     *
     * Stopping it here meant a rematch had to start it again, and restarting
     * the advertiser makes the native peripheral re-register its GATT server.
     * The connected player sees onServiceChanged, its cached handles go stale,
     * and every write on that link fails from then on -- which is why
     * LOBBY_STATE could never reach it after Play Again ("never acknowledged
     * after 5 attempts", forever). One continuous advertisement costs a little
     * airtime and keeps the link intact.
     *
     * The lobby itself is closed, so a late joiner is still rejected.
     */
    this.lobby.closeLobby();

    const roster = this.players.list();

    if (this.mode.usesTeams && this.mode.assignTeams) {
      this.teams = this.mode.assignTeams(roster, this.config.teamCount);
      for (const team of this.teams) {
        for (const memberId of team.memberIds) {
          this.players.setTeam(memberId, team.id);
        }
      }
    } else {
      this.teams = [];
    }

    this.treasures.placeInitial(
      this.world,
      this.config,
      roster.map(player => player.id),
    );

    log.info(
      `[GAME] creating new match -- clearing match state, spawn ` +
        `(${this.world.spawnPoint.x}, ${this.world.spawnPoint.y})`,
    );
    this.players.resetForNewMatch(this.world.spawnPoint);
    for (const player of roster) {
      this.players.setStatus(player.id, PlayerStatus.Hunting);
    }
    for (const player of this.players.list()) {
      log.info(
        `[HOST NEW MATCH] seed=${this.worldSeed} player=${player.id}` +
          ` (${player.name}) spawn=` +
          `(${player.position.x.toFixed(2)},${player.position.y.toFixed(2)})`,
      );
    }

    this.matchEpoch += 1;
    log.info(`[GAME] match epoch -> ${this.matchEpoch}`);

    const startsAt = Date.now() + TIMING.countdownSec * 1000;
    const payload: GameStartPayload = {
      matchEpoch: this.matchEpoch,
      countdownSec: TIMING.countdownSec,
      startsAt,
      durationSec: this.config.durationSec,
      worldSeed: this.worldSeed,
      spawnPoint: this.world.spawnPoint,
      config: this.config,
      ...(this.teams.length > 0
        ? {
            teams: this.teams.map(team => ({
              id: team.id,
              name: team.name,
              color: team.color,
              memberIds: [...team.memberIds],
            })),
          }
        : {}),
    };
    const recipients = this.ble?.peers.list().map(peer => peer.peerId) ?? [];
    log.info(
      `broadcasting GAME_START (seed ${this.worldSeed}) to ${recipients.length} peer(s)` +
        (recipients.length > 0 ? `: ${recipients.join(', ')}` : ''),
    );
    this.ble?.broadcast(MessageType.GameStart, payload);

    this.setPhase(GamePhase.Countdown);
    this.timer.startCountdown(TIMING.countdownSec, () => this.beginPlaying());
  }

  private beginPlaying(): void {
    this.startedAt = Date.now();
    this.setPhase(GamePhase.Playing);
    if (this.role === 'HOST') {
      this.timer.start(this.config.durationSec);
    }
    this.startSimulation();
    log.info('hunt underway');
  }

  private registerHostHandlers(): void {
    const ble = this.ble;
    if (!ble) {
      return;
    }

    // -- a player asks to join ---------------------------------------------
    this.unsubscribers.push(
      ble.on<GameJoinPayload>(MessageType.GameJoin, (payload, envelope, context) => {
        this.handleJoinRequest(payload, envelope.senderId, context.peerId);
      }),
    );

    // -- a player reports movement -----------------------------------------
    this.unsubscribers.push(
      ble.on<PlayerMovePayload>(MessageType.PlayerMove, (payload, envelope, context) => {
        const playerId = context.playerId ?? envelope.senderId;
        if (!this.world || this.phase !== GamePhase.Playing) {
          return;
        }
        /*
         * Drop movement that belongs to an earlier match.
         *
         * A BLE write issued near the end of a hunt can land well after the
         * next one has started. Its seq is higher than anything we have seen,
         * so neither the reliable layer's stale check nor the per-player
         * high-water mark rejects it, and it walked the player straight off
         * their fresh spawn back towards where the last match ended.
         */
        if ((payload.matchEpoch ?? this.matchEpoch) !== this.matchEpoch) {
          log.info(
            `[GAME] dropping PLAYER_MOVE from ${playerId}: epoch ` +
              `${payload.matchEpoch} != current ${this.matchEpoch}`,
          );
          return;
        }
        const accepted = this.players.applyRemoteMovement(
          playerId,
          payload.position,
          envelope.seq,
          this.world,
          this.config,
        );
        if (!accepted) {
          return;
        }
        // Authority checks run on the accepted position, never the claimed one.
        this.hostEvaluatePlayer(playerId, accepted);
      }),
    );

    // -- a player performs an action ---------------------------------------
    this.unsubscribers.push(
      ble.on<PlayerActionPayload>(MessageType.PlayerAction, (payload, envelope, context) => {
        const playerId = context.playerId ?? envelope.senderId;
        this.handlePlayerAction(playerId, payload);
      }),
    );
  }

  private handleJoinRequest(
    request: GameJoinPayload,
    senderId: string,
    peerId: string,
  ): void {
    const ble = this.ble;
    if (!ble || !this.world) {
      return;
    }

    // Is this someone reclaiming a slot after a drop?
    const existing = this.players.list().find(
      player => !player.isHost && player.name === request.name,
    );
    const isRejoin = Boolean(
      existing && existing.connection !== PlayerConnectionState.Connected,
    );

    const decision = this.lobby.evaluateJoin(
      request,
      this.players.count,
      this.config,
      this.phase,
      peerId,
      isRejoin,
    );

    if (!decision.accepted) {
      ble.send<GameJoinRejectedPayload>(
        peerId,
        MessageType.GameJoinRejected,
        decision.rejection,
      );
      return;
    }

    const playerId =
      isRejoin && existing ? existing.id : playerIdFromIndex(this.nextPlayerIndex++);

    const player = this.players.add({
      id: playerId,
      name: request.name,
      avatar: request.avatar,
      peerId,
      spawnPoint: this.world.spawnPoint,
    });
    this.scores.register(playerId);
    this.players.setConnection(playerId, PlayerConnectionState.Connected);
    ble.bindPlayer(peerId, playerId);

    const accepted: GameJoinAcceptedPayload = {
      playerId,
      gameId: this.matchId,
      gameCode: this.gameCode,
      hostId: this.hostId,
      hostName: this.profile.name,
      config: this.config,
      worldSeed: this.worldSeed,
      spawnPoint: this.world.spawnPoint,
      players: this.buildPlayerSummaries(),
    };
    ble.send(peerId, MessageType.GameJoinAccepted, accepted);

    // Tell everyone else, and let a mid-match rejoin resync immediately.
    const joined: PlayerJoinedPayload = {
      player: this.summarise(player),
      playerCount: this.players.count,
    };
    ble.broadcast(MessageType.PlayerJoined, joined, peerId);

    if (this.phase === GamePhase.Playing) {
      this.sendStateTo(peerId);
    }

    this.notify('info', `${player.name} joined the hunt`);
    this.emitState();
  }

  private summarise(player: Player): PlayerSummary {
    return {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      ...(player.teamId ? {teamId: player.teamId} : {}),
      isHost: player.isHost,
      score: this.scores.scoreFor(player.id),
      status: player.status,
      connection: player.connection,
    };
  }

  private buildPlayerSummaries(): PlayerSummary[] {
    return this.players.list().map(player => this.summarise(player));
  }

  /**
   * Host authority: given a player's accepted position, resolve everything that
   * position implies. Runs for remote players on PLAYER_MOVE and for the host's
   * own player every simulation tick.
   */
  private hostEvaluatePlayer(playerId: string, position: Position): void {
    if (this.role !== 'HOST' || !this.world || this.phase !== GamePhase.Playing) {
      return;
    }
    const player = this.players.get(playerId);
    if (!player || player.status !== PlayerStatus.Hunting) {
      return;
    }

    this.collectItemsAt(playerId, position);
    this.checkTreasureAt(playerId, position);
  }

  private collectItemsAt(playerId: string, position: Position): void {
    const world = this.world;
    const ble = this.ble;
    if (!world) {
      return;
    }

    for (const item of world.items) {
      if (item.collectedBy) {
        continue;
      }
      if (distance(position, item.position) > this.config.itemPickupRadius) {
        continue;
      }

      // Claim it on the host before awarding, so two players arriving on the
      // same tick cannot both bank the same coin.
      item.collectedBy = playerId;
      item.collectedAt = Date.now();
      this.players.markItemCollected(playerId, item.id);

      const before = this.scores.scoreFor(playerId);
      const doubled = this.powerUps.isDoublePointsActive(playerId);
      const newScore = this.scores.awardItem(playerId, item.kind, doubled);
      const points = newScore - before;

      if (isPowerUpItem(item.kind)) {
        this.players.addToInventory(playerId, item.kind);
      }

      const payload: ItemCollectedPayload = {
        itemId: item.id,
        itemKind: item.kind,
        playerId,
        points,
        newScore,
      };
      ble?.broadcast(MessageType.ItemCollected, payload);

      this.events.emit('itemCollected', {
        item: {...item},
        playerId,
        points,
        isLocal: playerId === this.localPlayerId,
      });
    }
  }


  private checkTreasureAt(playerId: string, position: Position): void {
    const world = this.world;
    const ble = this.ble;
    if (!world) {
      return;
    }

    const treasure = this.treasures.checkFound(playerId, position, this.config);
    if (!treasure) {
      return;
    }
    if (!this.treasures.markFound(treasure.id, playerId)) {
      return;
    }

    const doubled = this.powerUps.isDoublePointsActive(playerId);
    const remainingSec = Math.floor(this.timer.remainingMs() / 1000);
    const {points, newScore, isFirst} = this.scores.awardTreasure(
      playerId,
      doubled,
      Number.isFinite(remainingSec) ? remainingSec : 0,
    );

    const payload: TreasureFoundPayload = {
      treasureId: treasure.id,
      playerId,
      position: treasure.position,
      points,
      isFirst,
      newScore,
    };
    ble?.broadcast(MessageType.TreasureFound, payload);
    this.applyTreasureFoundLocally(payload);

    const outcome = this.mode.onTreasureFound(playerId, treasure, this.modeContext());

    if (outcome.finishPlayer) {
      this.players.setStatus(playerId, PlayerStatus.Finished);
    }

    if (outcome.respawnTreasure) {
      const respawned = this.treasures.respawn(
        world,
        this.config,
        outcome.respawnOwnerId,
      );
      if (respawned) {
        ble?.broadcast(MessageType.TreasureSpawned, {treasureId: respawned.id});
      }
      // The finder keeps hunting in Timed Hunt.
      this.players.setStatus(playerId, PlayerStatus.Hunting);
    }

    if (outcome.endMatch || this.mode.shouldEndMatch(this.modeContext())) {
      this.endMatch('TREASURE_FOUND');
    }
  }

  private modeContext(): ModeContext {
    return {
      config: this.config,
      world: this.world as GameWorld,
      players: this.players.list(),
      teams: this.teams,
      treasures: this.treasures,
      scores: this.scores,
      remainingMs: this.timer.remainingMs(),
    };
  }

  /**
   * Push each player their private hot/cold reading.
   *
   * Sent individually, and containing only a tier plus a quantised band, so a
   * player never receives another player's reading or the treasure position.
   */
  private pushProximity(): void {
    if (this.role !== 'HOST' || this.phase !== GamePhase.Playing) {
      return;
    }

    for (const player of this.players.list()) {
      if (player.status !== PlayerStatus.Hunting) {
        continue;
      }
      const treasure = this.treasures.treasureForPlayer(player.id);
      if (!treasure) {
        continue;
      }

      const report = buildProximityReport(player.position, treasure.position, {
        radarActive: this.powerUps.isRadarActive(player.id),
        hintActive: this.powerUps.isHintActive(player.id),
      });

      // The treasure only shows itself once a player is genuinely on top of it.
      const reveal = shouldRevealTreasure(report.level)
        ? {treasureId: treasure.id, position: treasure.position}
        : undefined;

      if (player.id === this.localPlayerId) {
        this.revealedTreasure = reveal ?? null;
        this.emitProximity(report);
      } else {
        const payload: ProximityUpdatePayload = {
          level: report.level,
          distanceBand: report.distanceBand,
          boosted: report.boosted,
          ...(report.bearingDeg !== undefined ? {bearingDeg: report.bearingDeg} : {}),
          ...(reveal ? {revealedTreasure: reveal} : {}),
        };
        this.ble?.sendToPlayer(player.id, MessageType.ProximityUpdate, payload);
      }
    }
  }

  private emitProximity(report: ProximityReport): void {
    this.lastProximityLevel = report.level;
    this.events.emit('proximityChanged', report);
  }

  /** Broadcast the periodic authoritative digest. */
  private broadcastState(): void {
    const ble = this.ble;
    if (!ble || this.role !== 'HOST') {
      return;
    }
    ble.broadcast(MessageType.GameState, this.buildStatePayload());
  }

  private sendStateTo(peerId: string): void {
    this.ble?.send(peerId, MessageType.GameState, this.buildStatePayload());
  }

  private buildStatePayload(): GameStatePayload {
    const remaining = this.timer.remainingMs();
    return {
      phase: this.phase,
      remainingMs: Number.isFinite(remaining) ? remaining : 0,
      players: this.players.list().map(player => ({
        id: player.id,
        // Position is withheld entirely when the host disabled player visibility.
        ...(this.config.showOtherPlayers ? {position: player.position} : {}),
        score: this.scores.scoreFor(player.id),
        status: player.status,
        connection: player.connection,
      })),
      collectedItemIds: (this.world?.items ?? [])
        .filter(item => item.collectedBy)
        .map(item => item.id),
    };
  }

  /** Host: end the match, reveal the treasure, and publish final standings. */
  private endMatch(reason: GameEndPayload['reason']): void {
    if (this.role !== 'HOST' || this.phase === GamePhase.Finished) {
      return;
    }

    log.info(`[GAME] ending match (${reason})`);
    this.timer.stop();
    this.stopSimulation();

    const outcome = this.mode.resolveWinner(this.modeContext());
    this.winnerId = outcome.winnerId;
    this.winningTeamId = outcome.winningTeamId;
    this.finishedAt = Date.now();

    const roster = this.players.list();
    const payload: GameEndPayload = {
      winnerId: this.winnerId,
      winningTeamId: this.winningTeamId,
      reason,
      // Only now is the treasure position disclosed.
      treasurePositions: this.treasures.revealAll(),
      standings: this.scores.buildLeaderboard(roster).map(row => ({
        playerId: row.playerId,
        name: row.name,
        score: row.score,
        foundTreasure: row.foundTreasure,
      })),
    };

    this.ble?.broadcast(MessageType.GameEnd, payload);
    this.applyGameEndLocally(payload);
  }

  /** Host: stop the hunt early. */
  endMatchEarly(): void {
    this.endMatch('HOST_ENDED');
  }

  // =========================================================================
  // PLAYER
  // =========================================================================

  /** Bring up the radio in player mode and start looking for hosts. */
  async startDiscovery(profile: LocalProfile): Promise<void> {
    this.role = 'PLAYER';
    this.profile = profile;

    if (this.ble && this.ble.role !== BleRole.Central) {
      await this.teardownBle();
    }

    if (!this.ble) {
      // localId is provisional until the host assigns a real playerId.
      this.ble = new BleManager({
        role: BleRole.Central,
        localId: 'PENDING',
        ...(this.transportFactory ? {transportFactory: this.transportFactory} : {}),
      });
      this.registerPlayerHandlers();
      this.wireBleEvents();
      const adapterState = await this.ble.initialize();
      this.events.emit('adapterStateChanged', adapterState);
    }

    await this.ble.startScan();
  }

  async stopDiscovery(): Promise<void> {
    await this.ble?.stopScan();
  }

  getDiscoveredHosts(): DiscoveredHost[] {
    return this.ble?.getDiscoveredHosts() ?? [];
  }

  /**
   * Connect to a host and request a slot.
   * Resolves once the host accepts; rejects on refusal or timeout.
   */
  async joinGame(host: DiscoveredHost, profile: LocalProfile): Promise<void> {
    const ble = this.ble;
    if (!ble) {
      throw new Error('call startDiscovery() before joining');
    }

    this.profile = profile;
    this.gameCode = host.gameCode;

    await ble.connectToHost(host.deviceId);

    const request: GameJoinPayload = {
      name: profile.name,
      avatar: profile.avatar,
      gameCode: host.gameCode,
      protocolVersion: PROTOCOL_VERSION,
    };

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('The host did not answer the join request.'));
      }, 15000);

      const offAccepted = ble.on<GameJoinAcceptedPayload>(
        MessageType.GameJoinAccepted,
        () => {
          cleanup();
          resolve();
        },
      );

      const offRejected = ble.on<GameJoinRejectedPayload>(
        MessageType.GameJoinRejected,
        payload => {
          cleanup();
          reject(new Error(payload.message));
        },
      );

      const cleanup = () => {
        clearTimeout(timeout);
        offAccepted();
        offRejected();
      };

      const peerId = ble.hostPeerId;
      if (!peerId) {
        cleanup();
        reject(new Error('Lost the host connection before joining.'));
        return;
      }
      ble.send(peerId, MessageType.GameJoin, request);
    });
  }

  private registerPlayerHandlers(): void {
    const ble = this.ble;
    if (!ble) {
      return;
    }

    this.unsubscribers.push(
      ble.on<GameJoinAcceptedPayload>(MessageType.GameJoinAccepted, payload => {
        this.applyJoinAccepted(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<GameJoinRejectedPayload>(MessageType.GameJoinRejected, payload => {
        this.notify('error', payload.message);
      }),
    );

    this.unsubscribers.push(
      ble.on<PlayerJoinedPayload>(MessageType.PlayerJoined, payload => {
        if (!this.world || payload.player.id === this.localPlayerId) {
          return;
        }
        this.players.add({
          id: payload.player.id,
          name: payload.player.name,
          avatar: payload.player.avatar,
          isHost: payload.player.isHost,
          spawnPoint: this.world.spawnPoint,
          ...(payload.player.teamId ? {teamId: payload.player.teamId} : {}),
        });
        this.scores.register(payload.player.id);
        this.notify('info', `${payload.player.name} joined`);
      }),
    );

    this.unsubscribers.push(
      ble.on<PlayerLeftPayload>(MessageType.PlayerLeft, payload => {
        const player = this.players.get(payload.playerId);
        this.players.remove(payload.playerId, 'left the hunt');
        if (player) {
          this.notify('info', `${player.name} left`);
        }
      }),
    );

    this.unsubscribers.push(
      ble.on<LobbyStatePayload>(MessageType.LobbyState, payload => {
        this.applyLobbyState(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<GameStartPayload>(MessageType.GameStart, payload => {
        this.applyGameStart(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<GameStatePayload>(MessageType.GameState, payload => {
        this.applyGameState(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<ProximityUpdatePayload>(MessageType.ProximityUpdate, payload => {
        this.revealedTreasure = payload.revealedTreasure ?? null;
        this.emitProximity({
          level: payload.level,
          distanceBand: payload.distanceBand,
          boosted: payload.boosted,
          ...(payload.bearingDeg !== undefined ? {bearingDeg: payload.bearingDeg} : {}),
        });
      }),
    );

    this.unsubscribers.push(
      ble.on<ItemCollectedPayload>(MessageType.ItemCollected, payload => {
        this.applyItemCollected(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<PowerUpUsedPayload>(MessageType.PowerUpUsed, payload => {
        this.powerUps.applyRemoteActivation(payload.playerId, payload.kind, payload.expiresAt);
        this.events.emit('powerUpActivated', {
          playerId: payload.playerId,
          kind: payload.kind,
          expiresAt: payload.expiresAt,
          isLocal: payload.playerId === this.localPlayerId,
        });
      }),
    );

    this.unsubscribers.push(
      ble.on<TreasureFoundPayload>(MessageType.TreasureFound, payload => {
        this.applyTreasureFoundLocally(payload);
      }),
    );

    this.unsubscribers.push(
      ble.on<ScoreUpdatePayload>(MessageType.ScoreUpdate, payload => {
        this.scores.applySnapshot(payload.scores);
        this.emitState();
      }),
    );

    this.unsubscribers.push(
      ble.on<GameEndPayload>(MessageType.GameEnd, payload => {
        this.applyGameEndLocally(payload);
      }),
    );
  }

  private applyJoinAccepted(payload: GameJoinAcceptedPayload): void {
    this.localPlayerId = payload.playerId;
    // The BleManager was built before we had an identity; adopt the one the
    // host assigned so every outgoing envelope carries the real senderId
    // rather than the provisional placeholder.
    this.ble?.setLocalId(payload.playerId);
    this.hostId = payload.hostId;
    this.matchId = payload.gameId;
    this.gameCode = payload.gameCode;
    this.config = payload.config;
    this.mode = createGameMode(payload.config.mode);
    this.worldSeed = payload.worldSeed;

    // Rebuild the identical world locally from the seed. Only the seed crossed
    // the air; terrain and items are regenerated, not transmitted.
    this.world = generateWorld(payload.worldSeed, payload.config);

    this.players.clear();
    this.scores.reset();

    for (const summary of payload.players) {
      this.players.add({
        id: summary.id,
        name: summary.name,
        avatar: summary.avatar,
        isHost: summary.isHost,
        spawnPoint: payload.spawnPoint,
        ...(summary.teamId ? {teamId: summary.teamId} : {}),
      });
      this.scores.register(summary.id);
    }

    if (!this.players.has(payload.playerId)) {
      this.players.add({
        id: payload.playerId,
        name: this.profile.name,
        avatar: this.profile.avatar,
        spawnPoint: payload.spawnPoint,
      });
      this.scores.register(payload.playerId);
    }

    this.setPhase(GamePhase.Lobby);
    this.events.emit('worldReady', this.world);
    log.info(`joined ${payload.gameCode} as ${payload.playerId}`);
  }

  /**
   * Player: the host reset the hunt and reopened the lobby.
   *
   * The world is deliberately left alone -- a rematch draws a fresh seed, and
   * that seed arrives with GAME_START. All this does is put the engine back
   * into a state where the next GAME_START is meaningful.
   */
  private applyLobbyState(payload: LobbyStatePayload): void {
    if (this.role === 'HOST') {
      return;
    }

    log.info(
      `received LOBBY_STATE (${payload.players.length} player(s)) while in ${this.phase}`,
    );

    this.resetMatchState();
    this.timer.stop();
    this.stopSimulation();

    this.gameCode = payload.gameCode;
    this.config = payload.config;
    this.mode = createGameMode(payload.config.mode);

    // Adopt the host's roster wholesale; it is authoritative, and players who
    // dropped between matches must not linger on our side.
    const known = new Set(payload.players.map(summary => summary.id));
    for (const player of this.players.list()) {
      if (!known.has(player.id)) {
        this.players.remove(player.id, 'not in the new lobby');
      }
    }

    for (const summary of payload.players) {
      if (!this.players.has(summary.id)) {
        this.players.add({
          id: summary.id,
          name: summary.name,
          avatar: summary.avatar,
          isHost: summary.isHost,
          // Placeholder only: GAME_START carries the real spawn for the new
          // world and resets every position from it.
          spawnPoint: this.world?.spawnPoint ?? {x: 0, y: 0},
          ...(summary.teamId ? {teamId: summary.teamId} : {}),
        });
      }
      this.players.setStatus(summary.id, PlayerStatus.InLobby);
      this.scores.register(summary.id);
    }

    /*
     * Drop the finished match before sitting in the lobby.
     *
     * Returning to the lobby used to leave every player -- including
     * ourselves -- standing wherever the last hunt ended, still holding its
     * inventory and power-ups. Nothing cleared that until the next
     * GAME_START, so the previous match's position was the engine's idea of
     * where we were for the whole lobby.
     *
     * The spawn used here is only a placeholder: the next match draws a new
     * world, and its authoritative spawn arrives with GAME_START.
     */
    log.info('[GAME] clearing match state on return to lobby');
    this.players.resetForNewMatch(this.world?.spawnPoint ?? {x: 0, y: 0});

    this.setPhase(GamePhase.Lobby);
  }

  private applyGameStart(payload: GameStartPayload): void {
    log.info(
      `received GAME_START (seed ${payload.worldSeed}, ` +
        `countdown ${payload.countdownSec}s) while in ${this.phase}`,
    );
    this.config = payload.config;
    this.mode = createGameMode(payload.config.mode);
    this.worldSeed = payload.worldSeed;
    this.matchEpoch = payload.matchEpoch;
    this.world = generateWorld(payload.worldSeed, payload.config);

    if (payload.teams) {
      this.teams = payload.teams.map(team => ({...team, memberIds: [...team.memberIds], score: 0}));
      for (const team of this.teams) {
        for (const memberId of team.memberIds) {
          this.players.setTeam(memberId, team.id);
        }
      }
    }

    // The host is authoritative for where everyone starts: take the spawn off
    // the wire, never compute one locally.
    log.info(
      `[PLAYER] received authoritative spawn ` +
        `(${payload.spawnPoint.x}, ${payload.spawnPoint.y})`,
    );
    this.players.resetForNewMatch(payload.spawnPoint);
    for (const player of this.players.list()) {
      this.players.setStatus(player.id, PlayerStatus.Hunting);
    }
    const mine = this.players.get(this.localPlayerId);
    log.info(
      `[HUNTER RECEIVED NEW MATCH] seed=${payload.worldSeed}` +
        ` authoritativeSpawn=(${payload.spawnPoint.x.toFixed(2)},${payload.spawnPoint.y.toFixed(2)})` +
        ` localAfterReset=` +
        `(${mine?.position.x.toFixed(2)},${mine?.position.y.toFixed(2)})`,
    );


    // Derive the countdown from local elapsed time rather than trusting
    // startsAt against our own clock, which may be minutes off.
    this.setPhase(GamePhase.Countdown);
    this.events.emit('worldReady', this.world);
    this.timer.startCountdown(payload.countdownSec, () => this.beginPlaying());
  }

  private applyGameState(payload: GameStatePayload): void {
    this.timer.followRemote(payload.remainingMs);

    for (const remote of payload.players) {
      if (remote.id === this.localPlayerId) {
        // Never let the digest snap the local player around; local simulation
        // owns our own position and the host corrects it via movement replies.
        this.scores.applySnapshot([{playerId: remote.id, score: remote.score}]);
        this.players.setStatus(remote.id, remote.status);
        continue;
      }
      if (!this.players.has(remote.id)) {
        continue;
      }
      if (remote.position) {
        this.players.setPosition(remote.id, remote.position);
      }
      this.scores.applySnapshot([{playerId: remote.id, score: remote.score}]);
      this.players.setStatus(remote.id, remote.status);
      this.players.setConnection(remote.id, remote.connection);
    }

    // Resync items the host says are gone -- covers anything we missed while
    // disconnected.
    if (this.world && payload.collectedItemIds.length > 0) {
      const collected = new Set(payload.collectedItemIds);
      for (const item of this.world.items) {
        if (!item.collectedBy && collected.has(item.id)) {
          item.collectedBy = 'unknown';
        }
      }
    }

    if (payload.phase !== this.phase && payload.phase === GamePhase.Playing) {
      this.setPhase(GamePhase.Playing);
      this.startSimulation();
    }

    this.emitState();
  }

  private applyItemCollected(payload: ItemCollectedPayload): void {
    const item = this.world?.items.find(candidate => candidate.id === payload.itemId);
    if (item && !item.collectedBy) {
      item.collectedBy = payload.playerId;
      item.collectedAt = Date.now();
    }

    this.scores.applySnapshot([{playerId: payload.playerId, score: payload.newScore}]);
    this.players.markItemCollected(payload.playerId, payload.itemId);

    if (payload.playerId === this.localPlayerId && isPowerUpItem(payload.itemKind)) {
      this.players.addToInventory(payload.playerId, payload.itemKind);
    }

    if (item) {
      this.events.emit('itemCollected', {
        item: {...item},
        playerId: payload.playerId,
        points: payload.points,
        isLocal: payload.playerId === this.localPlayerId,
      });
    }
    this.emitState();
  }

  private applyTreasureFoundLocally(payload: TreasureFoundPayload): void {
    this.scores.applySnapshot([{playerId: payload.playerId, score: payload.newScore}]);
    this.scores.noteTreasureFinder(payload.playerId, payload.isFirst);

    // Now that it is found, everyone may see where it was.
    if (this.world && !this.world.treasures.some(t => t.id === payload.treasureId)) {
      this.world.treasures.push({
        id: payload.treasureId,
        position: payload.position,
        foundBy: payload.playerId,
        foundAt: Date.now(),
      });
    }

    const finder = this.players.get(payload.playerId);
    if (finder) {
      this.notify(
        'info',
        payload.playerId === this.localPlayerId
          ? `You found the treasure! +${payload.points}`
          : `${finder.name} found the treasure!`,
      );
    }

    this.events.emit('treasureFound', payload);
    this.emitState();
  }

  private applyGameEndLocally(payload: GameEndPayload): void {
    this.timer.stop();
    this.stopSimulation();

    this.winnerId = payload.winnerId;
    this.winningTeamId = payload.winningTeamId;
    this.finishedAt = Date.now();

    // Reveal every treasure so the map can show where they were hiding.
    if (this.world) {
      for (const {treasureId, position} of payload.treasurePositions) {
        const existing = this.world.treasures.find(t => t.id === treasureId);
        if (existing) {
          existing.position = position;
        } else {
          this.world.treasures.push({id: treasureId, position});
        }
      }
    }

    this.scores.applySnapshot(
      payload.standings.map(row => ({playerId: row.playerId, score: row.score})),
    );

    this.setPhase(GamePhase.Finished);

    const winner = payload.winnerId ? this.players.get(payload.winnerId) : undefined;
    const result: MatchResult = {
      gameId: this.matchId,
      mode: this.config.mode,
      playedAt: this.startedAt ?? Date.now(),
      durationSec: this.startedAt
        ? Math.round((Date.now() - this.startedAt) / 1000)
        : 0,
      standings: payload.standings.map(row => {
        const player = this.players.get(row.playerId);
        return {
          playerId: row.playerId,
          name: row.name,
          avatar: player?.avatar ?? '🦊',
          score: row.score,
          foundTreasure: row.foundTreasure,
        };
      }),
      winnerName: winner?.name ?? null,
    };

    this.events.emit('matchEnded', result);
  }

  // =========================================================================
  // Local input and simulation
  // =========================================================================

  /**
   * Set the current movement vector from the D-pad or joystick.
   * Components are expected in [-1, 1]; magnitude is clamped during simulation.
   */
  setMoveDirection(direction: Position): void {
    this.moveDirection = direction;
  }

  stopMoving(): void {
    this.moveDirection = {x: 0, y: 0};
  }

  /** Activate a power-up the local player is holding. */
  usePowerUp(kind: ItemKind): boolean {
    if (!this.localPlayerId) {
      return false;
    }

    if (this.role === 'HOST') {
      const activation = this.powerUps.activate(this.localPlayerId, kind);
      if (!activation) {
        return false;
      }
      const payload: PowerUpUsedPayload = {
        playerId: activation.playerId,
        kind: activation.kind,
        durationMs: activation.durationMs,
        expiresAt: activation.expiresAt,
      };
      this.ble?.broadcast(MessageType.PowerUpUsed, payload);
      this.events.emit('powerUpActivated', {...payload, isLocal: true});
      // A fresh Radar or Hint should show up immediately.
      this.pushProximity();
      return true;
    }

    // Player: ask the host. The bag is only debited when the host confirms.
    const spec = POWERUP_SPECS[kind];
    if (!spec) {
      return false;
    }
    const peerId = this.ble?.hostPeerId;
    if (!peerId) {
      return false;
    }
    const action: PlayerActionPayload = {
      action: PlayerActionKind.ActivatePowerUp,
      itemKind: kind,
    };
    this.ble?.send(peerId, MessageType.PlayerAction, action);
    return true;
  }

  /** Attempt to tag a nearby rival. */
  tagPlayer(targetId: string): boolean {
    if (!this.localPlayerId) {
      return false;
    }
    if (this.role === 'HOST') {
      return this.resolveTag(this.localPlayerId, targetId);
    }
    const peerId = this.ble?.hostPeerId;
    if (!peerId) {
      return false;
    }
    this.ble?.send(peerId, MessageType.PlayerAction, {
      action: PlayerActionKind.Tag,
      targetPlayerId: targetId,
    } satisfies PlayerActionPayload);
    return true;
  }

  /** Host: resolve an action requested by any player, including itself. */
  private handlePlayerAction(playerId: string, action: PlayerActionPayload): void {
    if (this.role !== 'HOST') {
      return;
    }

    switch (action.action) {
      case PlayerActionKind.ActivatePowerUp: {
        if (!action.itemKind) {
          return;
        }
        const activation = this.powerUps.activate(playerId, action.itemKind);
        if (!activation) {
          return;
        }
        const payload: PowerUpUsedPayload = {
          playerId: activation.playerId,
          kind: activation.kind,
          durationMs: activation.durationMs,
          expiresAt: activation.expiresAt,
        };
        this.ble?.broadcast(MessageType.PowerUpUsed, payload);
        this.events.emit('powerUpActivated', {
          ...payload,
          isLocal: playerId === this.localPlayerId,
        });
        this.pushProximity();
        break;
      }

      case PlayerActionKind.Tag: {
        if (action.targetPlayerId) {
          this.resolveTag(playerId, action.targetPlayerId);
        }
        break;
      }

      case PlayerActionKind.Dig:
        // Reserved for a future mode; ignored rather than treated as an error.
        break;
    }
  }

  /** Host authority for player-vs-player tagging. */
  private resolveTag(taggerId: string, targetId: string): boolean {
    if (this.role !== 'HOST') {
      return false;
    }
    if (!this.players.canTag(taggerId)) {
      return false;
    }

    const nearby = this.players.playersNear(taggerId);
    if (!nearby.some(player => player.id === targetId)) {
      return false;
    }

    this.players.recordTag(taggerId);

    // A shield absorbs the tag entirely.
    if (this.powerUps.isShieldActive(targetId)) {
      this.notify('info', 'A shield blocked that tag!');
      return false;
    }

    this.scores.applyTagPenalty(targetId);
    this.ble?.broadcast(MessageType.ScoreUpdate, {
      scores: this.scores.snapshot(),
    } satisfies ScoreUpdatePayload);

    const target = this.players.get(targetId);
    if (target) {
      this.notify('info', `${target.name} was tagged!`);
    }
    return true;
  }

  private startSimulation(): void {
    if (this.simulation?.isRunning) {
      return;
    }
    this.simulation = new TickLoop(TIMING.simulationHz, delta => this.tick(delta));
    this.simulation.start();
  }

  private stopSimulation(): void {
    this.simulation?.stop();
    this.simulation = null;
    this.moveDirection = {x: 0, y: 0};
  }

  /**
   * One simulation step.
   *
   * Runs on every device for its own player (local prediction), and does the
   * extra authority work on the host.
   */
  private tick(deltaSec: number): void {
    if (this.phase !== GamePhase.Playing || !this.world) {
      return;
    }

    const now = Date.now();
    const local = this.players.get(this.localPlayerId);

    // -- local movement ----------------------------------------------------
    if (local && local.status === PlayerStatus.Hunting) {
      const moved = this.players.applyLocalMovement(
        this.localPlayerId,
        this.moveDirection,
        deltaSec,
        this.world,
        this.config,
      );

      if (moved) {
        if (this.role === 'HOST') {
          // The host is its own authority -- resolve immediately.
          this.hostEvaluatePlayer(this.localPlayerId, moved);
        } else {
          this.maybeSendMovement(moved, now);
        }
      }
    }

    // -- publish positions to the UI ---------------------------------------
    // Movement mutates player state in place for speed, so nothing else would
    // tell React that the map changed. Republish the roster on a fixed, slower
    // cadence than the simulation.
    if (now - this.lastRenderPushAt >= 1000 / TIMING.renderHz) {
      this.lastRenderPushAt = now;
      this.events.emit('rosterChanged', this.players.list());
    }

    // -- host-only periodic work -------------------------------------------
    if (this.role === 'HOST') {
      this.powerUps.tick(now);

      if (now - this.lastProximityPushAt >= 1000 / TIMING.proximityHz) {
        this.lastProximityPushAt = now;
        this.pushProximity();
      }

      if (now - this.lastStateBroadcastAt >= 1000 / TIMING.stateBroadcastHz) {
        this.lastStateBroadcastAt = now;
        this.broadcastState();
        this.reapStalePlayers(now);
      }

      if (this.mode.shouldEndMatch(this.modeContext())) {
        this.endMatch('TIME_UP');
      }
    } else {
      this.powerUps.tick(now);
    }
  }

  /**
   * Report movement to the host, rate-limited and change-gated.
   *
   * This is the single biggest source of BLE traffic, so it is throttled to
   * TIMING.movementSendHz and skipped entirely when the player barely moved.
   * Movement is fire-and-forget: a lost packet is superseded 100 ms later,
   * and retrying it would only add latency.
   */
  private maybeSendMovement(position: Position, now: number): void {
    const minInterval = 1000 / TIMING.movementSendHz;
    if (now - this.lastMoveSentAt < minInterval) {
      return;
    }
    if (
      this.lastSentPosition &&
      distance(this.lastSentPosition, position) < TIMING.movementEpsilon
    ) {
      return;
    }

    const peerId = this.ble?.hostPeerId;
    if (!peerId) {
      return;
    }

    this.lastMoveSentAt = now;
    this.lastSentPosition = {...position};

    const payload: PlayerMovePayload = {
      // Two decimals is well below what a player can perceive and keeps the
      // JSON short enough to fit a single BLE packet in most cases.
      position: {
        x: Math.round(position.x * 100) / 100,
        y: Math.round(position.y * 100) / 100,
      },
      matchEpoch: this.matchEpoch,
    };
    this.ble?.send(peerId, MessageType.PlayerMove, payload);
  }

  /** Host: mark players we have not heard from, and evict after the grace window. */
  private reapStalePlayers(now: number): void {
    for (const player of this.players.findStale(TIMING.peerTimeoutMs, now)) {
      this.players.setConnection(player.id, PlayerConnectionState.Reconnecting);
      this.ble?.broadcast(MessageType.PlayerDisconnected, {
        playerId: player.id,
        graceMs: TIMING.reconnectGraceMs,
      });
    }

    const evictBefore = now - TIMING.reconnectGraceMs;
    for (const player of this.players.list()) {
      if (
        !player.isHost &&
        player.connection === PlayerConnectionState.Reconnecting &&
        player.lastSeenAt < evictBefore
      ) {
        this.players.setConnection(player.id, PlayerConnectionState.Disconnected);
        this.players.remove(player.id, 'reconnect grace expired');
        this.scores.unregister(player.id);
        this.ble?.broadcast(MessageType.PlayerLeft, {
          playerId: player.id,
          playerCount: this.players.count,
        } satisfies PlayerLeftPayload);
        this.notify('warn', `${player.name} dropped out`);
      }
    }
  }

  // =========================================================================
  // BLE plumbing shared by both roles
  // =========================================================================

  private wireBleEvents(): void {
    const ble = this.ble;
    if (!ble) {
      return;
    }

    ble.events.on('hostsChanged', hosts => this.events.emit('hostsChanged', hosts));

    ble.events.on('adapterState', state => this.events.emit('adapterStateChanged', state));
    ble.events.on('linkState', state => this.events.emit('linkStateChanged', state));

    ble.events.on('error', error => {
      log.error('ble error', error);
      this.events.emit('error', error);
    });

    ble.events.on('peerConnected', (peer: BlePeer) => {
      if (this.role === 'PLAYER') {
        this.events.emit('connectionChanged', {connected: true, reconnecting: false});
      }
      log.debug(`peer ${peer.peerId} connected`);
    });

    ble.events.on('peerDisconnected', ({peerId, playerId, reason}) => {
      if (this.role === 'HOST') {
        const resolved = playerId ?? this.players.findByPeerId(peerId)?.id;
        if (resolved) {
          // Hold the slot: the reconnect grace window starts now.
          this.players.setConnection(resolved, PlayerConnectionState.Reconnecting);
          ble.broadcast(MessageType.PlayerDisconnected, {
            playerId: resolved,
            graceMs: TIMING.reconnectGraceMs,
          });
          const player = this.players.get(resolved);
          if (player) {
            this.notify('warn', `${player.name} lost connection`);
          }
        }
      } else {
        this.events.emit('connectionChanged', {
          connected: false,
          reconnecting: ble.isReconnecting,
        });
        this.notify('warn', `Connection to the host dropped (${reason}).`);
      }
    });

    // Any traffic from a peer -- including heartbeats -- proves the player is
    // still there. Without this a player who stands still stops refreshing
    // lastSeenAt and the host reaps them mid-match.
    ble.events.on('peerActivity', ({peerId, playerId}) => {
      const resolved = playerId ?? this.players.findByPeerId(peerId)?.id;
      if (!resolved) {
        return;
      }
      this.players.touch(resolved);
      const player = this.players.get(resolved);
      if (this.role === 'HOST' && player?.connection === PlayerConnectionState.Reconnecting) {
        this.players.setConnection(resolved, PlayerConnectionState.Connected);
        ble.broadcast(MessageType.PlayerReconnected, {playerId: resolved});
        this.notify('info', `${player.name} reconnected`);
      }
    });

    ble.events.on('deliveryFailed', ({message, attempts}) => {
      log.warn(`${message.type} never acknowledged after ${attempts} attempts`);
    });

    // Player: after a reconnect, re-announce so the host rebinds our slot.
    ble.onReconnected(() => {
      this.events.emit('connectionChanged', {connected: true, reconnecting: false});
      this.notify('info', 'Reconnected to the host.');
      const peerId = ble.hostPeerId;
      if (peerId) {
        ble.send<GameJoinPayload>(peerId, MessageType.GameJoin, {
          name: this.profile.name,
          avatar: this.profile.avatar,
          gameCode: this.gameCode,
          protocolVersion: PROTOCOL_VERSION,
        });
      }
    });
  }

  /** Leave the current hunt but keep the radio up for another one. */
  async leaveGame(): Promise<void> {
    this.stopSimulation();
    this.timer.stop();
    this.timer.stopCountdown();

    if (this.role === 'HOST') {
      this.ble?.broadcast(MessageType.GameEnd, {
        winnerId: this.winnerId,
        winningTeamId: this.winningTeamId,
        reason: 'HOST_ENDED',
        treasurePositions: this.treasures.revealAll(),
        standings: this.scores
          .buildLeaderboard(this.players.list())
          .map(row => ({
            playerId: row.playerId,
            name: row.name,
            score: row.score,
            foundTreasure: row.foundTreasure,
          })),
      } satisfies GameEndPayload);
      await this.ble?.stopAdvertising();
    } else if (this.ble?.hostPeerId) {
      this.ble.send(this.ble.hostPeerId, MessageType.PlayerLeft, {
        playerId: this.localPlayerId,
        playerCount: 0,
      } satisfies PlayerLeftPayload);
      await this.ble.disconnectFromHost();
    }

    this.resetMatchState();
    // Identity and profile survive; the hunt does not. Without this a player
    // who left carried its old position and inventory into the next lobby.
    log.info('[GAME] ending match -- clearing match state on leave');
    this.players.resetForNewMatch(this.world?.spawnPoint ?? {x: 0, y: 0});
    this.setPhase(GamePhase.Idle);
  }

  /** Host: reset for a rematch, keeping the lobby and everyone in it. */
  async playAgain(): Promise<void> {
    if (this.role !== 'HOST') {
      throw new Error('only the host can start a rematch');
    }

    this.resetMatchState();

    this.worldSeed = generateSeed();
    this.world = generateWorld(this.worldSeed, this.config);
    this.treasures = new TreasureManager();
    log.info(
      `[WORLD] rematch world ${this.worldSeed}, new spawn ` +
        `(${this.world.spawnPoint.x}, ${this.world.spawnPoint.y})`,
    );

    for (const player of this.players.list()) {
      this.players.setStatus(player.id, PlayerStatus.InLobby);
      this.scores.register(player.id);
    }
    this.players.resetForNewMatch(this.world.spawnPoint);

    this.lobby.openLobby(this.gameCode);
    this.setPhase(GamePhase.Lobby);
    this.events.emit('worldReady', this.world);

    /*
     * Tell everyone still connected that the hunt was reset, BEFORE the radio
     * is touched.
     *
     * Without the announcement the host alone returned to the lobby: the
     * players' engines stayed FINISHED and their results screen never moved.
     * Announcing it after re-advertising was no better -- restarting the
     * advertiser disturbs the live link, and every delivery attempt failed
     * until the reliable layer gave up ("LOBBY_STATE never acknowledged after
     * 5 attempts"). Queue it while the link is still healthy; retries then
     * ride out the advertising restart.
     */
    this.broadcastLobbyState();

    await this.ble?.startAdvertising(this.gameCode);
  }

  /*
   * Keep offering the lobby for as long as it is open.
   *
   * One broadcast is not enough. The reliable layer retries five times and
   * then gives up for good ("LOBBY_STATE never acknowledged after 5
   * attempts"); if the link happened to be down for those few seconds -- a
   * rematch right after a match ends is exactly when it is busiest -- the
   * player never learns the hunt was reset and sits on the results screen
   * while the host waits in a lobby that lists them as online.
   *
   * LOBBY_STATE is idempotent and latest-wins, so re-offering it is cheap: a
   * newer one supersedes any copy still queued rather than stacking up.
   */
  private startLobbyHeartbeat(): void {
    this.stopLobbyHeartbeat();
    this.lobbyHeartbeat = setInterval(() => {
      if (this.phase !== GamePhase.Lobby || this.role !== 'HOST') {
        this.stopLobbyHeartbeat();
        return;
      }
      // Nothing to tell if nobody is connected.
      if ((this.ble?.peers.list().length ?? 0) === 0) {
        return;
      }
      this.broadcastLobbyState();
    }, LOBBY_HEARTBEAT_MS);
  }

  private stopLobbyHeartbeat(): void {
    if (this.lobbyHeartbeat) {
      clearInterval(this.lobbyHeartbeat);
      this.lobbyHeartbeat = null;
    }
  }

  /** Host: publish the current lobby so players can mirror it. */
  private broadcastLobbyState(): void {
    if (this.role !== 'HOST' || !this.gameCode) {
      return;
    }

    const payload: LobbyStatePayload = {
      gameCode: this.gameCode,
      phase: this.phase,
      config: this.config,
      players: this.buildPlayerSummaries(),
    };
    log.info(
      `[BLE] sending authoritative lobby state ` +
        `(${payload.players.length} player(s))`,
    );
    this.ble?.broadcast(MessageType.LobbyState, payload);
  }

  private resetMatchState(): void {
    this.scores.reset();
    this.treasures.reset();
    this.teams = [];
    this.startedAt = null;
    this.finishedAt = null;
    this.winnerId = null;
    this.winningTeamId = null;
    this.lastProximityLevel = null;
    this.revealedTreasure = null;
    this.lastSentPosition = null;
    this.lastMoveSentAt = 0;
    this.lastStateBroadcastAt = 0;
    this.lastProximityPushAt = 0;
    this.lastRenderPushAt = 0;
    this.moveDirection = {x: 0, y: 0};
  }

  /** The last proximity tier shown, for a UI mounting mid-match. */
  get currentProximityLevel(): ProximityLevel | null {
    return this.lastProximityLevel;
  }

  async dispose(): Promise<void> {
    this.stopLobbyHeartbeat();
    this.disposed = true;
    this.stopSimulation();

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    this.timer.dispose();
    this.powerUps.dispose();
    this.scores.dispose();
    this.players.dispose();
    this.lobby.dispose();

    if (this.ble) {
      await this.ble.shutdown();
      this.ble = null;
    }

    this.events.removeAllListeners();
  }
}
