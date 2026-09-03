import {SEEN_CACHE_SIZE} from '../config/constants';

/**
 * Remembers packet ids we have already processed.
 *
 * Phase 1 only has direct A<->B links so duplicates are rare (a BLE-level retransmit,
 * or both roles delivering the same packet during a link race). It exists now because
 * once relaying lands, A -> B -> C and A -> C -> B deliver the same packet twice and
 * without this the message appears twice and is forwarded forever.
 */
export class SeenMessageStore {
  private set = new Set<string>();
  private order: string[] = [];

  constructor(private readonly capacity: number = SEEN_CACHE_SIZE) {}

  /** True if this id had NOT been seen before (and is now recorded). */
  markIfNew(id: string): boolean {
    if (this.set.has(id)) {
      return false;
    }
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.splice(0, this.order.length - this.capacity);
      for (const e of evicted) {
        this.set.delete(e);
      }
    }
    return true;
  }

  has(id: string): boolean {
    return this.set.has(id);
  }

  get size(): number {
    return this.set.size;
  }

  /** Restore ids persisted from a previous run. */
  hydrate(ids: string[]): void {
    for (const id of ids) {
      this.markIfNew(id);
    }
  }

  snapshot(): string[] {
    return [...this.order];
  }

  clear(): void {
    this.set.clear();
    this.order = [];
  }
}
