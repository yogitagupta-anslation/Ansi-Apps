/**
 * Unit tests for `utils/base64.ts` — the only thing standing between a byte array and the
 * native bridge, on both the presence path (advertisement frames) and the GATT path
 * (characteristic values). A bug here corrupts every packet, so this suite pins the
 * encoder against an oracle that is independent of the implementation.
 *
 * Where the expected values come from:
 *
 *  - The seven known-answer vectors are the RFC 4648 §10 test set ("", "f", "fo", "foo",
 *    "foob", "fooba", "foobar"), written out by hand including padding.
 *  - Everything else is checked against `referenceEncode` below, which is written straight
 *    from the RFC 4648 §4 definition (concatenate the octets into a bit string, pad to a
 *    multiple of six, map each sextet through the alphabet, pad the output to a multiple
 *    of four with "="). It shares no code path with `bytesToBase64`: it works on a binary
 *    string rather than on shifts and masks. `referenceEncode` is itself pinned against the
 *    RFC vectors in the first test, so a bug in the oracle cannot silently excuse a bug in
 *    the implementation.
 *  - Test payloads are deterministic: a fixed linear congruential generator seeded from the
 *    payload length. No `Math.random`, so a failure always reproduces.
 *
 * `bluetooth/gatt/transports/BlePlxGattTransport` and the transports barrel import
 * `react-native` and would crash this node-environment project; nothing here imports them.
 */

import { base64ToBytes, bytesToBase64 } from '../utils/base64';

// ---------------------------------------------------------------------------
// Oracles and helpers — all independent of the module under test.
// ---------------------------------------------------------------------------

/** The RFC 4648 §4 "base 64" alphabet, index i being the sextet value i. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

/** ASCII octets of a string, so the RFC's character vectors can be fed in as bytes. */
function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i);
  }
  return out;
}

const list = (input: Uint8Array): number[] => Array.from(input);

function hex(input: Uint8Array): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += input[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * RFC 4648 §4, expressed over a bit string rather than over shifts and masks — a
 * deliberately different formulation from the implementation's.
 */
function referenceEncode(input: Uint8Array): string {
  let bits = '';
  for (let i = 0; i < input.length; i++) {
    bits += input[i].toString(2).padStart(8, '0');
  }
  while (bits.length % 6 !== 0) {
    bits += '0';
  }
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    out += ALPHABET[parseInt(bits.slice(i, i + 6), 2)];
  }
  while (out.length % 4 !== 0) {
    out += '=';
  }
  return out;
}

/** Packs six-bit values into octets, the inverse of the sextet split above. */
function packSextets(sextets: number[]): Uint8Array {
  let bits = '';
  for (const sextet of sextets) {
    bits += sextet.toString(2).padStart(6, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

/**
 * Deterministic pseudo-random payload: a Numerical-Recipes LCG seeded from `seed`, taking
 * the high byte of each state so the low-order bits of the generator do not show through.
 * Same seed, same bytes, every run.
 */
function payload(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

/** Payload lengths 0..64 inclusive, the range the round-trip sweeps cover. */
const LENGTHS: number[] = Array.from({ length: 65 }, (_unused, i) => i);

const countPadding = (encoded: string): number => encoded.split('').filter((c) => c === '=').length;

// ---------------------------------------------------------------------------
// The oracle itself
// ---------------------------------------------------------------------------

describe('the reference encoder these tests are checked against', () => {
  it('reproduces the RFC 4648 test vectors, so it can be trusted as an oracle', () => {
    expect(referenceEncode(ascii(''))).toBe('');
    expect(referenceEncode(ascii('f'))).toBe('Zg==');
    expect(referenceEncode(ascii('fo'))).toBe('Zm8=');
    expect(referenceEncode(ascii('foo'))).toBe('Zm9v');
    expect(referenceEncode(ascii('foob'))).toBe('Zm9vYg==');
    expect(referenceEncode(ascii('fooba'))).toBe('Zm9vYmE=');
    expect(referenceEncode(ascii('foobar'))).toBe('Zm9vYmFy');
  });

  it('generates a payload corpus that actually exercises both halves of the byte range', () => {
    let high = 0;
    let low = 0;
    for (const length of LENGTHS) {
      for (const value of payload(length, length)) {
        if (value >= 0x80) {
          high++;
        } else {
          low++;
        }
      }
    }
    expect(high).toBe(1041);
    expect(low).toBe(1039);
  });
});

// ---------------------------------------------------------------------------
// Known answers — RFC 4648 §10
// ---------------------------------------------------------------------------

describe('bytesToBase64 known answers', () => {
  it('encodes an empty payload as an empty string with no padding', () => {
    expect(bytesToBase64(bytes())).toBe('');
  });

  it('encodes "f" as "Zg==", one octet padded out to a full quantum', () => {
    expect(bytesToBase64(ascii('f'))).toBe('Zg==');
  });

  it('encodes "fo" as "Zm8=", two octets with a single pad character', () => {
    expect(bytesToBase64(ascii('fo'))).toBe('Zm8=');
  });

  it('encodes "foo" as "Zm9v", one whole quantum with no padding', () => {
    expect(bytesToBase64(ascii('foo'))).toBe('Zm9v');
  });

  it('encodes "foob" as "Zm9vYg==", one quantum past the group boundary', () => {
    expect(bytesToBase64(ascii('foob'))).toBe('Zm9vYg==');
  });

  it('encodes "fooba" as "Zm9vYmE="', () => {
    expect(bytesToBase64(ascii('fooba'))).toBe('Zm9vYmE=');
  });

  it('encodes "foobar" as "Zm9vYmFy", two whole quanta', () => {
    expect(bytesToBase64(ascii('foobar'))).toBe('Zm9vYmFy');
  });
});

describe('base64ToBytes known answers', () => {
  it('decodes "" to an empty byte array', () => {
    expect(list(base64ToBytes(''))).toEqual([]);
  });

  it('decodes "Zg==" to the single octet of "f"', () => {
    expect(list(base64ToBytes('Zg=='))).toEqual([0x66]);
  });

  it('decodes "Zm8=" to the two octets of "fo"', () => {
    expect(list(base64ToBytes('Zm8='))).toEqual([0x66, 0x6f]);
  });

  it('decodes "Zm9v" to the three octets of "foo"', () => {
    expect(list(base64ToBytes('Zm9v'))).toEqual([0x66, 0x6f, 0x6f]);
  });

  it('decodes "Zm9vYg==" to the four octets of "foob"', () => {
    expect(list(base64ToBytes('Zm9vYg=='))).toEqual([0x66, 0x6f, 0x6f, 0x62]);
  });

  it('decodes "Zm9vYmE=" to the five octets of "fooba"', () => {
    expect(list(base64ToBytes('Zm9vYmE='))).toEqual([0x66, 0x6f, 0x6f, 0x62, 0x61]);
  });

  it('decodes "Zm9vYmFy" to the six octets of "foobar"', () => {
    expect(list(base64ToBytes('Zm9vYmFy'))).toEqual([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]);
  });
});

// ---------------------------------------------------------------------------
// The alphabet, end to end
// ---------------------------------------------------------------------------

describe('the six-bit alphabet', () => {
  it('maps sextet values 0 through 63 onto A..Z a..z 0..9 + /', () => {
    const everySextet = packSextets(Array.from({ length: 64 }, (_unused, i) => i));
    expect(everySextet.length).toBe(48);
    expect(bytesToBase64(everySextet)).toBe(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
    );
  });

  it('decodes every alphabet character back to its own six-bit value', () => {
    const everySextet = packSextets(Array.from({ length: 64 }, (_unused, i) => i));
    expect(list(base64ToBytes(ALPHABET))).toEqual(list(everySextet));
  });

  it('uses "+" and "/" for sextets 62 and 63, not the URL-safe "-" and "_"', () => {
    // 0xff 0xff 0xff is four sextets of 63; 0xfb 0xff 0xff opens with sextet 62.
    expect(bytesToBase64(bytes(0xff, 0xff, 0xff))).toBe('////');
    expect(bytesToBase64(bytes(0xfb, 0xff, 0xff))).toBe('+///');
  });

  it('encodes an all-zero quantum as "AAAA", the sextet-0 character four times', () => {
    expect(bytesToBase64(bytes(0x00, 0x00, 0x00))).toBe('AAAA');
    expect(list(base64ToBytes('AAAA'))).toEqual([0x00, 0x00, 0x00]);
  });
});

// ---------------------------------------------------------------------------
// Padding and length
// ---------------------------------------------------------------------------

describe('padding', () => {
  it('emits no padding exactly when the payload length is a multiple of three', () => {
    const actual: Record<number, number> = {};
    const expected: Record<number, number> = {};
    for (const length of LENGTHS.filter((n) => n % 3 === 0)) {
      actual[length] = countPadding(bytesToBase64(payload(length, length)));
      expected[length] = 0;
    }
    expect(actual).toEqual(expected);
  });

  it('emits exactly two "=" when the payload leaves one octet over a quantum', () => {
    const actual: Record<number, number> = {};
    const expected: Record<number, number> = {};
    for (const length of LENGTHS.filter((n) => n % 3 === 1)) {
      actual[length] = countPadding(bytesToBase64(payload(length, length)));
      expected[length] = 2;
    }
    expect(actual).toEqual(expected);
  });

  it('emits exactly one "=" when the payload leaves two octets over a quantum', () => {
    const actual: Record<number, number> = {};
    const expected: Record<number, number> = {};
    for (const length of LENGTHS.filter((n) => n % 3 === 2)) {
      actual[length] = countPadding(bytesToBase64(payload(length, length)));
      expected[length] = 1;
    }
    expect(actual).toEqual(expected);
  });

  it('crosses the three-octet quantum boundary at exactly the right length', () => {
    // Two under, one under, the threshold itself, and one over.
    expect(bytesToBase64(payload(1, 1))).toHaveLength(4);
    expect(countPadding(bytesToBase64(payload(1, 1)))).toBe(2);
    expect(bytesToBase64(payload(2, 2))).toHaveLength(4);
    expect(countPadding(bytesToBase64(payload(2, 2)))).toBe(1);
    expect(bytesToBase64(payload(3, 3))).toHaveLength(4);
    expect(countPadding(bytesToBase64(payload(3, 3)))).toBe(0);
    expect(bytesToBase64(payload(4, 4))).toHaveLength(8);
    expect(countPadding(bytesToBase64(payload(4, 4)))).toBe(2);
  });

  it('produces four characters per quantum, rounded up, for every length 0 to 64', () => {
    const actual: Record<number, number> = {};
    const expected: Record<number, number> = {};
    for (const length of LENGTHS) {
      actual[length] = bytesToBase64(payload(length, length)).length;
      expected[length] = Math.ceil(length / 3) * 4;
    }
    expect(actual).toEqual(expected);
  });

  it('places padding only at the end of the output', () => {
    for (const length of LENGTHS) {
      const encoded = bytesToBase64(payload(length, length));
      const firstPad = encoded.indexOf('=');
      if (firstPad !== -1) {
        expect(encoded.slice(firstPad)).toBe('='.repeat(encoded.length - firstPad));
      }
    }
    expect(bytesToBase64(payload(64, 64)).endsWith('=')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agreement with the independent oracle
// ---------------------------------------------------------------------------

describe('agreement with the RFC 4648 definition', () => {
  it('matches a bit-string reference encoder at every length from 0 to 64', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (const length of LENGTHS) {
      const frame = payload(length, length);
      actual[length] = bytesToBase64(frame);
      expected[length] = referenceEncode(frame);
    }
    expect(actual).toEqual(expected);
  });

  it('matches the reference encoder for every single-byte value 0x00 to 0xff', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (let value = 0; value <= 0xff; value++) {
      actual[value] = bytesToBase64(bytes(value));
      expected[value] = referenceEncode(bytes(value));
    }
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

describe('round trip', () => {
  it('returns the original bytes for every payload length from 0 to 64', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (const length of LENGTHS) {
      const frame = payload(length, length);
      actual[length] = hex(base64ToBytes(bytesToBase64(frame)));
      expected[length] = hex(frame);
    }
    expect(actual).toEqual(expected);
  });

  it('returns the original value for all 256 single-byte payloads', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (let value = 0; value <= 0xff; value++) {
      actual[value] = hex(base64ToBytes(bytesToBase64(bytes(value))));
      expected[value] = hex(bytes(value));
    }
    expect(actual).toEqual(expected);
  });

  it('carries all 256 byte values through in a single 256-byte payload', () => {
    const frame = new Uint8Array(256);
    for (let value = 0; value <= 0xff; value++) {
      frame[value] = value;
    }
    expect(list(base64ToBytes(bytesToBase64(frame)))).toEqual(list(frame));
  });

  it('preserves each byte value in every position within a quantum', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (let value = 0; value <= 0xff; value++) {
      const frame = bytes(value, 0xff ^ value, value, 0x00, value);
      actual[value] = hex(base64ToBytes(bytesToBase64(frame)));
      expected[value] = hex(frame);
    }
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// High bytes — where a signedness bug would show and nowhere else
// ---------------------------------------------------------------------------

describe('high bytes', () => {
  it('encodes 0x80..0xff without sign extension', () => {
    // 0x80 0xff 0xfe -> 100000 001111 111111 111110 -> 32 15 63 62 -> "gP/+"
    // 0x81 0xc0      -> 100000 011100 0000(00)      -> 32 28  0    -> "gcA="
    expect(bytesToBase64(bytes(0x80, 0xff, 0xfe, 0x81, 0xc0))).toBe('gP/+gcA=');
  });

  it('encodes the maximum byte 0xff as sextets of all ones', () => {
    expect(bytesToBase64(bytes(0xff, 0xff, 0xff))).toBe('////');
  });

  it('keeps 0x7f and 0x80 distinct across the sign boundary', () => {
    // 0x7f 0x80 -> 011111 111000 0000(00) -> 31 56 0 -> "f4A="
    expect(bytesToBase64(bytes(0x7f, 0x80))).toBe('f4A=');
    expect(list(base64ToBytes('f4A='))).toEqual([0x7f, 0x80]);
    expect(bytesToBase64(bytes(0x7f))).not.toBe(bytesToBase64(bytes(0x80)));
  });

  it('round-trips a payload made entirely of high bytes', () => {
    const frame = new Uint8Array(128);
    for (let i = 0; i < 128; i++) {
      frame[i] = 0x80 + i;
    }
    expect(list(base64ToBytes(bytesToBase64(frame)))).toEqual(list(frame));
  });

  it('decodes into a byte range of 0 to 255, never a negative value', () => {
    const decoded = base64ToBytes(bytesToBase64(payload(64, 64)));
    expect(decoded.length).toBe(64);
    for (const value of decoded) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(255);
    }
  });
});

// ---------------------------------------------------------------------------
// Decoder tolerance — what a bridge or a transport log may hand back
// ---------------------------------------------------------------------------

describe('decoder tolerance', () => {
  const FOOBAR = [0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72];

  it('decodes an empty string to an empty byte array', () => {
    const decoded = base64ToBytes('');
    expect(decoded.length).toBe(0);
    expect(list(decoded)).toEqual([]);
  });

  it('ignores a newline the bridge wrapped the payload at', () => {
    expect(list(base64ToBytes('Zm9v\nYmFy'))).toEqual(FOOBAR);
  });

  it('ignores CRLF line endings anywhere in the payload', () => {
    expect(list(base64ToBytes('Zm\r\n9v\r\nYm\r\nFy\r\n'))).toEqual(FOOBAR);
  });

  it('ignores leading, trailing and interior spaces and tabs', () => {
    expect(list(base64ToBytes('  Zm9v\tYmFy  '))).toEqual(FOOBAR);
  });

  it('ignores "=" wherever it appears, not only at the end', () => {
    expect(list(base64ToBytes('Zg=='))).toEqual([0x66]);
    expect(list(base64ToBytes('Zg='))).toEqual([0x66]);
    expect(list(base64ToBytes('=Z=g='))).toEqual([0x66]);
  });

  it('ignores characters outside the alphabet, including the URL-safe "-" and "_"', () => {
    expect(list(base64ToBytes('Zm9v!YmFy'))).toEqual(FOOBAR);
    expect(list(base64ToBytes('Zm-9v_YmFy'))).toEqual(FOOBAR);
    expect(list(base64ToBytes('Z m9vYmFy'))).toEqual(FOOBAR);
  });

  it('decodes a string of only padding and whitespace to an empty byte array', () => {
    expect(list(base64ToBytes('=='))).toEqual([]);
    expect(list(base64ToBytes(' \r\n\t'))).toEqual([]);
    expect(list(base64ToBytes('!!!!'))).toEqual([]);
  });

  it('decodes an unpadded payload identically to its padded form, at every length 0 to 64', () => {
    const actual: Record<number, string> = {};
    const expected: Record<number, string> = {};
    for (const length of LENGTHS) {
      const encoded = bytesToBase64(payload(length, length));
      actual[length] = hex(base64ToBytes(encoded.replace(/=/g, '')));
      expected[length] = hex(base64ToBytes(encoded));
    }
    expect(actual).toEqual(expected);
  });

  it('drops a trailing character that cannot complete a byte, rather than emitting a bogus one', () => {
    // "Zm9vY" carries 5 sextets: four make "foo", the fifth is only 6 of the 8 bits of a
    // fourth octet, so there is nothing whole to emit.
    expect(list(base64ToBytes('Zm9vY'))).toEqual([0x66, 0x6f, 0x6f]);
    expect(list(base64ToBytes('Z'))).toEqual([]);
    expect(list(base64ToBytes('AAAAA'))).toEqual([0x00, 0x00, 0x00]);
  });

  it('decodes each truncation of a six-octet payload to the octets it can still complete', () => {
    // Prefix lengths of "Zm9vYmFy" against the octets recoverable from n*6 whole bits.
    const prefixes: Record<number, number[]> = {};
    const expected: Record<number, number[]> = {};
    for (let take = 0; take <= 8; take++) {
      prefixes[take] = list(base64ToBytes('Zm9vYmFy'.slice(0, take)));
      expected[take] = FOOBAR.slice(0, Math.floor((take * 6) / 8));
    }
    expect(prefixes).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Realistic frames from both bridges
// ---------------------------------------------------------------------------

describe('realistic bridge frames', () => {
  it('round-trips a 512-byte GATT characteristic frame exactly', () => {
    const frame = payload(512, 512);
    const encoded = bytesToBase64(frame);
    expect(encoded).toBe(referenceEncode(frame));
    expect(encoded).toHaveLength(684);
    expect(countPadding(encoded)).toBe(1);
    const decoded = base64ToBytes(encoded);
    expect(decoded.length).toBe(512);
    expect(hex(decoded)).toBe(hex(frame));
  });

  it('round-trips a 21-byte advertisement frame exactly, with no padding', () => {
    const frame = payload(21, 21);
    const encoded = bytesToBase64(frame);
    expect(encoded).toBe(referenceEncode(frame));
    expect(encoded).toHaveLength(28);
    expect(countPadding(encoded)).toBe(0);
    const decoded = base64ToBytes(encoded);
    expect(decoded.length).toBe(21);
    expect(hex(decoded)).toBe(hex(frame));
  });

  it('round-trips a 512-byte GATT frame that a bridge wrapped at 76 characters', () => {
    const frame = payload(512, 9);
    const wrapped = (bytesToBase64(frame).match(/.{1,76}/g) ?? []).join('\r\n');
    expect(wrapped).toContain('\r\n');
    expect(hex(base64ToBytes(wrapped))).toBe(hex(frame));
  });

  it('round-trips a 20-byte MTU-3 advertisement frame and its 23-byte successor', () => {
    for (const length of [20, 23]) {
      const frame = payload(length, length + 1000);
      expect(hex(base64ToBytes(bytesToBase64(frame)))).toBe(hex(frame));
    }
  });
});
