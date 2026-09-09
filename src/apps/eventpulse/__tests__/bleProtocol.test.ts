/**
 * Safety net for the EventPulse BLE advertisement codec.
 *
 * The codec is a wire format: any silent change to a field offset, to the
 * endianness, to the CRC window or to the truncation rule breaks
 * interoperability with peers running an older build, and nothing else in the
 * app would notice. So these tests pin the *bytes*, not just the round trip —
 * the layout test asserts a literal frame byte by byte, and the boundary tests
 * hold the frame at exactly 13 and exactly 21 bytes.
 *
 * Everything exercised here is the real implementation: `BleProtocol` and
 * `utils/bytes` are pure TypeScript with no platform imports, so there is
 * nothing to fake and nothing is faked.
 */

import type { BleAdvertisement, PeerCapabilities, PresenceStatus } from '../types';
import {
  BLE_PROTOCOL_VERSION,
  BleProtocolError,
  MAX_DISPLAY_TAG_BYTES,
  MAX_PAYLOAD_BYTES,
  decodeAdvertisement,
  decodeCapabilities,
  encodeAdvertisement,
  encodeCapabilities,
  eventCodeFromId,
  matchesEvent,
  tryDecodeAdvertisement,
} from '../bluetooth/BleProtocol';
import type { BleProtocolErrorCode, EncodeInput } from '../bluetooth/BleProtocol';
import { crc8, fnv1a32, utf8Encode } from '../utils/bytes';

/* ------------------------------------------------------------------ *
 * Fixtures & helpers
 * ------------------------------------------------------------------ */

/** Documented minimum frame: 12 fixed bytes + 0 tag bytes + 1 crc. */
const MIN_FRAME_BYTES = 13;
/** Documented maximum frame: 12 fixed bytes + 8 tag bytes + 1 crc. */
const MAX_FRAME_BYTES = 21;

const ALL_CAPABILITIES: PeerCapabilities = {
  acceptsConnections: true,
  supportsNavigation: true,
  isAnchor: true,
};
const NO_CAPABILITIES: PeerCapabilities = {
  acceptsConnections: false,
  supportsNavigation: false,
  isAnchor: false,
};

/**
 * The canonical frame used by the byte-layout test. Its exact serialisation is
 * written out in `KNOWN_FRAME_BYTES` below; the two must never drift apart.
 */
const KNOWN_INPUT: EncodeInput = {
  eventCode: 0xbeef,
  peerId: '0A1B2C3D',
  profileVersion: 42,
  avatarId: '07F3',
  displayTag: 'Ada',
  status: 'busy',
  capabilities: ALL_CAPABILITIES,
};

/** Derived by hand from the frame layout comment at the top of BleProtocol.ts. */
const KNOWN_FRAME_BYTES: readonly number[] = [
  0x18, // header: version 1 (0b0001) << 4 | status busy (0b10) << 2 | reserved 0b00
  0xbe,
  0xef, // eventCode 0xBEEF, big-endian
  0x0a,
  0x1b,
  0x2c,
  0x3d, // peerId 0A1B2C3D, 4 raw bytes
  0x2a, // profileVersion 42
  0x07,
  0xf3, // avatarId 07F3, big-endian
  0x07, // capabilities: accepts | navigation | anchor
  0x03, // displayTag byte length
  0x41,
  0x64,
  0x61, // displayTag "Ada"
  0xd1, // crc8 over bytes [0, 15)
];

function makeInput(overrides: Partial<EncodeInput> = {}): EncodeInput {
  return { ...KNOWN_INPUT, ...overrides };
}

function capabilitiesFromBits(bits: number): PeerCapabilities {
  return {
    acceptsConnections: (bits & 1) !== 0,
    supportsNavigation: (bits & 2) !== 0,
    isAnchor: (bits & 4) !== 0,
  };
}

const CAPABILITY_COMBINATIONS: readonly PeerCapabilities[] = [0, 1, 2, 3, 4, 5, 6, 7].map(
  capabilitiesFromBits,
);

const ALL_STATUSES: readonly PresenceStatus[] = ['available', 'maybe', 'busy'];

/**
 * Assert that `run` throws a `BleProtocolError` carrying exactly `code`, and
 * hand the error back for further assertions. `label` identifies the case when
 * the call site is a loop.
 */
function expectProtocolError(
  run: () => unknown,
  code: BleProtocolErrorCode,
  label = 'input',
): BleProtocolError {
  let thrown: unknown = null;
  let threw = false;
  try {
    run();
  } catch (error) {
    thrown = error;
    threw = true;
  }
  if (!threw) {
    throw new Error(`${label}: expected BleProtocolError("${code}") but nothing was thrown`);
  }
  if (!(thrown instanceof BleProtocolError)) {
    throw new Error(`${label}: expected BleProtocolError("${code}") but got ${String(thrown)}`);
  }
  // Compared as an object so a mismatch names the offending case, not just the code.
  expect({ label, code: thrown.code }).toEqual({ label, code });
  return thrown;
}

interface RawFrameOptions {
  version?: number;
  statusCode?: number;
  reservedBits?: number;
  eventCode?: number;
  peerIdBytes?: readonly number[];
  profileVersion?: number;
  avatarIdBytes?: readonly number[];
  capabilityBits?: number;
  /** Written into the length field; defaults to `tagBytes.length`. */
  declaredTagLength?: number;
  tagBytes?: readonly number[];
  /** Written as the trailing byte; defaults to the correct crc8. */
  crcOverride?: number;
}

/**
 * Build a frame byte by byte, independently of `encodeAdvertisement`, so the
 * decoder can be pointed at frames the encoder is incapable of producing.
 */
function buildRawFrame(options: RawFrameOptions = {}): Uint8Array {
  const tagBytes = options.tagBytes ?? [];
  const version = options.version ?? BLE_PROTOCOL_VERSION;
  const eventCode = options.eventCode ?? 0xbeef;

  const body = Uint8Array.from([
    ((version & 0x0f) << 4) |
      (((options.statusCode ?? 0) & 0x03) << 2) |
      ((options.reservedBits ?? 0) & 0x03),
    (eventCode >> 8) & 0xff,
    eventCode & 0xff,
    ...(options.peerIdBytes ?? [0x0a, 0x1b, 0x2c, 0x3d]),
    (options.profileVersion ?? 42) & 0xff,
    ...(options.avatarIdBytes ?? [0x07, 0xf3]),
    options.capabilityBits ?? 0x07,
    options.declaredTagLength ?? tagBytes.length,
    ...tagBytes,
  ]);

  const framed = new Uint8Array(body.length + 1);
  framed.set(body, 0);
  framed[body.length] = options.crcOverride ?? crc8(body, 0, body.length);
  return framed;
}

/** Deterministic 32-bit LCG, so the fuzz loops are reproducible run to run. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('encodeAdvertisement + decodeAdvertisement', () => {
  it('restores every advertisement field with the value that was encoded', () => {
    const decoded = decodeAdvertisement(encodeAdvertisement(KNOWN_INPUT));

    expect(decoded.protocolVersion).toBe(1);
    expect(decoded.eventCode).toBe(0xbeef);
    expect(decoded.peerId).toBe('0A1B2C3D');
    expect(decoded.profileVersion).toBe(42);
    expect(decoded.avatarId).toBe('07F3');
    expect(decoded.displayTag).toBe('Ada');
    expect(decoded.status).toBe('busy');
    expect(decoded.capabilities).toEqual({
      acceptsConnections: true,
      supportsNavigation: true,
      isAnchor: true,
    });
  });

  it('writes every field at the byte offset the frame layout documents', () => {
    const frame = encodeAdvertisement(KNOWN_INPUT);

    // The whole frame first, so a moved field or a flipped endianness fails loudly.
    expect(Array.from(frame)).toEqual(KNOWN_FRAME_BYTES);

    // ...then per documented offset, so the failure names the field that moved.
    expect(frame.length).toBe(16);
    expect(frame[0] >> 4).toBe(BLE_PROTOCOL_VERSION); // header bits 7..4: protocolVersion
    expect((frame[0] >> 2) & 0x03).toBe(2); // header bits 3..2: status "busy"
    expect(frame[0] & 0x03).toBe(0); // header bits 1..0: reserved
    expect(frame[1]).toBe(0xbe); // eventCode, high byte first
    expect(frame[2]).toBe(0xef);
    expect(Array.from(frame.slice(3, 7))).toEqual([0x0a, 0x1b, 0x2c, 0x3d]); // peerId
    expect(frame[7]).toBe(42); // profileVersion
    expect(frame[8]).toBe(0x07); // avatarId, high byte first
    expect(frame[9]).toBe(0xf3);
    expect(frame[10]).toBe(0x07); // capability bits
    expect(frame[11]).toBe(3); // displayTag byte length
    expect(Array.from(frame.slice(12, 15))).toEqual([0x41, 0x64, 0x61]); // "Ada"
    expect(frame[15]).toBe(0xd1); // trailing crc8
    expect(frame[15]).toBe(crc8(frame, 0, 15)); // ...taken over exactly [0, 12 + L)
  });

  it('packs each presence status into header bits 3..2 and ignores the reserved bits', () => {
    const expectedCodes: ReadonlyArray<readonly [PresenceStatus, number]> = [
      ['available', 0],
      ['maybe', 1],
      ['busy', 2],
    ];
    for (const [status, code] of expectedCodes) {
      const frame = encodeAdvertisement(makeInput({ status }));
      expect((frame[0] >> 2) & 0x03).toBe(code);
      expect(frame[0] & 0x03).toBe(0);
      expect(decodeAdvertisement(frame).status).toBe(status);

      // A peer that sets the two reserved bits must still decode identically.
      const withReserved = buildRawFrame({ statusCode: code, reservedBits: 0b11 });
      expect(decodeAdvertisement(withReserved).status).toBe(status);
    }
  });

  it('produces exactly the 13-byte minimum frame for an empty displayTag', () => {
    const frame = encodeAdvertisement(makeInput({ displayTag: '' }));

    expect(frame.length).toBe(MIN_FRAME_BYTES);
    expect(frame[11]).toBe(0);
    expect(frame[12]).toBe(crc8(frame, 0, 12));

    const decoded = decodeAdvertisement(frame);
    expect(decoded.displayTag).toBe('');
    expect(decoded.peerId).toBe('0A1B2C3D');
    expect(decoded.eventCode).toBe(0xbeef);
  });

  it('produces exactly the 21-byte maximum frame for an 8-byte displayTag', () => {
    const frame = encodeAdvertisement(makeInput({ displayTag: 'Ada.Love' }));

    expect(frame.length).toBe(MAX_FRAME_BYTES);
    expect(frame.length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(frame[11]).toBe(MAX_DISPLAY_TAG_BYTES);
    expect(frame[20]).toBe(crc8(frame, 0, 20));
    expect(decodeAdvertisement(frame).displayTag).toBe('Ada.Love');
  });

  it('grows the frame by exactly one byte for each additional displayTag byte', () => {
    for (let length = 0; length <= MAX_DISPLAY_TAG_BYTES; length++) {
      const tag = 'abcdefgh'.slice(0, length);
      const frame = encodeAdvertisement(makeInput({ displayTag: tag }));
      expect(frame.length).toBe(MIN_FRAME_BYTES + length);
      expect(frame[11]).toBe(length);
      expect(decodeAdvertisement(frame).displayTag).toBe(tag);
    }
  });

  it('normalises hex identifiers to uppercase and renders them zero-padded', () => {
    const mixedCase = decodeAdvertisement(
      encodeAdvertisement(makeInput({ peerId: '0a1B2c3D', avatarId: '07f3' })),
    );
    expect(mixedCase.peerId).toBe('0A1B2C3D');
    expect(mixedCase.avatarId).toBe('07F3');

    const padded = decodeAdvertisement(
      encodeAdvertisement(makeInput({ peerId: '  0A1B2C3D ', avatarId: ' 07F3  ' })),
    );
    expect(padded.peerId).toBe('0A1B2C3D');
    expect(padded.avatarId).toBe('07F3');

    const zeros = decodeAdvertisement(
      encodeAdvertisement(makeInput({ peerId: '00000000', avatarId: '0000' })),
    );
    expect(zeros.peerId).toBe('00000000');
    expect(zeros.avatarId).toBe('0000');

    const ones = decodeAdvertisement(
      encodeAdvertisement(makeInput({ peerId: 'FFFFFFFF', avatarId: 'FFFF' })),
    );
    expect(ones.peerId).toBe('FFFFFFFF');
    expect(ones.avatarId).toBe('FFFF');
  });

  it('wraps profileVersion at 256 as the layout documents', () => {
    const wrapped: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [1, 1],
      [255, 255],
      [256, 0],
      [257, 1],
      [513, 1],
    ];
    for (const [profileVersion, expected] of wrapped) {
      const decoded = decodeAdvertisement(encodeAdvertisement(makeInput({ profileVersion })));
      expect(decoded.profileVersion).toBe(expected);
    }
  });
});

describe('displayTag truncation at the 8-byte boundary', () => {
  it('keeps an 8-byte ASCII tag whole and truncates a 9-byte one to its first 8 bytes', () => {
    const exact = encodeAdvertisement(makeInput({ displayTag: '12345678' }));
    expect(exact[11]).toBe(8);
    expect(decodeAdvertisement(exact).displayTag).toBe('12345678');

    const overflowing = encodeAdvertisement(makeInput({ displayTag: '123456789' }));
    expect(overflowing.length).toBe(MAX_FRAME_BYTES);
    expect(overflowing[11]).toBe(8);
    expect(decodeAdvertisement(overflowing).displayTag).toBe('12345678');
  });

  it('drops a 3-byte character straddling the boundary instead of emitting half of it', () => {
    // "ABCDEFG" is 7 bytes and "€" is 3 more, so byte 8 falls mid-character.
    const oneByteIn = encodeAdvertisement(makeInput({ displayTag: 'ABCDEFG€' }));
    const decodedOne = decodeAdvertisement(oneByteIn);
    expect(oneByteIn[11]).toBe(7);
    expect(decodedOne.displayTag).toBe('ABCDEFG');
    expect(decodedOne.displayTag).not.toContain('�');
    expect(utf8Encode(decodedOne.displayTag).length).toBe(7);

    // "ABCDEF€" is 9 bytes: the walk-back must skip two continuation bytes and
    // land on 6, not on 7 or 8.
    const twoBytesIn = encodeAdvertisement(makeInput({ displayTag: 'ABCDEF€' }));
    const decodedTwo = decodeAdvertisement(twoBytesIn);
    expect(twoBytesIn[11]).toBe(6);
    expect(decodedTwo.displayTag).toBe('ABCDEF');
    expect(decodedTwo.displayTag).not.toContain('�');
  });

  it('drops a 4-byte emoji straddling the boundary instead of emitting half of it', () => {
    // 7 ASCII bytes + a 4-byte emoji = 11 bytes; the emoji cannot fit in one byte.
    const frame = encodeAdvertisement(makeInput({ displayTag: 'ABCDEFG\u{1F600}' }));
    const decoded = decodeAdvertisement(frame);

    expect(utf8Encode('\u{1F600}').length).toBe(4);
    expect(frame[11]).toBe(7);
    expect(decoded.displayTag).toBe('ABCDEFG');
    expect(decoded.displayTag).not.toContain('�');
    expect(utf8Encode(decoded.displayTag).length).toBeLessThan(11);
  });

  it('keeps two 4-byte emoji that fill the budget exactly and drops the third whole', () => {
    const twoEmoji = '\u{1F600}\u{1F600}';
    expect(utf8Encode(twoEmoji).length).toBe(8);

    const exact = encodeAdvertisement(makeInput({ displayTag: twoEmoji }));
    expect(exact[11]).toBe(8);
    expect(exact.length).toBe(MAX_FRAME_BYTES);
    expect(decodeAdvertisement(exact).displayTag).toBe(twoEmoji);

    const three = encodeAdvertisement(makeInput({ displayTag: twoEmoji + '\u{1F600}' }));
    const decodedThree = decodeAdvertisement(three);
    expect(three[11]).toBe(8);
    expect(decodedThree.displayTag).toBe(twoEmoji);
    expect(decodedThree.displayTag).not.toContain('�');
  });

  it('never exceeds the payload budget however long the tag is', () => {
    const frame = encodeAdvertisement(makeInput({ displayTag: 'x'.repeat(500) }));
    expect(frame.length).toBe(MAX_FRAME_BYTES);
    expect(frame.length).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(decodeAdvertisement(frame).displayTag).toBe('xxxxxxxx');

    // 500 emoji is 2000 UTF-8 bytes; the truncation must still land on a
    // character boundary rather than the raw byte limit.
    const emojiFlood = encodeAdvertisement(makeInput({ displayTag: '\u{1F600}'.repeat(500) }));
    expect(emojiFlood.length).toBe(MAX_FRAME_BYTES);
    expect(decodeAdvertisement(emojiFlood).displayTag).toBe('\u{1F600}\u{1F600}');
  });

  it('round-trips a multi-byte tag that fits inside the budget whole', () => {
    // "héllo" is 6 UTF-8 bytes and needs no truncation at all.
    const frame = encodeAdvertisement(makeInput({ displayTag: 'héllo' }));
    expect(frame[11]).toBe(6);
    expect(frame.length).toBe(MIN_FRAME_BYTES + 6);
    expect(decodeAdvertisement(frame).displayTag).toBe('héllo');
  });
});

describe('CRC integrity', () => {
  it('rejects a frame whose trailing CRC byte was corrupted', () => {
    const inverted = encodeAdvertisement(KNOWN_INPUT);
    inverted[inverted.length - 1] ^= 0xff;
    expectProtocolError(() => decodeAdvertisement(inverted), 'bad_crc', 'inverted crc');

    // Off by exactly one is still a mismatch.
    const offByOne = encodeAdvertisement(KNOWN_INPUT);
    offByOne[offByOne.length - 1] = (offByOne[offByOne.length - 1] + 1) & 0xff;
    expectProtocolError(() => decodeAdvertisement(offByOne), 'bad_crc', 'crc + 1');
  });

  it('rejects a frame with any single payload byte flipped', () => {
    // Byte 0 (header) and byte 11 (tag length) are excluded: flipping those
    // trips the version / length-field guards before the CRC is ever reached.
    const flippable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15];
    for (const index of flippable) {
      const frame = encodeAdvertisement(KNOWN_INPUT);
      frame[index] ^= 0xff;
      expectProtocolError(() => decodeAdvertisement(frame), 'bad_crc', `byte ${index} flipped`);
    }
  });

  it('rejects header bit changes that leave the version and length fields intact', () => {
    // Only the reserved bits move — the CRC still has to catch it.
    const reserved = encodeAdvertisement(KNOWN_INPUT);
    reserved[0] |= 0x03;
    expectProtocolError(() => decodeAdvertisement(reserved), 'bad_crc', 'reserved bits set');

    // Only the status bits move: still version 1, still a legal status.
    const status = encodeAdvertisement(makeInput({ status: 'available' }));
    status[0] |= 0x04;
    expectProtocolError(() => decodeAdvertisement(status), 'bad_crc', 'status bits changed');
  });
});

describe('protocol version handling', () => {
  it('rejects a frame declaring protocol version 0 or 15', () => {
    expectProtocolError(
      () => decodeAdvertisement(buildRawFrame({ version: 0 })),
      'unsupported_version',
      'version 0',
    );
    expectProtocolError(
      () => decodeAdvertisement(buildRawFrame({ version: 15 })),
      'unsupported_version',
      'version 15',
    );
  });

  it('accepts only the single protocol version this build speaks', () => {
    for (let version = 0; version <= 15; version++) {
      const frame = buildRawFrame({ version });
      if (version === BLE_PROTOCOL_VERSION) {
        expect(decodeAdvertisement(frame).protocolVersion).toBe(BLE_PROTOCOL_VERSION);
      } else {
        expectProtocolError(
          () => decodeAdvertisement(frame),
          'unsupported_version',
          `version ${version}`,
        );
      }
    }
  });

  it('checks the version before the CRC so a future layout never reaches the parser', () => {
    const frame = buildRawFrame({ version: 2, crcOverride: 0x00, declaredTagLength: 200 });
    expectProtocolError(() => decodeAdvertisement(frame), 'unsupported_version');
  });

  it('refuses to encode a protocol version that does not fit the 4-bit header nibble', () => {
    expectProtocolError(
      () => encodeAdvertisement(makeInput({ protocolVersion: 16 })),
      'unsupported_version',
      'version 16',
    );
    expectProtocolError(
      () => encodeAdvertisement(makeInput({ protocolVersion: -1 })),
      'unsupported_version',
      'version -1',
    );
  });

  it('encodes the boundary versions 0 and 15 that this build then refuses to decode', () => {
    const zero = encodeAdvertisement(makeInput({ protocolVersion: 0 }));
    expect(zero[0] >> 4).toBe(0);
    expectProtocolError(() => decodeAdvertisement(zero), 'unsupported_version', 'encoded v0');

    const fifteen = encodeAdvertisement(makeInput({ protocolVersion: 15 }));
    expect(fifteen[0] >> 4).toBe(15);
    expectProtocolError(() => decodeAdvertisement(fifteen), 'unsupported_version', 'encoded v15');
  });
});

describe('frame length validation', () => {
  it('rejects every buffer shorter than the 13-byte minimum', () => {
    for (let length = 0; length < MIN_FRAME_BYTES; length++) {
      const error = expectProtocolError(
        () => decodeAdvertisement(new Uint8Array(length)),
        'too_short',
        `${length}-byte buffer`,
      );
      expect(error.message).toContain(`${length} bytes`);
    }

    // A real frame clipped one byte below the minimum fails the same way.
    const minimal = encodeAdvertisement(makeInput({ displayTag: '' }));
    expectProtocolError(() => decodeAdvertisement(minimal.slice(0, 12)), 'too_short', 'clipped');
  });

  it('accepts a buffer of exactly the 13-byte minimum', () => {
    const frame = encodeAdvertisement(makeInput({ displayTag: '' }));
    expect(frame.length).toBe(MIN_FRAME_BYTES);
    expect(decodeAdvertisement(frame).displayTag).toBe('');
  });

  it('rejects a buffer above the 24-byte payload budget', () => {
    const oneOver = new Uint8Array(MAX_PAYLOAD_BYTES + 1);
    oneOver[0] = BLE_PROTOCOL_VERSION << 4;
    const error = expectProtocolError(() => decodeAdvertisement(oneOver), 'too_long', 'one over');
    expect(error.message).toContain(`${MAX_PAYLOAD_BYTES + 1} bytes`);

    expectProtocolError(() => decodeAdvertisement(new Uint8Array(64)), 'too_long', '64 bytes');
  });

  it('accepts a buffer sitting exactly on the 24-byte payload budget', () => {
    const frame = encodeAdvertisement(makeInput({ displayTag: 'Ada.Love' }));
    const padded = new Uint8Array(MAX_PAYLOAD_BYTES);
    padded.set(frame, 0);

    expect(padded.length).toBe(MAX_PAYLOAD_BYTES);
    expect(decodeAdvertisement(padded).displayTag).toBe('Ada.Love');
  });
});

describe('displayTag length field validation', () => {
  it('accepts a declared tag length of exactly the 8-byte maximum', () => {
    const frame = buildRawFrame({ tagBytes: [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48] });
    expect(frame.length).toBe(MAX_FRAME_BYTES);
    expect(decodeAdvertisement(frame).displayTag).toBe('ABCDEFGH');
  });

  it('rejects a declared tag length one above the 8-byte maximum', () => {
    const frame = buildRawFrame({
      tagBytes: [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49],
      declaredTagLength: 9,
    });
    const error = expectProtocolError(() => decodeAdvertisement(frame), 'bad_length_field');
    expect(error.message).toContain('9');
    expect(error.message).toContain(String(MAX_DISPLAY_TAG_BYTES));
  });

  it('rejects every declared tag length from 9 through 255', () => {
    for (let declared = MAX_DISPLAY_TAG_BYTES + 1; declared <= 255; declared++) {
      const frame = buildRawFrame({ tagBytes: [], declaredTagLength: declared });
      expectProtocolError(
        () => decodeAdvertisement(frame),
        'bad_length_field',
        `declared ${declared}`,
      );
    }
  });

  it('rejects a declared tag length that overruns the buffer', () => {
    // A 21-byte frame declaring 8 tag bytes, clipped to 20: the CRC byte is gone.
    const clipped = encodeAdvertisement(makeInput({ displayTag: 'Ada.Love' })).slice(
      0,
      MAX_FRAME_BYTES - 1,
    );
    expect(clipped[11]).toBe(8);
    const error = expectProtocolError(() => decodeAdvertisement(clipped), 'bad_length_field');
    expect(error.message).toContain('overruns');

    // A minimum-size buffer has room for no tag at all, so every non-zero
    // declared length overruns it — including a declaration of just one byte.
    for (let declared = 1; declared <= MAX_DISPLAY_TAG_BYTES; declared++) {
      const frame = buildRawFrame({ tagBytes: [], declaredTagLength: declared });
      expect(frame.length).toBe(MIN_FRAME_BYTES);
      expectProtocolError(
        () => decodeAdvertisement(frame),
        'bad_length_field',
        `13-byte buffer declaring ${declared}`,
      );
    }
  });

  it('checks the tag length field before the CRC', () => {
    const frame = buildRawFrame({ tagBytes: [], declaredTagLength: 200, crcOverride: 0x00 });
    expectProtocolError(() => decodeAdvertisement(frame), 'bad_length_field');
  });
});

describe('encode input validation', () => {
  it('rejects a peerId that is not exactly 8 hex characters', () => {
    const bad: ReadonlyArray<readonly [string, string]> = [
      ['', 'empty'],
      ['0A1B2C3', 'one character short'],
      ['0A1B2C3D5', 'one character long'],
      ['GHIJKLMN', 'non-hex letters'],
      ['0A1B2C3G', 'a single non-hex digit'],
      ['0A1B-2C3D', 'a separator'],
      ['0x0A1B2C3D', 'a 0x prefix'],
    ];
    for (const [peerId, why] of bad) {
      const error = expectProtocolError(
        () => encodeAdvertisement(makeInput({ peerId })),
        'invalid_peer_id',
        `peerId "${peerId}" (${why})`,
      );
      expect(error.message).toContain('8 hex characters');
      expect(error.message).toContain(`"${peerId}"`);
    }
  });

  it('rejects an avatarId that is not exactly 4 hex characters', () => {
    const bad: ReadonlyArray<readonly [string, string]> = [
      ['', 'empty'],
      ['07F', 'one character short'],
      ['07F3A', 'one character long'],
      ['ZZZZ', 'non-hex letters'],
      ['07 3', 'an interior space'],
    ];
    for (const [avatarId, why] of bad) {
      const error = expectProtocolError(
        () => encodeAdvertisement(makeInput({ avatarId })),
        'invalid_avatar_id',
        `avatarId "${avatarId}" (${why})`,
      );
      expect(error.message).toContain('4 hex characters');
    }
  });

  it('reports the peerId problem first when both identifiers are invalid', () => {
    expectProtocolError(
      () => encodeAdvertisement(makeInput({ peerId: 'nope', avatarId: 'nope' })),
      'invalid_peer_id',
    );
  });
});

describe('tryDecodeAdvertisement', () => {
  it('returns the decoded advertisement for a valid frame', () => {
    const decoded = tryDecodeAdvertisement(encodeAdvertisement(KNOWN_INPUT));
    expect(decoded).not.toBeNull();
    expect(decoded?.peerId).toBe('0A1B2C3D');
    expect(decoded?.displayTag).toBe('Ada');
  });

  it('returns null instead of throwing for every buffer below the minimum', () => {
    for (let length = 0; length < MIN_FRAME_BYTES; length++) {
      expect(tryDecodeAdvertisement(new Uint8Array(length))).toBeNull();
    }
  });

  it('returns null instead of throwing for every malformed frame category', () => {
    const corruptedCrc = encodeAdvertisement(KNOWN_INPUT);
    corruptedCrc[corruptedCrc.length - 1] ^= 0x5a;

    const cases: ReadonlyArray<readonly [string, Uint8Array]> = [
      ['too_long', new Uint8Array(MAX_PAYLOAD_BYTES + 1)],
      ['bad_crc', corruptedCrc],
      ['unsupported_version (0)', buildRawFrame({ version: 0 })],
      ['unsupported_version (15)', buildRawFrame({ version: 15 })],
      ['bad_length_field (over max)', buildRawFrame({ declaredTagLength: 9 })],
      ['bad_length_field (overruns)', buildRawFrame({ declaredTagLength: 4 })],
    ];

    for (const [label, bytes] of cases) {
      // Confirm the throwing decoder really does reject it, then that the
      // non-throwing wrapper converts that into null rather than an exception.
      expect(() => decodeAdvertisement(bytes)).toThrow(BleProtocolError);
      expect({ label, result: tryDecodeAdvertisement(bytes) }).toEqual({ label, result: null });
    }
  });

  it('returns null for arbitrary radio noise without ever throwing', () => {
    const next = makeRandom(0x5eed);
    let decodedCount = 0;
    for (let attempt = 0; attempt < 400; attempt++) {
      const length = next() % 30;
      const noise = new Uint8Array(length);
      for (let i = 0; i < length; i++) noise[i] = next() & 0xff;

      let result: BleAdvertisement | null = null;
      expect(() => {
        result = tryDecodeAdvertisement(noise);
      }).not.toThrow();
      if (result !== null) decodedCount++;
    }
    // A CRC-8 gives random noise a ~1/256 chance of passing, so a handful of
    // survivors is expected; what must never happen is a thrown exception.
    expect(decodedCount).toBeLessThan(20);
  });
});

describe('round trip over generated inputs', () => {
  it('decodes back to the normalised input for every field combination', () => {
    const eventCodes = [0, 1, 0x00ff, 0x0100, 0x7fff, 0x8000, 0xfffe, 0xffff];
    let iteration = 0;

    for (const eventCode of eventCodes) {
      for (const status of ALL_STATUSES) {
        for (const capabilities of CAPABILITY_COMBINATIONS) {
          for (let tagLength = 0; tagLength <= MAX_DISPLAY_TAG_BYTES; tagLength++) {
            const displayTag = 'abcdefgh'.slice(0, tagLength);
            const profileVersion = iteration % 256;
            const peerId = ((iteration * 0x01010101 + 0x0a0b0c0d) >>> 0)
              .toString(16)
              .toUpperCase()
              .padStart(8, '0');
            const avatarId = (iteration % 0x10000).toString(16).toUpperCase().padStart(4, '0');

            const expected: BleAdvertisement = {
              protocolVersion: BLE_PROTOCOL_VERSION,
              eventCode,
              peerId,
              profileVersion,
              avatarId,
              displayTag,
              status,
              capabilities,
            };

            // Fed in lowercase to exercise normalisation on every iteration.
            const frame = encodeAdvertisement({
              eventCode,
              peerId: peerId.toLowerCase(),
              profileVersion,
              avatarId: avatarId.toLowerCase(),
              displayTag,
              status,
              capabilities,
            });

            expect(frame.length).toBe(MIN_FRAME_BYTES + tagLength);
            expect(decodeAdvertisement(frame)).toEqual(expected);
            iteration++;
          }
        }
      }
    }

    expect(iteration).toBe(8 * 3 * 8 * 9);
  });

  it('round-trips pseudo-random event codes spread across the full 16-bit range', () => {
    const next = makeRandom(0xc0ffee);
    const seen = new Set<number>();
    for (let attempt = 0; attempt < 400; attempt++) {
      const eventCode = next() & 0xffff;
      seen.add(eventCode);
      expect(decodeAdvertisement(encodeAdvertisement(makeInput({ eventCode }))).eventCode)
        .toBe(eventCode);
    }
    expect(seen.size).toBeGreaterThan(350);
  });
});

describe('eventCode encoding', () => {
  it('writes the event code big-endian across the whole 16-bit range', () => {
    const cases: ReadonlyArray<readonly [number, number, number]> = [
      [0x0000, 0x00, 0x00],
      [0x0001, 0x00, 0x01],
      [0x1234, 0x12, 0x34],
      [0x00ff, 0x00, 0xff],
      [0xff00, 0xff, 0x00],
      [0xffff, 0xff, 0xff],
    ];
    for (const [eventCode, high, low] of cases) {
      const frame = encodeAdvertisement(makeInput({ eventCode }));
      expect([frame[1], frame[2]]).toEqual([high, low]);
      expect(decodeAdvertisement(frame).eventCode).toBe(eventCode);
    }
  });

  it('masks an event code outside the 16-bit range down to its low 16 bits', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [0x10000, 0x0000], // exactly one above the maximum
      [0x10001, 0x0001],
      [0x12345, 0x2345],
      [0x1ffff, 0xffff],
      [0xdeadbeef, 0xbeef],
      [65536 * 7 + 9, 9],
      [-1, 0xffff], // negative wraps rather than corrupting neighbouring fields
    ];
    for (const [eventCode, expected] of cases) {
      const frame = encodeAdvertisement(makeInput({ eventCode }));
      expect(frame.length).toBe(MIN_FRAME_BYTES + 3);
      expect(decodeAdvertisement(frame).eventCode).toBe(expected);
    }
  });
});

describe('matchesEvent', () => {
  const frame = encodeAdvertisement(makeInput({ eventCode: 0xbeef }));

  it('accepts a frame carrying the requested event code and rejects any other', () => {
    expect(matchesEvent(frame, 0xbeef)).toBe(true);
    expect(matchesEvent(frame, 0xbeee)).toBe(false);
    expect(matchesEvent(frame, 0xbef0)).toBe(false);
    expect(matchesEvent(frame, 0x0000)).toBe(false);
    expect(matchesEvent(frame, 0xffff)).toBe(false);
  });

  it('rejects a frame whose protocol version this build does not speak', () => {
    for (let version = 0; version <= 15; version++) {
      const candidate = buildRawFrame({ version, eventCode: 0xbeef });
      expect({ version, matched: matchesEvent(candidate, 0xbeef) }).toEqual({
        version,
        matched: version === BLE_PROTOCOL_VERSION,
      });
    }
  });

  it('rejects every buffer below the 13-byte minimum and accepts one exactly on it', () => {
    for (let length = 0; length < MIN_FRAME_BYTES; length++) {
      expect({ length, matched: matchesEvent(frame.slice(0, length), 0xbeef) }).toEqual({
        length,
        matched: false,
      });
    }
    const minimal = encodeAdvertisement(makeInput({ eventCode: 0xbeef, displayTag: '' }));
    expect(minimal.length).toBe(MIN_FRAME_BYTES);
    expect(matchesEvent(minimal, 0xbeef)).toBe(true);
  });

  it('masks the requested event code to 16 bits before comparing', () => {
    expect(matchesEvent(frame, 0x1beef)).toBe(true);
    expect(matchesEvent(frame, 0xdeadbeef)).toBe(true);
    expect(matchesEvent(frame, 0x1beee)).toBe(false);
  });

  it('is a pre-filter only and does not verify the CRC', () => {
    const corrupted = encodeAdvertisement(makeInput({ eventCode: 0xbeef }));
    corrupted[corrupted.length - 1] ^= 0xff;
    expect(matchesEvent(corrupted, 0xbeef)).toBe(true);
    expect(tryDecodeAdvertisement(corrupted)).toBeNull();
  });

  it('returns a boolean for arbitrary garbage without ever throwing', () => {
    expect(matchesEvent(new Uint8Array(0), 0xbeef)).toBe(false);

    const next = makeRandom(0xbadf00d);
    for (let attempt = 0; attempt < 400; attempt++) {
      const length = next() % 40;
      const noise = new Uint8Array(length);
      for (let i = 0; i < length; i++) noise[i] = next() & 0xff;
      let result: boolean | undefined;
      expect(() => {
        result = matchesEvent(noise, 0xbeef);
      }).not.toThrow();
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('eventCodeFromId', () => {
  it('derives the same code from the same event id every time', () => {
    for (const id of ['', 'a', 'evt-2026-devcon', 'a much longer event identifier']) {
      const first = eventCodeFromId(id);
      expect(eventCodeFromId(id)).toBe(first);
      expect(eventCodeFromId(id)).toBe(first);
    }
  });

  it('is FNV-1a folded to 16 bits, pinned to known values', () => {
    expect(eventCodeFromId('')).toBe(0x1cd9);
    expect(eventCodeFromId('evt-2026-devcon')).toBe(15631);
    expect(eventCodeFromId('evt-alpha')).toBe(48505);
    expect(eventCodeFromId('evt-beta')).toBe(45785);

    for (const id of ['', 'a', 'evt-1', 'evt-2026-devcon', 'a much longer event identifier']) {
      const hash = fnv1a32(id);
      expect(eventCodeFromId(id)).toBe(((hash >>> 16) ^ (hash & 0xffff)) & 0xffff);
    }
  });

  it('always lands inside the 16-bit range', () => {
    for (let i = 0; i < 500; i++) {
      const code = eventCodeFromId(`evt-${i}-${i * 7919}`);
      expect(Number.isInteger(code)).toBe(true);
      expect(code).toBeGreaterThanOrEqual(0);
      expect(code).toBeLessThanOrEqual(0xffff);
    }
  });

  it('gives distinct codes to distinct event ids, including near-identical ones', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `evt-2026-${String(i).padStart(3, '0')}`);
    expect(new Set(ids.map(eventCodeFromId)).size).toBe(ids.length);
    expect(eventCodeFromId('ab')).not.toBe(eventCodeFromId('ba'));
    expect(eventCodeFromId('evt-1')).not.toBe(eventCodeFromId('evt-2'));
  });

  it('produces a code a frame can carry and matchesEvent can filter on', () => {
    const code = eventCodeFromId('evt-2026-devcon');
    const frame = encodeAdvertisement(makeInput({ eventCode: code }));
    expect(decodeAdvertisement(frame).eventCode).toBe(code);
    expect(matchesEvent(frame, code)).toBe(true);
    expect(matchesEvent(frame, eventCodeFromId('evt-2026-other'))).toBe(false);
  });
});

describe('capability bitfield', () => {
  it('assigns each capability its documented bit and sets nothing above them', () => {
    expect(encodeCapabilities(NO_CAPABILITIES)).toBe(0x00);
    expect(encodeCapabilities({ ...NO_CAPABILITIES, acceptsConnections: true })).toBe(0x01);
    expect(encodeCapabilities({ ...NO_CAPABILITIES, supportsNavigation: true })).toBe(0x02);
    expect(encodeCapabilities({ ...NO_CAPABILITIES, isAnchor: true })).toBe(0x04);
    expect(encodeCapabilities(ALL_CAPABILITIES)).toBe(0x07);

    for (const capabilities of CAPABILITY_COMBINATIONS) {
      expect(encodeCapabilities(capabilities) & 0xf8).toBe(0);
    }
  });

  it('round-trips all eight capability combinations', () => {
    for (let bits = 0; bits <= 7; bits++) {
      const capabilities = capabilitiesFromBits(bits);
      expect(encodeCapabilities(capabilities)).toBe(bits);
      expect(decodeCapabilities(bits)).toEqual(capabilities);
      expect(decodeCapabilities(encodeCapabilities(capabilities))).toEqual(capabilities);
    }
  });

  it('ignores unknown high bits when decoding', () => {
    expect(decodeCapabilities(0x08)).toEqual(NO_CAPABILITIES);
    expect(decodeCapabilities(0x80)).toEqual(NO_CAPABILITIES);
    expect(decodeCapabilities(0xf8)).toEqual(NO_CAPABILITIES);
    expect(decodeCapabilities(0xff)).toEqual(ALL_CAPABILITIES);
    expect(decodeCapabilities(0xfd)).toEqual({
      acceptsConnections: true,
      supportsNavigation: false,
      isAnchor: true,
    });

    // Every combination must survive being OR-ed with the five unknown bits.
    for (let bits = 0; bits <= 7; bits++) {
      expect(decodeCapabilities(bits | 0xf8)).toEqual(capabilitiesFromBits(bits));
    }
  });

  it('carries every combination through a real frame and drops unknown high bits', () => {
    for (let bits = 0; bits <= 7; bits++) {
      const capabilities = capabilitiesFromBits(bits);
      const frame = encodeAdvertisement(makeInput({ capabilities }));
      expect(frame[10]).toBe(bits);
      expect(decodeAdvertisement(frame).capabilities).toEqual(capabilities);

      // The same frame as it would arrive from a newer peer that also set bits
      // this build has no name for.
      const fromNewerPeer = buildRawFrame({ capabilityBits: bits | 0xf8 });
      expect(decodeAdvertisement(fromNewerPeer).capabilities).toEqual(capabilities);
    }
  });
});
