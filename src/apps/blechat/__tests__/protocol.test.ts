/**
 * Unit tests for the pure protocol logic.
 *
 * These prove the framing maths, not the radio. They cannot substitute for the
 * two-phone test — see docs/TESTING.md — but they do catch the class of bug that is
 * miserable to diagnose over a real BLE link, where a single dropped fragment just
 * looks like "the message never arrived".
 */
import {
  fragment,
  Reassembler,
  StreamIdGenerator,
  usableChunkSize,
} from '../messaging/Fragmentation';
import {JsonPacketCodec, PacketDecodeError} from '../messaging/PacketCodec';
import {SeenMessageStore} from '../messaging/Deduplication';
import {
  base64ToBytes,
  bytesToBase64,
  utf8Decode,
  utf8Encode,
} from '../utils/bytes';
import {
  DEFAULT_ATT_MTU,
  FRAGMENT_HEADER_SIZE,
  GATT_MAX_ATTR_LEN,
} from '../config/constants';

describe('byte utils', () => {
  it('round-trips base64 for every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      bytes[i] = i;
    }
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(
      Array.from(bytes),
    );
  });

  it('round-trips base64 at every length modulo 3', () => {
    for (let len = 0; len < 10; len++) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37) % 251);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(
        Array.from(bytes),
      );
    }
  });

  it('round-trips UTF-8 including multi-byte and astral characters', () => {
    const samples = ['Hello', 'Grüße', '日本語テキスト', 'emoji 🚀🛰️', ''];
    for (const s of samples) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });
});

describe('fragmentation', () => {
  it('leaves room for the fragment header on top of the ATT header', () => {
    expect(usableChunkSize(DEFAULT_ATT_MTU)).toBe(
      DEFAULT_ATT_MTU - 3 - FRAGMENT_HEADER_SIZE,
    );
  });

  /**
   * The bug that stopped every message this app ever tried to send.
   *
   * An attribute value cannot exceed 512 bytes, whatever the MTU — a separate ceiling
   * from the MTU and the reason a negotiated 517 is a trap. Frames were sized as
   * mtu - 3 - header, which is 514 at 517, and Android refused every one of them in the
   * GATT client before the radio was involved. Instant, total, and identical on every
   * device; the connection and its small writes worked throughout, so it read as a
   * peer problem for a long time.
   *
   * The old test only checked the default MTU of 23, where the arithmetic cannot
   * overshoot, which is precisely why it never caught this.
   */
  it('never builds a frame larger than an attribute can hold', () => {
    // 517 is what Android negotiates in practice, and the case that failed.
    for (const mtu of [DEFAULT_ATT_MTU, 100, 185, 247, 512, 515, 517, 1024]) {
      const payload = utf8Encode('x'.repeat(4000));
      for (const frame of fragment(payload, mtu, 1)) {
        expect(frame.length).toBeLessThanOrEqual(GATT_MAX_ATTR_LEN);
      }
    }
  });

  it('still fills the packet when the MTU is the tighter limit', () => {
    // The cap must not become a blanket 501: below 515 the MTU is what binds, and
    // shrinking frames there would cost throughput for no reason.
    expect(usableChunkSize(247)).toBe(247 - 3 - FRAGMENT_HEADER_SIZE);
    expect(usableChunkSize(517)).toBe(GATT_MAX_ATTR_LEN - FRAGMENT_HEADER_SIZE);
  });

  it('reassembles a payload split across many fragments at the default MTU', () => {
    const payload = utf8Encode(JSON.stringify({text: 'x'.repeat(500)}));
    const frames = fragment(payload, DEFAULT_ATT_MTU, 7);

    // 500+ bytes at 10 usable bytes per frame is a lot of fragments — exactly the case
    // that breaks when code assumes one write equals one message.
    expect(frames.length).toBeGreaterThan(50);
    for (const f of frames) {
      expect(f.length).toBeLessThanOrEqual(DEFAULT_ATT_MTU - 3);
    }

    const r = new Reassembler('test');
    let out: Uint8Array | null = null;
    for (const f of frames) {
      out = r.push(f) ?? out;
    }
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(payload));
  });

  it('returns null until the final fragment arrives', () => {
    const payload = utf8Encode('a'.repeat(100));
    const frames = fragment(payload, DEFAULT_ATT_MTU, 1);
    const r = new Reassembler('test');

    for (let i = 0; i < frames.length - 1; i++) {
      expect(r.push(frames[i])).toBeNull();
    }
    expect(r.push(frames[frames.length - 1])).not.toBeNull();
  });

  it('takes the single-fragment fast path for small payloads', () => {
    const payload = utf8Encode('hi');
    const frames = fragment(payload, 512, 3);
    expect(frames).toHaveLength(1);
    const r = new Reassembler('test');
    expect(Array.from(r.push(frames[0])!)).toEqual(Array.from(payload));
  });

  it('reassembles correctly when fragments arrive out of order', () => {
    const payload = utf8Encode('b'.repeat(200));
    const frames = fragment(payload, DEFAULT_ATT_MTU, 9);
    const shuffled = [...frames].reverse();

    const r = new Reassembler('test');
    let out: Uint8Array | null = null;
    for (const f of shuffled) {
      out = r.push(f) ?? out;
    }
    expect(Array.from(out!)).toEqual(Array.from(payload));
  });

  it('ignores duplicate fragments instead of corrupting the buffer', () => {
    const payload = utf8Encode('c'.repeat(60));
    const frames = fragment(payload, DEFAULT_ATT_MTU, 11);
    const r = new Reassembler('test');

    const delivered: Uint8Array[] = [];
    for (const f of frames) {
      // Feed every fragment twice, as a retransmitting BLE stack would.
      for (const attempt of [f, f]) {
        const done = r.push(attempt);
        if (done) {
          delivered.push(done);
        }
      }
    }

    // Exactly one delivery: duplicates must neither corrupt the buffer nor cause the
    // payload to be handed up a second time.
    expect(delivered).toHaveLength(1);
    expect(Array.from(delivered[0])).toEqual(Array.from(payload));
  });

  it('interleaves two concurrent streams without mixing them', () => {
    const a = utf8Encode('A'.repeat(80));
    const b = utf8Encode('B'.repeat(80));
    const framesA = fragment(a, DEFAULT_ATT_MTU, 100);
    const framesB = fragment(b, DEFAULT_ATT_MTU, 200);

    const r = new Reassembler('test');
    const results: Uint8Array[] = [];
    const max = Math.max(framesA.length, framesB.length);
    for (let i = 0; i < max; i++) {
      if (framesA[i]) {
        const done = r.push(framesA[i]);
        if (done) {
          results.push(done);
        }
      }
      if (framesB[i]) {
        const done = r.push(framesB[i]);
        if (done) {
          results.push(done);
        }
      }
    }
    expect(results).toHaveLength(2);
    const decoded = results.map(x => utf8Decode(x)).sort();
    expect(decoded).toEqual(['A'.repeat(80), 'B'.repeat(80)]);
  });

  it('rejects frames with a bad magic byte', () => {
    const frames = fragment(utf8Encode('hello'), 512, 1);
    const corrupted = new Uint8Array(frames[0]);
    corrupted[0] = 0x00;
    expect(new Reassembler('test').push(corrupted)).toBeNull();
  });

  it('rejects runt frames shorter than the header', () => {
    expect(new Reassembler('test').push(new Uint8Array(4))).toBeNull();
  });

  it('produces distinct stream ids', () => {
    const gen = new StreamIdGenerator();
    const ids = new Set(Array.from({length: 100}, () => gen.take()));
    expect(ids.size).toBe(100);
  });
});

describe('packet codec', () => {
  const codec = new JsonPacketCodec();

  it('round-trips a MESSAGE packet through the wire format', () => {
    const packet = {
      version: 1,
      id: 'abc-123',
      type: 'MESSAGE' as const,
      originId: 'aaaa',
      senderId: 'aaaa',
      destinationId: 'bbbb',
      seq: 1,
      timestamp: 1_700_000_000_000,
      ttl: 5,
      hopCount: 0,
      payload: {text: 'Hello'},
    };
    expect(codec.decode(codec.encode(packet))).toEqual(packet);
  });

  it('survives a full fragment round-trip at the worst-case MTU', () => {
    const packet = {
      version: 1,
      id: 'id-with-unicode',
      type: 'MESSAGE' as const,
      originId: 'a'.repeat(32),
      senderId: 'a'.repeat(32),
      destinationId: 'b'.repeat(32),
      seq: 7,
      timestamp: Date.now(),
      ttl: 5,
      hopCount: 2,
      payload: {text: 'héllo 🚀 over BLE'},
    };

    const frames = fragment(codec.encode(packet), DEFAULT_ATT_MTU, 42);
    const r = new Reassembler('test');
    let assembled: Uint8Array | null = null;
    for (const f of frames) {
      assembled = r.push(f) ?? assembled;
    }
    expect(codec.decode(assembled!)).toEqual(packet);
  });

  it('rejects malformed JSON', () => {
    expect(() => codec.decode(utf8Encode('{not json'))).toThrow(
      PacketDecodeError,
    );
  });

  it('rejects a packet with an unknown type', () => {
    expect(() =>
      codec.decode(
        utf8Encode(
          JSON.stringify({
            version: 1,
            id: 'x',
            type: 'NONSENSE',
            senderId: 'a',
            destinationId: 'b',
            ttl: 5,
          }),
        ),
      ),
    ).toThrow(PacketDecodeError);
  });

  it('rejects a packet missing a sender', () => {
    expect(() =>
      codec.decode(
        utf8Encode(
          JSON.stringify({
            version: 1,
            id: 'x',
            type: 'MESSAGE',
            destinationId: 'b',
            ttl: 5,
          }),
        ),
      ),
    ).toThrow(PacketDecodeError);
  });
});

describe('deduplication', () => {
  it('accepts an id once and rejects it thereafter', () => {
    const store = new SeenMessageStore(10);
    expect(store.markIfNew('a')).toBe(true);
    expect(store.markIfNew('a')).toBe(false);
    expect(store.markIfNew('b')).toBe(true);
  });

  it('evicts oldest ids past capacity', () => {
    const store = new SeenMessageStore(3);
    store.markIfNew('1');
    store.markIfNew('2');
    store.markIfNew('3');
    store.markIfNew('4');

    expect(store.size).toBe(3);
    // '1' was evicted, so it reads as new again — the bounded-memory trade-off.
    expect(store.has('1')).toBe(false);
    expect(store.has('4')).toBe(true);
  });

  it('restores ids from a previous run', () => {
    const store = new SeenMessageStore(10);
    store.hydrate(['x', 'y']);
    expect(store.markIfNew('x')).toBe(false);
    expect(store.markIfNew('z')).toBe(true);
  });
});
