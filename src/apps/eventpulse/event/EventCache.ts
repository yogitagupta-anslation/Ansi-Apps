/**
 * EventCache — everything about an event that must survive a dead network.
 *
 * The rule from §44: with the internet off, BLE still works, nearby people
 * still appear, and their profiles still open. That is only true if the whole
 * attendee directory is on disk before the network goes away — so we persist
 * it aggressively on join and then reconcile in the background.
 */

import type { EventDetail, EventId, EventMembership, EventSummary } from '../types';
import { LocalDatabase, keys } from '../storage/LocalDatabase';
import type { DirectoryEntry, DirectorySnapshot } from './AttendeeDirectory';
import type { PeerIdWindow } from '../bluetooth/BleIdentity';
import { bytesToHex, hexToBytes } from '../utils/bytes';

export interface DirectorySyncState {
  cursor: string | null;
  syncedAt: number;
  /** Attendee count the server reported, for the "syncing 340/2400" hint. */
  expectedCount?: number;
}

export class EventCache {
  private readonly db: LocalDatabase;

  constructor(db: LocalDatabase) {
    this.db = db;
  }

  /* ------------------------- event list ------------------------- */

  async saveEventList(events: EventSummary[]): Promise<void> {
    await this.db.set(keys.eventList, events);
  }

  async loadEventList(): Promise<EventSummary[]> {
    return (await this.db.get<EventSummary[]>(keys.eventList)) ?? [];
  }

  /* ------------------------- event detail ------------------------- */

  async saveEvent(event: EventDetail): Promise<void> {
    await this.db.set(keys.eventDetail(event.id), event);
  }

  async loadEvent(eventId: EventId): Promise<EventDetail | null> {
    return this.db.get<EventDetail>(keys.eventDetail(eventId));
  }

  /* ------------------------- membership ------------------------- */

  async saveMembership(membership: EventMembership): Promise<void> {
    await this.db.set(keys.membership(membership.eventId), membership);
    await this.db.set(keys.lastEvent, membership.eventId);
  }

  async loadMembership(eventId: EventId): Promise<EventMembership | null> {
    return this.db.get<EventMembership>(keys.membership(eventId));
  }

  async loadLastEventId(): Promise<EventId | null> {
    return this.db.get<EventId>(keys.lastEvent);
  }

  async clearMembership(eventId: EventId): Promise<void> {
    await this.db.remove(keys.membership(eventId));
    const last = await this.db.get<EventId>(keys.lastEvent);
    if (last === eventId) await this.db.remove(keys.lastEvent);
  }

  /* ------------------------- identity ------------------------- */

  /**
   * The per-event identity seed. Stored hex-encoded because the local store is
   * JSON. On a production build this belongs in the platform keystore — see
   * docs/PRIVACY.md; the seed is the one piece of local state that is genuinely
   * sensitive, since it links a person to every id they broadcast.
   */
  async saveIdentitySeed(eventId: EventId, seed: Uint8Array): Promise<void> {
    await this.db.set(keys.identitySeed(eventId), bytesToHex(seed));
  }

  async loadIdentitySeed(eventId: EventId): Promise<Uint8Array | null> {
    const hex = await this.db.get<string>(keys.identitySeed(eventId));
    return hex ? hexToBytes(hex) : null;
  }

  async savePeerSchedule(eventId: EventId, windows: PeerIdWindow[]): Promise<void> {
    await this.db.set(keys.peerSchedule(eventId), windows);
  }

  async loadPeerSchedule(eventId: EventId): Promise<PeerIdWindow[]> {
    return (await this.db.get<PeerIdWindow[]>(keys.peerSchedule(eventId))) ?? [];
  }

  /* ------------------------- directory ------------------------- */

  async saveDirectory(snapshot: DirectorySnapshot): Promise<void> {
    await this.db.set(keys.directory(snapshot.eventId), snapshot.entries);
  }

  async loadDirectory(eventId: EventId): Promise<DirectoryEntry[]> {
    return (await this.db.get<DirectoryEntry[]>(keys.directory(eventId))) ?? [];
  }

  async saveSyncState(eventId: EventId, state: DirectorySyncState): Promise<void> {
    await this.db.set(keys.directorySync(eventId), state);
  }

  async loadSyncState(eventId: EventId): Promise<DirectorySyncState | null> {
    return this.db.get<DirectorySyncState>(keys.directorySync(eventId));
  }

  /** Leaving an event removes its cached people. Nothing lingers. */
  async clearEvent(eventId: EventId): Promise<void> {
    await this.db.clearEvent(eventId);
  }
}
