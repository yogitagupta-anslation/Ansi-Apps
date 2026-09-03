import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Difficulty, Racer, Range } from '../types/game';
import { AI_PROFILES, createAi, readOpponent } from './ai';
import { makeTarget } from './engine';
import { ModifierId, resolveRules } from './modifiers';
import { emptyRace, raceReducer } from './raceState';
import { feedback } from '../util/feedback';

const YOU_ID = 'you';
const AI_ID = 'ai';

/**
 * Solo mode: you and one bot race for the same hidden number, in real time.
 *
 * The bot is not turn-based -- it guesses on its own clock, so a slow player
 * loses to a fast bot even if their guesses are smarter. That is the same shape
 * as the multiplayer race, just with a local opponent instead of a BLE one.
 *
 * Whoever gets there first wins, but neither side is cut off: the round stays
 * open until both have found the number, so there is always a time for each.
 */
export interface SoloRaceOptions {
  range: Range;
  difficulty: Difficulty;
  playerName: string;
  modifiers: ModifierId[];
  /** Set by the daily challenge, where the number is fixed for everyone. */
  fixedTarget?: number;
}

export function useSoloRace({ range, difficulty, playerName, modifiers, fixedTarget }: SoloRaceOptions) {
  const [race, dispatch] = useReducer(raceReducer, emptyRace);
  const brain = useRef(createAi(difficulty));
  const rules = useMemo(() => resolveRules(range, modifiers), [range, modifiers]);

  useEffect(() => {
    brain.current = createAi(difficulty);
  }, [difficulty]);

  const start = useCallback(() => {
    dispatch({
      type: 'start',
      range,
      target: fixedTarget ?? makeTarget(range),
      now: Date.now(),
      rules,
      mode: 'speed',
      racers: [
        { id: YOU_ID, name: playerName, kind: 'you' },
        { id: AI_ID, name: AI_PROFILES[difficulty].name, kind: 'ai' },
      ],
    });
  }, [difficulty, playerName, range, rules, fixedTarget]);

  const guess = useCallback((value: number, wagered?: boolean) => {
    dispatch({ type: 'guess', racerId: YOU_ID, value, now: Date.now(), wagered, roll: Math.random() });
  }, []);

  /** Stop waiting for the bot to finish and close the round early. */
  const end = useCallback(() => dispatch({ type: 'end' }), []);

  const you = useMemo(() => race.racers.find((r) => r.id === YOU_ID), [race.racers]);
  const ai = race.racers.find((r) => r.id === AI_ID);

  // The adaptive bot reads your play as it goes. Keeping that behind a ref means
  // your guesses do not re-run the effect below and reset its think timer.
  const youRef = useRef<Racer | undefined>(undefined);
  youRef.current = you;

  const settled = (r: Racer) => r.finishedAt !== null || r.eliminated === true;

  // Schedules the bot's next guess. `ai` only gets a new identity when the bot
  // itself guesses, so your guesses never reset its think timer.
  useEffect(() => {
    if (race.status !== 'running' || !ai || settled(ai)) return;
    const delay = brain.current.thinkMs(readOpponent(youRef.current?.guesses ?? []));
    const timer = setTimeout(() => {
      const read = readOpponent(youRef.current?.guesses ?? []);
      dispatch({
        type: 'guess',
        racerId: AI_ID,
        value: brain.current.nextGuess(race.range, ai.guesses, read),
        now: Date.now(),
        roll: Math.random(),
      });
      // Same quiet tick a relayed BLE guess makes, so both modes sound alike.
      feedback.peerGuess();
    }, delay);
    return () => clearTimeout(timer);
  }, [race.status, race.range, ai]);

  const aiQuip = ai && !settled(ai) ? brain.current.quip(ai.guesses.length) : null;

  return { race, you, opponent: ai, aiQuip, start, guess, end, youId: YOU_ID };
}
