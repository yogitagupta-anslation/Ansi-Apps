import type {Position, Size} from './geometry';
import type {GameWorld} from './world';
import type {Player, Team} from './player';

export enum GameMode {
  /** One treasure, everyone hunts it; first to reach it wins the big points. */
  SharedTreasure = 'SHARED_TREASURE',
  /** Same as shared, but the game ends the instant someone finds it. */
  Race = 'RACE',
  /** Every player gets their own private treasure. */
  IndividualHunt = 'INDIVIDUAL_HUNT',
  /** Players split into teams; team score decides the winner. */
  TeamHunt = 'TEAM_HUNT',
  /** Treasures respawn -- collect as many as possible before the clock runs out. */
  TimedHunt = 'TIMED_HUNT',
}

export const GAME_MODE_LABEL: Record<GameMode, string> = {
  [GameMode.SharedTreasure]: 'Shared Treasure',
  [GameMode.Race]: 'Race',
  [GameMode.IndividualHunt]: 'Individual Hunt',
  [GameMode.TeamHunt]: 'Team Hunt',
  [GameMode.TimedHunt]: 'Timed Hunt',
};

export const GAME_MODE_BLURB: Record<GameMode, string> = {
  [GameMode.SharedTreasure]: 'One treasure. Everybody hunts. Keep playing for loot after it drops.',
  [GameMode.Race]: 'One treasure. First to reach it ends the hunt on the spot.',
  [GameMode.IndividualHunt]: 'Every hunter gets their own secret treasure.',
  [GameMode.TeamHunt]: 'Two teams, one treasure. Combined score wins it.',
  [GameMode.TimedHunt]: 'Treasures keep respawning. Bank as many as you can.',
};

export enum GamePhase {
  Idle = 'IDLE',
  Lobby = 'LOBBY',
  Countdown = 'COUNTDOWN',
  Playing = 'PLAYING',
  Finished = 'FINISHED',
}

export enum ProximityLevel {
  VeryFar = 'VERY_FAR',
  Far = 'FAR',
  GettingClose = 'GETTING_CLOSE',
  Warm = 'WARM',
  Hot = 'HOT',
  VeryHot = 'VERY_HOT',
  Found = 'FOUND',
}

export interface ProximityTier {
  level: ProximityLevel;
  /** Applies while distance is strictly below this value (virtual units). */
  maxDistance: number;
  glyph: string;
  label: string;
  color: string;
  /** Radar sweep period in ms -- shorter = more urgent. */
  pulseMs: number;
}

/** Tunable rules for a single match. Shipped to players inside GAME_STATE. */
export interface GameConfig {
  mode: GameMode;
  worldSize: Size;
  /** Seconds; 0 disables the clock. */
  durationSec: number;
  maxPlayers: number;
  obstacleCount: number;
  coinCount: number;
  gemCount: number;
  powerUpCount: number;
  /** Treasure must spawn at least this far from the shared spawn point. */
  minTreasureSpawnDistance: number;
  /** Player must be within this distance to trigger the find. */
  treasureFoundRadius: number;
  /** Player must be within this distance to sweep up an item. */
  itemPickupRadius: number;
  /** Virtual units per second at normal speed. */
  moveSpeed: number;
  /** Whether players can see each other on the map. */
  showOtherPlayers: boolean;
  /** Team Hunt only. */
  teamCount: number;
}

export interface ScoreEvent {
  playerId: string;
  points: number;
  reason: string;
  at: number;
}

/** The authoritative snapshot the host owns and (in slices) broadcasts. */
export interface GameState {
  gameId: string;
  gameCode: string;
  phase: GamePhase;
  config: GameConfig;
  world: GameWorld | null;
  players: Record<string, Player>;
  teams: Record<string, Team>;
  hostId: string;
  localPlayerId: string;
  /** Epoch ms when PLAYING began; null before that. */
  startedAt: number | null;
  endsAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
  winningTeamId: string | null;
  recentScoreEvents: ScoreEvent[];
}

export interface MatchResult {
  gameId: string;
  mode: GameMode;
  playedAt: number;
  durationSec: number;
  standings: Array<{
    playerId: string;
    name: string;
    avatar: string;
    score: number;
    foundTreasure: boolean;
  }>;
  winnerName: string | null;
}

/** A player's private view of how close they are -- computed by the host. */
export interface ProximityReport {
  level: ProximityLevel;
  /** Distance quantised into a band so the exact value never leaks. */
  distanceBand: number;
  /** Only populated while a Hint or Radar power-up is active. */
  bearingDeg?: number;
  /** True while a Radar power-up sharpens the reading. */
  boosted: boolean;
}

export interface TreasureRevealedEvent {
  treasureId: string;
  position: Position;
  foundBy: string;
  points: number;
  isFirst: boolean;
}
