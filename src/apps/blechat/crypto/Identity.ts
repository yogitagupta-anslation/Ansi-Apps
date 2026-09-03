import * as ed from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha512';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, hexToBytes} from '../utils/bytes';

/**
 * Cryptographic peer identity.
 *
 * Before this existed, `peerId` was a random string that a peer simply *claimed* in its
 * HELLO. Anyone could advertise our service UUID, assert somebody else's peerId, and have
 * their messages filed into that conversation. Trust lists, group membership and
 * "delivered" all inherited that weakness, because they are all keyed on peerId.
 *
 * Now the identity IS a keypair:
 *
 *   peerId = sha256(publicKey), first 16 bytes, hex
 *
 * so a peerId is a commitment to a public key. Claiming somebody else's peerId requires
 * finding a second key that hashes to it. Proving the claim requires their private key,
 * which the handshake demands via a signature over a fresh challenge.
 */

// @noble/ed25519 v2 needs a sha512 implementation supplied.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface KeyPair {
  /** 32 bytes. Never leaves the device. */
  privateKey: Uint8Array;
  /** 32 bytes. Shared in the handshake. */
  publicKey: Uint8Array;
}

/** Bytes of entropy the challenge nonce carries. */
export const NONCE_BYTES = 16;

/** Length of a peerId in hex characters (16 bytes). */
export const PEER_ID_HEX_LENGTH = 32;

export function generateKeyPair(): KeyPair {
  const privateKey = ed.utils.randomPrivateKey();
  return {privateKey, publicKey: ed.getPublicKey(privateKey)};
}

/**
 * Derive the peerId from a public key.
 *
 * Truncated to 16 bytes: that is 128 bits, which keeps collision resistance well beyond
 * what a BLE network could ever brute-force, while staying short enough that the first
 * 8 bytes still fit in an advertisement.
 */
export function peerIdFromPublicKey(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey).subarray(0, 16));
}

/** Does this public key actually produce that peerId? */
export function publicKeyMatchesPeerId(
  publicKey: Uint8Array,
  peerId: string,
): boolean {
  return peerIdFromPublicKey(publicKey) === peerId.toLowerCase();
}

export function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  const c = (globalThis as {crypto?: {getRandomValues(a: Uint8Array): Uint8Array}})
    .crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No CSPRNG available for challenge nonce');
  }
  c.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/**
 * The exact bytes both sides sign.
 *
 * Binding all of these matters:
 *  - the challenge makes each signature single-use, so a captured one cannot be replayed
 *  - both peerIds bind the signature to THIS pair, so it cannot be relayed to a third
 *    party as proof of identity to them
 *  - the label separates a HELLO signature from a HELLO_ACK signature, so one cannot be
 *    reflected back as the other
 *  - both EPHEMERAL keys bind the signature to this exact key agreement. This is the
 *    load-bearing part of the encryption layer: an active attacker can always substitute
 *    its own ephemeral key in transit, and the only thing that makes that detectable is
 *    that it cannot forge an identity signature covering the substituted key. Drop the
 *    ephemeral keys from this transcript and the session is encrypted but wide open to
 *    a machine in the middle.
 */
export function challengeBytes(
  label: 'hello' | 'hello-ack',
  challenge: string,
  signerPeerId: string,
  audiencePeerId: string,
  initiatorEphemeralKey: string,
  responderEphemeralKey: string,
): Uint8Array {
  const message = [
    'blechat-auth-v2',
    label,
    challenge,
    signerPeerId,
    audiencePeerId,
    initiatorEphemeralKey,
    responderEphemeralKey,
  ].join('|');
  // ASCII by construction, so a simple char-code map is exact.
  const out = new Uint8Array(message.length);
  for (let i = 0; i < message.length; i++) {
    out[i] = message.charCodeAt(i) & 0xff;
  }
  return out;
}

export function sign(message: Uint8Array, privateKey: Uint8Array): string {
  return bytesToHex(ed.sign(message, privateKey));
}

export function verify(
  signatureHex: string,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    const signature = hexToBytes(signatureHex);
    if (signature.length !== 64) {
      return false;
    }
    return ed.verify(signature, message, publicKey);
  } catch {
    // A malformed signature is a failed verification, never an exception that could
    // take down the handshake path.
    return false;
  }
}

/** Private key from stored hex. Throws rather than signing with garbage. */
export function hexToPrivateKey(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) {
    throw new Error('stored private key is not 32 bytes');
  }
  return bytes;
}

export function publicKeyToHex(publicKey: Uint8Array): string {
  return bytesToHex(publicKey);
}

/** Returns null for anything that is not a valid 32-byte key. */
export function publicKeyFromHex(hex: unknown): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length !== 64) {
    return null;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = hexToBytes(hex);
  return bytes.length === 32 ? bytes : null;
}

export interface VerificationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Everything required to believe a peer is who it says it is.
 *
 * Checked in order, cheapest first, and every failure names what went wrong so a
 * rejection is diagnosable rather than a blanket "handshake failed".
 */
export function verifyPeerClaim(params: {
  claimedPeerId: string;
  publicKeyHex: unknown;
  signatureHex: unknown;
  label: 'hello' | 'hello-ack';
  challenge: string;
  audiencePeerId: string;
  initiatorEphemeralKey: string;
  responderEphemeralKey: string;
}): VerificationResult {
  const publicKey = publicKeyFromHex(params.publicKeyHex);
  if (!publicKey) {
    return {ok: false, reason: 'missing or malformed public key'};
  }
  if (typeof params.claimedPeerId !== 'string' ||
      params.claimedPeerId.length !== PEER_ID_HEX_LENGTH) {
    return {ok: false, reason: 'peer id is not a 16-byte hex value'};
  }
  if (!publicKeyMatchesPeerId(publicKey, params.claimedPeerId)) {
    return {
      ok: false,
      reason: 'peer id does not match the public key it was presented with',
    };
  }
  if (typeof params.signatureHex !== 'string') {
    return {ok: false, reason: 'missing signature'};
  }

  const message = challengeBytes(
    params.label,
    params.challenge,
    params.claimedPeerId,
    params.audiencePeerId,
    params.initiatorEphemeralKey,
    params.responderEphemeralKey,
  );
  if (!verify(params.signatureHex, message, publicKey)) {
    return {ok: false, reason: 'signature does not verify against the challenge'};
  }
  return {ok: true};
}
