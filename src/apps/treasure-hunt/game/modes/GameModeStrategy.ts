/**
 * Game modes as strategies.
 *
 * GameManager owns the shared machinery -- movement, items, scoring, BLE sync.
 * Everything that differs between modes is isolated behind this interface, so
 * adding a mode means adding one file and one registry entry, with no edits to
 * the engine.
 */
import type {GameConfig, GameMode} from '../../models/game';
import type {Player, Team} from '../../models/player';
import type {GameWorld, Treasure} from '../../models/world';
import type {ScoreManager} from '../ScoreManager';
import type {TreasureManager} from '../TreasureManager';

/** Everything a mode may inspect when making a decision. */
export interface ModeContext {
  config: GameConfig;
  world: GameWorld;
  players: readonly Player[];
  teams: readonly Team[];
  treasures: TreasureManager;
  scores: ScoreManager;
  /** Milliseconds left, or Infinity when the match is untimed. */
  remainingMs: number;
}

export interface TreasureFoundOutcome {
  /** End the match now. */
  endMatch: boolean;
  /** Put a fresh treasure into the world (Timed Hunt). */
  respawnTreasure: boolean;
  /** Owner for the respawned treasure, when the mode assigns one. */
  respawnOwnerId?: string;
  /** Mark this player as finished and stop them hunting. */
  finishPlayer: boolean;
}

export interface MatchEndOutcome {
  winnerId: string | null;
  winningTeamId: string | null;
  reason: 'TREASURE_FOUND' | 'TIME_UP' | 'HOST_ENDED' | 'ALL_LEFT';
}

export interface GameModeStrategy {
  readonly mode: GameMode;

  /** Does every player get their own treasure? */
  readonly usesPerPlayerTreasures: boolean;

  /** Does the mode split players into teams? */
  readonly usesTeams: boolean;

  /** Assign teams at match start. Only called when usesTeams is true. */
  assignTeams?(players: readonly Player[], teamCount: number): Team[];

  /** Decide what happens when someone reaches a treasure. */
  onTreasureFound(
    playerId: string,
    treasure: Treasure,
    context: ModeContext,
  ): TreasureFoundOutcome;

  /** Should the match end right now, for a reason other than a find? */
  shouldEndMatch(context: ModeContext): boolean;

  /** Decide the winner once the match is over. */
  resolveWinner(context: ModeContext): MatchEndOutcome;

  /** Short line shown in the lobby explaining the rules. */
  describe(): string;
}
