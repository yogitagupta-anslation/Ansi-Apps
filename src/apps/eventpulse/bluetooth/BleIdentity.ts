/**
 * Event-scoped, rotating BLE identity.
 *
 * Rules this module enforces:
 *  - We never broadcast a permanent, globally trackable identifier.
 *  - The identifier a user exposes at event A is unlinkable to the one they
 *    expose at event B, because it is derived from a per-event secret seed.
 *  - The identifier rotates on a fixed epoch so a passive observer cannot
 *    follow one device across a whole day.
 *
 * Resolution without pairing
 * --------------------------
 * A rotating id would normally be useless to other attendees. It works here
 * because rotation is *scheduled*, not random: on join (and on each refresh)
 * the device publishes the peer ids it will use for the next few epochs to the
 * event server, which folds them into the attendee directory. Every attendee's
 * local cache therefore contains a `peerId -> profileId` table covering the
 * current window, so a scan hit resolves to a full profile instantly and
 * entirely offline. No BLE connection, no pairing.
 */

import { bytesToHex } from '../utils/bytes';
import { hmacSha256Utf8 } from '../utils/sha256';

export const DEFAULT_ROTATION_MS = 15 * 60 * 1000;
/** How many future epochs we publish so peers can resolve us across a rotation. */
export const DEFAULT_SCHEDULE_DEPTH = 8;
export const SEED_BYTES = 16;

export interface RandomSource {
  (byteLength: number): Uint8Array;
}

/**
 * Cryptographic randomness where the platform provides it.
 *
 * `globalThis.crypto.getRandomValues` exists on modern Hermes and in Node 19+.
 * The `Math.random` path is a loud last resort: it is fine for the simulator
 * but must never be the source of a real attendee's identity seed.
 */
export const defaultRandomSource: RandomSource = (byteLength: number): Uint8Array => {
  const out = new Uint8Array(byteLength);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => void } })
    .crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(out);
    return out;
  }
  if (__DEV_WARNED.warned === false) {
    __DEV_WARNED.warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[EventPulse] No CSPRNG available; falling back to Math.random for peer identity seeds. ' +
        'This is acceptable only in development.',
    );
  }
  for (let i = 0; i < byteLength; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
};

const __DEV_WARNED = { warned: false };

export interface PeerIdWindow {
  peerId: string;
  epoch: number;
  validFrom: number;
  validUntil: number;
}

export interface PeerIdentityOptions {
  rotationMs?: number;
  random?: RandomSource;
}

export class PeerIdentityService {
  private readonly rotationMs: number;
  private readonly random: RandomSource;

  constructor(options: PeerIdentityOptions = {}) {
    this.rotationMs = options.rotationMs ?? DEFAULT_ROTATION_MS;
    this.random = options.random ?? defaultRandomSource;
  }

  /** Fresh per-event secret. Stored locally; never broadcast, never logged. */
  createSeed(): Uint8Array {
    return this.random(SEED_BYTES);
  }

  epochAt(timestamp: number): number {
    return Math.floor(timestamp / this.rotationMs);
  }

  epochStart(epoch: number): number {
    return epoch * this.rotationMs;
  }

  /**
   * Derive the 8-hex-character peer id for one (seed, event, epoch) triple.
   *
   * The event id is inside the MAC input, so two events sharing a seed would
   * still produce unlinkable ids — belt and braces, since seeds are per-event.
   */
  derivePeerId(seed: Uint8Array, eventId: string, epoch: number): string {
    const mac = hmacSha256Utf8(seed, `eventpulse/v1/peer/${eventId}/${epoch}`);
    return bytesToHex(mac.slice(0, 4));
  }

  /** Derive the 4-hex-character avatar id, stable for the lifetime of an event. */
  deriveAvatarId(seed: Uint8Array, eventId: string): string {
    const mac = hmacSha256Utf8(seed, `eventpulse/v1/avatar/${eventId}`);
    return bytesToHex(mac.slice(0, 2));
  }

  currentPeerId(seed: Uint8Array, eventId: string, now: number): string {
    return this.derivePeerId(seed, eventId, this.epochAt(now));
  }

  nextRotationAt(now: number): number {
    return this.epochStart(this.epochAt(now) + 1);
  }

  /**
   * The window of ids to publish to the event directory: one epoch of history
   * (so peers whose clocks lag slightly still resolve us) plus `depth` ahead.
   */
  schedule(
    seed: Uint8Array,
    eventId: string,
    now: number,
    depth: number = DEFAULT_SCHEDULE_DEPTH,
  ): PeerIdWindow[] {
    const current = this.epochAt(now);
    const windows: PeerIdWindow[] = [];
    for (let epoch = current - 1; epoch <= current + depth; epoch++) {
      windows.push({
        peerId: this.derivePeerId(seed, eventId, epoch),
        epoch,
        validFrom: this.epochStart(epoch),
        validUntil: this.epochStart(epoch + 1),
      });
    }
    return windows;
  }

  /**
   * True when the published schedule no longer covers enough of the future and
   * should be re-uploaded. Called by `EventService` on its sync tick.
   */
  needsRepublish(windows: PeerIdWindow[], now: number, minAheadEpochs = 3): boolean {
    if (windows.length === 0) return true;
    const lastCovered = Math.max(...windows.map((w) => w.epoch));
    return lastCovered - this.epochAt(now) < minAheadEpochs;
  }
}

export const peerIdentityService = new PeerIdentityService();
