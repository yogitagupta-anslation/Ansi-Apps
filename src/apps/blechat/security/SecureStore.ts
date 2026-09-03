import {NativeModules, Platform} from 'react-native';
import {logger} from '../utils/logger';

/**
 * Bridge to the Android Keystore wrapper (securestore/SecureStoreModule.kt).
 *
 * Wraps the at-rest encryption key with a key held in hardware, so the key stored on
 * disk is useless to anyone who copies the app's files. See the Kotlin module for what
 * this does and does not protect against — in particular, it defends the FILES, not an
 * unlocked phone in someone's hand.
 *
 * Everything here degrades rather than throws. A device with no usable Keystore keeps
 * working exactly as before, and says so, because refusing to run would be worse than
 * running with the protection this device can actually provide.
 */

const TAG = 'SecureStore';

interface SecureStoreNative {
  isAvailable(): Promise<boolean>;
  wrap(base64Plain: string): Promise<string>;
  unwrap(base64Wrapped: string): Promise<string>;
  destroyKey(): Promise<boolean>;
}

const native: SecureStoreNative | undefined = (
  NativeModules as {SecureStore?: SecureStoreNative}
).SecureStore;

/** How the at-rest key is being protected right now. Reported to the user as-is. */
export type KeyProtection =
  /** Wrapped by a key held in the Android Keystore. */
  | 'hardware'
  /** Stored directly, because this device offers nothing better. */
  | 'software'
  /** Not determined yet. */
  | 'unknown';

let availability: boolean | null = null;

/**
 * Whether hardware wrapping works here.
 *
 * Cached after the first answer: the probe performs a real encrypt/decrypt round trip,
 * which is not something to repeat on every storage read.
 */
export async function isHardwareBacked(): Promise<boolean> {
  if (availability !== null) {
    return availability;
  }
  if (Platform.OS !== 'android' || !native) {
    // iOS has an equivalent in the Keychain, but no module is written for it yet, and
    // claiming hardware backing without one would be a lie in the security UI.
    availability = false;
    return false;
  }
  try {
    availability = await native.isAvailable();
  } catch (err) {
    logger.warn(TAG, `keystore probe failed, falling back to software: ${String(err)}`);
    availability = false;
  }
  if (!availability) {
    logger.warn(TAG, 'no usable Keystore; at-rest key will be stored unwrapped');
  }
  return availability;
}

/** Returned by unwrap when the hardware key is gone for good. */
export class KeyInvalidatedError extends Error {}

/**
 * Wrap a key for storage. Returns null when hardware wrapping is unavailable, so the
 * caller stores the key the old way rather than losing it.
 */
export async function wrapKey(base64Plain: string): Promise<string | null> {
  if (!(await isHardwareBacked()) || !native) {
    return null;
  }
  try {
    return await native.wrap(base64Plain);
  } catch (err) {
    logger.error(TAG, `wrap failed: ${String(err)}`);
    return null;
  }
}

/**
 * Unwrap a stored key.
 *
 * Throws KeyInvalidatedError when the hardware key no longer exists — after a
 * phone-to-phone restore, or a reinstall. That is the expected consequence of binding a
 * key to a device, not a fault, and the caller is expected to start fresh rather than
 * retry.
 */
export async function unwrapKey(base64Wrapped: string): Promise<string> {
  if (!native) {
    throw new KeyInvalidatedError('no secure store on this platform');
  }
  try {
    return await native.unwrap(base64Wrapped);
  } catch (err) {
    const code = (err as {code?: string})?.code;
    if (code === 'key_invalidated') {
      throw new KeyInvalidatedError('the hardware key for this data is gone');
    }
    throw err;
  }
}

/** Forget the wrapping key. Everything wrapped with it becomes unreadable, permanently. */
export async function destroyHardwareKey(): Promise<void> {
  if (!native) {
    return;
  }
  try {
    await native.destroyKey();
  } catch (err) {
    logger.warn(TAG, `destroyKey failed: ${String(err)}`);
  }
  availability = null;
}

/** Test seam: forget the cached probe result. */
export function resetAvailabilityCache(): void {
  availability = null;
}
