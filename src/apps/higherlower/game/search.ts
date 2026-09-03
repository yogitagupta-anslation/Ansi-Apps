import { Guess, Range, Verdict } from '../types/game';
import { narrow, rangeSize } from './engine';

/**
 * The maths behind "how good was that guess".
 *
 * Every guess splits the numbers still in play. Picking the middle guarantees
 * you remove half of them; picking near an edge might remove one. Surfacing
 * that number after each guess is what teaches binary search without ever
 * naming it.
 */

/** How many candidates a guess removes from the range still in play. */
export function eliminatedBy(known: Range, guess: number, verdict: Verdict): number {
  const before = rangeSize(known);
  if (verdict === 'correct') return Math.max(0, before - 1);
  return Math.max(0, before - rangeSize(narrow(known, guess, verdict)));
}

/**
 * The most a single guess can be *guaranteed* to remove — what the midpoint
 * takes. Landing on the number beats this, which is why the ratio is capped.
 */
export function idealElimination(known: Range): number {
  return Math.floor(rangeSize(known) / 2);
}

/** 0–1: how close this guess came to the best available split. */
export function guessQuality(guess: Guess): number {
  if (guess.ideal <= 0) return 1;
  return Math.min(1, guess.eliminated / guess.ideal);
}

/** 0–1 across a whole round. */
export function searchQuality(guesses: Guess[]): number {
  const scored = guesses.filter((g) => g.ideal > 0);
  if (scored.length === 0) return 1;
  return scored.reduce((sum, g) => sum + guessQuality(g), 0) / scored.length;
}

export interface QualityBand {
  label: string;
  hint: string;
}

export function qualityBand(quality: number): QualityBand {
  if (quality >= 0.92) return { label: 'Excellent', hint: 'You halved the field almost every time.' };
  if (quality >= 0.75) return { label: 'Sharp', hint: 'Mostly middle-of-the-range guessing.' };
  if (quality >= 0.55) return { label: 'Decent', hint: 'A few guesses left a lot on the table.' };
  return { label: 'Loose', hint: 'Aim for the middle of what is still possible.' };
}
