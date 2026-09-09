/**
 * Unit tests for the byte primitives that sit underneath the BLE codec
 * (`bluetooth/BleProtocol.ts`), the rotating peer identity (`bluetooth/BleIdentity.ts`)
 * and the display-tag redaction in `security/PrivacyService.ts`.
 *
 * Every expected value in this file is derived from the algorithm definition, not from
 * running the implementation:
 *
 *  - crc8   : CRC-8/SMBUS — polynomial 0x07, init 0x00, no reflection, no final XOR.
 *             `T(x)` below denotes the eight shift/xor steps the source applies to one
 *             byte; it is linear over GF(2), so a byte's contribution can be derived from
 *             the eight single-bit basis values and XORed together.
 *  - fnv1a32: FNV-1a 32-bit — offset basis 0x811c9dc5, prime 0x01000193, hashing UTF-16
 *             code units (the source uses `charCodeAt`).
 *  - sha256 : the published FIPS 180-4 test vectors.
 */

import {
  bytesToHex,
  crc8,
  fnv1a32,
  utf8Decode,
  utf8Encode,
  utf8TruncateBytes,
} from '../utils/bytes';
import { sha256 } from '../utils/sha256';

// ---------------------------------------------------------------------------
// Helpers — all independent of the modules under test.
// ---------------------------------------------------------------------------

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** Hex, derived from a digit table rather than from `bytesToHex`. */
const HEX_DIGITS = '0123456789ABCDEF';
function hexByIndependentMeans(input: Uint8Array): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += HEX_DIGITS[(input[i] >> 4) & 0x0f] + HEX_DIGITS[input[i] & 0x0f];
  }
  return out;
}

function popcount32(value: number): number {
  let n = value >>> 0;
  let count = 0;
  while (n !== 0) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

function differingBits(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) count += popcount32(a[i] ^ b[i]);
  return count;
}

const ASCII_STRING = (n: number): string => 'x'.repeat(n);

// UTF-8 encodings derived from RFC 3629, matching what the encoder in bytes.ts produces.
const E_ACUTE = 'é'; //           U+00E9  -> C3 A9         (2 bytes)
const CJK = '世'; //               U+4E16  -> E4 B8 96      (3 bytes)
const EMOJI = '😀'; //       U+1F600 -> F0 9F 98 80   (4 bytes)
const REPLACEMENT = String.fromCharCode(0xfffd); // what utf8Decode emits for bad input

// ---------------------------------------------------------------------------
// crc8
// ---------------------------------------------------------------------------

describe('crc8 — known answers derived from polynomial 0x07, init 0x00', () => {
  it('produces the CRC-8/SMBUS check value 0xF4 for the ASCII string "123456789"', () => {
    // The standard check vector for poly 0x07 / init 0x00 / no reflection / no XOR-out.
    expect(crc8(utf8Encode('123456789'))).toBe(0xf4);
  });

  it('returns the polynomial itself for the single byte 0x01', () => {
    // T(0x01): seven left shifts reach 0x80, the eighth shifts out and XORs in 0x07.
    expect(crc8(bytes(0x01))).toBe(0x07);
  });

  it('doubles the polynomial for the single byte 0x02', () => {
    // T is linear and T(0x02) = T(0x01) shifted once more inside the field = 0x0E.
    expect(crc8(bytes(0x02))).toBe(0x0e);
  });

  it('matches the hand-derived basis values for every single-bit input byte', () => {
    // T(2^k) for k = 0..7, each derived by running the eight shift/xor steps by hand.
    const basis: Array<[number, number]> = [
      [0x01, 0x07],
      [0x02, 0x0e],
      [0x04, 0x1c],
      [0x08, 0x38],
      [0x10, 0x70],
      [0x20, 0xe0],
      [0x40, 0xc7],
      [0x80, 0x89],
    ];
    for (const [input, expected] of basis) {
      expect(crc8(bytes(input))).toBe(expected);
    }
  });

  it('is linear over GF(2): the CRC of 0xFF is the XOR of all eight basis values', () => {
    // 0x07^0x0E^0x1C^0x38^0x70^0xE0^0xC7^0x89 = 0xF3.
    expect(crc8(bytes(0xff))).toBe(0xf3);
  });

  it('produces 0x1B for the two-byte message 01 02', () => {
    // crc = T(0x01) = 0x07; then crc = T(0x07 ^ 0x02) = T(0x05) = 0x1C ^ 0x07 = 0x1B.
    expect(crc8(bytes(0x01, 0x02))).toBe(0x1b);
  });

  it('returns 0 for an all-zero message of any length, because init is 0x00', () => {
    for (const length of [1, 2, 8, 20, 21, 64]) {
      expect(crc8(new Uint8Array(length))).toBe(0);
    }
  });

  it('ignores leading zero bytes, since T(0) = 0 and the register starts at 0x00', () => {
    const payload = bytes(0x31, 0x32, 0x33);
    const padded = bytes(0x00, 0x00, 0x00, 0x31, 0x32, 0x33);
    expect(crc8(padded)).toBe(crc8(payload));
  });

  it('returns 0 for an empty array', () => {
    expect(crc8(new Uint8Array(0))).toBe(0);
  });

  it('returns 0 for an empty range in the middle of a non-empty array', () => {
    const frame = bytes(0xde, 0xad, 0xbe, 0xef, 0x01);
    expect(crc8(frame, 0, 0)).toBe(0);
    expect(crc8(frame, 3, 3)).toBe(0);
    expect(crc8(frame, frame.length, frame.length)).toBe(0);
  });

  it('returns 0 when start is past end rather than walking off the array', () => {
    const frame = bytes(0xde, 0xad, 0xbe, 0xef);
    expect(crc8(frame, 3, 1)).toBe(0);
  });

  it('defaults to the whole array when start and end are omitted', () => {
    const frame = bytes(0x31, 0x32, 0x33, 0x34);
    expect(crc8(frame)).toBe(crc8(frame, 0, frame.length));
  });

  it('honours start and end, matching the CRC of the equivalent slice', () => {
    const frame = bytes(0xaa, 0xbb, 0x31, 0x32, 0x33, 0x34, 0x35, 0xcc, 0xdd);
    for (let start = 0; start <= frame.length; start++) {
      for (let end = start; end <= frame.length; end++) {
        expect(crc8(frame, start, end)).toBe(crc8(frame.slice(start, end)));
      }
    }
  });

  it('covers exactly [start, end): the byte at end is excluded and the byte at start included', () => {
    const frame = bytes(0x01, 0x02, 0x03);
    expect(crc8(frame, 0, 1)).toBe(0x07); // just 0x01
    expect(crc8(frame, 0, 2)).toBe(0x1b); // 01 02
    expect(crc8(frame, 1, 2)).toBe(0x0e); // just 0x02
    expect(crc8(frame, 1, 3)).toBe(crc8(bytes(0x02, 0x03)));
  });

  it('ignores bytes outside the window entirely', () => {
    const original = bytes(0x00, 0x00, 0x41, 0x42, 0x43, 0x00, 0x00);
    const mutated = Uint8Array.from(original);
    mutated[0] = 0xff;
    mutated[1] = 0x7f;
    mutated[5] = 0xff;
    mutated[6] = 0x01;
    expect(crc8(mutated, 2, 5)).toBe(crc8(original, 2, 5));
  });

  it('changes for every single-bit flip anywhere in a 21-byte frame', () => {
    // Guaranteed, not merely observed: T(x) = x * 2^8 mod 0x107 is invertible because the
    // polynomial has a non-zero constant term, so a non-zero byte delta can never map to a
    // zero CRC delta.
    const frame = Uint8Array.from({ length: 21 }, (_unused, i) => (i * 37 + 11) & 0xff);
    const baseline = crc8(frame);
    for (let index = 0; index < frame.length; index++) {
      for (let bit = 0; bit < 8; bit++) {
        const mutated = Uint8Array.from(frame);
        mutated[index] ^= 1 << bit;
        expect(crc8(mutated)).not.toBe(baseline);
      }
    }
  });

  it('changes when any single byte is replaced by any other value', () => {
    const frame = bytes(0x12, 0x34, 0x00, 0xff, 0x7f, 0x80);
    const baseline = crc8(frame);
    for (let index = 0; index < frame.length; index++) {
      for (let value = 0; value < 256; value++) {
        if (value === frame[index]) continue;
        const mutated = Uint8Array.from(frame);
        mutated[index] = value;
        expect(crc8(mutated)).not.toBe(baseline);
      }
    }
  });

  it('always returns an integer inside a single unsigned byte', () => {
    for (let seed = 0; seed < 64; seed++) {
      const frame = Uint8Array.from({ length: 21 }, (_unused, i) => (seed * 31 + i * 97) & 0xff);
      const value = crc8(frame);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xff);
    }
  });
});

// ---------------------------------------------------------------------------
// fnv1a32
// ---------------------------------------------------------------------------

describe('fnv1a32 — known answers derived from the FNV-1a 32-bit definition', () => {
  it('returns the unmodified offset basis 0x811C9DC5 for the empty string', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('')).toBe(2166136261);
  });

  it('matches the hand-derived digests for the single characters "a", "b", "f" and "g"', () => {
    // h = (0x811c9dc5 ^ c) * 0x01000193 mod 2^32, worked out longhand for each character.
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('b')).toBe(0xe70c2de5);
    expect(fnv1a32('f')).toBe(0xe30c2799);
    expect(fnv1a32('g')).toBe(0xe20c2606);
  });

  it('matches the hand-derived digest for "foo" after three rounds', () => {
    expect(fnv1a32('foo')).toBe(0xa9f37ed7);
  });

  it('matches the hand-derived digest for "foobar" after six rounds', () => {
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('matches the hand-derived digest for the two-character string "ab"', () => {
    expect(fnv1a32('ab')).toBe(0x4d2505ca);
  });

  it('is deterministic across repeated calls with the same input', () => {
    for (const input of ['', 'a', 'peer-0001', 'Ada Lovelace', ASCII_STRING(200)]) {
      expect(fnv1a32(input)).toBe(fnv1a32(input));
      expect(fnv1a32(input)).toBe(fnv1a32(`${input}`));
    }
  });

  it('always returns an unsigned 32-bit integer, including when the high bit is set', () => {
    const corpus = ['', 'a', 'foobar', 'peer-0001', 'Ada', ASCII_STRING(1000), E_ACUTE + CJK];
    for (const input of corpus) {
      const value = fnv1a32(input);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
    // The empty-string basis has bit 31 set: proof the >>> 0 fold is applied, not dropped.
    expect(fnv1a32('') > 0x7fffffff).toBe(true);
  });

  it('avalanches: "foo" and "goo" differ in 19 of 32 bits despite a one-character change', () => {
    const a = fnv1a32('foo');
    const b = fnv1a32('goo');
    expect(a).toBe(0xa9f37ed7);
    expect(b).toBe(0x3d1b8dac);
    expect(popcount32(a ^ b)).toBe(19);
    expect(popcount32(a ^ b)).toBeGreaterThanOrEqual(12);
  });

  it('spreads a one-character change beyond the low byte', () => {
    // Multiplication by an odd prime keeps the low bit tied to the input, so the guarantee
    // worth asserting is that the *high* half moves too.
    const a = fnv1a32('peer-0001');
    const b = fnv1a32('peer-0002');
    expect(a >>> 16).not.toBe(b >>> 16);
  });

  it('never collides across single-character changes at any position of an equal-length string', () => {
    // Each round h -> (h ^ c) * prime is a bijection on 32-bit words, so two equal-length
    // strings differing in exactly one character can never converge.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    for (const position of [0, 3, 7]) {
      const seen = new Set<number>();
      for (const letter of alphabet) {
        const chars = 'eventpulse'.split('');
        chars[position] = letter;
        seen.add(fnv1a32(chars.join('')));
      }
      expect(seen.size).toBe(alphabet.length);
    }
  });

  it('distinguishes strings that differ only in length', () => {
    expect(fnv1a32('foo')).not.toBe(fnv1a32('foo\u0000'));
    expect(fnv1a32('')).not.toBe(fnv1a32('\u0000'));
  });
});

// ---------------------------------------------------------------------------
// utf8Encode / utf8Decode
// ---------------------------------------------------------------------------

describe('utf8Encode', () => {
  it('encodes the boundary code points of each UTF-8 length class', () => {
    expect(Array.from(utf8Encode('\u0000'))).toEqual([0x00]);
    expect(Array.from(utf8Encode('\u007f'))).toEqual([0x7f]);
    expect(Array.from(utf8Encode('\u0080'))).toEqual([0xc2, 0x80]);
    expect(Array.from(utf8Encode('\u07ff'))).toEqual([0xdf, 0xbf]);
    expect(Array.from(utf8Encode('\u0800'))).toEqual([0xe0, 0xa0, 0x80]);
    expect(Array.from(utf8Encode('\uffff'))).toEqual([0xef, 0xbf, 0xbf]);
    expect(Array.from(utf8Encode('\ud800\udc00'))).toEqual([0xf0, 0x90, 0x80, 0x80]);
    expect(Array.from(utf8Encode('\udbff\udfff'))).toEqual([0xf4, 0x8f, 0xbf, 0xbf]);
  });

  it('encodes the multi-byte characters used by the truncation tests exactly', () => {
    expect(Array.from(utf8Encode(E_ACUTE))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Encode(CJK))).toEqual([0xe4, 0xb8, 0x96]);
    expect(Array.from(utf8Encode(EMOJI))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('returns an empty array for the empty string', () => {
    expect(utf8Encode('')).toEqual(new Uint8Array(0));
  });
});

describe('utf8Decode', () => {
  it('round-trips ASCII, 2-byte, 3-byte and 4-byte sequences', () => {
    const corpus = [
      '',
      'Ada',
      E_ACUTE,
      CJK,
      EMOJI,
      `a${E_ACUTE}b${CJK}c${EMOJI}d`,
      'José Álvarez',
      ASCII_STRING(300),
    ];
    for (const input of corpus) {
      expect(utf8Decode(utf8Encode(input))).toBe(input);
    }
  });

  it('round-trips every single code point below U+0800 and a sample above it', () => {
    for (let code = 0; code < 0x800; code++) {
      const char = String.fromCharCode(code);
      expect(utf8Decode(utf8Encode(char))).toBe(char);
    }
    for (const code of [0x0800, 0x4e16, 0xd7ff, 0xe000, 0xffff]) {
      const char = String.fromCharCode(code);
      expect(utf8Decode(utf8Encode(char))).toBe(char);
    }
  });

  it('replaces a truncated multi-byte sequence with U+FFFD instead of throwing', () => {
    expect(utf8Decode(bytes(0x61, 0xe4, 0xb8))).toBe(`a${REPLACEMENT}`);
  });

  it('replaces a stray continuation byte with U+FFFD and resynchronises', () => {
    expect(utf8Decode(bytes(0x61, 0xa9, 0x62))).toBe(`a${REPLACEMENT}b`);
  });

  it('decodes an empty array to the empty string', () => {
    expect(utf8Decode(new Uint8Array(0))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// utf8TruncateBytes
// ---------------------------------------------------------------------------

describe('utf8TruncateBytes — limits and empty inputs', () => {
  it('returns an empty array for a limit of 0 on a non-empty string', () => {
    expect(utf8TruncateBytes('Ada', 0)).toEqual(new Uint8Array(0));
    expect(utf8TruncateBytes(EMOJI, 0)).toEqual(new Uint8Array(0));
  });

  it('returns an empty array for the empty string at every limit', () => {
    for (const limit of [0, 1, 8, 1000]) {
      expect(utf8TruncateBytes('', limit)).toEqual(new Uint8Array(0));
    }
  });

  it('returns the full encoding when the limit exactly equals the encoded length', () => {
    // The exact threshold: `full.length <= maxBytes` must take the early-return branch.
    expect(Array.from(utf8TruncateBytes('Ada', 3))).toEqual([0x41, 0x64, 0x61]);
    expect(Array.from(utf8TruncateBytes(E_ACUTE, 2))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8TruncateBytes(CJK, 3))).toEqual([0xe4, 0xb8, 0x96]);
    expect(Array.from(utf8TruncateBytes(EMOJI, 4))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('returns the full encoding when the limit is one byte above the encoded length', () => {
    expect(Array.from(utf8TruncateBytes('Ada', 4))).toEqual([0x41, 0x64, 0x61]);
    expect(Array.from(utf8TruncateBytes(EMOJI, 5))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('returns the full encoding when the limit is far larger than the string', () => {
    const input = `Ada ${EMOJI} ${CJK}`;
    expect(utf8TruncateBytes(input, 1000)).toEqual(utf8Encode(input));
  });

  it('cuts a pure-ASCII string at exactly the byte limit', () => {
    expect(Array.from(utf8TruncateBytes('abcdef', 1))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes('abcdef', 5))).toEqual([0x61, 0x62, 0x63, 0x64, 0x65]);
    expect(utf8Decode(utf8TruncateBytes('abcdef', 5))).toBe('abcde');
  });

  it('drops exactly one character when the limit is one below an ASCII string length', () => {
    expect(utf8Decode(utf8TruncateBytes('Alexandra', 8))).toBe('Alexandr');
  });
});

describe('utf8TruncateBytes — never splits a multi-byte character', () => {
  it('drops a whole 2-byte character rather than emitting its lead byte', () => {
    const input = `a${E_ACUTE}`; // 61 C3 A9
    expect(Array.from(utf8TruncateBytes(input, 1))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes(input, 2))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes(input, 3))).toEqual([0x61, 0xc3, 0xa9]);
  });

  it('drops a whole 3-byte character rather than emitting one or two of its bytes', () => {
    const input = `a${CJK}`; // 61 E4 B8 96
    expect(Array.from(utf8TruncateBytes(input, 1))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes(input, 2))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes(input, 3))).toEqual([0x61]);
    expect(Array.from(utf8TruncateBytes(input, 4))).toEqual([0x61, 0xe4, 0xb8, 0x96]);
  });

  it('drops a whole 4-byte character rather than emitting a partial surrogate pair', () => {
    const input = `a${EMOJI}`; // 61 F0 9F 98 80
    for (const limit of [1, 2, 3, 4]) {
      expect(Array.from(utf8TruncateBytes(input, limit))).toEqual([0x61]);
    }
    expect(Array.from(utf8TruncateBytes(input, 5))).toEqual([0x61, 0xf0, 0x9f, 0x98, 0x80]);
  });

  it('never emits a trailing continuation byte for any limit over a mixed string', () => {
    const input = `A${E_ACUTE}${CJK}${EMOJI}z${E_ACUTE}`;
    const full = utf8Encode(input);
    for (let limit = 0; limit <= full.length + 3; limit++) {
      const out = utf8TruncateBytes(input, limit);
      if (out.length > 0) {
        const last = out[out.length - 1];
        const isContinuation = (last & 0xc0) === 0x80;
        const startsMultiByte = out.length >= 2 && (out[out.length - 2] & 0x80) !== 0;
        // A continuation byte is only acceptable as the final byte of a complete sequence.
        expect(isContinuation && !startsMultiByte).toBe(false);
      }
    }
  });

  it('emits only complete sequences: every result re-encodes to itself', () => {
    const input = `A${E_ACUTE}${CJK}${EMOJI}z${E_ACUTE}${CJK}`;
    const full = utf8Encode(input);
    for (let limit = 0; limit <= full.length + 2; limit++) {
      const out = utf8TruncateBytes(input, limit);
      expect(utf8Encode(utf8Decode(out))).toEqual(out);
    }
  });

  it('always decodes to a prefix of the original string with no replacement characters', () => {
    const inputs = [
      `A${E_ACUTE}${CJK}${EMOJI}z`,
      `${EMOJI}${EMOJI}${EMOJI}`,
      `${CJK}${CJK}${CJK}${CJK}`,
      'José Álvarez',
      'plain ascii only',
    ];
    for (const input of inputs) {
      const full = utf8Encode(input);
      for (let limit = 0; limit <= full.length + 2; limit++) {
        const decoded = utf8Decode(utf8TruncateBytes(input, limit));
        expect(decoded.includes(REPLACEMENT)).toBe(false);
        expect(input.startsWith(decoded)).toBe(true);
      }
    }
  });

  it('never returns more bytes than the limit for any non-negative limit', () => {
    const input = `A${E_ACUTE}${CJK}${EMOJI}z${E_ACUTE}`;
    const full = utf8Encode(input);
    for (let limit = 0; limit <= full.length + 4; limit++) {
      expect(utf8TruncateBytes(input, limit).length).toBeLessThanOrEqual(limit);
    }
  });

  it('is monotonic: raising the limit never removes bytes already emitted', () => {
    const input = `A${E_ACUTE}${CJK}${EMOJI}z`;
    const full = utf8Encode(input);
    for (let limit = 1; limit <= full.length + 2; limit++) {
      const smaller = utf8TruncateBytes(input, limit - 1);
      const larger = utf8TruncateBytes(input, limit);
      expect(larger.length).toBeGreaterThanOrEqual(smaller.length);
      expect(Array.from(larger.slice(0, smaller.length))).toEqual(Array.from(smaller));
    }
  });

  it('holds an 8-byte display tag to whole characters, as PrivacyService relies on', () => {
    // MAX_DISPLAY_TAG_BYTES is 8 in bluetooth/BleProtocol.ts.
    expect(utf8Decode(utf8TruncateBytes('Alexandra', 8))).toBe('Alexandr');
    expect(utf8Decode(utf8TruncateBytes('Joséphine', 8))).toBe('Joséphi');
    expect(utf8Decode(utf8TruncateBytes(`${CJK}${CJK}${CJK}`, 8))).toBe(`${CJK}${CJK}`);
    expect(utf8Decode(utf8TruncateBytes(`${EMOJI}${EMOJI}${EMOJI}`, 8))).toBe(
      `${EMOJI}${EMOJI}`,
    );
    expect(utf8TruncateBytes(`${EMOJI}${EMOJI}${EMOJI}`, 8).length).toBe(8);
  });

  /**
   * DEFECT: utf8TruncateBytes ignores negative limits and hands the negative value straight
   * to `Uint8Array.prototype.slice`, where a negative `end` counts back from the end of the
   * array. `utf8TruncateBytes('abc', -1)` therefore returns 2 bytes for a limit of -1,
   * breaking the documented "at most `maxBytes`" contract, and `-4` on a 3-byte string
   * returns the whole encoding.
   * src/apps/eventpulse/utils/bytes.ts:109-112 — `end` is never clamped to 0 before the
   * `slice(0, end)` on line 112.
   * Not reachable from today's callers (MAX_DISPLAY_TAG_BYTES is a positive constant), so
   * this is a robustness gap rather than a live failure.
   */
  it.failing('returns nothing for a negative limit instead of slicing from the end', () => {
    expect(utf8TruncateBytes('abc', -1)).toEqual(new Uint8Array(0));
    expect(utf8TruncateBytes('abc', -4)).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------
// bytesToHex
// ---------------------------------------------------------------------------

describe('bytesToHex', () => {
  it('returns the empty string for an empty array', () => {
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });

  it('zero-pads a single byte below 0x10 to two characters', () => {
    expect(bytesToHex(bytes(0x00))).toBe('00');
    expect(bytesToHex(bytes(0x01))).toBe('01');
    expect(bytesToHex(bytes(0x0f))).toBe('0F');
  });

  it('renders the maximum byte value as FF', () => {
    expect(bytesToHex(bytes(0xff))).toBe('FF');
  });

  it('uses uppercase for every hex letter', () => {
    expect(bytesToHex(bytes(0xab, 0xcd, 0xef))).toBe('ABCDEF');
    expect(bytesToHex(bytes(0xde, 0xad, 0xbe, 0xef))).toBe('DEADBEEF');
  });

  it('keeps byte order and zero padding across a mixed array', () => {
    expect(bytesToHex(bytes(0x00, 0x0f, 0xa0, 0xff, 0x10))).toBe('000FA0FF10');
  });

  it('agrees with an independently built hex table for all 256 byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_unused, i) => i);
    expect(bytesToHex(all)).toBe(hexByIndependentMeans(all));
    for (let value = 0; value < 256; value++) {
      expect(bytesToHex(bytes(value))).toBe(hexByIndependentMeans(bytes(value)));
    }
  });

  it('always emits exactly two characters per byte', () => {
    for (let length = 0; length <= 32; length++) {
      const input = Uint8Array.from({ length }, (_unused, i) => (i * 17) & 0xff);
      expect(bytesToHex(input)).toHaveLength(length * 2);
    }
  });

  it('produces the 8-character peer id and 4-character avatar id widths the codec expects', () => {
    const mac = bytes(0xa1, 0xb2, 0xc3, 0xd4, 0x00, 0xff);
    expect(bytesToHex(mac.slice(0, 4))).toBe('A1B2C3D4');
    expect(bytesToHex(mac.slice(0, 2))).toBe('A1B2');
  });
});

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

describe('sha256 — FIPS 180-4 known answers', () => {
  it('digests the empty message to E3B0C442...B855', () => {
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe(
      'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
    );
  });

  it('digests "abc" to BA7816BF...15AD', () => {
    expect(bytesToHex(sha256(utf8Encode('abc')))).toBe(
      'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD',
    );
  });

  it('digests the single character "a" to CA978112...48BB', () => {
    expect(bytesToHex(sha256(utf8Encode('a')))).toBe(
      'CA978112CA1BBDCAFAC231B39A23DC4DA786EFF8147C4E72B9807785AFEE48BB',
    );
  });

  it('digests the 56-byte two-block vector to 248D6A61...06C1', () => {
    // 56 bytes is exactly the length at which padding no longer fits in the first block.
    const message = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(message.length).toBe(56);
    expect(bytesToHex(sha256(utf8Encode(message)))).toBe(
      '248D6A61D20638B8E5C026930C3E6039A33CE45964FF2167F6ECEDD419DB06C1',
    );
  });

  it('returns exactly 32 bytes for every input length across the padding boundaries', () => {
    for (let length = 0; length <= 130; length++) {
      const message = Uint8Array.from({ length }, (_unused, i) => (i * 13 + 7) & 0xff);
      expect(sha256(message)).toHaveLength(32);
    }
  });

  it('returns 32 bytes at the exact block boundaries 55, 56, 63, 64, 119 and 120', () => {
    for (const length of [55, 56, 63, 64, 119, 120]) {
      const digest = sha256(new Uint8Array(length));
      expect(digest).toHaveLength(32);
      expect(bytesToHex(digest)).toHaveLength(64);
    }
  });

  it('produces distinct digests for the messages either side of each block boundary', () => {
    const digests = [54, 55, 56, 57, 63, 64, 65, 119, 120].map((length) =>
      bytesToHex(sha256(new Uint8Array(length))),
    );
    expect(new Set(digests).size).toBe(digests.length);
  });

  it('is deterministic and does not carry state between calls', () => {
    const message = utf8Encode('abc');
    const first = sha256(message);
    sha256(utf8Encode('a different message entirely, long enough to span two blocks !!!!'));
    const second = sha256(message);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('leaves the caller’s input array untouched', () => {
    const message = utf8Encode('abc');
    const copy = Uint8Array.from(message);
    sha256(message);
    expect(Array.from(message)).toEqual(Array.from(copy));
  });

  it('avalanches: a single flipped input bit changes at least a quarter of the output bits', () => {
    const base = Uint8Array.from({ length: 40 }, (_unused, i) => (i * 11) & 0xff);
    const baseDigest = sha256(base);
    for (const index of [0, 19, 39]) {
      for (const bit of [0, 7]) {
        const mutated = Uint8Array.from(base);
        mutated[index] ^= 1 << bit;
        const digest = sha256(mutated);
        expect(Array.from(digest)).not.toEqual(Array.from(baseDigest));
        expect(differingBits(digest, baseDigest)).toBeGreaterThanOrEqual(64);
      }
    }
  });

  it('distinguishes messages that differ only by trailing zero bytes', () => {
    const a = bytesToHex(sha256(bytes(0x61)));
    const b = bytesToHex(sha256(bytes(0x61, 0x00)));
    expect(a).not.toBe(b);
  });
});
