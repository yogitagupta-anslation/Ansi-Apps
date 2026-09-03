/**
 * The topology two real phones actually produce.
 *
 * Both handsets advertise AND scan, so both dial each other at the same moment. That
 * creates two links between the same pair of identities, and everything downstream — the
 * handshake, the duplicate-link tie-break, routing, ACKs — has to survive it.
 *
 * The existing simultaneous-dial tests are sequential: one side completes before the
 * other starts. These are the genuinely concurrent case, which is what happens in the
 * room.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';

describe('two phones dialling each other at once', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air);
    phoneA.startAdvertising();
    phoneB.startAdvertising();
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  /** Both dial before either handshake has had a chance to finish. */
  async function raceDial(): Promise<void> {
    await Promise.all([
      phoneA.peerManager.connect(toCentralLinkId('deviceB')).catch(() => undefined),
      phoneB.peerManager.connect(toCentralLinkId('deviceA')).catch(() => undefined),
    ]);
  }

  it('settles with both sides connected', async () => {
    await raceDial();

    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to settle on a live link',
      4000,
    );

    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);
    expect(phoneB.isConnectedTo(phoneA.peerId)).toBe(true);
  });

  it('lists the peer exactly once on each side', async () => {
    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    for (const [self, other] of [
      [phoneA, phoneB],
      [phoneB, phoneA],
    ] as const) {
      const entries = self.peerManager
        .getPeers()
        .filter(p => p.peerId === other.peerId);
      expect(entries).toHaveLength(1);
      expect(entries[0].state).toBe('connected');
    }
  });

  it('delivers a message in both directions afterwards', async () => {
    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    const incoming = (phone: VirtualPhone, from: string) =>
      phone.conversationWith(from).filter(m => m.direction === 'incoming');

    await phoneA.messages.send(phoneB.peerId, 'from A');
    await waitFor(
      () => incoming(phoneB, phoneA.peerId).length === 1,
      'B to receive',
      4000,
    );

    await phoneB.messages.send(phoneA.peerId, 'from B');
    await waitFor(
      () => incoming(phoneA, phoneB.peerId).length === 1,
      'A to receive',
      4000,
    );

    expect(incoming(phoneB, phoneA.peerId)[0].text).toBe('from A');
    expect(incoming(phoneA, phoneB.peerId)[0].text).toBe('from B');
  });

  it('acknowledges the message, so delivery is confirmed not assumed', async () => {
    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    await phoneA.messages.send(phoneB.peerId, 'confirm me');
    await waitFor(
      () => phoneA.conversationWith(phoneB.peerId)[0]?.status === 'received',
      'A to see the ACK come back',
      4000,
    );
  });

  it('does not drop traffic as spoofed while the links are being resolved', async () => {
    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    await phoneA.messages.send(phoneB.peerId, 'hello');
    await waitFor(
      () => phoneA.conversationWith(phoneB.peerId)[0]?.status === 'received',
      'delivery confirmed',
      4000,
    );

    // The tie-break tears one link down. Anything still in flight on the losing link
    // arrives with no session behind it — that must not be counted as an attack, and
    // more importantly must not cost us the message.
    expect(phoneA.router.getCounters().replayed).toBe(0);
    expect(phoneB.router.getCounters().replayed).toBe(0);
  });

  /**
   * The bug this file was written to catch.
   *
   * The tie-break closes one of the two links. That close looked exactly like a lost
   * link, so auto-reconnect chased it: re-dial, duplicate detected, torn down again,
   * re-dial. On two real phones that is a peer flickering between connected and
   * reconnecting indefinitely, and it never settles on its own.
   */
  it('does not chase the link the tie-break deliberately closed', async () => {
    const disconnects: string[] = [];
    phoneA.peerManager.bus.on('peerDisconnected', e => disconnects.push(e.peerId));
    phoneB.peerManager.bus.on('peerDisconnected', e => disconnects.push(e.peerId));

    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    const linksAfterSettling = [
      phoneA.transport.linkIds.length,
      phoneB.transport.linkIds.length,
    ];

    // Long enough for several rounds of the reconnect backoff to have fired.
    await new Promise<void>(resolve => setTimeout(resolve, 2500));

    // Still up, still one link each, and no phantom disconnect was ever reported.
    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);
    expect(phoneB.isConnectedTo(phoneA.peerId)).toBe(true);
    expect([
      phoneA.transport.linkIds.length,
      phoneB.transport.linkIds.length,
    ]).toEqual(linksAfterSettling);
    expect(disconnects).toEqual([]);
  }, 15000);

  it('still reports a genuinely lost link as lost', async () => {
    // The marker must not become a blanket "never report disconnects".
    await raceDial();
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides connected',
      4000,
    );

    const lost: string[] = [];
    phoneA.peerManager.bus.on('peerDisconnected', e => lost.push(e.peerId));

    phoneA.transport.simulateDrop(phoneA.transport.linkIds[0]);
    await waitFor(() => lost.length === 1, 'A to report the lost link', 4000);

    expect(lost).toEqual([phoneB.peerId]);
  });
});
