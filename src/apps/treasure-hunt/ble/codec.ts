/**
 * Envelope serialisation.
 *
 * Wire format is JSON over UTF-8. That costs bandwidth compared with a packed
 * binary encoding, but BLE game traffic here is small and bursty, and the win
 * in debuggability and forward-compatibility is worth it. Chattiness is
 * controlled where it actually matters -- movement is rate-limited and
 * coalesced rather than compressed (see PlayerManager / TIMING.movementSendHz).
 *
 * Anything arriving off the air is untrusted: decode() validates structure and
 * never throws into a native BLE callback.
 */
import {MessageType, PROTOCOL_VERSION} from '../models/messages';
import type {Envelope, GameMessage} from '../models/messages';
import {base64ToBytes, bytesToBase64, utf8Decode, utf8Encode} from '../utils/base64';
import {createLogger} from '../utils/logger';
import {messageId as newMessageId} from '../utils/id';

const log = createLogger('codec');

const VALID_TYPES: ReadonlySet<string> = new Set(Object.values(MessageType));

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return utf8Encode(JSON.stringify(envelope));
}

export function encodeEnvelopeBase64(envelope: Envelope): string {
  return bytesToBase64(encodeEnvelope(envelope));
}

/**
 * Parse bytes into an envelope.
 * @returns null when the bytes are not a well-formed envelope.
 */
export function decodeEnvelope(bytes: Uint8Array): GameMessage | null {
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch (err) {
    log.warn('utf8 decode failed', err);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    log.warn(`JSON parse failed for ${bytes.length} bytes`);
    return null;
  }

  return validateEnvelope(parsed);
}

export function decodeEnvelopeBase64(value: string): GameMessage | null {
  try {
    return decodeEnvelope(base64ToBytes(value));
  } catch (err) {
    log.warn('base64 decode failed', err);
    return null;
  }
}

/** Structural validation of an untrusted object from the air. */
export function validateEnvelope(value: unknown): GameMessage | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const e = value as Record<string, unknown>;

  if (typeof e.messageId !== 'string' || e.messageId.length === 0) {
    return null;
  }
  if (typeof e.type !== 'string' || !VALID_TYPES.has(e.type)) {
    log.warn(`unknown message type "${String(e.type)}"`);
    return null;
  }
  if (typeof e.senderId !== 'string' || e.senderId.length === 0) {
    return null;
  }
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) {
    return null;
  }
  if (typeof e.seq !== 'number' || !Number.isFinite(e.seq)) {
    return null;
  }
  if (typeof e.payload !== 'object' || e.payload === null) {
    return null;
  }

  return value as GameMessage;
}

/** Per-sender sequence counters, so each outbound stream is monotonic. */
const sequenceBySender = new Map<string, number>();

export function nextSeq(senderId: string): number {
  const next = (sequenceBySender.get(senderId) ?? 0) + 1;
  sequenceBySender.set(senderId, next);
  return next;
}

export function resetSeq(senderId?: string): void {
  if (senderId === undefined) {
    sequenceBySender.clear();
  } else {
    sequenceBySender.delete(senderId);
  }
}

/** Build a fully populated envelope ready to hand to the reliability layer. */
export function buildEnvelope<T>(
  type: MessageType,
  senderId: string,
  payload: T,
): Envelope<T> {
  return {
    messageId: newMessageId(),
    type,
    senderId,
    timestamp: Date.now(),
    seq: nextSeq(senderId),
    payload,
  };
}

export {PROTOCOL_VERSION};
