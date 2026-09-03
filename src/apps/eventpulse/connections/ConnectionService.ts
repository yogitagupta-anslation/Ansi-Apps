/**
 * ConnectionService — connecting, including when the venue Wi-Fi is a myth.
 *
 * Tapping Connect must feel instant and must not be lost. So every action is
 * applied optimistically to local state, written to a persisted outbox, and
 * replayed against the server when it becomes reachable. If the app is killed
 * mid-conference and reopened an hour later, the queued requests still go out.
 *
 * Messaging is deliberately out of scope for the MVP (§24). What a connection
 * buys you today is: a saved profile, a private note, and a record you can act
 * on after the event.
 */

import type { Connection, ConnectionState, EventId, ProfileId } from '../types';
import { ApiError, type EventPulseApi } from '../api/ApiClient';
import { LocalDatabase, keys } from '../storage/LocalDatabase';

type OutboxAction =
  | { kind: 'request'; eventId: EventId; profileId: ProfileId; note?: string; localId: string }
  | { kind: 'respond'; connectionId: string; accept: boolean };

interface OutboxItem {
  id: string;
  action: OutboxAction;
  attempts: number;
  queuedAt: number;
  lastError?: string;
}

export interface ConnectionServiceOptions {
  db: LocalDatabase;
  api: EventPulseApi;
  onChange?: (connections: Connection[]) => void;
}

export class ConnectionService {
  private readonly db: LocalDatabase;
  private readonly api: EventPulseApi;
  private readonly onChange?: (connections: Connection[]) => void;

  private connections = new Map<string, Connection>();
  private outbox: OutboxItem[] = [];
  private eventId: EventId | null = null;
  private flushPromise: Promise<void> | null = null;
  private counter = 0;

  constructor(options: ConnectionServiceOptions) {
    this.db = options.db;
    this.api = options.api;
    this.onChange = options.onChange;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async load(eventId: EventId): Promise<Connection[]> {
    this.eventId = eventId;
    const cached = (await this.db.get<Connection[]>(keys.connections(eventId))) ?? [];
    this.connections = new Map(cached.map((connection) => [connection.id, connection]));
    this.outbox = (await this.db.get<OutboxItem[]>(keys.outbox)) ?? [];
    this.emit();

    void this.refresh();
    void this.flush();
    return this.list();
  }

  /** Pull the server's view and merge it over ours, keeping unsent items. */
  async refresh(): Promise<void> {
    if (!this.eventId) return;
    try {
      const remote = await this.api.listConnections(this.eventId);
      for (const connection of remote) {
        const local = this.connections.get(connection.id);
        // A locally-queued item is newer than anything the server knows.
        if (local?.pendingSync) continue;
        this.connections.set(connection.id, connection);
      }
      await this.persist();
      this.emit();
    } catch {
      // Cached connections remain fully usable.
    }
  }

  /* ---------------------------------------------------------------- *
   * Reads
   * ---------------------------------------------------------------- */

  list(): Connection[] {
    return [...this.connections.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  connected(): Connection[] {
    return this.list().filter((connection) => connection.state === 'connected');
  }

  pendingIncoming(): Connection[] {
    return this.list().filter((connection) => connection.state === 'incoming_pending');
  }

  stateFor(profileId: ProfileId): ConnectionState {
    for (const connection of this.connections.values()) {
      if (connection.profileId === profileId) return connection.state;
    }
    return 'none';
  }

  connectedProfileIds(): Set<ProfileId> {
    const out = new Set<ProfileId>();
    for (const connection of this.connections.values()) {
      if (connection.state === 'connected') out.add(connection.profileId);
    }
    return out;
  }

  get queuedCount(): number {
    return this.outbox.length;
  }

  /* ---------------------------------------------------------------- *
   * Writes
   * ---------------------------------------------------------------- */

  async request(profileId: ProfileId, note?: string): Promise<Connection> {
    if (!this.eventId) throw new Error('ConnectionService.request called before load()');

    const existing = this.list().find((connection) => connection.profileId === profileId);
    if (existing && existing.state !== 'declined') return existing;

    const localId = `local_${Date.now()}_${++this.counter}`;
    const optimistic: Connection = {
      id: localId,
      eventId: this.eventId,
      profileId,
      state: 'outgoing_pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      note,
      pendingSync: true,
    };
    this.connections.set(localId, optimistic);
    this.enqueue({ kind: 'request', eventId: this.eventId, profileId, note, localId });
    await this.persist();
    this.emit();

    void this.flush();
    return optimistic;
  }

  async respond(connectionId: string, accept: boolean): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.state = accept ? 'connected' : 'declined';
    connection.updatedAt = Date.now();
    connection.pendingSync = true;
    this.enqueue({ kind: 'respond', connectionId, accept });
    await this.persist();
    this.emit();

    void this.flush();
  }

  /** Private note about someone you met. Never leaves the device. */
  async setNote(connectionId: string, note: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;
    connection.note = note;
    connection.updatedAt = Date.now();
    await this.persist();
    this.emit();
  }

  /** Blocking someone removes the connection locally, immediately. */
  async removeByProfile(profileId: ProfileId): Promise<void> {
    let changed = false;
    for (const [id, connection] of this.connections) {
      if (connection.profileId === profileId) {
        this.connections.delete(id);
        changed = true;
      }
    }
    this.outbox = this.outbox.filter(
      (item) => !(item.action.kind === 'request' && item.action.profileId === profileId),
    );
    if (changed) {
      await this.persist();
      this.emit();
    }
  }

  /* ---------------------------------------------------------------- *
   * Outbox
   * ---------------------------------------------------------------- */

  private enqueue(action: OutboxAction): void {
    this.outbox.push({
      id: `ob_${Date.now()}_${++this.counter}`,
      action,
      attempts: 0,
      queuedAt: Date.now(),
    });
  }

  /**
   * Drain the outbox.
   *
   * Concurrent callers are coalesced rather than dropped: `request()` kicks off
   * a background flush, and a later `await flush()` (say, when connectivity
   * returns) must not no-op just because that background pass happens to be
   * mid-await. Awaiting the in-flight pass and then starting a fresh one is
   * what makes "come back online and everything sends" actually true.
   */
  async flush(): Promise<void> {
    for (let guard = 0; this.flushPromise !== null && guard < 4; guard++) {
      await this.flushPromise;
    }
    if (this.outbox.length === 0) return;

    const pass = this.drainOutbox().finally(() => {
      if (this.flushPromise === pass) this.flushPromise = null;
    });
    this.flushPromise = pass;
    return pass;
  }

  private async drainOutbox(): Promise<void> {
    while (this.outbox.length > 0) {
      const item = this.outbox[0];
      item.attempts++;

      try {
        if (item.action.kind === 'request') {
          const created = await this.api.requestConnection(
            item.action.eventId,
            item.action.profileId,
            item.action.note,
          );
          // Swap the optimistic local row for the server's, keeping our note.
          const local = this.connections.get(item.action.localId);
          this.connections.delete(item.action.localId);
          this.connections.set(created.id, {
            ...created,
            note: local?.note ?? created.note,
            pendingSync: false,
          });
        } else {
          const updated = await this.api.respondToConnection(
            item.action.connectionId,
            item.action.accept,
          );
          this.connections.set(updated.id, { ...updated, pendingSync: false });
        }

        this.outbox.shift();
        await this.persist();
        this.emit();
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        item.lastError = (error as Error).message;

        if (apiError?.retryable) {
          // Still offline. Stop and keep the queue intact.
          await this.persist();
          return;
        }

        // A permanent failure (blocked, deleted, forbidden): drop the item
        // rather than retrying forever, and roll the optimistic row back.
        if (item.action.kind === 'request') {
          this.connections.delete(item.action.localId);
        }
        this.outbox.shift();
        await this.persist();
        this.emit();
      }
    }
  }

  private async persist(): Promise<void> {
    if (this.eventId) {
      await this.db.set(keys.connections(this.eventId), this.list());
    }
    await this.db.set(keys.outbox, this.outbox);
  }

  private emit(): void {
    this.onChange?.(this.list());
  }
}

/** Button label for the connect action, given the current state. */
export function connectionActionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'outgoing_pending':
      // "Request sent" over "Requested": the past tense alone reads as a state
      // you are in, which invites a second tap. This says the thing happened.
      return 'Request sent';
    case 'incoming_pending':
      return 'Accept';
    case 'declined':
      return 'Connect';
    default:
      return 'Connect';
  }
}
