/**
 * ProfileCache — local persistence for the user's own profile and settings.
 *
 * Separate from `EventCache` because these outlive any single event: the user
 * edits their profile once and carries it to the next conference.
 */

import type { Availability, EventId, EventProfile, PrivacySettings, Profile } from '../types';
import { LocalDatabase, keys } from '../storage/LocalDatabase';
import { DEFAULT_PRIVACY } from '../security/PrivacyService';

export class ProfileCache {
  private readonly db: LocalDatabase;

  constructor(db: LocalDatabase) {
    this.db = db;
  }

  async loadProfile(): Promise<Profile | null> {
    return this.db.get<Profile>(keys.userProfile);
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.db.set(keys.userProfile, profile);
  }

  /** Synchronous read for the render path, once `loadProfile` has run. */
  peekProfile(): Profile | null {
    return this.db.peek<Profile>(keys.userProfile);
  }

  /**
   * Appearance preference. Kept beside the profile rather than in the event
   * cache: it must survive leaving an event, and it is not event-scoped.
   */
  async loadThemePreference(): Promise<'system' | 'light' | 'dark'> {
    return (await this.db.get<'system' | 'light' | 'dark'>(keys.themePreference)) ?? 'system';
  }

  async saveThemePreference(preference: 'system' | 'light' | 'dark'): Promise<void> {
    await this.db.set(keys.themePreference, preference);
  }

  async loadPrivacy(): Promise<PrivacySettings> {
    return (await this.db.get<PrivacySettings>(keys.privacySettings)) ?? { ...DEFAULT_PRIVACY };
  }

  async savePrivacy(settings: PrivacySettings): Promise<void> {
    await this.db.set(keys.privacySettings, settings);
  }

  async loadEventProfile(eventId: EventId): Promise<EventProfile | null> {
    return this.db.get<EventProfile>(`event:${eventId}:me`);
  }

  async saveEventProfile(eventProfile: EventProfile): Promise<void> {
    await this.db.set(`event:${eventProfile.eventId}:me`, eventProfile);
  }

  async setAvailability(eventId: EventId, availability: Availability): Promise<EventProfile> {
    const existing = (await this.loadEventProfile(eventId)) ?? {
      eventId,
      profileId: 'me',
      availability,
    };
    const next: EventProfile = { ...existing, availability };
    await this.saveEventProfile(next);
    return next;
  }
}
