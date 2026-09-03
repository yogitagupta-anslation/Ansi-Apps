import { Guess, Racer, RacerKind, RaceMode, RaceStatus, Range, RoundSummary } from '../types/game';
import { heatFor, isValidGuess, judge, knownRange, parGuesses, rangeSize } from './engine';
import { eliminatedBy, idealElimination } from './search';
import { NO_MODIFIERS, RoundRules } from './modifiers';
import { winnerFor } from './scoring';

/**
 * One shared reducer drives both the Solo (you vs AI) and Multiplayer (you vs
 * BLE peers) rounds. Solo feeds it guesses from a timer; multiplayer feeds it
 * guesses arriving over BLE. The rules live in exactly one place either way.
 */
export interface RaceState {
  status: RaceStatus;
  range: Range;
  target: number;
  /** Epoch ms the round began; guess timestamps are relative to it. */
  startedAt: number;
  racers: Racer[];
  /** First racer to land on the number. The mode decides who actually wins. */
  winnerId: string | null;
  rules: RoundRules;
  mode: RaceMode;
}

export interface RacerSeed {
  id: string;
  name: string;
  kind: RacerKind;
}

export type RaceAction =
  | {
      type: 'start';
      range: Range;
      target: number;
      racers: RacerSeed[];
      now: number;
      rules?: RoundRules;
      mode?: RaceMode;
    }
  | {
      type: 'guess';
      racerId: string;
      value: number;
      now: number;
      /** Player staked this guess under Risk / Double Down. */
      wagered?: boolean;
      /** 0–1, used to move the target under the Moving Target modifier. */
      roll?: number;
    }
  | { type: 'removeRacer'; racerId: string }
  /**
   * A racer reported finishing. Used for peers whose winning guess did not make
   * it across the link, so the board still shows when they got there.
   */
  | { type: 'finished'; racerId: string; at: number }
  /**
   * Close the round now: the host called it, or the player stopped waiting on a
   * straggler. Whoever has not finished is left unfinished.
   */
  | { type: 'end' }
  /** A peer's link dropped or recovered. Their progress is untouched. */
  | { type: 'connection'; racerId: string; online: boolean }
  | { type: 'reset' };

export const emptyRace: RaceState = {
  status: 'idle',
  range: { min: 1, max: 100 },
  target: 0,
  startedAt: 0,
  racers: [],
  winnerId: null,
  rules: NO_MODIFIERS,
  mode: 'speed',
};

function seedRacer(seed: RacerSeed): Racer {
  return { ...seed, guesses: [], finishedAt: null };
}

/** Done means finished or knocked out — either way they take no more turns. */
function settled(racer: Racer): boolean {
  return racer.finishedAt !== null || racer.eliminated === true;
}

export function raceReducer(state: RaceState, action: RaceAction): RaceState {
  switch (action.type) {
    case 'start':
      return {
        status: 'running',
        range: action.range,
        target: action.target,
        startedAt: action.now,
        racers: action.racers.map(seedRacer),
        winnerId: null,
        rules: action.rules ?? NO_MODIFIERS,
        mode: action.mode ?? 'speed',
      };

    case 'guess': {
      if (state.status !== 'running') return state;
      if (!isValidGuess(action.value, state.range)) return state;

      const racer = state.racers.find((r) => r.id === action.racerId);
      if (!racer || settled(racer)) return state;

      // Impact is measured against what was still possible *before* this guess.
      const known = knownRange(state.range, racer.guesses);
      const verdict = judge(action.value, state.target);
      const at = Math.max(0, action.now - state.startedAt);

      const guess: Guess = {
        value: action.value,
        verdict,
        at,
        eliminated: eliminatedBy(known, action.value, verdict),
        ideal: idealElimination(known),
        ...(state.rules.heat ? { heat: heatFor(action.value, state.target, state.range) } : {}),
        ...(action.wagered ? { wagered: true } : {}),
      };

      const guesses = [...racer.guesses, guess];
      const limit = state.rules.guessLimit;
      const outOfGuesses = verdict !== 'correct' && limit !== null && guesses.length >= limit;

      const updated: Racer = {
        ...racer,
        guesses,
        finishedAt: verdict === 'correct' ? at : null,
        ...(outOfGuesses ? { eliminated: true } : {}),
      };

      // Moving Target: the number hops, but only to somewhere that keeps every
      // answer it has already given true.
      let target = state.target;
      const movesEvery = state.rules.movesEvery;
      if (movesEvery && verdict !== 'correct' && guesses.length % movesEvery === 0) {
        const room = knownRange(state.range, guesses);
        const roll = action.roll ?? Math.random();
        target = room.min + Math.floor(roll * rangeSize(room));
      }

      // The first correct guess wins, but it does not stop anyone else: every
      // racer plays their own round out, and the board closes when the last one
      // is done.
      const winnerId = verdict === 'correct' && !state.winnerId ? racer.id : state.winnerId;
      const racers = state.racers.map((r) => (r.id === racer.id ? updated : r));

      return {
        ...state,
        target,
        racers,
        winnerId,
        status: racers.every(settled) ? 'finished' : state.status,
      };
    }

    case 'removeRacer':
      return { ...state, racers: state.racers.filter((r) => r.id !== action.racerId) };

    case 'finished': {
      if (state.status !== 'running') return state;
      const racer = state.racers.find((r) => r.id === action.racerId);
      if (!racer || settled(racer)) return state;

      const racers = state.racers.map((r) => (r.id === racer.id ? { ...r, finishedAt: action.at } : r));
      return {
        ...state,
        racers,
        winnerId: state.winnerId ?? racer.id,
        status: racers.every(settled) ? 'finished' : state.status,
      };
    }

    case 'connection':
      return {
        ...state,
        racers: state.racers.map((r) =>
          r.id === action.racerId ? { ...r, offline: !action.online } : r,
        ),
      };

    case 'end':
      return state.status === 'idle' ? state : { ...state, status: 'finished' };

    case 'reset':
      return emptyRace;

    default:
      return state;
  }
}

export function summarize(state: RaceState): RoundSummary {
  const base: RoundSummary = {
    target: state.target,
    range: state.range,
    racers: state.racers,
    winnerId: state.winnerId,
    parGuesses: parGuesses(state.range),
    mode: state.mode,
    modifiers: state.rules.modifiers,
  };
  // Speed hands it to the first finisher; the other modes only know once the
  // whole board is in.
  return { ...base, winnerId: winnerFor(base) ?? state.winnerId };
}
