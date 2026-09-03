/**
 * MessageService.deleteLocal: removes a message from this device's own copy only — the
 * peer that already received it keeps its copy, because there is no server to ask and no
 * way to unsend bytes another phone already has.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';

describe('deleteLocal', () => {
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

  it("removes the message from the sender's own view only", async () => {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => phoneA.isConnectedTo(phoneB.identity.peerId), 'A to connect to B');

    const sent = await phoneA.messages.send(phoneB.identity.peerId, 'hello there');
    await waitFor(
      () => phoneB.messages.getMessages(phoneA.identity.peerId).length > 0,
      'B to receive the message',
    );

    phoneA.messages.deleteLocal(phoneB.identity.peerId, sent.id);

    const aView = phoneA.messages.getMessages(phoneB.identity.peerId);
    const bView = phoneB.messages.getMessages(phoneA.identity.peerId);
    expect(aView.find(m => m.id === sent.id)).toBeUndefined();
    // B's copy is untouched — deletion is local, not a retraction.
    expect(bView.find(m => m.id === sent.id)).toBeDefined();
  });

  it('is a safe no-op for an id that does not exist', () => {
    expect(() =>
      phoneA.messages.deleteLocal('nobody', 'no-such-message'),
    ).not.toThrow();
  });
});
