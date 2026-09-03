/**
 * SavedPeopleService — "I want to talk to them, but not now."
 *
 * The gap this fills is the most ordinary thing at an event: the person you
 * want is mid-conversation, twelve metres away, or not in the building yet.
 * Without somewhere to put them you either interrupt, or you forget. A saved
 * person is a private intention, and the app's job is to bring them back at the
 * moment they become reachable.
 *
 * Three rules, all of them consequences of that:
 *
 *  - **It never leaves the device.** A save says "I want something from you",
 *    which is a thing the other person has not agreed to hear. There is no
 *    endpoint, no outbox, no sync — unlike `ConnectionService`, which
 *    deliberately does have all three because a connection is mutual.
 *  - **The other person is never told.** Nothing observable changes for them.
 *  - **Notes live here too.** Written straight after a conversation, while it is
 *    still in your head, and readable months later when the name alone means
 *    nothing.
 */

import { LocalDatabase, keys } from '../storage/LocalDatabase';
import type { EventId, ProfileId } from '../types';

/** Short, closed vocabulary — enough to sort a list, small enough to tap once. */
export type SavedTag = 'follow_up' | 'intro_promised' | 'hiring';

export const SAVED_TAGS: { value: SavedTag; label: string }[] = [
  { value: 'follow_up', label: 'Follow up' },
  { value: 'intro_promised', label: 'Intro promised' },
  { value: 'hiring', label: 'Hiring' },
];

export interface SavedPerson {
  profileId: ProfileId;
  eventId: EventId;
  savedAt: number;
  /** Free text, written by the user, never transmitted. */
  note?: string;
  tags?: SavedTag[];
  /**
   * Where and when you actually met, captured at save time.
   *
   * Stored as the zone name the user had already anchored themselves to — not
   * derived from any signal. "Main Stage" is a thing the user told us; it is not
   * a position we worked out, and the distinction is the same one the whole
   * positioning model turns on.
   */
  metAtZone?: string;
  /** True once the person has actually been met, rather than only bookmarked. */
  met?: boolean;
}

export interface SavedPeopleOptions {
  db: LocalDatabase;
  onChange?: (saved: SavedPerson[]) => void;
}

export class SavedPeopleService {
  private readonly db: LocalDatabase;
  private readonly onChange?: (saved: SavedPerson[]) => void;

  private saved = new Map<ProfileId, SavedPerson>();
  private eventId: EventId | null = null;

  constructor(options: SavedPeopleOptions) {
    this.db = options.db;
    this.onChange = options.onChange;
  }

  async load(eventId: EventId): Promise<SavedPerson[]> {
    this.eventId = eventId;
    const cached = (await this.db.get<SavedPerson[]>(keys.savedPeople(eventId))) ?? [];
    this.saved = new Map(cached.map((person) => [person.profileId, person]));
    this.emit();
    return this.list();
  }

  /** Newest first: at an event, the person you just met is the one you mean. */
  list(): SavedPerson[] {
    return [...this.saved.values()].sort((a, b) => b.savedAt - a.savedAt);
  }

  get(profileId: ProfileId): SavedPerson | undefined {
    return this.saved.get(profileId);
  }

  has(profileId: ProfileId): boolean {
    return this.saved.has(profileId);
  }

  savedProfileIds(): ReadonlySet<ProfileId> {
    return new Set(this.saved.keys());
  }

  /**
   * Save, or update an existing save.
   *
   * `savedAt` is preserved across edits so adding a note later does not shuffle
   * the list under the user — "when I met them" is the useful ordering, not
   * "when I last typed".
   */
  async save(
    profileId: ProfileId,
    patch: Omit<Partial<SavedPerson>, 'profileId' | 'eventId' | 'savedAt'> = {},
  ): Promise<SavedPerson | null> {
    if (!this.eventId) return null;
    const existing = this.saved.get(profileId);
    const next: SavedPerson = {
      profileId,
      eventId: this.eventId,
      savedAt: existing?.savedAt ?? Date.now(),
      ...existing,
      ...patch,
    };
    this.saved.set(profileId, next);
    await this.persist();
    return next;
  }

  async remove(profileId: ProfileId): Promise<void> {
    if (!this.saved.delete(profileId)) return;
    await this.persist();
  }

  /** Save if absent, unsave if present. Returns the state afterwards. */
  async toggle(profileId: ProfileId): Promise<boolean> {
    if (this.saved.has(profileId)) {
      await this.remove(profileId);
      return false;
    }
    await this.save(profileId);
    return true;
  }

  /**
   * People saved but not yet met — the ones worth nudging about when they come
   * into range. Someone already met is a record, not an errand.
   */
  pending(): SavedPerson[] {
    return this.list().filter((person) => !person.met);
  }

  private async persist(): Promise<void> {
    if (!this.eventId) return;
    await this.db.set(keys.savedPeople(this.eventId), this.list());
    this.emit();
  }

  private emit(): void {
    this.onChange?.(this.list());
  }
}
