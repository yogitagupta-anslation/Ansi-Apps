/**
 * Composition root.
 *
 * Every dependency is constructed once, here, and wired to the stores. Screens
 * import *actions*, never services — so a screen cannot accidentally reach into
 * the BLE stack, and the whole graph can be swapped for tests or for the demo
 * build by changing `config`.
 */

import { AppState, Share, type AppStateStatus } from 'react-native';
import * as Battery from 'expo-battery';

import { HttpApiClient, type EventPulseApi } from '../api/ApiClient';
import { MockApi } from '../api/MockApi';
import type { BleTransport } from '../bluetooth/BleTransport';
import { NativeBleTransport, isNativeBleAvailable } from '../bluetooth/transports/NativeBleTransport';
import { SimulatedBleTransport, type SimulatedPeerSpec } from '../bluetooth/transports/SimulatedBleTransport';
import { ConnectionService } from '../connections/ConnectionService';
import { SavedPeopleService, type SavedTag } from '../connections/SavedPeopleService';
import { EventStatsService } from '../event/EventStatsService';
import { EventCache } from '../event/EventCache';
import { EventService } from '../event/EventService';
import { PresenceController } from '../presence/PresenceController';
import { ProfileCache } from '../profile/ProfileCache';
import { ProfileService, type ProfileDraft } from '../profile/ProfileService';
import { BlockService, type ReportInput } from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import { AsyncStorageAdapter } from '../storage/AsyncStorageAdapter';
import { defaultUserProfile } from '../dev/seed';
import type {
  Attendee,
  Availability,
  NetworkingGoal,
  EventDetail,
  EventId,
  PeerId,
  PeopleFilter,
  PrivacySettings,
  Profile,
  ProfileId,
  ProximityBand,
  Visibility,
} from '../types';
import { matchBreakdown, recommend, type ScoredMatch } from '../recommendations/MatchEngine';
import { conversationStarter } from '../recommendations/ConversationStarter';
import { presenceStore, sessionStore, showToast, emptyPresence } from '../state/stores';
import type { ZoomLevel } from '../positioning/Clustering';
import { config } from './config';

/* ------------------------------------------------------------------ *
 * Graph
 * ------------------------------------------------------------------ */

function createApi(): EventPulseApi {
  if (config.api === 'http') {
    return new HttpApiClient({
      baseUrl: config.apiBaseUrl,
      // Replace with your auth store's accessor. The backend fails closed, so
      // returning null here means every request comes back 401.
      getAuthToken: () => config.authToken,
    });
  }
  return new MockApi({ attendeesPerEvent: config.simulatedCrowdSize });
}

function createStorage() {
  try {
    return new AsyncStorageAdapter();
  } catch {
    // A store that cannot open must not take the map down; we lose offline
    // persistence for this session and say so, rather than crashing on launch.
    showToast('Local storage is unavailable — offline mode is limited', 'error');
    return new MemoryStorageAdapter();
  }
}

const api = createApi();
const db = new LocalDatabase(createStorage());
const eventCache = new EventCache(db);
const profileCache = new ProfileCache(db);

export const blockService = new BlockService(db, api);

export const profileService = new ProfileService({
  cache: profileCache,
  api,
  onProfileChanged: (profile) => {
    sessionStore.setState({ profile });
    void presence.refreshAdvertisement();
  },
  onEventProfileChanged: (eventProfile) => {
    // Goals are mirrored into the store here rather than only on save, so a
    // profile loaded from the cache on relaunch arrives with them already set —
    // otherwise the map would ask "what brings you here?" every cold start.
    sessionStore.setState({
      availability: eventProfile.availability,
      goals: eventProfile.goals ?? [],
    });
    void presence.refreshAdvertisement();
  },
});

export const eventService = new EventService({
  api,
  cache: eventCache,
  onDirectoryChanged: (directory) => {
    directory.setBlocked(sessionStore.getState().blockedProfileIds);
    directory.setConnections(connectionService.connectedProfileIds());
    presence.refreshFromDirectory();
  },
  onSyncStatus: (sync) => sessionStore.setState({ sync }),
});

export const connectionService = new ConnectionService({
  db,
  api,
  onChange: (connections) => {
    sessionStore.setState({ connections });
    eventService.directory?.setConnections(connectionService.connectedProfileIds());
  },
});

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

let transport: BleTransport | null = null;

/**
 * Build the crowd for the simulated transport from the same generated attendee
 * set the mock directory serves, so a peer the radio reports is always a peer
 * the directory can resolve.
 *
 * Peer ids rotate, so the crowd is rebuilt on every join rather than cached.
 */
function simulatedPeers(event: EventDetail): SimulatedPeerSpec[] {
  if (!(api instanceof MockApi)) return [];
  return api.attendeesFor(event.id).map((attendee) => ({
    peerId: api.currentPeerIdFor(event.id, attendee.profile.id),
    avatarId: attendee.profile.avatar.avatarId,
    displayTag: attendee.profile.name.split(' ')[0],
    profileVersion: attendee.profile.version & 0xff,
    status:
      attendee.eventProfile.availability === 'busy'
        ? 'busy'
        : attendee.eventProfile.availability === 'maybe'
          ? 'maybe'
          : 'available',
    x: attendee.x,
    y: attendee.y,
    speed: attendee.speed,
    roams: attendee.speed > 0.7,
  }));
}

function createTransport(event: EventDetail): BleTransport {
  if (config.ble === 'native' && isNativeBleAvailable()) {
    return new NativeBleTransport();
  }
  if (config.ble === 'native') {
    showToast('Bluetooth module missing — running the crowd simulator', 'error');
  }
  return new SimulatedBleTransport({
    eventCode: event.bleEventCode,
    peers: simulatedPeers(event),
  });
}

/**
 * How much of the room you actually looked at. Local only; see the service.
 */
export const eventStats = new EventStatsService({
  db,
  onChange: (stats) => sessionStore.setState({ cardsOpened: stats.cardsOpened.length }),
});

/**
 * Saved people. Local only — there is no API surface to hand it, by design.
 */
export const savedPeople = new SavedPeopleService({
  db,
  onChange: (saved) => sessionStore.setState({ saved }),
});

export const presence = new PresenceController({
  // Replaced with the real transport on join; a null transport would force
  // every call site into a null check for no benefit.
  transport: new SimulatedBleTransport({ eventCode: 0, peers: [] }),
  eventService,
  profileService,
  onModel: (model) => presenceStore.reset(model),
});

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export const actions = {
  async bootstrap(): Promise<void> {
    await db.open();
    await blockService.load();
    blockService.subscribe((blocked) => {
      sessionStore.setState({ blockedProfileIds: blocked });
      eventService.directory?.setBlocked(blocked);
      presence.applyBlocklist();
    });

    const profile = await profileService.load(defaultUserProfile);
    const privacy = await profileCache.loadPrivacy();
    // Read before the first paint so the app never flashes the wrong theme.
    const themePreference = await profileCache.loadThemePreference();
    sessionStore.setState({ profile, privacy, themePreference });

    /**
     * First run stops here.
     *
     * The design opens on "make your card" precisely because everything after
     * it — joining, broadcasting, being visible — depends on there being a card
     * worth showing. Resuming an event skips it, because anyone already in a
     * room has plainly been through this once.
     */
    const onboarded = (await db.get<boolean>(keys.onboarded)) ?? false;
    if (!onboarded) {
      sessionStore.setState({ boot: 'onboarding' });
      return;
    }

    const resumed = await eventService.resume().catch(() => null);
    if (resumed) {
      await enterEvent(resumed.event, resumed.membership.visibility);
      return;
    }

    const { events, fromCache } = await eventService
      .listEvents()
      .catch(() => ({ events: [], fromCache: true }));
    sessionStore.setState({ boot: 'no_event', events, eventsFromCache: fromCache });
  },

  /** Pull-to-refresh on Discover: re-pull the attendee directory. */
  async refreshDirectory(): Promise<void> {
    await eventService.syncDirectory();
    await eventService.refreshStaleProfiles();
  },

  /** Pull-to-refresh on Connections. */
  async refreshConnections(): Promise<void> {
    await connectionService.refresh();
    await connectionService.flush();
  },

  async refreshEvents(query?: string): Promise<void> {
    const { events, fromCache } = await eventService.listEvents(query);
    sessionStore.setState({ events, eventsFromCache: fromCache });
  },

  async joinEvent(eventId: EventId, visibility: Visibility): Promise<void> {
    const outcome = await eventService.join(eventId, visibility);
    await enterEvent(outcome.event, visibility);
    if (outcome.offline) {
      showToast('Joined from your cached copy — you are offline', 'neutral');
    }
  },

  async leaveEvent(): Promise<void> {
    const event = sessionStore.getState().event;
    await presence.stop();
    presenceStore.reset(emptyPresence);
    if (event) await eventService.leave(event.id);
    sessionStore.setState({
      boot: 'no_event',
      event: null,
      sync: null,
      selectedPeerId: null,
      connections: [],
      mapFilter: {},
    });
  },

  /* -------------------- map interaction -------------------- */

  selectPerson(peerId: PeerId | null): void {
    sessionStore.setState({ selectedPeerId: peerId, expandedClusterId: null });
  },

  expandCluster(clusterId: string | null): void {
    sessionStore.setState({ expandedClusterId: clusterId });
  },

  setZoom(zoom: ZoomLevel): void {
    sessionStore.setState({ zoom });
  },

  toggleOrientation(): void {
    const current = sessionStore.getState().orientation;
    sessionStore.setState({ orientation: current === 'heading_up' ? 'north_up' : 'heading_up' });
  },

  toggleBasemap(): void {
    const current = sessionStore.getState().basemap;
    sessionStore.setState({ basemap: current === 'satellite' ? 'plain' : 'satellite' });
  },

  setMapFilter(mapFilter: PeopleFilter): void {
    sessionStore.setState({ mapFilter });
  },

  setMapQuery(mapQuery: string): void {
    sessionStore.setState({ mapQuery });
  },

  /** Appearance: follow the OS, or pin light/dark. Persists across launches. */
  async setThemePreference(themePreference: 'system' | 'light' | 'dark'): Promise<void> {
    sessionStore.setState({ themePreference });
    await profileCache.saveThemePreference(themePreference);
  },

  /**
   * Record which zone the user is standing in. This is what lets the map draw
   * the venue's other zones in the right direction — see `currentZoneId`.
   */
  setCurrentZone(currentZoneId: string | null): void {
    sessionStore.setState({ currentZoneId });
  },

  setDiscoverFilter(discoverFilter: PeopleFilter): void {
    sessionStore.setState({ discoverFilter });
  },

  /* -------------------- navigation -------------------- */

  startNavigation(peerId: PeerId): void {
    presence.startNavigation(peerId);
    sessionStore.setState({ selectedPeerId: null });
  },

  stopNavigation(): void {
    presence.stopNavigation();
  },

  /* -------------------- presence -------------------- */

  async setAvailability(availability: Availability): Promise<void> {
    const event = sessionStore.getState().event;
    if (!event) return;
    await profileService.setAvailability(event.id, availability);
    await presence.refreshAdvertisement();
  },

  /**
   * Set the user's goals for this event.
   *
   * Kept alongside availability rather than in the main profile because goals
   * are per-event by nature: the same person is job-hunting at a careers fair
   * and hiring at a conference three weeks later.
   */
  /**
   * Finish the first-run card: save the profile, remember the goals for the
   * first event joined, and move on to the event list.
   */
  async completeOnboarding(input: {
    name: string;
    role?: string;
    company?: string;
    askMeAbout?: string[];
    avatar?: Profile['avatar'];
    goals: NetworkingGoal[];
  }): Promise<void> {
    // A draft is the whole profile, not a patch, so the untouched fields come
    // from what is already stored rather than being blanked.
    const current = profileService.current;
    await profileService.update({
      name: input.name,
      role: input.role,
      company: input.company,
      avatar: input.avatar,
      category: current?.category ?? 'engineer',
      skills: current?.skills ?? [],
      interests: current?.interests ?? [],
      pronouns: current?.pronouns,
      experienceYears: current?.experienceYears,
      industry: current?.industry,
      bio: current?.bio,
      links: current?.links,
    });
    // Goals and the hook are per-event, and there is no event yet — so they are
    // parked here and applied by `enterEvent` on the first join.
    pendingEventProfile = { goals: input.goals, askMeAbout: input.askMeAbout };
    await db.set(keys.onboarded, true);
    sessionStore.setState({ profile: profileService.current, goals: input.goals });

    // `refreshEvents` only refreshes the list — advancing the boot phase is this
    // action's job, and forgetting it left the user stuck on a Continue button
    // that silently did nothing.
    const { events, fromCache } = await eventService
      .listEvents()
      .catch(() => ({ events: [], fromCache: true }));
    sessionStore.setState({ boot: 'no_event', events, eventsFromCache: fromCache });
  },

  async setGoals(goals: NetworkingGoal[]): Promise<void> {
    const event = sessionStore.getState().event;
    if (!event) return;
    await profileService.updateEventProfile(event.id, { goals });
    sessionStore.setState({ goals });
  },

  /**
   * Hand the user's own notes back to them as text, through the system share
   * sheet.
   *
   * Nothing is uploaded and no destination is chosen here: the OS sheet is the
   * user picking where their notes go. That is the only reason this is allowed
   * to exist in an app whose whole promise is that notes never leave the phone
   * — the user exporting their own data is not the app transmitting it.
   */
  async exportSaved(): Promise<void> {
    const state = sessionStore.getState();
    const people = savedPeople.list();
    if (people.length === 0) return;

    const lines = people.map((person) => {
      const attendee = eventService.directory?.getAttendee(person.profileId);
      const who = attendee
        ? [attendee.profile.name, attendee.profile.role, attendee.profile.company]
            .filter(Boolean)
            .join(' · ')
        : 'Someone you met';
      const note = person.note ? `\n    ${person.note}` : '';
      const where = person.metAtZone ? ` (${person.metAtZone})` : '';
      return `• ${who}${where}${note}`;
    });

    await Share.share({
      title: `${state.event?.name ?? 'Event'} — people I met`,
      message: [`${state.event?.name ?? 'Event'} — people I met`, '', ...lines].join('\n'),
    });
  },

  /** Note that a profile card was opened. Idempotent per person. */
  recordCardOpen(profileId: ProfileId): void {
    void eventStats.recordCardOpen(profileId);
  },

  /** Bookmark someone for later, or clear the bookmark. Nothing is sent. */
  async toggleSaved(profileId: ProfileId): Promise<boolean> {
    // Haptics live in the screens, not here: this module is the composition
    // root and stays free of presentation concerns.
    return savedPeople.toggle(profileId);
  },

  /** Record a conversation: note, tags, and where it happened. */
  async saveWithNote(
    profileId: ProfileId,
    input: { note?: string; tags?: SavedTag[]; metAtZone?: string },
  ): Promise<void> {
    await savedPeople.save(profileId, { ...input, met: true });
  },

  async removeSaved(profileId: ProfileId): Promise<void> {
    await savedPeople.remove(profileId);
  },

  async setVisibility(visibility: Visibility): Promise<void> {
    const event = sessionStore.getState().event;
    sessionStore.setState({ visibility });
    await profileService.updatePrivacy({ visibility });
    sessionStore.setState({ privacy: profileService.privacySettings });
    if (event) await api.updateVisibility(event.id, visibility).catch(() => undefined);
    await presence.refreshAdvertisement();
  },

  async updatePrivacy(patch: Partial<PrivacySettings>): Promise<void> {
    const privacy = await profileService.updatePrivacy(patch);
    sessionStore.setState({ privacy });
    await presence.refreshAdvertisement();
  },

  async updateProfile(draft: ProfileDraft): Promise<void> {
    await profileService.update(draft);
    showToast('Profile updated', 'success');
  },

  /* -------------------- connections -------------------- */

  async connect(profileId: ProfileId, note?: string): Promise<void> {
    await connectionService.request(profileId, note);
    showToast('Connection request sent', 'success');
  },

  async respondToConnection(connectionId: string, accept: boolean): Promise<void> {
    await connectionService.respond(connectionId, accept);
  },

  async setConnectionNote(connectionId: string, note: string): Promise<void> {
    await connectionService.setNote(connectionId, note);
  },

  /* -------------------- safety -------------------- */

  async block(profileId: ProfileId): Promise<void> {
    await blockService.block(profileId);
    await connectionService.removeByProfile(profileId);
    sessionStore.setState({ selectedPeerId: null });
    showToast('Blocked. They will not appear on your map again.', 'success');
  },

  async unblock(profileId: ProfileId): Promise<void> {
    await blockService.unblock(profileId);
  },

  async report(input: ReportInput): Promise<void> {
    await blockService.report(input);
    sessionStore.setState({ selectedPeerId: null });
    showToast(
      input.alsoBlock === false ? 'Report sent' : 'Reported and blocked',
      'success',
    );
  },

  /* -------------------- connectivity -------------------- */

  /** Called when the device regains connectivity, and on app foreground. */
  async flushOutbox(): Promise<void> {
    await connectionService.flush();
    await blockService.flush();
    await profileService.flush();
  },
};

/* ------------------------------------------------------------------ *
 * Event entry
 * ------------------------------------------------------------------ */

/**
 * Goals and hook chosen during onboarding, before any event existed. Applied to
 * the first event the user joins and then cleared.
 */
let pendingEventProfile: {
  goals?: NetworkingGoal[];
  askMeAbout?: string[];
} | null = null;

async function enterEvent(event: EventDetail, visibility: Visibility): Promise<void> {
  sessionStore.setState({ boot: 'in_event', event, visibility });

  let eventProfile = await profileService.loadEventProfile(event.id);
  if (pendingEventProfile) {
    eventProfile = await profileService.updateEventProfile(event.id, pendingEventProfile);
    pendingEventProfile = null;
  }
  sessionStore.setState({ goals: eventProfile?.goals ?? [] });
  await connectionService.load(event.id);
  await savedPeople.load(event.id);
  await eventStats.load(event.id);

  // The transport is per-event because the simulated crowd is; rebuilding it
  // here also guarantees the radio is re-armed with the right event code.
  await presence.stop();
  transport = createTransport(event);
  presence.setTransport(transport);

  await presence.start(event);
  await presence.refreshAdvertisement();
}

/* ------------------------------------------------------------------ *
 * App lifecycle
 * ------------------------------------------------------------------ */

let appStateSubscription: { remove(): void } | null = null;

/**
 * App lifecycle and battery feed the scan policy (§45).
 *
 * A day-long conference is exactly the situation where an always-on radio ruins
 * the experience, so the two cheapest signals — is the app in front of the user,
 * and is the battery about to die — are wired up from launch rather than left
 * as a future optimisation.
 */
export function attachAppStateHandling(): () => void {
  const handle = (status: AppStateStatus): void => {
    if (status === 'active') {
      presence.setPhase('app_foreground');
      void actions.flushOutbox();
    } else if (status === 'background') {
      presence.setPhase('background');
    } else {
      presence.setPhase('inactive');
    }
  };

  appStateSubscription = AppState.addEventListener('change', handle);

  const batterySubscriptions: { remove(): void }[] = [];
  void (async () => {
    try {
      const [level, state] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ]);
      let charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
      let currentLevel = level;
      presence.setBattery(currentLevel, charging);

      batterySubscriptions.push(
        Battery.addBatteryLevelListener(({ batteryLevel }) => {
          currentLevel = batteryLevel;
          presence.setBattery(currentLevel, charging);
        }),
      );
      batterySubscriptions.push(
        Battery.addBatteryStateListener(({ batteryState }) => {
          charging =
            batteryState === Battery.BatteryState.CHARGING ||
            batteryState === Battery.BatteryState.FULL;
          presence.setBattery(currentLevel, charging);
        }),
      );
    } catch {
      // No battery API (simulator, unusual device): the policy falls back to
      // treating the level as unknown, which never triggers the low-power path.
      presence.setBattery(null, false);
    }
  })();

  return () => {
    appStateSubscription?.remove();
    appStateSubscription = null;
    for (const subscription of batterySubscriptions) subscription.remove();
  };
}

/** Exposed for the dev panel: flip the mock backend offline. */
export function setDevOffline(offline: boolean): void {
  if (api instanceof MockApi) api.setOffline(offline);
}

export function isMockBackend(): boolean {
  return api instanceof MockApi;
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

/**
 * Read-only views for screens. These exist so a screen never has to reach into
 * a service: it asks a question and gets an answer, and the wiring underneath
 * (directory, blocklist, connections, live distances) stays here.
 */
export const queries = {
  /** Everyone at the event, filtered. Nearby people sort first. */
  searchAttendees(filter: PeopleFilter): Attendee[] {
    const directory = eventService.directory;
    if (!directory) return [];
    return directory.search(filter, presenceStore.getState().distances);
  },

  attendee(profileId: ProfileId): Attendee | null {
    return eventService.directory?.getAttendee(profileId) ?? null;
  },

  /** Facet values for the filter chips, most common first. */
  facet(field: 'company' | 'skills' | 'interests' | 'industry', limit = 12): string[] {
    return eventService.directory?.facet(field, limit) ?? [];
  },

  /** "People you may want to meet", scored against the signed-in profile. */
  recommendations(options?: { limit?: number; nearbyOnly?: boolean }): ScoredMatch[] {
    const directory = eventService.directory;
    const state = sessionStore.getState();
    const profile = state.profile;
    const event = state.event;
    if (!directory || !profile || !event) return [];

    const eventProfile = profileService.eventProfile(event.id) ?? {
      eventId: event.id,
      profileId: profile.id,
      availability: 'available' as const,
    };

    const presenceModel = presenceStore.getState();
    const bands = new Map<ProfileId, ProximityBand>();
    for (const person of presenceModel.people) {
      if (person.profileId) bands.set(person.profileId, person.proximity.band);
    }

    return recommend(
      directory.all(),
      {
        goals: eventProfile.goals,
        profile,
        eventProfile,
        distances: presenceModel.distances,
        bands,
        connectedProfileIds: connectionService.connectedProfileIds(),
      },
      options,
    );
  },

  /** The live nearby entry for an attendee, when they are in range. */
  nearbyFor(profileId: ProfileId) {
    return presenceStore.getState().people.find((person) => person.profileId === profileId) ?? null;
  },

  connectionStateFor(profileId: ProfileId) {
    return connectionService.stateFor(profileId);
  },

  /**
   * The full "why should I meet this person" answer: a percentage, a tier, and
   * the factors that produced them. Returns null below the threshold rather
   * than reporting a weak match, which is a verdict nobody asked for.
   */
  matchDetailFor(profileId: ProfileId) {
    const directory = eventService.directory;
    const state = sessionStore.getState();
    const profile = state.profile;
    const event = state.event;
    const candidate = directory?.getAttendee(profileId);
    if (!directory || !profile || !event || !candidate) return null;

    const eventProfile = profileService.eventProfile(event.id) ?? {
      eventId: event.id,
      profileId: profile.id,
      availability: 'available' as const,
    };

    return matchBreakdown(candidate, {
      profile,
      eventProfile,
      distances: presenceStore.getState().distances,
      connectedProfileIds: connectionService.connectedProfileIds(),
      goals: eventProfile.goals,
    });
  },

  /**
   * The next event worth mentioning on the recap. Not a recommendation engine
   * — just the soonest thing that has not started yet.
   */
  upcomingEvent() {
    const state = sessionStore.getState();
    const now = Date.now();
    return (
      [...state.events]
        .filter((candidate) => candidate.id !== state.event?.id && candidate.startTime > now)
        .sort((a, b) => a.startTime - b.startTime)[0] ?? null
    );
  },

  /** Everyone bookmarked at this event, newest first. */
  savedPeople() {
    return savedPeople.list();
  },

  savedProfileIds(): ReadonlySet<ProfileId> {
    return savedPeople.savedProfileIds();
  },

  savedFor(profileId: ProfileId) {
    return savedPeople.get(profileId) ?? null;
  },

  /** An opening line for one person, derived only from what both profiles state. */
  starterFor(profileId: ProfileId) {
    const state = sessionStore.getState();
    const profile = state.profile;
    const event = state.event;
    const candidate = eventService.directory?.getAttendee(profileId);
    if (!profile || !event || !candidate) return null;

    const eventProfile = profileService.eventProfile(event.id) ?? {
      eventId: event.id,
      profileId: profile.id,
      availability: 'available' as const,
    };

    return conversationStarter(candidate, { profile, eventProfile });
  },

  /** The user's own goals for this event. */
  myGoals(): NetworkingGoal[] {
    const event = sessionStore.getState().event;
    if (!event) return [];
    return profileService.eventProfile(event.id)?.goals ?? [];
  },

  blockedAttendees(): { profileId: ProfileId; name: string; blockedAt: number }[] {
    return blockService.list().map((record) => ({
      profileId: record.profileId,
      name: eventService.directory?.getAttendee(record.profileId)?.profile.name ?? 'Blocked attendee',
      blockedAt: record.blockedAt,
    }));
  },
};
