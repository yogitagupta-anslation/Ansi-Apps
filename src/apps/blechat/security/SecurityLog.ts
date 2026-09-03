/**
 * A record of security-relevant things that actually happened.
 *
 * Separate from the diagnostic logger on purpose. That log is a firehose meant for
 * debugging and it rolls over quickly; these are the handful of events a user might
 * reasonably be asked about days later — "when did that person's identity change?",
 * "did anything try to connect while I was blocked?" — and they need to survive both a
 * noisy session and a restart.
 *
 * Every entry describes something OBSERVED. Nothing here is inferred, predicted, or
 * padded out to make the screen look busy: an empty list means nothing happened, which
 * is the normal and desirable case.
 */

export type SecurityEventKind =
  /** A peerId we had never met completed a handshake. */
  | 'identityNew'
  /** A known identity is presenting a different display name than before. */
  | 'identityRenamed'
  /** A name we associate with someone else arrived on a new identity. */
  | 'nameCollision'
  /** As above, but the name belonged to an identity the user had verified. */
  | 'impersonationWarning'
  /** The user compared safety numbers and confirmed a match. */
  | 'peerVerified'
  /** A previously confirmed verification was withdrawn. */
  | 'verificationRevoked'
  /** A handshake was refused because the peer could not prove its identity. */
  | 'authenticationFailed'
  /** A blocked identity tried to connect. */
  | 'blockedPeerAttempt';

export interface SecurityEvent {
  id: string;
  at: number;
  kind: SecurityEventKind;
  /** The identity involved, when there is one. */
  peerId?: string;
  displayName?: string;
  /** One sentence, already phrased for a person rather than for a log parser. */
  detail: string;
}

/** Kinds the user should be able to act on, as opposed to ones that are just history. */
const ALARMING: ReadonlySet<SecurityEventKind> = new Set<SecurityEventKind>([
  'nameCollision',
  'impersonationWarning',
  'authenticationFailed',
  'blockedPeerAttempt',
]);

export function isAlarming(kind: SecurityEventKind): boolean {
  return ALARMING.has(kind);
}

export function describeKind(kind: SecurityEventKind): string {
  switch (kind) {
    case 'identityNew':
      return 'New identity';
    case 'identityRenamed':
      return 'Name changed';
    case 'nameCollision':
      return 'Name already in use';
    case 'impersonationWarning':
      return 'Possible impersonation';
    case 'peerVerified':
      return 'Identity verified';
    case 'verificationRevoked':
      return 'Verification removed';
    case 'authenticationFailed':
      return 'Authentication failed';
    case 'blockedPeerAttempt':
      return 'Blocked peer tried to connect';
  }
}

/**
 * Bounded, newest-first, deduplicated against immediate repeats.
 *
 * The cap and the dedup exist for the same reason: a peer that reconnects every few
 * seconds in a bad radio environment would otherwise bury a genuine warning under
 * hundreds of identical lines, which is the same as hiding it.
 */
export const MAX_SECURITY_EVENTS = 100;

export class SecurityLog {
  private events: SecurityEvent[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  hydrate(events: SecurityEvent[]): void {
    this.events = events.slice(0, MAX_SECURITY_EVENTS);
  }

  all(): SecurityEvent[] {
    return [...this.events];
  }

  /** Only the ones worth interrupting somebody for. */
  alarming(): SecurityEvent[] {
    return this.events.filter(e => isAlarming(e.kind));
  }

  forPeer(peerId: string): SecurityEvent[] {
    return this.events.filter(e => e.peerId === peerId);
  }

  clear(): void {
    this.events = [];
  }

  /**
   * Record an event, unless it repeats the most recent one for the same peer and kind.
   *
   * Returns the event when it was actually recorded, and null when it was folded into
   * the existing one — so a caller can persist only on a real change.
   */
  record(event: Omit<SecurityEvent, 'id' | 'at'>): SecurityEvent | null {
    const previous = this.events.find(
      e => e.kind === event.kind && e.peerId === event.peerId,
    );
    if (previous && previous === this.events[0]) {
      // Exactly the same thing, still the newest entry: nothing new to tell anyone.
      return null;
    }

    const recorded: SecurityEvent = {
      ...event,
      at: this.now(),
      // Unique per entry without needing a generator: the counter is the list length,
      // which only ever grows within a session, plus the timestamp.
      id: `sec-${this.now()}-${this.events.length}-${event.kind}`,
    };
    this.events.unshift(recorded);
    if (this.events.length > MAX_SECURITY_EVENTS) {
      this.events.length = MAX_SECURITY_EVENTS;
    }
    return recorded;
  }
}
