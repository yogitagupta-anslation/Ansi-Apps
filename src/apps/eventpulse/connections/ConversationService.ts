/**
 * Conversations — the Connection Space's only dependency.
 *
 * The screen calls `send`, reads `messages`, and subscribes. It never learns
 * that a radio exists, which device id a person is currently reachable on, or
 * that messages are framed and fragmented on the way out. That is the whole
 * point of putting this between the UI and `GattSessionManager`.
 *
 * IDENTITY, WHICH IS THE PART THAT MATTERS
 * ----------------------------------------
 * A conversation is keyed by `profileId` — the stable EventPulse identity — and
 * nothing else. `peerId` rotates on an epoch and `deviceId` changes with the
 * radio; either one used as a key would fork the history every time the far
 * side re-advertised, which is precisely when someone wants to look back at it.
 * Both appear here only as transient routing values, resolved at the moment of
 * sending and never written to disk.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * -----------------------------
 * BleChat's `MessageService` is 1096 lines because it carries groups, sessions,
 * key exchange, routing and its own storage. None of that applies to two people
 * who have already completed EventPulse's own handshake, so none of it is here.
 * What is borrowed is the shape of the thing — an id per message, a status that
 * distinguishes sent from failed, dedup on redelivery — not the code.
 */

import type { GattSessionManager } from '../bluetooth/gatt/GattSessionManager';
import { GattMessageType, type GattMessage } from '../bluetooth/gatt/GattMessage';
import type { LocalDatabase } from '../storage/LocalDatabase';
import { keys } from '../storage/LocalDatabase';
import type { ConnectionState, EventId, ProfileId } from '../types';
import { decodeChatMessage, encodeChatMessage, MAX_CHAT_TEXT_BYTES } from './ChatProtocol';

/**
 * Whether a conversation can be opened with someone in this state.
 *
 * Only a settled, mutual `connected` qualifies. A pending request in either
 * direction is not a relationship yet, and `declined`, `cancelled`, `expired`
 * and `failed` are all the absence of one — offering a chat on any of them
 * would be offering to message someone who never agreed.
 *
 * Stated as a function rather than left implicit in a filtered list, so the
 * rule survives someone widening that filter later.
 */
export function canOpenChat(state: ConnectionState): boolean {
  return state === 'connected';
}

/** How a message ended up. Nothing here ever claims a delivery it did not make. */
export type ChatMessageStatus = 'sending' | 'sent' | 'failed' | 'received';

export interface ConversationMessage {
  id: string;
  /** True when this phone wrote it. */
  mine: boolean;
  text: string;
  /** When this phone first knew about it. Its own clock, never the sender's. */
  at: number;
  status: ChatMessageStatus;
}

export interface ConversationServiceOptions {
  db: LocalDatabase;
  sessions: GattSessionManager;
  /** Injected so tests are deterministic and nothing here reads the wall clock. */
  now: () => number;
  /** Unique per message. Injected for the same reason. */
  newMessageId: () => string;
  /**
   * The device this person is reachable on right now, or null.
   *
   * A function rather than a value: the answer changes as links come and go,
   * and a conversation that cached it would send into a link that had closed.
   */
  deviceFor: (profileId: ProfileId) => string | null;
  /** Which person a live link belongs to, for routing an inbound message. */
  profileForDevice: (deviceId: string) => ProfileId | null;
}

type Listener = (profileId: ProfileId, messages: ConversationMessage[]) => void;

/** Keeps a conversation from growing without bound on a long event day. */
const MAX_STORED_MESSAGES = 500;

export class ConversationService {
  private readonly db: LocalDatabase;
  private readonly sessions: GattSessionManager;
  private readonly now: () => number;
  private readonly newMessageId: () => string;
  private readonly deviceFor: (profileId: ProfileId) => string | null;
  private readonly profileForDevice: (deviceId: string) => ProfileId | null;

  private eventId: EventId | null = null;
  private detach: (() => void) | null = null;

  /** Loaded conversations, by profileId. */
  private readonly conversations = new Map<ProfileId, ConversationMessage[]>();
  /** Message ids already seen, so a redelivered message is not shown twice. */
  private readonly seen = new Map<ProfileId, Set<string>>();
  private readonly listeners = new Set<Listener>();

  constructor(options: ConversationServiceOptions) {
    this.db = options.db;
    this.sessions = options.sessions;
    this.now = options.now;
    this.newMessageId = options.newMessageId;
    this.deviceFor = options.deviceFor;
    this.profileForDevice = options.profileForDevice;
  }

  /**
   * Begin listening for chat messages on the shared session manager.
   *
   * Subscribing alongside `ConnectionRequestCoordinator` rather than through it:
   * the coordinator ignores every type it does not own, so chat can arrive on
   * the same links without that file changing at all.
   */
  start(eventId: EventId): void {
    this.eventId = eventId;
    this.detach?.();
    this.detach = this.sessions.subscribe({
      onMessage: (deviceId: string, message: GattMessage) => {
        if (message.type !== GattMessageType.ChatMessage) return;
        void this.onIncoming(deviceId, message);
      },
    });
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
    this.eventId = null;
    this.conversations.clear();
    this.seen.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Everything known about this conversation, oldest first. */
  messages(profileId: ProfileId): ConversationMessage[] {
    return this.conversations.get(profileId) ?? [];
  }

  /** Read a conversation from disk into memory. Safe to call repeatedly. */
  async load(profileId: ProfileId): Promise<ConversationMessage[]> {
    if (this.conversations.has(profileId)) return this.messages(profileId);
    if (!this.eventId) return [];

    const stored =
      (await this.db.get<ConversationMessage[]>(keys.conversation(this.eventId, profileId))) ?? [];
    this.conversations.set(profileId, stored);
    this.seen.set(profileId, new Set(stored.map((message) => message.id)));
    this.publish(profileId);
    return stored;
  }

  /**
   * Send one message.
   *
   * The message is added locally and shown as `sending` BEFORE the radio is
   * touched, because that is what makes a chat feel like a chat. It becomes
   * `sent` only when the transport says the bytes went, and `failed` when it
   * says they did not — never optimistically, because a message that silently
   * claims delivery is worse than one that visibly failed.
   */
  async send(profileId: ProfileId, text: string): Promise<ConversationMessage> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error('ConversationService.send called with an empty message');
    }

    await this.load(profileId);

    const message: ConversationMessage = {
      id: this.newMessageId(),
      mine: true,
      text: trimmed,
      at: this.now(),
      status: 'sending',
    };
    this.append(profileId, message);
    await this.persist(profileId);

    const deviceId = this.deviceFor(profileId);
    if (!deviceId) {
      return this.settle(profileId, message.id, 'failed');
    }

    try {
      await this.sessions.send(
        deviceId,
        GattMessageType.ChatMessage,
        encodeChatMessage({ messageId: message.id, text: trimmed, sentAt: message.at }),
      );
      return this.settle(profileId, message.id, 'sent');
    } catch {
      // The reason is already surfaced by the transport's own error channel.
      // What matters here is that the bubble tells the truth.
      return this.settle(profileId, message.id, 'failed');
    }
  }

  /** Re-send a message that failed. Same id, so the far side still dedupes it. */
  async retry(profileId: ProfileId, messageId: string): Promise<ConversationMessage | null> {
    const existing = this.messages(profileId).find((message) => message.id === messageId);
    if (!existing || existing.status !== 'failed') return null;

    this.replace(profileId, messageId, { status: 'sending' });
    await this.persist(profileId);

    const deviceId = this.deviceFor(profileId);
    if (!deviceId) return this.settle(profileId, messageId, 'failed');

    try {
      await this.sessions.send(
        deviceId,
        GattMessageType.ChatMessage,
        encodeChatMessage({ messageId, text: existing.text, sentAt: existing.at }),
      );
      return this.settle(profileId, messageId, 'sent');
    } catch {
      return this.settle(profileId, messageId, 'failed');
    }
  }

  /* ---------------------------------------------------------------- *
   * Inbound
   * ---------------------------------------------------------------- */

  private async onIncoming(deviceId: string, message: GattMessage): Promise<void> {
    const profileId = this.profileForDevice(deviceId);
    // A chat message on a link we cannot attribute to a person has nowhere to
    // go. Dropping it is right: filing it under a device id would create a
    // conversation that no screen can ever open.
    if (!profileId) return;

    const payload = decodeChatMessage(message.payload);
    if (!payload) return; // malformed; dropped without disturbing the link

    await this.load(profileId);

    const seen = this.seen.get(profileId);
    if (seen?.has(payload.messageId)) return; // redelivered

    this.append(profileId, {
      id: payload.messageId,
      mine: false,
      text: payload.text,
      // This phone's clock, not theirs. A wrong clock on the far side must not
      // be able to file a message in the middle of yesterday's history.
      at: this.now(),
      status: 'received',
    });
    await this.persist(profileId);
  }

  /* ---------------------------------------------------------------- *
   * Bookkeeping
   * ---------------------------------------------------------------- */

  private append(profileId: ProfileId, message: ConversationMessage): void {
    const current = this.conversations.get(profileId) ?? [];
    const next = [...current, message].slice(-MAX_STORED_MESSAGES);
    this.conversations.set(profileId, next);

    const seen = this.seen.get(profileId) ?? new Set<string>();
    seen.add(message.id);
    this.seen.set(profileId, seen);

    this.publish(profileId);
  }

  private replace(
    profileId: ProfileId,
    messageId: string,
    patch: Partial<ConversationMessage>,
  ): void {
    const current = this.conversations.get(profileId) ?? [];
    this.conversations.set(
      profileId,
      current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
    );
    this.publish(profileId);
  }

  private async settle(
    profileId: ProfileId,
    messageId: string,
    status: ChatMessageStatus,
  ): Promise<ConversationMessage> {
    this.replace(profileId, messageId, { status });
    await this.persist(profileId);
    const settled = this.messages(profileId).find((message) => message.id === messageId);
    if (!settled) throw new Error(`ConversationService lost message ${messageId}`);
    return settled;
  }

  private async persist(profileId: ProfileId): Promise<void> {
    if (!this.eventId) return;
    await this.db.set(keys.conversation(this.eventId, profileId), this.messages(profileId));
  }

  private publish(profileId: ProfileId): void {
    const snapshot = this.messages(profileId);
    for (const listener of this.listeners) listener(profileId, snapshot);
  }
}

export { MAX_CHAT_TEXT_BYTES };
