/**
 * bytes.ts
 * -----------------------------------------------------------------------------
 * Tiny, dependency-free byte helpers.
 *
 * react-native-ble-plx hands manufacturerData / serviceData to JavaScript as
 * BASE64 STRINGS, not byte arrays. React Native has no Buffer and older RN
 * versions have no global atob(), so rather than pull in `buffer` or
 * `react-native-base64` we decode it here in ~25 lines.
 * -----------------------------------------------------------------------------
 */

/* eslint-disable no-bitwise -- decoding base64 and packing bytes is inherently
   bitwise; there is no non-bitwise way to express it. */

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup table, built once. */
const B64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charAt(i)] = i;
  }
  return table;
})();

/**
 * Decode a base64 string into raw bytes.
 * Returns an empty array for null/undefined/malformed input rather than
 * throwing - a corrupt advertisement should never crash the scanner.
 */
export function base64ToBytes(input: string | null | undefined): number[] {
  if (!input) {
    return [];
  }

  // Strip padding and anything that is not part of the alphabet.
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];

  let buffer = 0;
  let bitsCollected = 0;

  for (let i = 0; i < clean.length; i++) {
    const value = B64_LOOKUP[clean.charAt(i)];
    if (value === undefined) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;

    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      out.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return out;
}

/**
 * Interpret bytes as ASCII text. Any byte outside the printable ASCII range is
 * replaced with '.' so a garbage payload shows up as visibly wrong in the debug
 * UI instead of rendering as invisible control characters.
 */
export function bytesToAscii(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
  }
  return out;
}

/** Hex dump, for the debug panel: [0x01, 0xff] -> "01 FF". */
export function bytesToHex(bytes: number[]): string {
  return bytes
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

/** Encode an ASCII string to bytes. Non-ASCII characters are dropped. */
export function asciiToBytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) {
      out.push(code);
    }
  }
  return out;
}

/**
 * Normalise a UUID for comparison.
 *
 * This matters: react-native-ble-plx returns service UUIDs UPPERCASE on Android
 * and lowercase on iOS. Comparing raw strings is a classic reason a scanner
 * "sees the device but never matches it".
 */
export function normalizeUuid(uuid: string | null | undefined): string {
  return (uuid || '').toLowerCase().trim();
}

/** Encode bytes to base64 — ble-plx characteristic writes take base64 strings. */
export function bytesToBase64(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET.charAt((triple >> 18) & 0x3f);
    out += B64_ALPHABET.charAt((triple >> 12) & 0x3f);
    out += i + 1 < bytes.length ? B64_ALPHABET.charAt((triple >> 6) & 0x3f) : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET.charAt(triple & 0x3f) : '=';
  }
  return out;
}
