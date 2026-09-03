/**
 * AttendeeDirectory — the reason tapping ⓘ is instant.
 *
 * When a BLE packet says "peer 82AF91C4 is nearby", we do not connect to that
 * device and ask who it is. We look the id up in a table we already have, in
 * memory, and render the full professional profile in the same frame. No
 * pairing, no round trip, no spinner — and it still works with the network off.
 *
 * The table is populated once on join and reconciled in the background. It
 * holds, per attendee: their profile, their event-specific overlay, and the
 * set of rotating peer ids they will broadcast over the next few hours.
 */

import type {
  Attendee,
  EventId,
  EventProfile,
  PeerId,
  PeopleFilter,
  Profile,
  ProfileId,
  Visibility,
} from '../types';
import type { CollectionRecord } from '../storage/LocalDatabase';

export interface DirectoryEntry extends CollectionRecord {
  /** Equals `profile.id`. */
  id: ProfileId;
  profile: Profile;
  eventProfile: EventProfile;
  visibility: Visibility;
  /** Peer ids this attendee may broadcast during the covered window. */
  peerIds: PeerId[];
  /**
   * How many connections you and this attendee share, supplied by the server.
   *
   * It has to come from the server: a device knows its own connections and
   * nobody else's, so this is not derivable on-device. A count only — never the
   * names — because listing them would disclose a third party's network to
   * someone they have not met.
   */
  mutualConnectionCount?: number;
  updatedAt: number;
  /** Tombstone for an attendee who left or was removed by an organiser. */
  deleted?: boolean;
}

export interface DirectorySnapshot {
  eventId: EventId;
  entries: DirectoryEntry[];
  /** Server cursor for incremental sync. */
  cursor?: string;
  syncedAt: number;
}

export interface DirectoryStats {
  attendees: number;
  peerMappings: number;
  lastSyncedAt: number | null;
}

export class AttendeeDirectory {
  private readonly entries = new Map<ProfileId, DirectoryEntry>();
  /** peerId -> profileId. The hot path; a plain Map is the right structure. */
  private readonly peerIndex = new Map<PeerId, ProfileId>();
  /** Lowercased haystack per attendee for Discover's free-text search. */
  private readonly searchIndex = new Map<ProfileId, string>();

  private blocked = new Set<ProfileId>();
  private connections = new Set<ProfileId>();
  private lastSyncedAt: number | null = null;
  private revisionCounter = 0;

  readonly eventId: EventId;

  constructor(eventId: EventId) {
    this.eventId = eventId;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  get size(): number {
    return this.entries.size;
  }

  stats(): DirectoryStats {
    return {
      attendees: this.entries.size,
      peerMappings: this.peerIndex.size,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  /* ---------------------------------------------------------------- *
   * Population
   * ---------------------------------------------------------------- */

  /** Replace the whole directory — the initial download after joining. */
  load(snapshot: DirectorySnapshot): void {
    this.entries.clear();
    this.peerIndex.clear();
    this.searchIndex.clear();
    this.applyEntries(snapshot.entries);
    this.lastSyncedAt = snapshot.syncedAt;
    this.revisionCounter++;
  }

  /** Fold in an incremental update: new people, edits, and tombstones. */
  merge(entries: readonly DirectoryEntry[], syncedAt: number): void {
    this.applyEntries(entries);
    this.lastSyncedAt = syncedAt;
    this.revisionCounter++;
  }

  private applyEntries(entries: readonly DirectoryEntry[]): void {
    for (const entry of entries) {
      if (entry.deleted) {
        this.removeEntry(entry.id);
        continue;
      }

      const existing = this.entries.get(entry.id);
      if (existing) {
        // Out-of-order delivery is normal with an incremental cursor; never let
        // an older payload clobber a newer profile.
        if (
          existing.profile.version > entry.profile.version &&
          existing.updatedAt >= entry.updatedAt
        ) {
          continue;
        }
        for (const peerId of existing.peerIds) {
          if (this.peerIndex.get(peerId) === entry.id) this.peerIndex.delete(peerId);
        }
      }

      this.entries.set(entry.id, entry);
      for (const peerId of entry.peerIds) this.peerIndex.set(peerId, entry.id);
      this.searchIndex.set(entry.id, buildHaystack(entry));
    }
  }

  private removeEntry(profileId: ProfileId): void {
    const existing = this.entries.get(profileId);
    if (!existing) return;
    for (const peerId of existing.peerIds) {
      if (this.peerIndex.get(peerId) === profileId) this.peerIndex.delete(peerId);
    }
    this.entries.delete(profileId);
    this.searchIndex.delete(profileId);
  }

  /**
   * Register peer ids we learned about outside a full sync (for example from a
   * connection exchange), without waiting for the next directory pull.
   */
  addPeerMapping(peerId: PeerId, profileId: ProfileId): void {
    if (!this.entries.has(profileId)) return;
    this.peerIndex.set(peerId, profileId);
  }

  /* ---------------------------------------------------------------- *
   * Blocking + connections
   * ---------------------------------------------------------------- */

  setBlocked(profileIds: Iterable<ProfileId>): void {
    this.blocked = new Set(profileIds);
    this.revisionCounter++;
  }

  setConnections(profileIds: Iterable<ProfileId>): void {
    this.connections = new Set(profileIds);
    this.revisionCounter++;
  }

  isBlocked(profileId: ProfileId): boolean {
    return this.blocked.has(profileId);
  }

  /** Peer ids belonging to blocked people — handed to `PeerRegistry` to drop at the edge. */
  blockedPeerIds(): PeerId[] {
    const out: PeerId[] = [];
    for (const profileId of this.blocked) {
      const entry = this.entries.get(profileId);
      if (entry) out.push(...entry.peerIds);
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Lookup
   * ---------------------------------------------------------------- */

  /** The hot path. Two Map lookups, no allocation on a miss. */
  resolvePeer(peerId: PeerId): Attendee | null {
    const profileId = this.peerIndex.get(peerId);
    if (profileId === undefined) return null;
    return this.getAttendee(profileId, peerId);
  }

  hasPeer(peerId: PeerId): boolean {
    return this.peerIndex.has(peerId);
  }

  getAttendee(profileId: ProfileId, peerId?: PeerId): Attendee | null {
    const entry = this.entries.get(profileId);
    if (!entry) return null;
    return {
      profile: entry.profile,
      eventProfile: entry.eventProfile,
      peerId,
      visibility: entry.visibility,
      isConnection: this.connections.has(profileId),
      isBlocked: this.blocked.has(profileId),
      mutualConnectionCount: entry.mutualConnectionCount,
    };
  }

  getEntry(profileId: ProfileId): DirectoryEntry | undefined {
    return this.entries.get(profileId);
  }

  /** Everyone in the directory, excluding blocked people and invisible members. */
  all(): Attendee[] {
    const out: Attendee[] = [];
    for (const entry of this.entries.values()) {
      if (this.blocked.has(entry.id)) continue;
      if (entry.visibility === 'invisible') continue;
      if (entry.visibility === 'connections_only' && !this.connections.has(entry.id)) continue;
      const attendee = this.getAttendee(entry.id);
      if (attendee) out.push(attendee);
    }
    return out;
  }

  /**
   * A cached profile whose version is older than what the peer is advertising.
   * `EventService` uses this to prioritise which profiles to refresh — we do
   * not open a BLE connection to fetch it (§58).
   */
  isStale(peerId: PeerId, advertisedVersion: number): boolean {
    const profileId = this.peerIndex.get(peerId);
    if (profileId === undefined) return false;
    const entry = this.entries.get(profileId);
    if (!entry) return false;
    // Profile version is a byte on the wire, so compare modulo 256.
    return (entry.profile.version & 0xff) !== (advertisedVersion & 0xff);
  }

  /* ---------------------------------------------------------------- *
   * Search
   * ---------------------------------------------------------------- */

  search(filter: PeopleFilter, nearby?: Map<ProfileId, number>): Attendee[] {
    const query = filter.query?.trim().toLowerCase();
    const results: Attendee[] = [];

    for (const entry of this.entries.values()) {
      if (this.blocked.has(entry.id)) continue;
      if (entry.visibility === 'invisible') continue;
      if (entry.visibility === 'connections_only' && !this.connections.has(entry.id)) continue;

      if (query && !this.searchIndex.get(entry.id)?.includes(query)) continue;
      if (!matchesFilter(entry, filter)) continue;

      if (filter.nearbyOnly && !nearby?.has(entry.id)) continue;
      if (filter.maxDistance !== undefined) {
        const distance = nearby?.get(entry.id);
        if (distance === undefined || distance > filter.maxDistance) continue;
      }

      const attendee = this.getAttendee(entry.id);
      if (attendee) results.push(attendee);
    }

    // Nearest first when we know, then alphabetical — a deterministic order
    // matters more than cleverness for a list people scroll.
    results.sort((a, b) => {
      const da = nearby?.get(a.profile.id);
      const db = nearby?.get(b.profile.id);
      if (da !== undefined && db !== undefined && da !== db) return da - db;
      if (da !== undefined && db === undefined) return -1;
      if (db !== undefined && da === undefined) return 1;
      return a.profile.name.localeCompare(b.profile.name);
    });

    return results;
  }

  /** Distinct values for a facet, most common first — powers the filter chips. */
  facet(field: 'company' | 'skills' | 'interests' | 'industry', limit = 20): string[] {
    const counts = new Map<string, number>();
    for (const entry of this.entries.values()) {
      if (this.blocked.has(entry.id)) continue;
      const values =
        field === 'skills'
          ? entry.profile.skills
          : field === 'interests'
            ? entry.profile.interests
            : field === 'company'
              ? [entry.profile.company]
              : [entry.profile.industry];
      for (const value of values) {
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value]) => value);
  }

  toSnapshot(): DirectorySnapshot {
    return {
      eventId: this.eventId,
      entries: [...this.entries.values()],
      syncedAt: this.lastSyncedAt ?? 0,
    };
  }

  clear(): void {
    this.entries.clear();
    this.peerIndex.clear();
    this.searchIndex.clear();
    this.lastSyncedAt = null;
    this.revisionCounter++;
  }
}

function buildHaystack(entry: DirectoryEntry): string {
  const { profile, eventProfile } = entry;
  return [
    profile.name,
    profile.role,
    profile.company,
    profile.headline,
    profile.industry,
    profile.category,
    ...profile.skills,
    ...profile.interests,
    eventProfile.whyAttending,
    eventProfile.currentProject,
    ...(eventProfile.lookingToMeet ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesFilter(entry: DirectoryEntry, filter: PeopleFilter): boolean {
  const { profile, eventProfile } = entry;

  if (filter.categories?.length && !filter.categories.includes(profile.category)) return false;

  if (filter.companies?.length) {
    const company = profile.company?.toLowerCase() ?? '';
    if (!filter.companies.some((c) => company === c.toLowerCase())) return false;
  }

  if (filter.skills?.length) {
    const skills = profile.skills.map((s) => s.toLowerCase());
    if (!filter.skills.some((s) => skills.includes(s.toLowerCase()))) return false;
  }

  if (filter.interests?.length) {
    const interests = profile.interests.map((s) => s.toLowerCase());
    if (!filter.interests.some((s) => interests.includes(s.toLowerCase()))) return false;
  }

  const experience = profile.experienceYears ?? 0;
  if (filter.minExperience !== undefined && experience < filter.minExperience) return false;
  if (filter.maxExperience !== undefined && experience > filter.maxExperience) return false;

  if (filter.availableOnly && eventProfile.availability !== 'available') return false;

  if (filter.lookingFor?.length) {
    const wants = (eventProfile.lookingToMeet ?? []).map((s) => s.toLowerCase());
    if (!filter.lookingFor.some((s) => wants.includes(s.toLowerCase()))) return false;
  }

  return true;
}
