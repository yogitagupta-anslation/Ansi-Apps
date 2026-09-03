/**
 * Interests, the thing that makes a stranger nearby worth talking to.
 *
 * A curated catalogue rather than pure free text, because the point is MATCHING: two
 * people only discover common ground if they wrote the same thing, and left to themselves
 * they write "football", "Football", "soccer" and "footy". The catalogue makes the common
 * cases line up exactly, and a custom slot still exists for everything it does not cover.
 */

export interface InterestCategory {
  title: string;
  interests: string[];
}

/**
 * Kept deliberately broad and non-sensitive.
 *
 * These travel to every peer that connects, so the catalogue avoids anything that would
 * be unpleasant to broadcast to a room full of strangers — no politics, religion, health
 * or relationship status. A user can still type such a thing as a custom interest, but
 * nothing here nudges them into it.
 */
export const INTEREST_CATALOGUE: InterestCategory[] = [
  {
    title: 'Doing',
    interests: ['Football', 'Cricket', 'Gym', 'Running', 'Cycling', 'Hiking'],
  },
  {
    title: 'Making',
    interests: ['Coding', 'Design', 'Photography', 'Writing', 'Art', 'Cooking'],
  },
  {
    title: 'Watching & listening',
    interests: ['Music', 'Movies', 'Anime', 'Gaming', 'Podcasts', 'Reading'],
  },
  {
    title: 'Elsewhere',
    interests: ['Travel', 'Food', 'Startups', 'Science', 'Cars', 'Pets'],
  },
];

export const ALL_INTERESTS: string[] = INTEREST_CATALOGUE.flatMap(c => c.interests);

/**
 * Limits, because this arrives from another phone.
 *
 * A peer controls every byte of its own profile, so the receiving side treats all of it as
 * untrusted input: bounded count, bounded length, and no control characters that could
 * make one interest look like several in the UI.
 */
export const MAX_INTERESTS = 8;
export const MAX_INTEREST_LENGTH = 24;
export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_DISPLAY_NAME_LENGTH = 24;

/** Collapse whitespace, trim, and cap the length. Returns '' if nothing usable is left. */
function normaliseInterest(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const cleaned = raw
    // Newlines and tabs would let one interest render as two rows.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_INTEREST_LENGTH);
  return cleaned;
}

/**
 * Make a list of interests safe to store, display and compare.
 *
 * Deduplicates case-insensitively while keeping the form the user typed, so "Coding" and
 * "coding" are one interest rather than two that never match.
 */
export function sanitiseInterests(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const value = normaliseInterest(entry);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_INTERESTS) {
      break;
    }
  }
  return out;
}

/**
 * What two people have in common.
 *
 * Compared case-insensitively so a catalogue pick and a hand-typed equivalent still match,
 * and returned in the order the LOCAL user listed them — their own phrasing is what they
 * will recognise.
 */
export function sharedInterests(mine: string[], theirs: string[]): string[] {
  const other = new Set(theirs.map(i => i.toLowerCase()));
  return mine.filter(i => other.has(i.toLowerCase()));
}

/** True when a display name is something a person would recognise as a name. */
export function isValidDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length >= MIN_DISPLAY_NAME_LENGTH &&
    trimmed.length <= MAX_DISPLAY_NAME_LENGTH
  );
}

export function sanitiseDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/**
 * Wire order for the advertised interest bitmask. APPEND ONLY — NEVER REORDER.
 *
 * Bit N means whatever this list says at index N, on every phone that has ever run the
 * app. Inserting an entry in the middle would silently relabel every bit above it, so a
 * phone on an older build would confidently show "Cricket" where the sender meant
 * "Football". Display order lives in INTEREST_CATALOGUE and can change freely; this
 * cannot.
 *
 * Capped at 24 because that is what fits in the three bytes the scan response can spare.
 * A 25th interest needs a payload version bump, not a quiet extension.
 */
export const INTEREST_BITS: readonly string[] = Object.freeze([
  'Football',
  'Cricket',
  'Gym',
  'Running',
  'Cycling',
  'Hiking',
  'Coding',
  'Design',
  'Photography',
  'Writing',
  'Art',
  'Cooking',
  'Music',
  'Movies',
  'Anime',
  'Gaming',
  'Podcasts',
  'Reading',
  'Travel',
  'Food',
  'Startups',
  'Science',
  'Cars',
  'Pets',
]);

/** Three bytes, 24 bits, one per catalogue interest. */
export const INTEREST_MASK_BYTES = 3;
export const INTEREST_MASK_BITS = INTEREST_MASK_BYTES * 8;

const BIT_INDEX: ReadonlyMap<string, number> = new Map(
  INTEREST_BITS.map((interest, index) => [interest.toLowerCase(), index]),
);

/**
 * Pack interests into the bitmask carried in the advertisement.
 *
 * Only catalogue entries survive: a custom interest has no bit to occupy, so it is
 * dropped here and travels in the handshake instead. That is the honest trade for making
 * interests visible BEFORE connecting — 31 bytes of advertisement cannot carry free text
 * on top of a 128-bit service UUID, a peer id and a name.
 */
export function interestsToBitmask(interests: string[]): number {
  let mask = 0;
  for (const interest of interests) {
    const bit = BIT_INDEX.get(interest.trim().toLowerCase());
    if (bit !== undefined) {
      // Multiplication rather than a shift: 24 bits is well inside the safe integer
      // range, and this keeps the value unambiguously positive.
      mask += Math.pow(2, bit);
    }
  }
  return mask;
}

/**
 * Unpack an advertised bitmask.
 *
 * Bits above the catalogue are IGNORED rather than treated as an error: a newer build
 * with a longer list will set them, and refusing to read the rest of its advertisement
 * over a bit we do not recognise would make a future release invisible to this one.
 */
export function bitmaskToInterests(mask: number): string[] {
  if (!Number.isFinite(mask) || mask <= 0) {
    return [];
  }
  const out: string[] = [];
  let remaining = Math.floor(mask);
  for (let bit = 0; bit < INTEREST_MASK_BITS && remaining > 0; bit++) {
    if (remaining % 2 === 1) {
      const interest = INTEREST_BITS[bit];
      if (interest) {
        out.push(interest);
      }
    }
    remaining = Math.floor(remaining / 2);
  }
  return out;
}

/** Little-endian, matching the Kotlin writer and the iOS hex encoding. */
export function bitmaskToBytes(mask: number): Uint8Array {
  const out = new Uint8Array(INTEREST_MASK_BYTES);
  let remaining = Math.max(0, Math.floor(mask));
  for (let i = 0; i < INTEREST_MASK_BYTES; i++) {
    out[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return out;
}

export function bytesToBitmask(bytes: Uint8Array): number {
  let mask = 0;
  for (let i = 0; i < INTEREST_MASK_BYTES && i < bytes.length; i++) {
    mask += bytes[i] * Math.pow(256, i);
  }
  return mask;
}
