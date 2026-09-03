/**
 * MockApi — a complete, in-memory EventPulse backend.
 *
 * It exists so the app is runnable and reviewable end to end without standing
 * up Postgres: same interface, same failure modes (latency, offline, 404s),
 * same incremental-sync semantics. Flip `EVENTPULSE_API` to `http` and the
 * real backend takes over with no changes above this seam.
 *
 * It is also what keeps the directory and the crowd simulator consistent: both
 * read the same generated attendee set, so the person the radio says is nearby
 * is the person the directory can resolve.
 */

import type {
  Connection,
  EventDetail,
  EventId,
  EventSummary,
  PeopleFilter,
  Profile,
  ProfileId,
  Visibility,
} from '../types';
import type { DirectoryEntry } from '../event/AttendeeDirectory';
import type { PeerIdWindow } from '../bluetooth/BleIdentity';
import { PeerIdentityService } from '../bluetooth/BleIdentity';
import { fnv1a32 } from '../utils/bytes';
import {
  generateAttendees,
  generateEvents,
  type GeneratedAttendee,
} from '../dev/seed';
import { ApiError, type DirectoryPage, type EventPulseApi, type JoinEventResult } from './ApiClient';

export interface MockApiOptions {
  /** Simulated round-trip latency in ms. */
  latencyMs?: number;
  /** Attendees generated per event. */
  attendeesPerEvent?: number;
  seed?: number;
  /** Start offline; toggle at runtime from the dev panel. */
  offline?: boolean;
}

interface EventState {
  detail: EventDetail;
  attendees: GeneratedAttendee[];
  entries: Map<ProfileId, DirectoryEntry>;
  connections: Map<string, Connection>;
  joined: boolean;
  visibility: Visibility;
  myPeerSchedule: PeerIdWindow[];
}

const identity = new PeerIdentityService();

/** Deterministic per-attendee seed so peer ids are stable across restarts. */
function seedFor(profileId: string): Uint8Array {
  const out = new Uint8Array(16);
  let hash = fnv1a32(profileId);
  for (let i = 0; i < 16; i++) {
    hash = (Math.imul(hash ^ (i + 1), 0x01000193) >>> 0) || 1;
    out[i] = hash & 0xff;
  }
  return out;
}

export class MockApi implements EventPulseApi {
  private readonly events = new Map<EventId, EventState>();
  private readonly blocked = new Set<ProfileId>();
  private readonly reports: { profileId: ProfileId; reason: string; details?: string }[] = [];
  private readonly latencyMs: number;
  private offline: boolean;
  private connectionCounter = 0;

  constructor(options: MockApiOptions = {}) {
    this.latencyMs = options.latencyMs ?? 220;
    this.offline = options.offline ?? false;

    const attendeesPerEvent = options.attendeesPerEvent ?? 90;
    const now = Date.now();

    for (const detail of generateEvents(now)) {
      const attendees = generateAttendees(
        detail.id,
        Math.min(attendeesPerEvent, detail.attendeeCount),
        (options.seed ?? 20260101) + fnv1a32(detail.id),
      );
      const entries = new Map<ProfileId, DirectoryEntry>();
      for (const attendee of attendees) {
        entries.set(attendee.profile.id, this.entryFor(detail.id, attendee, now));
      }
      this.events.set(detail.id, {
        detail,
        attendees,
        entries,
        connections: new Map(),
        joined: false,
        visibility: 'visible',
        myPeerSchedule: [],
      });
    }
  }

  /* ---------------------------------------------------------------- *
   * Dev controls
   * ---------------------------------------------------------------- */

  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  get isOffline(): boolean {
    return this.offline;
  }

  /** The generated crowd for an event — used to seed the BLE simulator. */
  attendeesFor(eventId: EventId): GeneratedAttendee[] {
    return this.events.get(eventId)?.attendees ?? [];
  }

  /** The peer id an attendee is broadcasting right now. */
  currentPeerIdFor(eventId: EventId, profileId: ProfileId, now = Date.now()): string {
    return identity.currentPeerId(seedFor(profileId), eventId, now);
  }

  /** Simulate someone editing their profile mid-event (§58). */
  bumpProfileVersion(eventId: EventId, profileId: ProfileId, patch: Partial<Profile>): void {
    const state = this.events.get(eventId);
    const entry = state?.entries.get(profileId);
    if (!state || !entry) return;
    entry.profile = {
      ...entry.profile,
      ...patch,
      version: entry.profile.version + 1,
      updatedAt: Date.now(),
    };
    entry.updatedAt = Date.now();
  }

  private entryFor(eventId: EventId, attendee: GeneratedAttendee, now: number): DirectoryEntry {
    const seed = seedFor(attendee.profile.id);
    return {
      id: attendee.profile.id,
      profile: attendee.profile,
      eventProfile: attendee.eventProfile,
      // A slice of attendees keep to themselves — the map has to respect that.
      visibility:
        attendee.eventProfile.availability === 'busy' && fnv1a32(attendee.profile.id) % 11 === 0
          ? 'connections_only'
          : 'visible',
      peerIds: identity.schedule(seed, eventId, now, 12).map((window) => window.peerId),
      updatedAt: now,
      // The mock server's own social graph. A real deployment computes this by
      // intersecting two connection lists server-side; here it is derived from
      // the profile id so it stays stable across restarts — a mutual count that
      // changed every launch would look like a bug, not a demo.
      mutualConnectionCount: mutualsFor(attendee.profile.id),
    };
  }

  /* ---------------------------------------------------------------- *
   * Transport simulation
   * ---------------------------------------------------------------- */

  private async call<T>(fn: () => T): Promise<T> {
    if (this.offline) {
      await delay(80);
      throw new ApiError('network', 'Network unavailable');
    }
    await delay(this.latencyMs);
    return fn();
  }

  private requireEvent(eventId: EventId): EventState {
    const state = this.events.get(eventId);
    if (!state) throw new ApiError('not_found', `No such event: ${eventId}`);
    return state;
  }

  private requireMembership(eventId: EventId): EventState {
    const state = this.requireEvent(eventId);
    if (!state.joined) throw new ApiError('forbidden', 'Join the event before reading its directory');
    return state;
  }

  /* ---------------------------------------------------------------- *
   * API surface
   * ---------------------------------------------------------------- */

  listEvents(query?: string): Promise<EventSummary[]> {
    return this.call(() => {
      const all = [...this.events.values()].map((state) => state.detail as EventSummary);
      if (!query) return all;
      const needle = query.toLowerCase();
      return all.filter(
        (event) =>
          event.name.toLowerCase().includes(needle) ||
          event.tags.some((tag) => tag.toLowerCase().includes(needle)),
      );
    });
  }

  getEvent(eventId: EventId): Promise<EventDetail> {
    return this.call(() => this.requireEvent(eventId).detail);
  }

  joinEvent(eventId: EventId, visibility: Visibility): Promise<JoinEventResult> {
    return this.call(() => {
      const state = this.requireEvent(eventId);
      state.joined = true;
      state.visibility = visibility;
      return {
        event: state.detail,
        membership: { eventId, visibility, joinedAt: Date.now() },
      };
    });
  }

  leaveEvent(eventId: EventId): Promise<void> {
    return this.call(() => {
      const state = this.requireEvent(eventId);
      state.joined = false;
      state.myPeerSchedule = [];
    });
  }

  getDirectory(eventId: EventId, since?: string | null): Promise<DirectoryPage> {
    return this.call(() => {
      const state = this.requireMembership(eventId);
      const all = [...state.entries.values()].sort((a, b) => a.id.localeCompare(b.id));

      // Cursor is "last id delivered" — simple, stable, and resumable.
      const startIndex = since ? all.findIndex((entry) => entry.id === since) + 1 : 0;
      const pageSize = 60;
      const page = all.slice(startIndex, startIndex + pageSize);
      const hasMore = startIndex + pageSize < all.length;

      return {
        entries: page,
        cursor: page.length ? page[page.length - 1].id : null,
        hasMore,
        syncedAt: Date.now(),
      };
    });
  }

  getProfiles(eventId: EventId, profileIds: ProfileId[]): Promise<DirectoryEntry[]> {
    return this.call(() => {
      const state = this.requireMembership(eventId);
      return profileIds
        .map((id) => state.entries.get(id))
        .filter((entry): entry is DirectoryEntry => Boolean(entry));
    });
  }

  publishPeerSchedule(eventId: EventId, windows: PeerIdWindow[]): Promise<void> {
    return this.call(() => {
      this.requireMembership(eventId).myPeerSchedule = windows;
    });
  }

  updateProfile(profile: Profile): Promise<Profile> {
    return this.call(() => ({ ...profile, version: profile.version + 1, updatedAt: Date.now() }));
  }

  updateEventProfile(eventId: EventId, _patch: Record<string, unknown>): Promise<void> {
    return this.call(() => {
      this.requireMembership(eventId);
    });
  }

  updateVisibility(eventId: EventId, visibility: Visibility): Promise<void> {
    return this.call(() => {
      this.requireMembership(eventId).visibility = visibility;
    });
  }

  listConnections(eventId: EventId): Promise<Connection[]> {
    return this.call(() => [...this.requireMembership(eventId).connections.values()]);
  }

  requestConnection(eventId: EventId, profileId: ProfileId, note?: string): Promise<Connection> {
    return this.call(() => {
      const state = this.requireMembership(eventId);
      if (this.blocked.has(profileId)) {
        throw new ApiError('forbidden', 'You have blocked this person');
      }
      const existing = [...state.connections.values()].find((c) => c.profileId === profileId);
      if (existing) return existing;

      const connection: Connection = {
        id: `c_${++this.connectionCounter}`,
        eventId,
        profileId,
        state: 'outgoing_pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        note,
      };
      state.connections.set(connection.id, connection);

      // Demo affordance: most people at an event accept, after a moment.
      const acceptDelay = 2_500 + (fnv1a32(profileId) % 5_000);
      setTimeout(() => {
        const current = state.connections.get(connection.id);
        if (current?.state === 'outgoing_pending') {
          current.state = 'connected';
          current.updatedAt = Date.now();
        }
      }, acceptDelay);

      return connection;
    });
  }

  respondToConnection(connectionId: string, accept: boolean): Promise<Connection> {
    return this.call(() => {
      for (const state of this.events.values()) {
        const connection = state.connections.get(connectionId);
        if (!connection) continue;
        connection.state = accept ? 'connected' : 'declined';
        connection.updatedAt = Date.now();
        return connection;
      }
      throw new ApiError('not_found', `No such connection: ${connectionId}`);
    });
  }

  blockUser(profileId: ProfileId): Promise<void> {
    return this.call(() => {
      this.blocked.add(profileId);
      // Blocking severs any existing connection in both directions.
      for (const state of this.events.values()) {
        for (const [id, connection] of state.connections) {
          if (connection.profileId === profileId) state.connections.delete(id);
        }
      }
    });
  }

  unblockUser(profileId: ProfileId): Promise<void> {
    return this.call(() => {
      this.blocked.delete(profileId);
    });
  }

  reportUser(profileId: ProfileId, reason: string, details?: string): Promise<void> {
    return this.call(() => {
      this.reports.push({ profileId, reason, details });
    });
  }

  searchAttendees(eventId: EventId, filter: PeopleFilter): Promise<DirectoryEntry[]> {
    return this.call(() => {
      const state = this.requireMembership(eventId);
      const needle = filter.query?.toLowerCase();
      return [...state.entries.values()].filter((entry) => {
        if (this.blocked.has(entry.id)) return false;
        if (!needle) return true;
        return (
          entry.profile.name.toLowerCase().includes(needle) ||
          (entry.profile.company ?? '').toLowerCase().includes(needle) ||
          (entry.profile.role ?? '').toLowerCase().includes(needle)
        );
      });
    });
  }
}

/**
 * Roughly a fifth of attendees share a connection with you, a few share several.
 * Skewed rather than uniform because that is what a real event looks like: most
 * people are strangers, a handful are one introduction away.
 */
function mutualsFor(profileId: ProfileId): number | undefined {
  const roll = fnv1a32(`mutual:${profileId}`) % 100;
  if (roll < 78) return undefined;
  if (roll < 92) return 1;
  if (roll < 98) return 2;
  return 3 + (roll % 3);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}
