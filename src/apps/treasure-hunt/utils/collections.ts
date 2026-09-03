/**
 * Small collection helpers used by the reliability layer and the game engine.
 */

/**
 * Fixed-capacity set that evicts the oldest entry once full.
 * Backs duplicate-message suppression: remembering every id a peer ever sent
 * would leak memory across a long match.
 */
export class LruSet<T> {
  private readonly items = new Set<T>();

  constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new RangeError('LruSet capacity must be >= 1');
    }
  }

  /** Adds a value. Returns true when it was already present. */
  addAndCheck(value: T): boolean {
    if (this.items.has(value)) {
      // Refresh recency so hot ids are not evicted first.
      this.items.delete(value);
      this.items.add(value);
      return true;
    }
    this.items.add(value);
    if (this.items.size > this.capacity) {
      const oldest = this.items.values().next();
      if (!oldest.done) {
        this.items.delete(oldest.value);
      }
    }
    return false;
  }

  has(value: T): boolean {
    return this.items.has(value);
  }

  clear(): void {
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

export function groupBy<T, K extends string>(
  items: readonly T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (out[key] ??= []).push(item);
  }
  return out;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    total += v;
  }
  return total;
}

/** Stable sort that leaves the input untouched. */
export function sorted<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items.slice().sort(compare);
}

export function unique<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}
