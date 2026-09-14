/**
 * Composition root.
 *
 * Every dependency is constructed once, here, and wired to the stores. Screens
 * import *actions*, never services — so a screen cannot accidentally reach into
 * the BLE stack, and the whole graph can be swapped for tests or for the demo
 * build by changing `config`.
 */

import { AppState, Platform, Share, type AppStateStatus } from 'react-native';
import * as Battery from 'expo-battery';

import { HttpApiClient, type EventPulseApi } from '../api/ApiClient';
import { MockApi } from '../api/MockApi';
import type { BleTransport } from '../bluetooth/BleTransport';
import { NativeBleTransport, isNativeBleAvailable } from '../bluetooth/transports/NativeBleTransport';
import { SimulatedBleTransport, type SimulatedPeerSpec } from '../bluetooth/transports/SimulatedBleTransport';
import { ConnectionService } from '../connections/ConnectionService';
import {
  ConnectionRequestCoordinator,
  ConnectionRequestError,
  type PendingRequest,
} from '../connections/ConnectionRequestCoordinator';
import type { ConnectionCard } from '../connections/ConnectionProtocol';
import {
  ConversationService,
  type ConversationMessage,
} from '../connections/ConversationService';
import { GattSessionManager } from '../bluetooth/gatt/GattSessionManager';
import { createGattTransport } from '../bluetooth/gatt/transports';
import {
  advertisingUnchanged,
  computeAdvertisingPlan,
  nextIosSlice,
  type AdvertisingPlan,
  type AppliedAdvertising,
} from '../bluetooth/gatt/GattAdvertisingPolicy';
import { redactProfile } from '../security/PrivacyService';
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
import { ensureLocalProfileId, rememberLocalProfileId } from '../profile/LocalIdentity';
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
import { trace } from './diagnostics';

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

/* ------------------------------------------------------------------ *
 * GATT — the connection channel
 *
 * Separate from the presence radio in every sense: a different library, a
 * different (connectable) service UUID, and a lifecycle that only runs while
 * the user is in an event. The presence beacon is untouched by any of this and
 * stays non-connectable.
 *
 * Probed once. When the libraries are not linked into a build, `gatt` is null
 * and the UI says so rather than offering a Connect button that cannot work.
 * ------------------------------------------------------------------ */

const gattProbe = createGattTransport();

export const gattSessions = gattProbe.available
  ? new GattSessionManager({ transport: gattProbe.transport, now: () => Date.now() })
  : null;

export const connectionRequests = gattSessions
  ? new ConnectionRequestCoordinator({
      sessions: gattSessions,
      connections: connectionService,
      blocks: blockService,
      db,
      now: () => Date.now(),
      // Redacted for a stranger before it is ever handed to the radio. Offline
      // this is the ONLY place field visibility can be enforced — there is no
      // server to filter what the far side receives.
      myCard: (): ConnectionCard | null => {
        const profile = profileService.current;
        const privacy = profileService.privacySettings;
        if (!profile) return null;
        const visible = privacy ? redactProfile(profile, privacy, 'attendee') : profile;
        return {
          profileId: visible.id,
          name: visible.name,
          role: visible.role,
          company: visible.company,
        };
      },
      acceptsConnectionRequests: () =>
        profileService.privacySettings?.allowConnectionRequests ?? true,
      // The radar's current peer id for a person — the value the far side is
      // advertising as its GATT local name right now.
      currentPeerIdFor: (profileId) =>
        presenceStore.getState().people.find((person) => person.profileId === profileId)?.peerId ??
        null,
      newRequestId: () => `req_${Date.now().toString(36)}_${(requestCounter++).toString(36)}`,
    })
  : null;

let requestCounter = 0;

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

/**
 * The result of trying to connect.
 *
 * Returned as well as toasted, because a toast is not always visible: the
 * profile card is a React Native `Modal`, which renders in its own native
 * window ABOVE the React tree, so a `<Toast />` mounted at the root is painted
 * behind it and the user sees nothing at all. A caller inside a modal has to be
 * able to show the failure itself, and that is what this return value is for.
 */
export interface ConnectOutcome {
  ok: boolean;
  message?: string;
}

export const actions = {
  async bootstrap(): Promise<void> {
    await db.open();
    await blockService.load();
    blockService.subscribe((blocked) => {
      sessionStore.setState({ blockedProfileIds: blocked });
      eventService.directory?.setBlocked(blocked);
      presence.applyBlocklist();
    });

    /*
     * Identity before anything that can speak.
     *
     * `myCard()` can be called the moment a link comes up, and whatever it
     * returns is what the far side believes about who we are. Settling this
     * ahead of the event resume and the radio means there is no window in
     * which a card could go out carrying a placeholder.
     *
     * The second step is the migration for phones that already ran the old
     * build: `load` keeps a stored profile exactly as it is, so those still
     * carry the shared `'me'` and would otherwise remain unable to connect to
     * anyone. `adoptIdentity` replaces a placeholder and nothing else, so a
     * phone that already has a real identity keeps the one its peers know.
     */
    const seedProfileId = await ensureLocalProfileId(db);
    await profileService.load(() => defaultUserProfile(seedProfileId));
    const profile = await profileService.adoptIdentity(seedProfileId);
    await rememberLocalProfileId(db, profile.id);
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
    await stopConnectionChannel();
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

  /**
   * Ask someone to connect, over the radio.
   *
   * This no longer writes a local record and hopes: it finds their GATT device,
   * opens a link and sends a real CONNECTION_REQUEST. The toast says "sent",
   * not "connected", because nobody is connected until a person on the other
   * phone answers.
   */
  async connect(profileId: ProfileId, note?: string): Promise<ConnectOutcome> {
    trace('Connect', 'action received', {
      profileId,
      gattAvailable: gattProbe.available,
      coordinator: connectionRequests !== null,
    });
    if (!connectionRequests) {
      trace('Connect', 'ABORT: no GATT coordinator', { reason: gattUnavailableReason() });
      const message = gattUnavailableReason();
      showToast(message, 'error');
      return { ok: false, message };
    }
    try {
      await connectionRequests.request(profileId, note);
      trace('Request', 'result=sent');
      showToast('✓  Request sent', 'success');
      void applyAdvertisingPlan();
      return { ok: true };
    } catch (error) {
      const code = error instanceof ConnectionRequestError ? error.code : 'unknown';
      trace('Request', 'result=failed', {
        code,
        message: error instanceof Error ? error.message : String(error),
      });
      const message =
        error instanceof ConnectionRequestError ? error.message : 'Could not send the request.';
      showToast(message, 'error');
      return { ok: false, message };
    }
  },

  /**
   * Ask a peer the radar found to connect, without knowing who they are.
   *
   * The offline-normal case. Nothing maps a rotating peer id to a person
   * without a directory, and there is no server to supply one, so requiring a
   * profileId first made Connect unusable for exactly the people it exists for.
   * The exchange is filed provisionally and reconciled onto the real identity
   * the moment their accept arrives carrying it.
   */
  async connectToPeer(peerId: PeerId, note?: string): Promise<ConnectOutcome> {
    trace('Connect', 'action received (by peer)', {
      peerId,
      gattAvailable: gattProbe.available,
      coordinator: connectionRequests !== null,
    });
    if (!connectionRequests) {
      const message = gattUnavailableReason();
      showToast(message, 'error');
      return { ok: false, message };
    }
    try {
      await connectionRequests.requestByPeer(peerId, note);
      showToast('✓  Request sent', 'success');
      void applyAdvertisingPlan();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof ConnectionRequestError ? error.message : 'Could not send the request.';
      trace('Request', 'result=failed', {
        code: error instanceof ConnectionRequestError ? error.code : 'unknown',
        message,
      });
      showToast(message, 'error');
      return { ok: false, message };
    }
  },

  /* ---------------------------- conversations ---------------------------- */

  /**
   * Read a conversation in, so the screen opens on history rather than blank.
   *
   * Safe to call every time the screen mounts: the service keeps a loaded
   * conversation in memory and will not re-read it.
   */
  async openConversation(profileId: ProfileId): Promise<ConversationMessage[]> {
    return conversations.load(profileId);
  },

  /**
   * Send one chat message.
   *
   * Resolves with the message in whatever state it actually reached — `sent`
   * when the transport carried it, `failed` when it did not. Never optimistic:
   * a bubble that claims delivery it did not get is the one thing a chat over
   * an unreliable radio must not do.
   */
  async sendChatMessage(profileId: ProfileId, text: string): Promise<ConversationMessage | null> {
    if (text.trim().length === 0) return null;
    try {
      return await conversations.send(profileId, text);
    } catch {
      showToast('Could not send that message.', 'error');
      return null;
    }
  },

  /** Try a failed message again, keeping its id so the far side still dedupes it. */
  async retryChatMessage(profileId: ProfileId, messageId: string): Promise<void> {
    await conversations.retry(profileId, messageId);
  },

  /** Withdraw a request we sent. */
  async cancelConnectionRequest(profileId: ProfileId): Promise<void> {
    await connectionRequests?.cancel(profileId);
    showToast('Request cancelled', 'neutral');
  },

  async acceptConnectionRequest(profileId: ProfileId): Promise<void> {
    await connectionRequests?.accept(profileId);
    showToast('Connected', 'success');
  },

  async rejectConnectionRequest(profileId: ProfileId): Promise<void> {
    await connectionRequests?.reject(profileId);
    showToast('Request declined', 'neutral');
  },

  /**
   * The Connections screen answers by connection id; the radio works in people.
   * Resolve one to the other rather than giving the screen a second vocabulary.
   */
  async respondToConnection(connectionId: string, accept: boolean): Promise<void> {
    const connection = connectionService.list().find((entry) => entry.id === connectionId);
    if (!connection) return;
    if (accept) await actions.acceptConnectionRequest(connection.profileId);
    else await actions.rejectConnectionRequest(connection.profileId);
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

  /**
   * The block half is local and always applies; the report half may not have
   * left the device. `BlockService.report` now rethrows a delivery failure
   * instead of swallowing it, so the two outcomes get two different messages —
   * telling someone their report was sent when it is sitting in a queue is the
   * kind of untruth this app is built not to tell. Both call sites `void` this
   * promise, so it must not reject.
   */
  async report(input: ReportInput): Promise<void> {
    const alsoBlocked = input.alsoBlock !== false;
    try {
      await blockService.report(input);
      sessionStore.setState({ selectedPeerId: null });
      showToast(alsoBlocked ? 'Reported and blocked' : 'Report sent', 'success');
    } catch {
      sessionStore.setState({ selectedPeerId: null });
      showToast(
        alsoBlocked
          ? 'Blocked. Your report will send when you are back online.'
          : 'Your report will send when you are back online.',
        'neutral',
      );
    }
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

  await startConnectionChannel(event.id);
}

/* ------------------------------------------------------------------ *
 * The connection channel
 * ------------------------------------------------------------------ */

let requestTickHandle: ReturnType<typeof setInterval> | null = null;
/** What is actually on the air right now — the plan AND the identity it carries. */
let lastApplied: AppliedAdvertising | null = null;
/** iOS time-slice, advanced by the ticker. Android never reads it. */
let iosSlice: 'presence' | 'gatt' = 'presence';
let nextSliceAt = 0;
/**
 * Android: the epoch boundary the advertised identity was last re-evaluated at.
 *
 * Zero means "never", so the first tick arms it against the real boundary.
 */
let nextRotationAt = 0;

function publishRequests(): void {
  sessionStore.setState({ incomingRequests: connectionRequests?.incoming() ?? [] });
}

function gattUnavailableReason(): string {
  return gattProbe.available ? 'Connections are unavailable right now.' : gattProbe.reason;
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

/**
 * Which person is reachable on which link, assembled from public events only.
 *
 * `ConnectionRequestCoordinator` already knows this and keeps it private, and
 * it stays that way — nothing here reaches into it. Two public sources are
 * enough: an inbound request names both the device and the sender's card, and
 * discovery names the device and the rotating peer id, which the radar already
 * maps to a person.
 *
 * Both maps hold transport values that rotate. Neither is ever persisted; the
 * conversation on disk is keyed by the stable profileId alone.
 */
const linkProfiles = new Map<string, ProfileId>();
const linkPeers = new Map<string, PeerId>();

function profileForDevice(deviceId: string): ProfileId | null {
  /*
   * The coordinator first, for the same reason `deviceForProfile` asks it
   * first: it is the only one of the three maps that is MAINTAINED. It is
   * pruned when a session closes, when a link goes idle, and on stop, where the
   * two below are never pruned at all and accumulate stale addresses for the
   * life of the process. It is also the only one that sees a link the far side
   * opened during mutual consent, which is the case that dropped every inbound
   * chat message: the coordinator returns early on mutual consent, before the
   * `onIncomingRequest` that is the sole thing populating `linkProfiles`.
   */
  const attributed = connectionRequests?.profileForDevice(deviceId) ?? null;
  if (attributed) return attributed;

  const known = linkProfiles.get(deviceId);
  if (known) return known;

  const peerId = linkPeers.get(deviceId);
  if (!peerId) return null;
  return presenceStore.getState().people.find((person) => person.peerId === peerId)?.profileId ?? null;
}

function deviceForProfile(profileId: ProfileId): string | null {
  const usable = (deviceId: string): boolean =>
    gattSessions?.getLinkState(deviceId) === 'connected';

  /*
   * Ask the coordinator first.
   *
   * It is the only component that sees both directions: it records the device
   * when we dial out, when a request arrives, and re-points it onto the real
   * profileId on accept. The maps below are reconstructed from public events
   * and cannot see an outgoing dial at all, which is why a live, healthy link
   * was invisible to chat and the Connection Space said "out of range" about a
   * peer it was still connected to.
   */
  const known = connectionRequests?.deviceFor(profileId) ?? null;
  if (known && usable(known)) return known;

  for (const [deviceId, id] of linkProfiles) {
    if (id === profileId && usable(deviceId)) return deviceId;
  }

  const peerId = presenceStore
    .getState()
    .people.find((person) => person.profileId === profileId)?.peerId;
  if (!peerId) return null;

  for (const [deviceId, id] of linkPeers) {
    if (id === peerId && usable(deviceId)) return deviceId;
  }
  return null;
}

export const conversations = new ConversationService({
  db,
  // Constructed after `gattSessions`, which is null until the GATT probe runs;
  // the getter defers the lookup to call time rather than capturing a null.
  get sessions() {
    if (!gattSessions) throw new Error('ConversationService used before the GATT channel started');
    return gattSessions;
  },
  now: () => Date.now(),
  newMessageId: () => `msg_${Date.now().toString(36)}_${(chatSequence += 1)}`,
  deviceFor: deviceForProfile,
  profileForDevice,
} as ConstructorParameters<typeof ConversationService>[0]);

let chatSequence = 0;

async function startConnectionChannel(eventId: EventId): Promise<void> {
  if (!gattSessions || !connectionRequests) {
    sessionStore.setState({
      gattAvailable: false,
      gattUnavailableReason: gattUnavailableReason(),
    });
    return;
  }

  gattSessions.start();
  await connectionRequests.start(eventId);

  gattSessions.subscribe({
    onDiscovery: (discovery) => {
      if (discovery.displayName) linkPeers.set(discovery.deviceId, discovery.displayName);
    },
  });
  conversations.start(eventId);

  connectionRequests.subscribe({
    onIncomingRequest: (request: PendingRequest) => {
      // The one public place a device is named alongside the person behind it.
      if (request.deviceId) linkProfiles.set(request.deviceId, request.card.profileId);
      publishRequests();
      showToast(`${request.card.name} wants to connect`, 'neutral');
    },
    onIdentityLearned: (provisionalKey: ProfileId, profileId: ProfileId) => {
      // A link filed under a stand-in now has a real person behind it.
      for (const [deviceId, id] of linkProfiles) {
        if (id === provisionalKey) linkProfiles.set(deviceId, profileId);
      }
    },
    onSettled: () => {
      publishRequests();
      void applyAdvertisingPlan();
    },
  });

  /*
   * What the OS actually granted, before anything tries to use it.
   *
   * The GATT channel needs BLUETOOTH_CONNECT twice over: once to open a link,
   * and once for the peripheral library to write the adapter name that carries
   * our rotating peer id. A missing grant used to fail both silently — the
   * library catches the SecurityException, logs a warning of its own, and
   * advertises the previous name regardless, so the far side matched the wrong
   * name and called us unreachable. Logging the grant and the adapter name here
   * turns that into one readable line.
   */
  if (isNativeBleAvailable()) {
    void new NativeBleTransport()
      .getPermissionDiagnostics()
      .then((diagnostics) => {
        trace('GATT', 'permissions at channel start', {
          granted: diagnostics.granted,
          missing: diagnostics.missing.join(',') || 'none',
          sdkInt: diagnostics.sdkInt,
          adapterName: diagnostics.adapterName ?? 'unreadable (needs BLUETOOTH_CONNECT)',
        });
      })
      .catch(() => undefined);
  }

  trace('GATT', 'channel started', { eventId, transport: gattProbe.available ? 'native' : 'none' });
  if (gattProbe.available) {
    void gattProbe.transport.getCapabilities().then((caps) => {
      trace('GATT', 'capabilities', {
        central: caps.supportsCentral,
        peripheral: caps.supportsPeripheral,
        reason: caps.unavailableReason,
      });
    });
  }
  sessionStore.setState({ gattAvailable: true, gattUnavailableReason: null });
  publishRequests();
  await applyAdvertisingPlan();

  // One timer drives every deadline on this channel: request expiry, the
  // session layer's connect timeouts, and the iOS advertising slice. All three
  // are pure functions of `now`, so there is exactly one place time enters.
  stopRequestTicker();
  requestTickHandle = setInterval(() => {
    const now = Date.now();
    gattSessions?.tick(now);
    if (Platform.OS === 'ios' && now >= nextSliceAt) {
      const next = nextIosSlice(iosSlice);
      iosSlice = next.slice;
      nextSliceAt = now + next.durationMs;
      void applyAdvertisingPlan();
    }

    /*
     * Android: the peer id rotates on a wall-clock epoch, and nothing else on
     * this platform ever re-evaluates the advertisement. Measured on two
     * emulators: both phones advertised the id they started with for nine
     * minutes past a boundary, while the presence radar - which DOES rotate,
     * on its own timer - had moved on. From then on the radar looked for one
     * name and the advertisement carried another, so every Connect reported
     * the person unreachable while their phone was advertising perfectly well.
     *
     * Only on the boundary, not every tick. `applyAdvertisingPlan` refuses to
     * touch the radio unless something changed, but reaching that refusal is
     * neither free nor silent: it logs a line and derives the peer id through
     * two full SHA-256 passes, and re-applying tears the advertisement down
     * and puts it back, which would make the device intermittently invisible.
     */
    if (Platform.OS === 'android' && now >= nextRotationAt) {
      const rotatesAt = eventService.nextRotationAt(now);
      /*
       * But never while someone is connected.
       *
       * Re-advertising is not a rename on this module: startAdvertising
       * rebuilds the GATT server, clearing every service and re-adding it. The
       * ACL link survives that, so the phone still looks connected — but the
       * subscribed central is silently unregistered, and `updateValue` then
       * reports success while notifying nobody. Measured on two emulators: a
       * rotation at 12:45 left the peripheral-to-central direction dead, every
       * frame accepted=true, nothing delivered, no error anywhere.
       *
       * So the new name waits for the link to end. Two people already talking
       * do not need to rediscover each other; only a new peer does, and they
       * can find us as soon as this conversation is over. Holding the deadline
       * where it is re-checks each tick, which costs one comparison.
       */
      const linked = (gattSessions?.getSessions().length ?? 0) > 0;
      if (rotatesAt !== null && !linked) {
        nextRotationAt = rotatesAt;
        void applyAdvertisingPlan();
      }
    }
    void connectionRequests?.tick(now).then((expired) => {
      if (expired.length > 0) {
        publishRequests();
        showToast('A connection request expired', 'neutral');
      }
    });
  }, 1_000);
  (requestTickHandle as unknown as { unref?: () => void }).unref?.();
}

function stopRequestTicker(): void {
  if (requestTickHandle !== null) clearInterval(requestTickHandle);
  requestTickHandle = null;
}

async function stopConnectionChannel(): Promise<void> {
  stopRequestTicker();
  await connectionRequests?.stop();
  if (gattProbe.available) {
    await gattProbe.transport.stopPeripheral().catch(() => undefined);
    await gattProbe.transport.stopScan().catch(() => undefined);
  }
  lastApplied = null;
  nextRotationAt = 0;
  sessionStore.setState({ incomingRequests: [] });
}

/**
 * Make the radio match the policy.
 *
 * The plan comes from a pure function that knows nothing about radios; all this
 * does is apply it. On iOS the plan alternates, because CBPeripheralManager
 * advertises one service set at a time - see GattAdvertisingPolicy for why
 * presence wins the default slice.
 */
async function applyAdvertisingPlan(): Promise<void> {
  if (!gattProbe.available) return;
  const gattTransport = gattProbe.transport;

  const state = sessionStore.getState();
  const plan = computeAdvertisingPlan({
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other',
    inEvent: state.boot === 'in_event',
    visibility: state.visibility,
    acceptsConnectionRequests: state.privacy?.allowConnectionRequests ?? true,
    hasOutgoingRequest: (connectionRequests?.outgoing().length ?? 0) > 0,
    hasActiveInboundLink: (connectionRequests?.incoming().length ?? 0) > 0,
    iosSlice,
  });

  trace('Advertising', 'plan', {
    presence: plan.presenceAdvertising,
    peripheral: plan.gattPeripheral,
    scanning: plan.gattScanning,
    reason: plan.reason,
  });

  /*
   * The identity is read once and used for both the comparison and the
   * advertisement, so the two cannot drift apart between here and the call
   * below — which is exactly the failure this replaces.
   */
  const identity = plan.gattPeripheral ? (eventService.currentPeerId() ?? null) : null;
  const next: AppliedAdvertising = { plan, identity };

  if (advertisingUnchanged(lastApplied, next)) return;
  const rotated = lastApplied !== null && lastApplied.identity !== identity;
  lastApplied = next;

  if (rotated) {
    trace('Advertising', 'identity rotated', { identity });
  }

  /*
   * Two independent halves, deliberately.
   *
   * Hosting and looking are separate capabilities of separate radios' worth of
   * state: a phone with no advertiser can still dial out, and a phone whose
   * advertisement is refused can still find everyone else. They used to share
   * one `try`, so the peripheral half failing — or, as it turned out, simply
   * never settling — meant `startScan()` was never reached and this phone
   * silently stopped looking for anyone at all. That is the failure that made
   * Connect report "not reachable" while both phones were advertising happily.
   */
  let peripheralError: unknown = null;
  try {
    if (plan.gattPeripheral) {
      // The local name is our current rotating peer id: the one value that lets
      // the far side match this device to the person on their radar. It is
      // already public in every presence beacon and rotates on the same epoch,
      // so it grants no new or lasting handle.
      await gattTransport.startPeripheral({
        displayName: identity ?? undefined,
      });
    } else {
      await gattTransport.stopPeripheral();
    }
  } catch (error) {
    // A chipset with no advertiser is a real and common outcome. Say so once
    // rather than failing silently or retrying for ever — but do not let it
    // stop the scan below.
    peripheralError = error;
    /*
     * Forget what we claimed to have applied. `lastApplied` is committed before
     * the radio call, so without this a rotation that failed would be recorded
     * as done and nothing would retry it - leaving the phone advertising
     * nothing at all until the next boundary, a full epoch away.
     */
    lastApplied = null;
    trace('Advertising', 'peripheral FAILED', {
      wanted: plan.gattPeripheral,
      error: error instanceof Error ? error.message : String(error),
      code: (error as { code?: string } | null)?.code,
    });
    sessionStore.setState({
      gattUnavailableReason:
        error instanceof Error ? error.message : 'This phone cannot host a connection.',
    });
  }

  try {
    if (plan.gattScanning) await gattTransport.startScan();
    else await gattTransport.stopScan();
  } catch (error) {
    trace('Advertising', 'scan FAILED', {
      wanted: plan.gattScanning,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  trace('Advertising', 'applied', {
    peripheral: plan.gattPeripheral,
    scanning: plan.gattScanning,
    peripheralFailed: peripheralError !== null,
  });
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

  /** The live BLE request for this person, in either direction. */
  pendingRequestFor(profileId: ProfileId) {
    return connectionRequests?.pendingFor(profileId) ?? null;
  },

  /**
   * Who a radar peer turned out to be, for the offline case where the directory
   * never resolved them. Null until a connection with them has settled.
   */
  profileForPeer(peerId: PeerId): ProfileId | null {
    return connectionRequests?.profileForPeer(peerId) ?? null;
  },

  /**
   * Can a connection be opened to this person right now?
   *
   * Being on the radar is not enough. The radar is a beacon and the connection
   * is a separate, connectable service, so someone can be four metres away and
   * still not reachable - because they are not accepting requests, or because
   * their phone is in the presence half of the iOS advertising slice. The
   * button reads this rather than assuming.
   */
  canConnectTo(profileId: ProfileId): boolean {
    return connectionRequests?.isReachable(profileId) ?? false;
  },

  /** True when this radar peer is advertising the connection service right now. */
  canConnectToPeer(peerId: PeerId): boolean {
    return connectionRequests?.isPeerReachable(peerId) ?? false;
  },

  /** Everything known about a conversation, oldest first. */
  conversation(profileId: ProfileId): ConversationMessage[] {
    return conversations.messages(profileId);
  },

  /**
   * Whether a message could go out right now.
   *
   * A conversation stays readable when the link drops — this only says whether
   * the composer can send, so the UI can be honest about it instead of queuing
   * into nowhere.
   */
  canChat(profileId: ProfileId): boolean {
    return deviceForProfile(profileId) !== null;
  },

  /** Requests waiting on the user, newest first. */
  incomingRequests() {
    return connectionRequests?.incoming() ?? [];
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
