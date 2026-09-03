/**
 * PrivacyService — what leaves this device, and what a stranger gets to see.
 *
 * Two distinct jobs, both here because they share one settings object:
 *
 *  1. **Outbound.** Decide whether we advertise at all, and what the 8-byte
 *     display tag contains. Nothing sensitive ever enters a BLE frame.
 *
 *  2. **Presentation.** Apply per-field visibility so the profile card shows a
 *     connection more than it shows a stranger, and so Edit Profile can render
 *     an honest "this is what others see" preview.
 *
 * A note on trust boundaries: field redaction *for other people's profiles* is
 * enforced by the server, which only ever sends fields the viewer is entitled
 * to. The client-side pass here is defence in depth and preview, not the
 * mechanism. A client-only privacy control is a privacy theatre control.
 */

import type {
  Availability,
  FieldVisibility,
  PresenceStatus,
  PrivacySettings,
  Profile,
  ProfileField,
  Visibility,
} from '../types';
import { MAX_DISPLAY_TAG_BYTES } from '../bluetooth/BleProtocol';
import { utf8TruncateBytes, utf8Decode } from '../utils/bytes';

export const DEFAULT_PRIVACY: PrivacySettings = {
  visibility: 'visible',
  fields: {
    // Sensible defaults: professional context is public, personal notes are not.
    bio: 'public',
    links: 'connections',
    currentProject: 'connections',
  },
  broadcastDisplayName: true,
  allowConnectionRequests: true,
  discoverable: true,
};

export type Viewer = 'self' | 'connection' | 'attendee';

export function fieldVisibility(
  settings: PrivacySettings,
  field: ProfileField,
): FieldVisibility {
  return settings.fields[field] ?? 'public';
}

export function canSee(
  settings: PrivacySettings,
  field: ProfileField,
  viewer: Viewer,
): boolean {
  if (viewer === 'self') return true;
  const visibility = fieldVisibility(settings, field);
  if (visibility === 'private') return false;
  if (visibility === 'connections') return viewer === 'connection';
  return true;
}

/** The profile as a given viewer would see it. Used for the live preview. */
export function redactProfile(
  profile: Profile,
  settings: PrivacySettings,
  viewer: Viewer,
): Profile {
  if (viewer === 'self') return profile;

  const redacted: Profile = { ...profile };
  const drop = (field: ProfileField, apply: () => void) => {
    if (!canSee(settings, field, viewer)) apply();
  };

  drop('company', () => {
    redacted.company = undefined;
  });
  drop('role', () => {
    redacted.role = undefined;
  });
  drop('experienceYears', () => {
    redacted.experienceYears = undefined;
  });
  drop('skills', () => {
    redacted.skills = [];
  });
  drop('interests', () => {
    redacted.interests = [];
  });
  drop('bio', () => {
    redacted.bio = undefined;
  });
  drop('links', () => {
    redacted.links = undefined;
  });
  drop('pronouns', () => {
    redacted.pronouns = undefined;
  });

  return redacted;
}

/* ------------------------------------------------------------------ *
 * Outbound presence
 * ------------------------------------------------------------------ */

/** Invisible people do not advertise. Full stop. */
export function shouldAdvertise(settings: PrivacySettings, availability: Availability): boolean {
  if (settings.visibility === 'invisible') return false;
  if (availability === 'invisible') return false;
  return true;
}

export function presenceStatusFor(availability: Availability): PresenceStatus {
  switch (availability) {
    case 'busy':
      return 'busy';
    case 'maybe':
      return 'maybe';
    default:
      return 'available';
  }
}

/**
 * The 8-byte display tag.
 *
 * This is a *hint* so a peer can render something human before the directory
 * resolves — a first name, at most. Never a surname, never a company, never
 * anything that identifies someone across events. When the user opts out of
 * broadcasting a name we send nothing and the peer shows a neutral placeholder
 * until the cache resolves them, which is usually instant anyway.
 */
export function displayTagFor(profile: Profile, settings: PrivacySettings): string {
  if (!settings.broadcastDisplayName) return '';
  const firstName = profile.name.trim().split(/\s+/)[0] ?? '';
  return utf8Decode(utf8TruncateBytes(firstName, MAX_DISPLAY_TAG_BYTES));
}

/* ------------------------------------------------------------------ *
 * Visibility choices shown in the UI
 * ------------------------------------------------------------------ */

export interface VisibilityOption {
  value: Visibility;
  label: string;
  description: string;
}

export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  {
    value: 'visible',
    label: 'Visible',
    description: 'Attendees nearby can see you on the map and open your profile.',
  },
  {
    value: 'connections_only',
    label: 'Connections only',
    description: 'Only people you have already connected with can see you.',
  },
  {
    value: 'invisible',
    label: 'Invisible',
    description: 'You stop broadcasting entirely. You can still see everyone else.',
  },
];

export interface AvailabilityOption {
  value: Availability;
  label: string;
  hint: string;
}

export const AVAILABILITY_OPTIONS: readonly AvailabilityOption[] = [
  { value: 'available', label: 'Available', hint: 'Open to being approached' },
  { value: 'maybe', label: 'Maybe', hint: 'Happy to chat, but busy-ish' },
  { value: 'busy', label: 'Busy', hint: 'Visible, but would rather not be interrupted' },
  { value: 'invisible', label: 'Invisible', hint: 'Hidden from the map entirely' },
];

/**
 * Plain-language summary of the current privacy posture. Shown on the join
 * screen and the profile tab, because "who can see me" should never require
 * opening a settings screen to answer.
 */
export function describePrivacy(settings: PrivacySettings, availability: Availability): string {
  if (!shouldAdvertise(settings, availability)) {
    return 'You are invisible. Nobody nearby can see you.';
  }
  if (settings.visibility === 'connections_only') {
    return 'Only your connections can see you on the map.';
  }
  if (availability === 'busy') {
    return 'Attendees nearby can see you, marked as busy.';
  }
  return 'Attendees nearby can see your name, role and company.';
}
