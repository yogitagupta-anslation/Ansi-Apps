/**
 * AppStorage.ts
 * -----------------------------------------------------------------------------
 * The ONLY file in the app that imports AsyncStorage.
 *
 * Everything else goes through the typed storage modules that sit on top of
 * this, so no React component ever touches a raw key. That boundary is what
 * makes swapping the backing store (SQLite, MMKV) a contained change.
 *
 * All data is LOCAL to this device. No backend, no cloud, no network.
 * -----------------------------------------------------------------------------
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from '../utils/logger';

export const STORAGE_KEYS = {
  employees: '@bleattendance/employees',
  attendance: '@bleattendance/attendance',
  settings: '@bleattendance/settings',
} as const;

/**
 * Serialises writes for one storage key.
 *
 * Read-modify-write on a shared key is the one place a race could corrupt
 * data, so every mutation is chained onto the previous rather than run
 * concurrently. This stands in for a database transaction.
 */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // Keep the chain alive even if one task rejects.
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Read and parse JSON.
 *
 * Returns the fallback rather than throwing: corrupt storage must degrade to
 * an empty registry, never a crash loop the user cannot escape.
 */
export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    log.error('BLE', 'Storage read failed for ' + key + ': ' + String(error));
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    log.error('BLE', 'Storage write failed for ' + key + ': ' + String(error));
    throw error;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    log.error('BLE', 'Storage remove failed for ' + key + ': ' + String(error));
  }
}

/** Wipe every table this app owns. Destructive; confirmation-gated in the UI. */
export async function clearAllLocalData(): Promise<void> {
  await Promise.all([
    removeKey(STORAGE_KEYS.employees),
    removeKey(STORAGE_KEYS.attendance),
    removeKey(STORAGE_KEYS.settings),
  ]);
  log.warn('BLE', 'All local data cleared by user');
}
