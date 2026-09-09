/**
 * GattMessage — the six-byte envelope that rides inside a reassembled GATT payload.
 *
 * What these tests hold the implementation to:
 *
 *   - the exact wire bytes, because two builds of different ages have to agree on
 *     them without negotiating anything;
 *   - forward compatibility: an unrecognised type byte must decode cleanly with
 *     `known === false` and an intact payload, never throw;
 *   - the failure contract: `decodeGattMessage` throws a `GattMessageError` whose
 *     `code` names the fault, and `tryDecodeGattMessage` converts every one of
 *     those into `null` so a bad frame cannot kill a link;
 *   - the boundaries either side of every limit — the 6-byte header, the 4-bit
 *     flags nibble, and the 32-bit message id space.
 *
 * Imports are limited to the pure modules: GattMessage, GattFraming and
 * GattProfile. Nothing here reaches a native transport.
 */

import {
  GATT_MESSAGE_HEADER_BYTES,
  GATT_MESSAGE_VERSION,
  GattMessageError,
  GattMessageType,
  MessageIdSource,
  decodeGattMessage,
  encodeGattMessage,
  tryDecodeGattMessage,
} from '../bluetooth/gatt/GattMessage';
import type {
  GattMessage,
  GattMessageErrorCode,
  GattMessageTypeValue,
} from '../bluetooth/gatt/GattMessage';
import {
  GattReassembler,
  GroupIdSource,
  fragmentMessage,
} from '../bluetooth/gatt/GattFraming';
import {
  ATT_DEFAULT_MTU,
  ATT_HEADER_BYTES,
  payloadBytesForMtu,
} from '../bluetooth/gatt/GattProfile';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Byte-for-byte comparison as plain numbers, so a failure prints readable values. */
function asNumbers(value: Uint8Array): number[] {
  return Array.from(value);
}

function makePayload(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i * 7 + 3) & 0xff;
  }
  return out;
}

/**
 * Assert that `fn` throws a `GattMessageError` carrying `code`, and hand the
 * error back so a caller can inspect it further.
 */
function expectMessageError(
  fn: () => unknown,
  code: GattMessageErrorCode,
): GattMessageError {
  let caught: unknown = undefined;
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
    caught = error;
  }
  expect(threw).toBe(true);
  expect(caught).toBeInstanceOf(GattMessageError);
  const gattError = caught as GattMessageError;
  expect(gattError.code).toBe(code);
  return gattError;
}

/** Build a raw envelope without going through the encoder, for malformed-input tests. */
function rawEnvelope(
  byte0: number,
  type: number,
  id: number,
  payload: number[] = [],
): Uint8Array {
  const out = new Uint8Array(GATT_MESSAGE_HEADER_BYTES + payload.length);
  out[0] = byte0 & 0xff;
  out[1] = type & 0xff;
  out[2] = id & 0xff;
  out[3] = (id >>> 8) & 0xff;
  out[4] = (id >>> 16) & 0xff;
  out[5] = (id >>> 24) & 0xff;
  out.set(Uint8Array.from(payload), GATT_MESSAGE_HEADER_BYTES);
  return out;
}

const DEFINED_TYPES: ReadonlyArray<{ name: string; value: GattMessageTypeValue }> = [
  { name: 'Hello', value: GattMessageType.Hello },
  { name: 'Ack', value: GattMessageType.Ack },
  { name: 'Ping', value: GattMessageType.Ping },
  { name: 'Pong', value: GattMessageType.Pong },
];

/** Type bytes this build has no meaning for — the forward-compatibility cases. */
const UNDEFINED_TYPE_BYTES: readonly number[] = [0x00, 0x05, 0x06, 0x7f, 0x80, 0xfe, 0xff];

const MAX_U32 = 0xffffffff;
const U32_SPACE = 0x100000000;

/* ------------------------------------------------------------------ *
 * Constants and the type table
 * ------------------------------------------------------------------ */

describe('envelope constants', () => {
  it('declares a six-byte header, matching the documented layout', () => {
    expect(GATT_MESSAGE_HEADER_BYTES).toBe(6);
  });

  it('speaks wire version 1', () => {
    expect(GATT_MESSAGE_VERSION).toBe(1);
  });

  it('assigns each message type the wire value the protocol reserved for it', () => {
    expect(GattMessageType.Hello).toBe(0x01);
    expect(GattMessageType.Ack).toBe(0x02);
    expect(GattMessageType.Ping).toBe(0x03);
    expect(GattMessageType.Pong).toBe(0x04);
  });
});

/* ------------------------------------------------------------------ *
 * Exact byte layout
 * ------------------------------------------------------------------ */

describe('wire layout', () => {
  it('encodes a known envelope to the exact bytes a peer expects', () => {
    const encoded = encodeGattMessage({
      type: GattMessageType.Hello,
      messageId: 0x04030201,
      flags: 0,
      payload: Uint8Array.from([0xaa, 0xbb]),
    });

    expect(asNumbers(encoded)).toEqual([0x10, 0x01, 0x01, 0x02, 0x03, 0x04, 0xaa, 0xbb]);
  });

  it('packs version into the high nibble and flags into the low nibble of byte 0', () => {
    const encoded = encodeGattMessage({
      type: GattMessageType.Ping,
      messageId: 0,
      flags: 0x5,
    });

    expect(encoded[0]).toBe(0x15);
    expect((encoded[0] >>> 4) & 0x0f).toBe(GATT_MESSAGE_VERSION);
    expect(encoded[0] & 0x0f).toBe(0x5);
  });

  it('writes the message type verbatim at byte 1', () => {
    for (const entry of DEFINED_TYPES) {
      const encoded = encodeGattMessage({ type: entry.value, messageId: 0 });
      expect(encoded[1]).toBe(entry.value);
    }
  });

  it('writes the message id little-endian across bytes 2 through 5', () => {
    const encoded = encodeGattMessage({ type: GattMessageType.Ack, messageId: 0x12345678 });

    expect(encoded[2]).toBe(0x78);
    expect(encoded[3]).toBe(0x56);
    expect(encoded[4]).toBe(0x34);
    expect(encoded[5]).toBe(0x12);
  });

  it('places the payload at offset 6 and nowhere else', () => {
    const payload = Uint8Array.from([0x01, 0x02, 0x03, 0x04]);
    const encoded = encodeGattMessage({
      type: GattMessageType.Pong,
      messageId: 0,
      payload,
    });

    expect(encoded.length).toBe(GATT_MESSAGE_HEADER_BYTES + payload.length);
    expect(asNumbers(encoded.subarray(GATT_MESSAGE_HEADER_BYTES))).toEqual([1, 2, 3, 4]);
  });

  it('costs exactly six bytes of overhead for any payload length', () => {
    for (const length of [0, 1, 2, 14, 20, 255, 1024]) {
      const encoded = encodeGattMessage({
        type: GattMessageType.Hello,
        messageId: 7,
        payload: makePayload(length),
      });
      expect(encoded.length).toBe(GATT_MESSAGE_HEADER_BYTES + length);
    }
  });

  it('decodes a hand-built envelope into exactly the fields its bytes describe', () => {
    const decoded = decodeGattMessage(
      Uint8Array.from([0x13, 0x02, 0xef, 0xbe, 0xad, 0xde, 0x09, 0x08]),
    );

    expect(decoded.version).toBe(1);
    expect(decoded.flags).toBe(0x3);
    expect(decoded.type).toBe(GattMessageType.Ack);
    expect(decoded.messageId).toBe(0xdeadbeef);
    expect(asNumbers(decoded.payload)).toEqual([0x09, 0x08]);
    expect(decoded.known).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Round trips across every defined type
 * ------------------------------------------------------------------ */

describe('round trip for every defined message type', () => {
  for (const entry of DEFINED_TYPES) {
    it(`carries a ${entry.name} with an empty payload back unchanged`, () => {
      const decoded = decodeGattMessage(
        encodeGattMessage({ type: entry.value, messageId: 0x0a0b0c0d }),
      );

      expect(decoded.type).toBe(entry.value);
      expect(decoded.messageId).toBe(0x0a0b0c0d);
      expect(decoded.payload.length).toBe(0);
      expect(decoded.known).toBe(true);
      expect(decoded.version).toBe(GATT_MESSAGE_VERSION);
      expect(decoded.flags).toBe(0);
    });

    it(`carries a ${entry.name} with a real payload back byte for byte`, () => {
      const payload = makePayload(64);
      const decoded = decodeGattMessage(
        encodeGattMessage({ type: entry.value, messageId: 4242, payload, flags: 0x2 }),
      );

      expect(decoded.type).toBe(entry.value);
      expect(decoded.messageId).toBe(4242);
      expect(decoded.flags).toBe(0x2);
      expect(decoded.known).toBe(true);
      expect(asNumbers(decoded.payload)).toEqual(asNumbers(payload));
    });
  }
});

/* ------------------------------------------------------------------ *
 * Omitted and empty payloads
 * ------------------------------------------------------------------ */

describe('payload presence', () => {
  it('encodes an omitted payload to exactly the header, with no trailing bytes', () => {
    const encoded = encodeGattMessage({ type: GattMessageType.Ack, messageId: 1 });
    expect(encoded.length).toBe(GATT_MESSAGE_HEADER_BYTES);
  });

  it('decodes a header-only envelope to a zero-length payload rather than failing', () => {
    const decoded = decodeGattMessage(
      encodeGattMessage({ type: GattMessageType.Ack, messageId: 1 }),
    );

    expect(decoded.payload.length).toBe(0);
    expect(asNumbers(decoded.payload)).toEqual([]);
  });

  it('treats an explicitly empty payload identically to an omitted one', () => {
    const omitted = encodeGattMessage({ type: GattMessageType.Ping, messageId: 99 });
    const explicit = encodeGattMessage({
      type: GattMessageType.Ping,
      messageId: 99,
      payload: new Uint8Array(0),
    });

    expect(asNumbers(explicit)).toEqual(asNumbers(omitted));
  });

  it('round-trips a single-byte payload, the smallest non-empty case', () => {
    const decoded = decodeGattMessage(
      encodeGattMessage({
        type: GattMessageType.Hello,
        messageId: 5,
        payload: Uint8Array.from([0x7f]),
      }),
    );

    expect(asNumbers(decoded.payload)).toEqual([0x7f]);
  });

  it('copies the payload into the envelope rather than aliasing the caller buffer', () => {
    const payload = Uint8Array.from([1, 2, 3]);
    const encoded = encodeGattMessage({ type: GattMessageType.Hello, messageId: 0, payload });

    payload[0] = 0xff;

    expect(encoded[GATT_MESSAGE_HEADER_BYTES]).toBe(1);
  });

  it('hands back the decoded payload as a view over the source bytes, so a receive path reusing its buffer must copy first', () => {
    const source = encodeGattMessage({
      type: GattMessageType.Hello,
      messageId: 0,
      payload: Uint8Array.from([1, 2, 3]),
    });
    const decoded = decodeGattMessage(source);

    expect(decoded.payload.byteOffset).toBe(GATT_MESSAGE_HEADER_BYTES);
    expect(decoded.payload.buffer).toBe(source.buffer);

    source[GATT_MESSAGE_HEADER_BYTES] = 0x99;
    expect(decoded.payload[0]).toBe(0x99);
  });
});

/* ------------------------------------------------------------------ *
 * Message id boundaries
 * ------------------------------------------------------------------ */

describe('message id boundaries', () => {
  it('round-trips id 0, the bottom of the space', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 0 }));
    expect(decoded.messageId).toBe(0);
  });

  it('encodes id 0 as four zero bytes', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: 0 });
    expect(asNumbers(encoded.subarray(2, 6))).toEqual([0, 0, 0, 0]);
  });

  it('round-trips id 1, one above the bottom', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 1 }));
    expect(decoded.messageId).toBe(1);
  });

  it('round-trips 0xfffffffe, one below the top of the space', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 0xfffffffe }));
    expect(decoded.messageId).toBe(0xfffffffe);
  });

  it('round-trips 0xffffffff exactly, without sign-extending it to -1', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: MAX_U32 });
    expect(asNumbers(encoded.subarray(2, 6))).toEqual([0xff, 0xff, 0xff, 0xff]);

    const decoded = decodeGattMessage(encoded);
    expect(decoded.messageId).toBe(MAX_U32);
    expect(decoded.messageId).toBeGreaterThan(0);
  });

  it('round-trips 0x80000000, where a signed reading would flip to negative', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 0x80000000 }));
    expect(decoded.messageId).toBe(0x80000000);
  });

  it('masks an id of exactly 2^32 down to 0 rather than corrupting the envelope', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: U32_SPACE });
    expect(encoded.length).toBe(GATT_MESSAGE_HEADER_BYTES);
    expect(asNumbers(encoded.subarray(2, 6))).toEqual([0, 0, 0, 0]);
    expect(decodeGattMessage(encoded).messageId).toBe(0);
  });

  it('masks an id above 2^32 to its low 32 bits, keeping the remainder intact', () => {
    const decoded = decodeGattMessage(
      encodeGattMessage({ type: 1, messageId: U32_SPACE + 0x2a }),
    );
    expect(decoded.messageId).toBe(0x2a);
  });

  it('masks 2^32 + 0xffffffff to 0xffffffff', () => {
    const decoded = decodeGattMessage(
      encodeGattMessage({ type: 1, messageId: U32_SPACE + MAX_U32 }),
    );
    expect(decoded.messageId).toBe(MAX_U32);
  });

  it('coerces -1 through >>> 0 to 0xffffffff', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: -1 }));
    expect(decoded.messageId).toBe(MAX_U32);
  });

  it('coerces -2 through >>> 0 to 0xfffffffe', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: -2 }));
    expect(decoded.messageId).toBe(0xfffffffe);
  });

  it('coerces a negative id the same way every time, so two encodes of it agree', () => {
    const first = encodeGattMessage({ type: 1, messageId: -12345 });
    const second = encodeGattMessage({ type: 1, messageId: -12345 });

    expect(asNumbers(first)).toEqual(asNumbers(second));
    expect(decodeGattMessage(first).messageId).toBe(4294954951);
    expect(decodeGattMessage(first).messageId).toBe(-12345 >>> 0);
  });

  it('never decodes a message id outside the unsigned 32-bit range', () => {
    for (const id of [0, 1, 0x7fffffff, 0x80000000, MAX_U32, -1, U32_SPACE, U32_SPACE + 3]) {
      const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: id }));
      expect(Number.isInteger(decoded.messageId)).toBe(true);
      expect(decoded.messageId).toBeGreaterThanOrEqual(0);
      expect(decoded.messageId).toBeLessThanOrEqual(MAX_U32);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Forward compatibility
 * ------------------------------------------------------------------ */

describe('forward compatibility with unknown types', () => {
  for (const entry of DEFINED_TYPES) {
    it(`marks ${entry.name} as known, so this build acts on it`, () => {
      const decoded = decodeGattMessage(encodeGattMessage({ type: entry.value, messageId: 1 }));
      expect(decoded.known).toBe(true);
    });
  }

  for (const typeByte of UNDEFINED_TYPE_BYTES) {
    const label = `0x${typeByte.toString(16).padStart(2, '0')}`;
    it(`decodes unrecognised type ${label} with known === false instead of throwing`, () => {
      const decoded = decodeGattMessage(rawEnvelope(0x10, typeByte, 77));

      expect(decoded.known).toBe(false);
      expect(decoded.type).toBe(typeByte);
      expect(decoded.messageId).toBe(77);
      expect(decoded.version).toBe(GATT_MESSAGE_VERSION);
    });
  }

  it('hands an unknown type its payload intact, so the message can still be acknowledged', () => {
    const payload = makePayload(32);
    const raw = new Uint8Array(GATT_MESSAGE_HEADER_BYTES + payload.length);
    raw.set(rawEnvelope(0x1a, 0x5c, 0x0f0e0d0c));
    raw.set(payload, GATT_MESSAGE_HEADER_BYTES);

    const decoded = decodeGattMessage(raw);

    expect(decoded.known).toBe(false);
    expect(decoded.type).toBe(0x5c);
    expect(decoded.version).toBe(1);
    expect(decoded.flags).toBe(0xa);
    expect(decoded.messageId).toBe(0x0f0e0d0c);
    expect(asNumbers(decoded.payload)).toEqual(asNumbers(payload));
  });

  it('accepts a future type byte written by this build encoder', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 0xf0, messageId: 3 }));
    expect(decoded.type).toBe(0xf0);
    expect(decoded.known).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Malformed input
 * ------------------------------------------------------------------ */

describe('malformed envelopes', () => {
  for (let length = 0; length < GATT_MESSAGE_HEADER_BYTES; length++) {
    const size = length;
    it(`rejects a ${size}-byte envelope with code too_short`, () => {
      const error = expectMessageError(
        () => decodeGattMessage(new Uint8Array(size)),
        'too_short',
      );
      expect(error.name).toBe('GattMessageError');
      expect(error).toBeInstanceOf(Error);
    });
  }

  it('accepts a six-byte envelope, the exact threshold', () => {
    const decoded = decodeGattMessage(rawEnvelope(0x10, GattMessageType.Ack, 0));
    expect(decoded.type).toBe(GattMessageType.Ack);
    expect(decoded.payload.length).toBe(0);
  });

  it('rejects version 0 with code unsupported_version', () => {
    expectMessageError(
      () => decodeGattMessage(rawEnvelope(0x00, GattMessageType.Hello, 1)),
      'unsupported_version',
    );
  });

  it('rejects version 2, one above the supported version', () => {
    expectMessageError(
      () => decodeGattMessage(rawEnvelope(0x20, GattMessageType.Hello, 1)),
      'unsupported_version',
    );
  });

  it('rejects version 15, the top of the nibble', () => {
    expectMessageError(
      () => decodeGattMessage(rawEnvelope(0xf0, GattMessageType.Hello, 1)),
      'unsupported_version',
    );
  });

  it('reads the version from the high nibble only, so full flags never make a v0 envelope pass', () => {
    expectMessageError(
      () => decodeGattMessage(rawEnvelope(0x0f, GattMessageType.Hello, 1)),
      'unsupported_version',
    );
    expect(decodeGattMessage(rawEnvelope(0x1f, GattMessageType.Hello, 1)).version).toBe(1);
  });

  it('reports the length fault first when an envelope is both short and wrongly versioned', () => {
    const stub = Uint8Array.from([0x20, 0x01, 0x00]);
    expectMessageError(() => decodeGattMessage(stub), 'too_short');
  });

  it('names the offending byte count and the required header size in the too_short message', () => {
    const error = expectMessageError(() => decodeGattMessage(new Uint8Array(3)), 'too_short');
    expect(error.message).toContain('3');
    expect(error.message).toContain('6');
  });

  it('names the offending version in the unsupported_version message', () => {
    const error = expectMessageError(
      () => decodeGattMessage(rawEnvelope(0x70, 1, 0)),
      'unsupported_version',
    );
    expect(error.message).toContain('7');
  });
});

/* ------------------------------------------------------------------ *
 * Non-throwing decode
 * ------------------------------------------------------------------ */

describe('tryDecodeGattMessage', () => {
  for (let length = 0; length < GATT_MESSAGE_HEADER_BYTES; length++) {
    const size = length;
    it(`returns null for a ${size}-byte envelope instead of throwing`, () => {
      expect(tryDecodeGattMessage(new Uint8Array(size))).toBeNull();
    });
  }

  it('returns null for every unsupported version instead of throwing', () => {
    expect(tryDecodeGattMessage(rawEnvelope(0x00, GattMessageType.Hello, 1))).toBeNull();
    expect(tryDecodeGattMessage(rawEnvelope(0x20, GattMessageType.Hello, 1))).toBeNull();
    expect(tryDecodeGattMessage(rawEnvelope(0xf0, GattMessageType.Hello, 1))).toBeNull();
  });

  it('returns the same decoded message as the throwing decoder for valid bytes', () => {
    const encoded = encodeGattMessage({
      type: GattMessageType.Pong,
      messageId: 0xcafebabe,
      flags: 0x6,
      payload: Uint8Array.from([1, 2, 3]),
    });

    const lenient: GattMessage | null = tryDecodeGattMessage(encoded);
    expect(lenient).not.toBeNull();

    const strict = decodeGattMessage(encoded);
    expect(lenient?.type).toBe(strict.type);
    expect(lenient?.messageId).toBe(0xcafebabe);
    expect(lenient?.flags).toBe(0x6);
    expect(lenient?.version).toBe(1);
    expect(lenient?.known).toBe(true);
    expect(asNumbers(lenient?.payload ?? new Uint8Array(0))).toEqual([1, 2, 3]);
  });

  it('returns a decoded message for an unknown type rather than null', () => {
    const lenient = tryDecodeGattMessage(rawEnvelope(0x10, 0xab, 12));
    expect(lenient).not.toBeNull();
    expect(lenient?.known).toBe(false);
    expect(lenient?.type).toBe(0xab);
  });

  it('accepts the six-byte threshold that the length rule rejects one byte below', () => {
    expect(tryDecodeGattMessage(new Uint8Array(5))).toBeNull();
    expect(tryDecodeGattMessage(rawEnvelope(0x10, GattMessageType.Ping, 4))?.type).toBe(
      GattMessageType.Ping,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Flags
 * ------------------------------------------------------------------ */

describe('flags nibble', () => {
  it('defaults to 0 when no flags are given', () => {
    const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 0 }));
    expect(decoded.flags).toBe(0);
  });

  it('round-trips flags 0, the bottom of the nibble', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: 0, flags: 0 });
    expect(encoded[0]).toBe(0x10);

    const decoded = decodeGattMessage(encoded);
    expect(decoded.flags).toBe(0);
    expect(decoded.version).toBe(1);
  });

  it('round-trips flags 0xf without bleeding into the version nibble', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: 0, flags: 0xf });
    expect(encoded[0]).toBe(0x1f);

    const decoded = decodeGattMessage(encoded);
    expect(decoded.flags).toBe(0xf);
    expect(decoded.version).toBe(GATT_MESSAGE_VERSION);
  });

  it('round-trips every value the nibble can hold', () => {
    for (let flags = 0; flags <= 0xf; flags++) {
      const decoded = decodeGattMessage(encodeGattMessage({ type: 1, messageId: 0, flags }));
      expect(decoded.flags).toBe(flags);
      expect(decoded.version).toBe(GATT_MESSAGE_VERSION);
    }
  });

  it('masks a flags value of 0x10, the first bit above the nibble, back to 0', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: 0, flags: 0x10 });
    expect(encoded[0]).toBe(0x10);

    const decoded = decodeGattMessage(encoded);
    expect(decoded.flags).toBe(0);
    expect(decoded.version).toBe(1);
  });

  it('masks 0xff down to 0xf rather than overwriting the version', () => {
    const encoded = encodeGattMessage({ type: 1, messageId: 0, flags: 0xff });
    expect(encoded[0]).toBe(0x1f);

    const decoded = decodeGattMessage(encoded);
    expect(decoded.version).toBe(1);
    expect(decoded.flags).toBe(0xf);
  });

  it('keeps flags independent of type, message id and payload', () => {
    const decoded = decodeGattMessage(
      encodeGattMessage({
        type: GattMessageType.Pong,
        messageId: MAX_U32,
        flags: 0x9,
        payload: Uint8Array.from([0xff, 0x00]),
      }),
    );

    expect(decoded.flags).toBe(0x9);
    expect(decoded.type).toBe(GattMessageType.Pong);
    expect(decoded.messageId).toBe(MAX_U32);
    expect(asNumbers(decoded.payload)).toEqual([0xff, 0x00]);
  });
});

/* ------------------------------------------------------------------ *
 * MessageIdSource
 * ------------------------------------------------------------------ */

describe('MessageIdSource', () => {
  it('starts at 1 by default, leaving 0 free as a sentinel', () => {
    const ids = new MessageIdSource();
    expect(ids.allocate()).toBe(1);
    expect(ids.allocate()).toBe(2);
    expect(ids.allocate()).toBe(3);
  });

  it('issues ids sequentially from its seed', () => {
    const ids = new MessageIdSource(100);
    expect([ids.allocate(), ids.allocate(), ids.allocate()]).toEqual([100, 101, 102]);
  });

  it('returns a seed of 0 first, then counts up', () => {
    const ids = new MessageIdSource(0);
    expect(ids.allocate()).toBe(0);
    expect(ids.allocate()).toBe(1);
  });

  it('wraps from 0xffffffff to 0 rather than growing past 32 bits', () => {
    const ids = new MessageIdSource(MAX_U32);
    expect(ids.allocate()).toBe(MAX_U32);
    expect(ids.allocate()).toBe(0);
    expect(ids.allocate()).toBe(1);
  });

  it('crosses the wrap cleanly when seeded one below the top', () => {
    const ids = new MessageIdSource(0xfffffffe);
    expect([ids.allocate(), ids.allocate(), ids.allocate()]).toEqual([0xfffffffe, MAX_U32, 0]);
  });

  it('folds a seed of exactly 2^32 to 0', () => {
    expect(new MessageIdSource(U32_SPACE).allocate()).toBe(0);
  });

  it('folds a seed above 2^32 into the 32-bit space', () => {
    expect(new MessageIdSource(U32_SPACE + 9).allocate()).toBe(9);
  });

  it('folds a negative seed to its unsigned equivalent', () => {
    expect(new MessageIdSource(-1).allocate()).toBe(MAX_U32);
    expect(new MessageIdSource(-2).allocate()).toBe(0xfffffffe);
  });

  it('truncates a fractional seed to an integer', () => {
    expect(new MessageIdSource(7.9).allocate()).toBe(7);
  });

  it('never issues a negative or fractional id, even across the wrap', () => {
    const ids = new MessageIdSource(MAX_U32 - 4);
    for (let i = 0; i < 512; i++) {
      const id = ids.allocate();
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(MAX_U32);
    }
  });

  it('issues no repeats within a run far shorter than the id space', () => {
    const ids = new MessageIdSource(0);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(ids.allocate());
    }
    expect(seen.size).toBe(1000);
  });

  it('gives two sources independent sequences', () => {
    const a = new MessageIdSource(10);
    const b = new MessageIdSource(10);

    expect(a.allocate()).toBe(10);
    expect(a.allocate()).toBe(11);
    expect(b.allocate()).toBe(10);
  });

  it('produces ids that survive an encode/decode round trip unchanged across the wrap', () => {
    const ids = new MessageIdSource(MAX_U32 - 1);
    for (let i = 0; i < 4; i++) {
      const id = ids.allocate();
      const decoded = decodeGattMessage(
        encodeGattMessage({ type: GattMessageType.Ping, messageId: id }),
      );
      expect(decoded.messageId).toBe(id);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Envelope nested inside a framing round trip
 * ------------------------------------------------------------------ */

describe('envelope through the fragmentation layer', () => {
  const MAX_FRAGMENT_PAYLOAD = payloadBytesForMtu(ATT_DEFAULT_MTU);

  /** Fragment at the un-negotiated 23-byte MTU and reassemble, in delivery order. */
  function throughFraming(envelope: Uint8Array): { frames: Uint8Array[]; out: Uint8Array } {
    const frames = fragmentMessage(envelope, MAX_FRAGMENT_PAYLOAD, new GroupIdSource(0));
    const reassembler = new GattReassembler();
    let out: Uint8Array | null = null;
    for (const frame of frames) {
      const result = reassembler.push(frame);
      if (result !== null) {
        out = result;
      }
    }
    if (out === null) {
      throw new Error('reassembly never completed');
    }
    return { frames, out };
  }

  it('leaves 11 usable payload bytes per frame at the 23-byte MTU', () => {
    expect(MAX_FRAGMENT_PAYLOAD).toBe(11);
  });

  it('carries a multi-fragment envelope across a 23-byte MTU with type, id and payload intact', () => {
    const payload = makePayload(100);
    const envelope = encodeGattMessage({
      type: GattMessageType.Hello,
      messageId: 0xdeadbeef,
      flags: 0x4,
      payload,
    });
    expect(envelope.length).toBe(106);

    const { frames, out } = throughFraming(envelope);
    expect(frames.length).toBe(10);
    for (const frame of frames) {
      expect(frame.length).toBeLessThanOrEqual(ATT_DEFAULT_MTU - ATT_HEADER_BYTES);
    }

    const decoded = decodeGattMessage(out);
    expect(decoded.type).toBe(GattMessageType.Hello);
    expect(decoded.messageId).toBe(0xdeadbeef);
    expect(decoded.flags).toBe(0x4);
    expect(decoded.version).toBe(GATT_MESSAGE_VERSION);
    expect(decoded.known).toBe(true);
    expect(asNumbers(decoded.payload)).toEqual(asNumbers(payload));
  });

  it('carries a header-only envelope through framing as a single frame', () => {
    const envelope = encodeGattMessage({ type: GattMessageType.Ack, messageId: 1 });
    const { frames, out } = throughFraming(envelope);

    expect(frames.length).toBe(1);
    expect(asNumbers(out)).toEqual(asNumbers(envelope));

    const decoded = decodeGattMessage(out);
    expect(decoded.type).toBe(GattMessageType.Ack);
    expect(decoded.messageId).toBe(1);
    expect(decoded.payload.length).toBe(0);
  });

  it('carries an envelope that exactly fills one fragment', () => {
    const envelope = encodeGattMessage({
      type: GattMessageType.Ping,
      messageId: 8,
      payload: makePayload(MAX_FRAGMENT_PAYLOAD - GATT_MESSAGE_HEADER_BYTES),
    });
    expect(envelope.length).toBe(MAX_FRAGMENT_PAYLOAD);

    const { frames, out } = throughFraming(envelope);
    expect(frames.length).toBe(1);
    expect(decodeGattMessage(out).messageId).toBe(8);
  });

  it('splits an envelope one byte past a fragment boundary into two frames and rebuilds it', () => {
    const payloadLength = MAX_FRAGMENT_PAYLOAD - GATT_MESSAGE_HEADER_BYTES + 1;
    const envelope = encodeGattMessage({
      type: GattMessageType.Pong,
      messageId: 9,
      payload: makePayload(payloadLength),
    });
    expect(envelope.length).toBe(MAX_FRAGMENT_PAYLOAD + 1);

    const { frames, out } = throughFraming(envelope);
    expect(frames.length).toBe(2);

    const decoded = decodeGattMessage(out);
    expect(decoded.type).toBe(GattMessageType.Pong);
    expect(decoded.messageId).toBe(9);
    expect(decoded.payload.length).toBe(payloadLength);
  });

  it('survives fragments arriving in reverse order', () => {
    const payload = makePayload(50);
    const envelope = encodeGattMessage({
      type: GattMessageType.Hello,
      messageId: 0x01020304,
      payload,
    });
    const frames = fragmentMessage(envelope, MAX_FRAGMENT_PAYLOAD, new GroupIdSource(0));
    expect(frames.length).toBeGreaterThan(1);

    const reassembler = new GattReassembler();
    let out: Uint8Array | null = null;
    for (const frame of [...frames].reverse()) {
      const result = reassembler.push(frame);
      if (result !== null) {
        out = result;
      }
    }
    expect(out).not.toBeNull();

    const decoded = decodeGattMessage(out ?? new Uint8Array(0));
    expect(decoded.messageId).toBe(0x01020304);
    expect(asNumbers(decoded.payload)).toEqual(asNumbers(payload));
  });

  it('carries an unknown type across framing still marked unknown', () => {
    const payload = makePayload(40);
    const envelope = encodeGattMessage({ type: 0x7b, messageId: 55, payload });
    const { out } = throughFraming(envelope);

    const decoded = decodeGattMessage(out);
    expect(decoded.type).toBe(0x7b);
    expect(decoded.known).toBe(false);
    expect(asNumbers(decoded.payload)).toEqual(asNumbers(payload));
  });
});
