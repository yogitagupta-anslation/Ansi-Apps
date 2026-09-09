/**
 * A greeting that never left the phone must not be reported as silence from the peer.
 *
 * Seen on two real devices: the link comes up, MTU and service discovery succeed, the
 * HELLO write is rejected by the stack — and the row sits on "Saying hello..." for
 * fifteen seconds before recording HandshakeTimeout, "Peer did not answer HELLO". The
 * peer answered nothing because it was never asked. Then auto-reconnect dials into the
 * same wall, which is what "it never connects and never tells me why" looks like.
 */
import {PeerManager} from '../peers/PeerManager';
import {LoopbackTransport, VirtualAir} from './support/LoopbackTransport';
import {SessionRegistry} from '../crypto/SessionRegistry';
import {MessageRouter} from '../messaging/MessageRouter';

const LINK = 'c:aa:bb:cc:dd:ee';

/**
 * A manager whose link comes up normally but whose first write is refused — the exact
 * shape of the failure the phones produced.
 */
function managerWithRefusedWrites(): {manager: PeerManager; transport: LoopbackTransport} {
  const transport = new LoopbackTransport('n1', new VirtualAir(), 'Me', 'aabb', 185);
  const manager = new PeerManager(transport, new SessionRegistry());
  const router = {
    // Only the two members PeerManager touches here: it subscribes on attach, and
    // sends the greeting.
    on: () => undefined,
    sendOnLink: () => Promise.reject(new Error('Operation was rejected')),
  } as unknown as MessageRouter;
  manager.attachRouter(router);
  return {manager, transport};
}

it('records the write failure, not a timeout blamed on the peer', async () => {
  const {manager, transport} = managerWithRefusedWrites();
  manager.setIdentity({
    peerId: 'a'.repeat(16),
    displayName: 'Me',
    publicKey: 'b'.repeat(64),
    privateKey: 'c'.repeat(64),
  });

  manager.start();
  transport.bus.emit('linkUp', {linkId: LINK, role: 'central'});
  // One turn for the rejected write to be handled — not the fifteen seconds the
  // handshake timeout would have taken.
  await new Promise(resolve => setTimeout(resolve, 0));

  const peer = manager.getPeers().find(p => p.linkId === LINK);
  expect(peer?.state).toBe('failed');
  expect(peer?.failure?.reason).toBe('HandshakeFailed');
  expect(peer?.failure?.message).toContain('Could not send the greeting');
  // The wrong answer this replaces.
  expect(peer?.failure?.reason).not.toBe('HandshakeTimeout');
});
