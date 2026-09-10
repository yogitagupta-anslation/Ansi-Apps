import { Racer, RoundSummary } from '../types/game';
import { searchQuality } from './search';

/**
 * Score turns a round into two dimensions instead of one. Finishing first still
 * matters, but so does how few guesses it took and how hard the round was —
 * which is what stops "fastest thumbs" from being the whole game.
 */
export interface ScoreLine {
  label: string;
  points: number;
}

export interface ScoreCard {
  total: number;
  lines: ScoreLine[];
}

const CORRECT = 100;
const UNDER_PAR = 50;
const FAST = 25;
const EXTRA_GUESS = -10;
const RISKY_MISS = -5;
const RISK_HIT = 40;
const RISK_MISS = -15;
const DOUBLE_MISS = -50;
/** Each modifier makes the round worth this much more. */
const MODIFIER_BONUS = 0.15;

/** A finish counts as fast if it lands inside this many ms per par guess. */
const MS_PER_PAR_GUESS = 1500;

export function scoreRound(racer: Racer, summary: RoundSummary): ScoreCard {
  const lines: ScoreLine[] = [];
  const guesses = racer.guesses.length;
  const finished = racer.finishedAt !== null;

  // Sudden death scores the shot, not the search.
  if (summary.mode === 'sudden') {
    const distance = closestDistance(racer, summary.target);
    if (finished) lines.push({ label: 'Landed it outright', points: CORRECT });
    else if (Number.isFinite(distance)) {
      const size = summary.range.max - summary.range.min + 1;
      const closeness = Math.max(0, Math.round((1 - distance / size) * 80));
      lines.push({ label: `${distance} away`, points: closeness });
    }
    const total = lines.reduce((sum, l) => sum + l.points, 0);
    return { total, lines };
  }

  if (finished) {
    lines.push({ label: 'Found the number', points: CORRECT });

    if (guesses <= summary.parGuesses) {
      lines.push({ label: `At or under par (${summary.parGuesses})`, points: UNDER_PAR });
    } else {
      const extra = guesses - summary.parGuesses;
      lines.push({ label: `${extra} guess${extra === 1 ? '' : 'es'} over par`, points: EXTRA_GUESS * extra });
    }

    if ((racer.finishedAt ?? 0) < summary.parGuesses * MS_PER_PAR_GUESS) {
      lines.push({ label: 'Fast finish', points: FAST });
    }
  } else if (racer.eliminated) {
    lines.push({ label: 'Eliminated — out of guesses', points: 0 });
  } else {
    lines.push({ label: 'Never found it', points: 0 });
  }

  // Wagers are per guess, so they land whether or not the round was finished.
  const wagers = racer.guesses.filter((g) => g.wagered);
  const hit = wagers.find((g) => g.verdict === 'correct');
  const missed = wagers.filter((g) => g.verdict !== 'correct').length;

  if (summary.modifiers.includes('risk')) {
    if (hit) lines.push({ label: 'Risky guess landed', points: RISK_HIT });
    if (missed > 0) lines.push({ label: `${missed} risky miss${missed === 1 ? '' : 'es'}`, points: RISK_MISS * missed });
  } else if (summary.modifiers.includes('double')) {
    if (missed > 0) lines.push({ label: 'Double down missed', points: DOUBLE_MISS * missed });
  } else if (missed > 0) {
    lines.push({ label: `${missed} wrong risky guess`, points: RISKY_MISS * missed });
  }

  let total = lines.reduce((sum, l) => sum + l.points, 0);

  // Double down doubles what you walked away with, if the staked guess landed.
  if (summary.modifiers.includes('double') && hit && total > 0) {
    lines.push({ label: 'Double down landed (2×)', points: total });
    total *= 2;
  }

  const bonusCount = summary.modifiers.length;
  if (bonusCount > 0 && total > 0) {
    const bonus = Math.round(total * MODIFIER_BONUS * bonusCount);
    lines.push({ label: `${bonusCount} modifier${bonusCount === 1 ? '' : 's'} (+${bonusCount * 15}%)`, points: bonus });
    total += bonus;
  }

  return { total, lines };
}

/** How far a racer's best guess landed from the number. */
export function closestDistance(racer: Racer, target: number): number {
  if (racer.finishedAt !== null) return 0;
  return racer.guesses.reduce(
    (best, g) => Math.min(best, Math.abs(g.value - target)),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Ranking depends on the mode: speed sorts by the clock, efficiency by guess
 * count with the clock as tiebreak, elimination by who survived, and sudden
 * death purely by who landed nearest -- nobody has to be right.
 */
export function rankRacers(summary: RoundSummary): Racer[] {
  if (summary.mode === 'sudden') {
    return [...summary.racers].sort((a, b) => {
      const da = closestDistance(a, summary.target);
      const db = closestDistance(b, summary.target);
      if (da !== db) return da - db;
      const byClock =
        (a.finishedAt ?? a.guesses[0]?.at ?? 0) - (b.finishedAt ?? b.guesses[0]?.at ?? 0);
      if (byClock !== 0) return byClock;
      // Same reason as below: two equally-close shots at the same moment must
      // resolve identically on every phone.
      return a.id.localeCompare(b.id);
    });
  }
  const alive = (r: Racer) => r.finishedAt !== null;
  return [...summary.racers].sort((a, b) => {
    if (alive(a) !== alive(b)) return alive(a) ? -1 : 1;
    if (!alive(a)) {
      if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
      return b.guesses.length - a.guesses.length;
    }
    if (summary.mode === 'efficiency' && a.guesses.length !== b.guesses.length) {
      return a.guesses.length - b.guesses.length;
    }
    const byClock = (a.finishedAt ?? 0) - (b.finishedAt ?? 0);
    if (byClock !== 0) return byClock;
    // A genuine dead heat has to break the same way on every phone. Array order
    // is whatever order that device happened to meet people in, so it breaks on
    // the id instead: arbitrary, but arbitrary in the same direction everywhere.
    return a.id.localeCompare(b.id);
  });
}

/** Who the mode says actually won, once everyone is done. */
export function winnerFor(summary: RoundSummary): string | null {
  const ranked = rankRacers(summary);
  const top = ranked[0];
  if (!top) return null;
  // Sudden death always crowns someone: nearest guess takes it.
  if (summary.mode === 'sudden') {
    return top.guesses.length > 0 ? top.id : null;
  }
  return top.finishedAt !== null ? top.id : null;
}

export function totalFor(racer: Racer, summary: RoundSummary): number {
  return scoreRound(racer, summary).total;
}

/** Search quality as a percentage, for the result screen. */
export function qualityPercent(racer: Racer): number {
  return Math.round(searchQuality(racer.guesses) * 100);
}
