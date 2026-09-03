import { Range } from '../types/game';
import { ModifierId } from './modifiers';
import { parGuesses } from './engine';

/**
 * One challenge a day, identical on every phone, with no backend: the date is
 * the seed. Same range, same modifiers, same hidden number for everybody —
 * which is what makes "what did you get?" worth asking.
 */
export function dailyKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** FNV-1a: small, fast, and stable across platforms. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG so the same key always deals the same round. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAILY_RANGES: { label: string; range: Range }[] = [
  { label: 'Quick', range: { min: 1, max: 20 } },
  { label: 'Classic', range: { min: 1, max: 100 } },
  { label: 'Classic', range: { min: 1, max: 100 } },
  { label: 'Hard', range: { min: 1, max: 1000 } },
  { label: 'Insane', range: { min: 1, max: 10000 } },
];

/** Solo-safe modifiers only — the daily is a single-player run. */
const DAILY_MODIFIERS: ModifierId[] = ['blind', 'heat', 'limited', 'moving', 'risk'];

export interface DailyChallenge {
  key: string;
  range: Range;
  target: number;
  modifiers: ModifierId[];
  rangeLabel: string;
  par: number;
}

export function dailyChallenge(key: string = dailyKey()): DailyChallenge {
  const rand = mulberry32(hash(key));

  const pick = DAILY_RANGES[Math.floor(rand() * DAILY_RANGES.length)];
  const size = pick.range.max - pick.range.min + 1;
  const target = pick.range.min + Math.floor(rand() * size);

  // Most days get one twist, some get two, a few get none.
  const roll = rand();
  const count = roll < 0.2 ? 0 : roll < 0.8 ? 1 : 2;
  const pool = [...DAILY_MODIFIERS];
  const modifiers: ModifierId[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    modifiers.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }

  return {
    key,
    range: pick.range,
    target,
    modifiers,
    rangeLabel: pick.label,
    par: parGuesses(pick.range),
  };
}
