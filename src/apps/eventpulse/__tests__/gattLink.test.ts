/**
 * Unit tests for the GATT link lifecycle.
 *
 * `GattLink` is the whole ordering story of a BLE connection with the radio
 * taken out: a pure state machine whose only inputs are events and an injected
 * `now`. That makes every race the real stack suffers from — a callback landing
 * after teardown, a second tap on the same person, a connect that resolves after
 * it was abandoned — an ordinary, deterministic assertion.
 *
 * Two sweeps carry most of the weight:
 *
 *   LEGAL_CASES     — the documented transition table, written out here by hand
 *                     and independently of the implementation, so a transition
 *                     that quietly changes destination fails a test.
 *   ILLEGAL_CASES   — every state crossed with every event kind that is NOT in
 *                     that state's row. Each must return null and leave the link
 *                     bit-for-bit unchanged. That is the guarantee that a late
 *                     callback from a superseded attempt cannot corrupt a live
 *                     link.
 *
 * Times are arbitrary but distinct, so a transition stamped from the wrong clock
 * reading is visible rather than coincidentally right.
 */

import { GattLink } from '../bluetooth/gatt/GattLink';
import type { GattLinkEvent, GattLinkState, GattLinkTransition } from '../bluetooth/gatt/GattLink';
import type { GattDisconnectReason } from '../bluetooth/gatt/GattTransport';

const DEVICE_ID = 'AA:BB:CC:DD:EE:FF';

type EventKind = GattLinkEvent['kind'];

const ALL_STATES: GattLinkState[] = [
  'idle',
  'connecting',
  'connected',
  'disconnecting',
  'disconnected',
  'failed',
];

const ALL_KINDS: EventKind[] = ['connect', 'ready', 'disconnect', 'drop', 'fail', 'reset'];

const ALL_REASONS: GattDisconnectReason[] = ['local', 'remote', 'timeout', 'adapter_off', 'error'];

/** Distinct reasons per event kind, so a mix-up between the two would show up. */
const DROP_REASON: GattDisconnectReason = 'remote';
const FAIL_REASON: GattDisconnectReason = 'error';

/** One representative event of each kind. */
function eventOfKind(kind: EventKind): GattLinkEvent {
  switch (kind) {
    case 'connect':
      return { kind: 'connect' };
    case 'ready':
      return { kind: 'ready' };
    case 'disconnect':
      return { kind: 'disconnect' };
    case 'drop':
      return { kind: 'drop', reason: DROP_REASON };
    case 'fail':
      return { kind: 'fail', reason: FAIL_REASON };
    case 'reset':
      return { kind: 'reset' };
  }
}

/** The reason an event of this kind is expected to leave behind, if any. */
function reasonOfKind(kind: EventKind): GattDisconnectReason | undefined {
  if (kind === 'drop') return DROP_REASON;
  if (kind === 'fail') return FAIL_REASON;
  return undefined;
}

/**
 * The documented transition table, spelled out by hand.
 *
 * Anything absent from a row is illegal from that state.
 */
const LEGAL: Record<GattLinkState, Partial<Record<EventKind, GattLinkState>>> = {
  idle: { connect: 'connecting', reset: 'idle' },
  connecting: {
    ready: 'connected',
    disconnect: 'disconnecting',
    // A drop during setup is a failure to connect, not a connection that ended.
    drop: 'failed',
    fail: 'failed',
  },
  connected: { disconnect: 'disconnecting', drop: 'disconnected', fail: 'failed' },
  // A teardown that errors is still a teardown.
  disconnecting: { drop: 'disconnected', fail: 'disconnected' },
  disconnected: { reset: 'idle' },
  failed: { reset: 'idle' },
};

interface LegalCase {
  from: GattLinkState;
  kind: EventKind;
  to: GattLinkState;
}

const LEGAL_CASES: LegalCase[] = [];
const ILLEGAL_CASES: { from: GattLinkState; kind: EventKind }[] = [];
for (const from of ALL_STATES) {
  for (const kind of ALL_KINDS) {
    const to = LEGAL[from][kind];
    if (to === undefined) ILLEGAL_CASES.push({ from, kind });
    else LEGAL_CASES.push({ from, kind, to });
  }
}

/** The moment each fixture below enters its state, so `stateEnteredAt` is checkable. */
const FIXTURE_ENTERED_AT: Record<GattLinkState, number> = {
  idle: 0,
  connecting: 10,
  connected: 20,
  disconnecting: 30,
  disconnected: 40,
  failed: 50,
};

/**
 * A link parked in `state`, built only out of legal events and with no connect
 * timeout armed, so nothing but the event under test can move it.
 */
function linkIn(state: GattLinkState): GattLink {
  const link = new GattLink(DEVICE_ID, 0);
  switch (state) {
    case 'idle':
      break;
    case 'connecting':
      link.event({ kind: 'connect' }, 10);
      break;
    case 'connected':
      link.event({ kind: 'connect' }, 10);
      link.event({ kind: 'ready' }, 20);
      break;
    case 'disconnecting':
      link.event({ kind: 'connect' }, 10);
      link.event({ kind: 'ready' }, 20);
      link.event({ kind: 'disconnect' }, 30);
      break;
    case 'disconnected':
      link.event({ kind: 'connect' }, 10);
      link.event({ kind: 'ready' }, 20);
      link.event({ kind: 'disconnect' }, 30);
      link.event({ kind: 'drop', reason: DROP_REASON }, 40);
      break;
    case 'failed':
      link.event({ kind: 'connect' }, 10);
      link.event({ kind: 'fail', reason: FAIL_REASON }, 50);
      break;
  }
  // The fixture is part of the test: assert it landed where it claims to.
  expect(link.state).toBe(state);
  expect(link.stateEnteredAt).toBe(FIXTURE_ENTERED_AT[state]);
  return link;
}

/** Narrow away the `null` an illegal event would have produced. */
function must(transition: GattLinkTransition | null): GattLinkTransition {
  if (transition === null) throw new Error('expected a transition, got null');
  return transition;
}

interface LinkSnapshot {
  state: GattLinkState;
  reason: GattDisconnectReason | undefined;
  enteredAt: number;
  isUsable: boolean;
  isBusy: boolean;
  history: GattLinkTransition[];
}

/** Everything observable about a link, for before/after comparison. */
function snapshot(link: GattLink): LinkSnapshot {
  return {
    state: link.state,
    reason: link.reason,
    enteredAt: link.stateEnteredAt,
    isUsable: link.isUsable,
    isBusy: link.isBusy,
    history: link.transitions.map((entry) => ({ ...entry })),
  };
}

describe('a freshly constructed link', () => {
  it('starts idle, carrying no traffic and holding no attempt open', () => {
    const link = new GattLink(DEVICE_ID);
    expect(link.state).toBe('idle');
    expect(link.isUsable).toBe(false);
    expect(link.isBusy).toBe(false);
    expect(link.reason).toBeUndefined();
    expect(link.transitions).toEqual([]);
  });

  it('keeps the device id it was given and stamps the construction time', () => {
    const link = new GattLink(DEVICE_ID, 4242);
    expect(link.deviceId).toBe(DEVICE_ID);
    expect(link.stateEnteredAt).toBe(4242);
  });

  it('defaults the construction time to zero when no clock reading is supplied', () => {
    expect(new GattLink(DEVICE_ID).stateEnteredAt).toBe(0);
  });

  it('has no connect deadline pending before anything is attempted', () => {
    expect(new GattLink(DEVICE_ID, 100).timeUntilTimeout(100)).toBeNull();
  });
});

describe('the documented transition table', () => {
  it('covers all 36 state/event combinations, 13 of them legal', () => {
    expect(ALL_STATES).toHaveLength(6);
    expect(ALL_KINDS).toHaveLength(6);
    expect(LEGAL_CASES).toHaveLength(13);
    expect(ILLEGAL_CASES).toHaveLength(23);
    expect(LEGAL_CASES.length + ILLEGAL_CASES.length).toBe(36);
  });

  it.each(LEGAL_CASES)(
    '$kind moves a $from link to $to, returning that transition stamped with the event time',
    ({ from, kind, to }) => {
      const link = linkIn(from);
      const historyBefore = link.transitions.length;
      const at = 777;

      const transition = must(link.event(eventOfKind(kind), at));

      expect(transition).toEqual({ from, to, at, reason: reasonOfKind(kind) });
      expect(link.state).toBe(to);
      expect(link.stateEnteredAt).toBe(at);
      expect(link.reason).toBe(reasonOfKind(kind));
      expect(link.transitions).toHaveLength(historyBefore + 1);
      expect(link.transitions[historyBefore]).toEqual(transition);
    },
  );

  it('treats a drop while connecting as a failure to connect, not a connection that ended', () => {
    const link = linkIn('connecting');
    const transition = must(link.event({ kind: 'drop', reason: 'remote' }, 60));
    expect(transition).toEqual({ from: 'connecting', to: 'failed', at: 60, reason: 'remote' });
    expect(link.state).toBe('failed');
    expect(link.state).not.toBe('disconnected');
  });

  it('treats a drop while connected as a connection that ended', () => {
    const link = linkIn('connected');
    const transition = must(link.event({ kind: 'drop', reason: 'remote' }, 60));
    expect(transition).toEqual({ from: 'connected', to: 'disconnected', at: 60, reason: 'remote' });
    expect(link.state).toBe('disconnected');
  });

  it('ends a failing teardown at disconnected — the link is gone either way', () => {
    const link = linkIn('disconnecting');
    const transition = must(link.event({ kind: 'fail', reason: 'error' }, 60));
    expect(transition).toEqual({
      from: 'disconnecting',
      to: 'disconnected',
      at: 60,
      reason: 'error',
    });
    expect(link.state).toBe('disconnected');
    expect(link.state).not.toBe('failed');
  });

  it('ends a dropped teardown at disconnected', () => {
    const link = linkIn('disconnecting');
    expect(must(link.event({ kind: 'drop', reason: 'local' }, 60)).to).toBe('disconnected');
  });

  it('walks a whole session from idle through connected to disconnected', () => {
    const link = new GattLink(DEVICE_ID, 0);
    expect(must(link.event({ kind: 'connect' }, 1)).to).toBe('connecting');
    expect(must(link.event({ kind: 'ready' }, 2)).to).toBe('connected');
    expect(must(link.event({ kind: 'disconnect' }, 3)).to).toBe('disconnecting');
    expect(must(link.event({ kind: 'drop', reason: 'local' }, 4)).to).toBe('disconnected');
    expect(link.state).toBe('disconnected');
  });
});

describe('illegal events are dropped, never applied', () => {
  it.each(ALL_STATES)(
    'a link in %s ignores every event outside its row of the table and is left untouched',
    (from) => {
      const kinds = ALL_KINDS.filter((kind) => LEGAL[from][kind] === undefined);
      expect(kinds.length).toBeGreaterThan(0);

      for (const kind of kinds) {
        const link = linkIn(from);
        const before = snapshot(link);

        expect(link.event(eventOfKind(kind), 999)).toBeNull();

        expect(snapshot(link)).toEqual(before);
      }
    },
  );

  it('cannot be corrupted by a late callback from a superseded attempt', () => {
    // The first attempt times out and is reset; a second attempt succeeds. The
    // first attempt's `ready` then lands late: it must not touch the live link.
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);
    link.tick(100);
    link.event({ kind: 'reset' }, 110);
    link.event({ kind: 'connect' }, 120);
    link.event({ kind: 'ready' }, 130);
    const before = snapshot(link);
    expect(before.state).toBe('connected');
    expect(before.history).toHaveLength(5);

    expect(link.event({ kind: 'ready' }, 135)).toBeNull();
    expect(link.event({ kind: 'connect' }, 136)).toBeNull();
    expect(link.event({ kind: 'reset' }, 137)).toBeNull();

    expect(snapshot(link)).toEqual(before);
    expect(link.isUsable).toBe(true);
  });

  it('keeps a disconnected link settled through every late callback except reset', () => {
    const link = linkIn('disconnected');
    const before = snapshot(link);
    for (const kind of ALL_KINDS.filter((candidate) => candidate !== 'reset')) {
      expect(link.event(eventOfKind(kind), 500)).toBeNull();
    }
    expect(snapshot(link)).toEqual(before);
    expect(link.reason).toBe(DROP_REASON);
  });

  it('keeps a failed link settled through every late callback except reset', () => {
    const link = linkIn('failed');
    const before = snapshot(link);
    for (const kind of ALL_KINDS.filter((candidate) => candidate !== 'reset')) {
      expect(link.event(eventOfKind(kind), 500)).toBeNull();
    }
    expect(snapshot(link)).toEqual(before);
    expect(link.reason).toBe(FAIL_REASON);
  });
});

describe('reset', () => {
  it('returns a disconnected link to idle and clears the reason it settled with', () => {
    const link = linkIn('disconnected');
    expect(link.reason).toBe(DROP_REASON);

    const transition = must(link.event({ kind: 'reset' }, 100));

    expect(transition).toEqual({ from: 'disconnected', to: 'idle', at: 100, reason: undefined });
    expect(transition.reason).toBeUndefined();
    expect(link.state).toBe('idle');
    expect(link.reason).toBeUndefined();
    expect(link.stateEnteredAt).toBe(100);
  });

  it('returns a failed link to idle and clears the reason it failed with', () => {
    const link = linkIn('failed');
    expect(link.reason).toBe(FAIL_REASON);

    const transition = must(link.event({ kind: 'reset' }, 100));

    expect(transition).toEqual({ from: 'failed', to: 'idle', at: 100, reason: undefined });
    expect(link.state).toBe('idle');
    expect(link.reason).toBeUndefined();
  });

  it('is a recorded self-transition when the link is already idle', () => {
    const link = linkIn('idle');
    const transition = must(link.event({ kind: 'reset' }, 100));
    expect(transition).toEqual({ from: 'idle', to: 'idle', at: 100, reason: undefined });
    expect(link.state).toBe('idle');
    expect(link.transitions).toHaveLength(1);
  });

  it('is refused from every in-flight state, so a live attempt is never orphaned', () => {
    for (const state of ALL_STATES.filter(
      (candidate) => candidate === 'connecting' || candidate === 'connected' || candidate === 'disconnecting',
    )) {
      const link = linkIn(state);
      const before = snapshot(link);
      expect(link.event({ kind: 'reset' }, 100)).toBeNull();
      expect(snapshot(link)).toEqual(before);
    }
  });

  it('leaves the link ready to start a fresh attempt', () => {
    const link = linkIn('failed');
    link.event({ kind: 'reset' }, 100);
    const transition = must(link.event({ kind: 'connect' }, 110));
    expect(transition).toEqual({ from: 'idle', to: 'connecting', at: 110, reason: undefined });
    expect(link.isBusy).toBe(true);
  });
});

describe('usability and busy-ness', () => {
  it('reports isUsable only while connected', () => {
    for (const state of ALL_STATES) {
      expect(linkIn(state).isUsable).toBe(state === 'connected');
    }
  });

  it('reports isBusy only while connecting or disconnecting', () => {
    for (const state of ALL_STATES) {
      expect(linkIn(state).isBusy).toBe(state === 'connecting' || state === 'disconnecting');
    }
  });
});

describe('the connect timeout', () => {
  /** Connect at 1000 with a 500 ms budget: the deadline is exactly 1500. */
  function connectingWithDeadline(): GattLink {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 1000, 500);
    return link;
  }

  it('does not expire on a tick one millisecond before the deadline', () => {
    const link = connectingWithDeadline();
    expect(link.tick(1499)).toBeNull();
    expect(link.state).toBe('connecting');
    expect(link.transitions).toHaveLength(1);
  });

  it('expires exactly at the deadline, failing with reason timeout', () => {
    const link = connectingWithDeadline();
    const transition = must(link.tick(1500));
    expect(transition).toEqual({ from: 'connecting', to: 'failed', at: 1500, reason: 'timeout' });
    expect(link.state).toBe('failed');
    expect(link.reason).toBe('timeout');
    expect(link.stateEnteredAt).toBe(1500);
  });

  it('expires on the first tick after the deadline, stamped with that tick', () => {
    const link = connectingWithDeadline();
    expect(link.tick(1499)).toBeNull();
    const transition = must(link.tick(1600));
    expect(transition).toEqual({ from: 'connecting', to: 'failed', at: 1600, reason: 'timeout' });
  });

  it('expires only once, however many ticks follow', () => {
    const link = connectingWithDeadline();
    must(link.tick(1500));
    expect(link.tick(1501)).toBeNull();
    expect(link.tick(99999)).toBeNull();
    expect(link.transitions).toHaveLength(2);
  });

  it('does not expire at the instant a one millisecond budget is armed', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 1);
    expect(link.tick(0)).toBeNull();
    expect(link.state).toBe('connecting');
    expect(must(link.tick(1)).at).toBe(1);
    expect(link.reason).toBe('timeout');
  });

  it('measures the budget from the connect event, not from construction', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 500, 100);
    expect(link.tick(599)).toBeNull();
    expect(must(link.tick(600)).to).toBe('failed');
  });

  it('never expires when no timeout is given', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0);
    expect(link.timeUntilTimeout(0)).toBeNull();
    expect(link.tick(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(link.state).toBe('connecting');
    expect(link.transitions).toHaveLength(1);
  });

  it('never expires when the timeout is zero', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 0);
    expect(link.timeUntilTimeout(0)).toBeNull();
    expect(link.timeUntilTimeout(1000000)).toBeNull();
    expect(link.tick(1000000)).toBeNull();
    expect(link.state).toBe('connecting');
  });

  it('never expires when the timeout is negative', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, -1);
    expect(link.timeUntilTimeout(0)).toBeNull();
    expect(link.tick(1000000)).toBeNull();
    expect(link.state).toBe('connecting');
  });

  it('does nothing on a tick in any state other than connecting', () => {
    for (const state of ALL_STATES.filter((candidate) => candidate !== 'connecting')) {
      const link = linkIn(state);
      const before = snapshot(link);
      expect(link.tick(1000000)).toBeNull();
      expect(snapshot(link)).toEqual(before);
    }
  });

  it('clears the deadline when the connect succeeds, so a later tick cannot fail a live link', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);
    link.event({ kind: 'ready' }, 50);

    expect(link.tick(1000000)).toBeNull();
    expect(link.state).toBe('connected');
    expect(link.isUsable).toBe(true);
    expect(link.timeUntilTimeout(1000000)).toBeNull();
    expect(link.transitions).toHaveLength(2);
  });

  it('clears the deadline when a connect is abandoned by a disconnect', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);
    link.event({ kind: 'disconnect' }, 10);

    expect(link.tick(1000000)).toBeNull();
    expect(link.state).toBe('disconnecting');
    expect(link.timeUntilTimeout(1000000)).toBeNull();
  });

  it('is not extended by a second connect while one is already in flight', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);

    expect(link.event({ kind: 'connect' }, 50, 100000)).toBeNull();

    expect(link.timeUntilTimeout(50)).toBe(50);
    expect(must(link.tick(100)).to).toBe('failed');
  });

  it('arms a fresh deadline from the new start time when an attempt is retried', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);
    must(link.tick(100));
    link.event({ kind: 'reset' }, 200);
    link.event({ kind: 'connect' }, 300, 100);

    expect(link.timeUntilTimeout(300)).toBe(100);
    expect(link.tick(399)).toBeNull();
    expect(must(link.tick(400)).at).toBe(400);
  });
});

describe('timeUntilTimeout', () => {
  it('counts down from the full budget and reaches zero exactly at the deadline', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 1000, 500);

    expect(link.timeUntilTimeout(1000)).toBe(500);
    expect(link.timeUntilTimeout(1001)).toBe(499);
    expect(link.timeUntilTimeout(1250)).toBe(250);
    expect(link.timeUntilTimeout(1499)).toBe(1);
    expect(link.timeUntilTimeout(1500)).toBe(0);
  });

  it('floors at zero rather than going negative once the deadline has passed', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 1000, 500);
    expect(link.timeUntilTimeout(1501)).toBe(0);
    expect(link.timeUntilTimeout(1000000)).toBe(0);
  });

  it('is null in every state other than connecting', () => {
    for (const state of ALL_STATES.filter((candidate) => candidate !== 'connecting')) {
      expect(linkIn(state).timeUntilTimeout(0)).toBeNull();
    }
  });

  it('is null once the attempt it belonged to has expired', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 0, 100);
    must(link.tick(100));
    expect(link.timeUntilTimeout(100)).toBeNull();
  });
});

describe('the disconnect reason', () => {
  it.each(ALL_REASONS)('carries %s from a drop onto the link and its transition', (reason) => {
    const link = linkIn('connected');
    const transition = must(link.event({ kind: 'drop', reason }, 60));
    expect(transition.reason).toBe(reason);
    expect(link.reason).toBe(reason);
  });

  it.each(ALL_REASONS)('carries %s from a fail onto the link and its transition', (reason) => {
    const link = linkIn('connecting');
    const transition = must(link.event({ kind: 'fail', reason }, 60));
    expect(transition.reason).toBe(reason);
    expect(link.reason).toBe(reason);
  });

  it('is absent on transitions that are neither a drop nor a fail', () => {
    const link = new GattLink(DEVICE_ID, 0);
    expect(must(link.event({ kind: 'connect' }, 1)).reason).toBeUndefined();
    expect(must(link.event({ kind: 'ready' }, 2)).reason).toBeUndefined();
    expect(must(link.event({ kind: 'disconnect' }, 3)).reason).toBeUndefined();
    expect(link.reason).toBeUndefined();
  });

  it('is replaced, not accumulated, when a second reason arrives', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 1);
    link.event({ kind: 'ready' }, 2);
    link.event({ kind: 'disconnect' }, 3);
    link.event({ kind: 'fail', reason: 'adapter_off' }, 4);
    expect(link.reason).toBe('adapter_off');
  });
});

describe('the transition history', () => {
  it('records every transition, oldest first, with the exact times they happened', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 1, 100);
    link.event({ kind: 'ready' }, 2);
    link.event({ kind: 'disconnect' }, 3);
    link.event({ kind: 'drop', reason: 'local' }, 4);
    link.event({ kind: 'reset' }, 5);

    expect(link.transitions).toEqual([
      { from: 'idle', to: 'connecting', at: 1, reason: undefined },
      { from: 'connecting', to: 'connected', at: 2, reason: undefined },
      { from: 'connected', to: 'disconnecting', at: 3, reason: undefined },
      { from: 'disconnecting', to: 'disconnected', at: 4, reason: 'local' },
      { from: 'disconnected', to: 'idle', at: 5, reason: undefined },
    ]);
  });

  it('records a timeout expiry as an ordinary transition to failed', () => {
    const link = new GattLink(DEVICE_ID, 0);
    link.event({ kind: 'connect' }, 10, 90);
    link.tick(100);

    expect(link.transitions).toEqual([
      { from: 'idle', to: 'connecting', at: 10, reason: undefined },
      { from: 'connecting', to: 'failed', at: 100, reason: 'timeout' },
    ]);
  });

  it('records nothing for a rejected event, however many arrive', () => {
    const link = linkIn('connected');
    const lengthBefore = link.transitions.length;

    link.event({ kind: 'ready' }, 60);
    link.event({ kind: 'connect' }, 61);
    link.event({ kind: 'reset' }, 62);
    link.tick(1000000);

    expect(link.transitions).toHaveLength(lengthBefore);
  });

  it('returns the same transition objects it handed back from event()', () => {
    const link = new GattLink(DEVICE_ID, 0);
    const first = must(link.event({ kind: 'connect' }, 1));
    const second = must(link.event({ kind: 'ready' }, 2));
    expect(link.transitions[0]).toBe(first);
    expect(link.transitions[1]).toBe(second);
  });
});
