import {
  SessionCipher,
  SessionCryptoError,
  deriveSessionKeys,
  ephemeralPublicKeyFromHex,
  ephemeralPublicKeyToHex,
  generateEphemeralKeyPair,
} from '../crypto/SessionCrypto';
import {utf8Decode, utf8Encode} from '../utils/bytes';

/** Both halves of one handshake, wired the way PeerManager wires them. */
function establish() {
  const initiator = generateEphemeralKeyPair();
  const responder = generateEphemeralKeyPair();
  const common = {
    initiatorChallenge: 'aaaa1111',
    responderChallenge: 'bbbb2222',
    initiatorPeerId: 'peer-initiator',
    responderPeerId: 'peer-responder',
  };
  const initiatorKeys = deriveSessionKeys({
    ...common,
    privateKey: initiator.privateKey,
    peerPublicKey: responder.publicKey,
    isInitiator: true,
  });
  const responderKeys = deriveSessionKeys({
    ...common,
    privateKey: responder.privateKey,
    peerPublicKey: initiator.publicKey,
    isInitiator: false,
  });
  return {
    initiator: new SessionCipher(initiatorKeys),
    responder: new SessionCipher(responderKeys),
    initiatorKeys,
    responderKeys,
    common,
    keypairs: {initiator, responder},
  };
}

describe('session key agreement', () => {
  it('both sides derive the same directional keys, mirrored', () => {
    const {initiatorKeys, responderKeys} = establish();
    // What one side sends with, the other must receive with.
    expect(Array.from(initiatorKeys.sendKey)).toEqual(
      Array.from(responderKeys.recvKey),
    );
    expect(Array.from(initiatorKeys.recvKey)).toEqual(
      Array.from(responderKeys.sendKey),
    );
  });

  it('uses a different key per direction, so counters cannot collide', () => {
    const {initiatorKeys} = establish();
    expect(Array.from(initiatorKeys.sendKey)).not.toEqual(
      Array.from(initiatorKeys.recvKey),
    );
    expect(Array.from(initiatorKeys.sendNoncePrefix)).not.toEqual(
      Array.from(initiatorKeys.recvNoncePrefix),
    );
  });

  it('derives entirely new keys when the same pair handshakes again', () => {
    const first = establish();
    const second = establish();
    expect(Array.from(first.initiatorKeys.sendKey)).not.toEqual(
      Array.from(second.initiatorKeys.sendKey),
    );
  });

  it('binds the keys to the challenges, so a different transcript cannot match', () => {
    const {keypairs, common} = establish();
    const honest = deriveSessionKeys({
      ...common,
      privateKey: keypairs.initiator.privateKey,
      peerPublicKey: keypairs.responder.publicKey,
      isInitiator: true,
    });
    const tampered = deriveSessionKeys({
      ...common,
      responderChallenge: 'bbbb2223',
      privateKey: keypairs.initiator.privateKey,
      peerPublicKey: keypairs.responder.publicKey,
      isInitiator: true,
    });
    expect(Array.from(honest.sendKey)).not.toEqual(Array.from(tampered.sendKey));
  });

  it('rejects malformed ephemeral public keys rather than deriving garbage', () => {
    const {keypairs} = establish();
    const hex = ephemeralPublicKeyToHex(keypairs.initiator.publicKey);
    expect(ephemeralPublicKeyFromHex(hex)).not.toBeNull();
    expect(ephemeralPublicKeyFromHex(hex.slice(0, 60))).toBeNull();
    expect(ephemeralPublicKeyFromHex('zz' + hex.slice(2))).toBeNull();
    expect(ephemeralPublicKeyFromHex(null)).toBeNull();
    expect(ephemeralPublicKeyFromHex(12345)).toBeNull();
  });
});

describe('SessionCipher', () => {
  it('round-trips a packet in both directions', () => {
    const {initiator, responder} = establish();
    const sent = utf8Encode(JSON.stringify({type: 'MESSAGE', text: 'hi'}));

    const up = initiator.seal(sent);
    expect(utf8Decode(responder.open(up))).toBe('{"type":"MESSAGE","text":"hi"}');

    const down = responder.seal(utf8Encode('reply'));
    expect(utf8Decode(initiator.open(down))).toBe('reply');
  });

  it('never puts the plaintext on the wire', () => {
    const {initiator} = establish();
    const secret = 'meet me at the usual place';
    const frame = initiator.seal(utf8Encode(secret));
    // The whole point of the layer: the readable string must not survive anywhere in
    // the bytes actually transmitted.
    expect(utf8Decode(frame)).not.toContain(secret);
    expect(utf8Decode(frame)).not.toContain('meet');
  });

  it('detects a tampered ciphertext instead of returning altered plaintext', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('transfer 100'));
    // eslint-disable-next-line no-bitwise -- deliberately corrupting one bit
    frame[frame.length - 3] ^= 0x01;
    expect(() => responder.open(frame)).toThrow(SessionCryptoError);
  });

  it('detects a tampered counter, which is sent in the clear', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('hello'));
    // eslint-disable-next-line no-bitwise -- deliberately corrupting the counter
    frame[5] ^= 0xff;
    expect(() => responder.open(frame)).toThrow(SessionCryptoError);
  });

  it('rejects a replayed frame even though its tag is genuine', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('once'));
    expect(utf8Decode(responder.open(frame))).toBe('once');
    // Byte-for-byte the same frame a second time: valid tag, must still be refused.
    expect(() => responder.open(frame)).toThrow(/replayed/);
  });

  it('accepts genuinely out-of-order frames inside the window', () => {
    const {initiator, responder} = establish();
    const one = initiator.seal(utf8Encode('1'));
    const two = initiator.seal(utf8Encode('2'));
    const three = initiator.seal(utf8Encode('3'));
    expect(utf8Decode(responder.open(three))).toBe('3');
    expect(utf8Decode(responder.open(one))).toBe('1');
    expect(utf8Decode(responder.open(two))).toBe('2');
  });

  it('rejects a frame from an unrelated session', () => {
    const a = establish();
    const b = establish();
    const frame = a.initiator.seal(utf8Encode('not for you'));
    expect(() => b.responder.open(frame)).toThrow(SessionCryptoError);
  });

  it('rejects a frame reflected back to its own sender', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('mine'));
    // Directional keys mean the sender cannot open its own frame — which is what stops
    // an attacker bouncing a captured packet back and having it accepted.
    expect(() => initiator.open(frame)).toThrow(SessionCryptoError);
    expect(utf8Decode(responder.open(frame))).toBe('mine');
  });

  it('rejects truncated and empty frames', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('x'));
    expect(() => responder.open(frame.slice(0, 8))).toThrow(SessionCryptoError);
    expect(() => responder.open(new Uint8Array(0))).toThrow(SessionCryptoError);
  });

  it('rejects an unknown frame version', () => {
    const {initiator, responder} = establish();
    const frame = initiator.seal(utf8Encode('x'));
    frame[0] = 99;
    expect(() => responder.open(frame)).toThrow(/version/);
  });

  it('uses a fresh counter per packet, so no nonce is ever reused', () => {
    const {initiator} = establish();
    const counters = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const frame = initiator.seal(utf8Encode('same text every time'));
      counters.add(Array.from(frame.slice(1, 9)).join(','));
    }
    expect(counters.size).toBe(50);
  });

  it('produces different ciphertext for identical plaintext', () => {
    const {initiator} = establish();
    const a = initiator.seal(utf8Encode('identical'));
    const b = initiator.seal(utf8Encode('identical'));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('handles a long fragmented-message-sized payload', () => {
    const {initiator, responder} = establish();
    const long = 'x'.repeat(20000);
    const frame = initiator.seal(utf8Encode(long));
    expect(utf8Decode(responder.open(frame))).toBe(long);
  });
});
