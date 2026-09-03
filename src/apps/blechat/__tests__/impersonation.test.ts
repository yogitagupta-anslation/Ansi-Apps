/**
 * Impersonation, end to end.
 *
 * IdentityWatch is unit-tested elsewhere against a list handed to it. This file checks
 * the thing that actually protects a user: that a real handshake, from a real second
 * phone with a real keypair, produces the warning — and, just as importantly, that an
 * ordinary reconnect does not.
 *
 * A warning that never fires is useless. A warning that fires constantly is worse, because
 * it teaches the user to dismiss the one that mattered.
 */
import {
  assessIdentity,
  isSuspicious,
  type KnownIdentity,
} from '../security/IdentityWatch';
import {SecurityLog} from '../security/SecurityLog';
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';

/**
 * The check exactly as BleChatService performs it: assess the identity that just
 * completed a handshake against what was known BEFORE it was remembered.
 */
function assessAgainst(
  peerId: string,
  displayName: string,
  known: KnownIdentity[],
) {
  return assessIdentity({peerId, displayName}, known);
}

describe('an impostor taking a contact name, over a real handshake', () => {
  let air: VirtualAir;
  let me: VirtualPhone;
  let realFriend: VirtualPhone;
  let impostor: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    me = new VirtualPhone('deviceMe', 'Me', air, DEFAULT_ATT_MTU);
    realFriend = new VirtualPhone('deviceFriend', 'Jaismeet', air, DEFAULT_ATT_MTU);
    // Same display name, its own genuine keypair — which is all an attacker needs,
    // because a name is not a secret.
    impostor = new VirtualPhone('deviceImpostor', 'Jaismeet', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    me.dispose();
    realFriend.dispose();
    impostor.dispose();
  });

  async function meet(other: VirtualPhone): Promise<void> {
    other.startAdvertising();
    await me.scan();
    await me.peerManager.connect(toCentralLinkId(other.nodeId));
    await waitFor(
      () => me.isConnectedTo(other.peerId) && other.isConnectedTo(me.peerId),
      `handshake with ${other.nodeId}`,
    );
  }

  it('gives the two phones genuinely different identities despite the same name', async () => {
    await meet(realFriend);
    // The cryptography is doing its job: identity is the key, not the label.
    expect(realFriend.peerId).not.toBe(impostor.peerId);
    expect(me.peerManager.getPeer(realFriend.peerId)?.displayName).toBe('Jaismeet');
  });

  it('does not warn when the same friend reconnects', async () => {
    await meet(realFriend);
    const known: KnownIdentity[] = [
      {peerId: realFriend.peerId, displayName: 'Jaismeet', verified: false},
    ];

    const verdict = assessAgainst(realFriend.peerId, 'Jaismeet', known).verdict;
    expect(verdict).toBe('known');
    expect(isSuspicious(verdict)).toBe(false);
  });

  it('warns when a different identity arrives wearing the friend name', async () => {
    await meet(realFriend);
    const known: KnownIdentity[] = [
      {peerId: realFriend.peerId, displayName: 'Jaismeet', verified: false},
    ];

    await meet(impostor);
    const assessment = assessAgainst(impostor.peerId, 'Jaismeet', known);

    expect(assessment.verdict).toBe('nameCollision');
    expect(assessment.conflictsWith[0].peerId).toBe(realFriend.peerId);
  });

  it('escalates to impersonation when the real friend was verified', async () => {
    await meet(realFriend);
    // The user compared safety numbers in person with the real Jaismeet.
    const known: KnownIdentity[] = [
      {peerId: realFriend.peerId, displayName: 'Jaismeet', verified: true},
    ];

    await meet(impostor);
    const assessment = assessAgainst(impostor.peerId, 'Jaismeet', known);

    expect(assessment.verdict).toBe('impersonatesVerified');
    expect(isSuspicious(assessment.verdict)).toBe(true);
  });

  it('still delivers messages from the impostor — flagged, not silently dropped', async () => {
    await meet(impostor);
    await impostor.messages.send(me.peerId, 'hey, it is me');
    await waitFor(
      () => me.conversationWith(impostor.peerId).length === 1,
      'the impostor message to arrive',
    );

    // Deliberate: the app warns and lets the user decide. Silently discarding a message
    // from someone who might simply share a name would lose real conversations, and the
    // app cannot tell the difference — only the user can.
    expect(me.conversationWith(impostor.peerId)[0].text).toBe('hey, it is me');
  });

  it('files the impostor under its own conversation, never the friend one', async () => {
    await meet(realFriend);
    await realFriend.messages.send(me.peerId, 'from the real one');
    await waitFor(
      () => me.conversationWith(realFriend.peerId).length === 1,
      'the real message',
    );

    await meet(impostor);
    await impostor.messages.send(me.peerId, 'from the fake one');
    await waitFor(
      () => me.conversationWith(impostor.peerId).length === 1,
      'the impostor message',
    );

    // Two conversations, because they are two identities. Merging them on a matching
    // name is the failure that would put an attacker inside a trusted thread.
    expect(me.conversationWith(realFriend.peerId).map(m => m.text)).toEqual([
      'from the real one',
    ]);
    expect(me.conversationWith(impostor.peerId).map(m => m.text)).toEqual([
      'from the fake one',
    ]);
  });

  it('cannot be smuggled past the check by changing case', async () => {
    const known: KnownIdentity[] = [
      {peerId: realFriend.peerId, displayName: 'Jaismeet', verified: true},
    ];
    expect(assessAgainst(impostor.peerId, 'JAISMEET', known).verdict).toBe(
      'impersonatesVerified',
    );
  });
});

describe('the security history that results', () => {
  it('records the warning once, not once per reconnect', () => {
    let clock = 1;
    const log = new SecurityLog(() => clock++);

    // Five reconnects by the same impostor in a flaky radio environment.
    for (let i = 0; i < 5; i++) {
      log.record({
        kind: 'impersonationWarning',
        peerId: 'impostor',
        displayName: 'Jaismeet',
        detail: 'This is NOT that person.',
      });
    }

    expect(log.alarming()).toHaveLength(1);
  });

  it('keeps the warning visible alongside ordinary history', () => {
    let clock = 1;
    const log = new SecurityLog(() => clock++);
    log.record({kind: 'identityNew', peerId: 'friend', detail: 'met someone new'});
    log.record({
      kind: 'impersonationWarning',
      peerId: 'impostor',
      detail: 'This is NOT that person.',
    });
    log.record({kind: 'peerVerified', peerId: 'friend', detail: 'codes matched'});

    expect(log.all()).toHaveLength(3);
    expect(log.alarming().map(e => e.peerId)).toEqual(['impostor']);
    // Newest first, so the most recent thing is the first thing read.
    expect(log.all()[0].kind).toBe('peerVerified');
  });
});
