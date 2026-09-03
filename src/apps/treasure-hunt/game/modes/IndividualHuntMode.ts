/**
 * Individual Hunt: every player gets their own private treasure.
 *
 * Proximity feedback is per-player anyway (the host computes it separately for
 * each), so this mode only needs to say "one treasure each" and wait for
 * everyone to finish.
 */
import {GameMode} from '../../models/game';
import {PlayerStatus} from '../../models/player';
import type {Treasure} from '../../models/world';
import type {
  GameModeStrategy,
  MatchEndOutcome,
  ModeContext,
  TreasureFoundOutcome,
} from './GameModeStrategy';

export class IndividualHuntMode implements GameModeStrategy {
  readonly mode = GameMode.IndividualHunt;
  readonly usesPerPlayerTreasures = true;
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
    // Everyone still connected has found theirs -- no reason to keep going.
    const hunting = context.players.filter(
      player => player.status === PlayerStatus.Hunting,
    );
    return hunting.length === 0 && context.players.length > 0;
  }

  resolveWinner(context: ModeContext): MatchEndOutcome {
    return {
      winnerId: context.scores.determineWinner(context.players),
      winningTeamId: null,
      reason: context.treasures.foundCount > 0 ? 'TREASURE_FOUND' : 'TIME_UP',
    };
  }

  describe(): string {
    return 'Every hunter gets their own secret treasure. Fastest finder scores highest.';
  }
}
