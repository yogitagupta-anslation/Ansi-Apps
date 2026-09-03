/**
 * Thin typed wrapper over AsyncStorage.
 *
 * All persistence is on-device. There is no backend, no cloud sync and no
 * network call anywhere in this layer -- that is a hard requirement of the
 * game, not an implementation detail.
 *
 * Every read is defensive: stored JSON can be corrupt or written by an older
 * app version, and a failed read must degrade to the default rather than
 * crash the app on launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {createLogger} from '../utils/logger';

const log = createLogger('LocalStorage');

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn(`could not read "${key}"; using the default`, err);
    return fallback;
  }
}

export async function writeJson<T>(key: string, value: T): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    log.error(`could not write "${key}"`, err);
    return false;
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    log.warn(`could not remove "${key}"`, err);
  }
}

/**
 * AsyncStorage v3 dropped multiRemove from its public interface, so this
 * removes keys one at a time. allSettled keeps one bad key from aborting
 * the rest.
 */
export async function clearAll(keys: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map(key => AsyncStorage.removeItem(key)));
  const failed = results.filter(result => result.status === 'rejected').length;
  if (failed > 0) {
    log.warn(`could not clear ${failed} of ${keys.length} storage keys`);
  }
}
