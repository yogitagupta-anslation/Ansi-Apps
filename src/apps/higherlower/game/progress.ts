import { RoundSummary } from '../types/game';
import { scoreRound } from './scoring';
import { searchQuality } from './search';

/**
 * Everything the player carries between rounds: a running profile, the badges
 * they have earned, and their best daily-challenge result. Pure functions so
 * the whole thing can be replayed and tested without a device.
 */
export interface Achievement {
  id: string;
  name: string;
  icon: string;
  blurb: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-blood', name: 'First Blood', icon: '🏆', blurb: 'Win your first multiplayer round.' },
  { id: 'perfect-search', name: 'Perfect Search', icon: '🧠', blurb: 'Finish a round exactly at par.' },
  { id: 'speed-demon', name: 'Speed Demon', icon: '⚡', blurb: 'Find the number in under 5 seconds.' },
  { id: 'one-away', name: 'One Away', icon: '🎯', blurb: 'Guess within 1 of the target.' },
  { id: 'unbeatable', name: 'Unbeatable', icon: '👑', blurb: 'Win 5 multiplayer rounds in a row.' },
  { id: 'binary-master', name: 'Binary Master', icon: '🔢', blurb: 'Beat par 10 times.' },
  { id: 'blindfolded', name: 'Blindfolded', icon: '🙈', blurb: 'Win a blind round.' },
  { id: 'high-roller', name: 'High Roller', icon: '💰', blurb: 'Land a double down.' },
  { id: 'survivor', name: 'Survivor', icon: '⏳', blurb: 'Win a round with limited guesses.' },
  { id: 'insanity', name: 'Insanity', icon: '🌋', blurb: 'Finish a 1–10,000 round.' },
];

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export interface DailyResult {
  guesses: number;
  ms: number;
  score: number;
}

export interface Stats {
  played: number;
  wins: number;
  totalGuesses: number;
  /** Rounds finished at or under par. */
  perfectRounds: number;
  bestTimeMs: number | null;
  bestScore: number;
  /** Current and best win streak, any mode. */
  streak: number;
  bestStreak: number;
  multiplayerWins: number;
  multiplayerStreak: number;
  unlocked: string[];
  /** Keyed by YYYY-MM-DD — only the day's best is kept. */
  daily: Record<string, DailyResult>;
}

export const EMPTY_STATS: Stats = {
  played: 0,
  wins: 0,
  totalGuesses: 0,
  perfectRounds: 0,
  bestTimeMs: null,
  bestScore: 0,
  streak: 0,
  bestStreak: 0,
  multiplayerWins: 0,
  multiplayerStreak: 0,
  unlocked: [],
  daily: {},
};

export interface RoundRecord {
  summary: RoundSummary;
  youId: string;
  multiplayer: boolean;
  /** Set when the round was today's challenge. */
  dailyKey?: string;
}

export interface RecordResult {
  stats: Stats;
  /** Badges earned by this round, for the "unlocked" toast. */
  unlocked: Achievement[];
}

/** Folds one finished round into the profile and returns any new badges. */
export function recordRound(stats: Stats, record: RoundRecord): RecordResult {
  const { summary, youId, multiplayer } = record;
  const you = summary.racers.find((r) => r.id === youId);
  if (!you) return { stats, unlocked: [] };

  const won = summary.winnerId === youId;
  const finished = you.finishedAt !== null;
  const guesses = you.guesses.length;
  const atOrUnderPar = finished && guesses <= summary.parGuesses;
  const score = scoreRound(you, summary).total;

  const next: Stats = {
    ...stats,
    played: stats.played + 1,
    wins: stats.wins + (won ? 1 : 0),
    totalGuesses: stats.totalGuesses + guesses,
    perfectRounds: stats.perfectRounds + (atOrUnderPar ? 1 : 0),
    bestScore: Math.max(stats.bestScore, score),
    bestTimeMs:
      finished && you.finishedAt !== null
        ? stats.bestTimeMs === null
          ? you.finishedAt
          : Math.min(stats.bestTimeMs, you.finishedAt)
        : stats.bestTimeMs,
    streak: won ? stats.streak + 1 : 0,
    bestStreak: won ? Math.max(stats.bestStreak, stats.streak + 1) : stats.bestStreak,
    multiplayerWins: stats.multiplayerWins + (won && multiplayer ? 1 : 0),
    multiplayerStreak: multiplayer ? (won ? stats.multiplayerStreak + 1 : 0) : stats.multiplayerStreak,
    daily: { ...stats.daily },
  };

  if (record.dailyKey && finished) {
    const previous = next.daily[record.dailyKey];
    if (!previous || score > previous.score) {
      next.daily[record.dailyKey] = { guesses, ms: you.finishedAt ?? 0, score };
    }
  }

  // ---- badges ---------------------------------------------------------------
  const earned: string[] = [];
  const closest = you.guesses.reduce(
    (best, g) => Math.min(best, Math.abs(g.value - summary.target)),
    Number.POSITIVE_INFINITY,
  );

  if (won && multiplayer) earned.push('first-blood');
  if (finished && guesses === summary.parGuesses) earned.push('perfect-search');
  if (finished && (you.finishedAt ?? Infinity) < 5000) earned.push('speed-demon');
  if (closest <= 1) earned.push('one-away');
  if (next.multiplayerStreak >= 5) earned.push('unbeatable');
  if (next.perfectRounds >= 10) earned.push('binary-master');
  if (won && summary.modifiers.includes('blind')) earned.push('blindfolded');
  if (summary.modifiers.includes('double') && you.guesses.some((g) => g.wagered && g.verdict === 'correct')) {
    earned.push('high-roller');
  }
  if (won && summary.modifiers.includes('limited')) earned.push('survivor');
  if (finished && summary.range.max >= 10000) earned.push('insanity');

  const fresh = earned.filter((id) => !stats.unlocked.includes(id));
  next.unlocked = [...stats.unlocked, ...fresh];

  return {
    stats: next,
    unlocked: fresh.map(achievementById).filter((a): a is Achievement => Boolean(a)),
  };
}

export function winRate(stats: Stats): number {
  return stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
}

export function averageGuesses(stats: Stats): number {
  return stats.played === 0 ? 0 : Math.round((stats.totalGuesses / stats.played) * 10) / 10;
}

/** Search quality of a single round, kept here so screens do not import both. */
export function roundQuality(summary: RoundSummary, youId: string): number {
  const you = summary.racers.find((r) => r.id === youId);
  return you ? searchQuality(you.guesses) : 0;
}
