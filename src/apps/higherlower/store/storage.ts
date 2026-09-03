/**
 * Tiny JSON store on top of AsyncStorage.
 *
 * The import is lazy and guarded: AsyncStorage throws the moment it is loaded
 * without its native half, which is exactly the state of a JS-only reload
 * before the app has been rebuilt. Rather than take the whole app down with it,
 * we fall back to an in-memory map -- stats then last for the session instead of
 * forever, and the profile screen says so.
 */
interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const memory = new Map<string, string>();
let resolved: KeyValueStore | null | undefined;

function backend(): KeyValueStore | null {
  if (resolved !== undefined) return resolved;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const store = (mod?.default ?? mod) as KeyValueStore | undefined;
    resolved = store && typeof store.getItem === 'function' ? store : null;
  } catch {
    resolved = null;
  }
  return resolved;
}

async function readRaw(key: string): Promise<string | null> {
  const store = backend();
  if (store) {
    try {
      return await store.getItem(key);
    } catch {
      resolved = null;
    }
  }
  return memory.get(key) ?? null;
}

async function writeRaw(key: string, value: string): Promise<void> {
  const store = backend();
  if (store) {
    try {
      await store.setItem(key, value);
      return;
    } catch {
      resolved = null;
    }
  }
  memory.set(key, value);
}

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    // Merge onto the fallback so a blob written by an older build cannot leave
    // newly-added fields undefined.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? ({ ...(fallback as object), ...(parsed as object) } as T)
      : parsed;
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await writeRaw(key, JSON.stringify(value));
  } catch {
    // A value that will not serialise is a bug, not a reason to break the game.
  }
}

/** False once storage has proven unavailable — surfaced on the profile screen. */
export function isPersistent(): boolean {
  return backend() !== null;
}
