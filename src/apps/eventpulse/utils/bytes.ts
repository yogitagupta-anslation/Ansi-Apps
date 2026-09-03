/**
 * Minimal byte helpers.
 *
 * Deliberately dependency-free: Hermes does not reliably expose `TextEncoder`
 * across every React Native version we support, and the BLE layer must behave
 * identically in Node (tests) and on device.
 */

/** UTF-8 encode a string. */
export function utf8Encode(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);

    // Combine surrogate pairs into a single code point.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i++;
      }
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode. Invalid sequences are replaced with U+FFFD rather than throwing. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let code: number;
    let size: number;

    if (b0 < 0x80) {
      code = b0;
      size = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      code = b0 & 0x1f;
      size = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      code = b0 & 0x0f;
      size = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      code = b0 & 0x07;
      size = 4;
    } else {
      out += '�';
      i++;
      continue;
    }

    if (i + size > bytes.length) {
      out += '�';
      break;
    }

    let valid = true;
    for (let k = 1; k < size; k++) {
      const bk = bytes[i + k];
      if ((bk & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (bk & 0x3f);
    }

    if (!valid) {
      out += '�';
      i++;
      continue;
    }

    if (code > 0xffff) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
    i += size;
  }
  return out;
}

/**
 * Truncate a UTF-8 encoding to at most `maxBytes` without splitting a
 * multi-byte code point in half.
 */
export function utf8TruncateBytes(input: string, maxBytes: number): Uint8Array {
  const full = utf8Encode(input);
  if (full.length <= maxBytes) return full;

  let end = maxBytes;
  // Walk back off any continuation byte so we never emit a partial code point.
  while (end > 0 && (full[end] & 0xc0) === 0x80) end--;
  return full.slice(0, end);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0').toUpperCase();
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${hex})`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** CRC-8 (polynomial 0x07, init 0x00) — cheap integrity check for a 21-byte frame. */
export function crc8(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

/**
 * FNV-1a 32-bit. Used for deterministic, non-cryptographic derivations
 * (avatar hue, stable jitter seeds, cache keys). Never for identity secrecy.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
