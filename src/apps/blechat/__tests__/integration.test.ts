/**
 * End-to-end protocol test: two complete application stacks talking to each other over an
 * in-memory link, with real fragmentation at the worst-case 23-byte ATT MTU.
 *
 * This is the Phase 1 acceptance script with the radio removed. It proves the protocol
 * above the radio is correct; it does NOT prove BLE works. Only two physical phones can
 * do that — see docs/TESTING.md.
 */
import {VirtualAir, LoopbackTransport} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU, PROTOCOL_VERSION} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';
import {buildMessage} from '../messaging/Packet';

describe('two phones over a virtual link', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    // Worst-case MTU on purpose: 20 usable bytes per write, so even "Hello" fragments.
    phoneA = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connectAndHandshake(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to complete the handshake',
    );
  }

  it('discovers a peer only when it is advertising', async () => {
    const seen: string[] = [];
    phoneA.transport.onDiscovered(e => seen.push(e.linkId));

    await phoneA.scan();
    expect(seen).toHaveLength(0);

    phoneB.startAdvertising();
    await phoneA.scan();
    expect(seen).toContain(toCentralLinkId('deviceB'));
  });

  it('completes the HELLO / HELLO_ACK handshake and exchanges identity', async () => {
    await connectAndHandshake();

    const bAsSeenByA = phoneA.peerManager.getPeer(phoneB.peerId);
    const aAsSeenByB = phoneB.peerManager.getPeer(phoneA.peerId);

    expect(bAsSeenByA?.displayName).toBe('Phone B');
    expect(aAsSeenByB?.displayName).toBe('Phone A');
    // The dialling side is the central; the other end sees itself as the peripheral.
    expect(bAsSeenByA?.role).toBe('central');
    expect(aAsSeenByB?.role).toBe('peripheral');
    expect(bAsSeenByA?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(bAsSeenByA?.capabilities?.relay).toBe(true);
    // Both ends proved ownership of the key their peerId commits to.
    expect(bAsSeenByA?.authenticated).toBe(true);
    expect(aAsSeenByB?.authenticated).toBe(true);
    expect(bAsSeenByA?.publicKey).toBe(phoneB.identity.publicKey);
  });

  it('delivers Hello from A to B and Hi back from B to A, with ACKs', async () => {
    await connectAndHandshake();

    // --- A sends "Hello" -------------------------------------------------
    await phoneA.messages.send(phoneB.peerId, 'Hello');

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive Hello',
    );
    const received = phoneB.conversationWith(phoneA.peerId)[0];
    expect(received.text).toBe('Hello');
    expect(received.direction).toBe('incoming');

    // A only reports delivery once B's application-level ACK comes back.
    await waitFor(
      () => phoneA.conversationWith(phoneB.peerId)[0].status === 'received',
      'A to receive the ACK for Hello',
    );

    // --- B replies "Hi" --------------------------------------------------
    await phoneB.messages.send(phoneA.peerId, 'Hi');

    await waitFor(
      () => phoneA.conversationWith(phoneB.peerId).length === 2,
      'A to receive Hi',
    );
    const reply = phoneA
      .conversationWith(phoneB.peerId)
      .find(m => m.direction === 'incoming');
    expect(reply?.text).toBe('Hi');

    await waitFor(
      () =>
        phoneB.conversationWith(phoneA.peerId).find(m => m.direction === 'outgoing')
          ?.status === 'received',
      'B to receive the ACK for Hi',
    );

    expect(phoneA.router.getCounters().ack).toBeGreaterThanOrEqual(1);
    expect(phoneB.router.getCounters().ack).toBeGreaterThanOrEqual(1);
  });

  it('carries a long message intact across many fragments', async () => {
    await connectAndHandshake();

    // 1200 chars at 20 usable bytes per write is well over 60 fragments.
    const long = 'The quick brown fox. '.repeat(60).trim();
    await phoneA.messages.send(phoneB.peerId, long);

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to reassemble the long message',
    );
    expect(phoneB.conversationWith(phoneA.peerId)[0].text).toBe(long);
  });

  it('preserves unicode through fragmentation', async () => {
    await connectAndHandshake();

    const text = 'héllo 🚀 日本語 — offline mesh';
    await phoneA.messages.send(phoneB.peerId, text);

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the unicode message',
    );
    expect(phoneB.conversationWith(phoneA.peerId)[0].text).toBe(text);
  });

  it('keeps messages in order when several are sent back to back', async () => {
    await connectAndHandshake();

    await Promise.all([
      phoneA.messages.send(phoneB.peerId, 'one'),
      phoneA.messages.send(phoneB.peerId, 'two'),
      phoneA.messages.send(phoneB.peerId, 'three'),
    ]);

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 3,
      'B to receive all three messages',
    );
    expect(phoneB.conversationWith(phoneA.peerId).map(m => m.text)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('puts no readable message text on the air', async () => {
    await connectAndHandshake();

    // Everything phone B receives after the handshake, exactly as it crossed the link.
    const frames: Uint8Array[] = [];
    phoneB.transport.onData(({data}) => frames.push(data.slice()));

    const secret = 'the codeword is albatross';
    await phoneA.messages.send(phoneB.peerId, secret);
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the message',
    );

    // It arrived and decrypted correctly...
    expect(phoneB.conversationWith(phoneA.peerId)[0].text).toBe(secret);

    // ...but nothing recognisable travelled. Checked over the concatenation of every
    // frame so a fragment boundary cannot hide a leak: at a 23-byte MTU this message
    // spans several writes.
    const wire = frames
      .map(f => Array.from(f, byte => String.fromCharCode(byte)).join(''))
      .join('');
    expect(wire).not.toContain('albatross');
    expect(wire).not.toContain('codeword');
    expect(wire).not.toContain('MESSAGE');
    expect(wire).not.toContain(phoneA.peerId);
  });

  it('rejects a captured frame replayed verbatim, even after the id cache forgets it', async () => {
    await connectAndHandshake();

    // Capture the actual BYTES that crossed the link. Now that the link is encrypted
    // this is genuinely all an attacker in radio range has: ciphertext. Re-encoding a
    // decoded packet, as this test used to, would simulate an attacker who already has
    // the session key — a strictly weaker adversary than the real one.
    let capturedFrame: Uint8Array | null = null;
    phoneB.transport.onData(({data}) => {
      // The last frame before delivery is the message itself; handshake frames are
      // already done by this point.
      capturedFrame = data.slice();
    });

    await phoneA.messages.send(phoneB.peerId, 'only once');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the message',
    );
    expect(capturedFrame).not.toBeNull();

    const link = phoneB.transport.linkIds[0];
    const before = phoneB.router.getCounters().dropped;
    phoneB.router.handleInbound(link, capturedFrame!);

    // Refused by the session cipher's counter window before it can be decrypted, so it
    // never reaches the message layer at all.
    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(1);
    expect(phoneB.router.getCounters().dropped).toBe(before + 1);

    // The seen-id cache is a bounded LRU, so an attacker only had to wait for the id to
    // be evicted before replaying. Wiping it simulates that eviction — and the frame is
    // still refused, because being old is now a property of the encryption counter
    // rather than of what the application happens to remember.
    phoneB.router.seen.clear();
    phoneB.router.handleInbound(link, capturedFrame!);

    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(1);
    expect(phoneB.router.getCounters().dropped).toBe(before + 2);
  });

  it('cannot replay a frame captured before a reconnect', async () => {
    await connectAndHandshake();

    let capturedFrame: Uint8Array | null = null;
    phoneB.transport.onData(({data}) => {
      capturedFrame = data.slice();
    });
    await phoneA.messages.send(phoneB.peerId, 'before the drop');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the message',
    );
    expect(capturedFrame).not.toBeNull();

    // A reconnect derives brand new ephemeral keys, so an old frame is not merely
    // out-of-window — it is undecryptable. This is what forward secrecy buys.
    phoneB.transport.simulateDrop(phoneB.transport.linkIds[0]);
    await connectAndHandshake();

    const link = phoneB.transport.linkIds[0];
    const before = phoneB.router.getCounters().dropped;
    phoneB.router.handleInbound(link, capturedFrame!);

    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(1);
    expect(phoneB.router.getCounters().dropped).toBe(before + 1);
  });

  it('still treats an honest retransmission as a duplicate, not as a replay', async () => {
    await connectAndHandshake();
    await phoneA.messages.send(phoneB.peerId, 'sent once, transmitted twice');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the message',
    );

    // A resend of the same message: same id, but a fresh sequence number, because it is
    // genuinely being transmitted again rather than captured and replayed. The window
    // must let it through so the seen-id cache can recognise it for what it is.
    const original = phoneA.conversationWith(phoneB.peerId)[0];
    const resend = buildMessage(
      phoneA.peerId,
      phoneB.peerId,
      original.text,
      original.id,
    );
    await phoneA.router.sendToPeer(phoneB.peerId, resend);
    await waitFor(
      () => phoneB.router.getCounters().duplicates === 1,
      'B to recognise the retransmission as a duplicate',
    );

    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(1);
    expect(phoneB.router.getCounters().duplicates).toBe(1);
    expect(phoneB.router.getCounters().replayed).toBe(0);
  });

  it('queues a message when there is no route, without claiming it was sent', async () => {
    // No connection at all.
    await phoneA.messages.send(phoneB.peerId, 'into the void');

    const message = phoneA.conversationWith(phoneB.peerId)[0];
    // Held honestly: queued, never "sent", because nothing went over the radio.
    expect(message.status).toBe('pending');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);
  });

  it('delivers queued messages once the peer becomes reachable', async () => {
    await phoneA.messages.send(phoneB.peerId, 'sent while away');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);
    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(0);

    await connectAndHandshake();
    await phoneA.messages.flushQueue(phoneB.peerId);

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the queued message',
    );
    expect(phoneB.conversationWith(phoneA.peerId)[0].text).toBe('sent while away');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(0);

    await waitFor(
      () => phoneA.conversationWith(phoneB.peerId)[0].status === 'received',
      'the queued message to be acknowledged',
    );
  });

  it('preserves order when several messages are queued then flushed', async () => {
    await phoneA.messages.send(phoneB.peerId, 'first');
    await phoneA.messages.send(phoneB.peerId, 'second');
    await phoneA.messages.send(phoneB.peerId, 'third');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(3);

    await connectAndHandshake();
    await phoneA.messages.flushQueue(phoneB.peerId);

    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 3,
      'B to receive all queued messages',
    );
    expect(phoneB.conversationWith(phoneA.peerId).map(m => m.text)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('tears both ends down on disconnect', async () => {
    await connectAndHandshake();

    await phoneA.peerManager.disconnect(phoneB.peerId);

    await waitFor(
      () =>
        !phoneA.isConnectedTo(phoneB.peerId) &&
        !phoneB.isConnectedTo(phoneA.peerId),
      'both sides to register the disconnect',
    );

    // A send after the drop is queued rather than lost or falsely marked sent.
    await phoneA.messages.send(phoneB.peerId, 'after the drop');
    const queued = phoneA
      .conversationWith(phoneB.peerId)
      .find(m => m.text === 'after the drop');
    expect(queued?.status).toBe('pending');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);
  });

  it('reconnects and re-runs the handshake after a drop', async () => {
    await connectAndHandshake();
    await phoneA.peerManager.disconnect(phoneB.peerId);
    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.peerId),
      'the link to drop',
    );

    await connectAndHandshake();
    expect(phoneA.isConnectedTo(phoneB.peerId)).toBe(true);

    await phoneA.messages.send(phoneB.peerId, 'after reconnect');
    await waitFor(
      () =>
        phoneB
          .conversationWith(phoneA.peerId)
          .some(m => m.text === 'after reconnect'),
      'B to receive the post-reconnect message',
    );
  });

  it('does not deliver a partial message when a fragment is lost', async () => {
    await connectAndHandshake();

    // Drop one frame mid-stream; reassembly must never hand up a truncated payload.
    (phoneA.transport as LoopbackTransport).dropEveryNthFrame = 3;
    await phoneA.messages.send(phoneB.peerId, 'x'.repeat(400));

    await new Promise<void>(resolve => setTimeout(() => resolve(), 100));
    expect(phoneA.transport.droppedFrames).toBeGreaterThan(0);
    // Silence is the correct outcome — corrupted text would be far worse.
    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(0);
  });
});
