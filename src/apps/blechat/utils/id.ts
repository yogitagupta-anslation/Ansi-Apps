import 'react-native-get-random-values';

/**
 * Cryptographically random identifiers.
 *
 * react-native-get-random-values installs a real platform CSPRNG behind
 * global.crypto.getRandomValues (SecRandomCopyBytes on iOS, SecureRandom on Android),
 * so this is not Math.random().
 */
interface RandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const c = (globalThis as {crypto?: RandomSource}).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'No CSPRNG available. react-native-get-random-values must be imported before use.',
    );
  }
  c.getRandomValues(bytes);
  return bytes;
}

export function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(b[i].toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/**
 * 32 hex chars of entropy, generated once per installation and persisted.
 * Deliberately unrelated to the Bluetooth MAC, device name or model.
 */
export function generatePeerId(): string {
  const b = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += b[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** First 8 bytes (16 hex chars) of a peerId — what fits in an advertisement. */
export function peerIdPrefix(peerId: string): string {
  return peerId.slice(0, 16);
}

export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

/**
 * Of two phones that can see each other, which one places the call.
 *
 * Both discover each other in the same instant, and if both dial, Android brings up two
 * connections between the same pair and the stack tears one down under the other — the
 * link comes up and dies a millisecond later, so the greeting is written to a connection
 * that no longer exists. One side has to hold back.
 *
 * Comparing the two identities decides it with nothing exchanged and no state to get out
 * of step: both phones run the same comparison on the same two values and always reach
 * opposite answers. Lower identity dials. Equal prefixes (which would mean the same
 * identity) fall through to dialling, because a stalemate would be worse than a collision.
 */
export function shouldDial(myPrefix: string | null, theirPrefix: string | null): boolean {
  if (!myPrefix || !theirPrefix) {
    // Not enough to decide with. Dialling is the behaviour that at least tries.
    return true;
  }
  return myPrefix <= theirPrefix;
}
