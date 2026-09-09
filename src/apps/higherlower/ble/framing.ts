import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './bytes';
import { DEFAULT_ATT_MTU } from './constants';

/**
 * Splits a protocol message across as many BLE writes as the negotiated MTU
 * needs, and puts it back together on the far side.
 *
 * Every message this game sends fits in one packet once an MTU request
 * succeeds, which is the normal case. It is the abnormal case this exists for:
 * a stack that refuses the request leaves 20 usable bytes per write, and
 * without framing a 'go' would arrive with its target chopped off — a round
 * that silently cannot be won. One header byte is a cheap price for never
 * having to trust the negotiation.
 *
 *   header = fragment index (6 bits) | LAST (0x80)
 *
 * A fragment with index 0 starts a new message, so a sender that disappears
 * mid-message cannot poison the next one.
 */

const LAST = 0x80;
const INDEX_MASK = 0x3f;
export const MAX_FRAGMENTS = INDEX_MASK + 1;

/** ATT reserves three bytes of every packet for its own header. */
export function usablePayload(mtu: number): number {
  return Math.max(1, (mtu > 0 ? mtu : DEFAULT_ATT_MTU) - 3 - 1);
}

/** Encodes one message into the base64 frames a link should write, in order. */
export function toFrames(text: string, mtu: number): string[] {
  const body = utf8Encode(text);
  const room = usablePayload(mtu);
  const count = Math.max(1, Math.ceil(body.length / room));
  if (count > MAX_FRAGMENTS) {
    throw new Error(`Message needs ${count} fragments, more than the ${MAX_FRAGMENTS} the header allows`);
  }

  const frames: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const slice = body.subarray(i * room, (i + 1) * room);
    const frame = new Uint8Array(slice.length + 1);
    frame[0] = (i & INDEX_MASK) | (i === count - 1 ? LAST : 0);
    frame.set(slice, 1);
    frames.push(bytesToBase64(frame));
  }
  return frames;
}

/**
 * Per-link reassembly. One instance per remote device: fragments from two
 * peers must never be interleaved into the same buffer.
 */
export class Reassembler {
  private parts: Uint8Array[] = [];
  private next = 0;

  /** Feeds one inbound frame. Returns the message when it completes. */
  accept(base64: string): string | null {
    const frame = base64ToBytes(base64);
    if (frame.length < 1) return null;

    const header = frame[0];
    const index = header & INDEX_MASK;
    const last = (header & LAST) !== 0;
    const body = frame.subarray(1);

    if (index === 0) {
      this.parts = [];
      this.next = 0;
    } else if (index !== this.next) {
      // A fragment went missing. The rest of this message is unrecoverable, so
      // drop it and wait for the next one to start cleanly at index 0.
      this.reset();
      return null;
    }

    this.parts.push(body);
    this.next = index + 1;
    if (!last) return null;

    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const part of this.parts) {
      joined.set(part, at);
      at += part.length;
    }
    this.reset();
    return utf8Decode(joined);
  }

  reset(): void {
    this.parts = [];
    this.next = 0;
  }
}
