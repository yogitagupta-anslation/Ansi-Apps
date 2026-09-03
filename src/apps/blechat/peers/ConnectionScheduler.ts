import type {LinkId} from '../types/BLE';
import type {LinkFailureReason} from '../types/BLE';
import {
  LINK_BUDGET_DEFAULT,
  LINK_DIAL_PARALLELISM,
  LINK_MIN_HOLD_MS,
} from '../config/constants';
import {logger} from '../utils/logger';

const TAG = 'Scheduler';

/**
 * Decides who to be connected to, and when.
 *
 * Holding many BLE links at once is not simply a matter of calling connect ten times.
 * Two things get in the way, and both are properties of the radio rather than of this
 * app:
 *
 *  1. **A controller can only hold so many links.** The exact number is a property of the
 *     chipset and the Android build — commonly around seven, sometimes fewer, and shared
 *     with whatever else the phone has connected. There is no API that reports it, so the
 *     only honest way to find it is to try and to believe the answer.
 *
 *  2. **Concurrent connect attempts fail.** Issuing several `connectGatt` calls at once
 *     is one of the most reliable ways to produce status 133. Dials are therefore
 *     serialised, which makes bringing up ten links slower but far more likely to finish.
 *
 * So this is a scheduler, not a for-loop: a bounded set of held links, a queue of peers
 * waiting for a slot, serialised dialling, and rotation so that a peer which cannot get a
 * slot right now still gets served eventually.
 */

export interface SchedulerHooks {
  connect(linkId: LinkId): Promise<void>;
  disconnect(linkId: LinkId): Promise<void>;
  /** Injected so tests can control time instead of waiting for it. */
  now(): number;
}

export interface SchedulerOptions {
  /** What the user asked for. The radio may not agree, and gets the final say. */
  maxLinks?: number;
  maxParallelDials?: number;
  /** Minimum time a link is held before rotation may reclaim its slot. */
  minHoldMs?: number;
  hooks: SchedulerHooks;
  onChange?: () => void;
}

export interface SchedulerSnapshot {
  /** What the user asked for. */
  requestedBudget: number;
  /** What we will actually attempt, after any refusal the radio has taught us. */
  effectiveBudget: number;
  /** True once the radio has refused a link and we lowered the budget to match. */
  budgetLearned: boolean;
  held: LinkId[];
  dialling: LinkId[];
  waiting: LinkId[];
}

export class ConnectionScheduler {
  /** Peers we would like to be connected to. */
  private wanted = new Set<LinkId>();
  /** Links currently up, with when they came up (for rotation fairness). */
  private held = new Map<LinkId, number>();
  private dialling = new Set<LinkId>();
  /** When each link was last connected, so rotation can serve the longest-waiting. */
  private lastServed = new Map<LinkId, number>();
  /**
   * When each link was last DIALLED, successfully or not.
   *
   * Without this a peer that always fails is picked again the instant it fails — it has
   * still never been served, so it still sorts first — and it holds the dialler forever
   * while everybody behind it starves.
   */
  private lastAttempt = new Map<LinkId, number>();

  private requested: number;
  private effective: number;
  private learned = false;

  private readonly maxParallelDials: number;
  private readonly minHoldMs: number;
  private readonly hooks: SchedulerHooks;
  private readonly onChange: (() => void) | null;

  constructor(options: SchedulerOptions) {
    this.requested = Math.max(1, options.maxLinks ?? LINK_BUDGET_DEFAULT);
    this.effective = this.requested;
    this.maxParallelDials = Math.max(
      1,
      options.maxParallelDials ?? LINK_DIAL_PARALLELISM,
    );
    this.minHoldMs = options.minHoldMs ?? LINK_MIN_HOLD_MS;
    this.hooks = options.hooks;
    this.onChange = options.onChange ?? null;
  }

  // ---- what the user wants ----------------------------------------------

  /** Ask for a link to this peer. Idempotent. */
  want(linkId: LinkId): void {
    if (this.wanted.has(linkId)) {
      return;
    }
    this.wanted.add(linkId);
    this.changed();
    this.pump();
  }

  /** Stop wanting a link, and drop it if it is up. */
  unwant(linkId: LinkId): void {
    if (!this.wanted.delete(linkId)) {
      return;
    }
    if (this.held.has(linkId)) {
      void this.release(linkId);
    }
    this.changed();
    this.pump();
  }

  /**
   * Raise or lower what the user asked for.
   *
   * Raising it also clears anything the radio taught us: the ceiling may genuinely have
   * changed — another app released its links, or the user turned Bluetooth off and on —
   * and refusing to try again would leave us permanently pessimistic.
   */
  setBudget(maxLinks: number): void {
    const next = Math.max(1, Math.floor(maxLinks));
    if (next === this.requested) {
      return;
    }
    this.requested = next;
    this.effective = next;
    this.learned = false;
    this.changed();
    this.pump();
  }

  // ---- what actually happened -------------------------------------------

  onConnected(linkId: LinkId): void {
    this.dialling.delete(linkId);
    if (!this.held.has(linkId)) {
      this.held.set(linkId, this.hooks.now());
    }
    this.lastServed.set(linkId, this.hooks.now());
    this.changed();
    this.pump();
  }

  onDisconnected(linkId: LinkId): void {
    this.dialling.delete(linkId);
    this.held.delete(linkId);
    this.changed();
    this.pump();
  }

  /**
   * A dial failed. Decide whether the radio was telling us it is full.
   *
   * This is a heuristic and is treated as one. There is no error code for "too many
   * connections" — Android reports it the same way it reports half a dozen unrelated
   * problems. What makes it believable is the context: we were already holding several
   * links, and the failure is one of the vague ones. A failure on the FIRST dial is never
   * read as a capacity limit, because clamping the budget to zero on one bad connect
   * would break the app for everybody.
   */
  onDialFailed(linkId: LinkId, reason: LinkFailureReason): void {
    this.dialling.delete(linkId);

    const looksLikeCapacity =
      reason === 'AndroidGattError' || reason === 'ConnectionRefused';

    if (looksLikeCapacity && this.held.size >= 2 && this.held.size < this.effective) {
      this.effective = this.held.size;
      this.learned = true;
      logger.warn(
        TAG,
        `radio refused a link while holding ${this.held.size}; ` +
          `lowering the budget from ${this.requested} to ${this.effective}`,
      );
    }
    this.changed();
    this.pump();
  }

  // ---- scheduling --------------------------------------------------------

  /** Start as many dials as the budget and the parallelism allow. */
  pump(): void {
    while (
      this.dialling.size < this.maxParallelDials &&
      this.held.size + this.dialling.size < this.effective
    ) {
      const next = this.nextToDial();
      if (!next) {
        return;
      }
      this.dialling.add(next);
      this.lastAttempt.set(next, this.hooks.now());
      this.changed();

      // Failures come back through onDialFailed via the owner, which knows the typed
      // reason. This catch only stops an unhandled rejection.
      this.hooks.connect(next).catch(() => {
        this.dialling.delete(next);
        this.changed();
      });
    }
  }

  /**
   * The peer that has been waiting longest.
   *
   * Least-recently-served rather than first-come: with more peers than slots, arrival
   * order would let whoever showed up first hold a slot forever while somebody who
   * connected once at the start never got another turn.
   */
  private nextToDial(): LinkId | null {
    let best: LinkId | null = null;
    let bestTouched = Infinity;
    for (const linkId of this.wanted) {
      if (this.held.has(linkId) || this.dialling.has(linkId)) {
        continue;
      }
      // Ranked by whichever happened later, a success or an attempt. A peer we just
      // failed to reach goes to the back rather than being retried immediately.
      const touched = Math.max(
        this.lastServed.get(linkId) ?? 0,
        this.lastAttempt.get(linkId) ?? 0,
      );
      if (touched < bestTouched) {
        bestTouched = touched;
        best = linkId;
      }
    }
    return best;
  }

  /**
   * Give a waiting peer a turn by dropping the longest-held link.
   *
   * Only worth doing when there is genuinely somebody waiting and the held link has been
   * up long enough to have been useful — otherwise this degenerates into cycling links
   * so fast that nothing completes a handshake, which is worse than serving fewer peers.
   *
   * Returns the link that was dropped, or null when nothing was rotated.
   */
  rotate(): LinkId | null {
    if (this.waiting().length === 0) {
      return null;
    }
    if (this.held.size + this.dialling.size < this.effective) {
      // There is a free slot; no need to take one from anybody.
      this.pump();
      return null;
    }

    const now = this.hooks.now();
    let victim: LinkId | null = null;
    let oldest = Infinity;
    for (const [linkId, since] of this.held) {
      if (now - since < this.minHoldMs) {
        continue;
      }
      if (since < oldest) {
        oldest = since;
        victim = linkId;
      }
    }
    if (!victim) {
      return null;
    }

    logger.info(TAG, `rotating ${victim} out to free a slot`);
    void this.release(victim);
    return victim;
  }

  /**
   * Drop a link without forgetting we want it.
   *
   * The distinction matters for rotation: the peer stays in the wanted set and goes to
   * the back of the queue, so it is dialled again when a slot next frees up.
   */
  private async release(linkId: LinkId): Promise<void> {
    this.held.delete(linkId);
    this.changed();
    try {
      await this.hooks.disconnect(linkId);
    } catch (err) {
      logger.warn(TAG, `releasing ${linkId} failed: ${String(err)}`);
    }
    this.pump();
  }

  // ---- inspection --------------------------------------------------------

  /** Wanted, but neither held nor being dialled right now. */
  waiting(): LinkId[] {
    return Array.from(this.wanted).filter(
      id => !this.held.has(id) && !this.dialling.has(id),
    );
  }

  get heldCount(): number {
    return this.held.size;
  }

  get effectiveBudget(): number {
    return this.effective;
  }

  get requestedBudget(): number {
    return this.requested;
  }

  get budgetLearned(): boolean {
    return this.learned;
  }

  snapshot(): SchedulerSnapshot {
    return {
      requestedBudget: this.requested,
      effectiveBudget: this.effective,
      budgetLearned: this.learned,
      held: Array.from(this.held.keys()),
      dialling: Array.from(this.dialling),
      waiting: this.waiting(),
    };
  }

  clear(): void {
    this.wanted.clear();
    this.held.clear();
    this.dialling.clear();
    this.lastServed.clear();
    this.lastAttempt.clear();
    this.changed();
  }

  private changed(): void {
    this.onChange?.();
  }
}
