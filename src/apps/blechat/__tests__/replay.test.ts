/**
 * Replay protection and sender binding.
 *
 * The property being defended: a packet that has already been delivered can never be
 * delivered again, no matter how long the attacker waits, and a connected peer can never
 * put somebody else's identity on a packet.
 */
import {ReplayWindow, SequenceCounter} from '../messaging/ReplayWindow';
import {MessageRouter, type PeerRouteResolver} from '../messaging/MessageRouter';
import {JsonPacketCodec} from '../messaging/PacketCodec';
import {buildMessage} from '../messaging/Packet';
import {REPLAY_WINDOW_SIZE} from '../config/constants';
import type {ITransport} from '../types/Transport';
import type {Packet} from '../types/Packet';

describe('ReplayWindow', () => {
  it('accepts a strictly increasing run', () => {
    const window = new ReplayWindow();
    for (let seq = 1; seq <= 100; seq++) {
      expect(window.accept('peer', seq).ok).toBe(true);
    }
    expect(window.highestFor('peer')).toBe(100);
  });

  it('rejects the same sequence number twice', () => {
    const window = new ReplayWindow();
    expect(window.accept('peer', 5).ok).toBe(true);

    const second = window.accept('peer', 5);
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({reason: 'replayed'});
  });

  it('accepts genuine reordering inside the window, but only once each', () => {
    const window = new ReplayWindow();
    // Arrives 3, 1, 2 — normal for a link that does not guarantee ordering.
    expect(window.accept('peer', 3).ok).toBe(true);
    expect(window.accept('peer', 1).ok).toBe(true);
    expect(window.accept('peer', 2).ok).toBe(true);

    expect(window.accept('peer', 1).ok).toBe(false);
    expect(window.accept('peer', 2).ok).toBe(false);
    expect(window.accept('peer', 3).ok).toBe(false);
  });

  it('rejects anything that has fallen out of the window as too old', () => {
    const window = new ReplayWindow();
    window.accept('peer', 1);
    window.accept('peer', 1000);

    const verdict = window.accept('peer', 2);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({reason: 'too-old'});
  });

  it('keeps accepting at the far edge of the window', () => {
    const window = new ReplayWindow();
    window.accept('peer', 100);

    // Exactly at the boundary is out; one inside is still in.
    expect(window.accept('peer', 100 - REPLAY_WINDOW_SIZE)).toMatchObject({
      reason: 'too-old',
    });
    expect(window.accept('peer', 100 - REPLAY_WINDOW_SIZE + 1).ok).toBe(true);
  });

  it('never lets a replay become fresh again by waiting', () => {
    // The exact weakness of an LRU of ids: it forgets, and forgetting is the attacker's
    // opportunity. A counter cannot forget forwards.
    const window = new ReplayWindow();
    const captured = 7;
    expect(window.accept('peer', captured).ok).toBe(true);

    for (let seq = 8; seq < 5000; seq++) {
      window.accept('peer', seq);
    }

    expect(window.accept('peer', captured).ok).toBe(false);
  });

  it('tracks senders independently', () => {
    const window = new ReplayWindow();
    expect(window.accept('a', 10).ok).toBe(true);
    // B's numbering has nothing to do with A's.
    expect(window.accept('b', 1).ok).toBe(true);
    expect(window.accept('b', 10).ok).toBe(true);
  });

  it('rejects a malformed sequence number instead of trusting it', () => {
    const window = new ReplayWindow();
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      expect(window.accept('peer', bad)).toMatchObject({reason: 'invalid'});
    }
  });

  it('bounds how many senders it will track', () => {
    const window = new ReplayWindow(REPLAY_WINDOW_SIZE, 4);
    for (let i = 0; i < 50; i++) {
      window.accept(`peer-${i}`, 1, 1000 + i);
    }
    expect(window.trackedSenders).toBeLessThanOrEqual(4);
  });

  it('survives a restart with its high-water marks intact', () => {
    const before = new ReplayWindow();
    before.accept('peer', 42);

    const after = new ReplayWindow();
    after.hydrate(before.snapshot());

    // Without persistence this would be accepted as brand new.
    expect(after.accept('peer', 42).ok).toBe(false);
    expect(after.accept('peer', 43).ok).toBe(true);
  });

  it('ignores junk in the persisted snapshot rather than trusting it', () => {
    const window = new ReplayWindow();
    window.hydrate({
      good: 10,
      negative: -5,
      fractional: 1.5,
      text: 'nonsense' as unknown as number,
    });
    expect(window.highestFor('good')).toBe(10);
    expect(window.highestFor('negative')).toBe(0);
    expect(window.highestFor('fractional')).toBe(0);
    expect(window.highestFor('text')).toBe(0);
  });
});

describe('SequenceCounter', () => {
  it('never issues the same number twice', () => {
    const counter = new SequenceCounter();
    const issued = new Set(Array.from({length: 500}, () => counter.next()));
    expect(issued.size).toBe(500);
  });

  it('resumes above a persisted high-water mark', () => {
    const counter = new SequenceCounter(900);
    expect(counter.next()).toBe(901);
  });

  it('refuses to move backwards', () => {
    const counter = new SequenceCounter();
    counter.next();
    counter.next();
    counter.raiseTo(1);
    // Re-issuing 2 would look like a replay to every peer that already saw it.
    expect(counter.next()).toBe(3);
  });
});

// ---------------------------------------------------------------------------

/** A transport that records what was written and never touches Bluetooth. */
function stubTransport(): ITransport {
  return {
    send: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    onData: jest.fn(),
  } as unknown as ITransport;
}

function routerFor(authenticatedPeer: string | null) {
  const resolver: PeerRouteResolver = {
    resolveLink: () => 'link-1',
    establishedLinks: () => ['link-1'],
    peerIdForLink: () => authenticatedPeer,
  };
  return new MessageRouter(
    stubTransport(),
    new JsonPacketCodec(),
    resolver,
    () => 'me',
  );
}

function encoded(packet: Packet, seq: number): Uint8Array {
  packet.seq = seq;
  return new JsonPacketCodec().encode(packet);
}

describe('MessageRouter — sender binding', () => {
  it('delivers a packet whose sender matches the authenticated peer', () => {
    const router = routerFor('alice');
    const seen = jest.fn();
    router.on('MESSAGE', seen);

    router.handleInbound('link-1', encoded(buildMessage('alice', 'me', 'hi', 'm1'), 1));

    expect(seen).toHaveBeenCalledTimes(1);
    expect(router.getCounters().spoofed).toBe(0);
  });

  it('drops a packet claiming to be from somebody else on this link', () => {
    // Without this check a connected peer could file messages into a third party's
    // conversation — and, worse, drive that party's replay window forward so their real
    // messages were rejected as old.
    const router = routerFor('alice');
    const seen = jest.fn();
    router.on('MESSAGE', seen);

    router.handleInbound('link-1', encoded(buildMessage('bob', 'me', 'hi', 'm1'), 1));

    expect(seen).not.toHaveBeenCalled();
    expect(router.getCounters().spoofed).toBe(1);
  });

  it('drops data that arrives before the handshake proved an identity', () => {
    const router = routerFor(null);
    const seen = jest.fn();
    router.on('MESSAGE', seen);

    router.handleInbound('link-1', encoded(buildMessage('alice', 'me', 'hi', 'm1'), 1));

    expect(seen).not.toHaveBeenCalled();
    expect(router.getCounters().spoofed).toBe(1);
  });

  it('lets handshake packets through, since they are what establishes identity', () => {
    const router = routerFor(null);
    const seen = jest.fn();
    router.on('HELLO', seen);

    const hello = buildMessage('alice', '', 'x', 'h1') as Packet;
    hello.type = 'HELLO';
    router.handleInbound('link-1', encoded(hello, 1));

    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('MessageRouter — replay rejection', () => {
  it('counts a verbatim replay and refuses to dispatch it', () => {
    const router = routerFor('alice');
    const seen = jest.fn();
    router.on('MESSAGE', seen);

    const bytes = encoded(buildMessage('alice', 'me', 'hi', 'm1'), 4);
    router.handleInbound('link-1', bytes);
    router.handleInbound('link-1', bytes);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(router.getCounters().replayed).toBe(1);
  });

  it('rejects a replay the seen-id cache has already forgotten', () => {
    const router = routerFor('alice');
    const seen = jest.fn();
    router.on('MESSAGE', seen);

    const bytes = encoded(buildMessage('alice', 'me', 'hi', 'm1'), 4);
    router.handleInbound('link-1', bytes);

    // Simulate the id ageing out of the bounded cache, which is all an attacker had to
    // wait for before the sequence window existed.
    router.seen.clear();
    router.handleInbound('link-1', bytes);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(router.getCounters().replayed).toBe(1);
  });

  it('stamps every outbound packet with a fresh number', async () => {
    const router = routerFor('alice');
    const first = buildMessage('me', 'alice', 'one', 'm1');
    const second = buildMessage('me', 'alice', 'two', 'm2');

    await router.sendOnLink('link-1', first);
    await router.sendOnLink('link-1', second);

    expect(first.seq).toBeGreaterThan(0);
    expect(second.seq).toBe(first.seq + 1);
  });

  it('reports the high-water mark so it can be persisted', async () => {
    const router = routerFor('alice');
    const advanced: number[] = [];
    router.onSequenceAdvanced = seq => advanced.push(seq);

    await router.sendOnLink('link-1', buildMessage('me', 'alice', 'x', 'm1'));
    await router.sendOnLink('link-1', buildMessage('me', 'alice', 'y', 'm2'));

    expect(advanced).toEqual([1, 2]);
  });
});
