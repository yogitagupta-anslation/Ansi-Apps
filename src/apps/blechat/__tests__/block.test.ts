/**
 * Block/unblock: refused at the handshake for an identity never seen before, dropped
 * immediately for one already connected, and never auto-reconnected to while blocked.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';

describe('block list', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  it('refuses the handshake with an identity blocked before it was ever met', async () => {
    // Blocked purely by peerId — A has never connected to or even seen B advertise yet.
    phoneA.peerManager.blockPeer(phoneB.identity.peerId);

    phoneB.startAdvertising();
    await phoneA.scan();
    await expect(
      phoneA.peerManager.connect(toCentralLinkId('deviceB')),
    ).resolves.toBeUndefined(); // the BLE link itself opens; the handshake is what refuses

    await waitFor(() => {
      const failed = phoneA.peerManager
        .getPeers()
        .find(p => p.linkId === toCentralLinkId('deviceB'));
      return failed?.failure?.reason === 'Blocked';
    }, 'A to reject B as blocked');

    expect(phoneA.isConnectedTo(phoneB.identity.peerId)).toBe(false);
    // B's side of the handshake was answered and then torn down, not silently ignored.
    expect(phoneB.isConnectedTo(phoneA.identity.peerId)).toBe(false);
  });

  it('drops a live connection the moment the peer is blocked', async () => {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.identity.peerId), 'A to connect to B');

    phoneA.peerManager.blockPeer(phoneB.identity.peerId);

    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.identity.peerId),
      'A to drop the connection once B is blocked',
    );
  });

  it('does not auto-reconnect to a peer that was blocked while it was away', async () => {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.identity.peerId), 'A to connect to B');

    // Enable auto-reconnect just for this test, then take the link down from B's side —
    // the case a block has to survive is exactly "the link drops, then reconnect fires".
    phoneA.peerManager.setAutoReconnect(true);
    phoneA.peerManager.blockPeer(phoneB.identity.peerId);
    await phoneB.peerManager.disconnect(phoneA.identity.peerId);

    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.identity.peerId),
      'A to see the link go down',
    );

    // Give any (wrongly-scheduled) reconnect timer a chance to fire before asserting
    // it never did.
    await new Promise<void>(resolve => setTimeout(resolve, 50));
    expect(phoneA.isConnectedTo(phoneB.identity.peerId)).toBe(false);
  });

  it('unblocking allows a fresh connection again', async () => {
    phoneA.peerManager.blockPeer(phoneB.identity.peerId);
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => {
      const failed = phoneA.peerManager
        .getPeers()
        .find(p => p.linkId === toCentralLinkId('deviceB'));
      return failed?.failure?.reason === 'Blocked';
    }, 'A to reject B as blocked');

    phoneA.peerManager.unblockPeer(phoneB.identity.peerId);
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () => phoneA.isConnectedTo(phoneB.identity.peerId),
      'A to connect to B once unblocked',
    );
  });

  it('refuses to dial a link already known to belong to a blocked peer', async () => {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.identity.peerId), 'A to connect to B');
    await phoneA.peerManager.disconnect(phoneB.identity.peerId);
    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.identity.peerId),
      'A to fully disconnect from B',
    );

    phoneA.peerManager.blockPeer(phoneB.identity.peerId);

    // A already knows this linkId belongs to a blocked identity, so it refuses to dial
    // at all — no handshake round-trip needed to find that out a second time.
    await expect(
      phoneA.peerManager.connect(toCentralLinkId('deviceB')),
    ).rejects.toThrow('blocked');
  });
});
