/**
 * Deterministic pseudo-random number generation.
 *
 * The world is generated from a seed so that the host can ship four bytes over
 * BLE instead of a few kilobytes of geometry, and every device rebuilds a
 * byte-identical world. That only works if the generator is exactly
 * reproducible, which rules out Math.random().
 *
 * mulberry32 is a small, fast, well-distributed 32-bit generator. It is not
 * cryptographically secure and does not need to be.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniformly pick one element; throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
  /** Current internal state -- lets a caller fork or resume a stream. */
  getState(): number;
}

export function createRng(seed: number): Rng {
  // Force to uint32 so callers can pass any integer.
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const int = (min: number, max: number): number => {
    if (max < min) {
      throw new RangeError(`int(${min}, ${max}): max must be >= min`);
    }
    return Math.floor(min + next() * (max - min + 1));
  };

  const chance = (probability: number): boolean => next() < probability;

  const pick = <T,>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError('pick() called with an empty array');
    }
    return items[int(0, items.length - 1)] as T;
  };

  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  };

  return {next, float, int, chance, pick, shuffle, getState: () => state};
}

/**
 * A seed suitable for showing to a human: six digits, never zero.
 * Uses Math.random deliberately -- this is the one place unpredictability is
 * wanted, since it decides what world the next match gets.
 */
export function generateSeed(): number {
  return Math.floor(Math.random() * 900000) + 100000;
}

/** A four-digit lobby code players type in, e.g. "4821". */
export function generateGameCode(): string {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

/**
 * Derive an independent sub-stream from a base seed. Used so that, for example,
 * changing the number of coins does not shift obstacle placement: each
 * generation pass draws from its own stream.
 */
export function deriveSeed(baseSeed: number, salt: string): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}
