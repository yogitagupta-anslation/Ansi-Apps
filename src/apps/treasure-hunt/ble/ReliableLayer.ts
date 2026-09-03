/**
 * A reliable message layer on top of BLE.
 *
 * BLE is not a socket. Notifications can be dropped when a queue overflows,
 * writes can fail transiently, frames can arrive out of order, and stacks
 * happily re-deliver the same packet. This layer turns that into something the
 * game engine can reason about:
 *
 *   - duplicate suppression   : per-peer LRU of seen messageIds
 *   - stale rejection         : per-peer high-water seq for latest-wins traffic
 *   - guaranteed delivery     : ACK + exponential backoff for critical messages
 *   - flow control            : bounded per-peer queue, oldest unreliable
 *                               message dropped first under pressure
 *
 * It knows nothing about game rules -- it moves envelopes and reports outcomes.
 */
import {RELIABILITY} from '../config/bleConfig';
import {MessageType, isLatestWins, isReliable} from '../models/messages';
import type {Envelope, GameMessage} from '../models/messages';
import {Emitter} from '../utils/emitter';
import {LruSet} from '../utils/collections';
import {createLogger} from '../utils/logger';
import {buildEnvelope, decodeEnvelope, encodeEnvelope} from './codec';

const log = createLogger('ReliableLayer');

export interface ReliableLayerEvents {
  /** A message that passed dedupe and ordering checks. */
  message: {peerId: string; message: GameMessage};
  /** A reliable message the peer never acknowledged. */
  deliveryFailed: {peerId: string; message: Envelope; attempts: number};
  /** A reliable message the peer confirmed. */
  delivered: {peerId: string; messageId: string; attempts: number; rttMs: number};
}

/** What the layer needs from whatever sits below it. */
export interface ReliableTransportAdapter {
  send(peerId: string, payload: Uint8Array): Promise<void>;
  broadcast(payload: Uint8Array, excludePeerId?: string): Promise<void>;
  getPeerIds(): string[];
}

interface PendingAck {
  envelope: Envelope;
  peerId: string;
  attempts: number;
  firstSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PeerBook {
  seenMessageIds: LruSet<string>;
  /** Highest seq applied per message type, for latest-wins traffic. */
  highWaterSeq: Map<MessageType, number>;
  queue: Array<{envelope: Envelope; reliable: boolean}>;
  draining: boolean;
  lastSendAt: number;
}

export class ReliableLayer {
  readonly events = new Emitter<ReliableLayerEvents>();

  private peers = new Map<string, PeerBook>();
  private pending = new Map<string, PendingAck>();
  private disposed = false;

  constructor(
    private readonly transport: ReliableTransportAdapter,
    private localId: string,
  ) {}

  /** Adopt the identity the host assigned once a join is accepted. */
  setLocalId(localId: string): void {
    this.localId = localId;
  }

  private book(peerId: string): PeerBook {
    let book = this.peers.get(peerId);
    if (!book) {
      book = {
        seenMessageIds: new LruSet<string>(RELIABILITY.dedupeWindow),
        highWaterSeq: new Map(),
        queue: [],
        draining: false,
        lastSendAt: 0,
      };
      this.peers.set(peerId, book);
    }
    return book;
  }

  /** How many messages are waiting to go out to a peer. Diagnostics only. */
  queueDepthFor(peerId: string): number {
    return this.peers.get(peerId)?.queue.length ?? 0;
  }

  /** Forget a peer entirely -- called when a link is gone for good. */
  forgetPeer(peerId: string): void {
    this.peers.delete(peerId);
    for (const [messageId, entry] of this.pending) {
      if (entry.peerId === peerId) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        this.pending.delete(messageId);
        this.events.emit('deliveryFailed', {
          peerId,
          message: entry.envelope,
          attempts: entry.attempts,
        });
      }
    }
  }

  /**
   * Clear ordering state for a peer while keeping the peer itself.
   * Used on reconnect: the far side restarts its seq counter from scratch, so
   * keeping the old high-water mark would reject everything it sends next.
   */
  resetPeerOrdering(peerId: string): void {
    const book = this.peers.get(peerId);
    if (book) {
      book.highWaterSeq.clear();
      book.seenMessageIds.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /** Send a message to one peer. Reliable types are retried until acked. */
  send<T>(peerId: string, type: MessageType, payload: T): Envelope<T> {
    const envelope = buildEnvelope(type, this.localId, payload);
    this.enqueue(peerId, envelope, isReliable(type));
    return envelope;
  }

  /** Send to every connected peer. */
  broadcast<T>(type: MessageType, payload: T, excludePeerId?: string): Envelope<T> {
    const envelope = buildEnvelope(type, this.localId, payload);
    for (const peerId of this.transport.getPeerIds()) {
      if (peerId !== excludePeerId) {
        // Each peer gets its own retry state but shares the envelope identity,
        // so a receiver that hears it twice still de-duplicates correctly.
        this.enqueue(peerId, envelope, isReliable(type));
      }
    }
    return envelope;
  }

  private enqueue(peerId: string, envelope: Envelope, reliable: boolean): void {
    if (this.disposed) {
      return;
    }
    const book = this.book(peerId);

    /*
     * Latest-wins types supersede their own queued copy.
     *
     * GAME_STATE and PROXIMITY_UPDATE are snapshots: once a newer one exists
     * the older is worthless. Appending each tick let the queue fill with
     * ~96 obsolete snapshots, and because the queue is FIFO a reliable
     * GAME_END then had to drain behind all of them -- which is why a player
     * kept playing for ~20s after the host had already finished the match.
     *
     * Replacing in place keeps the queue bounded and lets the important
     * messages through, without touching the receive-side ordering rules.
     */
    if (isLatestWins(envelope.type)) {
      const existing = book.queue.findIndex(
        entry => entry.envelope.type === envelope.type,
      );
      if (existing >= 0) {
        book.queue[existing] = {envelope, reliable};
        void this.drain(peerId);
        return;
      }
    }

    /*
     * Reliable messages jump the queue.
     *
     * A GAME_END or TREASURE_FOUND behind a wall of position updates is a
     * match that ends late on one device. Ordering between reliable messages
     * is preserved; they simply overtake traffic that is safe to lose.
     */
    if (reliable) {
      const firstUnreliable = book.queue.findIndex(entry => !entry.reliable);
      if (firstUnreliable >= 0) {
        book.queue.splice(firstUnreliable, 0, {envelope, reliable});
        void this.drain(peerId);
        return;
      }
    }

    if (book.queue.length >= RELIABILITY.maxQueueDepth) {
      // Shed load by dropping the oldest unreliable entry. Position updates go
      // stale in 100 ms anyway; a TREASURE_FOUND must never be dropped.
      const victim = book.queue.findIndex(entry => !entry.reliable);
      if (victim >= 0) {
        const dropped = book.queue.splice(victim, 1)[0];
        log.warn(`queue full for ${peerId}; dropped ${dropped?.envelope.type}`);
      } else if (!reliable) {
        log.warn(`queue full for ${peerId}; refusing new ${envelope.type}`);
        return;
      } else {
        log.error(`queue full for ${peerId} with only reliable messages queued`);
      }
    }

    book.queue.push({envelope, reliable});
    void this.drain(peerId);
  }

  private async drain(peerId: string): Promise<void> {
    const book = this.book(peerId);
    if (book.draining) {
      return;
    }
    book.draining = true;

    try {
      while (book.queue.length > 0 && !this.disposed) {
        const entry = book.queue.shift();
        if (!entry) {
          break;
        }

        // Space writes out; hammering a link makes some stacks return errors.
        const sinceLast = Date.now() - book.lastSendAt;
        if (sinceLast < RELIABILITY.minSendIntervalMs) {
          await new Promise<void>(resolve =>
            setTimeout(() => resolve(), RELIABILITY.minSendIntervalMs - sinceLast),
          );
        }

        try {
          await this.transport.send(peerId, encodeEnvelope(entry.envelope));
          book.lastSendAt = Date.now();

          if (entry.reliable) {
            this.armRetry(peerId, entry.envelope);
          }
        } catch (err) {
          log.warn(`send to ${peerId} failed (${entry.envelope.type})`, err);
          if (entry.reliable) {
            // Let the retry timer handle it rather than spinning here.
            this.armRetry(peerId, entry.envelope);
          }
        }
      }
    } finally {
      book.draining = false;
    }
  }

  private armRetry(peerId: string, envelope: Envelope): void {
    const key = `${peerId}:${envelope.messageId}`;
    let entry = this.pending.get(key);

    if (!entry) {
      entry = {
        envelope,
        peerId,
        attempts: 1,
        firstSentAt: Date.now(),
        timer: null,
      };
      this.pending.set(key, entry);
    }

    const delayMs = Math.min(
      RELIABILITY.ackTimeoutMs * Math.pow(RELIABILITY.backoffFactor, entry.attempts - 1),
      RELIABILITY.maxBackoffMs,
    );

    entry.timer = setTimeout(() => {
      const current = this.pending.get(key);
      if (!current) {
        return;
      }

      if (current.attempts >= RELIABILITY.maxAttempts) {
        this.pending.delete(key);
        log.error(
          `giving up on ${current.envelope.type} to ${peerId} after ${current.attempts} attempts`,
        );
        this.events.emit('deliveryFailed', {
          peerId,
          message: current.envelope,
          attempts: current.attempts,
        });
        return;
      }

      current.attempts++;
      log.debug(`retrying ${current.envelope.type} to ${peerId} (attempt ${current.attempts})`);

      // Re-queue rather than sending inline, so retries respect flow control.
      const book = this.book(peerId);
      book.queue.unshift({envelope: current.envelope, reliable: true});
      void this.drain(peerId);
    }, delayMs);
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  /**
   * Feed reassembled bytes from a peer. Emits `message` only for traffic that
   * survives validation, dedupe and ordering checks.
   */
  handleIncoming(peerId: string, bytes: Uint8Array): void {
    const message = decodeEnvelope(bytes);
    if (!message) {
      log.warn(`unparseable message from ${peerId}`);
      return;
    }

    const book = this.book(peerId);

    // ACKs settle a pending delivery and are never surfaced to the game.
    if (message.type === MessageType.Ack) {
      const ackId = (message.payload as {ackId?: string}).ackId;
      if (ackId) {
        this.resolveAck(peerId, ackId);
      }
      return;
    }

    // Acknowledge before dedupe: a duplicate means our previous ACK was lost,
    // so the sender needs another one or it will keep retrying.
    if (isReliable(message.type)) {
      this.sendAck(peerId, message.messageId);
    }

    if (book.seenMessageIds.addAndCheck(message.messageId)) {
      log.debug(`duplicate ${message.type} from ${peerId} suppressed`);
      return;
    }

    if (isLatestWins(message.type)) {
      const highWater = book.highWaterSeq.get(message.type) ?? -1;
      if (message.seq <= highWater) {
        log.debug(
          `stale ${message.type} from ${peerId} (seq ${message.seq} <= ${highWater})`,
        );
        return;
      }
      book.highWaterSeq.set(message.type, message.seq);
    }

    this.events.emit('message', {peerId, message});
  }

  private sendAck(peerId: string, ackId: string): void {
    const envelope = buildEnvelope(MessageType.Ack, this.localId, {ackId});
    // ACKs bypass the queue: delaying them behind game traffic causes spurious
    // retries, which is exactly the congestion we are trying to avoid.
    void this.transport
      .send(peerId, encodeEnvelope(envelope))
      .catch(err => log.debug(`ack to ${peerId} failed`, err));
  }

  private resolveAck(peerId: string, ackId: string): void {
    const key = `${peerId}:${ackId}`;
    const entry = this.pending.get(key);
    if (!entry) {
      return;
    }
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    this.pending.delete(key);
    this.events.emit('delivered', {
      peerId,
      messageId: ackId,
      attempts: entry.attempts,
      rttMs: Date.now() - entry.firstSentAt,
    });
  }

  /** Messages still awaiting an ACK -- useful for a connection health readout. */
  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }
    this.pending.clear();
    this.peers.clear();
    this.events.removeAllListeners();
  }
}
