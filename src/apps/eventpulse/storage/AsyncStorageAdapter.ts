/**
 * AsyncStorage-backed persistence.
 *
 * AsyncStorage is the lowest-common-denominator store that ships everywhere; a
 * production build should swap this for MMKV (synchronous, an order of
 * magnitude faster on a 2,000-attendee directory) by implementing the same
 * `StorageAdapter` interface. Nothing above this file knows the difference.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { StorageAdapter } from './LocalDatabase';

export class AsyncStorageAdapter implements StorageAdapter {
  getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  setItem(key: string, value: string): Promise<void> {
    return AsyncStorage.setItem(key, value);
  }

  removeItem(key: string): Promise<void> {
    return AsyncStorage.removeItem(key);
  }

  async getAllKeys(): Promise<string[]> {
    return [...(await AsyncStorage.getAllKeys())];
  }

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    const entries = await AsyncStorage.multiGet(keys);
    return entries.map(([key, value]) => [key, value ?? null]);
  }

  multiSet(entries: [string, string][]): Promise<void> {
    return AsyncStorage.multiSet(entries);
  }

  multiRemove(keys: string[]): Promise<void> {
    return AsyncStorage.multiRemove(keys);
  }
}
