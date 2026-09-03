/**
 * EventPulse BLE advertisement protocol.
 *
 * Design constraints
 * -----------------
 * A legacy BLE advertisement carries 31 bytes. After the mandatory Flags AD
 * structure (3 bytes) and the Service Data AD header (length + type + 16-bit
 * UUID = 4 bytes) we are left with **24 bytes** of payload. Everything below
 * fits inside that budget with room to spare.
 *
 * The payload answers exactly one question: *"which event-scoped peer is near
 * me, and how should I render them before the cache resolves?"* It is NOT a
 * profile transport. Full professional data comes from the event attendee
 * directory cache — never from a BLE connection.
 *
 * Frame layout (13 + L bytes, L = displayTag length 0..8, max 21 bytes)
 *
 * ```
 *  off  size  field
 *   0    1    header    bits 7..4 protocolVersion, bits 3..2 status, bits 1..0 reserved
 *   1    2    eventCode uint16 big-endian
 *   3    4    peerId    4 raw bytes (rendered as 8 uppercase hex chars)
 *   7    1    profileVersion uint8, wraps at 256
 *   8    2    avatarId  uint16 big-endian (rendered as 4 uppercase hex chars)
 *  10    1    capabilities bitfield
 *  11    1    displayTag byte length L (0..8)
 *  12    L    displayTag UTF-8 bytes
 *  12+L  1    crc8 over bytes [0, 12+L)
 * ```
 *
 * Never placed in this frame: email, phone, tokens, permanent account ids, or
 * any private profile field. See docs/PRIVACY.md.
 */

import type { BleAdvertisement, PeerCapabilities, PresenceStatus } from '../types';
import { bytesToHex, crc8, utf8Decode, utf8TruncateBytes } from '../utils/bytes';

export const BLE_PROTOCOL_VERSION = 1;

/**
 * 16-bit Service Data UUID used to carry the EventPulse frame.
 *
 * NOTE: 16-bit UUIDs are allocated by the Bluetooth SIG. `0xFDCF` here is a
 * placeholder for local development — ship with an allocated member UUID, or
 * switch to a 128-bit service UUID plus extended advertising on platforms that
 * support it (see `EVENTPULSE_SERVICE_UUID_128`).
 */
export const EVENTPULSE_SERVICE_UUID_16 = 0xfdcf;
export const EVENTPULSE_SERVICE_UUID_128 = '7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10';

/** Hard ceiling imposed by legacy advertising after Flags + Service Data headers. */
export const MAX_PAYLOAD_BYTES = 24;
export const MAX_DISPLAY_TAG_BYTES = 8;

const HEADER_OFFSET = 0;
const EVENT_CODE_OFFSET = 1;
const PEER_ID_OFFSET = 3;
const PEER_ID_BYTES = 4;
const PROFILE_VERSION_OFFSET = 7;
const AVATAR_ID_OFFSET = 8;
const CAPABILITIES_OFFSET = 10;
const TAG_LENGTH_OFFSET = 11;
const TAG_OFFSET = 12;
const MIN_FRAME_BYTES = TAG_OFFSET + 1; // no tag + crc

const STATUS_TO_CODE: Record<PresenceStatus, number> = {
  available: 0,
  maybe: 1,
  busy: 2,
};
const CODE_TO_STATUS: PresenceStatus[] = ['available', 'maybe', 'busy', 'available'];

const CAP_ACCEPTS_CONNECTIONS = 0x01;
const CAP_SUPPORTS_NAVIGATION = 0x02;
const CAP_IS_ANCHOR = 0x04;

export type BleProtocolErrorCode =
  | 'too_short'
  | 'too_long'
  | 'bad_crc'
  | 'unsupported_version'
  | 'bad_length_field'
  | 'invalid_peer_id'
  | 'invalid_avatar_id';

export class BleProtocolError extends Error {
  readonly code: BleProtocolErrorCode;

  constructor(code: BleProtocolErrorCode, message: string) {
    super(message);
    this.name = 'BleProtocolError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

export interface EncodeInput {
  eventCode: number;
  /** 8 uppercase hex characters. */
  peerId: string;
  profileVersion: number;
  /** 4 uppercase hex characters. */
  avatarId: string;
  displayTag: string;
  status: PresenceStatus;
  capabilities: PeerCapabilities;
  protocolVersion?: number;
}

export function encodeCapabilities(caps: PeerCapabilities): number {
  let bits = 0;
  if (caps.acceptsConnections) bits |= CAP_ACCEPTS_CONNECTIONS;
  if (caps.supportsNavigation) bits |= CAP_SUPPORTS_NAVIGATION;
  if (caps.isAnchor) bits |= CAP_IS_ANCHOR;
  return bits & 0xff;
}

export function decodeCapabilities(bits: number): PeerCapabilities {
  return {
    acceptsConnections: (bits & CAP_ACCEPTS_CONNECTIONS) !== 0,
    supportsNavigation: (bits & CAP_SUPPORTS_NAVIGATION) !== 0,
    isAnchor: (bits & CAP_IS_ANCHOR) !== 0,
  };
}

function parseHexField(value: string, byteLength: number, code: BleProtocolErrorCode): number[] {
  const clean = value.trim().toUpperCase();
  if (!new RegExp(`^[0-9A-F]{${byteLength * 2}}$`).test(clean)) {
    throw new BleProtocolError(
      code,
      `expected ${byteLength * 2} hex characters, received "${value}"`,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < byteLength; i++) {
    out.push(parseInt(clean.substr(i * 2, 2), 16));
  }
  return out;
}

/** Serialise an advertisement frame. Throws `BleProtocolError` on invalid input. */
export function encodeAdvertisement(input: EncodeInput): Uint8Array {
  const version = input.protocolVersion ?? BLE_PROTOCOL_VERSION;
  if (version < 0 || version > 15) {
    throw new BleProtocolError('unsupported_version', `protocol version ${version} is not 0..15`);
  }

  const peerBytes = parseHexField(input.peerId, PEER_ID_BYTES, 'invalid_peer_id');
  const avatarBytes = parseHexField(input.avatarId, 2, 'invalid_avatar_id');

  const tagBytes = utf8TruncateBytes(input.displayTag ?? '', MAX_DISPLAY_TAG_BYTES);
  const frame = new Uint8Array(TAG_OFFSET + tagBytes.length + 1);

  const statusCode = STATUS_TO_CODE[input.status] ?? 0;
  frame[HEADER_OFFSET] = ((version & 0x0f) << 4) | ((statusCode & 0x03) << 2);

  const eventCode = input.eventCode & 0xffff;
  frame[EVENT_CODE_OFFSET] = (eventCode >> 8) & 0xff;
  frame[EVENT_CODE_OFFSET + 1] = eventCode & 0xff;

  for (let i = 0; i < PEER_ID_BYTES; i++) frame[PEER_ID_OFFSET + i] = peerBytes[i];

  frame[PROFILE_VERSION_OFFSET] = input.profileVersion & 0xff;
  frame[AVATAR_ID_OFFSET] = avatarBytes[0];
  frame[AVATAR_ID_OFFSET + 1] = avatarBytes[1];
  frame[CAPABILITIES_OFFSET] = encodeCapabilities(input.capabilities);
  frame[TAG_LENGTH_OFFSET] = tagBytes.length;
  frame.set(tagBytes, TAG_OFFSET);
  frame[TAG_OFFSET + tagBytes.length] = crc8(frame, 0, TAG_OFFSET + tagBytes.length);

  if (frame.length > MAX_PAYLOAD_BYTES) {
    // Unreachable with MAX_DISPLAY_TAG_BYTES = 8, but the invariant is worth asserting:
    // an oversized frame is silently dropped by some Android radios rather than rejected.
    throw new BleProtocolError(
      'too_long',
      `frame is ${frame.length} bytes, budget is ${MAX_PAYLOAD_BYTES}`,
    );
  }
  return frame;
}

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

/** Parse an advertisement frame. Throws `BleProtocolError` on malformed input. */
export function decodeAdvertisement(bytes: Uint8Array): BleAdvertisement {
  if (bytes.length < MIN_FRAME_BYTES) {
    throw new BleProtocolError(
      'too_short',
      `frame is ${bytes.length} bytes, minimum is ${MIN_FRAME_BYTES}`,
    );
  }
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new BleProtocolError(
      'too_long',
      `frame is ${bytes.length} bytes, budget is ${MAX_PAYLOAD_BYTES}`,
    );
  }

  const header = bytes[HEADER_OFFSET];
  const protocolVersion = (header >> 4) & 0x0f;
  if (protocolVersion !== BLE_PROTOCOL_VERSION) {
    // Forward compatibility: an unknown major version is dropped rather than
    // guessed at, so a future layout change can never render as garbage.
    throw new BleProtocolError(
      'unsupported_version',
      `protocol version ${protocolVersion} is not supported (this build speaks v${BLE_PROTOCOL_VERSION})`,
    );
  }

  const tagLength = bytes[TAG_LENGTH_OFFSET];
  if (tagLength > MAX_DISPLAY_TAG_BYTES) {
    throw new BleProtocolError(
      'bad_length_field',
      `displayTag length ${tagLength} exceeds ${MAX_DISPLAY_TAG_BYTES}`,
    );
  }

  const crcOffset = TAG_OFFSET + tagLength;
  if (bytes.length < crcOffset + 1) {
    throw new BleProtocolError(
      'bad_length_field',
      `declared displayTag length ${tagLength} overruns a ${bytes.length}-byte frame`,
    );
  }

  const expected = crc8(bytes, 0, crcOffset);
  if (bytes[crcOffset] !== expected) {
    throw new BleProtocolError(
      'bad_crc',
      `crc mismatch: frame says 0x${bytes[crcOffset].toString(16)}, computed 0x${expected.toString(16)}`,
    );
  }

  const statusCode = (header >> 2) & 0x03;

  return {
    protocolVersion,
    eventCode: (bytes[EVENT_CODE_OFFSET] << 8) | bytes[EVENT_CODE_OFFSET + 1],
    peerId: bytesToHex(bytes.slice(PEER_ID_OFFSET, PEER_ID_OFFSET + PEER_ID_BYTES)),
    profileVersion: bytes[PROFILE_VERSION_OFFSET],
    avatarId: bytesToHex(bytes.slice(AVATAR_ID_OFFSET, AVATAR_ID_OFFSET + 2)),
    displayTag: utf8Decode(bytes.slice(TAG_OFFSET, TAG_OFFSET + tagLength)),
    status: CODE_TO_STATUS[statusCode],
    capabilities: decodeCapabilities(bytes[CAPABILITIES_OFFSET]),
  };
}

/** Non-throwing decode. Returns `null` for anything that is not a valid frame. */
export function tryDecodeAdvertisement(bytes: Uint8Array): BleAdvertisement | null {
  try {
    return decodeAdvertisement(bytes);
  } catch {
    return null;
  }
}

/**
 * Cheap pre-filter applied before a full decode.
 *
 * In a dense hall the radio delivers thousands of packets per minute; checking
 * two bytes rejects other events' traffic before we pay for CRC + UTF-8.
 */
export function matchesEvent(bytes: Uint8Array, eventCode: number): boolean {
  if (bytes.length < MIN_FRAME_BYTES) return false;
  if (((bytes[HEADER_OFFSET] >> 4) & 0x0f) !== BLE_PROTOCOL_VERSION) return false;
  const code = (bytes[EVENT_CODE_OFFSET] << 8) | bytes[EVENT_CODE_OFFSET + 1];
  return code === (eventCode & 0xffff);
}

/** Derive the 16-bit BLE event discriminator from an event id. */
export function eventCodeFromId(eventId: string): number {
  // FNV-1a folded to 16 bits. Collisions across unrelated events are possible
  // and harmless: the full event id is re-checked against the local cache
  // before a peer is ever rendered.
  let hash = 0x811c9dc5;
  for (let i = 0; i < eventId.length; i++) {
    hash ^= eventId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ((hash >>> 16) ^ (hash & 0xffff)) & 0xffff;
}
