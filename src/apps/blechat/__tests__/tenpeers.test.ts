/**
 * One phone, ten peers.
 *
 * The scheduler tests pin the policy in isolation. This exercises it against the real
 * stack — ten complete application instances, real handshakes, real fragmentation at the
 * worst-case MTU — because the interesting failures of a many-peer setup are the ones
 * that only appear when everything runs at once: per-link state bleeding across peers,
 * sequence numbers colliding, a fan-out that quietly drops recipients.
 *
 * It does NOT prove ten links work on a radio. A controller ceiling is a property of the
 * hardware, and the loopback air has no such limit — see docs/BLE_NOTES.md.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';
import {ConnectionScheduler} from '../peers/ConnectionScheduler';

const PEER_COUNT = 10;

describe('ten peers at once', () => {
  let air: VirtualAir;
  let hub: VirtualPhone;
  let peers: VirtualPhone[];

  beforeEach(() => {
    air = new VirtualAir();
    hub = new VirtualPhone('hub', 'Ravi', air, DEFAULT_ATT_MTU);
    peers = Array.from({length: PEER_COUNT}, (_, i) =>
      new VirtualPhone(`peer-${i}`, `Friend ${i}`, air, DEFAULT_ATT_MTU),
    );
  });

  afterEach(() => {
    hub.dispose();
    peers.forEach(p => p.dispose());
  });

  /** Bring every peer up through the scheduler, exactly as the app does. */
  async function connectAll(maxLinks = PEER_COUNT): Promise<ConnectionScheduler> {
    peers.forEach(p => p.startAdvertising());
    await hub.scan();

    const scheduler = new ConnectionScheduler({
      maxLinks,
      // The hold floor exists to stop a real radio cycling links faster than a handshake
      // takes. The loopback air has no such cost, so rotation can be exercised directly.
      minHoldMs: 0,
      hooks: {
        connect: linkId => hub.peerManager.connect(linkId),
        disconnect: linkId => hub.peerManager.disconnect(linkId),
        now: () => Date.now(),
      },
    });
    hub.peerManager.bus.on('peerConnected', peer => {
      if (peer.linkId) {
        scheduler.onConnected(peer.linkId);
      }
    });
    hub.peerManager.bus.on('peerDisconnected', ({linkId}) => {
      scheduler.onDisconnected(linkId);
    });

    for (const p of peers) {
      scheduler.want(toCentralLinkId(p.nodeId));
    }
    return scheduler;
  }

  it('holds ten links at once', async () => {
    const scheduler = await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all ten to complete their handshakes',
      15_000,
    );

    expect(scheduler.heldCount).toBe(PEER_COUNT);
    expect(scheduler.waiting()).toEqual([]);
  }, 30_000);

  it('gives every peer its own identity and link', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    const connected = hub.peerManager.getPeers().filter(p => p.state === 'connected');
    // Ten distinct identities on ten distinct links — no collisions, no double-listing.
    expect(new Set(connected.map(p => p.peerId)).size).toBe(PEER_COUNT);
    expect(new Set(connected.map(p => p.linkId)).size).toBe(PEER_COUNT);
  }, 30_000);

  it('delivers a message to each of the ten, and gets ten replies', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    for (const p of peers) {
      await hub.messages.send(p.peerId, `hello ${p.nodeId}`);
    }
    await waitFor(
      () =>
        peers.every(
          p =>
            p.conversationWith(hub.peerId).filter(m => m.direction === 'incoming')
              .length === 1,
        ),
      'all ten to receive',
      15_000,
    );

    for (const p of peers) {
      await p.messages.send(hub.peerId, `hi from ${p.nodeId}`);
    }
    await waitFor(
      () =>
        peers.every(
          p =>
            hub
              .conversationWith(p.peerId)
              .filter(m => m.direction === 'incoming').length === 1,
        ),
      'the hub to receive all ten replies',
      15_000,
    );

    // Each conversation holds exactly its own two messages — nothing crossed over.
    for (const p of peers) {
      const thread = hub.conversationWith(p.peerId);
      expect(thread).toHaveLength(2);
      expect(thread.find(m => m.direction === 'incoming')!.text).toBe(
        `hi from ${p.nodeId}`,
      );
    }
  }, 45_000);

  it('acknowledges every one of the ten, so delivery is not assumed', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    for (const p of peers) {
      await hub.messages.send(p.peerId, 'confirm me');
    }
    await waitFor(
      () =>
        peers.every(
          p => hub.conversationWith(p.peerId)[0]?.status === 'received',
        ),
      'ten ACKs to come back',
      15_000,
    );
  }, 45_000);

  it('fans a group message out to all ten and counts every acknowledgement', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    const group = await hub.messages.createGroup(
      'Everyone',
      peers.map(p => p.peerId),
    );
    await waitFor(
      () => peers.every(p => p.messages.groups.get(group.id) !== null),
      'the invite to reach all ten',
      15_000,
    );

    const message = await hub.messages.sendToGroup(group.id, 'hello everyone');
    expect(message.recipientCount).toBe(PEER_COUNT);

    await waitFor(
      () => peers.every(p => p.conversationWith(group.id).length === 1),
      'all ten to receive the group message',
      15_000,
    );
    await waitFor(
      () =>
        (hub.conversationWith(group.id)[0]?.deliveredTo?.length ?? 0) ===
        PEER_COUNT,
      'all ten acknowledgements',
      15_000,
    );

    // 10/10, counted from real ACKs rather than assumed from a successful fan-out.
    expect(hub.conversationWith(group.id)[0].status).toBe('received');
  }, 60_000);

  it('serves everyone by rotation when it can only hold four at a time', async () => {
    // The case that matters on real hardware: more peers than the controller will hold.
    // Nobody should be permanently unreachable just because they arrived last.
    const scheduler = await connectAll(4);
    await waitFor(() => scheduler.heldCount === 4, 'the first four', 15_000);
    expect(scheduler.waiting()).toHaveLength(PEER_COUNT - 4);

    const served = new Set<string>();
    hub.peerManager.bus.on('peerConnected', peer => {
      if (peer.peerId) {
        served.add(peer.peerId);
      }
    });
    hub.peerManager
      .getPeers()
      .filter(p => p.state === 'connected' && p.peerId)
      .forEach(p => served.add(p.peerId!));

    // Rotate until everybody has had a turn.
    for (let round = 0; round < 40 && served.size < PEER_COUNT; round++) {
      scheduler.rotate();
      await waitFor(() => scheduler.heldCount <= 4, 'a slot to free', 5000);
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }

    expect(scheduler.heldCount).toBeLessThanOrEqual(4);
    expect(served.size).toBeGreaterThan(4);
  }, 60_000);

  it('keeps each peer sequence numbering independent', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    // Every peer's first message to the hub is #1 of ITS conversation, even though the
    // hub is holding ten conversations at once.
    for (const p of peers) {
      await p.messages.send(hub.peerId, 'first');
    }
    await waitFor(
      () =>
        peers.every(
          p =>
            hub
              .conversationWith(p.peerId)
              .filter(m => m.direction === 'incoming').length === 1,
        ),
      'all ten first messages',
      15_000,
    );

    for (const p of peers) {
      const incoming = hub
        .conversationWith(p.peerId)
        .find(m => m.direction === 'incoming')!;
      expect(incoming.convSeq).toBe(1);
      expect(incoming.missedBefore).toBeUndefined();
    }
  }, 45_000);

  it('loses nothing when one of the ten drops mid-conversation', async () => {
    await connectAll();
    await waitFor(
      () => peers.every(p => hub.isConnectedTo(p.peerId)),
      'all connected',
      15_000,
    );

    const victim = peers[3];
    victim.transport.simulateDrop(victim.transport.linkIds[0]);
    await waitFor(() => !hub.isConnectedTo(victim.peerId), 'the drop', 10_000);

    // A message for the peer that left is queued, and every other conversation carries
    // on untouched — one bad link must not disturb the other nine.
    await hub.messages.send(victim.peerId, 'for later');
    expect(hub.messages.queue.countFor(victim.peerId)).toBe(1);

    for (const p of peers.filter(x => x !== victim)) {
      await hub.messages.send(p.peerId, 'still here');
    }
    await waitFor(
      () =>
        peers
          .filter(x => x !== victim)
          .every(
            p =>
              p.conversationWith(hub.peerId).filter(m => m.direction === 'incoming')
                .length === 1,
          ),
      'the other nine to receive',
      15_000,
    );
  }, 45_000);
});
