/** Shared game vocabulary used by the engine, the AI, the BLE layer and the UI. */

/**
 * What the app says back after a guess. The word describes where the player
 * should aim NEXT, not where the target sits relative to zero:
 * guess 50 against target 37 => 'lower'.
 */
export type Verdict = 'higher' | 'lower' | 'correct';

/** Proximity band shown by the Hot/Cold modifier. */
export type Heat = 'blazing' | 'warm' | 'cold';

export interface Range {
  min: number;
  max: number;
}

export interface Guess {
  value: number;
  verdict: Verdict;
  /** Milliseconds since the round started — drives the "fastest" tiebreak. */
  at: number;
  /** Candidates this guess ruled out. */
  eliminated: number;
  /** The most it could have ruled out — what the midpoint would have taken. */
  ideal: number;
  /** Only present when the Hot/Cold modifier is on. */
  heat?: Heat;
  /** Player doubled down before making this guess. */
  wagered?: boolean;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'adaptive';

/** Who is sitting behind a lane in the race. */
export type RacerKind = 'you' | 'ai' | 'peer';

export interface Racer {
  id: string;
  name: string;
  kind: RacerKind;
  guesses: Guess[];
  /** ms since round start when this racer landed on the target, else null. */
  finishedAt: number | null;
  /** Burned their allowance under the Limited Guesses modifier. */
  eliminated?: boolean;
  /** Link dropped mid-round. They keep their place and their guesses. */
  offline?: boolean;
}

export type RaceStatus = 'idle' | 'running' | 'finished';

/** How a winner is decided. */
export type RaceMode = 'speed' | 'efficiency' | 'elimination' | 'sudden';

export interface RoundSummary {
  target: number;
  range: Range;
  racers: Racer[];
  winnerId: string | null;
  /** Fewest guesses possible for this range with perfect binary search. */
  parGuesses: number;
  mode: RaceMode;
  modifiers: string[];
}
