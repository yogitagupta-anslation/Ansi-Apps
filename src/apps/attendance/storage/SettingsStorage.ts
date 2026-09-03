/**
 * SettingsStorage.ts
 * -----------------------------------------------------------------------------
 * Persistence for user-configurable settings.
 *
 * Exposes a fast single-key read (`getRaw`) so the app can load the THEME
 * before the first render and avoid flashing the wrong colours - see App.tsx.
 * -----------------------------------------------------------------------------
 */

import { readJson, STORAGE_KEYS, WriteQueue, writeJson } from './AppStorage';

const queue = new WriteQueue();

export type SettingsMap = Record<string, string>;

async function readAll(): Promise<SettingsMap> {
  return readJson<SettingsMap>(STORAGE_KEYS.settings, {});
}

export const SettingsStorage = {
  async getAll(): Promise<SettingsMap> {
    return readAll();
  },

  async get(key: string): Promise<string | null> {
    const all = await readAll();
    return all[key] ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      all[key] = value;
      await writeJson(STORAGE_KEYS.settings, all);
    });
  },

  /** Write several keys in ONE read-modify-write, rather than N racing ones. */
  async setMany(entries: SettingsMap): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      Object.assign(all, entries);
      await writeJson(STORAGE_KEYS.settings, all);
    });
  },

  async remove(key: string): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      delete all[key];
      await writeJson(STORAGE_KEYS.settings, all);
    });
  },

  async clearAll(): Promise<void> {
    await queue.run(async () => {
      await writeJson(STORAGE_KEYS.settings, {});
    });
  },
};
