/**
 * Team Hunt: players split into teams and pool their scores.
 */
import {GameMode} from '../../models/game';
import type {Player, Team} from '../../models/player';
import type {Treasure} from '../../models/world';
import type {
  GameModeStrategy,
  MatchEndOutcome,
  ModeContext,
  TreasureFoundOutcome,
} from './GameModeStrategy';

const TEAM_PALETTE = [
  {name: 'Crimson Compass', color: '#FF4D5E'},
  {name: 'Azure Anchors', color: '#4AA8FF'},
  {name: 'Emerald Expedition', color: '#39E6A0'},
  {name: 'Amber Armada', color: '#FFB020'},
];

export class TeamHuntMode implements GameModeStrategy {
  readonly mode = GameMode.TeamHunt;
  readonly usesPerPlayerTreasures = false;
  readonly usesTeams = true;

  /**
   * Snake-draft the roster into teams so sizes stay balanced even when the
   * player count does not divide evenly.
   */
  assignTeams(players: readonly Player[], teamCount: number): Team[] {
    const count = Math.max(2, Math.min(teamCount, TEAM_PALETTE.length));
    const teams: Team[] = Array.from({length: count}, (_, index) => {
      const palette = TEAM_PALETTE[index] ?? TEAM_PALETTE[0];
      return {
        id: `TEAM_${index + 1}`,
        name: palette!.name,
        color: palette!.color,
        memberIds: [],
        score: 0,
      };
    });

    players.forEach((player, index) => {
      const round = Math.floor(index / count);
      const slot = index % count;
      // Reverse direction each round -- that is what makes it a snake draft.
      const teamIndex = round % 2 === 0 ? slot : count - 1 - slot;
      teams[teamIndex]?.memberIds.push(player.id);
    });

    return teams;
  }

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
    return context.treasures.allFound;
  }

  resolveWinner(context: ModeContext): MatchEndOutcome {
    return {
      winnerId: context.scores.determineWinner(context.players),
      winningTeamId: context.scores.determineWinningTeam(context.teams),
      reason: context.treasures.foundCount > 0 ? 'TREASURE_FOUND' : 'TIME_UP',
    };
  }

  describe(): string {
    return 'Two crews, one treasure. Combined team score takes the win.';
  }
}
