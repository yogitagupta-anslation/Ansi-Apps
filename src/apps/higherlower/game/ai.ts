import { Difficulty, Guess, Range } from '../types/game';
import { knownRange, rangeSize } from './engine';
import { searchQuality } from './search';

/** The slice of a guess the bots actually reason about. */
export type GuessLike = Pick<Guess, 'value' | 'verdict'>;

export interface AiProfile {
  id: Difficulty;
  name: string;
  blurb: string;
  /** How long the bot "thinks" between guesses, in ms. */
  thinkMs: [number, number];
  /**
   * 0 = flawless binary search, 1 = picks blindly inside the range it knows.
   * Everything in between mixes the two.
   */
  sloppiness: number;
  /**
   * Chance of forgetting the feedback so far and guessing across the whole
   * range. This is what actually separates the difficulties: a guess inside the
   * range you have already narrowed is nearly as good as the midpoint, but a
   * guess outside it can be one you have provably ruled out -- a wasted turn,
   * the way a distracted human plays.
   */
  forgetfulness: number;
  /** Muttered in its lane while it plays, so it reads as an opponent. */
  quips: string[];
  /** Reads the human and retunes itself mid-round. */
  adaptive?: boolean;
}

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    id: 'easy',
    name: 'Rookie',
    blurb: 'Wanders, forgets what it ruled out, and takes its time.',
    thinkMs: [2000, 3200],
    sloppiness: 0.85,
    forgetfulness: 0.35,
    quips: ['Hmm…', 'Wait, was it higher?', 'Let me think…', 'Ooh, maybe this one.'],
  },
  normal: {
    id: 'normal',
    name: 'Challenger',
    blurb: 'Halves the range, but drifts off the mark.',
    thinkMs: [1400, 2300],
    sloppiness: 0.35,
    forgetfulness: 0.08,
    quips: ["I've got this.", 'Narrowing it down.', 'Getting close now.', 'Right, halve it again.'],
  },
  hard: {
    id: 'hard',
    name: 'Bisector',
    blurb: 'Perfect binary search, barely pauses.',
    thinkMs: [850, 1500],
    sloppiness: 0,
    forgetfulness: 0,
    quips: ['MIDPOINT SELECTED', 'RANGE HALVED', 'CONVERGING', 'CANDIDATES REDUCED'],
  },
  adaptive: {
    id: 'adaptive',
    name: 'Mirror',
    blurb: 'Watches how you play and retunes itself to match.',
    thinkMs: [900, 2600],
    sloppiness: 0.1,
    forgetfulness: 0,
    quips: ['Watching you.', 'Matching your pace.', 'Interesting choice.', 'Two can play that.'],
    adaptive: true,
  },
};

/** What the adaptive bot notices about the player. */
export interface OpponentRead {
  /** 0–1: how close their guesses sit to the midpoint. */
  quality: number;
  /** Average ms between their guesses, or null before they have made two. */
  paceMs: number | null;
  guesses: number;
}

export function readOpponent(guesses: Guess[]): OpponentRead {
  const quality = searchQuality(guesses);
  let paceMs: number | null = null;
  if (guesses.length >= 1) {
    paceMs = guesses[guesses.length - 1].at / guesses.length;
  }
  return { quality, paceMs, guesses: guesses.length };
}

export interface AiBrain {
  profile: AiProfile;
  /** Delay before the bot commits its next guess. */
  thinkMs(read?: OpponentRead): number;
  /** The bot's next guess given the full range and everything it has learned. */
  nextGuess(range: Range, history: GuessLike[], read?: OpponentRead): number;
  /** A line for its lane, or null when it has nothing to say. */
  quip(guessCount: number): string | null;
}

function randomInt(range: Range, rand: () => number): number {
  return range.min + Math.floor(rand() * rangeSize(range));
}

/**
 * Builds an opponent. A bot's informed guesses always stay inside the range its
 * own feedback has ruled in, so every difficulty converges; the weaker ones just
 * burn turns on guesses they should have known better than to make.
 *
 * Mirror is the exception: it plays a clean bisection and spends its attention
 * on the clock instead, pulling its pace toward -- and just inside -- yours.
 */
export function createAi(difficulty: Difficulty, rand: () => number = Math.random): AiBrain {
  const profile = AI_PROFILES[difficulty];

  const adaptiveThink = (read?: OpponentRead): number => {
    const [lo, hi] = profile.thinkMs;
    if (!read || read.paceMs === null) return (lo + hi) / 2;

    // Aim to land each guess a little ahead of the player's own rhythm...
    let target = read.paceMs * 0.9;
    // ...but ease off against someone who is still finding their feet, and
    // press hard against someone who is carving the range up cleanly.
    if (read.quality < 0.6) target *= 1.5;
    else if (read.quality > 0.9) target *= 0.8;
    return Math.min(hi, Math.max(lo, target));
  };

  return {
    profile,

    thinkMs(read) {
      if (profile.adaptive) return adaptiveThink(read);
      const [lo, hi] = profile.thinkMs;
      return lo + rand() * (hi - lo);
    },

    nextGuess(range, history, read) {
      // Lost the thread: guesses across the whole range, ruled-out numbers and
      // all. Costs a turn without costing information.
      if (rand() < profile.forgetfulness) return randomInt(range, rand);

      const known = knownRange(range, history);
      const size = rangeSize(known);
      if (size <= 1) return known.min;

      const midpoint = known.min + Math.floor(size / 2);

      // Under pressure from a sharp player, Mirror stops hedging entirely.
      const sloppiness = profile.adaptive && read && read.quality > 0.85 ? 0 : profile.sloppiness;
      if (sloppiness === 0) return midpoint;

      // Blend the midpoint with a blind pick. A sloppy bot mostly wanders;
      // a sharp one nudges a few steps off the true middle.
      if (rand() < sloppiness * 0.6) return randomInt(known, rand);

      const drift = Math.round((rand() * 2 - 1) * sloppiness * size * 0.25);
      return Math.min(known.max, Math.max(known.min, midpoint + drift));
    },

    quip(guessCount) {
      if (guessCount === 0) return profile.quips[0];
      return profile.quips[guessCount % profile.quips.length];
    },
  };
}
