/**
 * The message envelope that rides inside a reassembled GATT payload.
 *
 * `GattFraming` gets bytes across a link intact. This layer says what those
 * bytes mean, and it exists now — in the transport phase, before there is
 * anything interesting to send — for one reason: a link that carries only
 * anonymous byte blobs cannot be extended later without a flag day. Adding a
 * type byte and a message id up front means Phase 3 can introduce a connection
 * request without renegotiating anything, and an older build meeting a newer
 * one will skip a message type it does not know instead of misreading it.
 *
 * Layout (little-endian):
 *
 *   offset  size  field
 *   ------  ----  ------------------------------------------------------------
 *        0     1  version (high nibble) | flags (low nibble)
 *        1     1  type
 *        2     4  messageId — unique per sender, for acknowledgement and dedupe
 *        6     n  payload
 *
 * The envelope is deliberately tiny: six bytes, so it costs a third of one
 * 20-byte fragment at the un-negotiated Android MTU.
 */

export const GATT_MESSAGE_VERSION = 1;
export const GATT_MESSAGE_HEADER_BYTES = 6;

/**
 * Message types.
 *
 * Values below 0x10 are the transport's own housekeeping and are answered by
 * `GattSessionManager` without the application seeing them. Values from 0x10 up
 * are application messages that surface to the layer above.
 *
 * An unknown type is decoded and passed through as `known: false` rather than
 * throwing, so an older build meeting a newer one skips a message it does not
 * understand instead of misreading it — which is what let this block grow by
 * three entries without a version bump.
 */
export const GattMessageType = {
  /** First message on a new link: says who is speaking. */
  Hello: 0x01,
  /** Acknowledges a `messageId`. Payload is empty. */
  Ack: 0x02,
  /** Liveness probe for a link with no other traffic. */
  Ping: 0x03,
  /** Response to `Ping`. */
  Pong: 0x04,

  /* --- application types. Payloads live in connections/ConnectionProtocol. --- */

  /** "I would like to connect." Carries the sender's card. */
  ConnectionRequest: 0x10,
  /** "Yes." Carries the accepter's card. */
  ConnectionAccept: 0x11,
  /** "No." Never discloses a block or a privacy setting as the reason. */
  ConnectionReject: 0x12,
  /**
   * One chat message between two people who are already connected.
   *
   * A separate type rather than a flag on the others, so a build that predates
   * chat decodes it as unknown and ignores it instead of misreading it as a
   * connection request. Payload lives in `connections/ChatProtocol`.
   */
  ChatMessage: 0x13,
} as const;

export type GattMessageTypeValue = (typeof GattMessageType)[keyof typeof GattMessageType];

/** Every type this build understands, for the `known` flag on decode. */
const KNOWN_TYPES = new Set<number>(Object.values(GattMessageType));

export interface GattMessage {
  version: number;
  flags: number;
  type: number;
  messageId: number;
  payload: Uint8Array;
  /**
   * False when `type` is not one this build implements. The message is still
   * fully decoded — the caller can acknowledge it and ignore it, which is what
   * keeps two builds of different ages able to share a link.
   */
  known: boolean;
}

export type GattMessageErrorCode = 'too_short' | 'unsupported_version';

export class GattMessageError extends Error {
  readonly code: GattMessageErrorCode;

  constructor(code: GattMessageErrorCode, message: string) {
    super(message);
    this.name = 'GattMessageError';
    this.code = code;
  }
}

export interface EncodeMessageInput {
  type: number;
  messageId: number;
  payload?: Uint8Array;
  flags?: number;
}

export function encodeGattMessage(input: EncodeMessageInput): Uint8Array {
  const payload = input.payload ?? new Uint8Array(0);
  const out = new Uint8Array(GATT_MESSAGE_HEADER_BYTES + payload.length);

  out[0] = ((GATT_MESSAGE_VERSION & 0x0f) << 4) | ((input.flags ?? 0) & 0x0f);
  out[1] = input.type & 0xff;

  const id = input.messageId >>> 0;
  out[2] = id & 0xff;
  out[3] = (id >>> 8) & 0xff;
  out[4] = (id >>> 16) & 0xff;
  out[5] = (id >>> 24) & 0xff;

  out.set(payload, GATT_MESSAGE_HEADER_BYTES);
  return out;
}

export function decodeGattMessage(bytes: Uint8Array): GattMessage {
  if (bytes.length < GATT_MESSAGE_HEADER_BYTES) {
    throw new GattMessageError(
      'too_short',
      `envelope of ${bytes.length} bytes is shorter than the ${GATT_MESSAGE_HEADER_BYTES}-byte header`,
    );
  }

  const version = (bytes[0] >>> 4) & 0x0f;
  if (version !== GATT_MESSAGE_VERSION) {
    throw new GattMessageError(
      'unsupported_version',
      `envelope version ${version} is not supported (this build speaks v${GATT_MESSAGE_VERSION})`,
    );
  }

  const type = bytes[1];

  return {
    version,
    flags: bytes[0] & 0x0f,
    type,
    messageId:
      (bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24)) >>> 0,
    payload: bytes.subarray(GATT_MESSAGE_HEADER_BYTES),
    known: KNOWN_TYPES.has(type),
  };
}

/** Non-throwing decode, for the receive path where a bad frame must not kill the link. */
export function tryDecodeGattMessage(bytes: Uint8Array): GattMessage | null {
  try {
    return decodeGattMessage(bytes);
  } catch {
    return null;
  }
}

/**
 * Sequential message ids for one sender.
 *
 * Wraps at 2^32. Ids are only ever compared for equality within a link's dedupe
 * window, so a wrap is harmless long before it is reachable.
 */
export class MessageIdSource {
  private next: number;

  constructor(seed = 1) {
    this.next = seed >>> 0;
  }

  allocate(): number {
    const id = this.next;
    this.next = (this.next + 1) >>> 0;
    return id;
  }
}
