/**
 * "Recently opened", persisted.
 *
 * The AsyncStorage import is lazy and guarded for the same reason the game does
 * it: the module throws the moment it is loaded without its native half, which is
 * exactly the state of a JS-only reload against an older build. A recents list is
 * a convenience; taking the launcher down with it would not be.
 */

import type { AppId } from './registry';

const KEY = '@apphub/recents';
const LIMIT = 3;

interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const memory = new Map<string, string>();
let resolved: KeyValueStore | null | undefined;

function backend(): KeyValueStore | null {
  if (resolved !== undefined) return resolved;
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const store = (mod?.default ?? mod) as KeyValueStore | undefined;
    resolved = store && typeof store.getItem === 'function' ? store : null;
  } catch {
    resolved = null;
  }
  return resolved;
}

async function read(): Promise<string | null> {
  const store = backend();
  if (store) {
    try {
      return await store.getItem(KEY);
    } catch {
      resolved = null;
    }
  }
  return memory.get(KEY) ?? null;
}

async function write(value: string): Promise<void> {
  const store = backend();
  if (store) {
    try {
      await store.setItem(KEY, value);
      return;
    } catch {
      resolved = null;
    }
  }
  memory.set(KEY, value);
}

export async function loadRecents(): Promise<AppId[]> {
  const raw = await read();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((id) => typeof id === 'string') as AppId[]) : [];
  } catch {
    return [];
  }
}

/** Most recent first, deduplicated, capped. Returns the new list so callers can render it. */
export async function recordLaunch(id: AppId): Promise<AppId[]> {
  const next = [id, ...(await loadRecents()).filter((existing) => existing !== id)].slice(0, LIMIT);
  await write(JSON.stringify(next));
  return next;
}
