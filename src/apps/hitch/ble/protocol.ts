import type {ParcelSize} from '../config/parcel';
import type {RideMode, VehicleKind} from '../types';

/**
 * What one phone says to another to arrange a ride.
 *
 * Three messages, and that is the whole protocol. A passenger asks; a rider answers yes or
 * no. Everything else in the app — the matching, the fare, the map — is local to one side
 * or the other and does not need to cross.
 *
 * DESIGN CONSTRAINT, and it shapes everything below: this has to fit in ONE GATT write.
 * A negotiated MTU gives around 500 usable bytes, and the fragmentation layer BLE Chat
 * needed exists because chat messages are unbounded. A ride request is not — it is a
 * handful of short strings — so keeping it inside a single frame removes reassembly,
 * ordering, retransmission and every failure mode that comes with them. The cost is that
 * every field is capped, which `clamp` does on the way out rather than trusting a caller.
 *
 * JSON rather than a packed binary layout, deliberately. The saving from packing would be
 * perhaps a hundred bytes on a payload that already fits, and it would cost the property
 * that matters more here: a phone running an older build can read the fields it knows and
 * ignore the rest, which is what lets this be extended without a flag day between two
 * apps that update independently.
 */

export const HITCH_PROTOCOL_VERSION = 1;

export type RideMessageType = 'REQUEST' | 'ACCEPT' | 'DECLINE' | 'CHAT' | 'ACK';

/** Caps, applied on send. A field longer than this is a bug or an attack, not a name. */
const MAX_NAME = 24;
const MAX_PLACE = 40;
const MAX_TEXT = 60;
/** A ride chat line. Long enough for an address, short enough for one frame. */
const MAX_CHAT = 280;

export interface RideRequestMessage {
  t: 'REQUEST';
  v: number;
  /** Correlates the answer with the ask. */
  id: string;
  /** Who is asking, as they chose to be known. */
  from: string;
  /** The passenger's device identity, so a rider can recognise a repeat customer. */
  fromId: string;
  mode: RideMode;
  kind: VehicleKind;
  pickup: string;
  drop: string;
  /** Kilometres, as the passenger's own routing estimated it. */
  km: number;
  /** Rupees. What the passenger was shown — the rider sees the same number. */
  fare: number;
  /** Parcel only: size and what is inside, so a rider can refuse before accepting. */
  parcel?: {size: ParcelSize; contents: string; receiver: string};
}

export interface RideAcceptMessage {
  t: 'ACCEPT';
  v: number;
  id: string;
  /** The rider, and enough to identify the actual vehicle at the kerb. */
  from: string;
  plate: string;
  model: string;
  colour: string;
}

export interface RideDeclineMessage {
  t: 'DECLINE';
  v: number;
  id: string;
  /** Optional and short. "On another ride" is more use than silence. */
  why?: string;
}

/**
 * A line of conversation between the two people on a ride.
 *
 * Deliberately the same envelope as the other three rather than a second protocol: the
 * link is already open, the framing already works, and a chat message is smaller than a
 * ride request. Splitting it out would mean two codecs and two decoders on the same wire.
 *
 * Capped to one frame like everything else here. A ride chat is "near the gate", not an
 * essay — BLE Chat carries fragmentation because a chat message there is unbounded, and
 * borrowing that machinery for messages that fit anyway would be cost without benefit.
 */
export interface RideChatMessage {
  t: 'CHAT';
  v: number;
  /** Doubles as the id an ACK refers to. */
  id: string;
  text: string;
  /** The sender's clock, shown only as a claim — the two phones share no time source. */
  at: number;
}

/**
 * "It arrived."
 *
 * The distinction BLE Chat draws and this borrows: SENT means a write completed on this
 * phone, DELIVERED means the other phone said it has it. On a link that drops mid-sentence
 * those are genuinely different facts, and collapsing them is how a messenger ends up
 * showing a tick for something nobody received.
 */
export interface RideAckMessage {
  t: 'ACK';
  v: number;
  id: string;
}

export type RideMessage =
  | RideRequestMessage
  | RideAcceptMessage
  | RideDeclineMessage
  | RideChatMessage
  | RideAckMessage;

function clamp(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function base64Encode(text: string): string {
  if (typeof globalThis.btoa === 'function') {
    // btoa is byte-oriented; encodeURIComponent/unescape widens UTF-8 safely first.
    return globalThis.btoa(unescape(encodeURIComponent(text)));
  }
  return Buffer.from(text, 'utf8').toString('base64');
}

function base64Decode(data: string): string {
  if (typeof globalThis.atob === 'function') {
    return decodeURIComponent(escape(globalThis.atob(data)));
  }
  return Buffer.from(data, 'base64').toString('utf8');
}

/** Everything that goes on the wire is capped here, so no caller can widen it. */
export function encodeMessage(message: RideMessage): string {
  let safe: RideMessage;
  if (message.t === 'REQUEST') {
    safe = {
      ...message,
      v: HITCH_PROTOCOL_VERSION,
      from: clamp(message.from, MAX_NAME),
      fromId: clamp(message.fromId, 16),
      pickup: clamp(message.pickup, MAX_PLACE),
      drop: clamp(message.drop, MAX_PLACE),
      km: Math.round(message.km * 10) / 10,
      fare: Math.round(message.fare),
      ...(message.parcel
        ? {
            parcel: {
              size: message.parcel.size,
              contents: clamp(message.parcel.contents, MAX_TEXT),
              receiver: clamp(message.parcel.receiver, MAX_NAME),
            },
          }
        : {}),
    };
  } else if (message.t === 'ACCEPT') {
    safe = {
      ...message,
      v: HITCH_PROTOCOL_VERSION,
      from: clamp(message.from, MAX_NAME),
      plate: clamp(message.plate, 16),
      model: clamp(message.model, MAX_NAME),
      colour: clamp(message.colour, MAX_NAME),
    };
  } else if (message.t === 'CHAT') {
    safe = {
      ...message,
      v: HITCH_PROTOCOL_VERSION,
      text: clamp(message.text, MAX_CHAT),
    };
  } else if (message.t === 'ACK') {
    safe = {...message, v: HITCH_PROTOCOL_VERSION};
  } else {
    safe = {
      ...message,
      v: HITCH_PROTOCOL_VERSION,
      ...(message.why ? {why: clamp(message.why, MAX_TEXT)} : {}),
    };
  }
  return base64Encode(JSON.stringify(safe));
}

/**
 * Read a frame, or null.
 *
 * Every byte arrived from a stranger's phone. Nothing is trusted: the JSON may not parse,
 * the type may be unknown, required fields may be missing or the wrong shape, and numbers
 * may be anything at all. A frame that fails any of that is simply not a message — never
 * an exception, because this runs on a radio callback where a throw takes the link down.
 */
export function decodeMessage(base64: string): RideMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(base64Decode(base64));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !m.id) {
    return null;
  }

  if (m.t === 'REQUEST') {
    if (typeof m.pickup !== 'string' || typeof m.drop !== 'string') {
      return null;
    }
    const kind = ['bike', 'auto', 'cab', 'other'].includes(m.kind as string)
      ? (m.kind as VehicleKind)
      : 'auto';
    const parcel =
      m.parcel && typeof m.parcel === 'object'
        ? (m.parcel as Record<string, unknown>)
        : null;
    return {
      t: 'REQUEST',
      v: typeof m.v === 'number' ? m.v : 1,
      id: m.id,
      from: clamp(m.from, MAX_NAME) || 'Someone nearby',
      fromId: clamp(m.fromId, 16),
      mode: m.mode === 'parcel' ? 'parcel' : 'ride',
      kind,
      pickup: clamp(m.pickup, MAX_PLACE),
      drop: clamp(m.drop, MAX_PLACE),
      // Bounded rather than merely coerced: a rider is shown these, and a fare of
      // 1e9 or NaN in a card is worse than no number at all.
      km: sane(m.km, 0, 500),
      fare: sane(m.fare, 0, 100000),
      ...(parcel
        ? {
            parcel: {
              size: (['small', 'medium', 'large'].includes(parcel.size as string)
                ? parcel.size
                : 'small') as ParcelSize,
              contents: clamp(parcel.contents, MAX_TEXT),
              receiver: clamp(parcel.receiver, MAX_NAME),
            },
          }
        : {}),
    };
  }

  if (m.t === 'ACCEPT') {
    return {
      t: 'ACCEPT',
      v: typeof m.v === 'number' ? m.v : 1,
      id: m.id,
      from: clamp(m.from, MAX_NAME) || 'Rider',
      plate: clamp(m.plate, 16),
      model: clamp(m.model, MAX_NAME),
      colour: clamp(m.colour, MAX_NAME),
    };
  }

  if (m.t === 'CHAT') {
    if (typeof m.text !== 'string') {
      return null;
    }
    const text = clamp(m.text, MAX_CHAT).trim();
    if (!text) {
      // An empty message is not a message. Rendering a blank bubble would be worse than
      // dropping a frame that carried nothing.
      return null;
    }
    return {
      t: 'CHAT',
      v: typeof m.v === 'number' ? m.v : 1,
      id: m.id,
      text,
      at: sane(m.at, 0, Number.MAX_SAFE_INTEGER),
    };
  }

  if (m.t === 'ACK') {
    return {t: 'ACK', v: typeof m.v === 'number' ? m.v : 1, id: m.id};
  }

  if (m.t === 'DECLINE') {
    return {
      t: 'DECLINE',
      v: typeof m.v === 'number' ? m.v : 1,
      id: m.id,
      ...(typeof m.why === 'string' ? {why: clamp(m.why, MAX_TEXT)} : {}),
    };
  }

  return null;
}

function sane(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}

/** Short, unguessable enough to correlate a reply. Not a secret. */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Whether an encoded frame will survive one write.
 *
 * Measured in BYTES ON THE RADIO, which is not the length of the base64 string: the
 * native module decodes before it writes, so a 640-character frame is 480 bytes on air.
 * Checking the string length instead would reject frames that fit and — worse, if the
 * caps were ever loosened — would be measuring the wrong quantity in the one place that
 * decides whether fragmentation is needed at all.
 *
 * 480 leaves room under the real ceiling: a negotiated MTU of 517 gives 514 usable after
 * the ATT header, and a single attribute write is capped at 512 by the spec regardless.
 * The margin absorbs a link that negotiated something smaller.
 */
export const MAX_FRAME_BYTES = 480;

/** Bytes a base64 string decodes to, without decoding it. */
export function frameBytes(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor((encoded.length * 3) / 4) - padding;
}

export function fitsOneFrame(encoded: string): boolean {
  return frameBytes(encoded) <= MAX_FRAME_BYTES;
}
