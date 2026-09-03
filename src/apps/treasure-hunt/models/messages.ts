/**
 * BLE game protocol.
 *
 * Every message travels inside a common envelope so the reliability layer can
 * de-duplicate, order and acknowledge without understanding the payload:
 *
 *   { messageId, type, senderId, timestamp, seq, payload }
 *
 * Envelopes are serialised to JSON, UTF-8 encoded, then handed to the Framer
 * which splits them across as many BLE packets as the negotiated MTU requires.
 */
import type {Position, Size} from './geometry';
import type {ItemKind, Obstacle, WorldItem} from './world';
import type {GameConfig, GameMode, GamePhase, ProximityLevel} from './game';
import type {Avatar, PlayerConnectionState, PlayerStatus} from './player';

export enum MessageType {
  // -- transport / session -------------------------------------------------
  Ack = 'ACK',
  Ping = 'PING',
  Pong = 'PONG',
  Hello = 'HELLO',

  // -- lobby ---------------------------------------------------------------
  GameCreate = 'GAME_CREATE',
  GameJoin = 'GAME_JOIN',
  GameJoinAccepted = 'GAME_JOIN_ACCEPTED',
  GameJoinRejected = 'GAME_JOIN_REJECTED',
  PlayerJoined = 'PLAYER_JOINED',
  PlayerLeft = 'PLAYER_LEFT',
  LobbyState = 'LOBBY_STATE',

  // -- match flow ----------------------------------------------------------
  GameStart = 'GAME_START',
  GameState = 'GAME_STATE',
  GameEnd = 'GAME_END',

  // -- gameplay ------------------------------------------------------------
  PlayerMove = 'PLAYER_MOVE',
  PlayerAction = 'PLAYER_ACTION',
  PlayerSnapshot = 'PLAYER_SNAPSHOT',
  ProximityUpdate = 'PROXIMITY_UPDATE',
  ItemCollected = 'ITEM_COLLECTED',
  PowerUpUsed = 'POWERUP_USED',
  TreasureFound = 'TREASURE_FOUND',
  TreasureSpawned = 'TREASURE_SPAWNED',
  ScoreUpdate = 'SCORE_UPDATE',
  PlayerEliminated = 'PLAYER_ELIMINATED',
  PlayerDisconnected = 'PLAYER_DISCONNECTED',
  PlayerReconnected = 'PLAYER_RECONNECTED',
}

/** Wire protocol version -- bump on any breaking envelope/payload change. */
export const PROTOCOL_VERSION = 1;

export interface Envelope<T = unknown> {
  /** Globally unique per sender; drives duplicate suppression. */
  messageId: string;
  type: MessageType;
  senderId: string;
  /**
   * Sender epoch ms at send time. Clocks are NOT synchronised across devices --
   * treat this as ordering metadata only, never as a shared clock.
   */
  timestamp: number;
  /** Per-sender monotonic counter; drives stale-message rejection. */
  seq: number;
  payload: T;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface AckPayload {
  ackId: string;
}

export interface HelloPayload {
  protocolVersion: number;
  appVersion: string;
}

export interface GameJoinPayload {
  name: string;
  avatar: Avatar;
  gameCode: string;
  protocolVersion: number;
}

export interface PlayerSummary {
  id: string;
  name: string;
  avatar: Avatar;
  teamId?: string;
  isHost: boolean;
  score: number;
  status: PlayerStatus;
  connection: PlayerConnectionState;
}

export interface GameJoinAcceptedPayload {
  playerId: string;
  gameId: string;
  gameCode: string;
  hostId: string;
  hostName: string;
  config: GameConfig;
  /** Seed for terrain, obstacles and items -- NOT for treasure placement. */
  worldSeed: number;
  spawnPoint: Position;
  players: PlayerSummary[];
}

export interface GameJoinRejectedPayload {
  reason: 'GAME_FULL' | 'WRONG_CODE' | 'ALREADY_STARTED' | 'VERSION_MISMATCH';
  message: string;
}

export interface PlayerJoinedPayload {
  player: PlayerSummary;
  playerCount: number;
}

export interface PlayerLeftPayload {
  playerId: string;
  playerCount: number;
}

export interface LobbyStatePayload {
  gameCode: string;
  phase: GamePhase;
  config: GameConfig;
  players: PlayerSummary[];
}

export interface GameStartPayload {
  /**
   * Identifies THIS match, so gameplay traffic from a previous one can be told
   * apart and discarded.
   *
   * Sequence numbers cannot do this job: they are per-sender and monotonic
   * across the whole connection, so a PLAYER_MOVE still in flight when a match
   * ends carries a perfectly valid, higher seq and is indistinguishable from
   * a fresh one.
   */
  matchEpoch: number;
  /** Countdown length before movement is unlocked. */
  countdownSec: number;
  /**
   * Host epoch ms at which PLAYING begins. Players convert this into a local
   * duration using their own receive time -- never trust it as an absolute.
   */
  startsAt: number;
  durationSec: number;
  worldSeed: number;
  spawnPoint: Position;
  config: GameConfig;
  /** Team assignments, Team Hunt only. */
  teams?: Array<{id: string; name: string; color: string; memberIds: string[]}>;
}

/** Periodic authoritative digest. Deliberately compact: no world geometry. */
export interface GameStatePayload {
  phase: GamePhase;
  /** Milliseconds left on the clock, as measured by the host. */
  remainingMs: number;
  players: Array<{
    id: string;
    /** Omitted when config.showOtherPlayers is false. */
    position?: Position;
    score: number;
    status: PlayerStatus;
    connection: PlayerConnectionState;
  }>;
  /** Ids of items already taken, so late or reconnecting players resync. */
  collectedItemIds: string[];
}

export interface PlayerMovePayload {
  position: Position;
  /** Unit vector of travel; lets the host sanity-check speed. */
  heading?: Position;
  /** The match this move belongs to; the host drops anything older. */
  matchEpoch?: number;
}

export enum PlayerActionKind {
  ActivatePowerUp = 'ACTIVATE_POWERUP',
  Tag = 'TAG',
  Dig = 'DIG',
}

export interface PlayerActionPayload {
  action: PlayerActionKind;
  itemKind?: ItemKind;
  targetPlayerId?: string;
  position?: Position;
}

export interface ProximityUpdatePayload {
  level: ProximityLevel;
  distanceBand: number;
  bearingDeg?: number;
  boosted: boolean;
  /**
   * The treasure's position, sent ONLY once this player is close enough for it
   * to reveal itself (VERY_HOT or nearer). It is withheld at every other range,
   * so the coordinates never leak early -- that is the whole hunt.
   */
  revealedTreasure?: {treasureId: string; position: Position};
}

export interface ItemCollectedPayload {
  itemId: string;
  itemKind: ItemKind;
  playerId: string;
  points: number;
  newScore: number;
}

export interface PowerUpUsedPayload {
  playerId: string;
  kind: ItemKind;
  durationMs: number;
  expiresAt: number;
}

export interface TreasureFoundPayload {
  treasureId: string;
  playerId: string;
  position: Position;
  points: number;
  isFirst: boolean;
  newScore: number;
}

export interface TreasureSpawnedPayload {
  treasureId: string;
  /** Only sent to the owning player in Individual Hunt; never carries position. */
  ownerId?: string;
}

export interface ScoreUpdatePayload {
  scores: Array<{playerId: string; score: number}>;
}

export interface PlayerEliminatedPayload {
  playerId: string;
  byPlayerId?: string;
  reason: string;
}

export interface PlayerDisconnectedPayload {
  playerId: string;
  graceMs: number;
}

export interface PlayerReconnectedPayload {
  playerId: string;
}

export interface GameEndPayload {
  winnerId: string | null;
  winningTeamId: string | null;
  reason: 'TREASURE_FOUND' | 'TIME_UP' | 'HOST_ENDED' | 'ALL_LEFT';
  /** Revealed only now, so the map can show where it was hiding. */
  treasurePositions: Array<{treasureId: string; position: Position}>;
  standings: Array<{
    playerId: string;
    name: string;
    score: number;
    foundTreasure: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Discriminated union of every message on the wire
// ---------------------------------------------------------------------------

export type GameMessage =
  | (Envelope<AckPayload> & {type: MessageType.Ack})
  | (Envelope<HelloPayload> & {type: MessageType.Hello})
  | (Envelope<Record<string, never>> & {type: MessageType.Ping})
  | (Envelope<Record<string, never>> & {type: MessageType.Pong})
  | (Envelope<GameJoinPayload> & {type: MessageType.GameJoin})
  | (Envelope<GameJoinAcceptedPayload> & {type: MessageType.GameJoinAccepted})
  | (Envelope<GameJoinRejectedPayload> & {type: MessageType.GameJoinRejected})
  | (Envelope<PlayerJoinedPayload> & {type: MessageType.PlayerJoined})
  | (Envelope<PlayerLeftPayload> & {type: MessageType.PlayerLeft})
  | (Envelope<LobbyStatePayload> & {type: MessageType.LobbyState})
  | (Envelope<GameStartPayload> & {type: MessageType.GameStart})
  | (Envelope<GameStatePayload> & {type: MessageType.GameState})
  | (Envelope<GameEndPayload> & {type: MessageType.GameEnd})
  | (Envelope<PlayerMovePayload> & {type: MessageType.PlayerMove})
  | (Envelope<PlayerActionPayload> & {type: MessageType.PlayerAction})
  | (Envelope<ProximityUpdatePayload> & {type: MessageType.ProximityUpdate})
  | (Envelope<ItemCollectedPayload> & {type: MessageType.ItemCollected})
  | (Envelope<PowerUpUsedPayload> & {type: MessageType.PowerUpUsed})
  | (Envelope<TreasureFoundPayload> & {type: MessageType.TreasureFound})
  | (Envelope<TreasureSpawnedPayload> & {type: MessageType.TreasureSpawned})
  | (Envelope<ScoreUpdatePayload> & {type: MessageType.ScoreUpdate})
  | (Envelope<PlayerEliminatedPayload> & {type: MessageType.PlayerEliminated})
  | (Envelope<PlayerDisconnectedPayload> & {type: MessageType.PlayerDisconnected})
  | (Envelope<PlayerReconnectedPayload> & {type: MessageType.PlayerReconnected});

/**
 * Messages that MUST arrive. The reliability layer retries these until the peer
 * acknowledges. Everything else is fire-and-forget: a dropped PLAYER_MOVE is
 * corrected by the next one 100 ms later, so retrying it only adds latency.
 */
export const RELIABLE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.GameJoin,
  MessageType.GameJoinAccepted,
  MessageType.GameJoinRejected,
  MessageType.GameStart,
  MessageType.GameEnd,
  MessageType.TreasureFound,
  MessageType.ItemCollected,
  MessageType.PowerUpUsed,
  MessageType.PlayerJoined,
  MessageType.PlayerLeft,
  MessageType.PlayerEliminated,
  MessageType.PlayerAction,
  // A rematch has to reach every player or they sit on the results
  // screen while the host opens a new lobby without them.
  MessageType.LobbyState,
]);

/**
 * Messages carrying "latest value wins" state. When one of these arrives with a
 * seq lower than the newest already processed for that sender it is dropped
 * rather than applied -- this is how out-of-order delivery is absorbed without
 * paying for fully ordered delivery.
 */
export const LATEST_WINS_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.PlayerMove,
  MessageType.GameState,
  MessageType.ProximityUpdate,
  MessageType.ScoreUpdate,
  MessageType.LobbyState,
]);

export function isReliable(type: MessageType): boolean {
  return RELIABLE_MESSAGE_TYPES.has(type);
}

export function isLatestWins(type: MessageType): boolean {
  return LATEST_WINS_MESSAGE_TYPES.has(type);
}

// Re-exported so consumers can build payloads without importing five modules.
export type {GameConfig, GameMode, GamePhase, Position, Size, Obstacle, WorldItem};
