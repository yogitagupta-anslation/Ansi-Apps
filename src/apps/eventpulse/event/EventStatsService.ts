/**
 * EventStatsService — the handful of numbers the recap is allowed to claim.
 *
 * Screen 5.4 of the flow ends the event with "5 saved · 3 follow ups · 41 cards
 * opened". Two of those come out of `SavedPeopleService` for free. The third
 * does not exist anywhere, and this is the smallest honest way to produce it.
 *
 * It counts **distinct people whose card you opened**, not raw opens. Raw opens
 * inflate with every accidental double-tap and with re-reading the same person
 * before walking over, so the bigger number would be the less true one. Distinct
 * profiles answers the question the recap is actually asking: how much of the
 * room did you actually look at.
 *
 * Local only, like everything else on this side of the app. Nobody is told that
 * you read their card — that promise is printed on the privacy screen, and this
 * is the code that has to keep it.
 */

import { LocalDatabase, keys } from '../storage/LocalDatabase';
import type { EventId, ProfileId } from '../types';

export interface EventStats {
  eventId: EventId;
  /** Profile ids whose card has been opened at least once. */
  cardsOpened: ProfileId[];
  firstOpenedAt?: number;
  lastOpenedAt?: number;
}

export class EventStatsService {
  private readonly db: LocalDatabase;
  private readonly onChange?: (stats: EventStats) => void;

  private eventId: EventId | null = null;
  private opened = new Set<ProfileId>();
  private firstOpenedAt: number | undefined;
  private lastOpenedAt: number | undefined;

  constructor(options: { db: LocalDatabase; onChange?: (stats: EventStats) => void }) {
    this.db = options.db;
    this.onChange = options.onChange;
  }

  async load(eventId: EventId): Promise<EventStats> {
    this.eventId = eventId;
    const cached = await this.db.get<EventStats>(keys.eventStats(eventId));
    this.opened = new Set(cached?.cardsOpened ?? []);
    this.firstOpenedAt = cached?.firstOpenedAt;
    this.lastOpenedAt = cached?.lastOpenedAt;
    this.emit();
    return this.snapshot();
  }

  snapshot(): EventStats {
    return {
      eventId: this.eventId ?? '',
      cardsOpened: [...this.opened],
      firstOpenedAt: this.firstOpenedAt,
      lastOpenedAt: this.lastOpenedAt,
    };
  }

  get cardsOpened(): number {
    return this.opened.size;
  }

  /**
   * Record that a profile card was opened.
   *
   * Cheap and idempotent: re-opening the same person is a no-op that does not
   * touch storage, which matters because this is called from a render path that
   * fires whenever a sheet mounts.
   */
  async recordCardOpen(profileId: ProfileId): Promise<void> {
    if (!this.eventId || this.opened.has(profileId)) return;
    this.opened.add(profileId);
    const now = Date.now();
    this.firstOpenedAt ??= now;
    this.lastOpenedAt = now;
    await this.db.set(keys.eventStats(this.eventId), this.snapshot());
    this.emit();
  }

  /** Called when the user leaves an event and its data is cleared. */
  async clear(eventId: EventId): Promise<void> {
    await this.db.remove(keys.eventStats(eventId));
    if (this.eventId === eventId) {
      this.opened = new Set();
      this.firstOpenedAt = undefined;
      this.lastOpenedAt = undefined;
      this.emit();
    }
  }

  private emit(): void {
    this.onChange?.(this.snapshot());
  }
}
