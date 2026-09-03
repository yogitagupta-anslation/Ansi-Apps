export type PacketType =
  | 'HELLO'
  | 'HELLO_ACK'
  | 'MESSAGE'
  | 'ACK'
  /** Closes the mutual authentication: initiator answers the responder's challenge. */
  | 'HELLO_CONFIRM'
  /** Shares a group definition so the recipient can join the conversation. */
  | 'GROUP_INVITE';

/**
 * Application-level packet. This is the unit the MessageRouter deals with.
 * The wire encoding is entirely owned by PacketCodec — nothing outside that module
 * may assume JSON, so the codec can be swapped for CBOR/protobuf later.
 */
export interface Packet<P = unknown> {
  version: number;
  /** UUIDv4. Deduplication key and ACK correlation id. */
  id: string;
  type: PacketType;
  /**
   * Who created the packet. Immutable end to end.
   *
   * Distinct from senderId because once relaying exists they diverge: in A -> B -> C the
   * packet C receives has originId A but senderId B. Carrying both now means the wire
   * format does not have to change when Phase 2 lands, and a receiver can always
   * attribute a message to its true author rather than to the last hop.
   */
  originId: string;
  /** Who transmitted THIS hop. Equal to originId on a direct link. */
  senderId: string;
  /** A peerId, or BROADCAST_ID. */
  destinationId: string;
  /**
   * Monotonically increasing per sender, stamped by MessageRouter on the way out.
   *
   * This is what makes replay protection independent of memory: the receiver keeps a
   * high-water mark per sender, so a captured packet stays old permanently instead of
   * becoming new again once its id falls out of the seen-id cache.
   */
  seq: number;
  /**
   * The SENDER's clock at the moment it built the packet.
   *
   * A claim, not a fact — there is no shared time source over BLE and nothing stops a
   * peer's clock being wrong or deliberately set. Never order or group by this; use the
   * locally observed `receivedAt` on ChatMessage instead.
   */
  timestamp: number;
  /** Remaining hops. Decremented by each relay; 0 means do not forward. */
  ttl: number;
  /** Hops already taken. 0 straight from the origin. Increments as ttl decrements. */
  hopCount: number;
  payload: P;
}

export interface HelloPayload {
  protocolVersion: number;
  /** Oldest version the sender will accept, so both floors can be compared. */
  minProtocolVersion: number;
  /** Commitment to publicKey: peerId === sha256(publicKey)[:16]. */
  peerId: string;
  /** Ed25519 public key, hex. */
  publicKey: string;
  /** Fresh random value the responder must sign, proving liveness. */
  challenge: string;
  displayName: string;
  /**
   * What this peer is interested in.
   *
   * Optional on the wire: a build without a profile still interoperates, it just has
   * nothing to match on. Never trusted as-is — the receiver sanitises and bounds it,
   * because every byte of it is chosen by the other phone.
   */
  interests?: string[];
  capabilities: Record<string, boolean>;
  /**
   * X25519 public key, hex — fresh for this link, never the identity key.
   *
   * Covered by the Ed25519 signature exchanged later in the handshake, which is what
   * makes substituting it detectable. A peer that omits it cannot establish an encrypted
   * session and is refused rather than silently downgraded to plaintext.
   */
  ephemeralKey: string;
}

export interface HelloAckPayload extends HelloPayload {
  /** Version the responder settled on, echoed so both ends agree explicitly. */
  agreedVersion: number;
  /** Signature over the initiator's challenge, proving ownership of publicKey. */
  signature: string;
}

/** Third leg: the initiator answers the responder's challenge. */
export interface HelloConfirmPayload {
  peerId: string;
  signature: string;
}

export interface MessagePayload {
  text: string;
  /**
   * Position of this message within this conversation, counted by its author.
   *
   * `seq` is per sender across everything, so a gap in it says only "something was
   * missed", not "you missed a message in this chat". This one is per conversation, so a
   * jump from 7 to 9 means exactly one message of this conversation never arrived — which
   * is what the receiver can actually show. Survives a reconnect, because it is derived
   * from stored history rather than from link state.
   */
  convSeq?: number;
  /**
   * Set when this is one copy of a group fan-out.
   *
   * The packet is still addressed to an individual member, so routing, ACKs and
   * deduplication are unchanged — the group id only tells the receiver which
   * conversation to file it under.
   */
  groupId?: string;
}

export interface GroupInvitePayload {
  group: {
    id: string;
    name: string;
    members: string[];
    createdAt: number;
    createdBy: string;
  };
}

export interface AckPayload {
  /** The packet id being acknowledged. */
  ackFor: string;
}
