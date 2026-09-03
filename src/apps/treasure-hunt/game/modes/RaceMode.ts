/**
 * Race: first hunter to the treasure ends the match instantly.
 */
import {GameMode} from '../../models/game';
import type {Treasure} from '../../models/world';
import type {
  GameModeStrategy,
  MatchEndOutcome,
  ModeContext,
  TreasureFoundOutcome,
} from './GameModeStrategy';

export class RaceMode implements GameModeStrategy {
  readonly mode = GameMode.Race;
  readonly usesPerPlayerTreasures = false;
  readonly usesTeams = false;

  onTreasureFound(
    _playerId: string,
    _treasure: Treasure,
    _context: ModeContext,
  ): TreasureFoundOutcome {
    return {
      endMatch: true,
      respawnTreasure: false,
      finishPlayer: true,
    };
  }

  shouldEndMatch(context: ModeContext): boolean {
    return context.treasures.foundCount > 0;
  }

  resolveWinner(context: ModeContext): MatchEndOutcome {
    // Whoever got there first wins outright, regardless of coins collected.
    const finder = context.scores.firstFinder;
    return {
      winnerId: finder ?? context.scores.determineWinner(context.players),
      winningTeamId: null,
      reason: finder ? 'TREASURE_FOUND' : 'TIME_UP',
    };
  }

  describe(): string {
    return 'First hunter to reach the treasure wins. The match ends on the spot.';
  }
}
