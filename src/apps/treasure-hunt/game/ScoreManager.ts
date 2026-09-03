/**
 * Scoring and leaderboard.
 *
 * Pure bookkeeping: it owns the numbers and the ordering, and knows nothing
 * about BLE or React. Points are awarded only by the host, so two players
 * grabbing the same coin at once cannot both be paid.
 */
import {DOUBLE_POINTS_MULTIPLIER, ITEM_POINTS, SCORING} from '../config/gameConfig';
import type {ScoreEvent} from '../models/game';
import {compareForLeaderboard, type Player, type Team} from '../models/player';
import {ItemKind} from '../models/world';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';

const log = createLogger('ScoreManager');

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  avatar: string;
  score: number;
  teamId?: string;
  foundTreasure: boolean;
  isLocal: boolean;
}

export interface TeamStanding {
  rank: number;
  teamId: string;
  name: string;
  color: string;
  score: number;
  memberIds: string[];
}

export interface ScoreManagerEvents {
  scoreChanged: {playerId: string; score: number; delta: number; reason: string};
  historyChanged: ScoreEvent[];
}

/** How many recent score events to keep for the on-screen feed. */
const HISTORY_LIMIT = 40;

export class ScoreManager {
  readonly events = new Emitter<ScoreManagerEvents>();

  private scores = new Map<string, number>();
  private history: ScoreEvent[] = [];
  private treasureFinders = new Set<string>();
  private firstFinderId: string | null = null;

  reset(): void {
    this.scores.clear();
    this.history = [];
    this.treasureFinders.clear();
    this.firstFinderId = null;
  }

  register(playerId: string): void {
    if (!this.scores.has(playerId)) {
      this.scores.set(playerId, 0);
    }
  }

  unregister(playerId: string): void {
    this.scores.delete(playerId);
    this.treasureFinders.delete(playerId);
  }

  scoreFor(playerId: string): number {
    return this.scores.get(playerId) ?? 0;
  }

  /**
   * Award points.
   * @param doubled true when the player has Double Points running.
   * @returns the new total.
   */
  award(
    playerId: string,
    basePoints: number,
    reason: string,
    doubled = false,
  ): number {
    const points = doubled ? basePoints * DOUBLE_POINTS_MULTIPLIER : basePoints;
    const next = this.scoreFor(playerId) + points;
    this.scores.set(playerId, next);

    const event: ScoreEvent = {playerId, points, reason, at: Date.now()};
    this.history.unshift(event);
    if (this.history.length > HISTORY_LIMIT) {
      this.history.length = HISTORY_LIMIT;
    }

    log.debug(`${playerId} ${points >= 0 ? '+' : ''}${points} (${reason}) -> ${next}`);
    this.events.emit('scoreChanged', {playerId, score: next, delta: points, reason});
    this.events.emit('historyChanged', this.getHistory());
    return next;
  }

  awardItem(playerId: string, kind: ItemKind, doubled = false): number {
    const points = ITEM_POINTS[kind] ?? 0;
    const label =
      kind === ItemKind.Coin ? 'Coin' : kind === ItemKind.Gem ? 'Rare gem' : 'Power-up';
    return this.award(playerId, points, label, doubled);
  }

  /**
   * Award a treasure find, including the one-time first-finder bonus.
   * @returns the total awarded and the new score.
   */
  awardTreasure(
    playerId: string,
    doubled = false,
    remainingSec = 0,
  ): {points: number; newScore: number; isFirst: boolean} {
    const isFirst = this.firstFinderId === null;
    if (isFirst) {
      this.firstFinderId = playerId;
    }
    this.treasureFinders.add(playerId);

    let base = SCORING.treasureFound;
    if (isFirst) {
      base += SCORING.firstFinderBonus;
    }
    if (SCORING.timeBonusPerSecond > 0) {
      base += Math.floor(remainingSec) * SCORING.timeBonusPerSecond;
    }

    const before = this.scoreFor(playerId);
    const newScore = this.award(
      playerId,
      base,
      isFirst ? 'Treasure found (first!)' : 'Treasure found',
      doubled,
    );

    return {points: newScore - before, newScore, isFirst};
  }

  applyTagPenalty(playerId: string): number {
    return this.award(playerId, -SCORING.taggedPenalty, 'Tagged by a rival');
  }

  hasFoundTreasure(playerId: string): boolean {
    return this.treasureFinders.has(playerId);
  }

  get firstFinder(): string | null {
    return this.firstFinderId;
  }

  getHistory(): ScoreEvent[] {
    return this.history.map(event => ({...event}));
  }

  // -------------------------------------------------------------------------
  // Standings
  // -------------------------------------------------------------------------

  buildLeaderboard(players: readonly Player[], localPlayerId?: string): LeaderboardRow[] {
    // Fold the authoritative scores in before sorting.
    const withScores = players.map(player => ({
      ...player,
      score: this.scoreFor(player.id),
    }));

    return withScores
      .sort(compareForLeaderboard)
      .map((player, index) => ({
        rank: index + 1,
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        score: player.score,
        ...(player.teamId ? {teamId: player.teamId} : {}),
        foundTreasure: this.hasFoundTreasure(player.id),
        isLocal: player.id === localPlayerId,
      }));
  }

  buildTeamStandings(teams: readonly Team[]): TeamStanding[] {
    return teams
      .map(team => ({
        teamId: team.id,
        name: team.name,
        color: team.color,
        memberIds: [...team.memberIds],
        score: team.memberIds.reduce((total, id) => total + this.scoreFor(id), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map((team, index) => ({rank: index + 1, ...team}));
  }

  /** Winner by score. Null when there are no players. */
  determineWinner(players: readonly Player[]): string | null {
    const board = this.buildLeaderboard(players);
    return board.length > 0 ? (board[0] as LeaderboardRow).playerId : null;
  }

  determineWinningTeam(teams: readonly Team[]): string | null {
    const standings = this.buildTeamStandings(teams);
    return standings.length > 0 ? (standings[0] as TeamStanding).teamId : null;
  }

  /** Compact form for a SCORE_UPDATE broadcast. */
  snapshot(): Array<{playerId: string; score: number}> {
    return Array.from(this.scores.entries()).map(([playerId, score]) => ({
      playerId,
      score,
    }));
  }

  /** Player side: adopt the host's authoritative scores. */
  applySnapshot(snapshot: ReadonlyArray<{playerId: string; score: number}>): void {
    for (const {playerId, score} of snapshot) {
      this.scores.set(playerId, score);
    }
  }

  /** Player side: mirror a treasure find announced by the host. */
  noteTreasureFinder(playerId: string, isFirst: boolean): void {
    this.treasureFinders.add(playerId);
    if (isFirst && this.firstFinderId === null) {
      this.firstFinderId = playerId;
    }
  }

  dispose(): void {
    this.reset();
    this.events.removeAllListeners();
  }
}
