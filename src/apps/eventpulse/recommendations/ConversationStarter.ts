/**
 * ConversationStarter — the last twenty feet.
 *
 * The app can get you standing next to exactly the right person and still fail,
 * because knowing *that* you should talk to someone is not knowing *how* to
 * start. That gap is where most event networking actually dies.
 *
 * Two rules shape everything here:
 *
 *  1. **Never invent a shared history.** Every starter is derived from a fact
 *     both profiles already state. "You both work with PyTorch" is checkable;
 *     "you'd get along" is a guess wearing a suit.
 *  2. **Give them the sentence, not the advice.** "Ask about their work" is
 *     useless. A question you could read aloud is not.
 *
 * Rules, not a model — same reasoning as `MatchEngine`. A generated opener that
 * is subtly wrong about a stranger is worse than no opener, and a rule you can
 * read is a rule you can correct.
 */

import type { Attendee, EventProfile, Profile } from '../types';

export interface StarterContext {
  profile: Profile;
  eventProfile: EventProfile;
}

export interface ConversationStarter {
  /** The shared ground, stated plainly. Shown above the question. */
  basis: string;
  /** A question the user could say out loud, unedited. */
  question: string;
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b.map((value) => value.toLowerCase()));
  return a.filter((value) => set.has(value.toLowerCase()));
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * The best opener available, or null.
 *
 * Ordered by how specific the opening is, not by how strong the match is. A
 * question about the thing someone is building beats a question about a tag
 * they happen to share with you, even when the tag scored higher.
 */
export function conversationStarter(
  candidate: Attendee,
  context: StarterContext,
): ConversationStarter | null {
  const them = candidate.profile;
  const theirEvent = candidate.eventProfile;
  const me = context.profile;

  // 1. Something they are actively building. The most specific thing anyone
  // puts on a profile, and the thing people most want to be asked about.
  //
  // Note the shape of these questions: the quoted phrase leads. That is not a
  // stylistic preference — it is what lets the text stay verbatim (see
  // `verbatim`) while still reading correctly, because a phrase at the start of
  // a sentence is capitalised either way.
  if (theirEvent.currentProject) {
    return {
      basis: `${firstName(them.name)} is working on ${verbatim(theirEvent.currentProject)}`,
      question: `"${verbatim(theirEvent.currentProject)} — how did you get into that?"`,
    };
  }

  // 2. A topic they explicitly invited. Consent, effectively — they wrote this
  // field to be asked about it.
  if (theirEvent.askMeAbout?.length) {
    const topic = theirEvent.askMeAbout[0];
    return {
      basis: `${firstName(them.name)} is happy to be asked about ${verbatim(topic)}`,
      question: `"${verbatim(topic)} — what are you working on there?"`,
    };
  }

  // 3. Shared skills. Concrete, and instantly establishes you can follow the
  // answer, which is what makes the next five minutes work.
  const sharedSkills = overlap(me.skills, them.skills);
  if (sharedSkills.length) {
    const list = formatList(sharedSkills.slice(0, 2));
    return {
      basis: `You both work with ${list}`,
      question: `"How is your team using ${sharedSkills[0]} at the moment?"`,
    };
  }

  // 4. What they came here for. Answering someone's stated need is the most
  // welcome way to open a conversation at an event.
  if (theirEvent.lookingToMeet?.length) {
    const want = theirEvent.lookingToMeet[0];
    return {
      basis: `${firstName(them.name)} came here to meet ${verbatim(want)}`,
      question: `"You're looking to meet ${verbatim(want)} — what would a good introduction look like?"`,
    };
  }

  // 5. Shared interests. Softer than skills, still true.
  const sharedInterests = overlap(me.interests, them.interests);
  if (sharedInterests.length) {
    return {
      basis: `You're both into ${formatList(sharedInterests.slice(0, 2))}`,
      question: `"What got you into ${verbatim(sharedInterests[0])}?"`,
    };
  }

  // 6. Why they are here at all.
  if (theirEvent.whyAttending) {
    return {
      basis: `${firstName(them.name)} is here to ${verbatim(theirEvent.whyAttending)}`,
      question: `"What are you hoping to get out of the event?"`,
    };
  }

  // 7. Same industry, different seat — a genuinely useful perspective swap.
  if (me.industry && me.industry === them.industry && me.category !== them.category) {
    return {
      basis: `You're both in ${me.industry}, from different sides`,
      question: `"What does ${verbatim(me.industry)} look like from the ${verbatim(
        them.role ?? them.category,
      )} side?"`,
    };
  }

  // Nothing shared and nothing stated. Saying so is better than inventing a
  // pretext — an opener built on a fabricated commonality falls apart in one
  // exchange, and takes the app's credibility with it.
  return null;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Profile phrases are quoted exactly as the person wrote them.
 *
 * The tempting alternative is to lower-case them so they sit neatly
 * mid-sentence ("asked about developer tools"). It cannot be done safely: no
 * cheap rule separates "Developer tools" from "Bluetooth", "Kubernetes" or
 * someone's product name, and a heuristic on internal capitals gets PyTorch
 * right and Bluetooth wrong. Mis-capitalising a trademark in a line the user is
 * about to say out loud is a worse failure than a capital letter mid-sentence,
 * so the text stays verbatim and we accept the occasional stray capital.
 */
function verbatim(value: string): string {
  const trimmed = value.trim();
  // The one safe exception: a leading English article. "A", "An" and "The" are
  // never proper nouns, so lowering them cannot mangle a trademark, and leaving
  // them alone produces "working on A BLE mesh for indoor logistics". Every
  // other word keeps the casing its author chose.
  return trimmed.replace(/^(An?|The)\b/, (article) => article.toLowerCase());
}
