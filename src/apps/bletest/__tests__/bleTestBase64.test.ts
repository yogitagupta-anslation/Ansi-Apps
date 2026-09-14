/**
 * The one hand-rolled algorithm in the BLE harness.
 *
 * Both libraries move characteristic values as base64, so if this is wrong the
 * proof-of-concept exchanges garbage and the radio gets the blame. That is the
 * worst possible failure for a diagnostic, so the codec is pinned here where a
 * mistake costs nothing to find.
 */

import { asciiToBase64, base64ToAscii } from '../BleTestBase64';
import { HELLO_REQUEST, HELLO_RESPONSE } from '../BleTestProfile';

describe('asciiToBase64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %p to %p', (input, expected) => {
    // The RFC 4648 test vectors. Padding is where hand-written base64 usually
    // goes wrong, and every length modulo 3 is covered here.
    expect(asciiToBase64(input)).toBe(expected);
  });

  it('refuses a byte it cannot represent', () => {
    // Silently mangling a non-ASCII byte would look like a radio fault.
    expect(() => asciiToBase64('café')).toThrow(/ASCII only/);
  });
});

describe('base64ToAscii', () => {
  it.each([
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('decodes %p to %p', (input, expected) => {
    expect(base64ToAscii(input)).toBe(expected);
  });

  it('ignores whitespace and stray padding', () => {
    // Nothing in the stack promises a clean string; a decoder that trips over
    // a newline would fail intermittently and look like packet loss.
    expect(base64ToAscii('Zm9v\nYmFy')).toBe('foobar');
  });
});

describe('the protocol strings', () => {
  it.each([HELLO_REQUEST, HELLO_RESPONSE])('survives a round trip: %s', (message) => {
    expect(base64ToAscii(asciiToBase64(message))).toBe(message);
  });

  it('fits inside the default ATT payload', () => {
    // 23-byte MTU minus the 3-byte ATT header. Staying under it means the test
    // proves the link rather than the fragmenter, even before MTU negotiation.
    expect(HELLO_REQUEST.length).toBeLessThanOrEqual(20);
    expect(HELLO_RESPONSE.length).toBeLessThanOrEqual(20);
  });

  it('are distinguishable from each other', () => {
    expect(HELLO_REQUEST).not.toBe(HELLO_RESPONSE);
  });
});

describe('round trips', () => {
  it('holds for every ASCII byte', () => {
    const all = Array.from({ length: 128 }, (_unused, code) => String.fromCharCode(code)).join('');
    expect(base64ToAscii(asciiToBase64(all))).toBe(all);
  });

  it('holds at every length boundary', () => {
    for (let length = 0; length <= 32; length++) {
      const input = 'A'.repeat(length);
      expect(base64ToAscii(asciiToBase64(input))).toBe(input);
    }
  });
});
