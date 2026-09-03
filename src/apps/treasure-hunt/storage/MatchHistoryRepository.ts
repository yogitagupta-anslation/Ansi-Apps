/**
 * Local match history -- the "played 12 hunts, won 4" stats on the home screen.
 * Capped so it cannot grow without bound on a device that plays a lot.
 */
import type {MatchResult} from '../models/game';
import {StorageKeys} from './StorageKeys';
import {readJson, writeJson} from './LocalStorage';

const HISTORY_LIMIT = 50;

export interface CareerStats {
  matchesPlayed: number;
  wins: number;
  treasuresFound: number;
  totalScore: number;
  bestScore: number;
}

export async function loadHistory(): Promise<MatchResult[]> {
  const stored = await readJson<MatchResult[]>(StorageKeys.matchHistory, []);
  return Array.isArray(stored) ? stored : [];
}

export async function recordMatch(result: MatchResult): Promise<MatchResult[]> {
  const history = await loadHistory();
  const next = [result, ...history].slice(0, HISTORY_LIMIT);
  await writeJson(StorageKeys.matchHistory, next);
  return next;
}

export async function clearHistory(): Promise<void> {
  await writeJson(StorageKeys.matchHistory, []);
}

/** Aggregate career stats for a given local player name. */
export function computeStats(history: readonly MatchResult[], playerName: string): CareerStats {
  const stats: CareerStats = {
    matchesPlayed: 0,
    wins: 0,
    treasuresFound: 0,
    totalScore: 0,
    bestScore: 0,
  };

  for (const match of history) {
    const mine = match.standings.find(row => row.name === playerName);
    if (!mine) {
      continue;
    }
    stats.matchesPlayed++;
    stats.totalScore += mine.score;
    stats.bestScore = Math.max(stats.bestScore, mine.score);
    if (mine.foundTreasure) {
      stats.treasuresFound++;
    }
    if (match.winnerName === playerName) {
      stats.wins++;
    }
  }

  return stats;
}
