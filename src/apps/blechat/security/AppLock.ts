import {sha256} from '@noble/hashes/sha256';
import {bytesToHex, utf8Encode} from '../utils/bytes';

/**
 * A local screen lock, not encryption — deters someone who picks up an unlocked phone
 * from opening straight into your conversations. It does NOT protect data at rest:
 * anyone with filesystem access (adb, a rooted device) can read AsyncStorage directly
 * regardless of this PIN. That is also why messages stay unencrypted around this gate —
 * the PIN was never the thing standing between a determined attacker and the data, only
 * between a stranger and a glance.
 */
export function hashPin(pin: string): string {
  return bytesToHex(sha256(utf8Encode(pin)));
}

export function pinMatches(pin: string, hash: string): boolean {
  return hashPin(pin) === hash;
}

export const MIN_PIN_LENGTH = 4;
