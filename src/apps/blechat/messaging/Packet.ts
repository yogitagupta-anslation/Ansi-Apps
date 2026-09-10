import {
  DEFAULT_TTL,
  MIN_COMPATIBLE_VERSION,
  PROTOCOL_VERSION,
} from '../config/constants';
import {sanitiseInterests} from '../config/interests';
import {sanitiseLanguages} from '../config/languages';
import type {Capabilities} from './Negotiation';
import type {
  AckPayload,
  GroupInvitePayload,
  HelloAckPayload,
  HelloConfirmPayload,
  HelloPayload,
  MessagePayload,
  Packet,
  PacketType,
} from '../types/Packet';
import {uuidv4} from '../utils/id';

interface BuildOptions {
  type: PacketType;
  senderId: string;
  destinationId: string;
  payload: unknown;
  ttl?: number;
  /** Reuse an existing id — used when a chat message id must equal its packet id. */
  id?: string;
  /** Defaults to senderId. Only differs when relaying somebody else's packet. */
  originId?: string;
  hopCount?: number;
}

export function buildPacket(opts: BuildOptions): Packet {
  return {
    version: PROTOCOL_VERSION,
    id: opts.id ?? uuidv4(),
    type: opts.type,
    // A freshly built packet is always at its origin, hop zero.
    originId: opts.originId ?? opts.senderId,
    senderId: opts.senderId,
    destinationId: opts.destinationId,
    // Placeholder. MessageRouter stamps the real value from its persistent counter as
    // the packet goes out, so there is exactly one source of sequence numbers no matter
    // which builder produced the packet.
    seq: 0,
    timestamp: Date.now(),
    ttl: opts.ttl ?? DEFAULT_TTL,
    hopCount: opts.hopCount ?? 0,
    payload: opts.payload,
  };
}

/**
 * Produce the packet a relay would transmit onward: same id and origin, one more hop,
 * one less TTL, and this node as the sender.
 *
 * Phase 2 will call this from MessageRouter. It exists now so the hop accounting is
 * defined and testable before any forwarding is switched on.
 *
 * `seq` is deliberately left as the origin's here and re-stamped on send: it is scoped to
 * whoever transmits the hop, and the relay is the sender of this one.
 */
export function buildRelayed(packet: Packet, relayPeerId: string): Packet {
  return {
    ...packet,
    senderId: relayPeerId,
    ttl: packet.ttl - 1,
    hopCount: packet.hopCount + 1,
  };
}

export function buildHello(
  self: {
    peerId: string;
    displayName: string;
    publicKey: string;
    interests?: string[];
    languages?: string[];
    screenshotPolicy?: string;
  },
  capabilities: Capabilities,
  challenge: string,
  ephemeralKey: string,
): Packet<HelloPayload> {
  return buildPacket({
    type: 'HELLO',
    senderId: self.peerId,
    // We do not yet know who is on the other end of the link.
    destinationId: '',
    ttl: 1,
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_COMPATIBLE_VERSION,
      peerId: self.peerId,
      publicKey: self.publicKey,
      challenge,
      displayName: self.displayName,
      // Bounded on the way OUT as well as on the way in. The receiver sanitises what it
      // stores, but that happens after reassembly — an unbounded profile would already
      // have been fragmented across the air, and past the reassembly caps it stalls the
      // handshake entirely. Capping here means we can never do that to a peer.
      interests: sanitiseInterests(self.interests),
      languages: sanitiseLanguages(self.languages),
      // Optional and additive, exactly like interests: a build that does not send it is
      // read as "no opinion", and the receiver's own choice stands alone. Older peers are
      // unaffected — they simply ignore a field they do not know.
      screenshotPolicy: self.screenshotPolicy,
      capabilities: {...capabilities},
      ephemeralKey,
    },
  }) as Packet<HelloPayload>;
}

export function buildHelloAck(
  self: {
    peerId: string;
    displayName: string;
    publicKey: string;
    interests?: string[];
    languages?: string[];
    screenshotPolicy?: string;
  },
  destinationId: string,
  capabilities: Capabilities,
  agreedVersion: number,
  /** Our own challenge, which the initiator must answer. */
  challenge: string,
  /** Our signature over the initiator's challenge. */
  signature: string,
  ephemeralKey: string,
): Packet<HelloAckPayload> {
  return buildPacket({
    type: 'HELLO_ACK',
    senderId: self.peerId,
    destinationId,
    ttl: 1,
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      minProtocolVersion: MIN_COMPATIBLE_VERSION,
      agreedVersion,
      peerId: self.peerId,
      publicKey: self.publicKey,
      challenge,
      signature,
      displayName: self.displayName,
      interests: sanitiseInterests(self.interests),
      languages: sanitiseLanguages(self.languages),
      screenshotPolicy: self.screenshotPolicy,
      capabilities: {...capabilities},
      ephemeralKey,
    },
  }) as Packet<HelloAckPayload>;
}

export function buildHelloConfirm(
  self: {peerId: string},
  destinationId: string,
  signature: string,
): Packet<HelloConfirmPayload> {
  return buildPacket({
    type: 'HELLO_CONFIRM',
    senderId: self.peerId,
    destinationId,
    ttl: 1,
    payload: {peerId: self.peerId, signature},
  }) as Packet<HelloConfirmPayload>;
}

export function buildMessage(
  senderId: string,
  destinationId: string,
  text: string,
  messageId: string,
  groupId?: string,
  convSeq?: number,
): Packet<MessagePayload> {
  const payload: MessagePayload = {text};
  if (groupId) {
    payload.groupId = groupId;
  }
  if (convSeq !== undefined) {
    payload.convSeq = convSeq;
  }
  return buildPacket({
    type: 'MESSAGE',
    senderId,
    destinationId,
    id: messageId,
    payload,
  }) as Packet<MessagePayload>;
}

export function buildGroupInvite(
  senderId: string,
  destinationId: string,
  group: GroupInvitePayload['group'],
): Packet<GroupInvitePayload> {
  return buildPacket({
    type: 'GROUP_INVITE',
    senderId,
    destinationId,
    ttl: 1,
    payload: {group},
  }) as Packet<GroupInvitePayload>;
}

export function buildAck(
  senderId: string,
  destinationId: string,
  ackFor: string,
): Packet<AckPayload> {
  return buildPacket({
    type: 'ACK',
    senderId,
    destinationId,
    ttl: 1,
    payload: {ackFor},
  }) as Packet<AckPayload>;
}
