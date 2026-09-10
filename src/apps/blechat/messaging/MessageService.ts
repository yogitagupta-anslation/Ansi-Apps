import {
  ACK_TIMEOUT_MS,
  DEFAULT_TTL,
  PROTOCOL_VERSION,
} from '../config/constants';
import {storage} from '../storage/LocalStorage';
import type {ChatMessage, MessageStatus} from '../types/Message';
import type {
  AckPayload,
  GroupInvitePayload,
  MessagePayload,
  Packet,
} from '../types/Packet';
import type {PeerIdentity} from '../types/Peer';
import {EventBus} from '../utils/EventBus';
import {uuidv4, shortId} from '../utils/id';
import {logger} from '../utils/logger';
import {buildAck, buildGroupInvite, buildMessage} from './Packet';
import {
  createGroup as createGroupWith,
  GroupStore,
  parseGroup as parseGroupPayload,
  type Group,
} from './Groups';
import type {MessageRouter} from './MessageRouter';
import {MessageQueue} from './MessageQueue';
import type {LinkMetrics} from '../peers/LinkMetrics';

const TAG = 'Messages';

type MessageEvents = {
  messagesChanged: {conversationId: string; messages: ChatMessage[]};
  messageReceived: ChatMessage;
  /** A real transmission completed for this message. */
  messageSent: {peerId: string; messageId: string};
  /** Measured ACK round trip, for session-level averages. */
  ackReceived: {peerId: string; latencyMs: number};
  queueChanged: {peerId: string; queued: number};
  groupsChanged: Group[];
  /** A conversation is provably missing messages that were never delivered. */
  messagesMissed: {conversationId: string; originId: string; count: number};
  unreadChanged: Record<string, number>;
};

/**
 * Chat semantics on top of the router: conversation history, delivery state, and
 * application-level acknowledgement.
 *
 * Every status transition is caused by something that actually happened on the wire.
 * There is no setTimeout anywhere that advances a message towards success — the only
 * timer present does the opposite, failing a message whose ACK never arrived.
 */
export class MessageService {
  readonly bus = new EventBus<MessageEvents>();

  private conversations = new Map<string, ChatMessage[]>();
  private pendingAcks = new Map<
    string,
    {
      conversationId: string;
      timer: ReturnType<typeof setTimeout>;
      /** When the packet was handed to the transport, for ACK round-trip timing. */
      sentAt: number;
    }
  >();
  private identity: PeerIdentity | null = null;

  /** Messages that could not be transmitted yet. */
  readonly queue = new MessageQueue();

  /** Group definitions, shared peer-to-peer via GROUP_INVITE. */
  readonly groups = new GroupStore();
  private onGroupsPersist: (() => void) | null = null;

  /**
   * Groups we have left.
   *
   * Kept separately from the group list, and persisted, because forgetting a group is not
   * enough on its own: an inbound message for an unknown group re-creates it, so leaving
   * would be silently undone by the next message anybody sent. Being explicit about
   * having left is what makes it stick.
   *
   * Leaving is a LOCAL decision. There is no server to remove us from anybody else's
   * member list, so the other members keep addressing us and we simply ignore it. A fresh
   * invite is treated as being deliberately re-added, and clears the flag.
   */
  private leftGroups = new Set<string>();

  /**
   * Next conversation sequence number WE will use, per conversation.
   *
   * Rebuilt from stored history at hydrate rather than persisted separately, so it
   * cannot drift out of step with the messages it numbers.
   */
  private outboundConvSeq = new Map<string, number>();
  /** Highest conversation sequence seen from each author: `${conversationId}|${originId}`. */
  private inboundConvSeq = new Map<string, number>();

  /**
   * When each conversation was last opened, so unread counts survive a restart.
   *
   * Stored as a timestamp rather than a count: a count would have to be decremented in
   * lockstep with every arrival and every read, and any missed event would leave it
   * permanently wrong. A high-water mark is self-correcting — it is compared against the
   * messages that actually exist.
   */
  private lastReadAt = new Map<string, number>();
  private onReadMarksPersist: (() => void) | null = null;

  /** Supplied by the app layer so measurements land on the right peer. */
  private metricsFor: ((peerId: string) => LinkMetrics) | null = null;
  private onQueuePersist: (() => void) | null = null;

  /** One timer for every held message, armed on the soonest. See `armScheduleTimer`. */
  private scheduleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly router: MessageRouter) {}

  setMetricsProvider(provider: (peerId: string) => LinkMetrics): void {
    this.metricsFor = provider;
  }

  setQueuePersistHandler(handler: () => void): void {
    this.onQueuePersist = handler;
  }

  private persistQueue(peerId: string): void {
    this.onQueuePersist?.();
    this.bus.emit('queueChanged', {
      peerId,
      queued: this.queue.countFor(peerId),
    });
  }

  setIdentity(identity: PeerIdentity): void {
    this.identity = identity;
  }

  attach(): void {
    this.router.on('MESSAGE', ({packet}) => {
      this.onMessage(packet as Packet<MessagePayload>);
    });
    this.router.on('ACK', ({packet}) => {
      this.onAck(packet as Packet<AckPayload>);
    });
    this.router.on('GROUP_INVITE', ({packet}) => {
      this.onGroupInvite(packet as Packet<GroupInvitePayload>);
    });
  }

  setReadMarkPersistHandler(handler: () => void): void {
    this.onReadMarksPersist = handler;
  }

  hydrateReadMarks(marks: Record<string, number>): void {
    for (const [id, at] of Object.entries(marks ?? {})) {
      if (typeof at === 'number' && at > 0) {
        this.lastReadAt.set(id, at);
      }
    }
  }

  readMarks(): Record<string, number> {
    return Object.fromEntries(this.lastReadAt);
  }

  /**
   * The read mark as it stood before this call — read this BEFORE calling `markRead`,
   * which is what a screen wants for "what's new since I last looked", since markRead
   * immediately advances the mark to the newest message once the screen opens.
   */
  readMarkFor(conversationId: string): number {
    return this.lastReadAt.get(conversationId) ?? 0;
  }

  /** Called when the user opens a conversation. */
  markRead(conversationId: string): void {
    const list = this.conversations.get(conversationId);
    const latest = list?.length ? list[list.length - 1].receivedAt : Date.now();
    // Marked at the newest message rather than "now": anything that arrives while the
    // screen is open is still counted correctly if the user backs out immediately.
    if ((this.lastReadAt.get(conversationId) ?? 0) >= latest) {
      return;
    }
    this.lastReadAt.set(conversationId, latest);
    this.onReadMarksPersist?.();
    this.bus.emit('unreadChanged', this.unreadCounts());
  }

  /** Incoming messages this conversation has received since it was last opened. */
  unreadCount(conversationId: string): number {
    const since = this.lastReadAt.get(conversationId) ?? 0;
    const list = this.conversations.get(conversationId);
    if (!list) {
      return 0;
    }
    let count = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const message = list[i];
      // The list is ordered by arrival, so everything below the mark is read.
      if (message.receivedAt <= since) {
        break;
      }
      if (message.direction === 'incoming') {
        count++;
      }
    }
    return count;
  }

  unreadCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.conversations.keys()) {
      const count = this.unreadCount(id);
      if (count > 0) {
        out[id] = count;
      }
    }
    return out;
  }

  /** Newest message in a conversation, for the list preview. */
  lastMessage(conversationId: string): ChatMessage | null {
    const list = this.conversations.get(conversationId);
    return list?.length ? list[list.length - 1] : null;
  }

  setGroupPersistHandler(handler: () => void): void {
    this.onGroupsPersist = handler;
  }

  hydrateLeftGroups(ids: string[]): void {
    this.leftGroups = new Set(ids);
  }

  leftGroupIds(): string[] {
    return Array.from(this.leftGroups);
  }

  hasLeft(groupId: string): boolean {
    return this.leftGroups.has(groupId);
  }

  /**
   * Leave a group: forget it, stop accepting its messages, and drop anything still queued
   * for it.
   *
   * Deliberately does not notify the other members — that would need a packet type the
   * protocol does not have, and inventing one that only some builds understand would make
   * membership less predictable rather than more.
   */
  async leaveGroup(groupId: string): Promise<void> {
    this.groups.remove(groupId);
    this.leftGroups.add(groupId);
    this.persistGroups();

    // Undelivered copies addressed to members of a group we have left are no longer
    // wanted; sending them later would be sending into a conversation we walked out of.
    for (const peerId of this.queue.peerIds) {
      for (const queued of this.queue.pending(peerId)) {
        if (queued.groupId === groupId) {
          this.queue.remove(peerId, queued.messageId);
        }
      }
    }
    this.onQueuePersist?.();

    this.conversations.delete(groupId);
    this.outboundConvSeq.delete(groupId);
    for (const key of Array.from(this.inboundConvSeq.keys())) {
      if (key.startsWith(`${groupId}|`)) {
        this.inboundConvSeq.delete(key);
      }
    }
    await storage.saveMessages(groupId, []);

    logger.info(TAG, `left group ${shortId(groupId)}`);
    this.bus.emit('messagesChanged', {conversationId: groupId, messages: []});
  }

  private persistGroups(): void {
    this.onGroupsPersist?.();
    this.bus.emit('groupsChanged', this.groups.all());
  }

  // ---- groups -----------------------------------------------------------

  /**
   * Create a group and tell every member about it.
   *
   * The invite is best-effort per member: an unreachable member simply does not know
   * about the group yet, and will be told the next time an invite is sent. Nothing is
   * queued for them, because a group they have never heard of is not a message.
   */
  async createGroup(name: string, memberIds: string[]): Promise<Group> {
    if (!this.identity) {
      throw new Error('MessageService has no identity');
    }
    const group = createGroupWith(name, memberIds, this.identity.peerId);
    this.groups.upsert(group);
    this.persistGroups();
    logger.info(
      TAG,
      `created group "${group.name}" with ${group.members.length} member(s)`,
    );

    await this.inviteMembers(group);
    return group;
  }

  /** (Re)send the group definition to every reachable member. */
  async inviteMembers(group: Group): Promise<number> {
    if (!this.identity) {
      return 0;
    }
    let sent = 0;
    for (const member of this.groups.recipients(group.id, this.identity.peerId)) {
      if (!this.router.canReach(member)) {
        continue;
      }
      const invite = buildGroupInvite(this.identity.peerId, member, group);
      try {
        await this.router.sendToPeer(member, invite);
        sent += 1;
      } catch (err) {
        logger.warn(TAG, `invite to ${shortId(member)} failed`, err);
      }
    }
    return sent;
  }

  private onGroupInvite(packet: Packet<GroupInvitePayload>): void {
    const parsed = parseGroupPayload(packet.payload?.group);
    if (!parsed) {
      logger.warn(TAG, `malformed GROUP_INVITE from ${shortId(packet.senderId)}`);
      return;
    }
    // Leaving is sticky. Every member re-shares its groups whenever a peer reconnects,
    // so treating an invite as "deliberately re-added" would put us straight back into a
    // group we walked out of, the moment we came back into range. Nothing on the wire
    // distinguishes that automatic re-share from a genuine new invitation, so the only
    // predictable rule is that our own decision wins.
    if (this.leftGroups.has(parsed.id)) {
      logger.debug(
        TAG,
        `ignoring invite to ${shortId(parsed.id)}, which we have left`,
      );
      return;
    }
    this.groups.upsert(parsed);
    this.persistGroups();
    logger.info(
      TAG,
      `joined group "${parsed.name}" (${parsed.members.length} members) via ` +
        shortId(packet.senderId),
    );
  }

  /**
   * Fan a message out to every member of a group.
   *
   * One ChatMessage, N packets — each addressed to an individual member so it is routed,
   * acknowledged and deduplicated exactly like a direct message. Members that cannot be
   * reached go to the outbox and are delivered when they return, which is why the
   * delivery indicator is "2/3" rather than a single tick.
   */
  async sendToGroup(groupId: string, text: string): Promise<ChatMessage> {
    if (!this.identity) {
      throw new Error('MessageService has no identity');
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot send an empty message');
    }
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Unknown group ${groupId}`);
    }

    const recipients = this.groups.recipients(groupId, this.identity.peerId);
    const now = Date.now();
    // One position for the whole fan-out: every member receives the same message, so it
    // occupies the same slot in the conversation for all of them.
    const convSeq = this.nextConvSeq(groupId);
    const message: ChatMessage = {
      id: uuidv4(),
      conversationId: groupId,
      originId: this.identity.peerId,
      senderId: this.identity.peerId,
      destinationId: groupId,
      text: trimmed,
      timestamp: now,
      receivedAt: now,
      convSeq,
      direction: 'outgoing',
      status: 'pending',
      protocolVersion: PROTOCOL_VERSION,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      retryCount: 0,
      groupId,
      deliveredTo: [],
      recipientCount: recipients.length,
    };
    this.append(groupId, message);

    if (recipients.length === 0) {
      // A group of one has nobody to deliver to; do not pretend otherwise.
      this.setStatus(groupId, message.id, 'sent', true);
      return message;
    }

    this.router.seen.markIfNew(message.id);
    this.setStatus(groupId, message.id, 'sending', true);

    let anySent = false;
    for (const member of recipients) {
      if (!this.router.canReach(member)) {
        this.queue.enqueue({
          messageId: message.id,
          peerId: member,
          text: trimmed,
          queuedAt: Date.now(),
          attempts: 0,
          groupId,
          convSeq,
        });
        this.persistQueue(member);
        continue;
      }
      const packet = buildMessage(
        this.identity.peerId,
        member,
        trimmed,
        message.id,
        groupId,
        convSeq,
      );
      try {
        await this.router.sendToPeer(member, packet);
        this.metricsFor?.(member).recordTxPacket(trimmed.length);
        this.bus.emit('messageSent', {peerId: member, messageId: message.id});
        anySent = true;
        this.armAckTimeout(groupId, message.id, Date.now());
      } catch (err) {
        logger.warn(TAG, `group send to ${shortId(member)} failed`, err);
        this.metricsFor?.(member).recordSendFailure();
      }
    }

    // "sent" means at least one real transmission happened. Recipients still queued are
    // reflected by deliveredTo being short of recipientCount, not by a false status.
    //
    // NOT forced when anySent: on a fast link every ACK can arrive before this line runs,
    // and forcing would walk a fully-delivered message back to "sent". Only the rewind to
    // "pending" (nothing went out, it is all queued) is a deliberate backwards move.
    if (anySent) {
      this.setStatus(groupId, message.id, 'sent');
    } else {
      this.setStatus(groupId, message.id, 'pending', true);
    }
    return this.find(groupId, message.id) ?? message;
  }

  /** Members of a group that still have this message queued. */
  pendingGroupRecipients(messageId: string): string[] {
    return this.queue.peerIds.filter(peerId =>
      this.queue.pending(peerId).some(m => m.messageId === messageId),
    );
  }

  // ---- conversation sequencing ------------------------------------------

  /** Our next position in this conversation. */
  private nextConvSeq(conversationId: string): number {
    const next = (this.outboundConvSeq.get(conversationId) ?? 0) + 1;
    this.outboundConvSeq.set(conversationId, next);
    return next;
  }

  private convKey(conversationId: string, originId: string): string {
    return `${conversationId}|${originId}`;
  }

  /**
   * Compare an incoming message's position against the last one we have from this author
   * and report how many are missing in between.
   *
   * Only a FORWARD jump counts as loss. A number at or below the high-water mark is a
   * late or duplicated delivery, which the replay window and the seen-id cache already
   * handle — treating it as a gap would invent loss that did not happen.
   */
  private detectGap(
    conversationId: string,
    originId: string,
    convSeq: number | undefined,
  ): number {
    if (typeof convSeq !== 'number' || !Number.isInteger(convSeq) || convSeq <= 0) {
      return 0;
    }
    const key = this.convKey(conversationId, originId);
    const last = this.inboundConvSeq.get(key) ?? 0;
    this.inboundConvSeq.set(key, Math.max(last, convSeq));

    // No previous message means no observable gap: we cannot tell a fresh conversation
    // from one we joined late, and guessing would report loss on every first contact.
    if (last === 0 || convSeq <= last) {
      return 0;
    }
    return convSeq - last - 1;
  }

  async hydrate(): Promise<void> {
    const ids = await storage.loadConversationIds();
    const selfId = this.identity?.peerId ?? null;

    for (const id of ids) {
      const messages = await storage.loadMessages(id);
      for (const m of messages) {
        // Anything left mid-flight when the app died did not complete.
        if (m.status === 'pending' || m.status === 'sending') {
          m.status = 'failed';
        }
        // Messages stored before arrival time was recorded only have the sender's claim.
        // Adopting it is the best available answer and keeps ordering stable.
        if (typeof m.receivedAt !== 'number') {
          m.receivedAt = m.timestamp;
        }

        // Rebuild both counters from history, so numbering continues where it left off
        // instead of restarting and reading as a gap to the other side.
        if (typeof m.convSeq === 'number') {
          if (selfId && m.direction === 'outgoing' && m.originId === selfId) {
            this.outboundConvSeq.set(
              id,
              Math.max(this.outboundConvSeq.get(id) ?? 0, m.convSeq),
            );
          } else if (m.direction === 'incoming') {
            const key = this.convKey(id, m.originId);
            this.inboundConvSeq.set(
              key,
              Math.max(this.inboundConvSeq.get(key) ?? 0, m.convSeq),
            );
          }
        }
      }
      messages.sort((a, b) => a.receivedAt - b.receivedAt);
      this.conversations.set(id, messages);
    }
    logger.info(TAG, `hydrated ${ids.length} conversation(s)`);

    /*
      Held messages survive the app being closed, which is most of the point of holding
      one: "send this at 10am tomorrow" is worthless if it only works while the app is
      open. Anything whose time passed while the process was gone goes out on the first
      tick after this, which is the honest behaviour — late, and sent, rather than
      silently dropped.
    */
    this.armScheduleTimer();
  }

  getMessages(conversationId: string): ChatMessage[] {
    return this.conversations.get(conversationId) ?? [];
  }

  getConversationIds(): string[] {
    return Array.from(this.conversations.keys());
  }

  // ---- outbound ---------------------------------------------------------

  /**
   * Queue, transmit, and track a chat message.
   *
   * The returned promise resolves once the bytes have actually gone out over BLE.
   * Delivery confirmation is separate and arrives later as an ACK.
   */
  async send(peerId: string, text: string): Promise<ChatMessage> {
    if (!this.identity) {
      throw new Error('MessageService has no identity');
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot send an empty message');
    }

    const now = Date.now();
    const message: ChatMessage = {
      id: uuidv4(),
      conversationId: peerId,
      originId: this.identity.peerId,
      senderId: this.identity.peerId,
      destinationId: peerId,
      text: trimmed,
      timestamp: now,
      // Our own clock either way, so outgoing and incoming sort against each other.
      receivedAt: now,
      convSeq: this.nextConvSeq(peerId),
      direction: 'outgoing',
      status: 'pending',
      protocolVersion: PROTOCOL_VERSION,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      retryCount: 0,
    };

    this.append(peerId, message);

    // The packet id IS the message id, so an ACK naming the packet identifies the
    // message with no extra correlation table. Our own id is marked seen so a future
    // relay cannot echo it back and have us treat our own message as inbound.
    this.router.seen.markIfNew(message.id);

    // A peer walking out of range mid-conversation is normal for BLE. Holding the
    // message in the outbox is honest — it stays "queued", never "sent" — and it is
    // delivered for real when the link comes back.
    if (!this.router.canReach(peerId)) {
      this.enqueue(peerId, message);
      return this.find(peerId, message.id) ?? message;
    }

    // transmit() builds the packet that actually goes out. Building a second one here
    // was how convSeq came to be set on the stored message but missing on the wire.
    await this.transmit(peerId, message.id, trimmed, undefined, message.convSeq);
    return this.find(peerId, message.id) ?? message;
  }

  private enqueue(peerId: string, message: ChatMessage): void {
    const evicted = this.queue.enqueue({
      messageId: message.id,
      peerId,
      text: message.text,
      queuedAt: Date.now(),
      attempts: 0,
      groupId: message.groupId,
      // Carried through the outbox so a message delivered after a reconnect still lands
      // in the position it was composed in, rather than looking like a gap.
      convSeq: message.convSeq,
    });
    for (const id of evicted) {
      // Evicted to stay within the per-peer cap; say so rather than losing it silently.
      logger.warn(TAG, `queue full for ${shortId(peerId)}, dropped ${shortId(id)}`);
      this.setStatus(peerId, id, 'failed', true);
    }
    this.setStatus(peerId, message.id, 'pending', true);
    this.persistQueue(peerId);
  }

  /**
   * One real transmission attempt. Resolves once the bytes are with the BLE stack.
   * Throws only when the write itself failed.
   */
  private async transmit(
    peerId: string,
    messageId: string,
    text: string,
    groupId?: string,
    convSeq?: number,
  ): Promise<void> {
    if (!this.identity) {
      throw new Error('MessageService has no identity');
    }
    const packet = buildMessage(
      this.identity.peerId,
      peerId,
      text,
      messageId,
      groupId,
      convSeq,
    );
    this.router.seen.markIfNew(packet.id);

    // A group copy lives under the group conversation, not under the recipient.
    const conversationId = groupId ?? peerId;

    this.setStatus(conversationId, messageId, 'sending', true);
    const startedAt = Date.now();

    try {
      await this.router.sendToPeer(peerId, packet, (sent, total) => {
        this.setProgress(conversationId, messageId, sent, total);
      });
      this.metricsFor?.(peerId).recordTxPacket(text.length);
      this.bus.emit('messageSent', {peerId, messageId});
      // Reached only after a real BLE write completed. setStatus is monotonic, so if the
      // peer already ACKed while we were awaiting the write, this leaves it at received.
      this.setStatus(conversationId, messageId, 'sent');
      if (this.find(conversationId, messageId)?.status === 'sent') {
        this.armAckTimeout(conversationId, messageId, startedAt);
      }
      this.queue.remove(peerId, messageId);
      this.persistQueue(peerId);
    } catch (err) {
      logger.error(TAG, `send to ${shortId(peerId)} failed`, err);
      this.metricsFor?.(peerId).recordSendFailure();
      this.setStatus(conversationId, messageId, 'failed');
      throw err;
    }
  }

  /**
   * Drain everything waiting for a peer that has just become reachable.
   *
   * Sends are sequential: the transport serialises per link anyway, and going one at a
   * time keeps the delivered order the same as the order they were composed in.
   */
  async flushQueue(peerId: string): Promise<number> {
    const expired = this.queue.expire();
    for (const message of expired) {
      this.setStatus(message.peerId, message.messageId, 'failed', true);
    }

    const waiting = this.queue.pending(peerId);
    if (waiting.length === 0) {
      return 0;
    }
    logger.info(TAG, `flushing ${waiting.length} queued for ${shortId(peerId)}`);

    let delivered = 0;
    for (const queued of waiting) {
      if (!this.router.canReach(peerId)) {
        // Link dropped mid-flush; the rest stays queued for the next reconnect.
        break;
      }
      try {
        await this.transmit(
          peerId,
          queued.messageId,
          queued.text,
          queued.groupId,
          queued.convSeq,
        );
        delivered += 1;
      } catch {
        break;
      }
    }
    this.persistQueue(peerId);
    return delivered;
  }

  /** Re-send a message that previously failed, reusing its id. */
  async retry(conversationId: string, messageId: string): Promise<void> {
    const message = this.find(conversationId, messageId);
    if (!message || !this.identity) {
      return;
    }
    message.retryCount += 1;
    logger.info(TAG, `retry ${message.retryCount} for ${shortId(messageId)}`);

    if (!this.router.canReach(message.destinationId)) {
      this.enqueue(message.destinationId, message);
      return;
    }

    try {
      await this.transmit(
        message.destinationId,
        messageId,
        message.text,
        message.groupId,
        // Reusing the original position: a retry is the same message arriving late, not
        // a new one, so it must not consume a fresh slot in the conversation.
        message.convSeq,
      );
    } catch {
      this.setStatus(conversationId, messageId, 'failed', true);
    }
  }

  /**
   * Remove one message from this device's own copy of a conversation.
   *
   * Local only, deliberately: there is no server to ask, and no message that can be
   * unsent from a phone that already has it. This is "delete for me", the same shape
   * every peer-to-peer chat app settles on for the same reason.
   */
  deleteLocal(conversationId: string, messageId: string): void {
    const list = this.conversations.get(conversationId);
    if (!list) {
      return;
    }
    const next = list.filter(m => m.id !== messageId);
    if (next.length === list.length) {
      return;
    }
    this.conversations.set(conversationId, next);
    this.persist(conversationId);
    this.bus.emit('messagesChanged', {conversationId, messages: next});
    // Deleting a held message is how it is cancelled, so the clock has to be reconsidered.
    this.armScheduleTimer();
  }

  // ---- send later -------------------------------------------------------

  /**
   * Write it now, send it then.
   *
   * The message is appended to the conversation immediately — you can see it, edit it and
   * cancel it — but nothing touches the radio until `at`. That is the whole trick, and it
   * is why this needs no protocol change: a held message is a local note, and the moment
   * it is released it becomes an ordinary message going out the ordinary way.
   *
   * `convSeq` is deliberately NOT assigned here. It is the author's position in the
   * conversation, and the position a message occupies is where it is SENT, not where it
   * was typed — assigning it now would leave a hole in the other side's numbering for
   * however many hours the message sits here, and a hole is exactly what the receiver
   * reads as a lost message.
   */
  schedule(
    conversationId: string,
    text: string,
    at: number,
    groupId?: string,
  ): ChatMessage {
    if (!this.identity) {
      throw new Error('MessageService has no identity');
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot schedule an empty message');
    }
    if (!Number.isFinite(at)) {
      throw new Error('Cannot schedule without a time');
    }

    const now = Date.now();
    const message: ChatMessage = {
      id: uuidv4(),
      conversationId,
      originId: this.identity.peerId,
      senderId: this.identity.peerId,
      destinationId: conversationId,
      text: trimmed,
      timestamp: now,
      // Composed now, so it sorts to the bottom of today rather than jumping forward into
      // a day heading that has not happened. The bubble carries its own send time.
      receivedAt: now,
      direction: 'outgoing',
      status: 'scheduled',
      scheduledFor: at,
      protocolVersion: PROTOCOL_VERSION,
      ttl: DEFAULT_TTL,
      hopCount: 0,
      retryCount: 0,
      ...(groupId ? {groupId, deliveredTo: []} : {}),
    };

    this.append(conversationId, message);
    logger.info(
      TAG,
      `holding ${shortId(message.id)} for ${new Date(at).toISOString()}`,
    );
    this.armScheduleTimer();
    return message;
  }

  /** Move a held message to a different time. Only meaningful while it is still held. */
  reschedule(conversationId: string, messageId: string, at: number): void {
    const message = this.find(conversationId, messageId);
    if (!message || message.status !== 'scheduled') {
      return;
    }
    message.scheduledFor = at;
    this.persist(conversationId);
    this.bus.emit('messagesChanged', {
      conversationId,
      messages: [...(this.conversations.get(conversationId) ?? [])],
    });
    this.armScheduleTimer();
  }

  /** Every message still waiting on the clock, soonest first. */
  scheduledMessages(): Array<{conversationId: string; message: ChatMessage}> {
    const out: Array<{conversationId: string; message: ChatMessage}> = [];
    for (const [conversationId, list] of this.conversations) {
      for (const message of list) {
        if (message.status === 'scheduled') {
          out.push({conversationId, message});
        }
      }
    }
    return out.sort(
      (a, b) => (a.message.scheduledFor ?? 0) - (b.message.scheduledFor ?? 0),
    );
  }

  /**
   * Let a held message go now, whatever its clock said.
   *
   * Implemented as delete-then-send rather than by flipping the status in place, so a
   * released message travels the exact path every other message travels — same convSeq
   * assignment, same reachability check, same outbox on a dropped link. A second
   * near-identical send path is how the two drift apart.
   */
  async releaseScheduled(conversationId: string, messageId: string): Promise<void> {
    const message = this.find(conversationId, messageId);
    if (!message || message.status !== 'scheduled') {
      return;
    }
    const {text, groupId} = message;
    this.deleteLocal(conversationId, messageId);
    try {
      if (groupId) {
        await this.sendToGroup(groupId, text);
      } else {
        await this.send(conversationId, text);
      }
    } catch (err) {
      // send() already records a failure against the message it created; this is only
      // for a throw before that message exists, which would otherwise vanish silently.
      logger.warn(TAG, `scheduled send failed: ${String(err)}`);
    }
  }

  /**
   * One timer for the whole app, armed on the soonest message.
   *
   * A timer per message would be N timers to leak and N to rebuild on every hydrate; the
   * queue only ever moves forward, so the earliest deadline is the only one worth
   * holding. Anything already overdue — the app was closed, the phone was asleep — goes
   * out on the next tick rather than waiting for its moment to come round again.
   */
  private armScheduleTimer(): void {
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    const next = this.scheduledMessages()[0];
    if (!next) {
      return;
    }
    const due = next.message.scheduledFor ?? 0;
    // setTimeout is clamped to a 32-bit millisecond delay; anything beyond that is
    // re-armed when the shorter timer fires rather than firing immediately at a wrapped
    // negative delay.
    const delay = Math.min(Math.max(0, due - Date.now()), 0x7fffffff);
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      void this.releaseDue();
    }, delay);
  }

  /** Send everything whose time has come, then re-arm on whatever is left. */
  private async releaseDue(): Promise<void> {
    const now = Date.now();
    const due = this.scheduledMessages().filter(
      s => (s.message.scheduledFor ?? 0) <= now,
    );
    for (const {conversationId, message} of due) {
      await this.releaseScheduled(conversationId, message.id);
    }
    this.armScheduleTimer();
  }

  private armAckTimeout(
    conversationId: string,
    messageId: string,
    sentAt: number,
  ): void {
    const existing = this.pendingAcks.get(messageId);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pendingAcks.delete(messageId);
      const message = this.find(conversationId, messageId);
      // Only downgrade if the ACK genuinely never arrived.
      if (message && message.status === 'sent') {
        logger.warn(TAG, `no ACK for ${shortId(messageId)} within ${ACK_TIMEOUT_MS}ms`);
        this.metricsFor?.(conversationId).recordAckTimeout();
        this.setStatus(conversationId, messageId, 'failed');
      }
    }, ACK_TIMEOUT_MS);

    this.pendingAcks.set(messageId, {conversationId, timer, sentAt});
  }

  // ---- inbound ----------------------------------------------------------

  private onMessage(packet: Packet<MessagePayload>): void {
    if (!this.identity) {
      return;
    }
    const text = packet.payload?.text;
    if (typeof text !== 'string') {
      logger.warn(TAG, `MESSAGE ${shortId(packet.id)} has no text, ignored`);
      return;
    }

    // A group message belongs to its group conversation; a direct one belongs to its
    // author. Keyed by the ORIGIN rather than the last hop, so once relaying exists a
    // message from A arriving via B still files under A.
    const groupId = packet.payload?.groupId;
    if (groupId && this.leftGroups.has(groupId)) {
      // Still ACKed below is NOT what we want here — we are not in this conversation, so
      // there is nothing truthful to acknowledge.
      logger.debug(
        TAG,
        `ignoring message for ${shortId(groupId)}, which we have left`,
      );
      return;
    }
    if (groupId && !this.groups.get(groupId)) {
      // A message for a group we have never been invited to. Accept it and record a
      // minimal group so the conversation is not silently dropped.
      this.groups.upsert({
        id: groupId,
        name: 'Group',
        members: [packet.originId, this.identity.peerId],
        createdAt: Date.now(),
        createdBy: packet.originId,
      });
      this.persistGroups();
    }
    const conversationId = groupId ?? packet.originId;
    const convSeq = packet.payload?.convSeq;
    const missedBefore = this.detectGap(conversationId, packet.originId, convSeq);
    const receivedAt = Date.now();

    const message: ChatMessage = {
      id: packet.id,
      conversationId,
      originId: packet.originId,
      senderId: packet.senderId,
      destinationId: packet.destinationId,
      text,
      // The author's claim, kept as metadata only.
      timestamp: packet.timestamp,
      // What we actually observed. This is what the conversation is ordered by.
      receivedAt,
      clockSkewMs: packet.timestamp > 0 ? receivedAt - packet.timestamp : undefined,
      convSeq: typeof convSeq === 'number' ? convSeq : undefined,
      missedBefore: missedBefore > 0 ? missedBefore : undefined,
      direction: 'incoming',
      status: 'received',
      protocolVersion: packet.version,
      ttl: packet.ttl,
      hopCount: packet.hopCount,
      retryCount: 0,
      groupId,
    };

    if (missedBefore > 0) {
      // Said out loud rather than papered over: the alternative is a conversation that
      // silently reads as complete when it is not.
      logger.warn(
        TAG,
        `${missedBefore} message(s) from ${shortId(packet.originId)} never arrived ` +
          `(jumped to #${convSeq})`,
      );
      this.bus.emit('messagesMissed', {
        conversationId,
        originId: packet.originId,
        count: missedBefore,
      });
    }

    this.append(conversationId, message);
    this.metricsFor?.(conversationId).recordRxPacket(text.length);
    this.bus.emit('messageReceived', message);
    this.bus.emit('unreadChanged', this.unreadCounts());
    logger.info(
      TAG,
      `message from ${shortId(packet.senderId)}: "${truncate(text)}"`,
    );

    // Acknowledge so the sender can move from "sent" to "delivered" truthfully.
    // Addressed to the origin, which for a group fan-out is whoever composed it.
    const ack = buildAck(this.identity.peerId, packet.originId, packet.id);
    this.router.sendToPeer(packet.originId, ack).catch(err => {
      logger.warn(TAG, `ACK for ${shortId(packet.id)} failed`, err);
    });
  }

  private onAck(packet: Packet<AckPayload>): void {
    const ackFor = packet.payload?.ackFor;
    if (typeof ackFor !== 'string') {
      return;
    }
    const pending = this.pendingAcks.get(ackFor);
    // A group ACK arrives from a member, but the message lives under the group id.
    const conversationId =
      pending?.conversationId ?? this.conversationFor(ackFor) ?? packet.originId;

    if (pending) {
      clearTimeout(pending.timer);
      this.pendingAcks.delete(ackFor);
      // Measured, not modelled: transport hand-off to ACK arrival.
      const latencyMs = Date.now() - pending.sentAt;
      this.metricsFor?.(conversationId).recordAck(latencyMs);
      this.bus.emit('ackReceived', {peerId: conversationId, latencyMs});
    }

    const message = this.find(conversationId, ackFor);
    if (!message) {
      logger.debug(TAG, `ACK for unknown message ${shortId(ackFor)}`);
      return;
    }

    if (message.groupId) {
      // Group delivery is per recipient: only once every member has acknowledged is the
      // message genuinely delivered.
      const delivered = new Set(message.deliveredTo ?? []);
      delivered.add(packet.senderId);
      message.deliveredTo = Array.from(delivered);

      const total = message.recipientCount ?? delivered.size;
      logger.info(
        TAG,
        `ACK for ${shortId(ackFor)} from ${shortId(packet.senderId)} ` +
          `(${delivered.size}/${total})`,
      );
      this.persist(conversationId);
      this.bus.emit('messagesChanged', {
        conversationId,
        messages: [...(this.conversations.get(conversationId) ?? [])],
      });
      if (delivered.size >= total) {
        this.setStatus(conversationId, ackFor, 'received');
      }
      return;
    }

    logger.info(TAG, `ACK received for ${shortId(ackFor)}`);
    this.setStatus(conversationId, ackFor, 'received');
  }

  // ---- store ------------------------------------------------------------

  private append(conversationId: string, message: ChatMessage): void {
    const list = this.conversations.get(conversationId) ?? [];
    if (list.some(m => m.id === message.id)) {
      return;
    }
    // Ordered by OUR clock, not the sender's. In the overwhelmingly common case this is
    // a plain push, because arrival order already is receivedAt order; the search back
    // exists so a message restored from the outbox after a reconnect, or one appended
    // during hydration, still lands in the right place instead of jumping to the end.
    let at = list.length;
    while (at > 0 && list[at - 1].receivedAt > message.receivedAt) {
      at--;
    }
    list.splice(at, 0, message);
    this.conversations.set(conversationId, list);
    this.persist(conversationId);
    this.bus.emit('messagesChanged', {conversationId, messages: [...list]});
  }

  /**
   * Delivery progress is monotonic, so a slower code path can never walk a message
   * backwards to a less-advanced state.
   *
   * This is not hypothetical. The remote ACK can arrive while our own send() is still
   * awaiting the transport write — the peer has already received and acknowledged the
   * packet before our promise settles. Without this ordering, send() would then overwrite
   * `received` with `sent`, and the ACK-timeout would later mark a message that was
   * genuinely delivered as `failed`. The faster the link, the more often it happens.
   *
   * `received` outranks `failed` so a late ACK correctly promotes a timed-out message.
   */
  private static readonly STATUS_RANK: Record<MessageStatus, number> = {
    // Below pending: a held message has not been attempted, and releasing it into the
    // ordinary path must never look like a regression.
    scheduled: -1,
    pending: 0,
    sending: 1,
    sent: 2,
    failed: 3,
    received: 4,
  };

  private setStatus(
    conversationId: string,
    messageId: string,
    status: MessageStatus,
    /** Retrying is a deliberate move backwards and is the only case allowed to rewind. */
    force = false,
  ): void {
    const list = this.conversations.get(conversationId);
    if (!list) {
      return;
    }
    const message = list.find(m => m.id === messageId);
    if (!message || message.status === status) {
      return;
    }
    const rank = MessageService.STATUS_RANK;
    if (!force && rank[status] <= rank[message.status]) {
      logger.debug(
        TAG,
        `ignoring ${message.status} -> ${status} for ${shortId(messageId)} (would regress)`,
      );
      return;
    }
    message.status = status;
    // Stale the moment status moves: a fragment count only means anything while the
    // write it describes is still in flight.
    message.fragmentProgress = undefined;
    this.persist(conversationId);
    this.bus.emit('messagesChanged', {conversationId, messages: [...list]});
  }

  /**
   * How many fragments of the current send have actually reached the radio.
   *
   * Driven by the same real per-frame callback the transport already exposes for
   * retransmission — never a fake ramp. Only recorded while the message is still
   * `sending`: a progress callback that resolves after the status has already moved on
   * (a slow last frame racing a fast ACK) must not resurrect a stale count.
   */
  private setProgress(
    conversationId: string,
    messageId: string,
    sent: number,
    total: number,
  ): void {
    const list = this.conversations.get(conversationId);
    if (!list) {
      return;
    }
    const message = list.find(m => m.id === messageId);
    if (!message || message.status !== 'sending') {
      return;
    }
    // A single-fragment send has nothing worth showing beyond the "Sending" status text
    // already displayed — the count only earns its place on multi-fragment messages.
    message.fragmentProgress = total > 1 ? {sent, total} : undefined;
    this.bus.emit('messagesChanged', {conversationId, messages: [...list]});
  }

  /** Which conversation holds this message id, if any. */
  private conversationFor(messageId: string): string | null {
    for (const [id, list] of this.conversations) {
      if (list.some(m => m.id === messageId)) {
        return id;
      }
    }
    return null;
  }

  private find(conversationId: string, messageId: string): ChatMessage | null {
    return (
      this.conversations.get(conversationId)?.find(m => m.id === messageId) ??
      null
    );
  }

  private persist(conversationId: string): void {
    const list = this.conversations.get(conversationId);
    if (!list) {
      return;
    }
    storage.saveMessages(conversationId, list).catch(err => {
      logger.warn(TAG, `persist failed for ${shortId(conversationId)}`, err);
    });
  }

  async clearConversation(conversationId: string): Promise<void> {
    this.conversations.set(conversationId, []);
    await storage.saveMessages(conversationId, []);
    this.bus.emit('messagesChanged', {conversationId, messages: []});
  }

  dispose(): void {
    for (const {timer} of this.pendingAcks.values()) {
      clearTimeout(timer);
    }
    this.pendingAcks.clear();
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
