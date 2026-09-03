/**
 * Holding many links at once.
 *
 * The hard parts are not "call connect N times". They are: a controller ceiling nothing
 * reports, concurrent dials that fail because they are concurrent, and more peers than
 * slots. These pin the policy that deals with all three.
 */
import {ConnectionScheduler} from '../peers/ConnectionScheduler';
import {
  LINK_BUDGET_DEFAULT,
  LINK_DIAL_PARALLELISM,
} from '../config/constants';

/** A radio stand-in: records dials, and only completes them when told to. */
function harness(options: {maxLinks?: number; minHoldMs?: number} = {}) {
  const dialled: string[] = [];
  const dropped: string[] = [];
  let clock = 1000;

  const scheduler = new ConnectionScheduler({
    maxLinks: options.maxLinks,
    minHoldMs: options.minHoldMs,
    hooks: {
      connect: async linkId => {
        dialled.push(linkId);
      },
      disconnect: async linkId => {
        dropped.push(linkId);
      },
      now: () => clock,
    },
  });

  return {
    scheduler,
    dialled,
    dropped,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Complete the dial that is currently in flight. */
    settle: (linkId: string) => scheduler.onConnected(linkId),
  };
}

describe('dialling is serialised', () => {
  it('starts only one connect at a time', () => {
    const h = harness();
    for (let i = 0; i < 10; i++) {
      h.scheduler.want(`c:peer-${i}`);
    }

    // Ten peers wanted, one dial in flight. Issuing them together is among the most
    // reliable ways to produce an Android 133.
    expect(h.dialled).toHaveLength(LINK_DIAL_PARALLELISM);
    expect(h.scheduler.waiting()).toHaveLength(10 - LINK_DIAL_PARALLELISM);
  });

  it('starts the next only once the previous finishes', () => {
    const h = harness();
    h.scheduler.want('c:a');
    h.scheduler.want('c:b');
    expect(h.dialled).toEqual(['c:a']);

    h.settle('c:a');
    expect(h.dialled).toEqual(['c:a', 'c:b']);
  });

  it('moves on after a failure rather than stalling', () => {
    const h = harness();
    h.scheduler.want('c:a');
    h.scheduler.want('c:b');

    h.scheduler.onDialFailed('c:a', 'DeviceUnavailable');
    expect(h.dialled).toContain('c:b');
  });

  it('brings up ten links one after another', () => {
    const h = harness({maxLinks: 10});
    for (let i = 0; i < 10; i++) {
      h.scheduler.want(`c:peer-${i}`);
    }
    // Each completion frees the dialler for the next one.
    for (let i = 0; i < 10; i++) {
      h.settle(`c:peer-${i}`);
    }

    expect(h.scheduler.heldCount).toBe(10);
    expect(h.scheduler.waiting()).toEqual([]);
    expect(new Set(h.dialled).size).toBe(10);
  });
});

describe('the link budget', () => {
  it('stops dialling once it is full', () => {
    const h = harness({maxLinks: 3});
    for (let i = 0; i < 6; i++) {
      h.scheduler.want(`c:peer-${i}`);
    }
    for (let i = 0; i < 3; i++) {
      h.settle(`c:peer-${i}`);
    }

    expect(h.scheduler.heldCount).toBe(3);
    // The rest are queued, not forgotten and not failed.
    expect(h.scheduler.waiting()).toHaveLength(3);
    expect(h.dialled).toHaveLength(3);
  });

  it('dials again when a held link drops', () => {
    const h = harness({maxLinks: 2});
    h.scheduler.want('c:a');
    h.scheduler.want('c:b');
    h.scheduler.want('c:c');
    h.settle('c:a');
    h.settle('c:b');
    expect(h.dialled).toEqual(['c:a', 'c:b']);

    h.scheduler.onDisconnected('c:a');
    expect(h.dialled).toContain('c:c');
  });

  it('frees a slot when a peer is no longer wanted', () => {
    const h = harness({maxLinks: 1});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.scheduler.want('c:b');
    expect(h.dialled).toEqual(['c:a']);

    h.scheduler.unwant('c:a');
    expect(h.dropped).toEqual(['c:a']);
    expect(h.dialled).toContain('c:b');
  });

  it('defaults to a request the radio has a chance of meeting', () => {
    // Not 10: the common Android ceiling is around seven, and asking for more than the
    // controller can hold just produces failures to explain away.
    expect(LINK_BUDGET_DEFAULT).toBeLessThanOrEqual(8);
  });
});

describe('learning the real ceiling', () => {
  it('lowers the budget when the radio refuses at capacity', () => {
    const h = harness({maxLinks: 10});
    for (let i = 0; i < 10; i++) {
      h.scheduler.want(`c:peer-${i}`);
    }
    for (let i = 0; i < 6; i++) {
      h.settle(`c:peer-${i}`);
    }

    // Holding six, the seventh is refused. Nothing reports "too many connections", so
    // the refusal in this context IS the report.
    h.scheduler.onDialFailed('c:peer-6', 'AndroidGattError');

    expect(h.scheduler.effectiveBudget).toBe(6);
    expect(h.scheduler.budgetLearned).toBe(true);
    expect(h.scheduler.requestedBudget).toBe(10);
  });

  it('does not clamp on the very first failed dial', () => {
    // A 133 on the first connect means nothing about capacity, and clamping to zero
    // would break the app for everyone with one bad connect.
    const h = harness({maxLinks: 8});
    h.scheduler.want('c:a');
    h.scheduler.onDialFailed('c:a', 'AndroidGattError');

    expect(h.scheduler.effectiveBudget).toBe(8);
    expect(h.scheduler.budgetLearned).toBe(false);
  });

  it('ignores failures that plainly are not about capacity', () => {
    const h = harness({maxLinks: 8});
    for (let i = 0; i < 4; i++) {
      h.scheduler.want(`c:peer-${i}`);
      h.settle(`c:peer-${i}`);
    }
    h.scheduler.want('c:peer-4');

    // A peer running the wrong build says nothing about how many links we can hold.
    h.scheduler.onDialFailed('c:peer-4', 'ServiceNotFound');
    expect(h.scheduler.effectiveBudget).toBe(8);
    expect(h.scheduler.budgetLearned).toBe(false);
  });

  it('stops dialling past the learned ceiling', () => {
    const h = harness({maxLinks: 10});
    for (let i = 0; i < 10; i++) {
      h.scheduler.want(`c:peer-${i}`);
    }
    for (let i = 0; i < 5; i++) {
      h.settle(`c:peer-${i}`);
    }
    h.scheduler.onDialFailed('c:peer-5', 'AndroidGattError');
    const after = h.dialled.length;

    // Budget is now 5 and we hold 5, so nothing further should be attempted.
    h.scheduler.pump();
    expect(h.dialled).toHaveLength(after);
  });

  it('tries again when the user raises the budget', () => {
    // The ceiling may genuinely have changed — another app let go of its links, or
    // Bluetooth was cycled. Staying pessimistic forever would be wrong.
    const h = harness({maxLinks: 10});
    for (let i = 0; i < 4; i++) {
      h.scheduler.want(`c:peer-${i}`);
      h.settle(`c:peer-${i}`);
    }
    h.scheduler.want('c:peer-4');
    h.scheduler.onDialFailed('c:peer-4', 'AndroidGattError');
    expect(h.scheduler.budgetLearned).toBe(true);

    h.scheduler.setBudget(9);
    expect(h.scheduler.budgetLearned).toBe(false);
    expect(h.scheduler.effectiveBudget).toBe(9);
  });
});

describe('rotation', () => {
  it('gives a waiting peer a turn by dropping the longest-held link', () => {
    const h = harness({maxLinks: 2, minHoldMs: 1000});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.advance(500);
    h.scheduler.want('c:b');
    h.settle('c:b');
    h.scheduler.want('c:c');

    h.advance(2000);
    expect(h.scheduler.rotate()).toBe('c:a');
    expect(h.dropped).toEqual(['c:a']);
  });

  it('will not rotate a link that has only just come up', () => {
    // Cycling faster than a handshake takes serves nobody — it leaves every link
    // permanently half-open.
    const h = harness({maxLinks: 1, minHoldMs: 30_000});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.scheduler.want('c:b');

    h.advance(5000);
    expect(h.scheduler.rotate()).toBeNull();
    expect(h.dropped).toEqual([]);
  });

  it('does nothing when nobody is waiting', () => {
    const h = harness({maxLinks: 4, minHoldMs: 0});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.advance(60_000);

    expect(h.scheduler.rotate()).toBeNull();
    expect(h.dropped).toEqual([]);
  });

  it('uses a free slot rather than taking one from somebody', () => {
    const h = harness({maxLinks: 3, minHoldMs: 0});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.scheduler.want('c:b');
    h.advance(60_000);

    // There is room for b without dropping a.
    expect(h.scheduler.rotate()).toBeNull();
    expect(h.dropped).toEqual([]);
    expect(h.dialled).toContain('c:b');
  });

  it('keeps a rotated-out peer wanted, so it comes back round', () => {
    const h = harness({maxLinks: 1, minHoldMs: 0});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.scheduler.want('c:b');
    h.advance(1000);

    h.scheduler.rotate();
    h.settle('c:b');
    h.advance(1000);

    // a was released, not forgotten: it is queued again behind b.
    expect(h.scheduler.waiting()).toEqual(['c:a']);
    expect(h.scheduler.rotate()).toBe('c:b');
  });

  it('serves the peer that has been waiting longest', async () => {
    const h = harness({maxLinks: 1, minHoldMs: 0});
    // c:old connected long ago; c:new has never been served at all.
    h.scheduler.want('c:old');
    h.settle('c:old');
    h.advance(10_000);
    h.scheduler.want('c:new');

    h.scheduler.rotate();
    // The next dial waits for the disconnect to complete — on a real radio, dialling
    // before the previous teardown finishes is exactly what produces a 133.
    await Promise.resolve();
    await Promise.resolve();

    // Never-served sorts ahead of served-long-ago, so nobody starves.
    expect(h.dialled[h.dialled.length - 1]).toBe('c:new');
  });
});

describe('snapshot', () => {
  it('reports what is held, dialling and waiting', () => {
    const h = harness({maxLinks: 2});
    h.scheduler.want('c:a');
    h.settle('c:a');
    h.scheduler.want('c:b');
    h.scheduler.want('c:c');

    const snap = h.scheduler.snapshot();
    expect(snap.held).toEqual(['c:a']);
    expect(snap.dialling).toEqual(['c:b']);
    expect(snap.waiting).toEqual(['c:c']);
    expect(snap.requestedBudget).toBe(2);
  });

  it('notifies on every change, so the UI never goes stale', () => {
    let changes = 0;
    const scheduler = new ConnectionScheduler({
      maxLinks: 2,
      hooks: {
        connect: async () => undefined,
        disconnect: async () => undefined,
        now: () => 0,
      },
      onChange: () => {
        changes++;
      },
    });

    scheduler.want('c:a');
    scheduler.onConnected('c:a');
    scheduler.onDisconnected('c:a');
    expect(changes).toBeGreaterThanOrEqual(3);
  });
});
