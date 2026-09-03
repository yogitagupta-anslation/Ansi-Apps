/**
 * Shared Treasure: one treasure, everyone hunts it.
 *
 * Finding it does not end the match -- the clock does. That keeps late players
 * engaged: after the treasure drops there is still loot on the map and a
 * leaderboard to climb.
 */
import {GameMode} from '../../models/game';
import type {Treasure} from '../../models/world';
import type {
  GameModeStrategy,
  MatchEndOutcome,
  ModeContext,
  TreasureFoundOutcome,
} from './GameModeStrategy';

export class SharedTreasureMode implements GameModeStrategy {
  readonly mode = GameMode.SharedTreasure;
  readonly usesPerPlayerTreasures = false;
  readonly usesTeams = false;

  onTreasureFound(
    _playerId: string,
    _treasure: Treasure,
    _context: ModeContext,
  ): TreasureFoundOutcome {
    return {
      endMatch: false,
      respawnTreasure: false,
      finishPlayer: true,
    };
  }

  shouldEndMatch(context: ModeContext): boolean {
    // Nothing left to hunt and nobody still searching.
    return context.treasures.allFound && context.remainingMs <= 0;
  }

  resolveWinner(context: ModeContext): MatchEndOutcome {
    return {
      winnerId: context.scores.determineWinner(context.players),
      winningTeamId: null,
      reason: context.treasures.allFound ? 'TREASURE_FOUND' : 'TIME_UP',
    };
  }

  describe(): string {
    return 'One treasure, everybody hunting. Highest score when the clock runs out wins.';
  }
}
