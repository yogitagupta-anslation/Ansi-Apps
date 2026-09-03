/**
 * Application state, split by update frequency.
 *
 * `presenceStore` is written several times a second while the map is open.
 * `sessionStore` changes when a person does something. Keeping them apart means
 * a Discover list or a profile sheet never re-renders because someone across
 * the hall took a step.
 */

import type {
  NetworkingGoal,
  Availability,
  Connection,
  EventDetail,
  EventSummary,
  MapOrientation,
  PeerId,
  PeopleFilter,
  PrivacySettings,
  Profile,
  ProfileId,
  Visibility,
} from '../types';
import type { SyncStatus } from '../event/EventService';
import type { SavedPerson } from '../connections/SavedPeopleService';
import type { PresenceModel } from '../presence/PresenceController';
import type { ZoomLevel } from '../positioning/Clustering';
import type { BlePermissionState } from '../bluetooth/BleTransport';
import { createStore } from './store';

/* ------------------------------------------------------------------ *
 * Presence
 * ------------------------------------------------------------------ */

export const emptyPresence: PresenceModel = {
  people: [],
  distances: new Map(),
  scanner: null,
  advertiser: null,
  heading: { heading: 0, quality: 'unavailable', magnetometerTrust: 0, updatedAt: 0 },
  navigation: null,
  updatedAt: 0,
};

export const presenceStore = createStore<PresenceModel>(emptyPresence);

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

/**
 * The spine from the flow document: card → event → visibility → permission
 * → map. `onboarding` is the first of those, and it is only ever seen once.
 */
export type BootPhase = 'loading' | 'onboarding' | 'no_event' | 'in_event';

export interface SessionState {
  boot: BootPhase;

  profile: Profile | null;
  privacy: PrivacySettings | null;
  availability: Availability;

  events: EventSummary[];
  eventsFromCache: boolean;
  event: EventDetail | null;
  visibility: Visibility;
  sync: SyncStatus | null;

  connections: Connection[];
  blockedProfileIds: ReadonlySet<ProfileId>;

  /** Map view state. */
  orientation: MapOrientation;
  /** Ground layer under the radar: the plain canvas, or venue satellite imagery. */
  basemap: 'plain' | 'satellite';
  /** The user's networking goals for the current event. */
  goals: NetworkingGoal[];
  /** People bookmarked for later, and the private notes attached to them. */
  saved: SavedPerson[];
  /** Distinct profile cards opened at this event. */
  cardsOpened: number;
  zoom: ZoomLevel;
  mapFilter: PeopleFilter;
  selectedPeerId: PeerId | null;
  expandedClusterId: string | null;
  /** Quick search on the map; highlights matches rather than removing others. */
  mapQuery: string;
  /**
   * The zone the user says they are standing in.
   *
   * This is a *manual* anchor, and it is the only honest way to draw the venue's
   * zones around you: BLE tells us who is near, never where we are. Until the
   * user picks one, the zone layer stays off rather than guessing.
   */
  currentZoneId: string | null;

  /** Discover view state. */
  discoverFilter: PeopleFilter;

  /** 'system' | 'light' | 'dark'. Persisted; see ProfileCache. */
  themePreference: 'system' | 'light' | 'dark';

  permission: BlePermissionState;
  /** Set when the user has been shown the permission rationale. */
  permissionExplained: boolean;

  /** Transient one-line message shown as a toast. */
  toast: { id: number; text: string; tone: 'neutral' | 'success' | 'error' } | null;
}

export const initialSession: SessionState = {
  boot: 'loading',

  profile: null,
  privacy: null,
  availability: 'available',

  events: [],
  eventsFromCache: false,
  event: null,
  visibility: 'visible',
  sync: null,

  connections: [],
  blockedProfileIds: new Set(),

  orientation: 'heading_up',
  // Off by default. The radar is the honest view and costs no network; imagery
  // is an opt-in that pulls tiles over whatever connection a conference hall
  // has, which is usually a bad one.
  basemap: 'plain',
  goals: [],
  saved: [],
  cardsOpened: 0,
  zoom: 'hall',
  mapFilter: {},
  selectedPeerId: null,
  expandedClusterId: null,
  mapQuery: '',
  currentZoneId: null,

  discoverFilter: {},

  themePreference: 'system',

  permission: 'undetermined',
  permissionExplained: false,

  toast: null,
};

export const sessionStore = createStore<SessionState>(initialSession);

let toastCounter = 0;

export function showToast(
  text: string,
  tone: 'neutral' | 'success' | 'error' = 'neutral',
): void {
  sessionStore.setState({ toast: { id: ++toastCounter, text, tone } });
}

export function dismissToast(id: number): void {
  const current = sessionStore.getState().toast;
  if (current?.id === id) sessionStore.setState({ toast: null });
}

/* ------------------------------------------------------------------ *
 * Selectors
 * ------------------------------------------------------------------ */

export const selectPeople = (state: PresenceModel) => state.people;
export const selectNavigation = (state: PresenceModel) => state.navigation;
export const selectHeading = (state: PresenceModel) => state.heading.heading;
export const selectHeadingQuality = (state: PresenceModel) => state.heading.quality;
export const selectScannerState = (state: PresenceModel) => state.scanner?.state ?? 'idle';
export const selectDistances = (state: PresenceModel) => state.distances;
export const selectPeerCount = (state: PresenceModel) => state.people.length;

export const selectEvent = (state: SessionState) => state.event;
export const selectProfile = (state: SessionState) => state.profile;
export const selectSelectedPeerId = (state: SessionState) => state.selectedPeerId;
export const selectMapFilter = (state: SessionState) => state.mapFilter;
export const selectZoom = (state: SessionState) => state.zoom;
export const selectOrientation = (state: SessionState) => state.orientation;
export const selectConnections = (state: SessionState) => state.connections;
export const selectSync = (state: SessionState) => state.sync;
export const selectCurrentZoneId = (state: SessionState) => state.currentZoneId;
export const selectMapQuery = (state: SessionState) => state.mapQuery;

/** True when at least one filter narrows the map. */
export function isFilterActive(filter: PeopleFilter): boolean {
  return Boolean(
    filter.query ||
      filter.categories?.length ||
      filter.companies?.length ||
      filter.skills?.length ||
      filter.interests?.length ||
      filter.availableOnly ||
      filter.minExperience !== undefined ||
      filter.maxExperience !== undefined ||
      filter.lookingFor?.length,
  );
}

export function describeFilter(filter: PeopleFilter): string {
  const parts: string[] = [];
  if (filter.categories?.length) parts.push(filter.categories.join(', '));
  if (filter.companies?.length) parts.push(filter.companies.join(', '));
  if (filter.skills?.length) parts.push(filter.skills.join(', '));
  if (filter.availableOnly) parts.push('available now');
  if (filter.minExperience !== undefined) parts.push(`${filter.minExperience}+ yrs`);
  return parts.join(' · ');
}
