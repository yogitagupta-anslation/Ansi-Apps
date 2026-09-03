/**
 * Noticing when a name stops meaning the same person.
 *
 * The handshake already makes identity unforgeable: a peerId is sha256 of a public key,
 * and proving it requires the private half. Nobody can take over somebody else's peerId.
 *
 * What nobody can prevent is a stranger CHOOSING A NAME. A user does not read 32 hex
 * characters; they read "Jaismeet". An attacker who sets that display name gets a
 * different peerId — cryptographically distinct, visually identical — and the honest
 * cryptography underneath is no help at all if the interface never mentions it.
 *
 * That is the gap this closes: compare the identity now in front of the user against what
 * that name has meant before, and say so when the answer changed. It is the same idea as
 * a key-change warning in a messenger, adapted to a design where a changed key IS a
 * changed identity rather than a new key for the same account.
 *
 * Deliberately pure. The decision is a function of what is already known and what just
 * arrived, so it can be tested exhaustively without a radio, a store, or a UI.
 */

/** What is already known about the people this phone has met. */
export interface KnownIdentity {
  peerId: string;
  displayName: string;
  /** True once the user compared safety numbers in person and confirmed the match. */
  verified: boolean;
}

export type IdentityVerdict =
  /** Never met this peerId, and the name is not one we associate with anyone else. */
  | 'new'
  /** Same peerId, same name. The ordinary case. */
  | 'known'
  /** Same peerId, different name than last time. Their choice to make, worth recording. */
  | 'renamed'
  /**
   * This name previously belonged to a DIFFERENT identity. Could be innocent — two
   * people are genuinely called Alex — and could be someone standing in for a contact.
   * The user is the only one who can tell, so the user is told.
   */
  | 'nameCollision'
  /**
   * The strongest case: the name belongs to an identity the user personally VERIFIED,
   * and this is not that identity. A verified contact is exactly who an impersonator
   * would want to be mistaken for.
   */
  | 'impersonatesVerified';

export interface IdentityAssessment {
  verdict: IdentityVerdict;
  peerId: string;
  displayName: string;
  /** The identity or identities this name used to mean. Empty unless there is a clash. */
  conflictsWith: KnownIdentity[];
  /** The previous name, when this peerId has simply renamed itself. */
  previousName?: string;
}

/** A verdict the user should be shown rather than one that is business as usual. */
export function isSuspicious(verdict: IdentityVerdict): boolean {
  return verdict === 'nameCollision' || verdict === 'impersonatesVerified';
}

function normalise(name: string): string {
  // Case and surrounding space are not what distinguishes two people, and treating
  // "jaismeet" as unrelated to "Jaismeet" would let the check be sidestepped trivially.
  return name.trim().toLowerCase();
}

/**
 * Decide what this peer is, relative to everyone already known.
 *
 * `known` is the full set of identities this phone has met before — the caller's own
 * store, passed in rather than reached for, so the rule stays testable.
 */
export function assessIdentity(
  incoming: {peerId: string; displayName: string},
  known: KnownIdentity[],
): IdentityAssessment {
  const peerId = incoming.peerId;
  const displayName = incoming.displayName;
  const name = normalise(displayName);

  const samePeer = known.find(k => k.peerId === peerId);
  if (samePeer) {
    if (normalise(samePeer.displayName) === name) {
      return {verdict: 'known', peerId, displayName, conflictsWith: []};
    }
    return {
      verdict: 'renamed',
      peerId,
      displayName,
      conflictsWith: [],
      previousName: samePeer.displayName,
    };
  }

  // A peerId we have never met. Does the NAME already mean somebody?
  const clashes = known.filter(
    k => k.peerId !== peerId && normalise(k.displayName) === name,
  );
  if (clashes.length === 0) {
    return {verdict: 'new', peerId, displayName, conflictsWith: []};
  }

  // An unverified clash is ambiguous; a verified one is the case worth shouting about,
  // so it wins whenever any of the clashing identities was verified.
  const verdict: IdentityVerdict = clashes.some(c => c.verified)
    ? 'impersonatesVerified'
    : 'nameCollision';

  return {verdict, peerId, displayName, conflictsWith: clashes};
}

/** One line, in the user's terms, explaining what was noticed. */
export function describeAssessment(assessment: IdentityAssessment): string {
  switch (assessment.verdict) {
    case 'known':
      return 'Same person you have talked to before.';
    case 'new':
      return 'Someone new. You have not met this identity before.';
    case 'renamed':
      return `Same identity, but they now call themselves "${assessment.displayName}" instead of "${assessment.previousName}".`;
    case 'nameCollision':
      return `Someone else already uses the name "${assessment.displayName}". This is a different identity — it may simply be a different person with the same name.`;
    case 'impersonatesVerified':
      return `You verified someone else by the name "${assessment.displayName}". This is NOT that person. Compare security codes before trusting this chat.`;
  }
}
