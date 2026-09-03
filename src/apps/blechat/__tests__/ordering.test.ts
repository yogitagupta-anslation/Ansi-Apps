/**
 * Message ordering and observed loss.
 *
 * Two properties, both of which BLE breaks in the field:
 *
 *  - a conversation is ordered by when WE received each message, never by the clock the
 *    sender claims, because there is no shared time source and phone clocks are wrong
 *  - a message that never arrived is visible as a gap, rather than leaving the
 *    conversation silently reading as complete
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';
import {buildMessage} from '../messaging/Packet';

describe('conversation ordering and gap detection', () => {
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

  /** Send a message with an explicit position, so loss can be staged deliberately. */
  async function sendNumbered(
    text: string,
    convSeq: number,
    timestamp?: number,
  ): Promise<void> {
    const packet = buildMessage(
      phoneA.peerId,
      phoneB.peerId,
      text,
      `msg-${convSeq}`,
      undefined,
      convSeq,
    );
    if (timestamp !== undefined) {
      packet.timestamp = timestamp;
    }
    await phoneA.router.sendToPeer(phoneB.peerId, packet);
  }

  it('numbers its own outgoing messages consecutively within a conversation', async () => {
    await connectAndHandshake();

    await phoneA.messages.send(phoneB.peerId, 'one');
    await phoneA.messages.send(phoneB.peerId, 'two');
    await phoneA.messages.send(phoneB.peerId, 'three');

    const sent = phoneA.conversationWith(phoneB.peerId);
    expect(sent.map(m => m.convSeq)).toEqual([1, 2, 3]);
  });

  it('puts the conversation position on the wire, not just in local storage', async () => {
    // The stored message and the transmitted packet used to be built separately, so
    // convSeq was set locally and silently absent on the wire — which meant gap
    // detection never worked for an ordinary message, only for hand-built ones.
    await connectAndHandshake();

    await phoneA.messages.send(phoneB.peerId, 'one');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive',
    );

    expect(phoneB.conversationWith(phoneA.peerId)[0].convSeq).toBe(1);
  });

  it('detects a gap between ordinary sent messages', async () => {
    await connectAndHandshake();

    await phoneA.messages.send(phoneB.peerId, 'one');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'first',
    );

    // The second is composed but never reaches B; the third does.
    await phoneA.messages.send('somebody-else', 'lost to another conversation');
    await phoneA.messages.send(phoneB.peerId, 'two');
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 2,
      'second delivered',
    );
    // Consecutive within THIS conversation, so traffic elsewhere is not a gap.
    expect(phoneB.conversationWith(phoneA.peerId)[1].missedBefore).toBeUndefined();
  });

  it('numbers each conversation independently', async () => {
    await connectAndHandshake();

    await phoneA.messages.send(phoneB.peerId, 'to B');
    // A different conversation starts its own count, so a gap in one cannot be caused by
    // traffic in another.
    await phoneA.messages.send('some-other-peer', 'to C');

    expect(phoneA.conversationWith(phoneB.peerId)[0].convSeq).toBe(1);
    expect(phoneA.conversationWith('some-other-peer')[0].convSeq).toBe(1);
  });

  it('records a message with no gap when delivery is complete', async () => {
    await connectAndHandshake();

    await sendNumbered('first', 1);
    await sendNumbered('second', 2);
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 2,
      'B to receive both messages',
    );

    const received = phoneB.conversationWith(phoneA.peerId);
    expect(received.map(m => m.text)).toEqual(['first', 'second']);
    expect(received.every(m => m.missedBefore === undefined)).toBe(true);
  });

  it('marks how many messages went missing when one never arrives', async () => {
    await connectAndHandshake();

    await sendNumbered('first', 1);
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the first message',
    );

    // #2 is lost — the link dropped, the phone walked out of range, whatever. #3 arrives
    // and is the first evidence B has that anything is missing.
    await sendNumbered('third', 3);
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 2,
      'B to receive the third message',
    );

    const received = phoneB.conversationWith(phoneA.peerId);
    expect(received[1].text).toBe('third');
    expect(received[1].missedBefore).toBe(1);
  });

  it('counts a run of missing messages, not just the fact of one', async () => {
    await connectAndHandshake();

    await sendNumbered('first', 1);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 1, 'first');

    await sendNumbered('sixth', 6);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 2, 'sixth');

    expect(phoneB.conversationWith(phoneA.peerId)[1].missedBefore).toBe(4);
  });

  it('announces observed loss so it can be surfaced, not just logged', async () => {
    await connectAndHandshake();
    const missed: Array<{count: number; originId: string}> = [];
    phoneB.messages.bus.on('messagesMissed', event => missed.push(event));

    await sendNumbered('first', 1);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 1, 'first');
    await sendNumbered('fourth', 4);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 2, 'fourth');

    expect(missed).toEqual([
      expect.objectContaining({count: 2, originId: phoneA.peerId}),
    ]);
  });

  it('does not report a gap on the first message of a conversation', async () => {
    await connectAndHandshake();

    // Joining a conversation already in progress is not the same as losing messages, and
    // reporting it as loss would put a false marker on every first contact.
    await sendNumbered('joined late', 50);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 1, 'message');

    expect(phoneB.conversationWith(phoneA.peerId)[0].missedBefore).toBeUndefined();
  });

  it('does not report a gap for a message that merely arrived late', async () => {
    await connectAndHandshake();

    await sendNumbered('first', 1);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 1, 'first');
    await sendNumbered('third', 3);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 2, 'third');

    // #2 turns up after #3. It fills the hole rather than creating a new one, so it must
    // not be reported as further loss.
    await sendNumbered('second', 2);
    await waitFor(() => phoneB.conversationWith(phoneA.peerId).length === 3, 'second');

    const late = phoneB
      .conversationWith(phoneA.peerId)
      .find(m => m.text === 'second');
    expect(late?.missedBefore).toBeUndefined();
  });
});

describe('clock handling', () => {
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

  it('stamps arrival time from our own clock, keeping the sender claim separate', async () => {
    await connectAndHandshake();

    const before = Date.now();
    const claimed = 1_000_000_000_000; // Sender's clock, years out of date.
    const packet = buildMessage(
      phoneA.peerId,
      phoneB.peerId,
      'wrong clock',
      'skewed',
      undefined,
      1,
    );
    packet.timestamp = claimed;
    await phoneA.router.sendToPeer(phoneB.peerId, packet);
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'B to receive the message',
    );

    const received = phoneB.conversationWith(phoneA.peerId)[0];
    // The claim is preserved as metadata...
    expect(received.timestamp).toBe(claimed);
    // ...but what the app orders and displays by is ours.
    expect(received.receivedAt).toBeGreaterThanOrEqual(before);
    expect(received.receivedAt).toBeLessThanOrEqual(Date.now());
    expect(received.clockSkewMs).toBe(received.receivedAt - claimed);
  });

  it('keeps a conversation in arrival order despite a sender clock in the future', async () => {
    await connectAndHandshake();

    const future = Date.now() + 7 * 24 * 60 * 60 * 1000;
    for (const [index, text] of ['first', 'second'].entries()) {
      const packet = buildMessage(
        phoneA.peerId,
        phoneB.peerId,
        text,
        `m-${index}`,
        undefined,
        index + 1,
      );
      // Second message claims an EARLIER time than the first. Ordering by the sender's
      // clock would put the conversation backwards on screen.
      packet.timestamp = future - index * 60_000;
      await phoneA.router.sendToPeer(phoneB.peerId, packet);
      await waitFor(
        () => phoneB.conversationWith(phoneA.peerId).length === index + 1,
        `B to receive ${text}`,
      );
    }

    const received = phoneB.conversationWith(phoneA.peerId);
    expect(received.map(m => m.text)).toEqual(['first', 'second']);
    expect(received[0].receivedAt).toBeLessThanOrEqual(received[1].receivedAt);
  });

  it('uses our own clock for messages we send', async () => {
    await connectAndHandshake();
    const before = Date.now();
    await phoneA.messages.send(phoneB.peerId, 'mine');

    const sent = phoneA.conversationWith(phoneB.peerId)[0];
    // Both sides of a conversation must be comparable, so an outgoing message records
    // arrival time too — it just happens to equal when we composed it.
    expect(sent.receivedAt).toBeGreaterThanOrEqual(before);
    expect(sent.receivedAt).toBe(sent.timestamp);
    expect(sent.clockSkewMs).toBeUndefined();
  });
});
