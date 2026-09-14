/**
 * ProfileService — the user's own identity, and how changes propagate.
 *
 * Editing a profile has to work offline and has to reach nearby phones without
 * anyone pairing with anyone. The mechanism (§58):
 *
 *   edit -> version++ -> saved locally (source of truth for this device)
 *        -> pushed to the server when reachable
 *        -> the new version number rides along in our BLE frame
 *        -> peers notice version drift and refresh through the normal
 *           directory sync — never through a BLE connection.
 *
 * The version byte is the only part of the profile that touches the radio.
 */

import type {
  Availability,
  EventId,
  EventProfile,
  PrivacySettings,
  Profile,
  ProfileId,
} from '../types';
import { ApiError, type EventPulseApi } from '../api/ApiClient';
import { ProfileCache } from './ProfileCache';
import { isPlaceholderProfileId } from './LocalIdentity';
import { fnv1a32 } from '../utils/bytes';

export interface ProfileDraft {
  name: string;
  pronouns?: string;
  role?: string;
  company?: string;
  category: Profile['category'];
  experienceYears?: number;
  industry?: string;
  skills: string[];
  interests: string[];
  bio?: string;
  links?: Profile['links'];
  avatar?: Partial<Profile['avatar']>;
}

export interface ProfileValidation {
  valid: boolean;
  errors: Partial<Record<keyof ProfileDraft, string>>;
}

export const MAX_SKILLS = 12;
export const MAX_INTERESTS = 10;

export function validateDraft(draft: ProfileDraft): ProfileValidation {
  const errors: ProfileValidation['errors'] = {};

  const name = draft.name?.trim() ?? '';
  if (name.length < 2) errors.name = 'Add your name so people can say hello';
  else if (name.length > 60) errors.name = 'That name is a little long for a map bubble';

  if (draft.skills.length > MAX_SKILLS) errors.skills = `Pick your top ${MAX_SKILLS}`;
  if (draft.interests.length > MAX_INTERESTS) errors.interests = `Pick your top ${MAX_INTERESTS}`;
  if (draft.bio && draft.bio.length > 280) errors.bio = 'Keep it under 280 characters';

  if (draft.experienceYears !== undefined) {
    if (draft.experienceYears < 0 || draft.experienceYears > 60) {
      errors.experienceYears = 'That does not look right';
    }
  }

  for (const [key, url] of Object.entries(draft.links ?? {})) {
    if (url && !/^https?:\/\//i.test(url)) {
      errors.links = `${key} needs to start with https://`;
      break;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export interface ProfileServiceOptions {
  cache: ProfileCache;
  api: EventPulseApi;
  onProfileChanged?: (profile: Profile) => void;
  onEventProfileChanged?: (eventProfile: EventProfile) => void;
}

export class ProfileService {
  private readonly cache: ProfileCache;
  private readonly api: EventPulseApi;
  private readonly onProfileChanged?: (profile: Profile) => void;
  private readonly onEventProfileChanged?: (eventProfile: EventProfile) => void;

  private profile: Profile | null = null;
  private privacy: PrivacySettings | null = null;
  private eventProfiles = new Map<EventId, EventProfile>();
  /** Edits made while offline, replayed on reconnect. */
  private pendingPush = false;

  constructor(options: ProfileServiceOptions) {
    this.cache = options.cache;
    this.api = options.api;
    this.onProfileChanged = options.onProfileChanged;
    this.onEventProfileChanged = options.onEventProfileChanged;
  }

  async load(fallback: () => Profile): Promise<Profile> {
    const stored = await this.cache.loadProfile();
    this.profile = stored ?? fallback();
    if (!stored) await this.cache.saveProfile(this.profile);
    this.privacy = await this.cache.loadPrivacy();
    this.onProfileChanged?.(this.profile);
    return this.profile;
  }

  /**
   * Adopt this install's own identity, replacing a placeholder if one is there.
   *
   * `load` only consults the fallback when nothing is stored, so a phone that
   * has already run the app keeps whatever id it was given on first launch —
   * including the old shared `'me'`. Fixing the default alone would therefore
   * have left every existing install broken. This runs on every boot and is a
   * no-op once the id is real, which is what makes it safe to keep there.
   */
  async adoptIdentity(profileId: ProfileId): Promise<Profile> {
    if (!this.profile) throw new Error('ProfileService.adoptIdentity called before load()');

    // A real id already on the profile is the one peers have connected to.
    // Never trade it for a freshly minted one — that would make the user a
    // stranger to everyone who already knows them.
    if (!isPlaceholderProfileId(this.profile.id)) return this.profile;

    const next: Profile = { ...this.profile, id: profileId, userId: profileId };
    this.profile = next;
    await this.cache.saveProfile(next);
    this.onProfileChanged?.(next);
    return next;
  }

  get current(): Profile | null {
    return this.profile;
  }

  get privacySettings(): PrivacySettings | null {
    return this.privacy;
  }

  /**
   * Apply an edit. The local write is the commit; the network push is
   * best-effort and retried. The version bump is what tells nearby phones that
   * their cached copy of us is stale.
   */
  async update(draft: ProfileDraft): Promise<Profile> {
    if (!this.profile) throw new Error('ProfileService.update called before load()');

    const validation = validateDraft(draft);
    if (!validation.valid) {
      throw new Error(Object.values(validation.errors)[0] ?? 'Invalid profile');
    }

    const name = draft.name.trim();
    const next: Profile = {
      ...this.profile,
      name,
      pronouns: draft.pronouns?.trim() || undefined,
      role: draft.role?.trim() || undefined,
      company: draft.company?.trim() || undefined,
      category: draft.category,
      experienceYears: draft.experienceYears,
      industry: draft.industry?.trim() || undefined,
      skills: dedupe(draft.skills).slice(0, MAX_SKILLS),
      interests: dedupe(draft.interests).slice(0, MAX_INTERESTS),
      bio: draft.bio?.trim() || undefined,
      links: cleanLinks(draft.links),
      avatar: {
        ...this.profile.avatar,
        ...draft.avatar,
        // An explicitly chosen hue wins, then whatever the avatar already had,
        // and only a brand-new avatar falls back to the name hash. Deriving it
        // from the name unconditionally meant editing your surname silently
        // recoloured the face everyone recognises you by.
        hue: draft.avatar?.hue ?? this.profile.avatar.hue ?? fnv1a32(name) % 360,
      },
      version: this.profile.version + 1,
      updatedAt: Date.now(),
    };

    this.profile = next;
    await this.cache.saveProfile(next);
    this.onProfileChanged?.(next);

    await this.push();
    return next;
  }

  async updatePrivacy(patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    const next: PrivacySettings = { ...(this.privacy ?? ({} as PrivacySettings)), ...patch };
    this.privacy = next;
    await this.cache.savePrivacy(next);
    return next;
  }

  /* ---------------------------------------------------------------- *
   * Event-scoped profile
   * ---------------------------------------------------------------- */

  async loadEventProfile(eventId: EventId, profileId: ProfileId = 'me'): Promise<EventProfile> {
    const stored = await this.cache.loadEventProfile(eventId);
    const eventProfile: EventProfile = stored ?? {
      eventId,
      profileId,
      availability: 'available',
    };
    this.eventProfiles.set(eventId, eventProfile);
    this.onEventProfileChanged?.(eventProfile);
    return eventProfile;
  }

  eventProfile(eventId: EventId): EventProfile | null {
    return this.eventProfiles.get(eventId) ?? null;
  }

  /** Availability changes are frequent and must feel instant — local first. */
  async setAvailability(eventId: EventId, availability: Availability): Promise<EventProfile> {
    const next = await this.cache.setAvailability(eventId, availability);
    this.eventProfiles.set(eventId, next);
    this.onEventProfileChanged?.(next);
    try {
      await this.api.updateEventProfile(eventId, { availability });
    } catch {
      // Availability is a presence hint carried over BLE; the local value is
      // already correct for everyone nearby.
    }
    return next;
  }

  async updateEventProfile(
    eventId: EventId,
    patch: Partial<
      Pick<EventProfile, 'whyAttending' | 'lookingToMeet' | 'currentProject' | 'goals' | 'askMeAbout'>
    >,
  ): Promise<EventProfile> {
    const existing = this.eventProfiles.get(eventId) ?? (await this.loadEventProfile(eventId));
    const next: EventProfile = { ...existing, ...patch };
    this.eventProfiles.set(eventId, next);
    await this.cache.saveEventProfile(next);
    this.onEventProfileChanged?.(next);

    // `goals` never leaves the device.
    //
    // It is a ranking input, not a profile field: it says what the user wants
    // from the room, which is a different and more revealing thing than
    // `lookingToMeet`, the version they wrote to be read by others. Uploading
    // it would put "looking for a job" on a server while its owner is standing
    // in a room with their current employer. The matcher runs locally, so
    // nothing needs it anywhere else.
    const { goals: _localOnly, ...shareable } = patch;
    if (Object.keys(shareable).length > 0) {
      try {
        await this.api.updateEventProfile(eventId, shareable as Record<string, unknown>);
      } catch {
        this.pendingPush = true;
      }
    }
    return next;
  }

  /* ---------------------------------------------------------------- *
   * Sync
   * ---------------------------------------------------------------- */

  private async push(): Promise<void> {
    if (!this.profile) return;
    try {
      const saved = await this.api.updateProfile(this.profile);
      // Server may bump the version further; take the higher of the two so the
      // number never goes backwards on the wire.
      if (saved.version > this.profile.version) {
        this.profile = { ...this.profile, version: saved.version };
        await this.cache.saveProfile(this.profile);
        this.onProfileChanged?.(this.profile);
      }
      this.pendingPush = false;
    } catch (error) {
      if (error instanceof ApiError && error.retryable) this.pendingPush = true;
      else throw error;
    }
  }

  /** Called when connectivity returns. */
  async flush(): Promise<void> {
    if (!this.pendingPush) return;
    await this.push();
  }

  get hasPendingChanges(): boolean {
    return this.pendingPush;
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function cleanLinks(links: Profile['links']): Profile['links'] {
  if (!links) return undefined;
  const entries = Object.entries(links).filter(([, value]) => Boolean(value?.trim()));
  return entries.length ? (Object.fromEntries(entries) as Profile['links']) : undefined;
}
