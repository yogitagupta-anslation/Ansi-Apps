/**
 * Base64 <-> bytes.
 *
 * Both BLE libraries hand us base64 strings at the native bridge, so every
 * frame crosses this boundary. React Native has no atob/btoa and no Buffer, so
 * this is implemented from scratch -- it is also what makes the framing layer
 * testable in plain Node.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < CHARS.length; i++) {
    table[CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += CHARS[(n >>> 18) & 63];
    out += CHARS[(n >>> 12) & 63];
    out += CHARS[(n >>> 6) & 63];
    out += CHARS[n & 63];
  }

  const remaining = len - i;
  if (remaining === 1) {
    const n = (bytes[i] as number) << 16;
    out += CHARS[(n >>> 18) & 63];
    out += CHARS[(n >>> 12) & 63];
    out += '==';
  } else if (remaining === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += CHARS[(n >>> 18) & 63];
    out += CHARS[(n >>> 12) & 63];
    out += CHARS[(n >>> 6) & 63];
    out += '=';
  }

  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  // Tolerate whitespace and missing padding -- some stacks strip both.
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const usable = clean.length - (clean.endsWith('=') ? (clean.endsWith('==') ? 2 : 1) : 0);
  const byteLength = Math.floor((usable * 3) / 4);
  const out = new Uint8Array(byteLength);

  let outIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < usable; i++) {
    const value = LOOKUP[clean.charCodeAt(i)] as number;
    if (value === 255) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (outIndex < byteLength) {
        out[outIndex++] = (buffer >>> bits) & 0xff;
      }
    }
  }

  void padding;
  return outIndex === byteLength ? out : out.subarray(0, outIndex);
}

/** UTF-8 encode without relying on TextEncoder (absent on older RN engines). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        i++;
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
        continue;
      }
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode counterpart to utf8Encode. */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++] as number;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = bytes[i++] as number;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++] as number;
      const b2 = bytes[i++] as number;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
    } else {
      const b1 = bytes[i++] as number;
      const b2 = bytes[i++] as number;
      const b3 = bytes[i++] as number;
      const code =
        (((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    }
  }
  return out;
}
