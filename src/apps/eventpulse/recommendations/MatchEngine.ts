/**
 * MatchEngine — "people you may want to meet".
 *
 * Rules, not a model. That is a deliberate MVP choice: the inputs (interests,
 * roles, stated goals, distance) are small and legible, and a rule you can read
 * is a rule you can debug at 9 a.m. on a conference floor. The scoring surface
 * is isolated behind `score()` so a learned ranker can replace it later without
 * touching the UI.
 *
 * The strongest signal is not similarity — it is *stated intent*. If someone
 * wrote "looking to meet: founders" and you are a founder, that beats any
 * number of overlapping tags.
 */

import type {
  Attendee,
  EventProfile,
  NetworkingGoal,
  PersonCategory,
  Profile,
  ProximityBand,
  Recommendation,
} from '../types';
import { bestGoalMatch, goalLabel } from './NetworkingGoals';

export interface MatchContext {
  profile: Profile;
  eventProfile: EventProfile;
  /** profileId -> metres, for people currently detected nearby. */
  distances?: Map<string, number>;
  /** profileId -> band, for the "8 m away" chip. */
  bands?: Map<string, ProximityBand>;
  connectedProfileIds?: ReadonlySet<string>;
  /** The user's structured goals for this event — the strongest single input. */
  goals?: readonly NetworkingGoal[];
}

export interface MatchOptions {
  limit?: number;
  /** Only recommend people currently detected over BLE. */
  nearbyOnly?: boolean;
  /** Score below which we would rather show nothing than show noise. */
  minScore?: number;
}

const WEIGHTS = {
  // A goal the user picked on the way in outranks everything inferred, because
  // it is the one thing they actually told us.
  goalDirectHit: 38,
  goalTopicHit: 16,
  /**
   * INVARIANT: this must stay strictly above the most similarity can ever score,
   * which is `3 * sharedInterest + 3 * sharedSkill` = 36 given the caps applied
   * below. The header's central claim — "if someone wrote 'looking to meet:
   * founders' and you are a founder, that beats any number of overlapping tags"
   * — is exactly this inequality, and at 34 it was false: a stranger who
   * happened to share three interests and three skills outranked the person who
   * wrote down that they came to meet someone with your role.
   */
  statedIntentTheyWantMe: 37,
  statedIntentIWantThem: 30,
  mutualConnection: 9,
  sharedInterest: 7,
  sharedSkill: 5,
  complementaryRole: 14,
  sameIndustry: 5,
  proximityVeryClose: 16,
  proximityClose: 11,
  proximityNearby: 6,
  available: 6,
  busyPenalty: -10,
  alreadyConnected: -70,
  experienceMentor: 6,
};

/**
 * Role pairs that make an event worth attending. Symmetric pairs are listed
 * once and checked both ways.
 */
const COMPLEMENTARY: [PersonCategory, PersonCategory][] = [
  ['founder', 'investor'],
  ['founder', 'engineer'],
  ['founder', 'product'],
  ['founder', 'design'],
  ['recruiter', 'engineer'],
  ['recruiter', 'student'],
  ['recruiter', 'data'],
  ['recruiter', 'product'],
  ['mentor', 'student'],
  ['mentor', 'founder'],
  ['student', 'engineer'],
  ['investor', 'data'],
  ['product', 'engineer'],
  ['product', 'design'],
  ['design', 'engineer'],
  ['speaker', 'student'],
];

/** Words people actually type into "looking to meet", mapped to categories. */
const INTENT_SYNONYMS: Record<string, PersonCategory[]> = {
  engineers: ['engineer'],
  engineer: ['engineer'],
  developers: ['engineer'],
  'ml engineers': ['data'],
  'ai engineers': ['data'],
  'data scientists': ['data'],
  designers: ['design'],
  'product people': ['product'],
  pms: ['product'],
  founders: ['founder'],
  'co-founders': ['founder'],
  investors: ['investor'],
  recruiters: ['recruiter'],
  'hiring managers': ['recruiter'],
  students: ['student'],
  mentors: ['mentor'],
  'open-source maintainers': ['engineer'],
};

function intentMatchesCategory(intent: string, category: PersonCategory): boolean {
  const normalised = intent.trim().toLowerCase();
  const mapped = INTENT_SYNONYMS[normalised];
  if (mapped) return mapped.includes(category);
  // Fall back to a substring check so free-text intents still land.
  return normalised.includes(category);
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b.map((value) => value.toLowerCase()));
  return a.filter((value) => set.has(value.toLowerCase()));
}

function isComplementary(a: PersonCategory, b: PersonCategory): boolean {
  return COMPLEMENTARY.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export interface ScoredMatch extends Recommendation {
  attendee: Attendee;
}

export function score(
  candidate: Attendee,
  context: MatchContext,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let total = 0;

  const me = context.profile;
  const myGoals = context.eventProfile.lookingToMeet ?? [];
  const theirGoals = candidate.eventProfile.lookingToMeet ?? [];

  // 0. Structured goals. Checked first because they dominate the ranking, and
  // reading them first makes the ordering obvious to whoever debugs this next.
  const goalHit = bestGoalMatch(context.goals ?? context.eventProfile.goals, candidate);
  if (goalHit) {
    total += goalHit.strong ? WEIGHTS.goalDirectHit : WEIGHTS.goalTopicHit;
    reasons.push(goalHit.reason);
  }

  // 1. Stated intent — the strongest signal in the room.
  if (theirGoals.some((goal) => intentMatchesCategory(goal, me.category))) {
    total += WEIGHTS.statedIntentTheyWantMe;
    reasons.push(`They are looking to meet ${labelForCategory(me.category)}`);
  }
  if (myGoals.some((goal) => intentMatchesCategory(goal, candidate.profile.category))) {
    total += WEIGHTS.statedIntentIWantThem;
    reasons.push(`You said you want to meet ${labelForCategory(candidate.profile.category)}`);
  }

  // 2. Shared ground.
  const sharedInterests = overlap(me.interests, candidate.profile.interests);
  if (sharedInterests.length) {
    total += Math.min(sharedInterests.length, 3) * WEIGHTS.sharedInterest;
    reasons.push(`Both into ${formatList(sharedInterests.slice(0, 2))}`);
  }

  const sharedSkills = overlap(me.skills, candidate.profile.skills);
  if (sharedSkills.length) {
    total += Math.min(sharedSkills.length, 3) * WEIGHTS.sharedSkill;
    reasons.push(`Shared skills: ${formatList(sharedSkills.slice(0, 2))}`);
  }

  if (me.industry && me.industry === candidate.profile.industry) {
    total += WEIGHTS.sameIndustry;
  }

  // 3. Complementary roles.
  if (isComplementary(me.category, candidate.profile.category)) {
    total += WEIGHTS.complementaryRole;
    // Every other reason starts with a capital because it starts a sentence;
    // this one starts with a category label, which is lower-case by design
    // everywhere else it appears ("looking to meet founders").
    reasons.push(`${capitalise(labelForCategory(candidate.profile.category))} — a useful counterpart`);
  }

  // 4. Someone meaningfully further along in the same field is worth meeting.
  const myYears = me.experienceYears ?? 0;
  const theirYears = candidate.profile.experienceYears ?? 0;
  if (
    me.category === candidate.profile.category &&
    theirYears - myYears >= 4 &&
    myYears < 5
  ) {
    total += WEIGHTS.experienceMentor;
    // `labelForCategory` yields a plural noun for people ("engineers"), which
    // reads as nonsense after "years in". Say what it actually means instead.
    reasons.push(
      `${theirYears} years' experience — ${theirYears - myYears} more than you`,
    );
  }

  // 5. Physical proximity. Someone brilliant on the far side of the hall is a
  // worse recommendation right now than someone good standing next to you.
  const distance = context.distances?.get(candidate.profile.id);
  if (distance !== undefined) {
    if (distance < 3) total += WEIGHTS.proximityVeryClose;
    else if (distance < 7) total += WEIGHTS.proximityClose;
    else if (distance < 12) total += WEIGHTS.proximityNearby;
  }

  // 6. Availability.
  if (candidate.eventProfile.availability === 'available') total += WEIGHTS.available;
  else if (candidate.eventProfile.availability === 'busy') total += WEIGHTS.busyPenalty;

  // 7. Mutual connections. Weaker than a stated goal but stronger than a tag in
  // common, because a shared connection is a warm introduction waiting to be
  // asked for.
  const mutuals = candidate.mutualConnectionCount ?? 0;
  if (mutuals > 0) {
    total += Math.min(mutuals, 3) * WEIGHTS.mutualConnection;
    reasons.push(`${mutuals} mutual ${mutuals === 1 ? 'connection' : 'connections'}`);
  }

  // 8. Already connected — no need to suggest them again.
  if (context.connectedProfileIds?.has(candidate.profile.id)) {
    total += WEIGHTS.alreadyConnected;
  }

  return { score: total, reasons };
}

export function recommend(
  candidates: readonly Attendee[],
  context: MatchContext,
  options: MatchOptions = {},
): ScoredMatch[] {
  const { limit = 10, nearbyOnly = false, minScore = 18 } = options;
  const out: ScoredMatch[] = [];

  for (const candidate of candidates) {
    if (candidate.profile.id === context.profile.id) continue;
    if (candidate.isBlocked) continue;
    if (candidate.eventProfile.availability === 'invisible') continue;

    const distance = context.distances?.get(candidate.profile.id);
    if (nearbyOnly && distance === undefined) continue;

    const { score: value, reasons } = score(candidate, context);
    if (value < minScore) continue;

    out.push({
      attendee: candidate,
      profileId: candidate.profile.id,
      score: value,
      reasons: reasons.slice(0, 3),
      distance,
      band: context.bands?.get(candidate.profile.id),
    });
  }

  return out
    .sort((a, b) => b.score - a.score || a.attendee.profile.name.localeCompare(b.attendee.profile.name))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * The explained match
 * ------------------------------------------------------------------ */

export type MatchFactorKind =
  | 'goal'
  | 'intent'
  | 'mutual'
  | 'role'
  | 'interests'
  | 'skills'
  | 'industry'
  | 'experience'
  | 'proximity'
  | 'availability';

export interface MatchFactor {
  kind: MatchFactorKind;
  /** One line, written to be read on a profile card. */
  label: string;
}

export interface MatchBreakdown {
  /**
   * 0–99. Never 100: this is a rules score, and a number that says "perfect
   * match" about a stranger you have not met is a claim no rule can support.
   */
  percent: number;
  /** 'strong' | 'good' | 'worth a look' — what the number is called out loud. */
  tier: 'strong' | 'good' | 'possible';
  label: string;
  factors: MatchFactor[];
  sharedInterests: string[];
  sharedSkills: string[];
  /**
   * False when a number would mislead. The UI then shows the tier alone.
   *
   * Two things suppress it. One shared signal is not enough to quantify. And
   * neither is a bottom-tier match: "13%" next to "Worth a look" invites the
   * reading "87% wrong", which is a precision claim this score cannot make —
   * all it actually decided was that this person clears the bar for being shown
   * at all. A low number there is discouraging *and* unfounded.
   */
  showPercent: boolean;
}

/**
 * The score a genuinely excellent match reaches: a goal hit, mutual intent,
 * overlapping interests and skills, a complementary role and standing close by.
 * Used as the denominator so the percentage means something fixed rather than
 * drifting whenever a weight is tuned.
 */
const SCORE_CEILING = 150;

/** Below this there is nothing worth saying, so nothing is said. */
const MIN_VISIBLE_SCORE = 18;

/**
 * Why a percentage at all, when the underlying signal is this coarse?
 *
 * Because "Strong match" alone gives no way to choose between the six strong
 * matches standing in front of you, and ordering is the actual job. The number
 * is honest as long as it is (a) deterministic, (b) always accompanied by the
 * factors that produced it, and (c) never shown when it rests on one thin
 * signal. All three are enforced here rather than left to the UI.
 */
export function matchBreakdown(
  candidate: Attendee,
  context: MatchContext,
): MatchBreakdown | null {
  const { score: value } = score(candidate, context);
  if (value < MIN_VISIBLE_SCORE) return null;

  const me = context.profile;
  const sharedInterests = overlap(me.interests, candidate.profile.interests);
  const sharedSkills = overlap(me.skills, candidate.profile.skills);
  const factors: MatchFactor[] = [];

  const goalHit = bestGoalMatch(context.goals ?? context.eventProfile.goals, candidate);
  if (goalHit) {
    factors.push({
      kind: 'goal',
      label: goalHit.strong
        ? `Matches your goal — ${goalLabel(goalHit.goal).toLowerCase()}`
        : goalHit.reason,
    });
  }

  if ((candidate.eventProfile.lookingToMeet ?? []).some((goal) =>
    intentMatchesCategory(goal, me.category),
  )) {
    factors.push({
      kind: 'intent',
      label: `Looking to meet ${labelForCategory(me.category)}`,
    });
  }

  const mutuals = candidate.mutualConnectionCount ?? 0;
  if (mutuals > 0) {
    factors.push({
      kind: 'mutual',
      label: `${mutuals} mutual ${mutuals === 1 ? 'connection' : 'connections'}`,
    });
  }

  if (isComplementary(me.category, candidate.profile.category)) {
    factors.push({
      kind: 'role',
      label: `${capitalise(labelForCategory(candidate.profile.category))} — complements your work`,
    });
  }

  if (sharedInterests.length) {
    factors.push({
      kind: 'interests',
      label: `${sharedInterests.length} shared ${
        sharedInterests.length === 1 ? 'interest' : 'interests'
      }: ${formatList(sharedInterests.slice(0, 3))}`,
    });
  }

  if (sharedSkills.length) {
    factors.push({
      kind: 'skills',
      label: `Both work with ${formatList(sharedSkills.slice(0, 3))}`,
    });
  }

  if (me.industry && me.industry === candidate.profile.industry) {
    factors.push({ kind: 'industry', label: `Both in ${me.industry}` });
  }

  if (candidate.eventProfile.availability === 'available') {
    factors.push({ kind: 'availability', label: 'Open to being approached right now' });
  }

  const distance = context.distances?.get(candidate.profile.id);
  if (distance !== undefined && distance < 12) {
    factors.push({ kind: 'proximity', label: 'Nearby right now' });
  }

  const percent = Math.max(1, Math.min(99, Math.round((value / SCORE_CEILING) * 100)));
  const tier = value >= 70 ? 'strong' : value >= 45 ? 'good' : 'possible';

  return {
    percent,
    tier,
    label: tier === 'strong' ? 'Great person to meet' : tier === 'good' ? 'Good match' : 'Worth a look',
    factors,
    sharedInterests,
    sharedSkills,
    // Two independent reasons, and a tier the number can honestly stand next to.
    showPercent: factors.length >= 2 && tier !== 'possible',
  };
}

export function labelForCategory(category: PersonCategory): string {
  switch (category) {
    case 'engineer':
      return 'engineers';
    case 'data':
      return 'ML & data people';
    case 'product':
      return 'product people';
    case 'design':
      return 'designers';
    case 'founder':
      return 'founders';
    case 'investor':
      return 'investors';
    case 'recruiter':
      return 'recruiters';
    case 'student':
      return 'students';
    case 'speaker':
      return 'speakers';
    case 'mentor':
      return 'mentors';
    case 'organizer':
      return 'organisers';
    default:
      return 'attendees';
  }
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}
