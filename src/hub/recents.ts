/**
 * Local usage history — what the Library and the "opened 12×" lines are built on.
 *
 * This is the only place the store keeps state of its own, and it keeps it on the
 * device. Every usage figure shown anywhere in the store comes from here, which is
 * why there are no ratings or download counts alongside them: those would have to
 * be invented, and these do not.
 *
 * The AsyncStorage import is lazy and guarded for the same reason the game does
 * it: the module throws the moment it is loaded without its native half, which is
 * exactly the state of a JS-only reload against an older build. A usage list is a
 * convenience; taking the launcher down with it would not be.
 */

import type { AppId } from './registry';

const KEY = '@apphub/recents';

/** How many the home rail shows. The Library shows everything. */
export const RECENTS_RAIL_LIMIT = 6;

export interface UsageRecord {
  id: AppId;
  /** How many times this app has been opened from the store on this device. */
  count: number;
  /** Epoch ms of the most recent launch. */
  lastOpenedAt: number;
}

export type UsageMap = Partial<Record<AppId, UsageRecord>>;

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

function isRecord(value: unknown): value is UsageRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<UsageRecord>;
  return typeof r.id === 'string' && typeof r.count === 'number' && typeof r.lastOpenedAt === 'number';
}

/**
 * Reads the stored history, migrating the original shape on the way.
 *
 * The first version of this file stored a bare `AppId[]`, most recent first. That
 * is still on real devices, so it is read rather than discarded: each id becomes a
 * record with a single launch to its name and no timestamp we can honestly claim.
 */
export async function loadUsage(): Promise<UsageMap> {
  const raw = await read();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (Array.isArray(parsed)) {
    const map: UsageMap = {};
    parsed.forEach((id, index) => {
      if (typeof id !== 'string') return;
      // Order is the only fact the old format carried. Preserve it as a
      // descending sequence rather than pretending to know a real time.
      map[id as AppId] = { id: id as AppId, count: 1, lastOpenedAt: -index - 1 };
    });
    return map;
  }

  if (typeof parsed === 'object' && parsed !== null) {
    const map: UsageMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRecord(value)) map[id as AppId] = value;
    }
    return map;
  }

  return {};
}

/** Ids most recently opened first. Never longer than `limit` when one is given. */
export async function loadRecents(limit = RECENTS_RAIL_LIMIT): Promise<AppId[]> {
  return orderByRecency(await loadUsage()).slice(0, limit);
}

export function orderByRecency(usage: UsageMap): AppId[] {
  return (Object.values(usage) as UsageRecord[])
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .map((r) => r.id);
}

export function orderByCount(usage: UsageMap): AppId[] {
  return (Object.values(usage) as UsageRecord[])
    .sort((a, b) => b.count - a.count || b.lastOpenedAt - a.lastOpenedAt)
    .map((r) => r.id);
}

/**
 * Records one launch. Returns the new recency order so callers can render it
 * without a second read.
 */
export async function recordLaunch(id: AppId, now = Date.now()): Promise<AppId[]> {
  const usage = await loadUsage();
  const previous = usage[id];
  usage[id] = { id, count: (previous?.count ?? 0) + 1, lastOpenedAt: now };
  await write(JSON.stringify(usage));
  return orderByRecency(usage);
}

/* ------------------------------------------------------------ formatting -- */

/**
 * "Yesterday", "3d ago". Returns null when there is nothing truthful to say —
 * a migrated record carries a synthetic ordering value, not a real time, and the
 * UI renders nothing rather than a made-up age.
 */
export function formatLastOpened(record: UsageRecord | undefined, now = Date.now()): string | null {
  if (!record || record.lastOpenedAt <= 0) return null;
  const ms = now - record.lastOpenedAt;
  if (ms < 0) return 'Just now';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 14) return 'Last week';
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "12×". Null when the app has never been opened, so the row omits the chip. */
export function formatOpenCount(record: UsageRecord | undefined): string | null {
  if (!record || record.count <= 0) return null;
  return `${record.count}×`;
}
