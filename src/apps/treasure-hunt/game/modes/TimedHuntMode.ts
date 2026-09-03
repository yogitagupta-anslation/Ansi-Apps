/**
 * Timed Hunt: treasures respawn. Bank as many as possible before time runs out.
 */
import {GameMode} from '../../models/game';
import type {Treasure} from '../../models/world';
import type {
  GameModeStrategy,
  MatchEndOutcome,
  ModeContext,
  TreasureFoundOutcome,
} from './GameModeStrategy';

export class TimedHuntMode implements GameModeStrategy {
  readonly mode = GameMode.TimedHunt;
  readonly usesPerPlayerTreasures = false;
  readonly usesTeams = false;

  onTreasureFound(
    _playerId: string,
    _treasure: Treasure,
    _context: ModeContext,
  ): TreasureFoundOutcome {
    return {
      endMatch: false,
      respawnTreasure: true,
      // The hunt continues, so the finder stays in play.
      finishPlayer: false,
    };
  }

  shouldEndMatch(context: ModeContext): boolean {
    return context.remainingMs <= 0;
  }

  resolveWinner(context: ModeContext): MatchEndOutcome {
    return {
      winnerId: context.scores.determineWinner(context.players),
      winningTeamId: null,
      reason: 'TIME_UP',
    };
  }

  describe(): string {
    return 'Treasures keep respawning. Bank as many as you can before time is up.';
  }
}
