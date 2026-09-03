/**
 * Identity-change detection, attacked from the impersonator's side.
 *
 * The cryptography already guarantees nobody can take a peerId that is not theirs. These
 * tests are about the attack that remains: taking somebody's NAME, which costs nothing
 * and is the only part of an identity a user actually reads.
 */
import {
  assessIdentity,
  describeAssessment,
  isSuspicious,
  type KnownIdentity,
} from '../security/IdentityWatch';
import {
  SecurityLog,
  MAX_SECURITY_EVENTS,
  describeKind,
  isAlarming,
} from '../security/SecurityLog';

const ALICE: KnownIdentity = {
  peerId: 'a'.repeat(32),
  displayName: 'Jaismeet',
  verified: false,
};
const ALICE_VERIFIED: KnownIdentity = {...ALICE, verified: true};
const BOB: KnownIdentity = {
  peerId: 'b'.repeat(32),
  displayName: 'Yuvraj',
  verified: false,
};
const IMPOSTOR_ID = 'c'.repeat(32);

describe('assessIdentity', () => {
  it('calls a first meeting new', () => {
    const result = assessIdentity(
      {peerId: IMPOSTOR_ID, displayName: 'Someone Else'},
      [ALICE, BOB],
    );
    expect(result.verdict).toBe('new');
    expect(isSuspicious(result.verdict)).toBe(false);
  });

  it('recognises the same identity with the same name', () => {
    const result = assessIdentity(
      {peerId: ALICE.peerId, displayName: 'Jaismeet'},
      [ALICE, BOB],
    );
    expect(result.verdict).toBe('known');
    expect(result.conflictsWith).toEqual([]);
  });

  it('treats a rename by the same identity as a rename, not an attack', () => {
    const result = assessIdentity(
      {peerId: ALICE.peerId, displayName: 'Jaismeet K'},
      [ALICE],
    );
    // The key is unchanged, so this is genuinely the same person choosing a new label.
    // Flagging it as an impersonation would train the user to ignore real warnings.
    expect(result.verdict).toBe('renamed');
    expect(result.previousName).toBe('Jaismeet');
    expect(isSuspicious(result.verdict)).toBe(false);
  });

  it('flags a new identity wearing a name that already means someone', () => {
    const result = assessIdentity(
      {peerId: IMPOSTOR_ID, displayName: 'Jaismeet'},
      [ALICE, BOB],
    );
    expect(result.verdict).toBe('nameCollision');
    expect(result.conflictsWith.map(c => c.peerId)).toEqual([ALICE.peerId]);
    expect(isSuspicious(result.verdict)).toBe(true);
  });

  it('escalates when the borrowed name belongs to a VERIFIED identity', () => {
    const result = assessIdentity(
      {peerId: IMPOSTOR_ID, displayName: 'Jaismeet'},
      [ALICE_VERIFIED, BOB],
    );
    // The user personally checked safety numbers with the real Jaismeet. Someone else
    // answering to that name is the exact scenario verification exists to catch.
    expect(result.verdict).toBe('impersonatesVerified');
    expect(isSuspicious(result.verdict)).toBe(true);
  });

  it('cannot be sidestepped by changing case or padding the name', () => {
    for (const name of ['jaismeet', 'JAISMEET', '  Jaismeet  ', 'JaIsMeEt']) {
      const result = assessIdentity({peerId: IMPOSTOR_ID, displayName: name}, [
        ALICE_VERIFIED,
      ]);
      expect(result.verdict).toBe('impersonatesVerified');
    }
  });

  it('reports every identity a contested name has belonged to', () => {
    const other: KnownIdentity = {
      peerId: 'd'.repeat(32),
      displayName: 'Jaismeet',
      verified: false,
    };
    const result = assessIdentity(
      {peerId: IMPOSTOR_ID, displayName: 'Jaismeet'},
      [ALICE, other],
    );
    expect(result.conflictsWith).toHaveLength(2);
  });

  it('escalates if ANY of several clashing identities was verified', () => {
    const unverifiedClash: KnownIdentity = {
      peerId: 'd'.repeat(32),
      displayName: 'Jaismeet',
      verified: false,
    };
    const result = assessIdentity(
      {peerId: IMPOSTOR_ID, displayName: 'Jaismeet'},
      [unverifiedClash, ALICE_VERIFIED],
    );
    expect(result.verdict).toBe('impersonatesVerified');
  });

  it('does not flag anything on a phone that has met nobody', () => {
    const result = assessIdentity({peerId: ALICE.peerId, displayName: 'Jaismeet'}, []);
    expect(result.verdict).toBe('new');
  });

  it('does not confuse two different people with different names', () => {
    expect(
      assessIdentity({peerId: IMPOSTOR_ID, displayName: 'Yuvraj'}, [ALICE]).verdict,
    ).toBe('new');
  });

  it('explains every verdict in words a person can act on', () => {
    const cases = [
      assessIdentity({peerId: ALICE.peerId, displayName: 'Jaismeet'}, [ALICE]),
      assessIdentity({peerId: ALICE.peerId, displayName: 'New Name'}, [ALICE]),
      assessIdentity({peerId: IMPOSTOR_ID, displayName: 'Nobody'}, [ALICE]),
      assessIdentity({peerId: IMPOSTOR_ID, displayName: 'Jaismeet'}, [ALICE]),
      assessIdentity({peerId: IMPOSTOR_ID, displayName: 'Jaismeet'}, [ALICE_VERIFIED]),
    ];
    for (const c of cases) {
      const text = describeAssessment(c);
      expect(text.length).toBeGreaterThan(10);
      // No hex dumped at the user: the whole problem is that they do not read it.
      expect(text).not.toContain(IMPOSTOR_ID);
      expect(text).not.toContain(ALICE.peerId);
    }
    expect(describeAssessment(cases[4])).toContain('NOT that person');
  });
});

describe('SecurityLog', () => {
  let clock: number;
  let log: SecurityLog;

  beforeEach(() => {
    clock = 1_000;
    log = new SecurityLog(() => clock++);
  });

  it('starts empty, because nothing has happened', () => {
    expect(log.all()).toEqual([]);
    expect(log.alarming()).toEqual([]);
  });

  it('records an event newest first', () => {
    log.record({kind: 'identityNew', peerId: 'p1', detail: 'first'});
    log.record({kind: 'peerVerified', peerId: 'p1', detail: 'second'});
    expect(log.all().map(e => e.detail)).toEqual(['second', 'first']);
  });

  it('separates the alarming from the merely historical', () => {
    log.record({kind: 'identityNew', peerId: 'p1', detail: 'met someone'});
    log.record({kind: 'impersonationWarning', peerId: 'p2', detail: 'watch out'});
    log.record({kind: 'peerVerified', peerId: 'p1', detail: 'checked codes'});

    expect(log.all()).toHaveLength(3);
    expect(log.alarming().map(e => e.detail)).toEqual(['watch out']);
  });

  it('does not repeat the same warning for the same peer back to back', () => {
    const first = log.record({
      kind: 'impersonationWarning',
      peerId: 'p2',
      detail: 'watch out',
    });
    const second = log.record({
      kind: 'impersonationWarning',
      peerId: 'p2',
      detail: 'watch out',
    });

    // A peer reconnecting in a bad radio environment must not bury the warning under
    // hundreds of copies of itself.
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(log.all()).toHaveLength(1);
  });

  it('records the same warning again once something else happened in between', () => {
    log.record({kind: 'impersonationWarning', peerId: 'p2', detail: 'watch out'});
    log.record({kind: 'identityNew', peerId: 'p3', detail: 'someone else'});
    log.record({kind: 'impersonationWarning', peerId: 'p2', detail: 'watch out'});
    expect(log.all()).toHaveLength(3);
  });

  it('keeps warnings for different peers apart', () => {
    log.record({kind: 'impersonationWarning', peerId: 'p1', detail: 'one'});
    log.record({kind: 'impersonationWarning', peerId: 'p2', detail: 'two'});
    expect(log.all()).toHaveLength(2);
  });

  it('filters by peer', () => {
    log.record({kind: 'identityNew', peerId: 'p1', detail: 'a'});
    log.record({kind: 'identityNew', peerId: 'p2', detail: 'b'});
    expect(log.forPeer('p1').map(e => e.detail)).toEqual(['a']);
  });

  it('stays bounded so one noisy peer cannot exhaust memory', () => {
    for (let i = 0; i < MAX_SECURITY_EVENTS + 50; i++) {
      log.record({kind: 'identityNew', peerId: `p${i}`, detail: `event ${i}`});
    }
    expect(log.all()).toHaveLength(MAX_SECURITY_EVENTS);
    // The newest survive; the oldest are the ones dropped.
    expect(log.all()[0].detail).toBe(`event ${MAX_SECURITY_EVENTS + 49}`);
  });

  it('gives every event a distinct id', () => {
    for (let i = 0; i < 20; i++) {
      log.record({kind: 'identityNew', peerId: `p${i}`, detail: `e${i}`});
    }
    expect(new Set(log.all().map(e => e.id)).size).toBe(20);
  });

  it('restores a persisted history, bounded on the way in', () => {
    const stored = Array.from({length: MAX_SECURITY_EVENTS + 10}, (_, i) => ({
      id: `sec-${i}`,
      at: i,
      kind: 'identityNew' as const,
      detail: `stored ${i}`,
    }));
    log.hydrate(stored);
    expect(log.all()).toHaveLength(MAX_SECURITY_EVENTS);
  });

  it('names every kind, so the UI never shows a raw enum', () => {
    const kinds = [
      'identityNew',
      'identityRenamed',
      'nameCollision',
      'impersonationWarning',
      'peerVerified',
      'verificationRevoked',
      'authenticationFailed',
      'blockedPeerAttempt',
    ] as const;
    for (const kind of kinds) {
      expect(describeKind(kind)).not.toBe(kind);
      expect(describeKind(kind).length).toBeGreaterThan(3);
    }
    expect(isAlarming('impersonationWarning')).toBe(true);
    expect(isAlarming('peerVerified')).toBe(false);
  });

  it('clears on request', () => {
    log.record({kind: 'identityNew', peerId: 'p1', detail: 'a'});
    log.clear();
    expect(log.all()).toEqual([]);
  });
});
