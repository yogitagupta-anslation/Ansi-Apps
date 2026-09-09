/**
 * AttendeeDirectory — the resolution layer between a rotating peer id and a
 * person, and the place where a block is turned into something the radio layer
 * can act on.
 *
 * The directory owns no I/O, so everything here exercises the real class: no
 * mocks, no fakes, no timers. The only fixtures are complete `DirectoryEntry`
 * literals built by `person()` below, which is the shape the sync layer hands it.
 *
 * Three cases are recorded with `it.failing`. They pass while the defect is
 * present and turn red the day it is fixed; each carries the file:line of the
 * code it indicts.
 */

import {
  AttendeeDirectory,
  type DirectoryEntry,
  type DirectorySnapshot,
} from '../event/AttendeeDirectory';
import type {
  Attendee,
  Availability,
  EventProfile,
  PeerId,
  PersonCategory,
  Profile,
  ProfileId,
  Visibility,
} from '../types';

const EVENT_ID = 'evt-devcon-2026';

interface PersonSpec {
  id: ProfileId;
  name: string;
  peerIds?: PeerId[];
  category?: PersonCategory;
  role?: string;
  company?: string;
  headline?: string;
  industry?: string;
  skills?: string[];
  interests?: string[];
  bio?: string;
  experienceYears?: number;
  version?: number;
  updatedAt?: number;
  visibility?: Visibility;
  availability?: Availability;
  whyAttending?: string;
  currentProject?: string;
  lookingToMeet?: string[];
  mutualConnectionCount?: number;
  deleted?: boolean;
}

/** A complete directory entry — the shape the server actually delivers. */
function person(spec: PersonSpec): DirectoryEntry {
  const profile: Profile = {
    id: spec.id,
    userId: 'user-' + spec.id,
    name: spec.name,
    headline: spec.headline,
    company: spec.company,
    role: spec.role,
    category: spec.category ?? 'other',
    experienceYears: spec.experienceYears,
    industry: spec.industry,
    skills: spec.skills ?? [],
    interests: spec.interests ?? [],
    bio: spec.bio,
    avatar: { kind: 'initials', avatarId: 'av-' + spec.id, hue: 210 },
    version: spec.version ?? 1,
    updatedAt: spec.updatedAt ?? 1_000,
  };
  const eventProfile: EventProfile = {
    eventId: EVENT_ID,
    profileId: spec.id,
    whyAttending: spec.whyAttending,
    lookingToMeet: spec.lookingToMeet,
    currentProject: spec.currentProject,
    availability: spec.availability ?? 'available',
  };
  return {
    id: spec.id,
    profile,
    eventProfile,
    visibility: spec.visibility ?? 'visible',
    peerIds: spec.peerIds ?? [],
    mutualConnectionCount: spec.mutualConnectionCount,
    updatedAt: spec.updatedAt ?? 1_000,
    deleted: spec.deleted,
  };
}

/**
 * The standing cast. Rebuilt per test so no test can mutate another's entries.
 *
 * Alphabetically: Ada Lovelace, Alan Turing, Betty Holberton, Grace Hopper —
 * which is the tie-break order `search()` falls back on.
 */
function cast(): DirectoryEntry[] {
  return [
    person({
      id: 'ada',
      name: 'Ada Lovelace',
      role: 'Staff Engineer',
      company: 'Analytical Engines',
      category: 'engineer',
      industry: 'Software',
      skills: ['Rust', 'Compilers'],
      interests: ['Mathematics', 'Chess'],
      experienceYears: 10,
      availability: 'available',
      whyAttending: 'Hiring for a compiler team',
      peerIds: ['peer-ada-1', 'peer-ada-2'],
      version: 4,
    }),
    person({
      id: 'grace',
      name: 'Grace Hopper',
      role: 'Rear Admiral',
      company: 'Naval Systems',
      category: 'engineer',
      industry: 'Software',
      skills: ['COBOL', 'Compilers'],
      interests: ['Teaching'],
      experienceYears: 30,
      availability: 'busy',
      peerIds: ['peer-grace-1'],
      version: 2,
    }),
    person({
      id: 'alan',
      name: 'Alan Turing',
      role: 'Researcher',
      company: 'Bletchley',
      category: 'data',
      industry: 'Research',
      skills: ['Cryptanalysis'],
      interests: ['Mathematics'],
      experienceYears: 5,
      availability: 'available',
      currentProject: 'A universal machine',
      peerIds: ['peer-alan-1'],
    }),
    person({
      id: 'betty',
      name: 'Betty Holberton',
      role: 'Programmer',
      company: 'Analytical Engines',
      category: 'product',
      skills: ['ENIAC'],
      interests: ['Chess'],
      availability: 'maybe',
      lookingToMeet: ['Mentors'],
      bio: 'Wrote the first sort routine',
      peerIds: ['peer-betty-1'],
    }),
  ];
}

function loaded(entries: DirectoryEntry[] = cast(), syncedAt = 1_700): AttendeeDirectory {
  const directory = new AttendeeDirectory(EVENT_ID);
  directory.merge(entries, syncedAt);
  return directory;
}

function names(attendees: Attendee[]): string[] {
  return attendees.map((attendee) => attendee.profile.name);
}

describe('merge() and peer resolution', () => {
  it('maps every peer id an entry claims to that attendee, tagged with the id it was found by', () => {
    const directory = loaded();

    const first = directory.resolvePeer('peer-ada-1');
    const second = directory.resolvePeer('peer-ada-2');

    expect(first?.profile.id).toBe('ada');
    expect(first?.peerId).toBe('peer-ada-1');
    expect(second?.profile.id).toBe('ada');
    expect(second?.peerId).toBe('peer-ada-2');
    expect(directory.size).toBe(4);
    expect(directory.stats()).toEqual({ attendees: 4, peerMappings: 5, lastSyncedAt: 1_700 });
  });

  it('resolves an unknown peer id to null rather than an empty attendee', () => {
    const directory = loaded();

    expect(directory.resolvePeer('peer-nobody')).toBeNull();
    expect(directory.hasPeer('peer-nobody')).toBe(false);
    expect(directory.getAttendee('nobody')).toBeNull();
    expect(directory.getEntry('nobody')).toBeUndefined();
  });

  it('replaces an entry on re-merge and indexes the peer ids the update introduced', () => {
    const directory = loaded();

    directory.merge(
      [
        person({
          id: 'ada',
          name: 'Ada Byron',
          company: 'Analytical Engines',
          category: 'engineer',
          peerIds: ['peer-ada-2', 'peer-ada-3'],
          version: 5,
          updatedAt: 2_000,
        }),
      ],
      2_000,
    );

    expect(directory.size).toBe(4);
    expect(directory.getEntry('ada')?.profile.version).toBe(5);
    expect(directory.resolvePeer('peer-ada-2')?.profile.name).toBe('Ada Byron');
    expect(directory.resolvePeer('peer-ada-3')?.profile.name).toBe('Ada Byron');
    // The haystack is rebuilt with the entry: the old name stops matching.
    expect(names(directory.search({ query: 'byron' }))).toEqual(['Ada Byron']);
    expect(directory.search({ query: 'lovelace' })).toEqual([]);
  });

  it('drops a peer id the update no longer claims, so the retired id resolves to null', () => {
    const directory = loaded();

    directory.merge(
      [person({ id: 'ada', name: 'Ada Lovelace', peerIds: ['peer-ada-2'], version: 5 })],
      2_000,
    );

    // Actual behaviour: the previous entry's peer ids are un-indexed before the
    // new ones go in, so an id the attendee has rotated away from stops
    // resolving immediately rather than lingering as a stale mapping.
    expect(directory.resolvePeer('peer-ada-1')).toBeNull();
    expect(directory.hasPeer('peer-ada-1')).toBe(false);
    expect(directory.resolvePeer('peer-ada-2')?.profile.id).toBe('ada');
    expect(directory.stats().peerMappings).toBe(4);
  });

  it('gives a peer id claimed by a second attendee to the newer claimant', () => {
    const directory = loaded();

    directory.merge(
      [
        person({
          id: 'grace',
          name: 'Grace Hopper',
          peerIds: ['peer-ada-1'],
          version: 3,
          updatedAt: 2_000,
        }),
      ],
      2_000,
    );

    expect(directory.resolvePeer('peer-ada-1')?.profile.id).toBe('grace');
    expect(directory.resolvePeer('peer-ada-2')?.profile.id).toBe('ada');
  });

  it('does not let the previous owner un-index a peer id another attendee now owns', () => {
    const directory = loaded();
    directory.merge(
      [
        person({
          id: 'grace',
          name: 'Grace Hopper',
          peerIds: ['peer-ada-1'],
          version: 3,
          updatedAt: 2_000,
        }),
      ],
      2_000,
    );

    // Ada re-syncs, still listing the id she has already lost to Grace.
    directory.merge(
      [person({ id: 'ada', name: 'Ada Lovelace', peerIds: ['peer-ada-1'], version: 5 })],
      3_000,
    );

    // The removal loop only deletes mappings that still point at the entry being
    // replaced, so Grace's mapping survives Ada's cleanup and Ada's own
    // re-index then takes the id back. Last writer wins, nothing is lost.
    expect(directory.resolvePeer('peer-ada-1')?.profile.id).toBe('ada');
  });

  it('ignores an out-of-order payload that is older by both version and timestamp', () => {
    const directory = loaded();

    directory.merge(
      [
        person({
          id: 'ada',
          name: 'Stale Ada',
          peerIds: ['peer-stale'],
          version: 3,
          updatedAt: 500,
        }),
      ],
      2_000,
    );

    expect(directory.getEntry('ada')?.profile.name).toBe('Ada Lovelace');
    expect(directory.getEntry('ada')?.profile.version).toBe(4);
    expect(directory.resolvePeer('peer-stale')).toBeNull();
    expect(directory.resolvePeer('peer-ada-1')?.profile.name).toBe('Ada Lovelace');
  });

  it('applies a payload of equal version carrying a newer timestamp', () => {
    const directory = loaded();

    // The guard needs the cached version to be STRICTLY greater to reject, so an
    // equal-version edit (peer ids rotated, profile untouched) still lands.
    directory.merge(
      [
        person({
          id: 'ada',
          name: 'Ada Lovelace',
          peerIds: ['peer-ada-9'],
          version: 4,
          updatedAt: 9_000,
        }),
      ],
      9_000,
    );

    expect(directory.resolvePeer('peer-ada-9')?.profile.id).toBe('ada');
    expect(directory.resolvePeer('peer-ada-1')).toBeNull();
  });

  it('removes an attendee, their peer ids and their searchability on a tombstone', () => {
    const directory = loaded();

    directory.merge([person({ id: 'grace', name: 'Grace Hopper', deleted: true })], 2_000);

    expect(directory.size).toBe(3);
    expect(directory.getAttendee('grace')).toBeNull();
    expect(directory.resolvePeer('peer-grace-1')).toBeNull();
    expect(directory.search({ query: 'hopper' })).toEqual([]);
    expect(directory.stats().peerMappings).toBe(4);

    // A tombstone for someone the directory never held changes nothing.
    directory.merge([person({ id: 'ghost', name: 'Ghost', deleted: true })], 3_000);
    expect(directory.size).toBe(3);
    expect(directory.stats().peerMappings).toBe(4);
  });

  it('registers an out-of-band peer mapping only for an attendee it already holds', () => {
    const directory = loaded();

    directory.addPeerMapping('peer-ada-rotated', 'ada');
    directory.addPeerMapping('peer-ghost', 'ghost');

    expect(directory.resolvePeer('peer-ada-rotated')?.profile.id).toBe('ada');
    expect(directory.resolvePeer('peer-ghost')).toBeNull();
    expect(directory.stats().peerMappings).toBe(6);
  });
});

describe('load(), toSnapshot(), size and clear()', () => {
  it('replaces the whole directory on load and forgets the previous population', () => {
    const directory = loaded();

    directory.load({
      eventId: EVENT_ID,
      entries: [person({ id: 'zoe', name: 'Zoe Nash', peerIds: ['peer-zoe-1'] })],
      syncedAt: 5_000,
    });

    expect(directory.size).toBe(1);
    expect(directory.resolvePeer('peer-ada-1')).toBeNull();
    expect(directory.resolvePeer('peer-zoe-1')?.profile.name).toBe('Zoe Nash');
    expect(directory.stats()).toEqual({ attendees: 1, peerMappings: 1, lastSyncedAt: 5_000 });
  });

  it('round-trips a snapshot into a second directory with identical resolution', () => {
    const directory = loaded();
    directory.merge([person({ id: 'grace', name: 'Grace Hopper', deleted: true })], 1_800);

    const snapshot: DirectorySnapshot = directory.toSnapshot();
    const restored = new AttendeeDirectory(EVENT_ID);
    restored.load(snapshot);

    expect(snapshot.eventId).toBe(EVENT_ID);
    expect(snapshot.syncedAt).toBe(1_800);
    // The tombstoned attendee is gone from the snapshot, not carried inside it.
    expect(snapshot.entries.map((entry) => entry.id).sort()).toEqual(['ada', 'alan', 'betty']);
    expect(restored.size).toBe(3);
    expect(restored.resolvePeer('peer-ada-2')?.profile.name).toBe('Ada Lovelace');
    expect(restored.resolvePeer('peer-grace-1')).toBeNull();
  });

  it('reports an unsynced directory as empty with a zero snapshot timestamp', () => {
    const directory = new AttendeeDirectory(EVENT_ID);

    expect(directory.size).toBe(0);
    expect(directory.stats()).toEqual({ attendees: 0, peerMappings: 0, lastSyncedAt: null });
    expect(directory.toSnapshot()).toEqual({ eventId: EVENT_ID, entries: [], syncedAt: 0 });
    expect(directory.search({})).toEqual([]);
  });

  it('clears the directory but keeps the blocklist, which is user state and not synced data', () => {
    const directory = loaded();
    directory.setBlocked(['grace']);

    directory.clear();

    expect(directory.size).toBe(0);
    expect(directory.resolvePeer('peer-ada-1')).toBeNull();
    expect(directory.stats().lastSyncedAt).toBeNull();
    expect(directory.isBlocked('grace')).toBe(true);
    // ...but with no entry left to read peer ids from, there is nothing to suppress.
    expect(directory.blockedPeerIds()).toEqual([]);
  });

  it('bumps the revision on every mutation so a subscriber can diff on it', () => {
    const directory = new AttendeeDirectory(EVENT_ID);
    const seen: number[] = [directory.revision];

    directory.merge(cast(), 1_000);
    seen.push(directory.revision);
    directory.setBlocked(['grace']);
    seen.push(directory.revision);
    directory.setConnections(['ada']);
    seen.push(directory.revision);
    directory.load({ eventId: EVENT_ID, entries: [], syncedAt: 2_000 });
    seen.push(directory.revision);
    directory.clear();
    seen.push(directory.revision);

    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('setBlocked() enforcement', () => {
  it('excludes blocked attendees from search() and all()', () => {
    const directory = loaded();

    directory.setBlocked(['grace', 'betty']);

    expect(names(directory.search({}))).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(names(directory.all())).toEqual(['Ada Lovelace', 'Alan Turing']);
    expect(directory.search({ query: 'hopper' })).toEqual([]);
  });

  it('still resolves a blocked attendee on the hot path, flagged isBlocked', () => {
    const directory = loaded();

    directory.setBlocked(['grace']);

    // Direct lookup is not filtered: the drop happens at the radio edge via
    // blockedPeerIds(), and the UI needs the flag to render the blocked state.
    const resolved = directory.resolvePeer('peer-grace-1');
    expect(resolved?.profile.id).toBe('grace');
    expect(resolved?.isBlocked).toBe(true);
    expect(directory.getAttendee('ada')?.isBlocked).toBe(false);
    expect(directory.isBlocked('grace')).toBe(true);
    expect(directory.isBlocked('ada')).toBe(false);
  });

  it('returns exactly the peer ids of the blocked profiles it holds', () => {
    const directory = loaded();

    directory.setBlocked(['ada', 'grace']);

    expect(directory.blockedPeerIds()).toEqual(['peer-ada-1', 'peer-ada-2', 'peer-grace-1']);
  });

  it('yields no peer ids for a blocked profile that has no directory entry', () => {
    const directory = loaded();

    directory.setBlocked(['ghost']);

    // CRITICAL BOUNDARY: blockedPeerIds() can only report ids the directory
    // already knows. A block on someone who has no entry here suppresses
    // nothing at all — and that is exactly why a block does not survive an
    // identity rotation the directory has not seen: the new peer id appears in
    // no entry, so PeerRegistry is never told to drop it and the blocked person
    // comes back as an unknown nearby peer until the next directory pull
    // (audit finding).
    expect(directory.blockedPeerIds()).toEqual([]);

    directory.setBlocked(['ghost', 'grace']);
    expect(directory.blockedPeerIds()).toEqual(['peer-grace-1']);
  });

  // BUG: blockedPeerIds() (AttendeeDirectory.ts:183-190) walks only
  // `entry.peerIds` and never consults `peerIndex`, so a mapping registered
  // through addPeerMapping() — documented at line 155 as the way to learn a
  // rotated id "without waiting for the next directory pull" — is known to
  // resolvePeer() and yet is never handed to PeerRegistry.setSuppressed()
  // (PresenceController.ts:224). The directory holds the peerId -> blocked
  // profile edge and still does not suppress it. Latent today (no production
  // caller of addPeerMapping) and live the moment one appears.
  it.failing('suppresses a rotated peer id it learned out of band for a blocked profile', () => {
    const directory = loaded();
    directory.addPeerMapping('peer-grace-rotated', 'grace');

    directory.setBlocked(['grace']);

    expect(directory.resolvePeer('peer-grace-rotated')?.isBlocked).toBe(true);
    expect(directory.blockedPeerIds().sort()).toEqual(['peer-grace-1', 'peer-grace-rotated']);
  });

  it('replaces the block set wholesale, so unblocking restores search visibility', () => {
    const directory = loaded();
    directory.setBlocked(['grace', 'betty']);

    directory.setBlocked(['betty']);

    expect(directory.isBlocked('grace')).toBe(false);
    expect(directory.blockedPeerIds()).toEqual(['peer-betty-1']);
    expect(names(directory.search({}))).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);

    directory.setBlocked([]);
    expect(directory.blockedPeerIds()).toEqual([]);
    expect(directory.search({})).toHaveLength(4);
  });

  it('leaves a blocked person out of the facet counts that power the filter chips', () => {
    const directory = loaded();

    directory.setBlocked(['grace']);

    expect(directory.facet('company')).toEqual([
      'Analytical Engines',
      'Bletchley',
    ]);
    expect(directory.facet('skills')).toEqual(['Compilers', 'Cryptanalysis', 'ENIAC', 'Rust']);
  });
});

describe('setConnections()', () => {
  it('marks isConnection and leaves membership, indexing and blocking untouched', () => {
    const directory = loaded();
    directory.setBlocked(['betty']);
    const before = names(directory.search({}));

    directory.setConnections(['ada', 'alan']);

    expect(directory.getAttendee('ada')?.isConnection).toBe(true);
    expect(directory.resolvePeer('peer-alan-1')?.isConnection).toBe(true);
    expect(directory.getAttendee('grace')?.isConnection).toBe(false);
    expect(names(directory.search({}))).toEqual(before);
    expect(directory.stats()).toEqual({ attendees: 4, peerMappings: 5, lastSyncedAt: 1_700 });
    expect(directory.isBlocked('betty')).toBe(true);
    expect(directory.getAttendee('ada')?.isBlocked).toBe(false);
  });

  it('replaces the connection set wholesale rather than adding to it', () => {
    const directory = loaded();
    directory.setConnections(['ada', 'alan']);

    directory.setConnections(['grace']);

    expect(directory.getAttendee('ada')?.isConnection).toBe(false);
    expect(directory.getAttendee('alan')?.isConnection).toBe(false);
    expect(directory.getAttendee('grace')?.isConnection).toBe(true);
  });
});

describe('search() — free text', () => {
  it('matches on name, role, company, skills, interests and the category token', () => {
    const directory = loaded();

    expect(names(directory.search({ query: 'lovelace' }))).toEqual(['Ada Lovelace']);
    expect(names(directory.search({ query: 'rear admiral' }))).toEqual(['Grace Hopper']);
    expect(names(directory.search({ query: 'analytical engines' }))).toEqual([
      'Ada Lovelace',
      'Betty Holberton',
    ]);
    expect(names(directory.search({ query: 'cryptanalysis' }))).toEqual(['Alan Turing']);
    expect(names(directory.search({ query: 'teaching' }))).toEqual(['Grace Hopper']);
    expect(names(directory.search({ query: 'data' }))).toEqual(['Alan Turing']);
    expect(directory.search({ query: 'quantum' })).toEqual([]);
  });

  it('matches on the event overlay: why attending, current project and looking-to-meet', () => {
    const directory = loaded();

    expect(names(directory.search({ query: 'hiring for a compiler' }))).toEqual(['Ada Lovelace']);
    expect(names(directory.search({ query: 'universal machine' }))).toEqual(['Alan Turing']);
    expect(names(directory.search({ query: 'mentors' }))).toEqual(['Betty Holberton']);
  });

  it('trims and lowercases the query before matching', () => {
    const directory = loaded();

    expect(names(directory.search({ query: '   COMPILERS  ' }))).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(names(directory.search({ query: 'AdA lOvElAcE' }))).toEqual(['Ada Lovelace']);
  });

  it('treats an empty or whitespace-only query as no query at all', () => {
    const directory = loaded();

    expect(directory.search({ query: '' })).toHaveLength(4);
    expect(directory.search({ query: '     ' })).toHaveLength(4);
  });

  it('does not match on bio, which the haystack deliberately excludes', () => {
    const directory = loaded();

    // buildHaystack (AttendeeDirectory.ts:333-351) indexes name, role, company,
    // headline, industry, category, skills, interests and the event overlay —
    // bio is not in it, so free text cannot reach it.
    expect(directory.search({ query: 'first sort routine' })).toEqual([]);
  });
});

describe('search() — structured filters', () => {
  it('filters by category, and treats an empty category list as no filter', () => {
    const directory = loaded();

    expect(names(directory.search({ categories: ['engineer'] }))).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(names(directory.search({ categories: ['engineer', 'data'] }))).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Grace Hopper',
    ]);
    expect(directory.search({ categories: [] })).toHaveLength(4);
    expect(directory.search({ categories: ['investor'] })).toEqual([]);
  });

  it('matches a company exactly and case-insensitively, never as a substring', () => {
    const directory = loaded();

    expect(names(directory.search({ companies: ['analytical engines'] }))).toEqual([
      'Ada Lovelace',
      'Betty Holberton',
    ]);
    expect(directory.search({ companies: ['Analytical'] })).toEqual([]);
  });

  it('matches skills and interests as whole tokens, case-insensitively', () => {
    const directory = loaded();

    expect(names(directory.search({ skills: ['compilers'] }))).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(names(directory.search({ skills: ['RUST', 'ENIAC'] }))).toEqual([
      'Ada Lovelace',
      'Betty Holberton',
    ]);
    expect(directory.search({ skills: ['compil'] })).toEqual([]);
    expect(names(directory.search({ interests: ['chess'] }))).toEqual([
      'Ada Lovelace',
      'Betty Holberton',
    ]);
  });

  it('keeps only people whose availability is exactly available', () => {
    const directory = loaded();

    // 'maybe' and 'busy' are both excluded — availableOnly is not "not busy".
    expect(names(directory.search({ availableOnly: true }))).toEqual([
      'Ada Lovelace',
      'Alan Turing',
    ]);
    expect(directory.search({ availableOnly: false })).toHaveLength(4);
  });

  it('applies minExperience at the exact threshold and counts a missing value as zero', () => {
    const directory = loaded();

    // Alan has exactly 5 years; Betty states none, which is treated as 0.
    expect(names(directory.search({ minExperience: 5 }))).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Grace Hopper',
    ]);
    expect(names(directory.search({ minExperience: 6 }))).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(directory.search({ minExperience: 0 })).toHaveLength(4);
    expect(directory.search({ minExperience: 31 })).toEqual([]);
  });

  it('applies maxExperience at the exact threshold', () => {
    const directory = loaded();

    expect(names(directory.search({ maxExperience: 5 }))).toEqual([
      'Alan Turing',
      'Betty Holberton',
    ]);
    expect(names(directory.search({ maxExperience: 4 }))).toEqual(['Betty Holberton']);
    expect(names(directory.search({ maxExperience: 0 }))).toEqual(['Betty Holberton']);
    expect(names(directory.search({ minExperience: 5, maxExperience: 10 }))).toEqual([
      'Ada Lovelace',
      'Alan Turing',
    ]);
  });

  it('filters by what people are looking for, dropping anyone who listed nothing', () => {
    const directory = loaded();

    expect(names(directory.search({ lookingFor: ['mentors'] }))).toEqual(['Betty Holberton']);
    expect(directory.search({ lookingFor: ['investors'] })).toEqual([]);
  });

  it('intersects free text with structured filters rather than unioning them', () => {
    const directory = loaded();

    expect(
      names(directory.search({ query: 'compilers', categories: ['engineer'], availableOnly: true })),
    ).toEqual(['Ada Lovelace']);
    expect(
      directory.search({ query: 'compilers', categories: ['engineer'], skills: ['cryptanalysis'] }),
    ).toEqual([]);
  });

  it('returns everyone visible for an empty filter', () => {
    const directory = loaded();

    expect(names(directory.search({}))).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Betty Holberton',
      'Grace Hopper',
    ]);
  });
});

describe('search() — proximity', () => {
  it('keeps only people in the distances map when nearbyOnly is set', () => {
    const directory = loaded();
    const nearby = new Map<ProfileId, number>([
      ['grace', 3],
      ['betty', 12],
    ]);

    expect(names(directory.search({ nearbyOnly: true }, nearby))).toEqual([
      'Grace Hopper',
      'Betty Holberton',
    ]);
    // No distances at all means nobody is nearby, not everybody.
    expect(directory.search({ nearbyOnly: true })).toEqual([]);
  });

  it('includes a distance exactly at maxDistance and excludes the metre past it', () => {
    const directory = loaded();
    const nearby = new Map<ProfileId, number>([
      ['ada', 5],
      ['alan', 4],
      ['grace', 6],
    ]);

    expect(names(directory.search({ maxDistance: 5 }, nearby))).toEqual([
      'Alan Turing',
      'Ada Lovelace',
    ]);
    expect(names(directory.search({ maxDistance: 4 }, nearby))).toEqual(['Alan Turing']);
    // Betty has no distance, so a maxDistance filter drops her: an unknown
    // distance is never treated as close enough.
    expect(names(directory.search({ maxDistance: 100 }, nearby))).toEqual([
      'Alan Turing',
      'Ada Lovelace',
      'Grace Hopper',
    ]);
    expect(directory.search({ maxDistance: 0 }, nearby)).toEqual([]);
  });

  it('orders nearest first, then everyone whose distance is unknown, alphabetically', () => {
    const directory = loaded();
    const nearby = new Map<ProfileId, number>([
      ['betty', 1],
      ['grace', 2.5],
    ]);

    expect(names(directory.search({}, nearby))).toEqual([
      'Betty Holberton',
      'Grace Hopper',
      'Ada Lovelace',
      'Alan Turing',
    ]);
  });

  it('breaks a distance tie alphabetically, as it does when no distance is known at all', () => {
    const directory = loaded();
    const nearby = new Map<ProfileId, number>([
      ['grace', 4],
      ['ada', 4],
    ]);

    expect(names(directory.search({}, nearby))).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Alan Turing',
      'Betty Holberton',
    ]);
    expect(names(directory.search({}, new Map()))).toEqual(names(directory.search({})));
  });
});

describe('search() — visibility', () => {
  function withVisibilities(): AttendeeDirectory {
    return loaded([
      person({ id: 'ada', name: 'Ada Lovelace', company: 'Analytical Engines', peerIds: ['p-ada'] }),
      person({
        id: 'mallory',
        name: 'Mallory Quiet',
        company: 'Ghost Ltd',
        visibility: 'invisible',
        peerIds: ['p-mallory'],
      }),
      person({
        id: 'casey',
        name: 'Casey Guarded',
        company: 'Closed Circle',
        visibility: 'connections_only',
        peerIds: ['p-casey'],
      }),
    ]);
  }

  it('hides an invisible attendee from search() and all() whatever the filter asks for', () => {
    const directory = withVisibilities();

    expect(names(directory.search({}))).toEqual(['Ada Lovelace']);
    expect(names(directory.all())).toEqual(['Ada Lovelace']);
    expect(directory.search({ query: 'mallory' })).toEqual([]);
    expect(directory.search({ companies: ['Ghost Ltd'] })).toEqual([]);
  });

  it('keeps an invisible attendee out of results even once you connect with them', () => {
    const directory = withVisibilities();

    directory.setConnections(['mallory']);

    expect(names(directory.search({}))).toEqual(['Ada Lovelace']);
  });

  it('reveals a connections_only attendee only once they are a connection', () => {
    const directory = withVisibilities();

    expect(directory.search({ query: 'casey' })).toEqual([]);

    directory.setConnections(['casey']);

    expect(names(directory.search({}))).toEqual(['Ada Lovelace', 'Casey Guarded']);
    expect(directory.getAttendee('casey')?.isConnection).toBe(true);
  });

  it('still resolves a hidden attendee on the hot path, reporting their visibility', () => {
    const directory = withVisibilities();

    // resolvePeer is deliberately unfiltered: if a hidden peer is on air at all,
    // the caller has to know who it is to honour their visibility choice.
    const mallory = directory.resolvePeer('p-mallory');
    expect(mallory?.profile.name).toBe('Mallory Quiet');
    expect(mallory?.visibility).toBe('invisible');
    expect(directory.getAttendee('casey')?.visibility).toBe('connections_only');
  });
});

describe('facet()', () => {
  it('lists the most common values first and breaks ties alphabetically', () => {
    const directory = loaded();

    expect(directory.facet('company')).toEqual([
      'Analytical Engines',
      'Bletchley',
      'Naval Systems',
    ]);
    expect(directory.facet('skills')).toEqual([
      'Compilers',
      'COBOL',
      'Cryptanalysis',
      'ENIAC',
      'Rust',
    ]);
    expect(directory.facet('interests')).toEqual(['Chess', 'Mathematics', 'Teaching']);
  });

  it('skips an attendee with no value for the field instead of counting a blank', () => {
    const directory = loaded();

    // Only Ada, Grace and Alan state an industry; Betty contributes nothing.
    expect(directory.facet('industry')).toEqual(['Software', 'Research']);
  });

  it('respects the limit, including a limit of zero and a limit past the end', () => {
    const directory = loaded();

    expect(directory.facet('skills', 1)).toEqual(['Compilers']);
    expect(directory.facet('skills', 2)).toEqual(['Compilers', 'COBOL']);
    expect(directory.facet('skills', 0)).toEqual([]);
    expect(directory.facet('skills', 99)).toHaveLength(5);
  });

  it('is empty for an empty directory', () => {
    const directory = new AttendeeDirectory(EVENT_ID);

    expect(directory.facet('company')).toEqual([]);
    expect(directory.facet('skills')).toEqual([]);
    expect(directory.facet('interests')).toEqual([]);
    expect(directory.facet('industry')).toEqual([]);
  });

  // BUG: facet() (AttendeeDirectory.ts:295-296) filters blocked attendees but
  // not hidden ones, while search() and all() (lines 229-231 and 261-263)
  // exclude both. Someone who set visibility 'invisible' therefore contributes
  // a filter chip no search result can ever justify — the chip discloses that
  // an attendee from that company is in the room, which is the one thing
  // 'invisible' was chosen to prevent, and tapping it returns nobody.
  it.failing('leaves a hidden attendee out of the facet chips as search leaves them out', () => {
    const directory = loaded([
      person({ id: 'ada', name: 'Ada Lovelace', company: 'Analytical Engines' }),
      person({
        id: 'mallory',
        name: 'Mallory Quiet',
        company: 'Ghost Ltd',
        visibility: 'invisible',
      }),
    ]);

    expect(directory.facet('company')).toEqual(['Analytical Engines']);
  });
});

describe('isStale()', () => {
  function withVersion(version: number): AttendeeDirectory {
    return loaded([person({ id: 'ada', name: 'Ada Lovelace', peerIds: ['p-ada'], version })]);
  }

  it('is true when the peer advertises a version ahead of the cached one', () => {
    const directory = withVersion(4);

    expect(directory.isStale('p-ada', 5)).toBe(true);
    expect(directory.isStale('p-ada', 40)).toBe(true);
  });

  it('is false when the advertised version equals the cached one', () => {
    const directory = withVersion(4);

    expect(directory.isStale('p-ada', 4)).toBe(false);
  });

  // BUG: isStale (AttendeeDirectory.ts:249) compares the two bytes with `!==`,
  // so it also reports "stale" when the peer advertises a version BEHIND the
  // cache. Its own contract (line 239: "A cached profile whose version is older
  // than what the peer is advertising") is one-directional. The consequence is
  // in EventService.noteProfileVersion (EventService.ts:344-350): the profile is
  // queued into staleProfiles and refetched over the network only to be told
  // what we already hold — needless requests on exactly the congested venue
  // Wi-Fi this app is built not to depend on.
  it.failing('is false when the peer advertises a version behind the cached one', () => {
    const directory = withVersion(9);

    expect(directory.isStale('p-ada', 8)).toBe(false);
  });

  it('reads a version that wrapped past 255 as newer, not as a rollback', () => {
    const directory = withVersion(255);

    // The wire field is a uint8 that wraps at 256 (BleProtocol.ts:23), so
    // 255 -> 0 is one step forward.
    expect(directory.isStale('p-ada', 0)).toBe(true);
  });

  it('compares modulo 256, so a cached version above a byte matches its wire form', () => {
    const directory = withVersion(260);

    expect(directory.isStale('p-ada', 4)).toBe(false);
    expect(directory.isStale('p-ada', 260)).toBe(false);
    expect(directory.isStale('p-ada', 5)).toBe(true);
  });

  it('is false for a peer id it cannot resolve, rather than assuming a refresh', () => {
    const directory = withVersion(4);

    expect(directory.isStale('p-unknown', 99)).toBe(false);
  });
});
