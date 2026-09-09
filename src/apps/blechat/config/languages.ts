/**
 * Languages somebody speaks.
 *
 * A close parallel to interests, with one deliberate difference: languages travel ONLY in
 * the handshake, never in the advertisement. Interests have a bitmask in the advert so a
 * match can be shown before connecting, which costs a fixed 32 bits; languages would need
 * either a second mask or free text in a packet that has neither room nor a reason for
 * it. So there is no cap that exists to fit a radio budget here — the limit below is
 * about the handshake staying small, not about the advert.
 *
 * The list is the languages most likely to be shared in the places this app is for, plus
 * the ability to add your own. It is not exhaustive and does not pretend to be.
 */

export const LANGUAGE_CATALOGUE: string[] = [
  'English',
  'Hindi',
  'Arabic',
  'Bengali',
  'French',
  'German',
  'Gujarati',
  'Japanese',
  'Kannada',
  'Malayalam',
  'Mandarin',
  'Marathi',
  'Portuguese',
  'Punjabi',
  'Spanish',
  'Tamil',
  'Telugu',
  'Urdu',
];

/**
 * Generous compared with interests, because the constraint is different.
 *
 * Interests are capped at 8 because eight is as many as anyone reads on a row. Languages
 * are a fact about you rather than a conversation starter, and somebody who genuinely
 * speaks six should be able to say so.
 */
export const MAX_LANGUAGES = 12;
export const MAX_LANGUAGE_LENGTH = 24;

/**
 * Bounds and cleans a language list that came off the wire.
 *
 * Every byte of this was chosen by the other phone, so it is treated the same way
 * interests are: trimmed, length-bounded, de-duplicated case-insensitively, and cut to a
 * fixed maximum. A peer that sends two hundred entries gets twelve.
 */
export function sanitiseLanguages(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim().slice(0, MAX_LANGUAGE_LENGTH);
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_LANGUAGES) {
      break;
    }
  }
  return out;
}

/** Languages both sides speak, in the order the local list has them. */
export function sharedLanguages(mine: string[], theirs: string[]): string[] {
  const lower = new Set(theirs.map(l => l.toLowerCase()));
  return mine.filter(l => lower.has(l.toLowerCase()));
}
