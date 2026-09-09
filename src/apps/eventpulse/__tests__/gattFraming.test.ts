/**
 * Wire-level safety net for the EventPulse GATT fragmenter.
 *
 * WHY THIS SUITE PINS BYTES AND NOT JUST ROUND TRIPS. `GattFraming` is a wire
 * format. Two builds of the app talk to each other over it, and a silent change
 * to a field offset, to the endianness of `groupId`, or to the version nibble
 * would keep every round trip in this file green while breaking every real link
 * — the sender and the receiver would simply be wrong in the same way. So the
 * layout tests assert literal byte values against a `GroupIdSource` seeded with
 * a known id, and the round trips are there to prove the algorithm, not the
 * layout.
 *
 * WHY THE MTU NUMBERS ARE SPELLED OUT. `payloadBytesForMtu(23)` is 11 usable
 * bytes: 23 minus the 3-byte ATT header minus our 9-byte fragment header. That
 * is the un-negotiated Android floor, the size every first message on every
 * Android link runs at, and the case a fragmenter is most likely to get wrong.
 * It is asserted as 11 rather than derived so that a change to either header
 * size shows up here as a failing number.
 *
 * Everything exercised is the real implementation. `GattFraming` and
 * `GattProfile` are pure TypeScript with no platform imports, so there is
 * nothing to fake and nothing is faked. The only injected seam is the clock the
 * reassembler already takes for its stall timeout, which is what makes the
 * timeout boundary assertable to the millisecond instead of by sleeping.
 */

import {
  GATT_FRAME_VERSION,
  GattFrameError,
  GattFrameFlags,
  GattReassembler,
  GroupIdSource,
  fragmentMessage,
  parseGattFrame,
} from '../bluetooth/gatt/GattFraming';
import type { GattFrameErrorCode, ParsedGattFrame } from '../bluetooth/gatt/GattFraming';
import {
  ANDROID_REQUESTED_MTU,
  ATT_DEFAULT_MTU,
  ATT_HEADER_BYTES,
  FRAME_HEADER_BYTES,
  IOS_ASSUMED_MTU,
  MAX_MESSAGE_BYTES,
  REASSEMBLY_TIMEOUT_MS,
  payloadBytesForMtu,
} from '../bluetooth/gatt/GattProfile';

/* ------------------------------------------------------------------ *
 * Fixtures & helpers
 * ------------------------------------------------------------------ */

/** Usable payload bytes at the three MTUs this app actually sees. */
const CHUNK_AT_23 = 11; // 23 - 3 ATT - 9 frame header. The Android floor.
const CHUNK_AT_185 = 173; // What CoreBluetooth settles on.
const CHUNK_AT_500 = 500; // 512 - 3 - 9. What Android is asked for.

/** The largest fragment count the two-byte `fragTotal` field can express. */
const MAX_FRAGMENTS = 0xffff;

/**
 * Deterministic, non-repeating filler.
 *
 * A payload of `i % 256` would hide a chunk swap whenever the chunk size
 * divides 256; an LCG makes every byte position distinguishable, so a
 * reassembler that stitched fragments in the wrong order could not produce
 * matching bytes by luck.
 */
function makePayload(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = (seed >>> 0) || 1;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

interface FrameFields {
  version?: number;
  flags?: number;
  groupId?: number;
  fragIndex?: number;
  fragTotal?: number;
  payload?: Uint8Array;
}

/**
 * Build a frame field by field, including combinations `fragmentMessage` would
 * never emit. Malformed input arrives from the radio, not from our own encoder,
 * so the parser has to be tested against bytes the encoder cannot produce.
 */
function buildFrame(fields: FrameFields): Uint8Array {
  const version = fields.version ?? GATT_FRAME_VERSION;
  const flags = fields.flags ?? GattFrameFlags.None;
  const groupId = fields.groupId ?? 0;
  const fragIndex = fields.fragIndex ?? 0;
  const fragTotal = fields.fragTotal ?? 1;
  const payload = fields.payload ?? new Uint8Array(0);

  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  frame[0] = ((version & 0x0f) << 4) | (flags & 0x0f);
  frame[1] = groupId & 0xff;
  frame[2] = (groupId >>> 8) & 0xff;
  frame[3] = (groupId >>> 16) & 0xff;
  frame[4] = (groupId >>> 24) & 0xff;
  frame[5] = fragIndex & 0xff;
  frame[6] = (fragIndex >>> 8) & 0xff;
  frame[7] = fragTotal & 0xff;
  frame[8] = (fragTotal >>> 8) & 0xff;
  frame.set(payload, FRAME_HEADER_BYTES);
  return frame;
}

/** Runs `run`, and returns the `GattFrameError` it threw. Fails loudly otherwise. */
function caughtFrameError(run: () => unknown): GattFrameError {
  try {
    run();
  } catch (err) {
    if (err instanceof GattFrameError) {
      return err;
    }
    throw err;
  }
  throw new Error('expected a GattFrameError to be thrown, but the call returned');
}

function expectCode(run: () => unknown, code: GattFrameErrorCode): void {
  const err = caughtFrameError(run);
  expect(err.code).toBe(code);
  expect(err.name).toBe('GattFrameError');
}

/** Deterministic Fisher-Yates, so a shuffled-delivery failure is reproducible. */
function shuffledIndices(total: number): number[] {
  const order = Array.from({ length: total }, (_unused, i) => i);
  let state = 0x9e3779b9;
  for (let i = total - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

/** A reassembler on a clock the test drives, so timeouts need no real waiting. */
function reassemblerOnClock(
  timeoutMs?: number,
): { reassembler: GattReassembler; setNow: (ms: number) => void } {
  let now = 1_000_000;
  const reassembler = new GattReassembler(timeoutMs, () => now);
  return {
    reassembler,
    setNow: (ms: number) => {
      now = ms;
    },
  };
}

/** Feed frames in the given order; returns every non-null completion. */
function pushAll(reassembler: GattReassembler, frames: Uint8Array[]): Uint8Array[] {
  const completed: Uint8Array[] = [];
  for (const frame of frames) {
    const out = reassembler.push(frame);
    if (out !== null) {
      completed.push(out);
    }
  }
  return completed;
}

/* ------------------------------------------------------------------ *
 * Exact wire layout
 * ------------------------------------------------------------------ */

describe('frame layout', () => {
  it('lays a single-fragment frame out as version|flags, little-endian groupId, index, total, then payload', () => {
    const frames = fragmentMessage(
      Uint8Array.from([0xaa, 0xbb, 0xcc]),
      CHUNK_AT_23,
      new GroupIdSource(0x04030201),
    );

    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0])).toEqual([
      0x10, // version 1 in the high nibble, flags 0 in the low nibble
      0x01,
      0x02,
      0x03,
      0x04, // groupId 0x04030201, least significant byte first
      0x00,
      0x00, // fragIndex 0
      0x01,
      0x00, // fragTotal 1
      0xaa,
      0xbb,
      0xcc, // payload, from offset 9
    ]);
  });

  it('starts the payload at offset 9 and copies it verbatim', () => {
    const payload = makePayload(7, 42);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(0));

    expect(frames[0]).toHaveLength(FRAME_HEADER_BYTES + 7);
    expect(Array.from(frames[0].subarray(FRAME_HEADER_BYTES))).toEqual(Array.from(payload));
    expect(FRAME_HEADER_BYTES).toBe(9);
  });

  it('packs version 1 with a clear Fragmented bit into byte 0 of an unfragmented frame', () => {
    const frames = fragmentMessage(makePayload(CHUNK_AT_23), CHUNK_AT_23, new GroupIdSource(0));

    expect(frames).toHaveLength(1);
    expect(frames[0][0]).toBe(0x10);
    expect((frames[0][0] >>> 4) & 0x0f).toBe(GATT_FRAME_VERSION);
    expect(frames[0][0] & 0x0f).toBe(GattFrameFlags.None);
  });

  it('packs version 1 with a set Fragmented bit into byte 0 of every frame of a split message', () => {
    const frames = fragmentMessage(makePayload(100), CHUNK_AT_23, new GroupIdSource(0));

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(frame[0]).toBe(0x11);
      expect(frame[0] & 0x0f).toBe(GattFrameFlags.Fragmented);
    }
  });

  it('writes groupId little-endian across bytes 1 through 4', () => {
    const frames = fragmentMessage(new Uint8Array(0), CHUNK_AT_23, new GroupIdSource(0xdeadbeef));

    expect(Array.from(frames[0].subarray(1, 5))).toEqual([0xef, 0xbe, 0xad, 0xde]);
    expect(parseGattFrame(frames[0]).groupId).toBe(0xdeadbeef);
  });

  it('carries a groupId of 0xFFFFFFFF back as an unsigned 4294967295, not -1', () => {
    const frames = fragmentMessage(new Uint8Array(0), CHUNK_AT_23, new GroupIdSource(0xffffffff));

    expect(Array.from(frames[0].subarray(1, 5))).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(parseGattFrame(frames[0]).groupId).toBe(4294967295);
  });

  it('writes fragIndex little-endian across bytes 5 and 6 past the 255th fragment', () => {
    // 300 one-byte fragments: the only way to see the high byte of fragIndex.
    const payload = makePayload(300);
    const frames = fragmentMessage(payload, 1, new GroupIdSource(0));

    expect(frames).toHaveLength(300);
    expect(Array.from(frames[255].subarray(5, 7))).toEqual([0xff, 0x00]);
    expect(Array.from(frames[256].subarray(5, 7))).toEqual([0x00, 0x01]);
    expect(parseGattFrame(frames[256]).fragIndex).toBe(256);
    expect(parseGattFrame(frames[299]).fragIndex).toBe(299);
  });

  it('writes fragTotal little-endian across bytes 7 and 8 past 255 fragments', () => {
    const frames = fragmentMessage(makePayload(300), 1, new GroupIdSource(0));

    // 300 === 0x012c, so the low byte is 0x2c and the high byte is 0x01.
    for (const frame of frames) {
      expect(Array.from(frame.subarray(7, 9))).toEqual([0x2c, 0x01]);
    }
    expect(parseGattFrame(frames[0]).fragTotal).toBe(300);
  });

  it('reads every field back out of a hand-built frame', () => {
    const parsed: ParsedGattFrame = parseGattFrame(
      buildFrame({
        flags: GattFrameFlags.Fragmented,
        groupId: 0x11223344,
        fragIndex: 513,
        fragTotal: 1024,
        payload: Uint8Array.from([1, 2, 3]),
      }),
    );

    expect(parsed.version).toBe(1);
    expect(parsed.flags).toBe(GattFrameFlags.Fragmented);
    expect(parsed.groupId).toBe(0x11223344);
    expect(parsed.fragIndex).toBe(513);
    expect(parsed.fragTotal).toBe(1024);
    expect(Array.from(parsed.payload)).toEqual([1, 2, 3]);
  });

  it('hands back a payload that is a view onto the caller buffer, not a copy', () => {
    // Worth pinning: a transport that reuses one receive buffer would see the
    // parsed payload change underneath it. `GattReassembler` copies for exactly
    // this reason; a direct caller of `parseGattFrame` must not assume it does.
    const frame = buildFrame({ payload: Uint8Array.from([9, 9, 9]) });
    const parsed = parseGattFrame(frame);

    frame[FRAME_HEADER_BYTES] = 0;
    expect(Array.from(parsed.payload)).toEqual([0, 9, 9]);
  });
});

/* ------------------------------------------------------------------ *
 * Fragment counts and flags
 * ------------------------------------------------------------------ */

describe('fragment counts', () => {
  it('emits exactly one frame with the Fragmented flag clear for a payload that exactly fills a fragment', () => {
    const frames = fragmentMessage(makePayload(CHUNK_AT_23), CHUNK_AT_23, new GroupIdSource(7));

    expect(frames).toHaveLength(1);
    expect(frames[0][0] & 0x0f).toBe(GattFrameFlags.None);
    expect(frames[0]).toHaveLength(FRAME_HEADER_BYTES + CHUNK_AT_23);
  });

  it('emits two frames sharing one groupId, both flagged Fragmented, for one byte more', () => {
    const frames = fragmentMessage(makePayload(CHUNK_AT_23 + 1), CHUNK_AT_23, new GroupIdSource(7));

    expect(frames).toHaveLength(2);
    expect(frames[0][0] & 0x0f).toBe(GattFrameFlags.Fragmented);
    expect(frames[1][0] & 0x0f).toBe(GattFrameFlags.Fragmented);
    expect(parseGattFrame(frames[0]).groupId).toBe(7);
    expect(parseGattFrame(frames[1]).groupId).toBe(7);
    expect(frames[0]).toHaveLength(FRAME_HEADER_BYTES + CHUNK_AT_23);
    expect(frames[1]).toHaveLength(FRAME_HEADER_BYTES + 1);
  });

  it('emits exactly one header-only frame for an empty payload, so a zero-length message still arrives', () => {
    const frames = fragmentMessage(new Uint8Array(0), CHUNK_AT_23, new GroupIdSource(3));

    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveLength(FRAME_HEADER_BYTES);
    expect(parseGattFrame(frames[0]).fragTotal).toBe(1);
    expect(parseGattFrame(frames[0]).payload).toHaveLength(0);
    expect(frames[0][0] & 0x0f).toBe(GattFrameFlags.None);
  });

  it('consumes exactly one group id per message regardless of fragment count', () => {
    const ids = new GroupIdSource(500);
    const first = fragmentMessage(makePayload(100), CHUNK_AT_23, ids);
    const second = fragmentMessage(new Uint8Array(0), CHUNK_AT_23, ids);

    expect(first.length).toBeGreaterThan(1);
    expect(parseGattFrame(first[0]).groupId).toBe(500);
    expect(parseGattFrame(second[0]).groupId).toBe(501);
  });

  it('numbers fragments 0..total-1 and repeats the same total on every frame', () => {
    const frames = fragmentMessage(makePayload(100), CHUNK_AT_23, new GroupIdSource(0));

    expect(frames).toHaveLength(10);
    frames.forEach((frame, index) => {
      const parsed = parseGattFrame(frame);
      expect(parsed.fragIndex).toBe(index);
      expect(parsed.fragTotal).toBe(10);
    });
  });
});

/* ------------------------------------------------------------------ *
 * MTU boundaries
 * ------------------------------------------------------------------ */

describe('MTU boundaries', () => {
  const SIX_HUNDRED = 600;

  it.each([
    // mtu, usable chunk, frames for 600 bytes, bytes in the last fragment
    [ATT_DEFAULT_MTU, CHUNK_AT_23, 55, 6],
    [IOS_ASSUMED_MTU, CHUNK_AT_185, 4, 81],
    [ANDROID_REQUESTED_MTU, CHUNK_AT_500, 2, 100],
  ])(
    'splits a 600-byte payload at MTU %i into %i-byte chunks: %i fragments, the last holding %i bytes',
    (mtu, chunk, expectedFrames, lastChunkBytes) => {
      expect(payloadBytesForMtu(mtu)).toBe(chunk);

      const payload = makePayload(SIX_HUNDRED, mtu);
      const frames = fragmentMessage(payload, chunk, new GroupIdSource(0));

      expect(frames).toHaveLength(expectedFrames);

      // Every fragment but the last is exactly full, and a full fragment is
      // exactly what one ATT packet at this MTU can carry.
      for (let i = 0; i < expectedFrames - 1; i++) {
        expect(frames[i]).toHaveLength(FRAME_HEADER_BYTES + chunk);
        expect(frames[i].length).toBe(mtu - ATT_HEADER_BYTES);
      }
      expect(frames[expectedFrames - 1]).toHaveLength(FRAME_HEADER_BYTES + lastChunkBytes);

      // The fragments together are the payload, in order, with nothing lost.
      const rejoined = new Uint8Array(SIX_HUNDRED);
      let offset = 0;
      for (const frame of frames) {
        const chunkBytes = frame.subarray(FRAME_HEADER_BYTES);
        rejoined.set(chunkBytes, offset);
        offset += chunkBytes.length;
      }
      expect(offset).toBe(SIX_HUNDRED);
      expect(rejoined).toEqual(payload);
    },
  );

  it('fills a frame to exactly 20 bytes at the un-negotiated Android MTU of 23', () => {
    const frames = fragmentMessage(makePayload(100), payloadBytesForMtu(23), new GroupIdSource(0));

    expect(frames[0]).toHaveLength(20);
    expect(20).toBe(ATT_DEFAULT_MTU - ATT_HEADER_BYTES);
  });

  it('floors a fractional frame budget rather than rounding it up', () => {
    // 11.9 usable bytes is 11 whole bytes on the wire; rounding up would emit a
    // frame the link cannot carry.
    const frames = fragmentMessage(makePayload(22), 11.9, new GroupIdSource(0));

    expect(frames).toHaveLength(2);
    expect(frames[0]).toHaveLength(FRAME_HEADER_BYTES + 11);
    expect(frames[1]).toHaveLength(FRAME_HEADER_BYTES + 11);
  });

  it('accepts a budget of exactly 1 byte, the floor payloadBytesForMtu clamps to', () => {
    const frames = fragmentMessage(makePayload(4), 1, new GroupIdSource(0));

    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      expect(frame).toHaveLength(FRAME_HEADER_BYTES + 1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Input validation
 * ------------------------------------------------------------------ */

describe('fragmentMessage input validation', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s frame budget with bad_fragment_size', (_label, budget) => {
    expectCode(
      () => fragmentMessage(makePayload(10), budget, new GroupIdSource(0)),
      'bad_fragment_size',
    );
  });

  it('rejects a negative-infinity frame budget with bad_fragment_size', () => {
    expectCode(
      () => fragmentMessage(makePayload(10), Number.NEGATIVE_INFINITY, new GroupIdSource(0)),
      'bad_fragment_size',
    );
  });

  it('accepts a message of exactly MAX_MESSAGE_BYTES', () => {
    const frames = fragmentMessage(
      new Uint8Array(MAX_MESSAGE_BYTES),
      CHUNK_AT_500,
      new GroupIdSource(0),
    );

    expect(MAX_MESSAGE_BYTES).toBe(65536);
    expect(frames).toHaveLength(132); // 131 full 500-byte fragments plus 36 bytes
    expect(frames[131]).toHaveLength(FRAME_HEADER_BYTES + 36);
  });

  it('rejects a message one byte over MAX_MESSAGE_BYTES with message_too_large', () => {
    expectCode(
      () =>
        fragmentMessage(new Uint8Array(MAX_MESSAGE_BYTES + 1), CHUNK_AT_500, new GroupIdSource(0)),
      'message_too_large',
    );
  });

  it('rejects a split that would need more than 65535 fragments with bad_fragment_total', () => {
    // The largest legal message at a one-byte budget needs 65536 fragments,
    // one more than the two-byte fragTotal field can express.
    expectCode(
      () => fragmentMessage(new Uint8Array(MAX_MESSAGE_BYTES), 1, new GroupIdSource(0)),
      'bad_fragment_total',
    );
  });

  it('allows a split of exactly 65535 fragments', () => {
    const frames = fragmentMessage(new Uint8Array(MAX_FRAGMENTS), 1, new GroupIdSource(0));

    expect(frames).toHaveLength(MAX_FRAGMENTS);
    expect(parseGattFrame(frames[MAX_FRAGMENTS - 1]).fragIndex).toBe(MAX_FRAGMENTS - 1);
  });
});

/* ------------------------------------------------------------------ *
 * Round trips
 * ------------------------------------------------------------------ */

describe('round trip through GattReassembler', () => {
  const MTUS = [ATT_DEFAULT_MTU, IOS_ASSUMED_MTU, ANDROID_REQUESTED_MTU];

  const SIZES: ReadonlyArray<readonly [string, (chunk: number) => number]> = [
    ['an empty payload', () => 0],
    ['a one-byte payload', () => 1],
    ['one byte under a full fragment', chunk => chunk - 1],
    ['exactly one full fragment', chunk => chunk],
    ['one byte over a full fragment', chunk => chunk + 1],
    ['three and a half fragments', chunk => Math.floor(chunk * 3.5)],
    ['a 5000-byte payload', () => 5000],
  ];

  it.each(SIZES)('returns %s unchanged at MTU 23, 185 and 512', (_label, sizeFor) => {
    for (const mtu of MTUS) {
      const chunk = payloadBytesForMtu(mtu);
      const size = sizeFor(chunk);
      const payload = makePayload(size, mtu + size);
      const frames = fragmentMessage(payload, chunk, new GroupIdSource(mtu));

      expect(frames).toHaveLength(Math.max(1, Math.ceil(size / chunk)));

      const { reassembler } = reassemblerOnClock();
      const completed = pushAll(reassembler, frames);

      expect(completed).toHaveLength(1);
      expect(completed[0]).toHaveLength(size);
      expect(completed[0]).toEqual(payload);
      expect(reassembler.pendingCount).toBe(0);
    }
  });

  it('returns the largest legal message unchanged, so the size cap never rejects a valid one', () => {
    const payload = makePayload(MAX_MESSAGE_BYTES, 77);
    const frames = fragmentMessage(payload, CHUNK_AT_500, new GroupIdSource(0));
    const { reassembler } = reassemblerOnClock();

    const completed = pushAll(reassembler, frames);

    expect(completed).toHaveLength(1);
    expect(completed[0]).toHaveLength(MAX_MESSAGE_BYTES);
    expect(completed[0]).toEqual(payload);
  });

  it('returns a copy, so later reuse of the frame buffers cannot corrupt a delivered message', () => {
    const payload = makePayload(50, 9);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(0));
    const { reassembler } = reassemblerOnClock();

    const completed = pushAll(reassembler, frames);
    for (const frame of frames) {
      frame.fill(0);
    }

    expect(completed[0]).toEqual(payload);
  });

  it('delivers a single-fragment message as a copy too', () => {
    const frames = fragmentMessage(Uint8Array.from([1, 2, 3]), CHUNK_AT_23, new GroupIdSource(0));
    const { reassembler } = reassemblerOnClock();

    const out = reassembler.push(frames[0]);
    frames[0].fill(0);

    expect(out).not.toBeNull();
    expect(Array.from(out as Uint8Array)).toEqual([1, 2, 3]);
    expect(reassembler.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Delivery order and duplicates
 * ------------------------------------------------------------------ */

describe('out-of-order and duplicate delivery', () => {
  const PAYLOAD = makePayload(250, 11);

  function fragments(): Uint8Array[] {
    return fragmentMessage(PAYLOAD, CHUNK_AT_23, new GroupIdSource(1234));
  }

  it('reassembles a message delivered entirely in reverse', () => {
    const frames = fragments();
    expect(frames).toHaveLength(23); // 22 full 11-byte fragments plus 8 bytes

    const { reassembler } = reassemblerOnClock();
    const completed = pushAll(reassembler, [...frames].reverse());

    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual(PAYLOAD);
    expect(reassembler.pendingCount).toBe(0);
  });

  it('completes only on the final arriving frame when delivery is reversed', () => {
    const frames = fragments();
    const reversed = [...frames].reverse();
    const { reassembler } = reassemblerOnClock();

    for (let i = 0; i < reversed.length - 1; i++) {
      expect(reassembler.push(reversed[i])).toBeNull();
    }
    expect(reassembler.push(reversed[reversed.length - 1])).toEqual(PAYLOAD);
  });

  it('reassembles a message delivered in a shuffled order', () => {
    const frames = fragments();
    const order = shuffledIndices(frames.length);

    // Guard the guard: a shuffle that happened to be sorted would test nothing.
    expect(order).not.toEqual(Array.from({ length: frames.length }, (_u, i) => i));

    const { reassembler } = reassemblerOnClock();
    const completed = pushAll(
      reassembler,
      order.map(i => frames[i]),
    );

    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual(PAYLOAD);
    expect(reassembler.pendingCount).toBe(0);
  });

  it('reassembles exactly once and byte-identically when every frame is delivered twice', () => {
    const frames = fragments();
    const doubled: Uint8Array[] = [];
    for (const frame of frames) {
      doubled.push(frame, frame);
    }

    const { reassembler } = reassemblerOnClock();
    const completed = pushAll(reassembler, doubled);

    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual(PAYLOAD);
  });

  it('ignores a duplicate fragment rather than double-counting its bytes', () => {
    const frames = fragments();
    const { reassembler } = reassemblerOnClock();

    expect(reassembler.push(frames[0])).toBeNull();
    expect(reassembler.push(frames[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);

    const completed = pushAll(reassembler, frames.slice(1));
    expect(completed).toHaveLength(1);
    expect(completed[0]).toHaveLength(PAYLOAD.length);
    expect(completed[0]).toEqual(PAYLOAD);
  });

  it('opens a fresh group for a duplicate of the final fragment, which the stall timeout reclaims', () => {
    // The group is freed the moment a message completes, so a re-delivery of
    // its last fragment looks like the start of a new message. It is bounded:
    // it can never complete, and eviction drops it. Pinned so a future change
    // to the completion path has to state its intent here.
    const frames = fragments();
    const { reassembler, setNow } = reassemblerOnClock(REASSEMBLY_TIMEOUT_MS);

    expect(pushAll(reassembler, frames)).toHaveLength(1);
    expect(reassembler.pendingCount).toBe(0);

    expect(reassembler.push(frames[frames.length - 1])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);

    setNow(1_000_000 + REASSEMBLY_TIMEOUT_MS + 1);
    expect(reassembler.push(frames[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1); // the evicted one is gone; only frames[0]'s group remains
  });

  it('reassembles a completed message again when the whole message is replayed', () => {
    // The reassembler keeps no history of finished group ids, so a full replay
    // yields the message a second time. De-duplicating messages is the session
    // layer's job, not the framer's; this pins where that boundary sits.
    const frames = fragments();
    const { reassembler } = reassemblerOnClock();

    const completed = pushAll(reassembler, [...frames, ...frames]);

    expect(completed).toHaveLength(2);
    expect(completed[0]).toEqual(PAYLOAD);
    expect(completed[1]).toEqual(PAYLOAD);
  });
});

/* ------------------------------------------------------------------ *
 * Incomplete messages
 * ------------------------------------------------------------------ */

describe('incomplete messages', () => {
  it('returns null for every frame and holds one pending group while the last fragment is missing', () => {
    const payload = makePayload(100, 5);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(0));
    const { reassembler } = reassemblerOnClock();

    expect(frames).toHaveLength(10);
    for (const frame of frames.slice(0, -1)) {
      expect(reassembler.push(frame)).toBeNull();
      expect(reassembler.pendingCount).toBe(1);
    }
  });

  it('returns null for every frame while the first fragment is missing', () => {
    const payload = makePayload(100, 5);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(0));
    const { reassembler } = reassemblerOnClock();

    for (const frame of frames.slice(1)) {
      expect(reassembler.push(frame)).toBeNull();
      expect(reassembler.pendingCount).toBe(1);
    }
  });

  it('completes the moment the withheld middle fragment finally lands', () => {
    const payload = makePayload(100, 5);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(0));
    const withheld = frames[4];
    const { reassembler } = reassemblerOnClock();

    for (const frame of frames.filter((_f, i) => i !== 4)) {
      expect(reassembler.push(frame)).toBeNull();
    }
    expect(reassembler.push(withheld)).toEqual(payload);
    expect(reassembler.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Stall timeout
 * ------------------------------------------------------------------ */

describe('stall timeout', () => {
  const START = 1_000_000;
  const TIMEOUT = 5_000;

  /** A complete one-frame message, used to drive eviction without adding a group. */
  function ping(groupId: number): Uint8Array {
    return fragmentMessage(Uint8Array.from([0xa5]), CHUNK_AT_23, new GroupIdSource(groupId))[0];
  }

  function stalledGroup(timeoutMs?: number): {
    reassembler: GattReassembler;
    setNow: (ms: number) => void;
    rest: Uint8Array[];
  } {
    const frames = fragmentMessage(makePayload(30, 3), CHUNK_AT_23, new GroupIdSource(42));
    const { reassembler, setNow } = reassemblerOnClock(timeoutMs);
    expect(reassembler.push(frames[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);
    return { reassembler, setNow, rest: frames.slice(1) };
  }

  it('keeps a group that has been waiting exactly the timeout', () => {
    const { reassembler, setNow } = stalledGroup(TIMEOUT);

    setNow(START + TIMEOUT);
    expect(reassembler.push(ping(900))).toEqual(Uint8Array.from([0xa5]));

    expect(reassembler.pendingCount).toBe(1);
  });

  it('keeps a group one millisecond under the timeout', () => {
    const { reassembler, setNow } = stalledGroup(TIMEOUT);

    setNow(START + TIMEOUT - 1);
    reassembler.push(ping(900));

    expect(reassembler.pendingCount).toBe(1);
  });

  it('evicts a group one millisecond past the timeout', () => {
    const { reassembler, setNow } = stalledGroup(TIMEOUT);

    setNow(START + TIMEOUT + 1);
    reassembler.push(ping(900));

    expect(reassembler.pendingCount).toBe(0);
  });

  it('defaults to REASSEMBLY_TIMEOUT_MS when no timeout is supplied', () => {
    const survives = stalledGroup();
    survives.setNow(START + REASSEMBLY_TIMEOUT_MS);
    survives.reassembler.push(ping(901));
    expect(survives.reassembler.pendingCount).toBe(1);

    const evicted = stalledGroup();
    evicted.setNow(START + REASSEMBLY_TIMEOUT_MS + 1);
    evicted.reassembler.push(ping(902));
    expect(evicted.reassembler.pendingCount).toBe(0);
    expect(REASSEMBLY_TIMEOUT_MS).toBe(8000);
  });

  it('only evicts when a frame arrives, so a stalled group is still counted until then', () => {
    const { reassembler, setNow } = stalledGroup(TIMEOUT);

    setNow(START + TIMEOUT * 100);
    expect(reassembler.pendingCount).toBe(1);

    reassembler.push(ping(903));
    expect(reassembler.pendingCount).toBe(0);
  });

  it('starts a fresh group after an eviction rather than completing the abandoned message', () => {
    const { reassembler, setNow, rest } = stalledGroup(TIMEOUT);

    setNow(START + TIMEOUT + 1);
    reassembler.push(ping(904));
    expect(reassembler.pendingCount).toBe(0);

    // The survivors of the abandoned message cannot finish it: fragment 0 is gone.
    for (const frame of rest) {
      expect(reassembler.push(frame)).toBeNull();
    }
    expect(reassembler.pendingCount).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Malformed frames
 * ------------------------------------------------------------------ */

describe('malformed frames', () => {
  it.each([[0], [1], [2], [3], [4], [5], [6], [7], [8]])(
    'rejects a %i-byte buffer as too_short',
    length => {
      expectCode(() => parseGattFrame(new Uint8Array(length)), 'too_short');
    },
  );

  it('accepts a frame of exactly the 9-byte header as a zero-length payload', () => {
    const parsed = parseGattFrame(buildFrame({}));

    expect(parsed.payload).toHaveLength(0);
    expect(parsed.fragTotal).toBe(1);
  });

  it.each([[0], [2], [15]])('rejects frame version %i as unsupported_version', version => {
    expectCode(() => parseGattFrame(buildFrame({ version })), 'unsupported_version');
  });

  it('rejects a fragTotal of 0 as bad_fragment_total', () => {
    expectCode(() => parseGattFrame(buildFrame({ fragTotal: 0 })), 'bad_fragment_total');
  });

  it('rejects a fragIndex equal to fragTotal as bad_fragment_index', () => {
    expectCode(
      () => parseGattFrame(buildFrame({ fragIndex: 4, fragTotal: 4 })),
      'bad_fragment_index',
    );
  });

  it('rejects a fragIndex past fragTotal as bad_fragment_index', () => {
    expectCode(
      () => parseGattFrame(buildFrame({ fragIndex: 900, fragTotal: 4 })),
      'bad_fragment_index',
    );
  });

  it('accepts the last legal fragIndex, one under fragTotal', () => {
    const parsed = parseGattFrame(buildFrame({ fragIndex: 3, fragTotal: 4 }));

    expect(parsed.fragIndex).toBe(3);
    expect(parsed.fragTotal).toBe(4);
  });

  it('reports a truncated frame as too_short even when its version byte is also wrong', () => {
    const truncated = buildFrame({ version: 2 }).subarray(0, 5);

    expectCode(() => parseGattFrame(truncated), 'too_short');
  });

  it('propagates a parse failure out of push() instead of swallowing it', () => {
    const { reassembler } = reassemblerOnClock();

    expectCode(() => reassembler.push(buildFrame({ version: 3 })), 'unsupported_version');
    expect(reassembler.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Interleaving and group-id reuse
 * ------------------------------------------------------------------ */

describe('concurrent groups', () => {
  it('reassembles two interleaved messages independently and correctly', () => {
    const ids = new GroupIdSource(60);
    const payloadA = makePayload(25, 101);
    const payloadB = makePayload(15, 202);
    const a = fragmentMessage(payloadA, CHUNK_AT_23, ids); // group 60, 3 frames
    const b = fragmentMessage(payloadB, CHUNK_AT_23, ids); // group 61, 2 frames

    expect(a).toHaveLength(3);
    expect(b).toHaveLength(2);
    expect(parseGattFrame(a[0]).groupId).toBe(60);
    expect(parseGattFrame(b[0]).groupId).toBe(61);

    const { reassembler } = reassemblerOnClock();

    expect(reassembler.push(a[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);
    expect(reassembler.push(b[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(2);
    expect(reassembler.push(a[1])).toBeNull();
    expect(reassembler.pendingCount).toBe(2);

    expect(reassembler.push(b[1])).toEqual(payloadB);
    expect(reassembler.pendingCount).toBe(1);
    expect(reassembler.push(a[2])).toEqual(payloadA);
    expect(reassembler.pendingCount).toBe(0);
  });

  it('keeps three interleaved messages apart', () => {
    const ids = new GroupIdSource(0);
    const payloads = [makePayload(40, 1), makePayload(55, 2), makePayload(70, 3)];
    const groups = payloads.map(p => fragmentMessage(p, CHUNK_AT_23, ids));
    const { reassembler } = reassemblerOnClock();

    // Round-robin across all three until each is exhausted.
    const longest = Math.max(...groups.map(g => g.length));
    const completed: Uint8Array[] = [];
    for (let i = 0; i < longest; i++) {
      for (const group of groups) {
        if (i < group.length) {
          const out = reassembler.push(group[i]);
          if (out !== null) {
            completed.push(out);
          }
        }
      }
    }

    expect(completed).toHaveLength(3);
    expect(completed[0]).toEqual(payloads[0]);
    expect(completed[1]).toEqual(payloads[1]);
    expect(completed[2]).toEqual(payloads[2]);
    expect(reassembler.pendingCount).toBe(0);
  });

  it('restarts cleanly when a group id is reused with a different fragTotal', () => {
    const payloadOld = makePayload(30, 8); // 3 fragments
    const payloadNew = makePayload(15, 9); // 2 fragments
    const oldFrames = fragmentMessage(payloadOld, CHUNK_AT_23, new GroupIdSource(77));
    const newFrames = fragmentMessage(payloadNew, CHUNK_AT_23, new GroupIdSource(77));

    expect(oldFrames).toHaveLength(3);
    expect(newFrames).toHaveLength(2);

    const { reassembler } = reassemblerOnClock();
    expect(reassembler.push(oldFrames[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);

    expect(reassembler.push(newFrames[0])).toBeNull();
    expect(reassembler.pendingCount).toBe(1);

    const out = reassembler.push(newFrames[1]);
    expect(out).toEqual(payloadNew);
    expect(out).toHaveLength(15);
    expect(reassembler.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * GroupIdSource
 * ------------------------------------------------------------------ */

describe('GroupIdSource', () => {
  it('hands out the seed first, then counts up by one', () => {
    const ids = new GroupIdSource(1000);

    expect(ids.allocate()).toBe(1000);
    expect(ids.allocate()).toBe(1001);
    expect(ids.allocate()).toBe(1002);
  });

  it('starts at 0 when no seed is given', () => {
    const ids = new GroupIdSource();

    expect(ids.allocate()).toBe(0);
    expect(ids.allocate()).toBe(1);
  });

  it('wraps from 0xFFFFFFFF to 0 without going negative or fractional', () => {
    const ids = new GroupIdSource(0xfffffffe);

    const seen = [ids.allocate(), ids.allocate(), ids.allocate(), ids.allocate()];

    expect(seen).toEqual([4294967294, 4294967295, 0, 1]);
    for (const id of seen) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('coerces a negative seed into the unsigned 32-bit range', () => {
    expect(new GroupIdSource(-1).allocate()).toBe(4294967295);
    expect(new GroupIdSource(-2).allocate()).toBe(4294967294);
  });

  it('produces a wrapped id that still encodes as four bytes on the wire', () => {
    const ids = new GroupIdSource(0xffffffff);
    ids.allocate(); // consume 0xFFFFFFFF so the next message wraps to 0

    const frames = fragmentMessage(new Uint8Array(0), CHUNK_AT_23, ids);

    expect(Array.from(frames[0].subarray(1, 5))).toEqual([0, 0, 0, 0]);
    expect(parseGattFrame(frames[0]).groupId).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * reset()
 * ------------------------------------------------------------------ */

describe('reset', () => {
  it('drops every pending group', () => {
    const ids = new GroupIdSource(0);
    const a = fragmentMessage(makePayload(30, 1), CHUNK_AT_23, ids);
    const b = fragmentMessage(makePayload(30, 2), CHUNK_AT_23, ids);
    const { reassembler } = reassemblerOnClock();

    reassembler.push(a[0]);
    reassembler.push(b[0]);
    expect(reassembler.pendingCount).toBe(2);

    reassembler.reset();

    expect(reassembler.pendingCount).toBe(0);
  });

  it('leaves no trace of the dropped groups, so a resent message reassembles from scratch', () => {
    const payload = makePayload(30, 4);
    const frames = fragmentMessage(payload, CHUNK_AT_23, new GroupIdSource(5));
    const { reassembler } = reassemblerOnClock();

    reassembler.push(frames[0]);
    reassembler.push(frames[1]);
    reassembler.reset();

    // The two frames already delivered are gone; only a full resend completes.
    expect(reassembler.push(frames[2])).toBeNull();
    expect(reassembler.push(frames[0])).toBeNull();
    expect(reassembler.push(frames[1])).toEqual(payload);
    expect(reassembler.pendingCount).toBe(0);
  });

  it('is safe to call when nothing is pending', () => {
    const { reassembler } = reassemblerOnClock();

    reassembler.reset();

    expect(reassembler.pendingCount).toBe(0);
  });
});
