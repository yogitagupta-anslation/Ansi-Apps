/**
 * Adversarial tests for the parsers.
 *
 * The reassembler and codec consume bytes from an UNAUTHENTICATED peer — anyone can
 * advertise our service UUID and connect. These tests treat the input as hostile rather
 * than merely lossy, which is the distinction the earlier fragmentation tests did not make.
 */
import {Reassembler, fragment} from '../messaging/Fragmentation';
import {JsonPacketCodec, PacketDecodeError} from '../messaging/PacketCodec';
import {
  FRAGMENT_HEADER_SIZE,
  FRAGMENT_MAGIC,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAGMENTS_PER_STREAM,
} from '../config/constants';
import {utf8Encode} from '../utils/bytes';

/** Craft a fragment frame by hand, so illegal headers can be produced deliberately. */
function frame(opts: {
  streamId: number;
  index: number;
  count: number;
  body?: Uint8Array;
  magic?: number;
  version?: number;
  type?: number;
}): Uint8Array {
  const body = opts.body ?? new Uint8Array([1, 2, 3, 4]);
  const out = new Uint8Array(FRAGMENT_HEADER_SIZE + body.length);
  out[0] = opts.magic ?? FRAGMENT_MAGIC;
  out[1] = opts.version ?? 0x02;
  out[2] = opts.type ?? 0x00;
  out[3] = (opts.streamId >>> 24) & 0xff;
  out[4] = (opts.streamId >>> 16) & 0xff;
  out[5] = (opts.streamId >>> 8) & 0xff;
  out[6] = opts.streamId & 0xff;
  out[7] = (opts.index >>> 8) & 0xff;
  out[8] = opts.index & 0xff;
  out[9] = (opts.count >>> 8) & 0xff;
  out[10] = opts.count & 0xff;
  out.set(body, FRAGMENT_HEADER_SIZE);
  return out;
}

describe('reassembler under hostile input', () => {
  it('refuses a stream that declares more fragments than the cap', () => {
    const r = new Reassembler('attacker');
    // 65535 was an unbounded pre-allocation before this cap existed.
    const hostile = frame({streamId: 1, index: 0, count: 0xffff});

    expect(r.push(hostile)).toBeNull();
    expect(r.pendingStreams).toBe(0);
  });

  it('accepts a stream exactly at the cap', () => {
    const r = new Reassembler('ok');
    expect(
      r.push(frame({streamId: 2, index: 0, count: MAX_FRAGMENTS_PER_STREAM})),
    ).toBeNull();
    expect(r.pendingStreams).toBe(1);
  });

  it('allocates only for fragments actually received, not for the declared count', () => {
    const r = new Reassembler('sparse');
    // Declares 2000 fragments but sends one. Memory must track the one.
    r.push(frame({streamId: 3, index: 0, count: 2000}));
    expect(r.pendingStreams).toBe(1);
    // Nothing is delivered, and nothing blew up sizing a 2000-slot buffer.
    expect(r.push(frame({streamId: 3, index: 1, count: 2000}))).toBeNull();
  });

  it('bounds the number of half-finished streams one link can hold open', () => {
    const r = new Reassembler('flood');
    for (let i = 0; i < MAX_CONCURRENT_STREAMS * 4; i++) {
      r.push(frame({streamId: 1000 + i, index: 0, count: 10}));
    }
    expect(r.pendingStreams).toBeLessThanOrEqual(MAX_CONCURRENT_STREAMS);
  });

  it('drops a stream whose accumulated bytes exceed the ceiling', () => {
    const r = new Reassembler('fat');
    const big = new Uint8Array(400).fill(7);
    // 2048 * 400B is far past MAX_REASSEMBLY_BYTES; it must give up, not grow.
    let delivered: Uint8Array | null = null;
    for (let i = 0; i < 2000; i++) {
      delivered = r.push(frame({streamId: 9, index: i, count: 2000, body: big}));
      if (r.pendingStreams === 0) {
        break;
      }
    }
    expect(delivered).toBeNull();
    expect(r.pendingStreams).toBe(0);
  });

  it('rejects an index outside the declared range', () => {
    const r = new Reassembler('oob');
    expect(r.push(frame({streamId: 4, index: 99, count: 10}))).toBeNull();
    expect(r.pendingStreams).toBe(0);
  });

  it('rejects a fragment protocol version it does not implement', () => {
    const r = new Reassembler('future');
    expect(r.push(frame({streamId: 5, index: 0, count: 2, version: 0x7f}))).toBeNull();
  });

  it('discards a stream whose declared count changes mid-flight', () => {
    const r = new Reassembler('shifty');
    r.push(frame({streamId: 6, index: 0, count: 4}));
    expect(r.push(frame({streamId: 6, index: 1, count: 9}))).toBeNull();
    expect(r.pendingStreams).toBe(0);
  });

  it('survives arbitrary random bytes without throwing', () => {
    const r = new Reassembler('fuzz');
    for (let i = 0; i < 500; i++) {
      const len = 1 + ((i * 7) % 40);
      const junk = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        junk[j] = (i * 31 + j * 17) % 256;
      }
      expect(() => r.push(junk)).not.toThrow();
    }
  });

  it('still reassembles a legitimate message after abuse', () => {
    const r = new Reassembler('mixed');
    r.push(frame({streamId: 1, index: 0, count: 0xffff}));
    r.push(new Uint8Array([0, 0, 0]));

    const payload = utf8Encode('still works');
    let out: Uint8Array | null = null;
    for (const f of fragment(payload, 23, 77)) {
      out = r.push(f) ?? out;
    }
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(payload));
  });
});

describe('codec under hostile input', () => {
  const codec = new JsonPacketCodec();

  it('rejects structurally valid JSON that is not a packet', () => {
    for (const junk of ['[]', '"hello"', '123', 'null', '{}']) {
      expect(() => codec.decode(utf8Encode(junk))).toThrow(PacketDecodeError);
    }
  });

  it('rejects a packet with wrong-typed fields', () => {
    const bad = JSON.stringify({
      version: '1',
      id: 42,
      type: 'MESSAGE',
      senderId: {},
      destinationId: [],
      ttl: 'five',
    });
    expect(() => codec.decode(utf8Encode(bad))).toThrow(PacketDecodeError);
  });

  it('does not throw on truncated UTF-8', () => {
    const truncated = new Uint8Array([0x7b, 0x22, 0xe6, 0x97]);
    expect(() => codec.decode(truncated)).toThrow(PacketDecodeError);
  });
});
