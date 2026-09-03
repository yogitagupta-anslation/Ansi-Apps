import { Guess, Heat, Range, Verdict } from '../types/game';

/** Inclusive count of numbers in a range. */
export function rangeSize(range: Range): number {
  return Math.max(0, range.max - range.min + 1);
}

/** Picks the hidden target. `rand` is injectable so rounds can be made deterministic. */
export function makeTarget(range: Range, rand: () => number = Math.random): number {
  return range.min + Math.floor(rand() * rangeSize(range));
}

/**
 * Judges a guess. 'higher'/'lower' are phrased as instructions to the guesser:
 * judge(50, 37) === 'lower' because the next guess should come down.
 */
export function judge(guess: number, target: number): Verdict {
  if (guess === target) return 'correct';
  return guess < target ? 'higher' : 'lower';
}

/**
 * Shrinks the range a guesser can still logically consider. Used both by the AI
 * and by the on-screen range track that shows the net closing in.
 */
export function narrow(known: Range, guess: number, verdict: Verdict): Range {
  if (verdict === 'higher') return { min: Math.max(known.min, guess + 1), max: known.max };
  if (verdict === 'lower') return { min: known.min, max: Math.min(known.max, guess - 1) };
  return { min: guess, max: guess };
}

/** Replays a guess history to get the range still in play. */
export function knownRange(range: Range, guesses: Pick<Guess, 'value' | 'verdict'>[]): Range {
  return guesses.reduce<Range>((acc, g) => narrow(acc, g.value, g.verdict), range);
}

/** Guesses a perfect binary search needs worst-case — the "par" for a round. */
export function parGuesses(range: Range): number {
  const size = rangeSize(range);
  return size <= 1 ? 1 : Math.ceil(Math.log2(size + 1));
}

/** True when the guess is a whole number inside the range. */
export function isValidGuess(value: number, range: Range): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

/**
 * Proximity band for the Hot/Cold modifier. Thresholds scale with the range so
 * "very close" means the same thing at 1-20 as it does at 1-10,000.
 */
export function heatFor(guess: number, target: number, range: Range): Heat {
  const size = rangeSize(range);
  const distance = Math.abs(guess - target);
  if (distance <= Math.max(1, Math.round(size * 0.02))) return 'blazing';
  if (distance <= Math.max(3, Math.round(size * 0.12))) return 'warm';
  return 'cold';
}

export function heatLabel(heat: Heat): string {
  if (heat === 'blazing') return '🔥 Very close';
  if (heat === 'warm') return '🌡️ Getting warmer';
  return '❄️ Far off';
}

/** Human label for a verdict, matching the on-screen banner copy. */
export function verdictLabel(verdict: Verdict): string {
  if (verdict === 'higher') return 'HIGHER';
  if (verdict === 'lower') return 'LOWER';
  return 'CORRECT!';
}

export function verdictIcon(verdict: Verdict): string {
  if (verdict === 'higher') return '⬆️';
  if (verdict === 'lower') return '⬇️';
  return '🎯';
}
