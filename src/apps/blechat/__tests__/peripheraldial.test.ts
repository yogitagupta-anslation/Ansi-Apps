/**
 * Dialling a link we do not own must never be recorded against the link we do.
 *
 * On the receiving phone, the live link to a peer is the PERIPHERAL one — the remote
 * side opened it, and only the remote side can. Tapping anything that tried to dial it
 * used to produce a transport rejection ("Only central links can be dialled"), which was
 * then routed through `recordFailure` and marked the peer `failed`. That is the wrong
 * conclusion drawn from the right refusal: the link was up and delivering messages, but
 * the chat header read "Connection failed" and the composer was disabled, so the phone
 * that had just received a message could not answer it.
 *
 * The behaviour under test is therefore not "the dial fails" — it is that a peer with a
 * healthy peripheral link is still connected, and can still send, afterwards.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';

describe('dialling a peripheral link', () => {
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

  /** A connects to B, so B holds the peripheral end of a live link. */
  async function linkThem(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () => phoneB.peerManager.getPeers().some(p => p.state === 'connected'),
      'B to hold a connected peripheral link',
    );
  }

  it('leaves the live peripheral link connected', async () => {
    await linkThem();

    const before = phoneB.peerManager.getPeers().find(p => p.state === 'connected');
    expect(before).toBeDefined();
    expect(before!.role).toBe('peripheral');

    // What the "Connect" affordance used to do on the receiving phone.
    await phoneB.peerManager.connect(before!.linkId!);

    const after = phoneB.peerManager.getPeers().find(p => p.peerId === before!.peerId);
    expect(after!.state).toBe('connected');
    expect(after!.failure ?? null).toBeNull();
  });

  it('does not reject, so no caller can mistake it for a link problem', async () => {
    await linkThem();
    const peer = phoneB.peerManager.getPeers().find(p => p.state === 'connected')!;
    await expect(phoneB.peerManager.connect(peer.linkId!)).resolves.toBeUndefined();
  });

  it('can still send over that link afterwards', async () => {
    await linkThem();
    const peer = phoneB.peerManager.getPeers().find(p => p.state === 'connected')!;

    await phoneB.peerManager.connect(peer.linkId!);

    // The whole point: the phone that received a message can answer it.
    await phoneB.messages.send(peer.peerId!, 'replying over the peripheral link');
    await waitFor(
      () =>
        phoneA.messages
          .getMessages(phoneB.identity!.peerId)
          .some(m => m.text === 'replying over the peripheral link'),
      "A to receive B's reply",
    );
  });
});
