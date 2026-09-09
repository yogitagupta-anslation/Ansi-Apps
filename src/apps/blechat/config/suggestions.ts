/**
 * One-tap replies, offered above the composer.
 *
 * There is no model here and no server to ask, so these are phrase lists chosen by
 * simple rules — and that is the honest shape of the feature. What makes them useful is
 * not cleverness but timing: an empty thread with a stranger is the hardest moment in
 * this app, and "somebody is nearby, now say something" is a lot to ask of a person who
 * has to type the first word themselves.
 *
 * Two moments are worth offering something:
 *
 *  - A thread with nothing in it. Openers, so meeting someone costs one tap.
 *  - Their message was the last one. Replies, so the common acknowledgements are there
 *    without typing.
 *
 * Nothing is offered mid-conversation once you have started typing, and nothing is
 * offered when your own message was last — a suggestion to reply to yourself is noise.
 */

/** What to open with. Short, and none of them assume anything about the other person. */
export const OPENERS: readonly string[] = ['Hey 👋', 'Hi, how are you?', 'Hello!'];

interface Rule {
  /** Matched against the incoming message, already lowercased and trimmed. */
  when: (text: string) => boolean;
  replies: readonly string[];
}

/**
 * Ordered: the first match wins, so the more specific rules come first.
 *
 * Deliberately small. A long list of near-identical phrases makes the row a decision
 * rather than a shortcut, and the whole point is that it is faster than typing.
 */
const RULES: readonly Rule[] = [
  {
    // A question wants an answer, not an acknowledgement.
    when: text => text.endsWith('?'),
    replies: ['Yes', 'No', 'One sec'],
  },
  {
    when: text => /\b(thanks|thank you|thx|shukriya)\b/.test(text),
    replies: ['Anytime', 'No worries', '👍'],
  },
  {
    when: text => /\b(hi|hey|hello|yo|namaste|hola)\b/.test(text),
    replies: ['Hey!', 'Hi 👋', 'How are you?'],
  },
  {
    when: text => /\b(where|kaha|kahan)\b/.test(text),
    replies: ['On my way', 'Two minutes', 'Where are you?'],
  },
  {
    when: text => /\b(sorry|apologies|maaf)\b/.test(text),
    replies: ['All good', 'No problem', "Don't worry"],
  },
];

/** Used when nothing more specific fits — the acknowledgements people actually send. */
const DEFAULT_REPLIES: readonly string[] = ['Okay!', 'Noted!', '👍'];

/**
 * What to offer right now.
 *
 * `lastIncoming` is the most recent message received, or null when the last word was
 * ours. An empty array means "offer nothing", which is the right answer more often than
 * not: a row of chips that is always there stops being a suggestion and becomes chrome.
 */
export function suggestionsFor({
  threadEmpty,
  lastIncoming,
}: {
  threadEmpty: boolean;
  lastIncoming: string | null;
}): readonly string[] {
  if (threadEmpty) {
    return OPENERS;
  }
  if (!lastIncoming) {
    // Our own message was last. Suggesting a reply to ourselves would be nonsense.
    return [];
  }
  const text = lastIncoming.trim().toLowerCase();
  if (!text) {
    return DEFAULT_REPLIES;
  }
  const rule = RULES.find(r => r.when(text));
  return rule ? rule.replies : DEFAULT_REPLIES;
}
