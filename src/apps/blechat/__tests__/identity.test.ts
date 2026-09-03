/**
 * Cryptographic identity.
 *
 * The property that matters: a peerId is a commitment to a public key, and claiming one
 * requires proving ownership of that key against a fresh challenge. These tests attack
 * that claim from every angle a real attacker would.
 */
import {
  challengeBytes,
  generateKeyPair,
  hexToPrivateKey,
  peerIdFromPublicKey,
  publicKeyFromHex,
  publicKeyMatchesPeerId,
  publicKeyToHex,
  randomNonce,
  sign,
  verify,
  verifyPeerClaim,
  PEER_ID_HEX_LENGTH,
} from '../crypto/Identity';
import {bytesToHex} from '../utils/bytes';

/**
 * Stand-in ephemeral keys. The signature transcript binds these so a man in the middle
 * cannot swap in its own key agreement; the tests below only need them to be stable and
 * distinct from each other.
 */
const EPH_I = 'aa'.repeat(32);
const EPH_R = 'bb'.repeat(32);

function identity() {
  const keys = generateKeyPair();
  return {
    keys,
    peerId: peerIdFromPublicKey(keys.publicKey),
    publicKeyHex: publicKeyToHex(keys.publicKey),
  };
}

describe('peer identity derivation', () => {
  it('derives a stable 16-byte peerId from the public key', () => {
    const {keys, peerId} = identity();
    expect(peerId).toHaveLength(PEER_ID_HEX_LENGTH);
    expect(peerIdFromPublicKey(keys.publicKey)).toBe(peerId);
    expect(publicKeyMatchesPeerId(keys.publicKey, peerId)).toBe(true);
  });

  it('gives different keys different peerIds', () => {
    const ids = new Set(Array.from({length: 25}, () => identity().peerId));
    expect(ids.size).toBe(25);
  });

  it('rejects a public key that does not produce the claimed peerId', () => {
    const a = identity();
    const b = identity();
    // b's key cannot back a's identity.
    expect(publicKeyMatchesPeerId(b.keys.publicKey, a.peerId)).toBe(false);
  });

  it('rejects malformed public keys', () => {
    expect(publicKeyFromHex(undefined)).toBeNull();
    expect(publicKeyFromHex('')).toBeNull();
    expect(publicKeyFromHex('zz'.repeat(32))).toBeNull();
    expect(publicKeyFromHex('ab'.repeat(16))).toBeNull(); // too short
  });

  it('produces a fresh nonce every time', () => {
    const nonces = new Set(Array.from({length: 50}, () => randomNonce()));
    expect(nonces.size).toBe(50);
  });

  it('refuses to load a private key of the wrong length', () => {
    expect(() => hexToPrivateKey('abcd')).toThrow();
  });
});

describe('signatures', () => {
  it('verifies a signature over the exact challenge', () => {
    const me = identity();
    const message = challengeBytes('hello', 'nonce-1', me.peerId, 'audience', EPH_I, EPH_R);
    const sig = sign(message, me.keys.privateKey);
    expect(verify(sig, message, me.keys.publicKey)).toBe(true);
  });

  it('fails when any bound value differs', () => {
    const me = identity();
    const sig = sign(
      challengeBytes('hello', 'nonce-1', me.peerId, 'audience', EPH_I, EPH_R),
      me.keys.privateKey,
    );

    // Different challenge, label, signer or audience must all invalidate it.
    for (const message of [
      challengeBytes('hello', 'nonce-2', me.peerId, 'audience', EPH_I, EPH_R),
      challengeBytes('hello-ack', 'nonce-1', me.peerId, 'audience', EPH_I, EPH_R),
      challengeBytes('hello', 'nonce-1', 'someone-else', 'audience', EPH_I, EPH_R),
      challengeBytes('hello', 'nonce-1', me.peerId, 'different-audience', EPH_I, EPH_R),
    ]) {
      expect(verify(sig, message, me.keys.publicKey)).toBe(false);
    }
  });

  it('treats a malformed signature as a failure, not an exception', () => {
    const me = identity();
    const message = challengeBytes('hello', 'n', me.peerId, 'aud', EPH_I, EPH_R);
    expect(verify('', message, me.keys.publicKey)).toBe(false);
    expect(verify('zz', message, me.keys.publicKey)).toBe(false);
    expect(verify('ab'.repeat(64), message, me.keys.publicKey)).toBe(false);
  });
});

describe('verifyPeerClaim — impersonation attempts', () => {
  const challenge = 'challenge-abc';
  const audience = 'audience-peer-id';

  function honestClaim() {
    const me = identity();
    return {
      me,
      params: {
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: sign(
          challengeBytes('hello', challenge, me.peerId, audience, EPH_I, EPH_R),
          me.keys.privateKey,
        ),
        label: 'hello' as const,
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
      },
    };
  }

  it('accepts an honest claim', () => {
    expect(verifyPeerClaim(honestClaim().params).ok).toBe(true);
  });

  it('rejects claiming another peer id with your own key', () => {
    const attacker = identity();
    const victim = identity();

    const result = verifyPeerClaim({
      claimedPeerId: victim.peerId,
      publicKeyHex: attacker.publicKeyHex,
      signatureHex: sign(
        challengeBytes('hello', challenge, victim.peerId, audience, EPH_I, EPH_R),
        attacker.keys.privateKey,
      ),
      label: 'hello',
      challenge,
      audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('does not match');
  });

  it('rejects presenting the victim key without the private half', () => {
    const attacker = identity();
    const victim = identity();

    // The attacker knows the victim's public key (it is public!) but must sign with a
    // key it does not have.
    const result = verifyPeerClaim({
      claimedPeerId: victim.peerId,
      publicKeyHex: victim.publicKeyHex,
      signatureHex: sign(
        challengeBytes('hello', challenge, victim.peerId, audience, EPH_I, EPH_R),
        attacker.keys.privateKey,
      ),
      label: 'hello',
      challenge,
      audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('rejects a signature captured from an earlier session', () => {
    const {me} = honestClaim();
    // Signed against a previous connection's nonce.
    const replayed = sign(
      challengeBytes('hello', 'old-challenge', me.peerId, audience, EPH_I, EPH_R),
      me.keys.privateKey,
    );

    const result = verifyPeerClaim({
      claimedPeerId: me.peerId,
      publicKeyHex: me.publicKeyHex,
      signatureHex: replayed,
      label: 'hello',
      challenge,
      audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a signature relayed from a conversation with someone else', () => {
    const {me} = honestClaim();
    // A real signature, but made for a different audience — a man in the middle cannot
    // forward it as proof of identity to us.
    const forElsewhere = sign(
      challengeBytes('hello', challenge, me.peerId, 'a-different-peer', EPH_I, EPH_R),
      me.keys.privateKey,
    );

    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: forElsewhere,
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
      }).ok,
    ).toBe(false);
  });

  it('rejects a HELLO_ACK signature reflected back as a HELLO signature', () => {
    const {me} = honestClaim();
    const ackSig = sign(
      challengeBytes('hello-ack', challenge, me.peerId, audience, EPH_I, EPH_R),
      me.keys.privateKey,
    );

    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: ackSig,
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
      }).ok,
    ).toBe(false);
  });

  it('rejects a claim with no key or no signature', () => {
    const {me} = honestClaim();
    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: undefined,
        signatureHex: 'ab'.repeat(64),
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
      }).reason,
    ).toContain('public key');

    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: undefined,
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: EPH_R,
      }).reason,
    ).toContain('signature');
  });

  it('rejects a substituted ephemeral key — the man-in-the-middle case', () => {
    const {me} = honestClaim();
    const attackerKey = 'cc'.repeat(32);

    // The attacker forwards the real peer's signed HELLO but swaps the key agreement
    // for its own, so that it can decrypt everything it relays. The signature covers
    // the ephemeral keys precisely so this does not verify.
    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: sign(
          challengeBytes('hello', challenge, me.peerId, audience, EPH_I, EPH_R),
          me.keys.privateKey,
        ),
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: attackerKey,
        responderEphemeralKey: EPH_R,
      }).ok,
    ).toBe(false);

    // Substituting the other side's key must fail the same way.
    expect(
      verifyPeerClaim({
        claimedPeerId: me.peerId,
        publicKeyHex: me.publicKeyHex,
        signatureHex: sign(
          challengeBytes('hello', challenge, me.peerId, audience, EPH_I, EPH_R),
          me.keys.privateKey,
        ),
        label: 'hello',
        challenge,
        audiencePeerId: audience,
        initiatorEphemeralKey: EPH_I,
        responderEphemeralKey: attackerKey,
      }).ok,
    ).toBe(false);
  });

  it('rejects a peerId of the wrong shape', () => {
    const {me, params} = honestClaim();
    expect(
      verifyPeerClaim({...params, claimedPeerId: 'short'}).reason,
    ).toContain('16-byte');
    expect(bytesToHex(me.keys.publicKey)).toHaveLength(64);
  });
});
