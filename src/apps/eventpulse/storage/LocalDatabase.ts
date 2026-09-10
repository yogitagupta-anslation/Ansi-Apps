/**
 * LocalDatabase — the device's own copy of everything the map needs.
 *
 * The map has to work with the network off (§44): a conference hall's Wi-Fi
 * dies exactly when 2,000 people arrive. So the attendee directory, the peer-id
 * resolution table, the user's own profile, the blocklist and queued
 * connection requests all live here, and the network is a background
 * reconciler rather than a dependency.
 *
 * The interface is a small key-value + collection store rather than SQL,
 * because that is all the access pattern needs and it keeps the storage
 * adapter swappable: MMKV in production (synchronous, fast), AsyncStorage as a
 * fallback, an in-memory map in tests.
 */

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
  multiGet?(keys: string[]): Promise<[string, string | null][]>;
  multiSet?(entries: [string, string][]): Promise<void>;
  multiRemove?(keys: string[]): Promise<void>;
}

/** Test/dev adapter. Also the fallback when no persistent store is available. */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getAllKeys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  async multiGet(keys: string[]): Promise<[string, string | null][]> {
    return keys.map((key) => [key, this.map.get(key) ?? null]);
  }

  async multiSet(entries: [string, string][]): Promise<void> {
    for (const [key, value] of entries) this.map.set(key, value);
  }

  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) this.map.delete(key);
  }

  get snapshot(): Record<string, string> {
    return Object.fromEntries(this.map);
  }
}

export interface CollectionRecord {
  id: string;
}

/**
 * Schema version for the whole local store. Bump on any incompatible change;
 * `migrate` clears rather than guesses, because everything here is a cache that
 * can be refetched — losing it costs one sync, corrupting it costs trust.
 */
export const LOCAL_DB_VERSION = 3;

const VERSION_KEY = 'eventpulse:meta:version';

export class LocalDatabase {
  private readonly adapter: StorageAdapter;
  /** Write-through cache; reads on the map's hot path must not await I/O. */
  private readonly cache = new Map<string, unknown>();
  private ready = false;

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter;
  }

  async open(): Promise<void> {
    if (this.ready) return;
    const stored = await this.adapter.getItem(VERSION_KEY);
    const version = stored === null ? null : Number(stored);

    if (version !== LOCAL_DB_VERSION) {
      await this.migrate(version);
      await this.adapter.setItem(VERSION_KEY, String(LOCAL_DB_VERSION));
    }
    this.ready = true;
  }

  private async migrate(from: number | null): Promise<void> {
    if (from === null) return; // fresh install
    // Every collection here is a rebuildable cache. Dropping is the safe move.
    const keys = await this.adapter.getAllKeys();
    const ours = keys.filter((key) => key.startsWith('eventpulse:') && key !== VERSION_KEY);
    if (this.adapter.multiRemove) await this.adapter.multiRemove(ours);
    else for (const key of ours) await this.adapter.removeItem(key);
    this.cache.clear();
  }

  /* ---------------------------------------------------------------- *
   * Documents
   * ---------------------------------------------------------------- */

  async get<T>(key: string): Promise<T | null> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const raw = await this.adapter.getItem(namespaced(key));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, parsed);
      return parsed;
    } catch {
      // A corrupt entry is a cache miss, not a crash.
      await this.adapter.removeItem(namespaced(key));
      return null;
    }
  }

  /** Synchronous read from the write-through cache. Null when not yet loaded. */
  peek<T>(key: string): T | null {
    return this.cache.has(key) ? (this.cache.get(key) as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.cache.set(key, value);
    await this.adapter.setItem(namespaced(key), JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.cache.delete(key);
    await this.adapter.removeItem(namespaced(key));
  }

  /* ---------------------------------------------------------------- *
   * Collections
   * ---------------------------------------------------------------- */

  /**
   * Collections are stored as one document per collection rather than one per
   * record. An attendee directory is read wholesale and written wholesale; a
   * single blob is dramatically faster than 2,000 AsyncStorage round trips.
   */
  async getCollection<T extends CollectionRecord>(name: string): Promise<Map<string, T>> {
    const entries = await this.get<T[]>(`collection:${name}`);
    const map = new Map<string, T>();
    if (entries) for (const entry of entries) map.set(entry.id, entry);
    return map;
  }

  async setCollection<T extends CollectionRecord>(
    name: string,
    records: Iterable<T>,
  ): Promise<void> {
    await this.set(`collection:${name}`, [...records]);
  }

  async upsert<T extends CollectionRecord>(name: string, record: T): Promise<void> {
    const collection = await this.getCollection<T>(name);
    collection.set(record.id, record);
    await this.setCollection(name, collection.values());
  }

  async upsertMany<T extends CollectionRecord>(name: string, records: readonly T[]): Promise<void> {
    if (records.length === 0) return;
    const collection = await this.getCollection<T>(name);
    for (const record of records) collection.set(record.id, record);
    await this.setCollection(name, collection.values());
  }

  async removeFromCollection(name: string, id: string): Promise<void> {
    const collection = await this.getCollection<CollectionRecord>(name);
    if (!collection.delete(id)) return;
    await this.setCollection(name, collection.values());
  }

  /** Wipe everything for one event — used on "leave event". */
  async clearEvent(eventId: string): Promise<void> {
    const keys = await this.adapter.getAllKeys();
    const prefix = namespaced(`event:${eventId}:`);
    const targets = keys.filter((key) => key.startsWith(prefix));
    if (this.adapter.multiRemove) await this.adapter.multiRemove(targets);
    else for (const key of targets) await this.adapter.removeItem(key);
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`event:${eventId}:`)) this.cache.delete(key);
    }
  }

  async clearAll(): Promise<void> {
    const keys = await this.adapter.getAllKeys();
    const ours = keys.filter((key) => key.startsWith('eventpulse:'));
    if (this.adapter.multiRemove) await this.adapter.multiRemove(ours);
    else for (const key of ours) await this.adapter.removeItem(key);
    this.cache.clear();
    this.ready = false;
  }
}

function namespaced(key: string): string {
  return `eventpulse:${key}`;
}

/** Canonical key builders — one place to change the layout. */
export const keys = {
  userProfile: 'user:profile',
  privacySettings: 'user:privacy',
  themePreference: 'user:theme',
  // Set once the first-run card has been completed or skipped.
  onboarded: 'user:onboarded',
  identitySeed: (eventId: string) => `event:${eventId}:identity-seed`,
  peerSchedule: (eventId: string) => `event:${eventId}:peer-schedule`,
  membership: (eventId: string) => `event:${eventId}:membership`,
  eventDetail: (eventId: string) => `event:${eventId}:detail`,
  directory: (eventId: string) => `event:${eventId}:directory`,
  peerMap: (eventId: string) => `event:${eventId}:peer-map`,
  directorySync: (eventId: string) => `event:${eventId}:directory-sync`,
  connections: (eventId: string) => `event:${eventId}:connections`,
  // BLE connection requests in flight. Event-scoped like the connections they
  // become, so ending an event disposes of them with everything else.
  connectionRequests: (eventId: string) => `event:${eventId}:connection-requests`,
  // Device-local by design; see SavedPeopleService. Deliberately not in the
  // outbox, because a save is never synced anywhere.
  savedPeople: (eventId: string) => `event:${eventId}:saved`,
  eventStats: (eventId: string) => `event:${eventId}:stats`,
  outbox: 'sync:outbox',
  blocklist: 'security:blocklist',
  // Reports that could not be delivered. Local and device-scoped like the
  // blocklist: a report the network ate must survive to be retried rather than
  // be silently dropped after the user was told it had been sent.
  reportQueue: 'security:report-queue',
  eventList: 'events:list',
  lastEvent: 'events:last',
};
