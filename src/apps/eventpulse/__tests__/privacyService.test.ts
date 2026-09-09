/**
 * PrivacyService — the module that decides what leaves this device.
 *
 * Everything here exercises the real implementation: PrivacyService is pure
 * TypeScript over plain data, so there is no boundary worth faking. The only
 * helpers below are literal builders.
 */

import {
  AVAILABILITY_OPTIONS,
  DEFAULT_PRIVACY,
  VISIBILITY_OPTIONS,
  canSee,
  describePrivacy,
  displayTagFor,
  fieldVisibility,
  presenceStatusFor,
  redactProfile,
  shouldAdvertise,
  type Viewer,
} from '../security/PrivacyService';
import { MAX_DISPLAY_TAG_BYTES } from '../bluetooth/BleProtocol';
import { utf8Encode } from '../utils/bytes';
import type {
  Availability,
  FieldVisibility,
  PresenceStatus,
  PrivacySettings,
  Profile,
  ProfileField,
  Visibility,
} from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const ALL_VIEWERS: Viewer[] = ['self', 'connection', 'attendee'];
const ALL_FIELD_VISIBILITIES: FieldVisibility[] = ['public', 'connections', 'private'];
const ALL_VISIBILITIES: Visibility[] = ['visible', 'connections_only', 'invisible'];
const ALL_AVAILABILITIES: Availability[] = ['available', 'maybe', 'busy', 'invisible'];
const VALID_PRESENCE_STATUSES: PresenceStatus[] = ['available', 'maybe', 'busy'];

/** Every member of the ProfileField union, in declaration order. */
const ALL_PROFILE_FIELDS: ProfileField[] = [
  'company',
  'role',
  'experienceYears',
  'skills',
  'interests',
  'bio',
  'links',
  'pronouns',
  'whyAttending',
  'lookingToMeet',
  'currentProject',
];

/** The subset of ProfileField that `redactProfile` can actually act on. */
const REDACTABLE_FIELDS: ProfileField[] = [
  'company',
  'role',
  'experienceYears',
  'skills',
  'interests',
  'bio',
  'links',
  'pronouns',
];

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'profile-1',
    userId: 'user-1',
    name: 'Ada Lovelace',
    pronouns: 'she/her',
    headline: 'Chief Engineer at Analytical Engines Ltd',
    company: 'Analytical Engines Ltd',
    role: 'Chief Engineer',
    category: 'engineer',
    experienceYears: 12,
    industry: 'Computing',
    skills: ['algorithms', 'mathematics'],
    interests: ['poetry', 'looms'],
    bio: 'Wrote the first published algorithm.',
    avatar: { kind: 'initials', avatarId: 'AV01', hue: 217 },
    links: { github: 'ada', website: 'https://ada.example' },
    version: 3,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Everything `redactProfile` strips, with untouched fields left alone. */
function fullyRedacted(profile: Profile): Profile {
  return {
    ...profile,
    company: undefined,
    role: undefined,
    experienceYears: undefined,
    skills: [],
    interests: [],
    bio: undefined,
    links: undefined,
    pronouns: undefined,
  };
}

function settingsWith(overrides: Partial<PrivacySettings> = {}): PrivacySettings {
  return {
    visibility: 'visible',
    fields: {},
    broadcastDisplayName: true,
    allowConnectionRequests: true,
    discoverable: true,
    ...overrides,
  };
}

/** Every ProfileField pinned to the same visibility. */
function allFieldsAt(visibility: FieldVisibility): PrivacySettings {
  const fields: Partial<Record<ProfileField, FieldVisibility>> = {};
  for (const field of ALL_PROFILE_FIELDS) fields[field] = visibility;
  return settingsWith({ fields });
}

/* ------------------------------------------------------------------ *
 * DEFAULT_PRIVACY
 * ------------------------------------------------------------------ */

describe('DEFAULT_PRIVACY', () => {
  it('ships the documented defaults: visible, broadcasting, open to requests, discoverable', () => {
    expect(DEFAULT_PRIVACY).toStrictEqual({
      visibility: 'visible',
      fields: {
        bio: 'public',
        links: 'connections',
        currentProject: 'connections',
      },
      broadcastDisplayName: true,
      allowConnectionRequests: true,
      discoverable: true,
    });
  });

  it('leaves company, role, experience, skills, interests and pronouns open to strangers', () => {
    const strangerVisible = REDACTABLE_FIELDS.filter((field) =>
      canSee(DEFAULT_PRIVACY, field, 'attendee'),
    );
    expect(strangerVisible).toStrictEqual([
      'company',
      'role',
      'experienceYears',
      'skills',
      'interests',
      'bio',
      'pronouns',
    ]);
    // `links` is the only redactable field the defaults hold back from strangers.
    expect(canSee(DEFAULT_PRIVACY, 'links', 'attendee')).toBe(false);
    expect(canSee(DEFAULT_PRIVACY, 'links', 'connection')).toBe(true);
    // `currentProject` lives on EventProfile, but the default setting is queryable here.
    expect(canSee(DEFAULT_PRIVACY, 'currentProject', 'attendee')).toBe(false);
    expect(canSee(DEFAULT_PRIVACY, 'currentProject', 'connection')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * fieldVisibility
 * ------------------------------------------------------------------ */

describe('fieldVisibility', () => {
  it('returns the explicitly configured visibility for a field', () => {
    const settings = settingsWith({ fields: { bio: 'private', skills: 'connections' } });
    expect(fieldVisibility(settings, 'bio')).toBe('private');
    expect(fieldVisibility(settings, 'skills')).toBe('connections');
  });

  it('defaults to public for a field with no entry at all', () => {
    const settings = settingsWith({ fields: {} });
    for (const field of ALL_PROFILE_FIELDS) {
      expect(fieldVisibility(settings, field)).toBe('public');
    }
  });

  it('defaults to public for a field whose entry is explicitly undefined', () => {
    const settings = settingsWith({ fields: { company: undefined, role: 'private' } });
    expect(fieldVisibility(settings, 'company')).toBe('public');
    expect(fieldVisibility(settings, 'role')).toBe('private');
  });
});

/* ------------------------------------------------------------------ *
 * canSee
 * ------------------------------------------------------------------ */

describe('canSee', () => {
  it('grants a self viewer every field at every visibility level', () => {
    for (const visibility of ALL_FIELD_VISIBILITIES) {
      const settings = allFieldsAt(visibility);
      for (const field of ALL_PROFILE_FIELDS) {
        expect(canSee(settings, field, 'self')).toBe(true);
      }
    }
  });

  it('grants a connection public and connections fields, and never private ones', () => {
    for (const field of ALL_PROFILE_FIELDS) {
      expect(canSee(allFieldsAt('public'), field, 'connection')).toBe(true);
      expect(canSee(allFieldsAt('connections'), field, 'connection')).toBe(true);
      expect(canSee(allFieldsAt('private'), field, 'connection')).toBe(false);
    }
  });

  it('grants an ordinary attendee public fields only', () => {
    for (const field of ALL_PROFILE_FIELDS) {
      expect(canSee(allFieldsAt('public'), field, 'attendee')).toBe(true);
      expect(canSee(allFieldsAt('connections'), field, 'attendee')).toBe(false);
      expect(canSee(allFieldsAt('private'), field, 'attendee')).toBe(false);
    }
  });

  it('treats an unconfigured field as public for every viewer', () => {
    const settings = settingsWith({ fields: {} });
    for (const viewer of ALL_VIEWERS) {
      for (const field of ALL_PROFILE_FIELDS) {
        expect(canSee(settings, field, viewer)).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * redactProfile
 * ------------------------------------------------------------------ */

describe('redactProfile', () => {
  // [label, viewer, visibility applied to every field, do those fields survive?]
  const table: Array<[string, Viewer, FieldVisibility, boolean]> = [
    ['self keeps every field when all fields are public', 'self', 'public', true],
    ['self keeps every field when all fields are connections-only', 'self', 'connections', true],
    ['self keeps every field even when all fields are private', 'self', 'private', true],
    ['a connection keeps every field marked public', 'connection', 'public', true],
    ['a connection keeps every field marked connections', 'connection', 'connections', true],
    ['a connection loses every field marked private', 'connection', 'private', false],
    ['an attendee keeps every field marked public', 'attendee', 'public', true],
    ['an attendee loses every field marked connections', 'attendee', 'connections', false],
    ['an attendee loses every field marked private', 'attendee', 'private', false],
  ];

  it.each(table)('%s', (_label, viewer, visibility, survives) => {
    const result = redactProfile(makeProfile(), allFieldsAt(visibility), viewer);
    expect(result).toStrictEqual(survives ? makeProfile() : fullyRedacted(makeProfile()));
  });

  it('hands a self viewer the very same profile object, untouched', () => {
    const profile = makeProfile();
    expect(redactProfile(profile, allFieldsAt('private'), 'self')).toBe(profile);
  });

  it('never mutates the profile it was given, nor its arrays', () => {
    const profile = makeProfile();
    const snapshot = JSON.parse(JSON.stringify(profile)) as Profile;
    const skillsRef = profile.skills;
    const interestsRef = profile.interests;

    redactProfile(profile, allFieldsAt('private'), 'attendee');
    redactProfile(profile, allFieldsAt('connections'), 'attendee');

    expect(profile).toStrictEqual(snapshot);
    expect(profile.skills).toBe(skillsRef);
    expect(profile.interests).toBe(interestsRef);
    expect(profile.skills).toStrictEqual(['algorithms', 'mathematics']);
    expect(profile.links).toStrictEqual({ github: 'ada', website: 'https://ada.example' });
  });

  it('applies the shipped defaults so a stranger loses links but keeps company, role and bio', () => {
    const profile = makeProfile();
    const result = redactProfile(profile, DEFAULT_PRIVACY, 'attendee');

    expect(result.links).toBeUndefined();
    expect(result.company).toBe('Analytical Engines Ltd');
    expect(result.role).toBe('Chief Engineer');
    expect(result.bio).toBe('Wrote the first published algorithm.');
    expect(result.skills).toStrictEqual(['algorithms', 'mathematics']);
    expect(result.pronouns).toBe('she/her');
    expect(result.experienceYears).toBe(12);
    // A connection loses nothing under the defaults.
    expect(redactProfile(profile, DEFAULT_PRIVACY, 'connection')).toStrictEqual(makeProfile());
  });

  it('redacts each field independently rather than all-or-nothing', () => {
    const settings = settingsWith({
      fields: { company: 'private', skills: 'connections', bio: 'public' },
    });
    const result = redactProfile(makeProfile(), settings, 'attendee');

    expect(result.company).toBeUndefined();
    expect(result.skills).toStrictEqual([]);
    expect(result.bio).toBe('Wrote the first published algorithm.');
    expect(result.role).toBe('Chief Engineer');
    expect(result.interests).toStrictEqual(['poetry', 'looms']);
  });

  it('leaves identity and presentation fields outside the ProfileField union alone', () => {
    // `name`, `headline`, `industry`, `category` and `avatar` have no privacy
    // setting, so they survive even when every configurable field is private.
    const result = redactProfile(makeProfile(), allFieldsAt('private'), 'attendee');
    expect(result.name).toBe('Ada Lovelace');
    expect(result.headline).toBe('Chief Engineer at Analytical Engines Ltd');
    expect(result.industry).toBe('Computing');
    expect(result.category).toBe('engineer');
    expect(result.avatar).toStrictEqual({ kind: 'initials', avatarId: 'AV01', hue: 217 });
    expect(result.id).toBe('profile-1');
    expect(result.version).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * shouldAdvertise
 * ------------------------------------------------------------------ */

describe('shouldAdvertise', () => {
  it('never advertises when the profile visibility is invisible, whatever the availability', () => {
    const settings = settingsWith({ visibility: 'invisible' });
    for (const availability of ALL_AVAILABILITIES) {
      expect(shouldAdvertise(settings, availability)).toBe(false);
    }
  });

  it('never advertises when the availability is invisible, whatever the visibility', () => {
    for (const visibility of ALL_VISIBILITIES) {
      expect(shouldAdvertise(settingsWith({ visibility }), 'invisible')).toBe(false);
    }
  });

  it('advertises for a visible profile at every non-invisible availability', () => {
    const settings = settingsWith({ visibility: 'visible' });
    expect(shouldAdvertise(settings, 'available')).toBe(true);
    expect(shouldAdvertise(settings, 'maybe')).toBe(true);
    expect(shouldAdvertise(settings, 'busy')).toBe(true);
  });

  it('still advertises for a connections_only profile at every non-invisible availability', () => {
    // OBSERVED BEHAVIOUR: `connections_only` does NOT stop the radio.
    // shouldAdvertise (PrivacyService.ts:111-115) returns false only for
    // `visibility === 'invisible'` or `availability === 'invisible'`, so a
    // connections-only user keeps broadcasting and the filtering of who may
    // act on that frame happens above this module.
    const settings = settingsWith({ visibility: 'connections_only' });
    expect(shouldAdvertise(settings, 'available')).toBe(true);
    expect(shouldAdvertise(settings, 'maybe')).toBe(true);
    expect(shouldAdvertise(settings, 'busy')).toBe(true);
  });

  it('advertises for exactly six of the twelve visibility/availability combinations', () => {
    const advertising: string[] = [];
    for (const visibility of ALL_VISIBILITIES) {
      for (const availability of ALL_AVAILABILITIES) {
        if (shouldAdvertise(settingsWith({ visibility }), availability)) {
          advertising.push(`${visibility}/${availability}`);
        }
      }
    }
    expect(advertising).toStrictEqual([
      'visible/available',
      'visible/maybe',
      'visible/busy',
      'connections_only/available',
      'connections_only/maybe',
      'connections_only/busy',
    ]);
  });

  it('ignores broadcastDisplayName, discoverable and allowConnectionRequests', () => {
    const quiet = settingsWith({
      broadcastDisplayName: false,
      discoverable: false,
      allowConnectionRequests: false,
    });
    expect(shouldAdvertise(quiet, 'available')).toBe(true);
    expect(shouldAdvertise(quiet, 'invisible')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * presenceStatusFor
 * ------------------------------------------------------------------ */

describe('presenceStatusFor', () => {
  it('maps each availability onto its presence status', () => {
    expect(presenceStatusFor('available')).toBe('available');
    expect(presenceStatusFor('maybe')).toBe('maybe');
    expect(presenceStatusFor('busy')).toBe('busy');
    // `invisible` has no presence status of its own, so it falls through the
    // default branch to `available` (PrivacyService.ts:123-124). Unreachable in
    // practice because shouldAdvertise has already suppressed the frame.
    expect(presenceStatusFor('invisible')).toBe('available');
  });

  it('always returns a member of the PresenceStatus union, for every availability', () => {
    for (const availability of ALL_AVAILABILITIES) {
      expect(VALID_PRESENCE_STATUSES).toContain(presenceStatusFor(availability));
    }
  });
});

/* ------------------------------------------------------------------ *
 * displayTagFor
 * ------------------------------------------------------------------ */

describe('displayTagFor', () => {
  const broadcasting = settingsWith({ broadcastDisplayName: true });

  it('emits nothing at all when broadcastDisplayName is off', () => {
    const silent = settingsWith({ broadcastDisplayName: false });
    expect(displayTagFor(makeProfile(), silent)).toBe('');
    expect(displayTagFor(makeProfile({ name: 'Ada' }), silent)).toBe('');
    expect(displayTagFor(makeProfile({ name: '日本語' }), silent)).toBe('');
  });

  it('emits the first name only, never the rest of the name', () => {
    expect(displayTagFor(makeProfile({ name: 'Ada Lovelace' }), broadcasting)).toBe('Ada');
    expect(displayTagFor(makeProfile({ name: 'Grace Brewster Murray Hopper' }), broadcasting)).toBe(
      'Grace',
    );
  });

  it('emits the whole word for a single-word name', () => {
    expect(displayTagFor(makeProfile({ name: 'Prince' }), broadcasting)).toBe('Prince');
    expect(displayTagFor(makeProfile({ name: 'X' }), broadcasting)).toBe('X');
  });

  it('emits an empty tag for an empty name', () => {
    expect(displayTagFor(makeProfile({ name: '' }), broadcasting)).toBe('');
  });

  it('emits an empty tag for a name that is only whitespace', () => {
    expect(displayTagFor(makeProfile({ name: '   ' }), broadcasting)).toBe('');
    expect(displayTagFor(makeProfile({ name: '\t\n  \r' }), broadcasting)).toBe('');
  });

  it('ignores leading, trailing and repeated whitespace around the first name', () => {
    expect(
      displayTagFor(makeProfile({ name: '  Grace \t  Brewster\nHopper  ' }), broadcasting),
    ).toBe('Grace');
    // A non-breaking space is whitespace to JavaScript, so it is a name boundary too.
    expect(displayTagFor(makeProfile({ name: 'Ada Lovelace' }), broadcasting)).toBe('Ada');
  });

  it('keeps a first name of exactly MAX_DISPLAY_TAG_BYTES bytes whole', () => {
    const tag = displayTagFor(makeProfile({ name: 'Jonathan Smith' }), broadcasting);
    expect(tag).toBe('Jonathan');
    expect(utf8Encode(tag).length).toBe(MAX_DISPLAY_TAG_BYTES);
  });

  it('keeps a first name one byte under the limit whole', () => {
    const tag = displayTagFor(makeProfile({ name: 'Jonatha Smith' }), broadcasting);
    expect(tag).toBe('Jonatha');
    expect(utf8Encode(tag).length).toBe(MAX_DISPLAY_TAG_BYTES - 1);
  });

  it('truncates a first name one byte over the limit down to the limit', () => {
    const tag = displayTagFor(makeProfile({ name: 'Jonathans Smith' }), broadcasting);
    expect(tag).toBe('Jonathan');
    expect(utf8Encode(tag).length).toBe(MAX_DISPLAY_TAG_BYTES);
  });

  it('never splits a two-byte character across the byte limit', () => {
    // 'Zzzzzzzä' is 9 bytes; byte 8 is the continuation byte of the
    // U+00E4, so the whole character is dropped rather than halved.
    const tag = displayTagFor(makeProfile({ name: 'Zzzzzzzä Lovelace' }), broadcasting);
    expect(tag).toBe('Zzzzzzz');
    expect(utf8Encode(tag).length).toBe(7);
    expect(tag).not.toContain('�');
  });

  it('never splits a three-byte character in an entirely multi-byte name', () => {
    const name = '日本語です テスト';
    const tag = displayTagFor(makeProfile({ name }), broadcasting);
    expect(tag).toBe('日本');
    expect(utf8Encode(tag).length).toBe(6);
    expect(tag).not.toContain('�');
  });

  it('never splits a four-byte character in an emoji name', () => {
    const grin = '\u{1f600}';
    const tag = displayTagFor(makeProfile({ name: grin + grin + grin }), broadcasting);
    expect(tag).toBe(grin + grin);
    expect(utf8Encode(tag).length).toBe(MAX_DISPLAY_TAG_BYTES);
    expect(tag).not.toContain('�');

    // One leading ASCII byte pushes the second emoji's tail out of budget.
    const mixed = displayTagFor(makeProfile({ name: 'a' + grin + grin }), broadcasting);
    expect(mixed).toBe('a' + grin);
    expect(utf8Encode(mixed).length).toBe(5);
  });

  it('keeps broadcasting the first name for a connections_only profile', () => {
    // OBSERVED BEHAVIOUR: displayTagFor consults `broadcastDisplayName` only --
    // it does not look at `settings.visibility` (PrivacyService.ts:137-141).
    // A connections-only user's first name still goes into the frame that any
    // scanner can hear; hiding them from non-connections happens further up.
    const settings = settingsWith({ visibility: 'connections_only' });
    expect(displayTagFor(makeProfile({ name: 'Ada Lovelace' }), settings)).toBe('Ada');
  });

  it('splits on whitespace only, so a zero-width separator is not a name boundary', () => {
    // Characterisation, not endorsement: U+200B is not in the JS \s class, so
    // 'Ada​Lovelace' is a single token and the 8-byte budget is spent on
    // it. Real names do not contain U+200B; see the coverage notes.
    const tag = displayTagFor(makeProfile({ name: 'Ada​Lovelace' }), broadcasting);
    expect(tag).toBe('Ada​Lo');
    expect(utf8Encode(tag).length).toBe(MAX_DISPLAY_TAG_BYTES);
  });
});

/* ------------------------------------------------------------------ *
 * The 24-byte frame's privacy invariant
 * ------------------------------------------------------------------ */

describe('displayTagFor privacy invariant', () => {
  const SENSITIVE = [
    'Analytical',
    'Engines',
    'Ltd',
    'Chief',
    'Engineer',
    'ada@example.com',
    '@',
    'example.com',
    'Lovelace',
    'Smith',
    'Hopper',
    'Übermann',
    'テスト',
    'she/her',
    'algorithms',
  ];

  // [name on the profile, the tag it is allowed to produce]
  const NAMES: Array<[string, string]> = [
    ['Ada Lovelace', 'Ada'],
    ['Jonathans Smith', 'Jonathan'],
    ['  Grace   Hopper  ', 'Grace'],
    ['Zoë Übermann', 'Zoë'],
    ['日本語です テスト', '日本'],
    ['Prince', 'Prince'],
    ['X Y', 'X'],
    ['', ''],
    ['   ', ''],
    ['\u{1f600}\u{1f600}\u{1f600} Lovelace', '\u{1f600}\u{1f600}'],
  ];

  function adversarial(name: string): Profile {
    return makeProfile({
      name,
      company: 'Analytical Engines Ltd',
      role: 'Chief Engineer',
      headline: 'Chief Engineer at Analytical Engines Ltd, ada@example.com',
      bio: 'Reach me at ada@example.com',
      pronouns: 'she/her',
      skills: ['algorithms'],
    });
  }

  it('never emits a company, role, headline, email or surname for any name it is given', () => {
    for (const [name, expected] of NAMES) {
      const tag = displayTagFor(adversarial(name), settingsWith());
      expect(tag).toBe(expected);
      for (const secret of SENSITIVE) {
        expect(tag).not.toContain(secret);
      }
    }
  });

  it('only ever emits a prefix of the first whitespace-delimited token of the name', () => {
    for (const [name] of NAMES) {
      const tag = displayTagFor(adversarial(name), settingsWith());
      const firstToken = name.trim().split(/\s+/)[0] ?? '';
      expect(firstToken.startsWith(tag)).toBe(true);
      expect(tag).not.toMatch(/\s/);
    }
  });

  it('never exceeds the 8-byte tag budget and never emits a replacement character', () => {
    for (const [name] of NAMES) {
      const tag = displayTagFor(adversarial(name), settingsWith());
      expect(utf8Encode(tag).length).toBeLessThanOrEqual(MAX_DISPLAY_TAG_BYTES);
      expect(tag).not.toContain('�');
    }
  });
});

/* ------------------------------------------------------------------ *
 * describePrivacy
 * ------------------------------------------------------------------ */

describe('describePrivacy', () => {
  const INVISIBLE = 'You are invisible. Nobody nearby can see you.';
  const CONNECTIONS = 'Only your connections can see you on the map.';
  const BUSY = 'Attendees nearby can see you, marked as busy.';
  const OPEN = 'Attendees nearby can see your name, role and company.';

  it('reports invisibility for an invisible profile at every availability', () => {
    const settings = settingsWith({ visibility: 'invisible' });
    for (const availability of ALL_AVAILABILITIES) {
      expect(describePrivacy(settings, availability)).toBe(INVISIBLE);
    }
  });

  it('reports invisibility for an invisible availability at every visibility', () => {
    for (const visibility of ALL_VISIBILITIES) {
      expect(describePrivacy(settingsWith({ visibility }), 'invisible')).toBe(INVISIBLE);
    }
  });

  it('tells a connections_only user that only connections can see them, busy or not', () => {
    const settings = settingsWith({ visibility: 'connections_only' });
    expect(describePrivacy(settings, 'available')).toBe(CONNECTIONS);
    expect(describePrivacy(settings, 'maybe')).toBe(CONNECTIONS);
    // Precedence: the connections_only sentence wins over the busy sentence.
    expect(describePrivacy(settings, 'busy')).toBe(CONNECTIONS);
  });

  it('tells a visible user whether they are marked busy or openly approachable', () => {
    const settings = settingsWith({ visibility: 'visible' });
    expect(describePrivacy(settings, 'busy')).toBe(BUSY);
    expect(describePrivacy(settings, 'available')).toBe(OPEN);
    expect(describePrivacy(settings, 'maybe')).toBe(OPEN);
  });

  it('answers every one of the twelve combinations with one of exactly four sentences', () => {
    const seen: string[] = [];
    for (const visibility of ALL_VISIBILITIES) {
      for (const availability of ALL_AVAILABILITIES) {
        const sentence = describePrivacy(settingsWith({ visibility }), availability);
        expect(sentence.length).toBeGreaterThan(0);
        expect(sentence.endsWith('.')).toBe(true);
        seen.push(sentence);
      }
    }
    expect(seen).toHaveLength(12);
    expect([...new Set(seen)].sort()).toStrictEqual([BUSY, OPEN, CONNECTIONS, INVISIBLE].sort());
  });

  /**
   * DEFECT -- PrivacyService.ts:199 (the final return of describePrivacy).
   *
   * describePrivacy ignores `settings.fields` entirely. When the user has set
   * `role` and `company` to `private`, canSee() correctly reports that an
   * attendee cannot see them, yet the plain-language summary still promises
   * "Attendees nearby can see your name, role and company." The module
   * contradicts itself on the one screen whose entire purpose is to answer
   * "who can see me" without opening a settings screen.
   */
  it.failing('does not promise attendees the role and company the user marked private', () => {
    const settings = settingsWith({ fields: { company: 'private', role: 'private' } });
    expect(canSee(settings, 'company', 'attendee')).toBe(false);
    expect(canSee(settings, 'role', 'attendee')).toBe(false);

    const sentence = describePrivacy(settings, 'available');
    expect(sentence).not.toContain('company');
    expect(sentence).not.toContain('role');
  });
});

/* ------------------------------------------------------------------ *
 * Option tables shown in the UI
 * ------------------------------------------------------------------ */

describe('the option tables offered in the UI', () => {
  it('offers every Visibility value exactly once with non-empty copy', () => {
    expect(VISIBILITY_OPTIONS.map((option) => option.value)).toStrictEqual(ALL_VISIBILITIES);
    for (const option of VISIBILITY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
    }
  });

  it('offers every Availability value exactly once with non-empty copy', () => {
    expect(AVAILABILITY_OPTIONS.map((option) => option.value)).toStrictEqual(ALL_AVAILABILITIES);
    for (const option of AVAILABILITY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint.length).toBeGreaterThan(0);
    }
  });
});
