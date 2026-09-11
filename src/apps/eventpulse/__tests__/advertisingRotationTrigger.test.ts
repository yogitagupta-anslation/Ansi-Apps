/**
 * What makes the advertisement notice that the identity rotated.
 *
 * `advertisingUnchanged` — pinned next door in advertisingRotation.test.ts —
 * was never the broken half. It would have caught the rotation perfectly well
 * if anything had ever called it. Nothing did: the only periodic path to
 * `applyAdvertisingPlan` was gated behind `Platform.OS === 'ios'`, so on Android
 * the advertisement was re-evaluated on connection events and at nothing else.
 *
 * Measured on two emulators. 5554 started at 11:42:11 advertising E2867B1D and
 * was still advertising E2867B1D at 11:54, nine minutes past the 11:45:00 epoch
 * boundary. A force-restart at 11:54:42 immediately advertised B14BE3B2 — same
 * seed, same event, same device — which is what proves the identity had rotated
 * all along and only the radio had not been told.
 *
 * What this file pins is the BOUNDARY GUARD: the arithmetic that decides when
 * to re-evaluate. It models the ticker's guard rather than importing it —
 * services.ts is the composition root and pulls in expo-constants, which the
 * bare-node `eventpulse` project deliberately cannot transform — so it is
 * written against the SAME real `PeerIdentityService` the trigger calls, and
 * asserts the contract the trigger depends on. The trigger firing for real was
 * verified separately on-device; this is the part that can regress silently.
 */

import { DEFAULT_ROTATION_MS, PeerIdentityService } from '../bluetooth/BleIdentity';
import {
  advertisingUnchanged,
  type AdvertisingPlan,
  type AppliedAdvertising,
} from '../bluetooth/gatt/GattAdvertisingPolicy';

const identity = new PeerIdentityService();

const SEED = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const EVENT = 'techfest-2026';

const HOSTING: AdvertisingPlan = {
  presenceAdvertising: true,
  gattPeripheral: true,
  gattScanning: true,
  reason: 'presence and connections both live',
};

/**
 * The ticker's guard, exactly as it is written in services.ts.
 *
 * `nextRotationAt` starts at 0 so the first tick always arms it; thereafter it
 * holds a future boundary and the guard is one integer comparison.
 */
function makeTrigger(
  rotatesAt: (now: number) => number | null,
  linked: () => boolean = () => false,
) {
  let nextRotationAt = 0;
  return {
    /** True when this tick would re-apply the advertising plan. */
    tick(now: number): boolean {
      if (now < nextRotationAt) return false;
      const next = rotatesAt(now);
      if (next === null || linked()) return false;
      nextRotationAt = next;
      return true;
    },
    reset(): void {
      nextRotationAt = 0;
    },
    armedFor(): number {
      return nextRotationAt;
    },
  };
}

const rotatesAt = (now: number): number | null => identity.nextRotationAt(now);

/* ------------------------------------------------------------------ *
 * 1. It fires on the boundary, and only on the boundary
 * ------------------------------------------------------------------ */

describe('the boundary guard', () => {
  it('arms itself on the first tick', () => {
    // Nothing has been evaluated yet, so the first tick must not be skipped.
    const trigger = makeTrigger(rotatesAt);
    expect(trigger.tick(1_000_000)).toBe(true);
  });

  it('arms against a boundary that is strictly in the future', () => {
    const now = 1_000_000;
    const trigger = makeTrigger(rotatesAt);
    trigger.tick(now);
    expect(trigger.armedFor()).toBeGreaterThan(now);
  });

  it('does not fire again on the next second', () => {
    // The bug this guards against in the other direction: re-applying on every
    // tick tears the advertisement down and puts it back once a second.
    const trigger = makeTrigger(rotatesAt);
    const start = identity.epochStart(identity.epochAt(1_000_000)) + 1_000;
    trigger.tick(start);
    expect(trigger.tick(start + 1_000)).toBe(false);
  });

  it('stays quiet for the whole epoch', () => {
    const trigger = makeTrigger(rotatesAt);
    const start = identity.epochStart(identity.epochAt(5_000_000_000)) + 1;
    trigger.tick(start);

    let fired = 0;
    // One tick a second, all the way to just before the boundary.
    for (let t = start + 1_000; t < trigger.armedFor(); t += 1_000) {
      if (trigger.tick(t)) fired += 1;
    }
    expect(fired).toBe(0);
  });

  it('fires exactly once when the boundary arrives', () => {
    const trigger = makeTrigger(rotatesAt);
    const start = identity.epochStart(identity.epochAt(5_000_000_000)) + 1;
    trigger.tick(start);
    const boundary = trigger.armedFor();

    expect(trigger.tick(boundary)).toBe(true);
    expect(trigger.tick(boundary + 1_000)).toBe(false);
  });

  it('fires once per epoch across several epochs, never twice', () => {
    const trigger = makeTrigger(rotatesAt);
    // Start exactly on an epoch start so the boundaries land on tick marks.
    const start = identity.epochStart(identity.epochAt(5_000_000_000));

    let fired = 0;
    const boundaries: number[] = [];
    for (let t = start; t < start + DEFAULT_ROTATION_MS * 4; t += 1_000) {
      if (trigger.tick(t)) {
        fired += 1;
        boundaries.push(t);
      }
    }

    /*
     * The arming tick at `start`, then one per boundary crossed inside the
     * window: start+1, +2 and +3 epochs. The fourth boundary is the exclusive
     * end of the loop, so it is not reached. Anything more than this would be a
     * restart storm; anything less is a missed rotation.
     */
    expect(fired).toBe(4);
    expect(boundaries).toEqual([
      start,
      start + DEFAULT_ROTATION_MS,
      start + DEFAULT_ROTATION_MS * 2,
      start + DEFAULT_ROTATION_MS * 3,
    ]);
  });

  it('survives a tick that lands long after the boundary', () => {
    // A backgrounded app, a slow device: the guard must catch up, not wedge.
    const trigger = makeTrigger(rotatesAt);
    const start = identity.epochStart(identity.epochAt(5_000_000_000)) + 1;
    trigger.tick(start);

    expect(trigger.tick(start + DEFAULT_ROTATION_MS * 3)).toBe(true);
    expect(trigger.armedFor()).toBeGreaterThan(start + DEFAULT_ROTATION_MS * 3);
  });
});

/* ------------------------------------------------------------------ *
 * 2. No identity, no trigger
 * ------------------------------------------------------------------ */

describe('before there is an identity', () => {
  it('does not fire when there is no seed or membership', () => {
    // EventService.nextRotationAt returns null until both exist. Firing then
    // would re-apply a plan whose identity is null, for nothing.
    const trigger = makeTrigger(() => null);
    expect(trigger.tick(1_000_000)).toBe(false);
    expect(trigger.tick(1_000_000 + DEFAULT_ROTATION_MS)).toBe(false);
  });

  it('starts working the moment an identity appears', () => {
    let ready = false;
    const trigger = makeTrigger((now) => (ready ? identity.nextRotationAt(now) : null));

    expect(trigger.tick(1_000_000)).toBe(false);
    ready = true;
    expect(trigger.tick(1_001_000)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The identity really does change across the boundary
 * ------------------------------------------------------------------ */

describe('what the trigger is for', () => {
  it('the peer id differs either side of the boundary it fires on', () => {
    /*
     * The premise the whole fix rests on, asserted rather than assumed: this is
     * the E2867B1D -> B14BE3B2 step, reproduced arithmetically.
     */
    const trigger = makeTrigger(rotatesAt);
    const before = 5_000_000_000;
    trigger.tick(before);
    const boundary = trigger.armedFor();

    const idBefore = identity.currentPeerId(SEED, EVENT, before);
    const idAfter = identity.currentPeerId(SEED, EVENT, boundary);

    expect(idAfter).not.toBe(idBefore);
    expect(trigger.tick(boundary)).toBe(true);
  });

  it('the plan alone cannot see that change, which is why identity is compared', () => {
    const before = 5_000_000_000;
    const boundary = identity.nextRotationAt(before);

    const applied = (at: number): AppliedAdvertising => ({
      plan: HOSTING,
      identity: identity.currentPeerId(SEED, EVENT, at),
    });

    // Same three booleans, different id: unchanged must say false.
    expect(advertisingUnchanged(applied(before), applied(boundary))).toBe(false);
  });

  it('a re-apply within one epoch is correctly refused', () => {
    // The trigger and the comparison have to agree, or one of them is noise.
    const at = 5_000_000_000;
    const applied = (t: number): AppliedAdvertising => ({
      plan: HOSTING,
      identity: identity.currentPeerId(SEED, EVENT, t),
    });

    expect(advertisingUnchanged(applied(at), applied(at + 60_000))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Not while anyone is connected
 * ------------------------------------------------------------------ */

describe('a live link defers the rotation', () => {
  /*
   * Measured, and the reason this guard exists at all. Re-advertising rebuilds
   * the GATT server: the ACL link survives, so both phones still read
   * "connected", but the subscribed central is unregistered underneath and
   * every later notify reports accepted=true while reaching nobody. The
   * peripheral-to-central direction went silent at 12:45:00 and stayed silent,
   * with no error on either side.
   */

  it('does not re-advertise while a session is up', () => {
    const trigger = makeTrigger(rotatesAt, () => true);
    const start = identity.epochStart(identity.epochAt(5_000_000_000));

    expect(trigger.tick(start)).toBe(false);
    expect(trigger.tick(start + DEFAULT_ROTATION_MS)).toBe(false);
  });

  it('re-advertises as soon as the last link goes away', () => {
    let connected = true;
    const trigger = makeTrigger(rotatesAt, () => connected);
    const start = identity.epochStart(identity.epochAt(5_000_000_000));

    expect(trigger.tick(start + DEFAULT_ROTATION_MS)).toBe(false);
    connected = false;
    expect(trigger.tick(start + DEFAULT_ROTATION_MS + 1_000)).toBe(true);
  });

  it('does not lose the boundary it was waiting on', () => {
    /*
     * The deadline is deliberately NOT advanced while deferring, so a rotation
     * that waits out a long conversation still fires the moment it can rather
     * than being skipped to the following epoch.
     */
    let connected = true;
    const trigger = makeTrigger(rotatesAt, () => connected);
    const start = identity.epochStart(identity.epochAt(5_000_000_000));
    trigger.tick(start - DEFAULT_ROTATION_MS);

    let fired = 0;
    for (let t = start; t < start + DEFAULT_ROTATION_MS; t += 1_000) {
      if (trigger.tick(t)) fired += 1;
    }
    expect(fired).toBe(0);

    connected = false;
    expect(trigger.tick(start + DEFAULT_ROTATION_MS)).toBe(true);
  });

  it('still fires exactly once when the link ends mid-epoch', () => {
    let connected = true;
    const trigger = makeTrigger(rotatesAt, () => connected);
    const start = identity.epochStart(identity.epochAt(5_000_000_000));
    trigger.tick(start - DEFAULT_ROTATION_MS);

    connected = false;
    let fired = 0;
    for (let t = start; t < start + 60_000; t += 1_000) {
      if (trigger.tick(t)) fired += 1;
    }
    expect(fired).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Lifecycle
 * ------------------------------------------------------------------ */

describe('channel lifecycle', () => {
  it('re-arms from scratch after the channel stops', () => {
    /*
     * stopConnectionChannel resets the deadline to 0 alongside `lastApplied`.
     * Without that, a channel restarted inside the same epoch would keep the
     * old deadline and skip its first evaluation.
     */
    const trigger = makeTrigger(rotatesAt);
    const start = 5_000_000_000;
    trigger.tick(start);
    expect(trigger.tick(start + 1_000)).toBe(false);

    trigger.reset();
    expect(trigger.armedFor()).toBe(0);
    expect(trigger.tick(start + 2_000)).toBe(true);
  });

  it('needs no timer of its own', () => {
    /*
     * The guard is a pure comparison against `now`, which is what lets it live
     * inside the 1s ticker that already exists and already has exactly one
     * cleanup path. A second interval would be a second thing to leak.
     */
    const trigger = makeTrigger(rotatesAt);
    expect(typeof trigger.tick).toBe('function');
    expect(trigger.tick(5_000_000_000)).toBe(true);
  });
});
