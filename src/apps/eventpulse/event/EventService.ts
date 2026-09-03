/**
 * EventService — join, cache, reconcile.
 *
 * The ordering here is the whole product promise. Joining an event does not
 * mean "wait for a spinner"; it means:
 *
 *   1. hydrate whatever is already on disk and let the map open immediately,
 *   2. mint (or reload) the event-scoped identity seed and start advertising,
 *   3. publish our rotating peer ids so others can resolve us,
 *   4. pull the attendee directory in pages, in the background, applying each
 *      page as it lands so people become resolvable progressively.
 *
 * Every step degrades. Network down? Steps 1 and 2 still work, and the map is
 * fully functional for anyone already cached. That is the difference between an
 * app that works at a conference and one that works in an office.
 */

import type {
  EventDetail,
  EventId,
  EventMembership,
  EventSummary,
  PeerId,
  ProfileId,
  Visibility,
} from '../types';
import { ApiError, type EventPulseApi } from '../api/ApiClient';
import { PeerIdentityService, type PeerIdWindow } from '../bluetooth/BleIdentity';
import { AttendeeDirectory, type DirectoryEntry } from './AttendeeDirectory';
import { EventCache } from './EventCache';

export type SyncPhase = 'idle' | 'hydrating' | 'syncing' | 'synced' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  /** Attendees resolved so far. */
  loaded: number;
  /** Server-reported total, when known. */
  total: number | null;
  lastSyncedAt: number | null;
  error?: string;
  /** True when everything on screen came from disk. */
  fromCache: boolean;
}

export interface EventServiceOptions {
  api: EventPulseApi;
  cache: EventCache;
  identity?: PeerIdentityService;
  onDirectoryChanged?: (directory: AttendeeDirectory) => void;
  onSyncStatus?: (status: SyncStatus) => void;
  /** How often to re-pull the directory while in an event. */
  reconcileIntervalMs?: number;
}

export interface JoinOutcome {
  event: EventDetail;
  membership: EventMembership;
  directory: AttendeeDirectory;
  /** True when we joined from cache because the network was unavailable. */
  offline: boolean;
}

const DEFAULT_RECONCILE_MS = 90_000;

export class EventService {
  private readonly api: EventPulseApi;
  private readonly cache: EventCache;
  private readonly identity: PeerIdentityService;
  private readonly onDirectoryChanged?: (directory: AttendeeDirectory) => void;
  private readonly onSyncStatus?: (status: SyncStatus) => void;
  private readonly reconcileIntervalMs: number;

  private directoryInstance: AttendeeDirectory | null = null;
  private membership: EventMembership | null = null;
  private eventDetail: EventDetail | null = null;
  private seed: Uint8Array | null = null;
  private schedule: PeerIdWindow[] = [];

  private status: SyncStatus = {
    phase: 'idle',
    loaded: 0,
    total: null,
    lastSyncedAt: null,
    fromCache: false,
  };
  private reconcileHandle: ReturnType<typeof setInterval> | null = null;
  private syncInFlight: Promise<void> | null = null;
  /** Profiles whose advertised version outran our cache; refreshed in batches. */
  private staleProfiles = new Set<ProfileId>();

  constructor(options: EventServiceOptions) {
    this.api = options.api;
    this.cache = options.cache;
    this.identity = options.identity ?? new PeerIdentityService();
    this.onDirectoryChanged = options.onDirectoryChanged;
    this.onSyncStatus = options.onSyncStatus;
    this.reconcileIntervalMs = options.reconcileIntervalMs ?? DEFAULT_RECONCILE_MS;
  }

  get directory(): AttendeeDirectory | null {
    return this.directoryInstance;
  }

  get currentEvent(): EventDetail | null {
    return this.eventDetail;
  }

  get currentMembership(): EventMembership | null {
    return this.membership;
  }

  get syncStatus(): SyncStatus {
    return this.status;
  }

  /* ---------------------------------------------------------------- *
   * Event list
   * ---------------------------------------------------------------- */

  async listEvents(query?: string): Promise<{ events: EventSummary[]; fromCache: boolean }> {
    try {
      const events = await this.api.listEvents(query);
      await this.cache.saveEventList(events);
      return { events, fromCache: false };
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable) throw error;
      const cached = await this.cache.loadEventList();
      return { events: cached, fromCache: true };
    }
  }

  /* ---------------------------------------------------------------- *
   * Join / resume / leave
   * ---------------------------------------------------------------- */

  async join(eventId: EventId, visibility: Visibility, userId = 'me'): Promise<JoinOutcome> {
    this.setStatus({ phase: 'hydrating', loaded: 0, total: null, fromCache: true });

    // 1. Identity first: it is local, instant, and required before we can be seen.
    const seed = (await this.cache.loadIdentitySeed(eventId)) ?? this.identity.createSeed();
    await this.cache.saveIdentitySeed(eventId, seed);
    this.seed = seed;

    // 2. Hydrate from disk so the map can open now, network or not.
    const directory = new AttendeeDirectory(eventId);
    const cachedEntries = await this.cache.loadDirectory(eventId);
    if (cachedEntries.length) {
      directory.merge(cachedEntries, (await this.cache.loadSyncState(eventId))?.syncedAt ?? 0);
    }
    this.directoryInstance = directory;
    this.onDirectoryChanged?.(directory);

    const cachedEvent = await this.cache.loadEvent(eventId);
    let offline = false;
    let event = cachedEvent;
    let membershipVisibility = visibility;

    // 3. Tell the server, if we can reach it.
    try {
      const result = await this.api.joinEvent(eventId, visibility);
      event = result.event;
      membershipVisibility = result.membership.visibility;
      await this.cache.saveEvent(result.event);
    } catch (error) {
      if (!(error instanceof ApiError) || !error.retryable || !cachedEvent) throw error;
      offline = true;
    }

    if (!event) throw new ApiError('not_found', `Event ${eventId} is not available offline`);

    this.eventDetail = event;
    this.schedule = this.identity.schedule(seed, eventId, Date.now());
    await this.cache.savePeerSchedule(eventId, this.schedule);

    const membership: EventMembership = {
      eventId,
      userId,
      visibility: membershipVisibility,
      peerId: this.identity.currentPeerId(seed, eventId, Date.now()),
      joinedAt: Date.now(),
    };
    this.membership = membership;
    await this.cache.saveMembership(membership);

    this.setStatus({
      phase: offline ? 'offline' : 'syncing',
      loaded: directory.size,
      total: event.attendeeCount,
      fromCache: cachedEntries.length > 0,
    });

    if (!offline) {
      // 4. Fire and forget: the directory fills in behind the map.
      void this.publishSchedule();
      void this.syncDirectory({ full: cachedEntries.length === 0 });
      this.startReconciling();
    }

    return { event, membership, directory, offline };
  }

  /** Restore the last event on cold start, without waiting for the network. */
  async resume(userId = 'me'): Promise<JoinOutcome | null> {
    const eventId = await this.cache.loadLastEventId();
    if (!eventId) return null;
    const membership = await this.cache.loadMembership(eventId);
    if (!membership) return null;
    return this.join(eventId, membership.visibility, userId);
  }

  async leave(eventId: EventId): Promise<void> {
    this.stopReconciling();
    try {
      await this.api.leaveEvent(eventId);
    } catch {
      // Leaving is a local decision; the server catches up whenever it can.
    }
    await this.cache.clearMembership(eventId);
    await this.cache.clearEvent(eventId);
    this.directoryInstance?.clear();
    this.directoryInstance = null;
    this.membership = null;
    this.eventDetail = null;
    this.seed = null;
    this.schedule = [];
    this.setStatus({ phase: 'idle', loaded: 0, total: null, fromCache: false });
  }

  /* ---------------------------------------------------------------- *
   * Identity publishing
   * ---------------------------------------------------------------- */

  /** Current peer id, or null when the user is invisible or not in an event. */
  currentPeerId(now = Date.now()): PeerId | null {
    if (!this.seed || !this.membership) return null;
    if (this.membership.visibility === 'invisible') return null;
    return this.identity.currentPeerId(this.seed, this.membership.eventId, now);
  }

  nextRotationAt(now = Date.now()): number | null {
    if (!this.seed || !this.membership) return null;
    return this.identity.nextRotationAt(now);
  }

  avatarId(): string | null {
    if (!this.seed || !this.membership) return null;
    return this.identity.deriveAvatarId(this.seed, this.membership.eventId);
  }

  /**
   * Keep the published schedule ahead of the clock. Called on the reconcile
   * tick; if this ever falls behind, peers stop being able to resolve us and
   * we silently vanish from their maps — so it is worth being eager.
   */
  async ensurePeerSchedule(now = Date.now()): Promise<void> {
    if (!this.seed || !this.membership) return;
    if (!this.identity.needsRepublish(this.schedule, now)) return;
    this.schedule = this.identity.schedule(this.seed, this.membership.eventId, now);
    await this.cache.savePeerSchedule(this.membership.eventId, this.schedule);
    await this.publishSchedule();
  }

  private async publishSchedule(): Promise<void> {
    if (!this.membership) return;
    try {
      await this.api.publishPeerSchedule(this.membership.eventId, this.schedule);
    } catch {
      // Retried on the next reconcile tick.
    }
  }

  /* ---------------------------------------------------------------- *
   * Directory sync
   * ---------------------------------------------------------------- */

  /**
   * Page through the directory, applying each page as it arrives so people
   * become resolvable progressively rather than all at once at the end.
   */
  async syncDirectory(options: { full?: boolean } = {}): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight;
    const directory = this.directoryInstance;
    const eventId = this.membership?.eventId;
    if (!directory || !eventId) return;

    const run = async (): Promise<void> => {
      const previous = await this.cache.loadSyncState(eventId);
      let cursor = options.full ? null : (previous?.cursor ?? null);
      let guard = 0;

      this.setStatus({ phase: 'syncing', loaded: directory.size, fromCache: false });

      try {
        for (;;) {
          const page = await this.api.getDirectory(eventId, cursor);
          if (page.entries.length) {
            directory.merge(page.entries, page.syncedAt);
            this.onDirectoryChanged?.(directory);
          }

          cursor = page.cursor;
          await this.cache.saveDirectory(directory.toSnapshot());
          await this.cache.saveSyncState(eventId, {
            cursor,
            syncedAt: page.syncedAt,
            expectedCount: this.eventDetail?.attendeeCount,
          });
          this.setStatus({ phase: 'syncing', loaded: directory.size, fromCache: false });

          if (!page.hasMore) break;
          // Belt and braces against a server that never sets hasMore=false.
          if (++guard > 200) break;
        }

        this.setStatus({
          phase: 'synced',
          loaded: directory.size,
          lastSyncedAt: Date.now(),
          fromCache: false,
        });
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        this.setStatus({
          phase: apiError?.retryable ? 'offline' : 'error',
          loaded: directory.size,
          error: (error as Error).message,
          fromCache: true,
        });
      }
    };

    this.syncInFlight = run().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  /**
   * A peer is advertising a newer profile version than we hold (§58). We note
   * it and refresh through the normal API — we never open a BLE connection to
   * pull a profile.
   */
  noteProfileVersion(peerId: PeerId, advertisedVersion: number): void {
    const directory = this.directoryInstance;
    if (!directory) return;
    if (!directory.isStale(peerId, advertisedVersion)) return;
    const attendee = directory.resolvePeer(peerId);
    if (attendee) this.staleProfiles.add(attendee.profile.id);
  }

  async refreshStaleProfiles(): Promise<void> {
    const directory = this.directoryInstance;
    const eventId = this.membership?.eventId;
    if (!directory || !eventId || this.staleProfiles.size === 0) return;

    const batch = [...this.staleProfiles].slice(0, 40);
    try {
      const entries: DirectoryEntry[] = await this.api.getProfiles(eventId, batch);
      directory.merge(entries, Date.now());
      this.onDirectoryChanged?.(directory);
      await this.cache.saveDirectory(directory.toSnapshot());
      for (const id of batch) this.staleProfiles.delete(id);
    } catch {
      // Leave them queued; the next tick tries again.
    }
  }

  private startReconciling(): void {
    this.stopReconciling();
    this.reconcileHandle = setInterval(() => {
      void this.ensurePeerSchedule();
      void this.syncDirectory();
      void this.refreshStaleProfiles();
    }, this.reconcileIntervalMs);
    (this.reconcileHandle as unknown as { unref?: () => void }).unref?.();
  }

  private stopReconciling(): void {
    if (this.reconcileHandle !== null) clearInterval(this.reconcileHandle);
    this.reconcileHandle = null;
  }

  dispose(): void {
    this.stopReconciling();
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onSyncStatus?.(this.status);
  }
}
