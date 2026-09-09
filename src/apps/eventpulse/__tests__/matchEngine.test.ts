/**
 * MatchEngine — the rules that decide who the app tells you to walk over and talk to.
 *
 * Every expectation here is an exact arithmetic value derived from the WEIGHTS table in
 * `recommendations/MatchEngine.ts`. That is deliberate: the module's whole premise is that
 * a rule you can read is a rule you can debug, so a test that only asserts "went up" would
 * throw away the one property the design is buying. If a weight is retuned these tests are
 * supposed to fail — that is the point of pinning them.
 *
 * The fixtures are built so each factor can be isolated. `ME_PLAIN` is an `organizer`,
 * which appears in no COMPLEMENTARY pair, and the default counterpart is a `speaker`,
 * which pairs only with `student`. So a neutral pairing scores exactly zero and any number
 * a test observes is attributable to the one factor it turned on.
 */

import {
  labelForCategory,
  matchBreakdown,
  recommend,
  score,
} from '../recommendations/MatchEngine';
import type { MatchContext } from '../recommendations/MatchEngine';
import type {
  Attendee,
  Availability,
  Avatar,
  EventProfile,
  NetworkingGoal,
  PersonCategory,
  Profile,
  ProximityBand,
} from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const EVENT_ID = 'evt-northstar-2026';

const AVATAR: Avatar = { kind: 'initials', avatarId: 'AV01', hue: 212 };

interface PersonSpec {
  id: string;
  name?: string;
  category?: PersonCategory;
  interests?: string[];
  skills?: string[];
  industry?: string;
  experienceYears?: number;
  availability?: Availability;
  lookingToMeet?: string[];
  goals?: NetworkingGoal[];
  isConnection?: boolean;
  isBlocked?: boolean;
  mutualConnectionCount?: number;
}

function makeProfile(spec: PersonSpec): Profile {
  return {
    id: spec.id,
    userId: `user-${spec.id}`,
    name: spec.name ?? `Person ${spec.id}`,
    category: spec.category ?? 'other',
    experienceYears: spec.experienceYears,
    industry: spec.industry,
    skills: spec.skills ?? [],
    interests: spec.interests ?? [],
    avatar: AVATAR,
    version: 1,
    updatedAt: 1_772_000_000_000,
  };
}

function makeEventProfile(spec: PersonSpec): EventProfile {
  return {
    eventId: EVENT_ID,
    profileId: spec.id,
    availability: spec.availability ?? 'maybe',
    lookingToMeet: spec.lookingToMeet,
    goals: spec.goals,
  };
}

/** A complete, render-ready attendee. Nothing here is partial or cast. */
function person(spec: PersonSpec): Attendee {
  return {
    profile: makeProfile(spec),
    eventProfile: makeEventProfile(spec),
    visibility: 'visible',
    isConnection: spec.isConnection ?? false,
    isBlocked: spec.isBlocked ?? false,
    mutualConnectionCount: spec.mutualConnectionCount,
  };
}

interface ContextSpec {
  me: PersonSpec;
  /** profileId -> metres. */
  distances?: Record<string, number>;
  bands?: Record<string, ProximityBand>;
  connected?: string[];
  goals?: readonly NetworkingGoal[];
}

function context(spec: ContextSpec): MatchContext {
  return {
    profile: makeProfile(spec.me),
    eventProfile: makeEventProfile(spec.me),
    distances: spec.distances ? new Map(Object.entries(spec.distances)) : undefined,
    bands: spec.bands ? new Map(Object.entries(spec.bands)) : undefined,
    connectedProfileIds: spec.connected ? new Set(spec.connected) : undefined,
    goals: spec.goals,
  };
}

/** Signed-in user with no tags at all: every score below is attributable. */
const ME_PLAIN: PersonSpec = { id: 'me', name: 'Ada Rowan', category: 'organizer' };

/** Same person, carrying the maximum number of tags that can possibly overlap. */
const ME_TAGGED: PersonSpec = {
  ...ME_PLAIN,
  interests: ['Climate tech', 'Robotics', 'Urbanism', 'Ceramics'],
  skills: ['Rust', 'Kubernetes', 'Postgres', 'Terraform'],
};

/** Scores zero against `ME_PLAIN`: not complementary, not same-category, availability 'maybe'. */
function neutral(spec: Partial<PersonSpec> & { id: string }): Attendee {
  return person({ category: 'speaker', ...spec });
}

/* ------------------------------------------------------------------ *
 * The core claim: stated intent outranks similarity
 * ------------------------------------------------------------------ */

describe('stated goals versus accumulated tag overlap', () => {
  const goalContext = context({ me: ME_TAGGED, goals: ['meet_recruiters'] });

  /** Hits the goal directly (category `recruiter`) and shares nothing else. */
  const goalHitter = person({ id: 'g', name: 'Grace Ito', category: 'recruiter' });

  /** Shares every tag the user has — more overlap than the weights can even count. */
  const tagTwin = neutral({
    id: 't',
    name: 'Theo Marsh',
    interests: ['Climate tech', 'Robotics', 'Urbanism', 'Ceramics'],
    skills: ['Rust', 'Kubernetes', 'Postgres', 'Terraform'],
  });

  it('ranks a direct goal hit above the largest tag overlap the weights can produce', () => {
    // 38 for the goal versus 3*7 interests + 3*5 skills = 36, both caps saturated.
    expect(score(goalHitter, goalContext).score).toBe(38);
    expect(score(tagTwin, goalContext).score).toBe(36);
    expect(score(goalHitter, goalContext).score).toBeGreaterThan(
      score(tagTwin, goalContext).score,
    );
  });

  it('puts the goal hit first in the ranked output, not just ahead on points', () => {
    const results = recommend([tagTwin, goalHitter], goalContext);
    expect(results.map((r) => r.profileId)).toEqual(['g', 't']);
  });

  it('adding a fifth and sixth overlapping tag cannot overtake the goal hit', () => {
    const wider = neutral({
      id: 'w',
      name: 'Wren Adeyemi',
      interests: ['Climate tech', 'Robotics', 'Urbanism', 'Ceramics'],
      skills: ['Rust', 'Kubernetes', 'Postgres', 'Terraform'],
    });
    // The per-factor caps are what make the claim hold; prove they bind.
    expect(score(wider, goalContext).score).toBe(36);
    expect(score(goalHitter, goalContext).score).toBeGreaterThan(score(wider, goalContext).score);
  });

  it('scores a direct goal hit more than twice a topic-only goal hit', () => {
    const ctx = context({ me: ME_PLAIN, goals: ['learn_ai'] });
    // 'data' is a target category for learn_ai -> strong.
    const direct = person({ id: 'd', name: 'Dara Owusu', category: 'data' });
    // 'product' is not a target, but 'LLMs' is a learn_ai topic -> weak.
    const topical = person({ id: 'x', name: 'Xan Petrov', category: 'product', interests: ['LLMs'] });

    expect(score(direct, ctx).score).toBe(38);
    expect(score(topical, ctx).score).toBe(16);
  });

  it('names the goal in the reason for a direct hit and the topic for a soft hit', () => {
    const ctx = context({ me: ME_PLAIN, goals: ['learn_ai'] });
    const direct = person({ id: 'd', name: 'Dara Owusu', category: 'data' });
    const topical = person({ id: 'x', name: 'Xan Petrov', category: 'product', interests: ['LLMs'] });

    expect(score(direct, ctx).reasons).toEqual(['Matches your goal: learn about ai']);
    expect(score(topical, ctx).reasons).toEqual(['Works on LLM']);
  });

  it("treats 'just explore' as an explicit request not to be filtered, scoring nobody", () => {
    const ctx = context({ me: ME_PLAIN, goals: ['just_explore'] });
    expect(score(person({ id: 'r', category: 'recruiter' }), ctx).score).toBe(0);
    expect(score(neutral({ id: 's' }), ctx).score).toBe(0);
  });

  it("satisfies 'grow my network' with a stranger but not with an existing connection", () => {
    const ctx = context({ me: ME_PLAIN, goals: ['grow_network'] });
    const stranger = neutral({ id: 's', isConnection: false });
    const known = neutral({ id: 'k', isConnection: true });

    expect(score(stranger, ctx)).toEqual({ score: 16, reasons: ['New to your network'] });
    expect(score(known, ctx)).toEqual({ score: 0, reasons: [] });
  });

  it('prefers the context goals over the event profile goals, and an empty list disables both', () => {
    const recruiter = person({ id: 'r', category: 'recruiter' });
    const fromEventProfile = context({ me: { ...ME_PLAIN, goals: ['meet_recruiters'] } });
    const overridden = context({ me: { ...ME_PLAIN, goals: ['meet_recruiters'] }, goals: ['just_explore'] });
    const cleared = context({ me: { ...ME_PLAIN, goals: ['meet_recruiters'] }, goals: [] });

    expect(score(recruiter, fromEventProfile).score).toBe(38);
    expect(score(recruiter, overridden).score).toBe(0);
    expect(score(recruiter, cleared).score).toBe(0);
  });

  /**
   * DEFECT — MatchEngine.ts:10-12 promises "The strongest signal is not similarity — it is
   * *stated intent* ... that beats any number of overlapping tags", but
   * WEIGHTS.statedIntentTheyWantMe is 38-4 = 34 (MatchEngine.ts:51) while the tag caps at
   * MatchEngine.ts:164 and :170 allow 3*7 + 3*5 = 36. A stranger who happens to share three
   * interests and three skills therefore outranks the person who wrote down that they came
   * here to meet someone with your exact role. Raising the weight above 36 (or lowering a
   * tag cap) fixes it and turns this red.
   */
  it('ranks someone who stated they want to meet your role above a maximal tag twin', () => {
    const ctx = context({ me: ME_TAGGED });
    const intentional = neutral({
      id: 'i',
      name: 'Iris Vale',
      lookingToMeet: ['Organizers'],
    });

    expect(score(intentional, ctx).score).toBeGreaterThan(score(tagTwin, ctx).score);
  });

  it('does let stated intent win once the tag overlap is one notch below its cap', () => {
    // Three interests and two skills is 21 + 10 = 31, which stated intent (37) clears.
    const ctx = context({ me: ME_TAGGED });
    const intentional = neutral({ id: 'i', name: 'Iris Vale', lookingToMeet: ['Organizers'] });
    const nearlyMaximal = neutral({
      id: 'n',
      name: 'Nia Fallon',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
      skills: ['Rust', 'Kubernetes'],
    });

    expect(score(intentional, ctx).score).toBe(37);
    expect(score(nearlyMaximal, ctx).score).toBe(31);
    expect(score(intentional, ctx).score).toBeGreaterThan(score(nearlyMaximal, ctx).score);
  });
});

/* ------------------------------------------------------------------ *
 * Stated intent, both directions
 * ------------------------------------------------------------------ */

describe('stated intent in "looking to meet"', () => {
  it('scores their wanting you higher than your wanting them', () => {
    const theyWantMe = neutral({ id: 'a', lookingToMeet: ['Organizers'] });
    const iWantThem = person({ id: 'b', category: 'recruiter' });
    const ctx = context({ me: { ...ME_PLAIN, lookingToMeet: ['Recruiters'] } });

    expect(score(theyWantMe, ctx).score).toBe(37);
    expect(score(iWantThem, ctx).score).toBe(30);
  });

  it('resolves the phrases people actually type through the synonym table', () => {
    const ctx = context({ me: { ...ME_PLAIN, lookingToMeet: ['ML engineers'] } });
    // 'ML engineers' is mapped to the `data` category, not `engineer`.
    expect(score(person({ id: 'd', category: 'data' }), ctx).score).toBe(30);
    expect(score(person({ id: 'e', category: 'engineer' }), ctx).score).toBe(0);
  });

  it('falls back to a substring match so free-text intent still lands', () => {
    const ctx = context({ me: { ...ME_PLAIN, lookingToMeet: ['climate-tech founders'] } });
    // Not a synonym-table key, so it survives only on 'climate-tech founders'
    // containing 'founder'. Organiser and founder are not a complementary pair, so 30 is
    // the whole of it.
    expect(score(person({ id: 'f', category: 'founder' }), ctx).score).toBe(30);
    expect(score(person({ id: 'i', category: 'investor' }), ctx).score).toBe(0);
  });

  /**
   * DEFECT — MatchEngine.ts:423-450 renders the `organizer` category as the British
   * "organisers", but the intent matcher's fallback at MatchEngine.ts:116 tests the raw
   * enum value 'organizer' as a substring, and 'organisers' does not contain 'organizer'.
   * So the exact wording the app itself prints — score() line 154 emits "They are looking
   * to meet organisers" — is a string the same module refuses to match. The American
   * spelling works, which is what makes this a spelling bug rather than a design choice.
   */
  it.failing("matches an intent written in the app's own label for the organiser category", () => {
    const ctx = context({ me: ME_PLAIN });
    const candidate = neutral({ id: 'o', lookingToMeet: [labelForCategory('organizer')] });

    expect(score(candidate, ctx).score).toBe(37);
  });

  it('matches the American spelling of the same intent', () => {
    const ctx = context({ me: ME_PLAIN });
    const candidate = neutral({ id: 'o', lookingToMeet: ['Organizers'] });

    expect(score(candidate, ctx)).toEqual({
      score: 37,
      reasons: ['They are looking to meet organisers'],
    });
  });
});

/* ------------------------------------------------------------------ *
 * Each scoring factor, in isolation
 * ------------------------------------------------------------------ */

describe('each scoring factor moves the score on its own', () => {
  const plain = context({ me: ME_PLAIN });

  it('scores a person with nothing in common at exactly zero, with no reasons', () => {
    expect(score(neutral({ id: 'n' }), plain)).toEqual({ score: 0, reasons: [] });
  });

  it('adds seven per shared interest and stops counting at three', () => {
    const ctx = context({ me: ME_TAGGED });
    const one = neutral({ id: 'a', interests: ['Climate tech'] });
    const two = neutral({ id: 'b', interests: ['Climate tech', 'Robotics'] });
    const three = neutral({ id: 'c', interests: ['Climate tech', 'Robotics', 'Urbanism'] });
    const four = neutral({
      id: 'd',
      interests: ['Climate tech', 'Robotics', 'Urbanism', 'Ceramics'],
    });

    expect(score(one, ctx).score).toBe(7);
    expect(score(two, ctx).score).toBe(14);
    expect(score(three, ctx).score).toBe(21);
    expect(score(four, ctx).score).toBe(21);
  });

  it('names at most the first two shared interests in the reason', () => {
    const ctx = context({ me: ME_TAGGED });
    const three = neutral({ id: 'c', interests: ['Climate tech', 'Robotics', 'Urbanism'] });

    expect(score(three, ctx).reasons).toEqual(['Both into Climate tech and Robotics']);
  });

  it('adds five per shared skill and stops counting at three', () => {
    const ctx = context({ me: ME_TAGGED });
    const one = neutral({ id: 'a', skills: ['Rust'] });
    const three = neutral({ id: 'c', skills: ['Rust', 'Kubernetes', 'Postgres'] });
    const four = neutral({ id: 'd', skills: ['Rust', 'Kubernetes', 'Postgres', 'Terraform'] });

    expect(score(one, ctx)).toEqual({ score: 5, reasons: ['Shared skills: Rust'] });
    expect(score(three, ctx).score).toBe(15);
    expect(score(four, ctx).score).toBe(15);
  });

  it('compares tags case-insensitively but reports them in the reader\'s own casing', () => {
    const ctx = context({ me: { ...ME_PLAIN, interests: ['Climate Tech'] } });
    const shouty = neutral({ id: 'a', interests: ['CLIMATE TECH'] });

    expect(score(shouty, ctx)).toEqual({ score: 7, reasons: ['Both into Climate Tech'] });
  });

  it('adds fourteen for a complementary role, in both directions', () => {
    const founderMe = context({ me: { ...ME_PLAIN, category: 'founder' } });
    const investorMe = context({ me: { ...ME_PLAIN, category: 'investor' } });

    expect(score(person({ id: 'i', category: 'investor' }), founderMe)).toEqual({
      score: 14,
      reasons: ['Investors — a useful counterpart'],
    });
    expect(score(person({ id: 'f', category: 'founder' }), investorMe)).toEqual({
      score: 14,
      reasons: ['Founders — a useful counterpart'],
    });
  });

  it('adds nothing for a role pairing that is not on the complementary list', () => {
    const founderMe = context({ me: { ...ME_PLAIN, category: 'founder' } });
    expect(score(person({ id: 's', category: 'speaker' }), founderMe).score).toBe(0);
    expect(score(person({ id: 'o', category: 'organizer' }), founderMe).score).toBe(0);
  });

  it('adds five for the same industry, and says nothing about it out loud', () => {
    const ctx = context({ me: { ...ME_PLAIN, industry: 'Climate' } });
    // A silent factor: it moves the ranking but contributes no explanation.
    expect(score(neutral({ id: 'a', industry: 'Climate' }), ctx)).toEqual({
      score: 5,
      reasons: [],
    });
  });

  it('does not treat two unknown industries as a match', () => {
    const noIndustry = context({ me: ME_PLAIN });
    const withIndustry = context({ me: { ...ME_PLAIN, industry: 'Climate' } });

    expect(score(neutral({ id: 'a' }), noIndustry).score).toBe(0);
    expect(score(neutral({ id: 'b', industry: 'Fintech' }), withIndustry).score).toBe(0);
  });

  it('rewards availability and penalises being busy', () => {
    expect(score(neutral({ id: 'a', availability: 'available' }), plain).score).toBe(6);
    expect(score(neutral({ id: 'b', availability: 'maybe' }), plain).score).toBe(0);
    expect(score(neutral({ id: 'c', availability: 'busy' }), plain).score).toBe(-10);
  });

  it('pushes a busy person below the recommendation threshold that an available one clears', () => {
    const ctx = context({ me: ME_TAGGED });
    const busy = neutral({
      id: 'b',
      name: 'Bo Lindqvist',
      availability: 'busy',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
    });
    const free = neutral({
      id: 'f',
      name: 'Fen Adeyemi',
      availability: 'available',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
    });

    expect(score(busy, ctx).score).toBe(11); // 21 - 10
    expect(score(free, ctx).score).toBe(27); // 21 + 6
    expect(recommend([busy, free], ctx).map((r) => r.profileId)).toEqual(['f']);
  });

  it('adds six for someone four or more years further along in the same field', () => {
    const ctx = context({ me: { ...ME_PLAIN, category: 'engineer', experienceYears: 1 } });
    const senior = person({ id: 's', category: 'engineer', experienceYears: 5 });

    expect(score(senior, ctx)).toEqual({
      score: 6,
      reasons: ["5 years' experience — 4 more than you"],
    });
  });

  it('withholds the seniority bonus three years apart, and once the reader passes five years', () => {
    const junior = context({ me: { ...ME_PLAIN, category: 'engineer', experienceYears: 1 } });
    const established = context({ me: { ...ME_PLAIN, category: 'engineer', experienceYears: 5 } });

    // One below the four-year gap.
    expect(score(person({ id: 'a', category: 'engineer', experienceYears: 4 }), junior).score).toBe(0);
    // Exactly at the gap, but the reader is no longer junior enough to benefit.
    expect(score(person({ id: 'b', category: 'engineer', experienceYears: 9 }), established).score).toBe(0);
    // Exactly one below that seniority cut-off.
    const almost = context({ me: { ...ME_PLAIN, category: 'engineer', experienceYears: 4 } });
    expect(score(person({ id: 'c', category: 'engineer', experienceYears: 8 }), almost).score).toBe(6);
  });

  it('treats a missing experience figure as zero years rather than skipping the rule', () => {
    const ctx = context({ me: { ...ME_PLAIN, category: 'engineer' } });
    const senior = person({ id: 's', category: 'engineer', experienceYears: 4 });

    expect(score(senior, ctx)).toEqual({
      score: 6,
      reasons: ["4 years' experience — 4 more than you"],
    });
  });
});

/* ------------------------------------------------------------------ *
 * Proximity bands
 * ------------------------------------------------------------------ */

describe('proximity bands', () => {
  function atDistance(metres: number): number {
    return score(neutral({ id: 'p' }), context({ me: ME_PLAIN, distances: { p: metres } })).score;
  }

  it('adds sixteen inside three metres, right down to zero metres', () => {
    expect(atDistance(0)).toBe(16);
    expect(atDistance(2.999)).toBe(16);
  });

  it('drops to eleven at exactly three metres and holds it below seven', () => {
    expect(atDistance(3)).toBe(11);
    expect(atDistance(6.999)).toBe(11);
  });

  it('drops to six at exactly seven metres and holds it below twelve', () => {
    expect(atDistance(7)).toBe(6);
    expect(atDistance(11.999)).toBe(6);
  });

  it('adds nothing from exactly twelve metres outward', () => {
    expect(atDistance(12)).toBe(0);
    expect(atDistance(40)).toBe(0);
  });

  it('adds nothing at all when the person is not currently detected', () => {
    expect(score(neutral({ id: 'p' }), context({ me: ME_PLAIN })).score).toBe(0);
    expect(
      score(neutral({ id: 'p' }), context({ me: ME_PLAIN, distances: { other: 1 } })).score,
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Mutual connections
 * ------------------------------------------------------------------ */

describe('mutual connections', () => {
  const plain = context({ me: ME_PLAIN });

  /**
   * NOTE ON PROVENANCE: `Attendee.mutualConnectionCount` is weighted at nine points each
   * up to three (MatchEngine.ts:53, :219-223) — a maximum of 27, which is more than every
   * shared interest and skill a profile can carry. It is also the one input on the
   * `Attendee` record that a device cannot compute for itself: EventPulse discovers peers
   * over BLE and holds only its own connection list, so the size of the intersection
   * between two people's networks can only come from a server that has both. These tests
   * pin the arithmetic as written; they do not claim the number can be honestly populated
   * on-device, and an offline build must leave it undefined rather than guess.
   */
  it('adds nine per mutual connection and stops counting at three', () => {
    expect(score(neutral({ id: 'a', mutualConnectionCount: 1 }), plain).score).toBe(9);
    expect(score(neutral({ id: 'b', mutualConnectionCount: 2 }), plain).score).toBe(18);
    expect(score(neutral({ id: 'c', mutualConnectionCount: 3 }), plain).score).toBe(27);
    expect(score(neutral({ id: 'd', mutualConnectionCount: 7 }), plain).score).toBe(27);
  });

  it('adds nothing for zero or an unknown count', () => {
    expect(score(neutral({ id: 'a', mutualConnectionCount: 0 }), plain)).toEqual({
      score: 0,
      reasons: [],
    });
    expect(score(neutral({ id: 'b' }), plain)).toEqual({ score: 0, reasons: [] });
  });

  it('reports the true count in the reason even where the score has stopped counting', () => {
    expect(score(neutral({ id: 'a', mutualConnectionCount: 1 }), plain).reasons).toEqual([
      '1 mutual connection',
    ]);
    expect(score(neutral({ id: 'b', mutualConnectionCount: 7 }), plain).reasons).toEqual([
      '7 mutual connections',
    ]);
  });

  it('lets three mutual connections outweigh every tag a profile can share', () => {
    const ctx = context({ me: ME_TAGGED });
    const mutuals = neutral({ id: 'm', mutualConnectionCount: 3 });
    const twin = neutral({
      id: 't',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
      skills: ['Rust', 'Kubernetes', 'Postgres'],
    });

    expect(score(mutuals, ctx).score).toBe(27);
    expect(score(twin, ctx).score).toBe(36);
    // Weaker than the full tag cap, stronger than either half of it on its own.
    expect(score(mutuals, ctx).score).toBeGreaterThan(21);
  });
});

/* ------------------------------------------------------------------ *
 * The already-connected penalty
 * ------------------------------------------------------------------ */

describe('the already-connected penalty', () => {
  const ctx = context({ me: ME_PLAIN, goals: ['meet_recruiters'], connected: ['known'] });

  const known = person({ id: 'known', name: 'Kai Osei', category: 'recruiter' });
  const stranger = person({ id: 'new', name: 'Nour Haddad', category: 'recruiter' });

  it('subtracts seventy, dropping an identical connection below a stranger', () => {
    expect(score(stranger, ctx).score).toBe(38);
    expect(score(known, ctx).score).toBe(-32);
    expect(score(known, ctx).score).toBeLessThan(score(stranger, ctx).score);
  });

  it('keeps the connection out of the recommendations while the stranger stays in', () => {
    expect(recommend([known, stranger], ctx).map((r) => r.profileId)).toEqual(['new']);
  });

  it('cannot be outrun by every other factor at once', () => {
    const loaded = person({
      id: 'known',
      name: 'Kai Osei',
      category: 'recruiter',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
      skills: ['Rust', 'Kubernetes', 'Postgres'],
      mutualConnectionCount: 3,
      availability: 'available',
    });
    const richContext = context({
      me: ME_TAGGED,
      goals: ['meet_recruiters'],
      connected: ['known'],
      distances: { known: 1 },
    });
    // 38 + 21 + 15 + 27 + 6 + 16 = 123, less the 70 penalty.
    expect(score(loaded, richContext).score).toBe(53);
  });
});

/* ------------------------------------------------------------------ *
 * recommend()
 * ------------------------------------------------------------------ */

describe('recommend()', () => {
  const goalCtx = context({ me: ME_PLAIN, goals: ['meet_recruiters'] });

  const ranked = [
    person({ id: 'a', name: 'Amara Diallo', category: 'recruiter', mutualConnectionCount: 3 }), // 65
    person({ id: 'b', name: 'Bruno Sasaki', category: 'recruiter', mutualConnectionCount: 2 }), // 56
    person({ id: 'c', name: 'Ciara Nolan', category: 'recruiter', mutualConnectionCount: 1 }), // 47
    person({ id: 'd', name: 'Dmitri Volk', category: 'recruiter' }), // 38
  ];

  it('orders results by descending score', () => {
    const results = recommend(ranked, goalCtx);
    expect(results.map((r) => r.profileId)).toEqual(['a', 'b', 'c', 'd']);
    expect(results.map((r) => r.score)).toEqual([65, 56, 47, 38]);
  });

  it('honours the limit by keeping the highest scores, not the first arrivals', () => {
    expect(recommend([...ranked].reverse(), goalCtx, { limit: 2 }).map((r) => r.profileId)).toEqual([
      'a',
      'b',
    ]);
    expect(recommend(ranked, goalCtx, { limit: 1 }).map((r) => r.profileId)).toEqual(['a']);
    expect(recommend(ranked, goalCtx, { limit: 0 })).toEqual([]);
  });

  it('breaks a score tie alphabetically by name so the order is stable', () => {
    const zara = person({ id: 'z', name: 'Zara Okoye', category: 'recruiter' });
    const alan = person({ id: 'y', name: 'Alan Reyes', category: 'recruiter' });

    expect(recommend([zara, alan], goalCtx).map((r) => r.profileId)).toEqual(['y', 'z']);
    expect(recommend([alan, zara], goalCtx).map((r) => r.profileId)).toEqual(['y', 'z']);
  });

  it('excludes people with no distance entry when nearbyOnly is set', () => {
    const near = person({ id: 'n', name: 'Nell Ford', category: 'recruiter' });
    const far = person({ id: 'f', name: 'Fabio Renzi', category: 'recruiter' });
    const touching = person({ id: 't', name: 'Tomas Bech', category: 'recruiter' });
    const ctx = context({
      me: ME_PLAIN,
      goals: ['meet_recruiters'],
      distances: { n: 5, t: 0 },
    });

    expect(recommend([near, far, touching], ctx, { nearbyOnly: true }).map((r) => r.profileId))
      // Zero metres is a real reading, not a missing one: it must survive the filter.
      .toEqual(['t', 'n']);
    expect(recommend([near, far, touching], ctx).map((r) => r.profileId)).toEqual(['t', 'n', 'f']);
  });

  it('shows nothing rather than noise below the default minimum score', () => {
    const ctx = context({ me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust', 'Kubernetes'] } });
    const below = neutral({
      id: 'below',
      name: 'Bea Lin',
      interests: ['Climate tech'],
      skills: ['Rust', 'Kubernetes'],
    });

    expect(score(below, ctx).score).toBe(17); // one below the threshold
    expect(recommend([below], ctx)).toEqual([]);
  });

  it('includes a candidate sitting exactly on the minimum score', () => {
    const ctx = context({ me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust', 'Kubernetes'] } });
    const below = neutral({
      id: 'below',
      name: 'Bea Lin',
      interests: ['Climate tech'],
      skills: ['Rust', 'Kubernetes'],
    });
    const exactly = neutral({
      id: 'exact',
      name: 'Eli Varga',
      interests: ['Climate tech'],
      skills: ['Rust'],
      availability: 'available',
    });

    expect(score(exactly, ctx).score).toBe(18);
    expect(recommend([below, exactly], ctx).map((r) => r.profileId)).toEqual(['exact']);
  });

  it('applies a caller-supplied minimum score in place of the default', () => {
    const ctx = context({ me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust', 'Kubernetes'] } });
    const below = neutral({
      id: 'below',
      name: 'Bea Lin',
      interests: ['Climate tech'],
      skills: ['Rust', 'Kubernetes'],
    });
    const exactly = neutral({
      id: 'exact',
      name: 'Eli Varga',
      interests: ['Climate tech'],
      skills: ['Rust'],
      availability: 'available',
    });

    expect(recommend([below, exactly], ctx, { minScore: 17 }).map((r) => r.profileId)).toEqual([
      'exact',
      'below',
    ]);
    expect(recommend([below, exactly], ctx, { minScore: 19 })).toEqual([]);
  });

  it('never recommends the signed-in user to themselves', () => {
    const self = person({ id: 'me', name: 'Ada Rowan', category: 'recruiter', mutualConnectionCount: 3 });
    const other = person({ id: 'o', name: 'Otto Brand', category: 'recruiter' });

    expect(recommend([self, other], goalCtx).map((r) => r.profileId)).toEqual(['o']);
    expect(recommend([self], goalCtx)).toEqual([]);
  });

  it('excludes blocked people and people who have gone invisible', () => {
    const blocked = person({ id: 'x', name: 'Xu Wei', category: 'recruiter', isBlocked: true });
    const hidden = person({ id: 'h', name: 'Hana Reid', category: 'recruiter', availability: 'invisible' });
    const visible = person({ id: 'v', name: 'Vic Marsh', category: 'recruiter' });

    expect(recommend([blocked, hidden, visible], goalCtx).map((r) => r.profileId)).toEqual(['v']);
  });

  it('carries the measured distance and the band through to the result', () => {
    const near = person({ id: 'n', name: 'Nell Ford', category: 'recruiter' });
    const unplaced = person({ id: 'u', name: 'Uma Sethi', category: 'recruiter' });
    const ctx = context({
      me: ME_PLAIN,
      goals: ['meet_recruiters'],
      distances: { n: 4.2 },
      bands: { n: 'close' },
    });

    const [first, second] = recommend([near, unplaced], ctx);
    expect(first).toEqual({
      attendee: near,
      profileId: 'n',
      score: 49, // 38 + 11 for the 3-7 m band
      reasons: ['Matches your goal: meet recruiters'],
      distance: 4.2,
      band: 'close',
    });
    expect(second.distance).toBeUndefined();
    expect(second.band).toBeUndefined();
  });

  it('trims the explanation to three reasons while score() keeps them all', () => {
    const ctx = context({
      me: {
        ...ME_PLAIN,
        interests: ['Climate tech'],
        skills: ['Rust'],
        lookingToMeet: ['Recruiters'],
        goals: ['meet_recruiters'],
      },
    });
    const candidate = person({
      id: 'r',
      name: 'Rae Alvarez',
      category: 'recruiter',
      lookingToMeet: ['Organizers'],
      interests: ['Climate tech'],
      skills: ['Rust'],
    });

    const full = score(candidate, ctx);
    expect(full.score).toBe(117); // 38 + 37 + 30 + 7 + 5
    expect(full.reasons).toEqual([
      'Matches your goal: meet recruiters',
      'They are looking to meet organisers',
      'You said you want to meet recruiters',
      'Both into Climate tech',
      'Shared skills: Rust',
    ]);

    const [result] = recommend([candidate], ctx);
    expect(result.reasons).toEqual([
      'Matches your goal: meet recruiters',
      'They are looking to meet organisers',
      'You said you want to meet recruiters',
    ]);
  });

  it('returns an empty list for an empty candidate list', () => {
    expect(recommend([], goalCtx)).toEqual([]);
    expect(recommend([], goalCtx, { limit: 5, nearbyOnly: true, minScore: 0 })).toEqual([]);
  });

  it('can surface a person on silent factors alone, leaving the explanation empty', () => {
    // Industry, proximity and availability all move the score without pushing a reason,
    // so a recommendation can clear the threshold with nothing to show the reader. Pinned
    // as current behaviour: the ranking is defensible, the empty `reasons` array is a gap
    // the profile card has to cope with.
    const ctx = context({
      me: { ...ME_PLAIN, industry: 'Climate' },
      distances: { q: 2 },
    });
    const quiet = neutral({ id: 'q', name: 'Quinn Baptiste', industry: 'Climate', availability: 'available' });

    const [result] = recommend([quiet], ctx);
    expect(result.score).toBe(27); // 5 + 16 + 6
    expect(result.reasons).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * matchBreakdown()
 * ------------------------------------------------------------------ */

describe('matchBreakdown()', () => {
  const thresholdCtx = context({
    me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust', 'Kubernetes'] },
  });
  const justBelow = neutral({
    id: 'below',
    interests: ['Climate tech'],
    skills: ['Rust', 'Kubernetes'],
  });
  const justAt = neutral({
    id: 'exact',
    interests: ['Climate tech'],
    skills: ['Rust'],
    availability: 'available',
  });

  it('says nothing at all one point below the visibility threshold', () => {
    expect(score(justBelow, thresholdCtx).score).toBe(17);
    expect(matchBreakdown(justBelow, thresholdCtx)).toBeNull();
  });

  it('speaks up at exactly the visibility threshold', () => {
    expect(score(justAt, thresholdCtx).score).toBe(18);
    expect(matchBreakdown(justAt, thresholdCtx)).not.toBeNull();
  });

  it('states every factor in terms of an attribute the two people actually share', () => {
    const ctx = context({
      me: {
        ...ME_PLAIN,
        interests: ['Climate tech', 'Robotics'],
        skills: ['Rust'],
        industry: 'Climate',
      },
      goals: ['meet_recruiters'],
      distances: { r: 4 },
    });
    const candidate = person({
      id: 'r',
      name: 'Rae Alvarez',
      category: 'recruiter',
      interests: ['Climate tech', 'Robotics'],
      skills: ['Rust'],
      industry: 'Climate',
      availability: 'available',
      lookingToMeet: ['Organizers'],
      mutualConnectionCount: 2,
    });

    const breakdown = matchBreakdown(candidate, ctx);
    expect(breakdown).not.toBeNull();
    if (!breakdown) return;

    expect(score(candidate, ctx).score).toBe(134);
    expect(breakdown.factors).toEqual([
      { kind: 'goal', label: 'Matches your goal — meet recruiters' },
      { kind: 'intent', label: 'Looking to meet organisers' },
      { kind: 'mutual', label: '2 mutual connections' },
      { kind: 'interests', label: '2 shared interests: Climate tech and Robotics' },
      { kind: 'skills', label: 'Both work with Rust' },
      { kind: 'industry', label: 'Both in Climate' },
      { kind: 'availability', label: 'Open to being approached right now' },
      { kind: 'proximity', label: 'Nearby right now' },
    ]);
    expect(breakdown.sharedInterests).toEqual(['Climate tech', 'Robotics']);
    expect(breakdown.sharedSkills).toEqual(['Rust']);
    expect(breakdown.percent).toBe(89);
    expect(breakdown.tier).toBe('strong');
    expect(breakdown.showPercent).toBe(true);
  });

  it('reports an integer percentage inside one and ninety-nine, never a hundred', () => {
    const ctx = context({
      me: {
        ...ME_PLAIN,
        interests: ['Climate tech', 'Robotics', 'Urbanism'],
        skills: ['Rust', 'Kubernetes', 'Postgres'],
        industry: 'Climate',
        lookingToMeet: ['Recruiters'],
      },
      goals: ['meet_recruiters'],
      distances: { r: 1 },
    });
    const bestPossible = person({
      id: 'r',
      name: 'Rae Alvarez',
      category: 'recruiter',
      interests: ['Climate tech', 'Robotics', 'Urbanism'],
      skills: ['Rust', 'Kubernetes', 'Postgres'],
      industry: 'Climate',
      availability: 'available',
      lookingToMeet: ['Organizers'],
      mutualConnectionCount: 5,
    });

    // 38 + 37 + 30 + 21 + 15 + 5 + 16 + 6 + 27 = 195, well past the 150 ceiling.
    expect(score(bestPossible, ctx).score).toBe(195);

    const breakdown = matchBreakdown(bestPossible, ctx);
    expect(breakdown).not.toBeNull();
    if (!breakdown) return;

    expect(breakdown.percent).toBe(99);
    expect(Number.isInteger(breakdown.percent)).toBe(true);
    expect(breakdown.percent).toBeGreaterThanOrEqual(1);
    expect(breakdown.percent).toBeLessThanOrEqual(99);
  });

  function tierOf(spec: {
    interests?: string[];
    skills?: string[];
    availability?: Availability;
    mutualConnectionCount?: number;
    distance?: number;
  }) {
    const ctx = context({
      me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust', 'Kubernetes', 'Postgres'] },
      goals: ['meet_recruiters'],
      distances: spec.distance === undefined ? undefined : { r: spec.distance },
    });
    const candidate = person({
      id: 'r',
      name: 'Rae Alvarez',
      category: 'recruiter',
      interests: spec.interests,
      skills: spec.skills,
      availability: spec.availability,
      mutualConnectionCount: spec.mutualConnectionCount,
    });
    return { value: score(candidate, ctx).score, breakdown: matchBreakdown(candidate, ctx) };
  }

  it("calls a score just under forty-five 'worth a look'", () => {
    const { value, breakdown } = tierOf({ availability: 'available' }); // 38 + 6
    expect(value).toBe(44);
    expect(breakdown?.tier).toBe('possible');
    expect(breakdown?.label).toBe('Worth a look');
  });

  it("calls a score of exactly forty-five a 'good match'", () => {
    const { value, breakdown } = tierOf({ interests: ['Climate tech'] }); // 38 + 7
    expect(value).toBe(45);
    expect(breakdown?.tier).toBe('good');
    expect(breakdown?.label).toBe('Good match');
  });

  it("keeps a score of sixty-nine a 'good match'", () => {
    const { value, breakdown } = tierOf({
      skills: ['Rust', 'Kubernetes', 'Postgres'],
      distance: 1,
    }); // 38 + 15 + 16
    expect(value).toBe(69);
    expect(breakdown?.tier).toBe('good');
  });

  it("promotes a score of exactly seventy to 'strong'", () => {
    const { value, breakdown } = tierOf({ skills: ['Rust'], mutualConnectionCount: 3 }); // 38 + 5 + 27
    expect(value).toBe(70);
    expect(breakdown?.tier).toBe('strong');
    expect(breakdown?.label).toBe('Great person to meet');
  });

  it('withholds the percentage from the bottom tier however many factors support it', () => {
    const ctx = context({ me: { ...ME_PLAIN, interests: ['Climate tech'], skills: ['Rust'] } });
    const candidate = neutral({
      id: 'p',
      interests: ['Climate tech'],
      skills: ['Rust'],
      availability: 'available',
    });

    const breakdown = matchBreakdown(candidate, ctx);
    expect(score(candidate, ctx).score).toBe(18);
    expect(breakdown?.factors).toHaveLength(3);
    expect(breakdown?.tier).toBe('possible');
    expect(breakdown?.showPercent).toBe(false);
  });

  it('withholds the percentage when a high score rests on a single stated factor', () => {
    // 68 points, but only the goal produces a factor: `statedIntentIWantThem` is worth 30
    // and is deliberately not narrated in the breakdown, so the number would sit alone.
    const ctx = context({
      me: { ...ME_PLAIN, lookingToMeet: ['Recruiters'] },
      goals: ['meet_recruiters'],
    });
    const candidate = person({ id: 'r', name: 'Rae Alvarez', category: 'recruiter' });

    const breakdown = matchBreakdown(candidate, ctx);
    expect(score(candidate, ctx).score).toBe(68);
    expect(breakdown?.tier).toBe('good');
    expect(breakdown?.factors).toEqual([
      { kind: 'goal', label: 'Matches your goal — meet recruiters' },
    ]);
    expect(breakdown?.showPercent).toBe(false);
  });

  it('reports empty shared lists for a candidate carrying no tags at all', () => {
    const ctx = context({ me: ME_TAGGED, goals: ['meet_recruiters'] });
    const bare = person({ id: 'r', name: 'Rae Alvarez', category: 'recruiter' });

    const breakdown = matchBreakdown(bare, ctx);
    expect(breakdown?.sharedInterests).toEqual([]);
    expect(breakdown?.sharedSkills).toEqual([]);
    expect(breakdown?.factors.map((f) => f.kind)).toEqual(['goal']);
  });
});

/* ------------------------------------------------------------------ *
 * Determinism and degenerate inputs
 * ------------------------------------------------------------------ */

describe('determinism and degenerate inputs', () => {
  const ctx = context({
    me: {
      ...ME_TAGGED,
      industry: 'Climate',
      lookingToMeet: ['Recruiters'],
    },
    goals: ['meet_recruiters', 'learn_ai'],
    distances: { r: 2.5 },
    bands: { r: 'very_close' },
    connected: ['someone-else'],
  });
  const candidate = person({
    id: 'r',
    name: 'Rae Alvarez',
    category: 'recruiter',
    interests: ['Climate tech', 'Robotics'],
    skills: ['Rust'],
    industry: 'Climate',
    availability: 'available',
    lookingToMeet: ['Organizers'],
    mutualConnectionCount: 2,
  });

  it('produces the same score and the same reasons on a repeat call', () => {
    const first = score(candidate, ctx);
    const second = score(candidate, ctx);

    expect(second).toEqual(first);
    expect(second.score).toBe(first.score);
  });

  it('produces the same ranking on a repeat call', () => {
    const others = [
      person({ id: 'a', name: 'Amara Diallo', category: 'recruiter', mutualConnectionCount: 1 }),
      person({ id: 'b', name: 'Bruno Sasaki', category: 'data', interests: ['Machine learning'] }),
      candidate,
    ];

    expect(recommend(others, ctx)).toEqual(recommend(others, ctx));
  });

  it('scores a candidate with no skills, interests or event answers without throwing', () => {
    const empty = person({ id: 'e', name: 'Eve Nkosi', skills: [], interests: [] });

    expect(() => score(empty, ctx)).not.toThrow();
    expect(score(empty, ctx)).toEqual({ score: 0, reasons: [] });
    expect(matchBreakdown(empty, ctx)).toBeNull();
    expect(recommend([empty], ctx)).toEqual([]);
  });

  it('scores against a reader who set no goals and no tags without throwing', () => {
    const bare = context({ me: { id: 'me', name: 'Ada Rowan', category: 'organizer' } });
    const someone = person({
      id: 'r',
      name: 'Rae Alvarez',
      category: 'recruiter',
      interests: ['Climate tech'],
      skills: ['Rust'],
      availability: 'available',
    });

    expect(() => score(someone, bare)).not.toThrow();
    expect(score(someone, bare)).toEqual({ score: 6, reasons: [] });
    expect(recommend([someone], bare)).toEqual([]);
    expect(matchBreakdown(someone, bare)).toBeNull();
  });

  it('tolerates a goals list that matches nobody in the room', () => {
    const ctx2 = context({ me: ME_PLAIN, goals: ['meet_recruiters', 'explore_startups'] });
    const nobody = neutral({ id: 'n', name: 'Noa Berg' });

    expect(score(nobody, ctx2)).toEqual({ score: 0, reasons: [] });
    expect(recommend([nobody], ctx2)).toEqual([]);
  });
});
