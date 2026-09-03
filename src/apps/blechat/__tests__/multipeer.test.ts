/**
 * Multiple simultaneous peers.
 *
 * The requirement that matters is isolation: one bad link must not degrade the others.
 * These tests deliberately break one peer in several different ways and assert the
 * remaining conversations keep working.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {PROTOCOL_VERSION} from '../config/constants';

describe('multi-peer', () => {
  let air: VirtualAir;
  let hub: VirtualPhone;
  let b: VirtualPhone;
  let c: VirtualPhone;
  let d: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    hub = new VirtualPhone('deviceA', 'Hub', air);
    b = new VirtualPhone('deviceB', 'Phone B', air);
    c = new VirtualPhone('deviceC', 'Phone C', air);
    d = new VirtualPhone('deviceD', 'Phone D', air);
  });

  afterEach(() => {
    [hub, b, c, d].forEach(p => p.dispose());
  });

  async function connectAll(): Promise<void> {
    for (const peer of [b, c, d]) {
      peer.startAdvertising();
    }
    await hub.scan();
    for (const [peer, id] of [
      [b, 'deviceB'],
      [c, 'deviceC'],
      [d, 'deviceD'],
    ] as const) {
      await hub.peerManager.connect(toCentralLinkId(id));
      await waitFor(
        () => hub.isConnectedTo(peer.peerId),
        `hub to connect to ${peer.identity.displayName}`,
      );
    }
  }

  it('holds three links at once, each tracked independently', async () => {
    await connectAll();

    const connected = hub.peerManager.getConnectedPeers();
    expect(connected).toHaveLength(3);

    // Independent identity, link and GATT state per peer — not a shared blob.
    const names = connected.map(p => p.displayName).sort();
    expect(names).toEqual(['Phone B', 'Phone C', 'Phone D']);

    const linkIds = new Set(connected.map(p => p.linkId));
    expect(linkIds.size).toBe(3);

    for (const peer of connected) {
      expect(peer.gatt?.notificationsEnabled).toBe(true);
      expect(peer.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(peer.authenticated).toBe(true);
      expect(peer.agreedCapabilities?.messaging).toBe(true);
    }
  });

  it('keeps conversations separate', async () => {
    await connectAll();

    await hub.messages.send(b.peerId, 'for B');
    await hub.messages.send(c.peerId, 'for C');
    await hub.messages.send(d.peerId, 'for D');

    await waitFor(
      () =>
        b.conversationWith(hub.peerId).length === 1 &&
        c.conversationWith(hub.peerId).length === 1 &&
        d.conversationWith(hub.peerId).length === 1,
      'each peer to receive exactly its own message',
    );

    expect(b.conversationWith(hub.peerId)[0].text).toBe('for B');
    expect(c.conversationWith(hub.peerId)[0].text).toBe('for C');
    expect(d.conversationWith(hub.peerId)[0].text).toBe('for D');

    // And the hub files each reply under the right peer.
    expect(hub.conversationWith(b.peerId)).toHaveLength(1);
    expect(hub.conversationWith(c.peerId)).toHaveLength(1);
  });

  it('one peer disconnecting does not disturb the others', async () => {
    await connectAll();

    await c.transport.disconnect(c.transport.linkIds[0]);
    await waitFor(() => !hub.isConnectedTo(c.peerId), 'C to drop');

    expect(hub.isConnectedTo(b.peerId)).toBe(true);
    expect(hub.isConnectedTo(d.peerId)).toBe(true);

    await hub.messages.send(b.peerId, 'still working');
    await waitFor(
      () => b.conversationWith(hub.peerId).some(m => m.text === 'still working'),
      'B to keep receiving after C dropped',
    );

    // C's traffic is queued, not lost, and not counted against B or D.
    await hub.messages.send(c.peerId, 'for the departed');
    expect(hub.messages.queue.countFor(c.peerId)).toBe(1);
    expect(hub.messages.queue.countFor(b.peerId)).toBe(0);
  });

  it('a lossy peer does not corrupt a healthy peer', async () => {
    await connectAll();

    // Break C's link at the frame level, leaving B and D untouched.
    c.transport.dropEveryNthFrame = 1;
    hub.transport.dropEveryNthFrame = 0;

    await hub.messages.send(b.peerId, 'clean path');
    await waitFor(
      () => b.conversationWith(hub.peerId).some(m => m.text === 'clean path'),
      'B to receive over its own healthy link',
    );

    expect(b.conversationWith(hub.peerId)[0].text).toBe('clean path');
    expect(hub.isConnectedTo(d.peerId)).toBe(true);
  });

  it('tracks per-peer metrics separately', async () => {
    await connectAll();

    await hub.messages.send(b.peerId, 'one');
    await hub.messages.send(b.peerId, 'two');
    await hub.messages.send(c.peerId, 'only one for C');

    await waitFor(
      () => b.conversationWith(hub.peerId).length === 2,
      'B to receive both',
    );

    const forB = hub.peerManager.metricsSnapshot(b.peerId);
    const forC = hub.peerManager.metricsSnapshot(c.peerId);
    const forD = hub.peerManager.metricsSnapshot(d.peerId);

    expect(forB?.packetsTx).toBe(2);
    expect(forC?.packetsTx).toBe(1);
    expect(forD?.packetsTx).toBe(0);

    // Bytes are attributed per link. Early handshake traffic predates the peerId and
    // lands only in the session totals; the final authentication leg is sent after the
    // peer is known, so D shows handshake bytes but no message packets.
    expect(forB!.bytesTx).toBeGreaterThan(forC!.bytesTx);
    expect(forD!.packetsTx).toBe(0);
    expect(hub.session.snapshot().bytesTx).toBeGreaterThan(0);
  });

  it('reconnecting one peer flushes only that peer queue', async () => {
    await connectAll();

    await c.transport.disconnect(c.transport.linkIds[0]);
    await waitFor(() => !hub.isConnectedTo(c.peerId), 'C to drop');

    await hub.messages.send(c.peerId, 'held for C');
    await hub.messages.send(b.peerId, 'straight to B');

    expect(hub.messages.queue.countFor(c.peerId)).toBe(1);
    expect(hub.messages.queue.total).toBe(1);

    await hub.peerManager.connect(toCentralLinkId('deviceC'));
    await waitFor(() => hub.isConnectedTo(c.peerId), 'C to come back');
    await hub.messages.flushQueue(c.peerId);

    await waitFor(
      () => c.conversationWith(hub.peerId).some(m => m.text === 'held for C'),
      'C to receive what was held for it',
    );
    expect(hub.messages.queue.total).toBe(0);
  });
});
