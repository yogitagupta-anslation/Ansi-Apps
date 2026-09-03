/**
 * Selective retransmission.
 *
 * Before this existed, a single lost fragment lost the whole message — at a 23-byte MTU
 * that is 60+ frames thrown away because one went missing at the edge of range. These
 * tests drop frames deliberately and assert the message still arrives, and that recovery
 * costs only the frames that were actually lost.
 */
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {toCentralLinkId} from '../utils/linkId';
import {
  buildNack,
  fragment,
  parseFrame,
  Reassembler,
} from '../messaging/Fragmentation';
import {DEFAULT_ATT_MTU, NACK_MAX_ROUNDS} from '../config/constants';
import {utf8Encode} from '../utils/bytes';

describe('frame format', () => {
  it('round-trips a DATA header', () => {
    const [frame] = fragment(utf8Encode('hi'), 512, 1234);
    const parsed = parseFrame(frame);
    expect(parsed).toEqual({kind: 'data', streamId: 1234, index: 0, count: 1});
  });

  it('round-trips a NACK with its missing indices', () => {
    const parsed = parseFrame(buildNack(77, 40, [3, 17, 39]));
    expect(parsed).toEqual({
      kind: 'nack',
      streamId: 77,
      count: 40,
      missing: [3, 17, 39],
    });
  });

  it('rejects an unknown frame type', () => {
    const frame = fragment(utf8Encode('x'), 512, 1)[0];
    frame[2] = 0x7e;
    expect(parseFrame(frame)).toBeNull();
  });
});

describe('reassembler gap reporting', () => {
  it('names exactly the fragments that are missing', () => {
    const frames = fragment(utf8Encode('y'.repeat(200)), DEFAULT_ATT_MTU, 5);
    const r = new Reassembler('gaps');

    frames.forEach((f, i) => {
      if (i !== 2 && i !== 7) {
        r.push(f);
      }
    });

    const stale = r.incompleteStreams(0, Date.now() + 10_000);
    expect(stale).toHaveLength(1);
    expect(stale[0].missing).toEqual([2, 7]);
    expect(stale[0].rounds).toBe(0);
  });

  it('stays quiet while fragments are still arriving', () => {
    const frames = fragment(utf8Encode('z'.repeat(200)), DEFAULT_ATT_MTU, 6);
    const r = new Reassembler('quiet');
    r.push(frames[0]);

    // A generous quiet period has not elapsed, so nothing is chased yet — asking for
    // frames still in flight would only add congestion.
    expect(r.incompleteStreams(5_000)).toHaveLength(0);
  });

  it('counts rounds so a hopeless stream can be abandoned', () => {
    const frames = fragment(utf8Encode('w'.repeat(200)), DEFAULT_ATT_MTU, 8);
    const r = new Reassembler('rounds');
    r.push(frames[0]);

    const future = Date.now() + 10_000;
    r.markNackSent(8, future);
    expect(r.incompleteStreams(0, future + 1)[0].rounds).toBe(1);

    r.drop(8);
    expect(r.pendingStreams).toBe(0);
  });
});

describe('recovery over a lossy link', () => {
  let air: VirtualAir;
  let a: VirtualPhone;
  let b: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    a = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    b = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    a.dispose();
    b.dispose();
  });

  async function connect(): Promise<void> {
    b.startAdvertising();
    await a.scan();
    await a.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(() => a.isConnectedTo(b.peerId), 'handshake');
  }

  /** Drive both ends' retransmission timers, as the real transport's interval does. */
  async function pump(rounds = 6): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      const future = Date.now() + 10_000 * (i + 1);
      a.transport.pumpArq(future);
      b.transport.pumpArq(future);
      await new Promise<void>(resolve => setTimeout(() => resolve(), 5));
    }
  }

  it('recovers a long message when every 5th frame is dropped', async () => {
    await connect();

    const long = 'The quick brown fox jumps. '.repeat(20).trim();
    a.transport.dropEveryNthFrame = 5;
    await a.messages.send(b.peerId, long);

    // Stop dropping so the retransmissions can get through.
    a.transport.dropEveryNthFrame = 0;
    expect(a.transport.droppedFrames).toBeGreaterThan(0);

    await pump();
    await waitFor(
      () => b.messages.getMessages(a.peerId).length === 1,
      'B to receive the recovered message',
    );

    expect(b.messages.getMessages(a.peerId)[0].text).toBe(long);
  });

  it('retransmits only the missing frames, not the whole message', async () => {
    await connect();

    const long = 'abcdefghij '.repeat(30).trim();
    const framesBefore = a.transport.sentFrameCount;

    a.transport.dropEveryNthFrame = 7;
    await a.messages.send(b.peerId, long);
    const framesForFirstPass = a.transport.sentFrameCount - framesBefore;
    const dropped = a.transport.droppedFrames;

    a.transport.dropEveryNthFrame = 0;
    await pump();
    await waitFor(
      () => b.messages.getMessages(a.peerId).length === 1,
      'B to receive it',
    );

    const retransmitted =
      a.transport.sentFrameCount - framesBefore - framesForFirstPass;

    // Recovery costs roughly the number of lost frames, not another full message.
    expect(retransmitted).toBeGreaterThan(0);
    expect(retransmitted).toBeLessThan(framesForFirstPass);
    expect(retransmitted).toBeLessThanOrEqual(dropped * 2);
  });

  it('gives up after a bounded number of attempts on a dead link', async () => {
    await connect();

    // Persistent loss: the missing frames never get through.
    a.transport.dropEveryNthFrame = 2;
    await a.messages.send(b.peerId, 'x'.repeat(300));

    await pump(NACK_MAX_ROUNDS + 3);

    // Nothing is delivered, and the receiver is not left holding a partial stream.
    expect(b.messages.getMessages(a.peerId)).toHaveLength(0);
    expect(b.transport.pendingStreamCount).toBe(0);
  });

  it('still delivers cleanly when nothing is dropped', async () => {
    await connect();
    await a.messages.send(b.peerId, 'no loss here');

    await waitFor(
      () => b.messages.getMessages(a.peerId).length === 1,
      'B to receive it',
    );
    // A clean transfer must not generate retransmission traffic.
    await pump(2);
    expect(b.messages.getMessages(a.peerId)).toHaveLength(1);
  });
});
