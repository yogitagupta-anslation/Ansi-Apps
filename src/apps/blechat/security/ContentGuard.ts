/**
 * A second look before you hand a stranger a way to find you off this app.
 *
 * BLE Chat's whole premise is that you can talk to somebody three metres away without an
 * account, a phone number, or anything that outlives walking away: the identity is a
 * keypair, the range is a room, and when you leave, you are gone. A phone number typed
 * into the composer undoes all of that in one message — it is permanent, it is tied to
 * your legal identity in most countries, and it cannot be taken back once the other phone
 * has the bytes. The app cannot unsend it; there is no server holding a copy to delete.
 *
 * So this is a warning, not a wall. People have entirely good reasons to swap a number
 * with someone they just met, and an app that refused would be both patronising and
 * trivially worked around by spelling it out. What it must not do is let it happen
 * ACCIDENTALLY, or without the person having noticed which conversation they were in.
 *
 * Detection deliberately errs toward catching things:
 *
 *  - A false positive costs one tap on "Send anyway".
 *  - A false negative costs a phone number.
 *
 * It runs entirely on this device on the outgoing draft. Nothing is logged, nothing is
 * reported anywhere, and incoming messages are never inspected — this is a guard on what
 * you are about to give away, not a filter on what other people may say to you.
 */

export type SensitiveKind =
  | 'phone'
  | 'email'
  | 'handle'
  | 'social'
  | 'payment'
  | 'location';

export interface SensitiveFinding {
  kind: SensitiveKind;
  /** The matched text, for showing the person exactly what was spotted. */
  text: string;
  /** What it is, in the second person, for the confirmation sheet. */
  label: string;
}

/** Human wording per kind. Says what is being shared, not what is "forbidden". */
const LABELS: Record<SensitiveKind, string> = {
  phone: 'a phone number',
  email: 'an email address',
  handle: 'a social handle',
  social: 'a social media or messaging link',
  payment: 'payment details',
  location: 'a home or street address',
};

/**
 * Digits that look like a number somebody could ring.
 *
 * Written to survive the ways people actually type one — spaces, dashes, dots, brackets,
 * a country code, "+91 98765 43210" — while not firing on every long number in a
 * sentence. The bounds are the load-bearing part: 7 digits is the shortest real
 * subscriber number, 15 is the E.164 maximum, and anything outside that is far more
 * likely to be an order number or a year range than a phone.
 */
const PHONE = /(?:\+?\d[\d\s().-]{5,18}\d)/g;

/**
 * Digit words, because "nine eight seven six five" is how somebody gets around a filter
 * and is still a phone number. Only fires on a run of five or more, which no ordinary
 * sentence contains.
 */
const DIGIT_WORDS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|double)\b(?:[\s,-]+\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|double)\b){4,}/gi;

const EMAIL = /\b[A-Za-z0-9._%+-]+\s?(?:@|\(at\)|\[at\]|\sat\s)\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** "@someone" — an Instagram/X/Telegram handle in the form everybody writes it. */
const HANDLE = /(?:^|[\s(])@[A-Za-z0-9._]{3,30}\b/g;

/**
 * A named platform, with or without a URL. "my insta is ..." carries the same information
 * as the link, so matching only on `https://` would miss the common case.
 */
const SOCIAL = new RegExp(
  [
    // Platform names as people write them, bare. "my insta is ..." carries exactly the
    // information the link would, so matching only on a URL would miss the common case.
    String.raw`\b(?:instagram|insta|facebook|snapchat|telegram|whatsapp|tiktok|linkedin|discord|threads)\b`,
    // Domains, for when the link is pasted.
    String.raw`\b(?:t\.me|wa\.me|fb\.com|ig\.me|x\.com|instagram\.com|facebook\.com|linkedin\.com|reddit\.com|youtube\.com|threads\.net)\b[^\s]*`,
    // Short forms that need their label to be unambiguous: "snap" and "ig" are ordinary
    // words on their own, and only read as a handle when introduced like one.
    String.raw`\b(?:ig|snap|tg|fb)\s*[:=]\s*\S+`,
  ].join('|'),
  'gi',
);

/**
 * Card numbers, UPI ids and wallet addresses.
 *
 * Not a fraud check — the app has no idea who is on the other end, which is exactly the
 * point. Somebody typing a card number into a chat with a stranger they met over
 * Bluetooth has almost certainly misread the situation, and this is the moment to say so.
 */
const PAYMENT =
  /\b(?:\d[ -]?){13,19}\b|\b[\w.-]+@(?:okaxis|oksbi|okhdfcbank|okicici|paytm|ybl|upi|apl|axl)\b|\b(?:0x[a-fA-F0-9]{40}|(?:bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39})\b/g;

/** A street address: a house number followed by a street word. */
const LOCATION =
  /\b\d{1,5}[\s,]+[A-Za-z][A-Za-z\s.]{2,30}\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|nagar|colony|sector|block|apartment|apt\.?|flat|house|building)\b/gi;

const RULES: Array<{kind: SensitiveKind; pattern: RegExp}> = [
  // Email before phone and payment: an address containing digits would otherwise be
  // reported twice, under the wrong name first.
  {kind: 'email', pattern: EMAIL},
  {kind: 'social', pattern: SOCIAL},
  {kind: 'payment', pattern: PAYMENT},
  {kind: 'location', pattern: LOCATION},
  {kind: 'phone', pattern: PHONE},
  {kind: 'phone', pattern: DIGIT_WORDS},
  {kind: 'handle', pattern: HANDLE},
];

/** Digits in a candidate, ignoring the punctuation people separate them with. */
function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/**
 * What this draft would give away.
 *
 * Returns every distinct finding, so the sheet can name all of them rather than the first
 * — somebody pasting a signature block is sharing three things and should be told three.
 */
export function findSensitive(text: string): SensitiveFinding[] {
  const found: SensitiveFinding[] = [];
  const claimed: Array<[number, number]> = [];

  for (const {kind, pattern} of RULES) {
    // Fresh lastIndex per call: these are module-level /g regexes, and a shared cursor
    // between calls makes detection depend on what was checked before it.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0].trim();
      const start = match.index;
      const end = start + match[0].length;

      // An earlier, more specific rule already accounted for this span.
      if (claimed.some(([s, e]) => start < e && end > s)) {
        continue;
      }

      if (kind === 'phone' && pattern === PHONE) {
        const digits = digitCount(raw);
        if (digits < 7 || digits > 15) {
          continue;
        }
      }
      if (kind === 'payment') {
        const digits = digitCount(raw);
        // The card branch of the pattern; the UPI/wallet branches carry no digit run.
        if (digits > 0 && (digits < 13 || digits > 19)) {
          continue;
        }
      }

      claimed.push([start, end]);
      if (!found.some(f => f.kind === kind && f.text === raw)) {
        found.push({kind, text: raw, label: LABELS[kind]});
      }
    }
  }

  return found;
}

/** Convenience for the composer, which only needs to know whether to stop and ask. */
export function hasSensitive(text: string): boolean {
  return findSensitive(text).length > 0;
}

/**
 * "a phone number and an email address" — the findings as one readable clause.
 *
 * The sheet leads with this, so it has to read as a sentence rather than as a list of
 * categories: what somebody needs to recognise is the thing they typed.
 */
export function describeFindings(findings: SensitiveFinding[]): string {
  const labels = Array.from(new Set(findings.map(f => f.label)));
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
