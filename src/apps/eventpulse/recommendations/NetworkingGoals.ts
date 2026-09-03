/**
 * NetworkingGoals — "what brings you here?", turned into something matchable.
 *
 * The goal a person picks on the way into an event is the highest-signal thing
 * the app will ever know about them. Everything else — role, skills, interests
 * — describes who they *are*; a goal describes what they want *today*, and two
 * people with identical profiles can want opposite things.
 *
 * So goals do two jobs here:
 *
 *  1. **They point at people.** `goalTargets` maps a goal to the roles worth
 *     meeting, which the matcher scores directly.
 *  2. **They point at topics.** `goalTopics` maps a goal to subject matter, so
 *     "learn about AI" finds the person building it regardless of their title.
 *
 * A goal that only did the first would rank a recruiter above an ML engineer
 * for someone who came to learn about AI, which is exactly backwards.
 */

import type { Attendee, NetworkingGoal, PersonCategory } from '../types';

export interface GoalOption {
  value: NetworkingGoal;
  label: string;
  emoji: string;
  /** Shown under the label so the choice is not a guess. */
  detail: string;
}

/**
 * Ordered roughly by how specific they are. A specific goal produces better
 * matches, so the specific ones are offered first and "Just explore" last.
 */
export const GOAL_OPTIONS: readonly GoalOption[] = [
  { value: 'find_job', label: 'Find a job', emoji: '💼', detail: 'Surfaces recruiters and hiring teams' },
  { value: 'meet_recruiters', label: 'Meet recruiters', emoji: '🧲', detail: 'People who are hiring right now' },
  { value: 'find_cofounders', label: 'Find co-founders', emoji: '🤝', detail: 'Founders and senior builders' },
  { value: 'meet_engineers', label: 'Meet engineers', emoji: '🧑‍💻', detail: 'Engineering and ML people' },
  { value: 'learn_ai', label: 'Learn about AI', emoji: '🧠', detail: 'People working on AI, whatever their title' },
  { value: 'find_clients', label: 'Find clients', emoji: '📈', detail: 'Founders, product and business people' },
  { value: 'explore_startups', label: 'Explore startups', emoji: '🚀', detail: 'Founders and early teams' },
  { value: 'grow_network', label: 'Grow my network', emoji: '🌐', detail: 'A broad mix, weighted to who is nearby' },
  { value: 'just_explore', label: 'Just explore', emoji: '👀', detail: 'No filtering — show me the room' },
];

const GOAL_LABELS = new Map(GOAL_OPTIONS.map((option) => [option.value, option]));

export function goalOption(goal: NetworkingGoal): GoalOption | undefined {
  return GOAL_LABELS.get(goal);
}

export function goalLabel(goal: NetworkingGoal): string {
  return GOAL_LABELS.get(goal)?.label ?? goal;
}

/** Roles worth meeting for a goal. Empty means "no role preference". */
export function goalTargets(goal: NetworkingGoal): PersonCategory[] {
  switch (goal) {
    case 'find_job':
      return ['recruiter', 'engineer', 'founder', 'mentor'];
    case 'meet_recruiters':
      return ['recruiter'];
    case 'find_cofounders':
      return ['founder', 'engineer', 'product', 'design'];
    case 'meet_engineers':
      return ['engineer', 'data'];
    case 'learn_ai':
      return ['data', 'engineer', 'speaker'];
    case 'find_clients':
      return ['founder', 'product', 'investor'];
    case 'explore_startups':
      return ['founder', 'investor'];
    case 'grow_network':
    case 'just_explore':
    default:
      return [];
  }
}

/**
 * Subject matter a goal is about, lower-cased for comparison against a
 * candidate's interests and skills.
 */
export function goalTopics(goal: NetworkingGoal): string[] {
  switch (goal) {
    case 'learn_ai':
      return ['ai', 'ml', 'machine learning', 'llm', 'llms', 'deep learning', 'nlp', 'pytorch'];
    case 'explore_startups':
    case 'find_cofounders':
      return ['startups', 'startup', 'entrepreneurship', 'founding'];
    case 'meet_engineers':
      return ['engineering', 'infrastructure', 'backend', 'mobile', 'developer tools'];
    default:
      return [];
  }
}

/**
 * Whether a goal is satisfied by this person at all, and why.
 *
 * Returns null rather than a zero score for no match, so callers can say
 * nothing instead of saying "0% relevant to your goal" — which is true, rude,
 * and unhelpful in equal measure.
 */
export function goalMatch(
  goal: NetworkingGoal,
  candidate: Attendee,
): { reason: string; strong: boolean } | null {
  // "Just explore" is an explicit request not to be filtered. Treating it as a
  // match for everyone would put a goal badge on all 2,400 attendees.
  if (goal === 'just_explore') return null;

  const targets = goalTargets(goal);
  if (targets.includes(candidate.profile.category)) {
    return { reason: `Matches your goal: ${goalLabel(goal).toLowerCase()}`, strong: true };
  }

  const topics = goalTopics(goal);
  if (topics.length > 0) {
    const haystack = [...candidate.profile.interests, ...candidate.profile.skills].map((value) =>
      value.toLowerCase(),
    );
    const hit = topics.find((topic) => haystack.some((value) => value.includes(topic)));
    if (hit) return { reason: `Works on ${displayTopic(hit)}`, strong: false };
  }

  // "Grow my network" is satisfied by anyone you have not already met.
  if (goal === 'grow_network' && !candidate.isConnection) {
    return { reason: 'New to your network', strong: false };
  }

  return null;
}

/**
 * "ai" and "nlp" are acronyms and look wrong title-cased; "startups" looks
 * wrong shouted. Length is a crude but reliable separator here.
 */
function displayTopic(topic: string): string {
  if (topic.length <= 3) return topic.toUpperCase();
  return topic[0].toUpperCase() + topic.slice(1);
}

/**
 * The strongest goal match across all the user's goals, or null.
 *
 * Only one is ever shown. A person can satisfy four goals at once and listing
 * all four turns a reason into a wall.
 */
export function bestGoalMatch(
  goals: readonly NetworkingGoal[] | undefined,
  candidate: Attendee,
): { goal: NetworkingGoal; reason: string; strong: boolean } | null {
  if (!goals?.length) return null;

  let best: { goal: NetworkingGoal; reason: string; strong: boolean } | null = null;
  for (const goal of goals) {
    const match = goalMatch(goal, candidate);
    if (!match) continue;
    if (!best || (match.strong && !best.strong)) best = { goal, ...match };
    if (best.strong) break;
  }
  return best;
}
