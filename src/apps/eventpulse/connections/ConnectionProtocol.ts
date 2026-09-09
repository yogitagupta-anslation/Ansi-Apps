/**
 * What a connection request actually says on the wire.
 *
 * `GattFraming` gets bytes across a link and `GattMessage` says which kind of
 * message they are. This module is the payload of the three connection
 * messages, and it exists because of one offline constraint: with no directory
 * server, the receiving phone has never heard of the sender. It cannot look
 * them up. So the request has to carry enough of the sender's card to render
 * "Jaismeet wants to connect" from nothing but the bytes that arrived.
 *
 * JSON rather than a packed binary layout. The GATT link fragments at the MTU
 * and reassembles up to 64 KB, so a few hundred bytes costs a handful of extra
 * fragments and buys a format that can gain a field without a version flag day.
 * The presence beacon is where every byte is precious; this is not that channel.
 *
 * DECODING IS HOSTILE-INPUT HANDLING. Anything can write to our RX
 * characteristic. Every decoder here validates types and lengths and returns
 * null rather than throwing, so a malformed or malicious payload is dropped
 * without taking the link — or the app — down with it.
 */

import type { ProfileId } from '../types';

export const CONNECTION_PROTOCOL_VERSION = 1;

/** Caps, so a peer cannot spend our memory or our screen. */
const MAX_NAME_BYTES = 120;
const MAX_FIELD_BYTES = 160;
const MAX_NOTE_BYTES = 500;
const MAX_ID_BYTES = 128;

/**
 * The sender's card, as much of it as they chose to share.
 *
 * Deliberately a subset of `Profile`: enough to decide whether to accept, and
 * nothing else. Everything here has already been through `redactProfile` on the
 * sending side, which offline is the only place field-level privacy can be
 * enforced at all.
 */
export interface ConnectionCard {
  profileId: ProfileId;
  name: string;
  role?: string;
  company?: string;
}

export interface ConnectionRequestPayload {
  v: number;
  /** Identifies this request across retries, accepts and rejects. */
  requestId: string;
  card: ConnectionCard;
  /** Optional line the sender attached. */
  note?: string;
  sentAt: number;
}

export interface ConnectionAcceptPayload {
  v: number;
  requestId: string;
  /** The accepter's card, so the original sender learns who accepted. */
  card: ConnectionCard;
  acceptedAt: number;
}

export type ConnectionRejectReason = 'declined' | 'blocked' | 'not_accepting' | 'unknown';

export interface ConnectionRejectPayload {
  v: number;
  requestId: string;
  /**
   * Why. Note that 'blocked' is never sent — see `rejectReasonToSend`. A phone
   * that told you it had blocked you would be handing a harasser a signal.
   */
  reason: ConnectionRejectReason;
  rejectedAt: number;
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

const encoder = (value: unknown): Uint8Array => {
  const json = JSON.stringify(value);
  const out = new Uint8Array(json.length * 4);
  let n = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code < 0x80) {
      out[n++] = code;
    } else if (code < 0x800) {
      out[n++] = 0xc0 | (code >> 6);
      out[n++] = 0x80 | (code & 0x3f);
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < json.length) {
      const low = json.charCodeAt(i + 1);
      const point = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      out[n++] = 0xf0 | (point >> 18);
      out[n++] = 0x80 | ((point >> 12) & 0x3f);
      out[n++] = 0x80 | ((point >> 6) & 0x3f);
      out[n++] = 0x80 | (point & 0x3f);
      i++;
    } else {
      out[n++] = 0xe0 | (code >> 12);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    }
  }
  return out.slice(0, n);
};

export function encodeConnectionPayload(payload: unknown): Uint8Array {
  return encoder(payload);
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc0 && b0 < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 >= 0xe0 && b0 < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else if (b0 >= 0xf0 && i + 3 < bytes.length) {
      const point =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      const shifted = point - 0x10000;
      out += String.fromCharCode(0xd800 + (shifted >> 10), 0xdc00 + (shifted & 0x3ff));
      i += 4;
    } else {
      // Malformed sequence. Skip the byte rather than emitting a replacement
      // character that could be mistaken for content.
      i += 1;
    }
  }
  return out;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
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
  if (encoder(trimmed).length > maxBytes + 2) return null; // +2 for the JSON quotes
  return trimmed;
}

function optionalString(value: unknown, maxBytes: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return cleanString(value, maxBytes) ?? undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeCard(value: unknown): ConnectionCard | null {
  if (!isRecord(value)) return null;
  const profileId = cleanString(value.profileId, MAX_ID_BYTES);
  const name = cleanString(value.name, MAX_NAME_BYTES);
  if (!profileId || !name) return null;
  return {
    profileId,
    name,
    role: optionalString(value.role, MAX_FIELD_BYTES),
    company: optionalString(value.company, MAX_FIELD_BYTES),
  };
}

export function decodeConnectionRequest(bytes: Uint8Array): ConnectionRequestPayload | null {
  const raw = parseJson(bytes);
  if (!isRecord(raw)) return null;
  if (finiteNumber(raw.v) !== CONNECTION_PROTOCOL_VERSION) return null;

  const requestId = cleanString(raw.requestId, MAX_ID_BYTES);
  const card = decodeCard(raw.card);
  const sentAt = finiteNumber(raw.sentAt);
  if (!requestId || !card || sentAt === null) return null;

  return {
    v: CONNECTION_PROTOCOL_VERSION,
    requestId,
    card,
    note: optionalString(raw.note, MAX_NOTE_BYTES),
    sentAt,
  };
}

export function decodeConnectionAccept(bytes: Uint8Array): ConnectionAcceptPayload | null {
  const raw = parseJson(bytes);
  if (!isRecord(raw)) return null;
  if (finiteNumber(raw.v) !== CONNECTION_PROTOCOL_VERSION) return null;

  const requestId = cleanString(raw.requestId, MAX_ID_BYTES);
  const card = decodeCard(raw.card);
  const acceptedAt = finiteNumber(raw.acceptedAt);
  if (!requestId || !card || acceptedAt === null) return null;

  return { v: CONNECTION_PROTOCOL_VERSION, requestId, card, acceptedAt };
}

const REJECT_REASONS: ConnectionRejectReason[] = ['declined', 'blocked', 'not_accepting', 'unknown'];

export function decodeConnectionReject(bytes: Uint8Array): ConnectionRejectPayload | null {
  const raw = parseJson(bytes);
  if (!isRecord(raw)) return null;
  if (finiteNumber(raw.v) !== CONNECTION_PROTOCOL_VERSION) return null;

  const requestId = cleanString(raw.requestId, MAX_ID_BYTES);
  const rejectedAt = finiteNumber(raw.rejectedAt);
  if (!requestId || rejectedAt === null) return null;

  const reason = REJECT_REASONS.includes(raw.reason as ConnectionRejectReason)
    ? (raw.reason as ConnectionRejectReason)
    : 'unknown';

  return { v: CONNECTION_PROTOCOL_VERSION, requestId, reason, rejectedAt };
}

/**
 * What to actually put on the wire when refusing.
 *
 * A block or a privacy setting is never disclosed. Telling someone "you are
 * blocked" hands a person who is being deliberately avoided a confirmation that
 * they have been noticed, and telling them "not accepting requests" is nearly as
 * informative. Both go out as a plain decline, which is indistinguishable from
 * the ordinary case and is the whole point.
 */
export function rejectReasonToSend(internal: ConnectionRejectReason): ConnectionRejectReason {
  return internal === 'blocked' || internal === 'not_accepting' ? 'declined' : internal;
}
