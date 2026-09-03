export type MessageDirection = 'outgoing' | 'incoming';

/**
 * Delivery state. Every transition is driven by a real transport event —
 * never by a timer that pretends progress happened.
 *
 *  pending  -> queued in the app, no link yet
 *  sending  -> handed to the BLE transport, write in flight
 *  sent     -> the BLE write/notify completed successfully
 *  received -> the remote peer returned an application-level ACK
 *  failed   -> the write threw, or no ACK arrived within ACK_TIMEOUT_MS
 */
export type MessageStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'received'
  | 'failed';

export interface ChatMessage {
  /** Globally unique; doubles as the deduplication key and the ACK correlation id. */
  id: string;
  /** peerId of the conversation partner (not necessarily the sender). */
  conversationId: string;
  /** True author. Differs from the last hop once relaying exists. */
  originId: string;
  senderId: string;
  destinationId: string;
  text: string;
  /**
   * The SENDER's clock when it composed the message.
   *
   * For an incoming message this is a claim and nothing more: there is no shared time
   * source over BLE, phone clocks drift, and a peer can simply set its clock to whatever
   * it likes. Kept because it is genuine metadata — the author's view of when they wrote
   * it — but never used to order or group anything.
   */
  timestamp: number;
  /**
   * OUR clock when we took delivery. This is what the UI shows and sorts on.
   *
   * Locally observed, so it is monotonic with respect to everything else in the app and
   * cannot be manipulated by a peer. For an outgoing message it is simply when we
   * composed it, which makes both directions directly comparable.
   */
  receivedAt: number;
  /**
   * receivedAt - timestamp, for incoming messages only.
   *
   * Surfaced rather than hidden: a peer whose clock is hours off is worth showing in the
   * diagnostics, and it explains why the displayed time differs from the sender's.
   */
  clockSkewMs?: number;
  direction: MessageDirection;
  status: MessageStatus;
  /** Protocol version this message was created under. */
  protocolVersion: number;
  /** TTL the packet was sent with — the hop budget it had available. */
  ttl: number;
  /** Hops taken to reach us. 0 on a direct link. */
  hopCount: number;
  /** Manual or automatic resend attempts so far. */
  retryCount: number;

  /**
   * Position within this conversation, counted by the author.
   *
   * Lets the receiver notice that a message never arrived: consecutive messages from one
   * author differ by exactly one, so a jump is a gap. Needed because BLE links drop
   * mid-conversation routinely, and a silent hole in a chat is worse than a marked one.
   */
  convSeq?: number;
  /**
   * How many messages of this conversation went missing immediately before this one.
   *
   * Set only when a gap was actually observed. Drives the "N messages missing" marker in
   * the chat, so loss is visible instead of leaving the conversation quietly wrong.
   */
  missedBefore?: number;

  /** Set when the message belongs to a group conversation. */
  groupId?: string;
  /**
   * peerIds that have acknowledged this message.
   *
   * A group message is one ChatMessage fanned out to N recipients, so delivery is not a
   * single boolean — "2/3 delivered" needs to know exactly who has it.
   */
  deliveredTo?: string[];
  /** How many peers this message was addressed to. 1 for a direct message. */
  recipientCount?: number;
  /**
   * Fragments actually written to the radio so far, for a message that needed more than
   * one. Only meaningful while `status === 'sending'`; cleared the moment the status
   * moves on, so the UI never shows a stale count next to a bubble that already resolved.
   */
  fragmentProgress?: {sent: number; total: number};
}
