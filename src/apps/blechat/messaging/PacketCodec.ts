import type {Packet, PacketType} from '../types/Packet';
import type {LinkId} from '../types/BLE';
import {utf8Decode, utf8Encode} from '../utils/bytes';
import {PROTOCOL_VERSION} from '../config/constants';
import type {SessionRegistry} from '../crypto/SessionRegistry';
import {SessionCryptoError} from '../crypto/SessionCrypto';

/**
 * The single boundary between the packet model and its wire representation.
 *
 * Everything above this interface deals in Packet objects. Replacing JSON with
 * CBOR/protobuf/a binary layout means adding one implementation here and nothing else.
 *
 * `linkId` is passed in because encryption keys are per-link: the codec cannot know which
 * session a packet belongs to without being told.
 */
export interface PacketCodec {
  readonly name: string;
  encode(packet: Packet, linkId?: LinkId): Uint8Array;
  decode(bytes: Uint8Array, linkId?: LinkId): Packet;
}

export class PacketDecodeError extends Error {}

/**
 * The three packets that establish a session, and therefore the only three that can
 * legitimately travel before one exists.
 */
const HANDSHAKE_TYPES: ReadonlySet<PacketType> = new Set<PacketType>([
  'HELLO',
  'HELLO_ACK',
  'HELLO_CONFIRM',
]);

/** JSON always starts with '{'; an encrypted frame starts with its version byte. */
const JSON_FIRST_BYTE = 0x7b;

/** The inner representation. Never reaches the air on its own once a session exists. */
export class JsonPacketCodec implements PacketCodec {
  readonly name = 'json/v1';

  encode(packet: Packet): Uint8Array {
    return utf8Encode(JSON.stringify(packet));
  }

  decode(bytes: Uint8Array): Packet {
    let raw: unknown;
    try {
      raw = JSON.parse(utf8Decode(bytes));
    } catch (err) {
      throw new PacketDecodeError(`malformed JSON: ${String(err)}`);
    }
    return validate(raw);
  }
}

/**
 * Encrypts everything that is not part of establishing the encryption.
 *
 * Two rules, and the second is the one that actually matters:
 *
 *   1. Handshake packets go in the clear, because the keys they negotiate do not exist
 *      yet. They carry no message content — only public keys, nonces and signatures.
 *
 *   2. Once a link has a session, a plaintext frame on that link is REJECTED rather than
 *      read. Without this the layer would be decorative: an attacker could simply strip
 *      the encryption and send plain JSON, and a codec that helpfully parsed it would
 *      hand them exactly what the encryption was there to prevent. The same rule in
 *      reverse — refusing to emit a non-handshake packet with no session — means a bug
 *      elsewhere fails loudly instead of quietly transmitting cleartext.
 */
export class SecurePacketCodec implements PacketCodec {
  readonly name = 'chacha20poly1305/x25519/v1';
  private readonly inner = new JsonPacketCodec();

  constructor(private readonly sessions: SessionRegistry) {}

  encode(packet: Packet, linkId?: LinkId): Uint8Array {
    const plaintext = this.inner.encode(packet);
    if (HANDSHAKE_TYPES.has(packet.type)) {
      return plaintext;
    }
    const cipher = linkId ? this.sessions.get(linkId) : undefined;
    if (!cipher) {
      throw new PacketDecodeError(
        `refusing to send ${packet.type} on ${linkId ?? 'unknown link'} with no ` +
          'encrypted session',
      );
    }
    return cipher.seal(plaintext);
  }

  decode(bytes: Uint8Array, linkId?: LinkId): Packet {
    if (bytes.length === 0) {
      throw new PacketDecodeError('empty frame');
    }
    const cipher = linkId ? this.sessions.get(linkId) : undefined;
    const looksPlaintext = bytes[0] === JSON_FIRST_BYTE;

    if (cipher && looksPlaintext) {
      throw new PacketDecodeError(
        'plaintext frame on an encrypted link, rejected as a downgrade attempt',
      );
    }

    if (!cipher) {
      // No session yet: the only thing that may arrive is a handshake packet.
      if (!looksPlaintext) {
        throw new PacketDecodeError(
          'encrypted frame on a link with no session; cannot decrypt',
        );
      }
      const packet = this.inner.decode(bytes);
      if (!HANDSHAKE_TYPES.has(packet.type)) {
        throw new PacketDecodeError(
          `${packet.type} arrived in plaintext before a session existed, rejected`,
        );
      }
      return packet;
    }

    let plaintext: Uint8Array;
    try {
      plaintext = cipher.open(bytes);
    } catch (err) {
      if (err instanceof SessionCryptoError) {
        throw new PacketDecodeError(err.message);
      }
      throw err;
    }
    return this.inner.decode(plaintext);
  }
}

const VALID_TYPES = new Set([
  'HELLO',
  'HELLO_ACK',
  'HELLO_CONFIRM',
  'MESSAGE',
  'ACK',
  'GROUP_INVITE',
]);

function validate(raw: unknown): Packet {
  if (typeof raw !== 'object' || raw === null) {
    throw new PacketDecodeError('packet is not an object');
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.version !== 'number') {
    throw new PacketDecodeError('missing version');
  }
  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new PacketDecodeError('missing id');
  }
  if (typeof p.type !== 'string' || !VALID_TYPES.has(p.type)) {
    throw new PacketDecodeError(`unknown type ${String(p.type)}`);
  }
  if (typeof p.senderId !== 'string' || p.senderId.length === 0) {
    throw new PacketDecodeError('missing senderId');
  }
  if (typeof p.destinationId !== 'string') {
    throw new PacketDecodeError('missing destinationId');
  }
  if (typeof p.ttl !== 'number') {
    throw new PacketDecodeError('missing ttl');
  }
  // Required, not defaulted. A packet with no sequence number is a packet with no replay
  // protection, and quietly substituting a value would hand an attacker exactly the
  // bypass the counter exists to close.
  if (typeof p.seq !== 'number' || !Number.isInteger(p.seq) || p.seq <= 0) {
    throw new PacketDecodeError('missing or invalid seq');
  }

  return {
    version: p.version,
    id: p.id,
    type: p.type as Packet['type'],
    // originId and hopCount were added for mesh. Tolerate their absence so a peer on an
    // older build still interoperates: with no relaying, origin IS the sender.
    originId: typeof p.originId === 'string' && p.originId ? p.originId : p.senderId,
    senderId: p.senderId,
    destinationId: p.destinationId,
    seq: p.seq,
    // The sender's claim about its own clock. Kept verbatim; never trusted for ordering.
    timestamp: typeof p.timestamp === 'number' ? p.timestamp : 0,
    ttl: p.ttl,
    hopCount: typeof p.hopCount === 'number' ? p.hopCount : 0,
    payload: p.payload,
  };
}

export function isProtocolCompatible(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
