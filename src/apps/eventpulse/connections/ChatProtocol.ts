/**
 * What a chat message looks like on the air.
 *
 * The same shape and the same discipline as `ConnectionProtocol`: a small JSON
 * record, encoded to UTF-8, decoded defensively. Every field is validated on
 * the way in and a malformed record returns null rather than throwing, because
 * the bytes arrive from another phone over a radio and nothing about them is
 * trustworthy — the sender could be running a different build, a corrupted one,
 * or something that is not EventPulse at all.
 *
 * This deliberately does NOT reuse BleChat's `PacketCodec`. That codec encrypts
 * every packet against a session from `crypto/SessionRegistry`
 * (`blechat/messaging/PacketCodec.ts:5-6`), and EventPulse has no session
 * crypto to hand it. Importing it would mean importing BleChat's whole identity
 * and key-exchange stack to send one line of text, which is the opposite of the
 * small integration this is meant to be.
 *
 * Fragmentation is not here either, and must not be: the transport underneath
 * already fragments at the link MTU. A second layer would corrupt every message
 * longer than one frame.
 */

import { utf8Decode, utf8Encode } from '../utils/bytes';

export const CHAT_PROTOCOL_VERSION = 1;

/**
 * The longest message a person can send.
 *
 * Not a technical limit — the transport fragments, so a much larger message
 * would still arrive. It is a deliberate one: a chat bubble is a sentence, and
 * a megabyte pasted into the composer would occupy the radio for minutes while
 * everything else on the link waited behind it.
 */
export const MAX_CHAT_TEXT_BYTES = 2000;

const MAX_ID_BYTES = 128;

export interface ChatMessagePayload {
  /** Sender-minted, unique per message. Used to drop duplicates on redelivery. */
  messageId: string;
  /** The text as typed. Never HTML, never markup — the UI renders it as text. */
  text: string;
  /** The sender's clock. Advisory only; the receiver stamps its own arrival. */
  sentAt: number;
}

export function encodeChatMessage(payload: ChatMessagePayload): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      v: CHAT_PROTOCOL_VERSION,
      messageId: payload.messageId,
      text: payload.text,
      sentAt: payload.sentAt,
    }),
  );
}

export function decodeChatMessage(bytes: Uint8Array): ChatMessagePayload | null {
  const raw = parseJson(bytes);
  if (!isRecord(raw)) return null;
  if (finiteNumber(raw.v) !== CHAT_PROTOCOL_VERSION) return null;

  const messageId = cleanString(raw.messageId, MAX_ID_BYTES);
  const text = cleanString(raw.text, MAX_CHAT_TEXT_BYTES);
  const sentAt = finiteNumber(raw.sentAt);

  if (!messageId || !text || sentAt === null) return null;

  return { messageId, text, sentAt };
}

/* ------------------------------------------------------------------ *
 * Hostile-input helpers
 *
 * Kept local rather than exported from ConnectionProtocol: these are the
 * boundary of a second protocol, and a shared helper that one protocol relaxed
 * would quietly relax the other too.
 * ------------------------------------------------------------------ */

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8Decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string within a byte budget, or null. */
function cleanString(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (utf8Encode(trimmed).length > maxBytes) return null;
  return trimmed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
