/**
 * Base64, because the native bridge speaks strings.
 *
 * Both BLE bridges in this app hand bytes across as base64: the presence module
 * (`EventPulseBle`) for advertisement frames, and the GATT libraries for
 * characteristic values. Sending a JS number array per packet is measurably
 * expensive at conference densities, so the conversion lives here rather than
 * being paid for in the bridge.
 *
 * These functions were previously private to `bluetooth/transports/NativeBleTransport.ts`,
 * which imports `react-native` and therefore cannot be unit-tested in this app's
 * plain-node Jest project. Hoisting them makes them testable and lets the GATT
 * transport share exactly the same implementation rather than growing a second
 * one that could disagree at the edges.
 *
 * No `react-native` import belongs in this file.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;

    out[outIndex++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[outIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 >= 0) out[outIndex++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, outIndex);
}
