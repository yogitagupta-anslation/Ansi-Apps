/**
 * The codec is where encryption either happens or silently does not. These tests are
 * written from the attacker's side: what would I send to get plaintext accepted, or to
 * make the app emit plaintext?
 */
import {
  JsonPacketCodec,
  PacketDecodeError,
  SecurePacketCodec,
} from '../messaging/PacketCodec';
import {SessionRegistry} from '../crypto/SessionRegistry';
import {
  deriveSessionKeys,
  generateEphemeralKeyPair,
  SessionCipher,
} from '../crypto/SessionCrypto';
import {PROTOCOL_VERSION} from '../config/constants';
import {utf8Decode} from '../utils/bytes';
import type {Packet} from '../types/Packet';

const LINK = 'c:test-link';

function packet(type: Packet['type'], payload: unknown = {}): Packet {
  return {
    version: PROTOCOL_VERSION,
    id: 'packet-1',
    type,
    originId: 'sender-peer',
    senderId: 'sender-peer',
    destinationId: 'dest-peer',
    seq: 1,
    timestamp: 0,
    ttl: 1,
    hopCount: 0,
    payload,
  };
}

/** A registry whose link has a live session, plus the matching peer-side cipher. */
function establishedPair() {
  const a = generateEphemeralKeyPair();
  const b = generateEphemeralKeyPair();
  const common = {
    initiatorChallenge: 'chal-a',
    responderChallenge: 'chal-b',
    initiatorPeerId: 'peer-a',
    responderPeerId: 'peer-b',
  };
  const registry = new SessionRegistry();
  registry.set(
    LINK,
    new SessionCipher(
      deriveSessionKeys({
        ...common,
        privateKey: a.privateKey,
        peerPublicKey: b.publicKey,
        isInitiator: true,
      }),
    ),
  );
  const peerCipher = new SessionCipher(
    deriveSessionKeys({
      ...common,
      privateKey: b.privateKey,
      peerPublicKey: a.publicKey,
      isInitiator: false,
    }),
  );
  return {registry, peerCipher, codec: new SecurePacketCodec(registry)};
}

describe('SecurePacketCodec — handshake phase', () => {
  it('sends handshake packets in plaintext, because keys do not exist yet', () => {
    const codec = new SecurePacketCodec(new SessionRegistry());
    for (const type of ['HELLO', 'HELLO_ACK', 'HELLO_CONFIRM'] as const) {
      const bytes = codec.encode(packet(type), LINK);
      expect(utf8Decode(bytes).startsWith('{')).toBe(true);
    }
  });

  it('accepts a plaintext handshake packet when there is no session', () => {
    const codec = new SecurePacketCodec(new SessionRegistry());
    const bytes = codec.encode(packet('HELLO'), LINK);
    expect(codec.decode(bytes, LINK).type).toBe('HELLO');
  });

  it('refuses to SEND a message when the link has no session', () => {
    const codec = new SecurePacketCodec(new SessionRegistry());
    // Emitting cleartext because a session is missing is the exact failure this must
    // never have: it should throw instead.
    expect(() => codec.encode(packet('MESSAGE', {text: 'secret'}), LINK)).toThrow(
      PacketDecodeError,
    );
  });

  it('refuses a plaintext MESSAGE that arrives before any session exists', () => {
    const codec = new SecurePacketCodec(new SessionRegistry());
    const forged = new JsonPacketCodec().encode(packet('MESSAGE', {text: 'injected'}));
    expect(() => codec.decode(forged, LINK)).toThrow(/plaintext before a session/);
  });
});

describe('SecurePacketCodec — established session', () => {
  it('round-trips a message through the peer cipher', () => {
    const {codec, peerCipher} = establishedPair();
    const bytes = codec.encode(packet('MESSAGE', {text: 'hello there'}), LINK);
    const inner = new JsonPacketCodec().decode(peerCipher.open(bytes));
    expect((inner.payload as {text: string}).text).toBe('hello there');
  });

  it('puts no readable message text on the wire', () => {
    const {codec} = establishedPair();
    const bytes = codec.encode(packet('MESSAGE', {text: 'meet at seven'}), LINK);
    const wire = utf8Decode(bytes);
    expect(wire).not.toContain('meet at seven');
    expect(wire).not.toContain('MESSAGE');
    expect(wire).not.toContain('sender-peer');
  });

  it('rejects a plaintext frame on an encrypted link — the downgrade attack', () => {
    const {codec} = establishedPair();
    const forged = new JsonPacketCodec().encode(packet('MESSAGE', {text: 'injected'}));
    // An attacker strips the encryption and sends plain JSON, hoping the codec parses
    // whatever it is given. It must not.
    expect(() => codec.decode(forged, LINK)).toThrow(/downgrade/);
  });

  it('rejects a plaintext HELLO replayed onto an established link', () => {
    const {codec} = establishedPair();
    const forged = new JsonPacketCodec().encode(packet('HELLO'));
    // Handshake types are not a loophole once a session exists.
    expect(() => codec.decode(forged, LINK)).toThrow(/downgrade/);
  });

  it('rejects a tampered ciphertext as a decode error, not a crash', () => {
    const {codec} = establishedPair();
    const bytes = codec.encode(packet('MESSAGE', {text: 'x'}), LINK);
    // eslint-disable-next-line no-bitwise -- deliberately corrupting the ciphertext
    bytes[bytes.length - 2] ^= 0x40;
    expect(() => codec.decode(bytes, LINK)).toThrow(PacketDecodeError);
  });

  it('rejects a frame captured from a different link', () => {
    const one = establishedPair();
    const two = establishedPair();
    const bytes = one.codec.encode(packet('MESSAGE', {text: 'x'}), LINK);
    expect(() => two.codec.decode(bytes, LINK)).toThrow(PacketDecodeError);
  });

  it('rejects an encrypted frame once the session is gone', () => {
    const {codec, registry} = establishedPair();
    const bytes = codec.encode(packet('MESSAGE', {text: 'x'}), LINK);
    registry.clear(LINK);
    expect(() => codec.decode(bytes, LINK)).toThrow(/no session/);
  });

  it('rejects an empty frame', () => {
    const {codec} = establishedPair();
    expect(() => codec.decode(new Uint8Array(0), LINK)).toThrow(PacketDecodeError);
  });
});

describe('SessionRegistry', () => {
  it('drops a cipher when its link goes away', () => {
    const registry = new SessionRegistry();
    const {peerCipher} = establishedPair();
    registry.set(LINK, peerCipher);
    expect(registry.has(LINK)).toBe(true);
    registry.clear(LINK);
    expect(registry.has(LINK)).toBe(false);
    expect(registry.get(LINK)).toBeUndefined();
  });
});
