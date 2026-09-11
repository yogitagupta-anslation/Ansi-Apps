/**
 * ASCII <-> base64, self-contained.
 *
 * Both BLE libraries hand characteristic values across the bridge as base64
 * strings, so something has to do this. The package ships `encodeBase64` /
 * `decodeBase64`, but they are one-line wrappers over `btoa` / `atob`, which
 * Hermes does not guarantee. A missing global would fail inside the one test
 * built to remove doubt about what works, so this does the conversion itself.
 *
 * ASCII only, which is all the protocol needs — `HELLO_REQUEST` and
 * `HELLO_RESPONSE`. A byte above 0x7f is not something this test should be
 * silently mangling, so it is refused rather than rendered wrong.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function asciiToBase64(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const b0 = codeAt(input, i);
    const b1 = i + 1 < input.length ? codeAt(input, i + 1) : null;
    const b2 = i + 2 < input.length ? codeAt(input, i + 2) : null;

    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === null ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === null ? '=' : ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64ToAscii(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = ALPHABET.indexOf(clean[i]);
    const c1 = ALPHABET.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]) : -1;
    if (c0 < 0 || c1 < 0) break;

    out += String.fromCharCode((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) out += String.fromCharCode(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (c3 >= 0) out += String.fromCharCode(((c2 & 0x03) << 6) | c3);
  }
  return out;
}

function codeAt(input: string, index: number): number {
  const code = input.charCodeAt(index);
  if (code > 0x7f) {
    throw new Error(`BLE test payloads are ASCII only; got code ${code} at ${index}`);
  }
  return code;
}
