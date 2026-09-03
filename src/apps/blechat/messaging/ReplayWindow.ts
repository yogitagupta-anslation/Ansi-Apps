import {REPLAY_MAX_SENDERS, REPLAY_WINDOW_SIZE} from '../config/constants';

/**
 * Sliding-window replay protection, per sender.
 *
 * Deduplicating on packet id alone was not enough: the seen-id cache is a bounded LRU, so
 * an attacker could capture a packet, wait for its id to be evicted, and resend it — the
 * message would be accepted a second time as new.
 *
 * A monotonic per-sender counter removes the time dependency entirely. Anything at or
 * below `highest - WINDOW` is unconditionally old, regardless of how long ago it was
 * seen, so a replay can never become fresh again by waiting.
 *
 *        highest-WINDOW        highest
 *   ──────────┼──────────────────┼────────▶ seq
 *    rejected │  checked against │  accepted, advances the window
 *   (too old) │   recent set     │
 *
 * The window exists because BLE delivery is not perfectly ordered — a slightly late
 * packet must still be accepted once, just not twice. This is the same construction
 * IPsec and WireGuard use, for the same reason.
 */

export type ReplayVerdict =
  | {ok: true}
  | {ok: false; reason: 'replayed' | 'too-old' | 'invalid'};

interface SenderState {
  highest: number;
  /** Sequence numbers seen within the window below `highest`. */
  recent: Set<number>;
  /**
   * Everything at or below this is treated as already seen, whether or not `recent`
   * still remembers it.
   *
   * Normally zero, because `highest - windowSize` already covers it. It is raised on
   * hydration: a restored high-water mark says a peer got this far, but the individual
   * numbers below it are gone, so consulting an empty `recent` set would wave through a
   * replay of anything in the top window — which is exactly what persisting the mark was
   * supposed to prevent.
   */
  floor: number;
  lastUsed: number;
}

export class ReplayWindow {
  private senders = new Map<string, SenderState>();

  constructor(
    private readonly windowSize: number = REPLAY_WINDOW_SIZE,
    private readonly maxSenders: number = REPLAY_MAX_SENDERS,
  ) {}

  /**
   * Record a sequence number, and say whether it is acceptable.
   *
   * Calling this twice with the same value is the definition of a replay, so it must be
   * called exactly once per inbound packet, at the point the packet is committed.
   */
  accept(senderId: string, seq: number, now = Date.now()): ReplayVerdict {
    if (!Number.isInteger(seq) || seq <= 0) {
      return {ok: false, reason: 'invalid'};
    }

    let state = this.senders.get(senderId);
    if (!state) {
      this.evictIfFull();
      state = {highest: 0, recent: new Set(), floor: 0, lastUsed: now};
      this.senders.set(senderId, state);
    }
    state.lastUsed = now;

    if (seq > state.highest) {
      state.highest = seq;
      state.recent.add(seq);
      // Anything that has fallen out of the window is covered by the `too-old` rule and
      // no longer needs to be remembered individually.
      const floor = seq - this.windowSize;
      for (const value of state.recent) {
        if (value <= floor) {
          state.recent.delete(value);
        }
      }
      return {ok: true};
    }

    // A packet from before a restart is dropped rather than risked. Losing a genuinely
    // late message across a relaunch is a far better outcome than accepting a replayed
    // one, and the sender's ACK timeout already handles the former.
    if (seq <= Math.max(state.floor, state.highest - this.windowSize)) {
      return {ok: false, reason: 'too-old'};
    }

    if (state.recent.has(seq)) {
      return {ok: false, reason: 'replayed'};
    }

    // Late but inside the window: legitimate reordering, accepted exactly once.
    state.recent.add(seq);
    return {ok: true};
  }

  private evictIfFull(): void {
    if (this.senders.size < this.maxSenders) {
      return;
    }
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, state] of this.senders) {
      if (state.lastUsed < oldestAt) {
        oldestAt = state.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId !== null) {
      this.senders.delete(oldestId);
    }
  }

  highestFor(senderId: string): number {
    return this.senders.get(senderId)?.highest ?? 0;
  }

  get trackedSenders(): number {
    return this.senders.size;
  }

  /**
   * Persisted so a restart does not reset the window.
   *
   * Without this, an attacker could replay a captured packet after the app relaunches:
   * the counter would be back at zero and the packet would look brand new. Only the
   * high-water mark is kept — the in-window set is small and rebuilds naturally.
   */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, state] of this.senders) {
      out[id] = state.highest;
    }
    return out;
  }

  hydrate(saved: Record<string, number>, now = Date.now()): void {
    for (const [id, highest] of Object.entries(saved ?? {})) {
      if (typeof highest === 'number' && Number.isInteger(highest) && highest > 0) {
        this.senders.set(id, {
          highest,
          recent: new Set(),
          // Nothing at or below the restored mark may be accepted again.
          floor: highest,
          lastUsed: now,
        });
      }
    }
  }

  clear(): void {
    this.senders.clear();
  }
}

/**
 * Our own outbound counter.
 *
 * Must never go backwards across a restart, or our peers' replay windows would reject
 * our messages as old. Persisted after every increment.
 */
export class SequenceCounter {
  private value = 0;

  constructor(start = 0) {
    this.value = Math.max(0, Math.floor(start));
  }

  next(): number {
    this.value += 1;
    return this.value;
  }

  get current(): number {
    return this.value;
  }

  /**
   * Move the counter forward to a persisted high-water mark. Never backwards — going
   * back would re-issue numbers our peers have already filed as seen.
   */
  raiseTo(value: number): void {
    if (Number.isFinite(value) && value > this.value) {
      this.value = Math.floor(value);
    }
  }
}
