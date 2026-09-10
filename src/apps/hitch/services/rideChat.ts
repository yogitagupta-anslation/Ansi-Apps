import {MessageQueue} from '../../blechat/messaging/MessageQueue';
import type {ChatMessage, MessageStatus} from '../../blechat/types/Message';
import {
  decodeMessage,
  encodeMessage,
  newRequestId,
  type RideChatMessage,
} from '../ble/protocol';

/**
 * Chat between the two people on a ride.
 *
 * BUILT ON BLE CHAT'S ARCHITECTURE RATHER THAN BESIDE IT, which was the instruction and is
 * also the right call. Two pieces are imported outright rather than rewritten:
 *
 *   types/Message.ts       the ChatMessage model, including the delivery states
 *   messaging/MessageQueue the outbox, with its per-peer cap and expiry
 *
 * Both have no dependencies worth dragging — the model imports nothing at all — and both
 * encode decisions that took real debugging to get right. The delivery-state distinction
 * in particular: SENT means a write completed on this phone, DELIVERED means the other
 * phone acknowledged it. On a link that drops mid-sentence those are different facts, and
 * a chat that collapses them shows a tick for a message nobody received.
 *
 * WHAT IS NOT IMPORTED, and why. BLE Chat's MessageService is not reusable here: it sits
 * on its MessageRouter, which sits on its PeerManager, its identity and its session
 * crypto. Pulling that in would mean standing up a second BLE Chat inside Hitch to send
 * "near the gate". The transport underneath is Hitch's own already-open ride link, which
 * is a strictly simpler thing — one peer, one conversation, for the length of one ride.
 *
 * Fragmentation is also deliberately not borrowed. It exists in BLE Chat because a chat
 * message there is unbounded; a ride chat line is capped at 280 characters and fits in one
 * frame, so reassembly, ordering and retransmission are all machinery for a problem this
 * does not have.
 */

/** How a message is sent. Supplied by whichever side of the link this is running on. */
export type SendFrame = (base64: string) => Promise<boolean>;

type Listener = (messages: ChatMessage[]) => void;

/**
 * One conversation, for the length of one ride.
 *
 * Created when a ride is confirmed and disposed when it ends. There is no history across
 * rides and no store to persist to: the conversation is about getting two people to the
 * same kerb, and it stops being useful the moment they are.
 */
export class RideChat {
  private messages: ChatMessage[] = [];
  private queue = new MessageQueue();
  private send: SendFrame | null = null;
  private connected = false;

  private listeners = new Set<Listener>();

  constructor(
    /** Who we are talking to. Used as the queue's peer key and the conversation id. */
    private readonly peerId: string,
  ) {}

  /**
   * Watch the conversation.
   *
   * A subscription rather than a single callback handed in at construction: the screen
   * mounts and unmounts while the ride continues, and a conversation that belongs to the
   * ride should not be rebuilt every time somebody backs out of it to look at the map.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getMessages());
    return () => this.listeners.delete(listener);
  }

  /**
   * Attach a live link, or detach when it drops.
   *
   * Attaching flushes whatever was typed while it was down — which is the single most
   * useful behaviour a Bluetooth chat can have, and the reason the outbox is imported
   * rather than skipped. Somebody typing "I'm at the gate" as the link drops expects it
   * to arrive when it comes back, not to be lost or to need retyping.
   */
  setLink(send: SendFrame | null): void {
    this.send = send;
    this.connected = !!send;
    if (send) {
      void this.flush();
    } else {
      // Anything mid-flight when the link went is not in flight any more.
      for (const message of this.messages) {
        if (message.status === 'sending') {
          this.setStatus(message.id, 'pending');
        }
      }
    }
    this.emit();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Number waiting for the link to come back. Shown in the composer. */
  get queuedCount(): number {
    return this.queue.countFor(this.peerId);
  }

  /**
   * Say something.
   *
   * Always appended locally first, then sent. A message that appears only once the radio
   * has accepted it makes the app feel broken on a weak link — and it is not a lie,
   * because the bubble carries its own state until it is actually delivered.
   */
  async post(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const now = Date.now();
    const message: ChatMessage = {
      id: newRequestId(),
      conversationId: this.peerId,
      originId: 'me',
      senderId: 'me',
      destinationId: this.peerId,
      text: trimmed,
      timestamp: now,
      receivedAt: now,
      direction: 'outgoing',
      status: 'pending',
      protocolVersion: 1,
      ttl: 1,
      hopCount: 0,
      retryCount: 0,
    };
    this.messages.push(message);
    this.emit();

    if (!this.connected) {
      this.queue.enqueue({
        messageId: message.id,
        peerId: this.peerId,
        text: trimmed,
        queuedAt: now,
        attempts: 0,
      });
      return;
    }
    await this.transmit(message);
  }

  private async transmit(message: ChatMessage): Promise<void> {
    if (!this.send) {
      return;
    }
    this.setStatus(message.id, 'sending');
    const frame = encodeMessage({
      t: 'CHAT',
      v: 1,
      id: message.id,
      text: message.text,
      at: message.timestamp,
    });
    try {
      const ok = await this.send(frame);
      // "sent" means the write completed here — not that anybody read it. The ACK that
      // arrives later is what turns it into "received".
      this.setStatus(message.id, ok ? 'sent' : 'failed');
      if (ok) {
        this.queue.remove(this.peerId, message.id);
      }
    } catch {
      this.setStatus(message.id, 'failed');
    }
  }

  /** Everything the outbox is holding, in the order it was written. */
  private async flush(): Promise<void> {
    for (const queued of this.queue.pending(this.peerId)) {
      const message = this.messages.find(m => m.id === queued.messageId);
      if (message) {
        await this.transmit(message);
      } else {
        this.queue.remove(this.peerId, queued.messageId);
      }
    }
  }

  /**
   * A frame off the link.
   *
   * Returns a reply to send back, or null. Kept as a return value rather than sending
   * from in here so the caller owns the link in both directions — this class never
   * assumes it can write.
   */
  receive(base64: string): string | null {
    const message = decodeMessage(base64);
    if (!message) {
      return null;
    }

    if (message.t === 'ACK') {
      this.setStatus(message.id, 'received');
      return null;
    }

    if (message.t !== 'CHAT') {
      return null;
    }

    // A repeat of something already held is a retransmission, not a second message.
    if (this.messages.some(m => m.id === message.id)) {
      return encodeMessage({t: 'ACK', v: 1, id: message.id});
    }

    const chat = message as RideChatMessage;
    this.messages.push({
      id: chat.id,
      conversationId: this.peerId,
      originId: this.peerId,
      senderId: this.peerId,
      destinationId: 'me',
      text: chat.text,
      // Their clock is a claim; ours is what the thread is ordered by. Same reasoning as
      // BLE Chat's, and the reason both fields exist on the model.
      timestamp: chat.at,
      receivedAt: Date.now(),
      direction: 'incoming',
      status: 'received',
      protocolVersion: chat.v,
      ttl: 1,
      hopCount: 0,
      retryCount: 0,
    });
    this.emit();
    return encodeMessage({t: 'ACK', v: 1, id: chat.id});
  }

  private setStatus(id: string, status: MessageStatus): void {
    const message = this.messages.find(m => m.id === id);
    if (!message || message.status === status) {
      return;
    }
    message.status = status;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getMessages();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  dispose(): void {
    this.listeners.clear();
    this.queue.clear();
    this.messages = [];
    this.send = null;
    this.connected = false;
  }
}

/**
 * The four things people actually say while waiting at a kerb.
 *
 * One tap each, because the person tapping is often holding a bag, a helmet, or looking
 * for a vehicle. "Call" is not a message — it is the escape hatch for when typing has
 * stopped working, and it belongs beside the others because that is where somebody
 * reaches for it.
 */
export const QUICK_REPLIES = [
  "I'm here",
  'Where are you?',
  'Wait 2 mins',
] as const;
