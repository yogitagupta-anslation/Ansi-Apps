import {x25519} from '@noble/curves/ed25519';
import {chacha20poly1305} from '@noble/ciphers/chacha';
import {hkdf} from '@noble/hashes/hkdf';
import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, hexToBytes, utf8Encode} from '../utils/bytes';

/**
 * Session encryption for a single link.
 *
 * The construction is deliberately an ordinary one — signed ephemeral Diffie-Hellman, the
 * same shape as Noise/SIGMA — assembled from audited primitives (@noble x25519,
 * ChaCha20-Poly1305, HKDF-SHA256). Nothing here invents an algorithm; the only design
 * decisions are how the pieces are bound together, and each of those is written down
 * below because getting one wrong is how this kind of layer fails silently.
 *
 *   1. Each side generates a FRESH X25519 keypair per link. The long-term Ed25519
 *      identity key never performs key agreement, so compromising it later does not
 *      decrypt traffic captured today (forward secrecy).
 *
 *   2. Both ephemeral public keys are covered by the Ed25519 signatures the handshake
 *      already exchanges (see challengeBytes in Identity.ts). That is what stops a
 *      man-in-the-middle: an attacker can substitute its own ephemeral key, but cannot
 *      produce the identity signature that must accompany it.
 *
 *   3. Keys are derived per DIRECTION. Initiator->responder and responder->initiator use
 *      different keys, so the two sides can both count from zero without ever colliding
 *      on a (key, nonce) pair — the one mistake that breaks ChaCha20-Poly1305 outright.
 *
 *   4. The nonce is a per-direction random-ish prefix from the KDF plus a monotonic
 *      counter. Counters never repeat within a session, and a session is a single link:
 *      a reconnect derives entirely new keys because the ephemeral keys are new.
 *
 * What this does NOT do: it does not authenticate that the peerId belongs to the human
 * you think it does — that is what the safety-number comparison in PeerProfileSheet is
 * for. It protects the link against an eavesdropper and an active MITM, not against
 * being introduced to the wrong person in the first place.
 */

/** Sizes fixed by the primitives; named so the wire-format maths below is readable. */
export const EPHEMERAL_KEY_BYTES = 32;
export const SESSION_KEY_BYTES = 32;
export const NONCE_PREFIX_BYTES = 4;
export const COUNTER_BYTES = 8;
export const NONCE_BYTES = NONCE_PREFIX_BYTES + COUNTER_BYTES; // 12, as ChaCha requires
export const AEAD_TAG_BYTES = 16;

/**
 * Counters are 8 bytes but JS integers are only exact to 2^53. Refusing well below both
 * limits keeps the "a nonce is never reused" guarantee arithmetically obvious rather than
 * resting on how a float behaves near its precision boundary.
 */
export const MAX_SESSION_COUNTER = Number.MAX_SAFE_INTEGER - 1;

export interface EphemeralKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  return {privateKey, publicKey: x25519.getPublicKey(privateKey)};
}

export function ephemeralPublicKeyToHex(key: Uint8Array): string {
  return bytesToHex(key);
}

/** Returns null for anything that is not a valid 32-byte X25519 public key. */
export function ephemeralPublicKeyFromHex(hex: unknown): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length !== EPHEMERAL_KEY_BYTES * 2) {
    return null;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const bytes = hexToBytes(hex);
  return bytes.length === EPHEMERAL_KEY_BYTES ? bytes : null;
}

export interface SessionKeys {
  sendKey: Uint8Array;
  recvKey: Uint8Array;
  sendNoncePrefix: Uint8Array;
  recvNoncePrefix: Uint8Array;
}

export interface SessionDerivationInput {
  /** Our ephemeral private key for this link. */
  privateKey: Uint8Array;
  /** Their ephemeral public key, as carried in the (signed) handshake. */
  peerPublicKey: Uint8Array;
  /** True on the side that sent HELLO. Decides which derived key is for sending. */
  isInitiator: boolean;
  /** Both challenges, so the derived keys are bound to this exact handshake. */
  initiatorChallenge: string;
  responderChallenge: string;
  initiatorPeerId: string;
  responderPeerId: string;
}

/**
 * Turn the raw DH output into four distinct values.
 *
 * The salt binds both fresh challenges and the info string binds both identities and the
 * direction labels, so two different handshakes can never derive the same keys even if
 * the same pair of devices reconnects repeatedly.
 */
export function deriveSessionKeys(input: SessionDerivationInput): SessionKeys {
  const shared = x25519.getSharedSecret(input.privateKey, input.peerPublicKey);

  const salt = sha256(
    utf8Encode(`${input.initiatorChallenge}|${input.responderChallenge}`),
  );
  const info = utf8Encode(
    `blechat-session-v1|${input.initiatorPeerId}|${input.responderPeerId}`,
  );

  // 2 keys + 2 nonce prefixes, taken from one expansion so they are all independent.
  const okm = hkdf(
    sha256,
    shared,
    salt,
    info,
    SESSION_KEY_BYTES * 2 + NONCE_PREFIX_BYTES * 2,
  );

  const i2rKey = okm.slice(0, SESSION_KEY_BYTES);
  const r2iKey = okm.slice(SESSION_KEY_BYTES, SESSION_KEY_BYTES * 2);
  const i2rPrefix = okm.slice(
    SESSION_KEY_BYTES * 2,
    SESSION_KEY_BYTES * 2 + NONCE_PREFIX_BYTES,
  );
  const r2iPrefix = okm.slice(SESSION_KEY_BYTES * 2 + NONCE_PREFIX_BYTES);

  return input.isInitiator
    ? {
        sendKey: i2rKey,
        recvKey: r2iKey,
        sendNoncePrefix: i2rPrefix,
        recvNoncePrefix: r2iPrefix,
      }
    : {
        sendKey: r2iKey,
        recvKey: i2rKey,
        sendNoncePrefix: r2iPrefix,
        recvNoncePrefix: i2rPrefix,
      };
}

function nonceFor(prefix: Uint8Array, counter: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(prefix, 0);
  // Big-endian, high bytes first. Division rather than bit shifts: counters run past
  // 2^32, where JS bitwise operators silently truncate to 32 bits.
  let remaining = counter;
  for (let i = NONCE_BYTES - 1; i >= NONCE_PREFIX_BYTES; i--) {
    nonce[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return nonce;
}

function counterBytes(counter: number): Uint8Array {
  const out = new Uint8Array(COUNTER_BYTES);
  let remaining = counter;
  for (let i = COUNTER_BYTES - 1; i >= 0; i--) {
    out[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

function counterFromBytes(bytes: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < COUNTER_BYTES; i++) {
    value = value * 256 + bytes[i];
  }
  return value;
}

export class SessionCryptoError extends Error {}

/**
 * How far out of order a datagram may arrive and still be accepted.
 *
 * Fragments are reassembled below this layer, so packets arriving here are already in
 * transmission order on a healthy link; the window only absorbs genuine reordering. It
 * is a sliding window rather than "must be exactly next" because rejecting a late-but-
 * real packet would drop a message the sender believes was delivered.
 */
const REPLAY_WINDOW = 64;

/**
 * One direction's worth of accept/reject state.
 *
 * Tracking WHICH counters were seen, not just the highest, is what makes this replay
 * protection rather than mere ordering: a captured packet re-injected inside the window
 * is recognised as already-seen and refused.
 */
class CounterWindow {
  private highest = 0;
  private readonly seen = new Set<number>();

  accept(counter: number): boolean {
    if (!Number.isInteger(counter) || counter <= 0) {
      return false;
    }
    if (counter + REPLAY_WINDOW <= this.highest) {
      // So old it has fallen out of the window entirely.
      return false;
    }
    if (this.seen.has(counter)) {
      return false;
    }
    this.seen.add(counter);
    if (counter > this.highest) {
      this.highest = counter;
    }
    // Forget everything that can no longer be accepted, so this cannot grow without
    // bound on a long-lived link.
    for (const value of this.seen) {
      if (value + REPLAY_WINDOW <= this.highest) {
        this.seen.delete(value);
      }
    }
    return true;
  }
}

/**
 * Seals and opens packets for one link.
 *
 * Wire layout, all big-endian:
 *
 *   [0]        version byte (1)
 *   [1..8]     counter, 8 bytes
 *   [9..]      ChaCha20-Poly1305 ciphertext, including its 16-byte tag
 *
 * The counter travels in the clear because the receiver needs it to rebuild the nonce
 * before it can decrypt anything. That is safe and standard: it is authenticated as
 * associated data, so flipping it invalidates the tag rather than sliding the window.
 */
export class SessionCipher {
  static readonly VERSION = 1;
  static readonly HEADER_BYTES = 1 + COUNTER_BYTES;

  private sendCounter = 0;
  private readonly window = new CounterWindow();

  constructor(private readonly keys: SessionKeys) {}

  seal(plaintext: Uint8Array): Uint8Array {
    if (this.sendCounter >= MAX_SESSION_COUNTER) {
      throw new SessionCryptoError('session counter exhausted; reconnect required');
    }
    this.sendCounter++;
    const counter = this.sendCounter;

    const header = new Uint8Array(SessionCipher.HEADER_BYTES);
    header[0] = SessionCipher.VERSION;
    header.set(counterBytes(counter), 1);

    const aead = chacha20poly1305(
      this.keys.sendKey,
      nonceFor(this.keys.sendNoncePrefix, counter),
      header,
    );
    const ciphertext = aead.encrypt(plaintext);

    const out = new Uint8Array(header.length + ciphertext.length);
    out.set(header, 0);
    out.set(ciphertext, header.length);
    return out;
  }

  open(frame: Uint8Array): Uint8Array {
    if (frame.length <= SessionCipher.HEADER_BYTES + AEAD_TAG_BYTES) {
      throw new SessionCryptoError('frame too short to be an encrypted packet');
    }
    if (frame[0] !== SessionCipher.VERSION) {
      throw new SessionCryptoError(`unknown session frame version ${frame[0]}`);
    }

    const header = frame.slice(0, SessionCipher.HEADER_BYTES);
    const counter = counterFromBytes(frame.slice(1, 1 + COUNTER_BYTES));

    // Checked BEFORE decrypting: a replayed frame carries a valid tag by definition, so
    // the tag alone can never catch it.
    if (!this.window.accept(counter)) {
      throw new SessionCryptoError(`replayed or stale counter ${counter}`);
    }

    const aead = chacha20poly1305(
      this.keys.recvKey,
      nonceFor(this.keys.recvNoncePrefix, counter),
      header,
    );
    try {
      return aead.decrypt(frame.slice(SessionCipher.HEADER_BYTES));
    } catch {
      // Never surface the library's message: a padding/tag error's detail is exactly the
      // sort of thing that turns into an oracle.
      throw new SessionCryptoError('authentication failed; packet rejected');
    }
  }
}
