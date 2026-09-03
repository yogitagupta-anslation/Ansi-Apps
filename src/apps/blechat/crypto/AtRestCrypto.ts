import {xchacha20poly1305} from '@noble/ciphers/chacha';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  utf8Decode,
  utf8Encode,
} from '../utils/bytes';

/**
 * Encryption for what this app writes to disk.
 *
 * WHAT THIS PROTECTS AGAINST, honestly: someone who obtains a copy of the app's stored
 * data without being able to run as the app — a device backup, a forensic dump of the
 * data directory, another process reading files on a rooted phone. Against that, queued
 * message text is ciphertext instead of readable JSON.
 *
 * WHAT IT DOES NOT PROTECT AGAINST, equally honestly: the key is generated on the device
 * and stored in the same AsyncStorage as the data it protects, because this project has
 * no native module wrapping the Android Keystore. Anyone who can read the key can read
 * the messages. Real at-rest protection — a key held in hardware, released only after
 * user authentication — needs that Keystore integration and is NOT what this is.
 *
 * XChaCha20-Poly1305 rather than the ChaCha20-Poly1305 used on the link: nonces here are
 * random rather than counter-driven (there is no session to count within), and a 24-byte
 * random nonce has enough room that repeats are not a practical concern. A 12-byte random
 * nonce would not.
 */

const NONCE_BYTES = 24;
const KEY_BYTES = 32;
const PREFIX = 'enc1:';

export function generateStorageKey(): Uint8Array {
  const key = new Uint8Array(KEY_BYTES);
  const c = (globalThis as {crypto?: {getRandomValues(a: Uint8Array): Uint8Array}})
    .crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No CSPRNG available for storage key');
  }
  c.getRandomValues(key);
  return key;
}

export function storageKeyToHex(key: Uint8Array): string {
  return bytesToHex(key);
}

/**
 * Base64 forms, used at the native boundary: the Keystore wrapper speaks base64, and
 * converting once here keeps that detail out of the storage layer.
 */
export function storageKeyToBase64(key: Uint8Array): string {
  return bytesToBase64(key);
}

export function storageKeyFromBase64(b64: unknown): Uint8Array | null {
  if (typeof b64 !== 'string' || b64.length === 0) {
    return null;
  }
  try {
    const bytes = base64ToBytes(b64);
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Returns null rather than throwing, so a corrupt key is a recoverable condition. */
export function storageKeyFromHex(hex: unknown): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length !== KEY_BYTES * 2) {
    return null;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = hexToBytes(hex);
  return bytes.length === KEY_BYTES ? bytes : null;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  const c = (globalThis as {crypto?: {getRandomValues(a: Uint8Array): Uint8Array}})
    .crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No CSPRNG available for storage nonce');
  }
  c.getRandomValues(nonce);
  return nonce;
}

/**
 * Encrypt a string for storage.
 *
 * The output is tagged and hex-encoded rather than raw bytes because AsyncStorage stores
 * strings; the tag is what lets a later read tell an encrypted record from one written by
 * an older build.
 */
export function encryptString(plaintext: string, key: Uint8Array): string {
  const nonce = randomNonce();
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8Encode(plaintext));
  return PREFIX + bytesToHex(nonce) + ':' + bytesToHex(sealed);
}

export function isEncrypted(raw: string): boolean {
  return raw.startsWith(PREFIX);
}

export class AtRestDecryptError extends Error {}

/**
 * Decrypt a stored string.
 *
 * A record written before this layer existed is returned as-is: refusing to read it would
 * mean silently losing an existing user's queued messages on upgrade. New writes always
 * re-encrypt, so plaintext records disappear as they are rewritten.
 */
export function decryptString(raw: string, key: Uint8Array): string {
  if (!isEncrypted(raw)) {
    return raw;
  }
  const parts = raw.slice(PREFIX.length).split(':');
  if (parts.length !== 2) {
    throw new AtRestDecryptError('malformed encrypted record');
  }
  const nonce = hexToBytes(parts[0]);
  const sealed = hexToBytes(parts[1]);
  if (nonce.length !== NONCE_BYTES) {
    throw new AtRestDecryptError('bad nonce length');
  }
  try {
    return utf8Decode(xchacha20poly1305(key, nonce).decrypt(sealed));
  } catch {
    throw new AtRestDecryptError('stored record failed authentication');
  }
}
