import {QUEUE_EXPIRY_MS, QUEUE_MAX_PER_PEER} from '../config/constants';
import {logger} from '../utils/logger';
import {shortId} from '../utils/id';

const TAG = 'Queue';

export interface QueuedMessage {
  messageId: string;
  peerId: string;
  text: string;
  queuedAt: number;
  attempts: number;
  /**
   * Set when this is one recipient's copy of a group fan-out.
   *
   * Must survive the queue: flushing it without the group id would deliver the message
   * into a one-to-one conversation with the sender instead of the group.
   */
  groupId?: string;
  /**
   * The position this message was composed at, within its conversation.
   *
   * Assigned when the user hit send, not when it finally goes out. A message that waited
   * in the outbox for an hour still belongs where it was written — renumbering it on
   * delivery would leave a permanent hole in the recipient's view of the conversation.
   */
  convSeq?: number;
}

/**
 * Outbox for messages that could not be transmitted yet.
 *
 * A peer walking out of range mid-conversation is the normal case for BLE, not an
 * exception. Failing the message outright loses it; pretending it was sent is a lie.
 * Queuing keeps it honestly at "queued" until a real transmission happens.
 *
 * Bounded two ways so an unreachable peer cannot grow storage without limit:
 *  - at most QUEUE_MAX_PER_PEER messages per peer, oldest dropped first
 *  - anything older than QUEUE_EXPIRY_MS is expired rather than delivered days later
 */
export class MessageQueue {
  private byPeer = new Map<string, QueuedMessage[]>();

  /** Returns the ids of any messages evicted to make room. */
  enqueue(message: QueuedMessage): string[] {
    const list = this.byPeer.get(message.peerId) ?? [];
    if (list.some(m => m.messageId === message.messageId)) {
      return [];
    }
    list.push(message);

    const evicted: string[] = [];
    while (list.length > QUEUE_MAX_PER_PEER) {
      const dropped = list.shift();
      if (dropped) {
        evicted.push(dropped.messageId);
      }
    }

    this.byPeer.set(message.peerId, list);
    logger.info(
      TAG,
      `queued ${shortId(message.messageId)} for ${shortId(message.peerId)} ` +
        `(${list.length} waiting)`,
    );
    return evicted;
  }

  /** Everything waiting for a peer, oldest first. */
  pending(peerId: string): QueuedMessage[] {
    return [...(this.byPeer.get(peerId) ?? [])];
  }

  remove(peerId: string, messageId: string): void {
    const list = this.byPeer.get(peerId);
    if (!list) {
      return;
    }
    const next = list.filter(m => m.messageId !== messageId);
    if (next.length === 0) {
      this.byPeer.delete(peerId);
    } else {
      this.byPeer.set(peerId, next);
    }
  }

  /** Drop and return anything too old to be worth delivering. */
  expire(now = Date.now()): QueuedMessage[] {
    const expired: QueuedMessage[] = [];
    for (const [peerId, list] of this.byPeer) {
      const keep: QueuedMessage[] = [];
      for (const message of list) {
        if (now - message.queuedAt > QUEUE_EXPIRY_MS) {
          expired.push(message);
        } else {
          keep.push(message);
        }
      }
      if (keep.length === 0) {
        this.byPeer.delete(peerId);
      } else {
        this.byPeer.set(peerId, keep);
      }
    }
    if (expired.length > 0) {
      logger.warn(TAG, `${expired.length} queued message(s) expired undelivered`);
    }
    return expired;
  }

  countFor(peerId: string): number {
    return this.byPeer.get(peerId)?.length ?? 0;
  }

  get total(): number {
    let n = 0;
    for (const list of this.byPeer.values()) {
      n += list.length;
    }
    return n;
  }

  get peerIds(): string[] {
    return Array.from(this.byPeer.keys());
  }

  /** Flat, serialisable form for persistence. */
  snapshot(): QueuedMessage[] {
    const out: QueuedMessage[] = [];
    for (const list of this.byPeer.values()) {
      out.push(...list);
    }
    return out;
  }

  hydrate(messages: QueuedMessage[]): void {
    this.byPeer.clear();
    for (const message of messages) {
      const list = this.byPeer.get(message.peerId) ?? [];
      list.push(message);
      this.byPeer.set(message.peerId, list);
    }
    for (const list of this.byPeer.values()) {
      list.sort((a, b) => a.queuedAt - b.queuedAt);
    }
  }

  clear(): void {
    this.byPeer.clear();
  }
}
