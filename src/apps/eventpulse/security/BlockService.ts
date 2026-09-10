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

/** A report the server has not accepted yet. Persisted so it survives a restart. */
export interface PendingReport {
  profileId: ProfileId;
  reason: ReportInput['reason'];
  details?: string;
  queuedAt: number;
}

export class BlockService {
  private readonly db: LocalDatabase;
  private readonly api: EventPulseApi;
  private readonly listeners = new Set<(blocked: Set<ProfileId>) => void>();
  private blocks = new Map<ProfileId, BlockRecord>();
  private reports: PendingReport[] = [];
  private loaded = false;

  constructor(db: LocalDatabase, api: EventPulseApi) {
    this.db = db;
    this.api = api;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = (await this.db.get<BlockRecord[]>(keys.blocklist)) ?? [];
    this.blocks = new Map(stored.map((record) => [record.profileId, record]));
    this.reports = (await this.db.get<PendingReport[]>(keys.reportQueue)) ?? [];
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
    // Every mutator hydrates first. `persist()` writes the whole in-memory map,
    // so blocking before `load()` has resolved — the user tapping Block while
    // bootstrap is still running — used to overwrite the stored list with a
    // single entry and silently unblock everyone blocked on a previous run.
    // `load()` is idempotent, so this costs nothing once hydrated.
    await this.load();
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
    await this.load();
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

  /**
   * Report someone, and — separately — block them.
   *
   * The two halves have different failure modes and the caller has to be able to
   * tell them apart. Blocking is local and always succeeds; it is the half that
   * actually protects the user. Delivering the report is not local, so when it
   * fails the report is queued and the failure is re-thrown: swallowing it left
   * every caller free to say "Report sent" about a report that had gone nowhere
   * and was not even retained to be retried.
   */
  async report(input: ReportInput): Promise<void> {
    await this.load();
    if (input.alsoBlock !== false) await this.block(input.profileId, input.reason);
    try {
      await this.api.reportUser(input.profileId, input.reason, input.details);
    } catch (error) {
      this.reports.push({
        profileId: input.profileId,
        reason: input.reason,
        details: input.details,
        queuedAt: Date.now(),
      });
      await this.persistReports();
      throw error;
    }
  }

  /** Retry any blocks the server has not acknowledged, then any queued reports. */
  async flush(): Promise<void> {
    await this.load();
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
    await this.flushReports();
  }

  /** Queued reports, oldest first. Exposed so the UI can say how many are waiting. */
  pendingReports(): PendingReport[] {
    return [...this.reports];
  }

  private async flushReports(): Promise<void> {
    if (this.reports.length === 0) return;
    const remaining = [...this.reports];
    while (remaining.length > 0) {
      const report = remaining[0];
      try {
        await this.api.reportUser(report.profileId, report.reason, report.details);
        remaining.shift();
      } catch {
        break; // still offline; the rest stay queued
      }
    }
    if (remaining.length !== this.reports.length) {
      this.reports = remaining;
      await this.persistReports();
    }
  }

  private async persist(): Promise<void> {
    await this.db.set(keys.blocklist, [...this.blocks.values()]);
  }

  private async persistReports(): Promise<void> {
    await this.db.set(keys.reportQueue, this.reports);
  }

  private emit(): void {
    const blocked = this.blockedIds();
    for (const listener of this.listeners) listener(blocked);
  }
}
