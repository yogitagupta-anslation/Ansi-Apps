/**
 * Byte plumbing for the radio.
 *
 * react-native-ble-plx and the native peripheral module both speak base64 at
 * their boundary, and React Native's engine offers neither Buffer nor a
 * guaranteed atob/btoa, so the conversions are owned here.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i += 1) B64_INDEX[B64[i]] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_INDEX[clean[i]] ?? 0;
    const c1 = B64_INDEX[clean[i + 1]] ?? 0;
    const c2 = B64_INDEX[clean[i + 2]] ?? 0;
    const c3 = B64_INDEX[clean[i + 3]] ?? 0;
    if (p < out.length) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < out.length) out[p++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (p < out.length) out[p++] = ((c2 & 0x03) << 6) | c3;
  }
  return out;
}

/** UTF-8, without assuming TextEncoder exists on this engine. */
export function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i += 1) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
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

/**
 * UTF-8 decode. Advertisement names are truncated by byte on the wire, so the
 * last character can arrive cut in half: a malformed tail is dropped rather
 * than turned into a replacement glyph.
 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code: number;
    let size: number;
    if (b < 0x80) {
      code = b;
      size = 1;
    } else if ((b & 0xe0) === 0xc0) {
      code = b & 0x1f;
      size = 2;
    } else if ((b & 0xf0) === 0xe0) {
      code = b & 0x0f;
      size = 3;
    } else if ((b & 0xf8) === 0xf0) {
      code = b & 0x07;
      size = 4;
    } else {
      i += 1;
      continue;
    }
    if (i + size > bytes.length) break; // truncated tail
    for (let k = 1; k < size; k += 1) code = (code << 6) | (bytes[i + k] & 0x3f);
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

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
