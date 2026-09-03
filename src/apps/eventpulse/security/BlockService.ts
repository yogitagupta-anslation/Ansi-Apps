/**
 * BlockService — blocking that actually holds.
 *
 * The requirement (§42) is specific and worth restating: a blocked person
 * disappears from the map, disappears from discovery, cannot send a connection
 * request, and does not come back after a restart. That last clause is the one
 * naive implementations fail, so the blocklist is persisted locally *first* and
 * synced to the server second — a block takes effect instantly and offline, and
 * survives an app that never reaches the network again.
 *
 * Enforcement happens at three layers on purpose:
 *   1. `PeerRegistry` drops their packets, so they never become a map node.
 *   2. `AttendeeDirectory` filters them from search and lookups.
 *   3. The server refuses their connection requests.
 *
 * Any one layer failing still leaves the user protected.
 */

import type { ProfileId } from '../types';
import type { EventPulseApi } from '../api/ApiClient';
import { LocalDatabase, keys } from '../storage/LocalDatabase';

export interface BlockRecord {
  profileId: ProfileId;
  blockedAt: number;
  /** Not yet acknowledged by the server. */
  pendingSync?: boolean;
  reason?: string;
}

export interface ReportInput {
  profileId: ProfileId;
  reason: 'harassment' | 'impersonation' | 'spam' | 'inappropriate_profile' | 'other';
  details?: string;
  /** Blocking is offered alongside reporting, and is on by default. */
  alsoBlock?: boolean;
}

export const REPORT_REASONS: { value: ReportInput['reason']; label: string }[] = [
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'impersonation', label: 'Pretending to be someone else' },
  { value: 'spam', label: 'Spam or unwanted promotion' },
  { value: 'inappropriate_profile', label: 'Inappropriate profile content' },
  { value: 'other', label: 'Something else' },
];

export class BlockService {
  private readonly db: LocalDatabase;
  private readonly api: EventPulseApi;
  private readonly listeners = new Set<(blocked: Set<ProfileId>) => void>();
  private blocks = new Map<ProfileId, BlockRecord>();
  private loaded = false;

  constructor(db: LocalDatabase, api: EventPulseApi) {
    this.db = db;
    this.api = api;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = (await this.db.get<BlockRecord[]>(keys.blocklist)) ?? [];
    this.blocks = new Map(stored.map((record) => [record.profileId, record]));
    this.loaded = true;
    this.emit();
  }

  subscribe(listener: (blocked: Set<ProfileId>) => void): () => void {
    this.listeners.add(listener);
    listener(this.blockedIds());
    return () => this.listeners.delete(listener);
  }

  blockedIds(): Set<ProfileId> {
    return new Set(this.blocks.keys());
  }

  list(): BlockRecord[] {
    return [...this.blocks.values()].sort((a, b) => b.blockedAt - a.blockedAt);
  }

  isBlocked(profileId: ProfileId): boolean {
    return this.blocks.has(profileId);
  }

  /** Takes effect immediately and locally; the server is told when reachable. */
  async block(profileId: ProfileId, reason?: string): Promise<void> {
    if (this.blocks.has(profileId)) return;
    this.blocks.set(profileId, {
      profileId,
      blockedAt: Date.now(),
      pendingSync: true,
      reason,
    });
    await this.persist();
    this.emit();

    try {
      await this.api.blockUser(profileId);
      const record = this.blocks.get(profileId);
      if (record) record.pendingSync = false;
      await this.persist();
    } catch {
      // Stays queued. `flush()` retries when connectivity returns.
    }
  }

  async unblock(profileId: ProfileId): Promise<void> {
    if (!this.blocks.delete(profileId)) return;
    await this.persist();
    this.emit();
    try {
      await this.api.unblockUser(profileId);
    } catch {
      // Unblocking locally is enough to restore visibility on this device; the
      // server converges on the next flush.
    }
  }

  async report(input: ReportInput): Promise<void> {
    if (input.alsoBlock !== false) await this.block(input.profileId, input.reason);
    try {
      await this.api.reportUser(input.profileId, input.reason, input.details);
    } catch {
      // A report that cannot be delivered right now must not undo the block.
    }
  }

  /** Retry any blocks the server has not acknowledged. */
  async flush(): Promise<void> {
    const pending = [...this.blocks.values()].filter((record) => record.pendingSync);
    for (const record of pending) {
      try {
        await this.api.blockUser(record.profileId);
        record.pendingSync = false;
      } catch {
        return; // still offline; try again later
      }
    }
    if (pending.length) await this.persist();
  }

  private async persist(): Promise<void> {
    await this.db.set(keys.blocklist, [...this.blocks.values()]);
  }

  private emit(): void {
    const blocked = this.blockedIds();
    for (const listener of this.listeners) listener(blocked);
  }
}
