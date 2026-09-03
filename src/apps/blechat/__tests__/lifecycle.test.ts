/**
 * Connection churn.
 *
 * Real BLE does not give you one clean connection that lasts. It gives you links that
 * drop when someone walks behind a wall, come back a second later, drop again, and get
 * re-dialled while the previous teardown is still settling. The failure modes that
 * matter here are the quiet ones: a peer stuck "connected" after the radio let go, a
 * message reported sent when nothing left the phone, a queue that empties without
 * delivering, or state that drifts a little further out of true on every cycle.
 *
 * These run over the virtual link with encryption on, so each cycle also re-runs a real
 * handshake and derives fresh session keys — the same work a real reconnect does.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';

describe('connect / disconnect cycling', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connect(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to reach connected',
    );
  }

  async function dropFromB(): Promise<void> {
    phoneB.transport.simulateDrop(phoneB.transport.linkIds[0]);
    await waitFor(
      () =>
        !phoneA.isConnectedTo(phoneB.peerId) && !phoneB.isConnectedTo(phoneA.peerId),
      'both sides to notice the drop',
    );
  }

  it('survives ten connect/disconnect cycles and still delivers', async () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      await connect();
      await phoneA.messages.send(phoneB.peerId, `cycle ${cycle}`);
      await waitFor(
        () => phoneB.conversationWith(phoneA.peerId).length === cycle + 1,
        `B to receive the message from cycle ${cycle}`,
      );
      await dropFromB();
    }

    // Every cycle delivered exactly one message, in order, with nothing duplicated by
    // a re-handshake and nothing lost to a teardown.
    const received = phoneB.conversationWith(phoneA.peerId);
    expect(received).toHaveLength(10);
    expect(received.map(m => m.text)).toEqual(
      Array.from({length: 10}, (_, i) => `cycle ${i}`),
    );
  });

  it('does not accumulate duplicate peer entries across cycles', async () => {
    for (let i = 0; i < 5; i++) {
      await connect();
      await dropFromB();
    }
    await connect();

    // One peer met six times is still one peer. A new row per reconnect is the drift
    // that produces a Nearby list full of the same person.
    const entries = phoneA.peerManager
      .getPeers()
      .filter(p => p.peerId === phoneB.peerId);
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe('connected');
  });

  it('counts every successful connect, so the history is not reset by a drop', async () => {
    for (let i = 0; i < 4; i++) {
      await connect();
      await dropFromB();
    }
    const peer = phoneA.peerManager.getPeer(phoneB.peerId);
    expect(peer?.connectCount).toBe(4);
  });

  it('leaves no link behind on either side after a cycle', async () => {
    await connect();
    await dropFromB();

    // A link the transport still believes in, after the peer is gone, is what later
    // produces sends into nowhere.
    expect(phoneA.transport.linkIds).toHaveLength(0);
    expect(phoneB.transport.linkIds).toHaveLength(0);
  });

  it('derives a fresh session on every reconnect rather than reusing keys', async () => {
    await connect();
    expect(phoneA.sessions.size).toBe(1);
    await dropFromB();

    // Forward secrecy depends on the old cipher actually being discarded, not merely
    // replaced later.
    expect(phoneA.sessions.size).toBe(0);
    expect(phoneB.sessions.size).toBe(0);

    await connect();
    expect(phoneA.sessions.size).toBe(1);
    expect(phoneB.sessions.size).toBe(1);
  });
});

describe('rapid reconnects', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connect(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to reach connected',
    );
  }

  it('settles correctly when the link drops immediately after connecting', async () => {
    for (let i = 0; i < 5; i++) {
      await connect();
      // No pause: drop while the handshake's own follow-up work may still be settling.
      phoneB.transport.simulateDrop(phoneB.transport.linkIds[0]);
      await waitFor(
        () => !phoneA.isConnectedTo(phoneB.peerId),
        'A to notice the immediate drop',
      );
    }

    await connect();
    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);
    // Still exactly one identity, and it is genuinely usable.
    await phoneA.messages.send(phoneB.peerId, 'after the churn');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'the message after the churn to arrive',
    );
  });

  it('refuses a redundant dial while already connected', async () => {
    await connect();
    const before = phoneA.transport.linkIds.length;

    // Resolves rather than throwing — the contract is "no second link", not "error".
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));

    // A second link to the same phone wastes a slot from a budget of about seven, and
    // the tie-break would then tear one down, failing every packet in flight on it.
    expect(phoneA.transport.linkIds).toHaveLength(before);
    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);
  });

  it('keeps sequence numbering monotonic across reconnects', async () => {
    await connect();
    await phoneA.messages.send(phoneB.peerId, 'one');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'first message',
    );

    phoneB.transport.simulateDrop(phoneB.transport.linkIds[0]);
    await waitFor(() => !phoneA.isConnectedTo(phoneB.peerId), 'the drop');

    await connect();
    await phoneA.messages.send(phoneB.peerId, 'two');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 2,
      'second message after reconnect',
    );

    // Restarting the count after a reconnect would make honest packets look like
    // replays to a peer that still remembers the old numbers.
    expect(phoneB.conversationWith(phoneA.peerId).map(m => m.text)).toEqual([
      'one',
      'two',
    ]);
    expect(phoneB.router.getCounters().replayed).toBe(0);
  });
});

describe('losing the link mid-conversation', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connect(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to reach connected',
    );
  }

  it('queues what is sent after the drop instead of claiming it went', async () => {
    await connect();
    phoneA.transport.simulateDrop(phoneA.transport.linkIds[0]);
    await waitFor(() => !phoneA.isConnectedTo(phoneB.peerId), 'the drop');

    await phoneA.messages.send(phoneB.peerId, 'written while away');

    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);
    const sent = phoneA.conversationWith(phoneB.peerId);
    expect(sent[sent.length - 1].status).not.toBe('sent');
    expect(sent[sent.length - 1].status).not.toBe('received');
  });

  it('delivers the backlog in order when the peer returns', async () => {
    await connect();
    phoneA.transport.simulateDrop(phoneA.transport.linkIds[0]);
    await waitFor(() => !phoneA.isConnectedTo(phoneB.peerId), 'the drop');

    for (const text of ['first', 'second', 'third']) {
      await phoneA.messages.send(phoneB.peerId, text);
    }
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(3);

    await connect();
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 3,
      'the whole backlog to arrive',
    );

    expect(phoneB.conversationWith(phoneA.peerId).map(m => m.text)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(0);
  });

  it('repeated away-and-back cycles never lose or duplicate a queued message', async () => {
    let expected = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      await connect();
      phoneA.transport.simulateDrop(phoneA.transport.linkIds[0]);
      await waitFor(() => !phoneA.isConnectedTo(phoneB.peerId), 'the drop');

      await phoneA.messages.send(phoneB.peerId, `away ${cycle}`);
      expected++;

      await connect();
      await waitFor(
        () => phoneB.conversationWith(phoneA.peerId).length === expected,
        `queued message from cycle ${cycle} to arrive`,
      );
    }

    const received = phoneB.conversationWith(phoneA.peerId);
    expect(received.map(m => m.text)).toEqual([
      'away 0',
      'away 1',
      'away 2',
      'away 3',
    ]);
    // The duplicate counter is the check that matters: a re-flush of an already
    // delivered queue would show up here rather than in the visible list.
    expect(new Set(received.map(m => m.id)).size).toBe(4);
  });
});
