/**
 * EventMapScreen — the home of the product.
 *
 * Its job is to compose, not to compute: the presence pipeline hands it a
 * finished model, and this screen decides which of five states the room is in.
 *
 *   scanning        → the live map
 *   no permission   → an explanation, then a prompt (§56)
 *   Bluetooth off   → a way to turn it on, or directions to Settings (§55)
 *   unsupported     → an honest dead end, with Discover still offered
 *   nobody nearby   → an invitation to move, never a blank screen (§54)
 *
 * Note what the empty state is *not*: a spinner. Once we are scanning, "nobody
 * nearby yet" is a true and final answer until someone walks in, and dressing
 * it up as loading would be a lie the user can feel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EventMap } from '../components/EventMap';
import { EventHeader, ZonePickerList } from '../components/EventHeader';
import { FilterBar, matchesPersonFilter } from '../components/FilterBar';
import { MapControls, MapStatusStrip } from '../components/MapControls';
import { AdvancedFilterSheet, MapLegendSheet, NearbyListSheet } from '../components/MapSheets';
import { NavigationOverlay } from '../components/NavigationOverlay';
import { PersonPreviewBar, ProfileCard } from '../components/ProfileCard';
import { Sheet } from '../components/Sheet';
import { VenuePlanSheet } from '../components/VenuePlanSheet';
import { GoalsSheet } from '../components/GoalsSheet';
import { WorthWalkingOver, type WalkCandidate } from '../components/WorthWalkingOver';
import { ArrivedSheet, SaveWithNoteSheet } from '../components/ArrivedSheet';
import { AppText, Button, EmptyState } from '../components/primitives';
import { provisionalKeyFor } from '../connections/ConnectionRequestCoordinator';
import { zoomIn, zoomOut } from '../positioning/Clustering';
import { useDeviceSensors } from '../positioning/useDeviceSensors';
import {
  BLUETOOTH_OFF_COPY,
  PERMISSION_DENIED_COPY,
  PERMISSION_RATIONALE,
  UNSUPPORTED_COPY,
  canRequestAdapterEnable,
  openSettings,
  requestBluetoothPermissions,
} from '../permissions/BluetoothPermissions';
import { actions, connectionService, presence, queries } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { presenceStore, sessionStore, showToast } from '../state/stores';
import { trace } from '../runtime/diagnostics';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, typography } from '../theme/tokens';

export function EventMapScreen({
  onOpenDiscover,
  onOpenPrivacy,
}: {
  onOpenDiscover: () => void;
  onOpenPrivacy?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();

  const people = useStore(presenceStore, (state) => state.people);
  const heading = useStore(presenceStore, (state) => state.heading);
  const navigation = useStore(presenceStore, (state) => state.navigation);
  const scanner = useStore(presenceStore, (state) => state.scanner);
  const advertiser = useStore(presenceStore, (state) => state.advertiser);

  const event = useStore(sessionStore, (state) => state.event);
  const sync = useStore(sessionStore, (state) => state.sync);
  const zoom = useStore(sessionStore, (state) => state.zoom);
  const orientation = useStore(sessionStore, (state) => state.orientation);
  const basemap = useStore(sessionStore, (state) => state.basemap);
  const mapFilter = useStore(sessionStore, (state) => state.mapFilter);
  const selectedPeerId = useStore(sessionStore, (state) => state.selectedPeerId);
  const expandedClusterId = useStore(sessionStore, (state) => state.expandedClusterId);
  const connections = useStore(sessionStore, (state) => state.connections);
  const currentZoneId = useStore(sessionStore, (state) => state.currentZoneId);
  const mapQuery = useStore(sessionStore, (state) => state.mapQuery);

  const [profileOpen, setProfileOpen] = useState(false);
  const [venuePlanOpen, setVenuePlanOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [nearbyListOpen, setNearbyListOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [panned, setPanned] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  /** Why the last Connect attempt failed, shown on the card itself. */
  const [connectNotice, setConnectNotice] = useState<string | null>(null);

  // The info button is the whole product flow, so it gets pointed at exactly
  // once — the first time this session that anyone actually shows up.
  const [hintShown, setHintShown] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [arrivedOpen, setArrivedOpen] = useState(false);
  const [saveNoteFor, setSaveNoteFor] = useState<string | null>(null);

  /**
   * Open the arrival sheet once, on the transition into `arrived`.
   *
   * A ref rather than state for the same reason as the goals prompt: navigation
   * state updates several times a second while arrived, and a state guard would
   * re-run this effect and re-open a sheet the user had just dismissed.
   */
  const announcedArrival = useRef<string | null>(null);
  useEffect(() => {
    if (navigation?.phase !== 'arrived' || !navigation.targetPeerId) {
      if (navigation?.phase !== 'arrived') announcedArrival.current = null;
      return;
    }
    if (announcedArrival.current === navigation.targetPeerId) return;
    announcedArrival.current = navigation.targetPeerId;
    setArrivedOpen(true);
  }, [navigation?.phase, navigation?.targetPeerId]);

  const arrivedPerson = useMemo(
    () =>
      navigation?.targetPeerId
        ? (people.find((person) => person.peerId === navigation.targetPeerId) ?? null)
        : null,
    [people, navigation?.targetPeerId],
  );

  /**
   * Openers for the arrival sheet.
   *
   * `conversationStarter` returns the single best line. "Another opener" needs
   * more than one, so the runner-up is the person's own stated hook — still a
   * fact they published, never an invention.
   */
  const arrivedStarters = useMemo(() => {
    if (!arrivedPerson?.profileId) return [];
    const primary = queries.starterFor(arrivedPerson.profileId);
    const attendee = arrivedPerson.attendee;
    const alternates = (attendee?.eventProfile.askMeAbout ?? []).map((topic) => ({
      basis: `${arrivedPerson.displayName.split(' ')[0]} listed this on their card`,
      question: `"${topic} \u2014 what are you working on there?"`,
    }));
    return [primary, ...alternates].filter(Boolean) as NonNullable<typeof primary>[];
  }, [arrivedPerson]);

  const arrivedContext = useMemo(() => {
    const attendee = arrivedPerson?.attendee;
    if (!attendee) return null;
    const wants = attendee.eventProfile.lookingToMeet?.[0];
    const years = attendee.profile.experienceYears;
    const parts = [
      wants ? `Looking to meet ${wants.toLowerCase()}` : null,
      years !== undefined && attendee.profile.company
        ? `${years} ${years === 1 ? 'year' : 'years'} at ${attendee.profile.company}`
        : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' \u00b7 ') : null;
  }, [arrivedPerson]);

  const savePerson = useMemo(
    () => (saveNoteFor ? queries.attendee(saveNoteFor) : null),
    [saveNoteFor],
  );
  const savePersonName = savePerson?.profile.name ?? arrivedPerson?.displayName ?? '';
  const savePersonAvatar = savePerson?.profile.avatar ?? arrivedPerson?.attendee?.profile.avatar;

  /**
   * The ranked shortlist under the radar.
   *
   * Scored against everyone currently in range, not against the directory: this
   * strip is specifically about who is worth *walking to*, so someone excellent
   * on the far side of the venue does not belong in it.
   *
   * `direction` is filled in only for the person being navigated to, because
   * that is the only one whose bearing has actually been solved. Every other
   * row shows a distance band and no heading — see the note in the component.
   */
  /** Free right now, for the filter row's count. */
  const availableCount = useMemo(
    () => people.filter((person) => person.availability === 'available').length,
    [people],
  );

  const walkCandidates = useMemo<WalkCandidate[]>(
    () =>
      people
        .filter((person) => person.profileId)
        .map((person) => ({
          person,
          match: queries.matchDetailFor(person.profileId as string),
          direction:
            navigation?.targetPeerId === person.peerId ? navigation.directionLabel : null,
        })),
    // `people` is a fresh array per presence snapshot, so this recomputes at the
    // snapshot rate (3-8 Hz) rather than per frame.
    [people, navigation?.targetPeerId, navigation?.directionLabel],
  );
  const goals = useStore(sessionStore, (state) => state.goals);

  /**
   * Ask for goals once, shortly after the room has actually populated.
   *
   * Not on launch: a question about who you want to meet, asked against an
   * empty screen, is abstract. Asked once people have appeared, it is obviously
   * about them. Never asked twice — declining is an answer.
   *
   * The guard and the timer both live in refs, and the timer is cleared only on
   * unmount. The obvious version — a `useState` guard with the timeout cleaned
   * up per run — never fires: `people.length` changes on every presence
   * snapshot, so the effect re-runs several times a second and each cleanup
   * cancels the pending timer before it can reach 1.2 s.
   */
  const goalsAsked = useRef(false);
  const goalsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (goalsTimer.current) clearTimeout(goalsTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (goalsAsked.current || goals.length > 0 || people.length < 3) return;
    goalsAsked.current = true;
    goalsTimer.current = setTimeout(() => {
      // Re-check at fire time, not only at schedule time. `enterEvent` flips the
      // boot phase before it finishes loading the event profile, so the map can
      // mount, see no goals, and schedule this prompt a beat before the goals
      // chosen during onboarding actually arrive. Asking someone a question
      // they answered ninety seconds ago is worse than not asking at all.
      if (sessionStore.getState().goals.length > 0) return;
      setGoalsOpen(true);
    }, 1200);
  }, [goals.length, people.length]);
  const hintInfo = !hintShown && people.length > 0;
  useEffect(() => {
    if (!hintInfo) return;
    const timer = setTimeout(() => setHintShown(true), 6_000);
    return () => clearTimeout(timer);
  }, [hintInfo]);

  useDeviceSensors(presence, scanner?.state === 'scanning' || scanner?.state === 'duty_paused');

  // Tell the scan policy the map is on screen; it scans hardest here.
  useEffect(() => {
    presence.setPhase('map_foreground');
    return () => presence.setPhase('app_foreground');
  }, []);

  const selectedPerson = useMemo(
    () => people.find((person) => person.peerId === selectedPeerId) ?? null,
    [people, selectedPeerId],
  );

  const navigatingPerson = useMemo(
    () =>
      navigation ? people.find((person) => person.peerId === navigation.targetPeerId) ?? null : null,
    [people, navigation],
  );

  /**
   * Filtering fades non-matching people rather than removing them, so the map
   * stays a picture of the room. `null` means "no filter" and skips the work.
   */
  /** How many people in range the matcher actually vouched for. */
  const matchesNearbyCount = useMemo(
    () => walkCandidates.filter((candidate) => candidate.match !== null).length,
    [walkCandidates],
  );

  /** Peer ids the matcher vouched for, for the "Matches" chip. */
  const matchedByEngine = useMemo(
    () =>
      new Set(
        walkCandidates
          .filter((candidate) => candidate.match !== null)
          .map((candidate) => candidate.person.peerId),
      ),
    [walkCandidates],
  );

  const matchedPeerIds = useMemo(() => {
    const needle = mapQuery.trim().toLowerCase();
    const hasFilter = Boolean(
      mapFilter.categories?.length ||
        mapFilter.availableOnly ||
        mapFilter.matchesOnly ||
        mapFilter.companies?.length ||
        mapFilter.skills?.length ||
        mapFilter.minExperience !== undefined,
    );
    if (!hasFilter && !needle) return null;

    const matched = new Set<string>();
    for (const person of people) {
      // Resolved here rather than in the pure predicate: "is this a match" is a
      // question about the pair, and only this screen has both halves.
      if (mapFilter.matchesOnly && !matchedByEngine.has(person.peerId)) continue;
      if (hasFilter && !matchesPersonFilter(mapFilter, person)) continue;
      if (needle) {
        const profile = person.attendee?.profile;
        const haystack = [
          person.displayName,
          person.subtitle,
          profile?.company,
          profile?.role,
          ...(profile?.skills ?? []),
          ...(profile?.interests ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      matched.add(person.peerId);
    }
    return matched;
  }, [people, mapFilter, mapQuery]);

  /** Connection state per map node, for the corner badge. */
  const connectionFor = useCallback(
    (peerId: string): 'connected' | 'requested' | null => {
      const person = people.find((item) => item.peerId === peerId);
      if (!person?.profileId) return null;
      const state = queries.connectionStateFor(person.profileId);
      if (state === 'connected') return 'connected';
      if (state === 'outgoing_pending' || state === 'incoming_pending') return 'requested';
      return null;
    },
    [people, connections],
  );

  const currentZone = useMemo(
    () => event?.zones.find((zone) => zone.id === currentZoneId) ?? null,
    [event, currentZoneId],
  );

  const connectionState = useMemo(() => {
    if (!selectedPerson) return 'none' as const;

    // Resolved by the directory: ask about the person directly.
    if (selectedPerson.profileId) return connectionService.stateFor(selectedPerson.profileId);

    /*
     * Unresolved, which offline is the normal case — nothing maps a rotating
     * peer id to a person without a directory. Returning 'none' here, as this
     * used to, made the button read "Connect" for someone already connected or
     * already asked: every tap then reached `dial`, threw `already_connected` or
     * `already_pending`, and left the sheet sitting open on an error about a
     * request that had in fact gone out.
     *
     * Both halves of the exchange are still findable. While it is in flight it
     * is filed under the provisional key `connectToPeer` dialled with; once they
     * accept, `reconcile` re-files it onto their real profileId, which the
     * coordinator can still name from the link it answered on.
     */
    const pending = connectionService.stateFor(provisionalKeyFor(selectedPerson.peerId));
    if (pending !== 'none') return pending;

    const settled = queries.profileForPeer(selectedPerson.peerId);
    return settled ? connectionService.stateFor(settled) : ('none' as const);
    // `connections` participates so the button label updates when a request lands.
  }, [selectedPerson, connections]);

  const handleSelect = useCallback((peerId: string) => {
    haptics.select();
    actions.selectPerson(peerId);
  }, []);

  /**
   * Long-press goes straight to Find Me. Selecting then tapping Find is two
   * taps for the second-most-common thing anyone does on this screen, and the
   * gesture is non-destructive and instantly reversible.
   */
  const handleLongPress = useCallback((peerId: string) => {
    haptics.reveal();
    actions.startNavigation(peerId);
  }, []);

  const handleOpenProfile = useCallback((peerId: string) => {
    haptics.reveal();
    actions.selectPerson(peerId);
    setConnectNotice(null);
    setProfileOpen(true);
  }, []);

  const handleNavigate = useCallback(() => {
    if (!selectedPerson) return;
    setProfileOpen(false);
    actions.startNavigation(selectedPerson.peerId);
  }, [selectedPerson]);

  const handleConnect = useCallback(() => {
    trace('Connect', 'pressed', {
      peerId: selectedPerson?.peerId,
      profileId: selectedPerson?.profileId,
      resolved: selectedPerson?.resolved,
    });
    setConnectNotice(null);
    if (!selectedPerson) return;

    /*
     * No haptic yet. Success used to fire here, on press, so a dial that could
     * not find the peer still buzzed *Success* before painting a red notice —
     * the phone congratulating the user for a request that never left.
     */

    /*
     * Two ways to address the same request.
     *
     * When the directory has resolved this peer we dial the person. When it has
     * not - the ordinary case offline, since nothing maps a rotating peer id to
     * a person without a server - we dial the peer id the radar gave us and let
     * the handshake tell us who they are. Refusing here, as this used to, made
     * the button dead for everyone discovered purely over the radio.
     */
    const attempt = selectedPerson.profileId
      ? actions.connect(selectedPerson.profileId)
      : actions.connectToPeer(selectedPerson.peerId);

    void attempt.then((outcome) => {
      if (outcome.ok) {
        /*
         * Sent: buzz, close, and let the radar carry the news.
         *
         * The confirmation is the root toast rather than anything in this card,
         * which is why the card has to go first — a `Modal` paints over the
         * toast, so a chip shown while this is open would be invisible. Closing
         * also returns the user to the radar, which is where they were heading:
         * nothing here navigates to Chat or to Connections.
         */
        haptics.success();
        setConnectNotice(null);
        setProfileOpen(false);
        /*
         * Clear the selection too, so the radar comes back to rest.
         *
         * Dismissing the card alone leaves `PersonPreviewBar` sitting at the
         * bottom — still that person, still a sheet — which reads as "it did not
         * close". Nothing is lost by dropping it: their node keeps its pending
         * badge, and one tap brings the card back.
         */
        actions.selectPerson(null);
        return;
      }
      /*
       * Failed: stay put. A failure is a thing to read, and the notice below
       * the actions is the only place it is legible — see `connectNotice`.
       */
      haptics.warn();
      setConnectNotice(outcome.message ?? null);
    });
  }, [selectedPerson]);

  /* --------------------------- blocking states --------------------------- */

  const state = scanner?.state ?? 'idle';

  if (state === 'blocked_permission') {
    const copy = scanner?.permission === 'blocked' ? PERMISSION_DENIED_COPY : PERMISSION_RATIONALE;
    return (
      <Gate>
        <EmptyState
          emoji="📡"
          title={copy.title}
          body={copy.body}
          actionLabel={copy.primaryAction}
          onAction={() => {
            if (scanner?.permission === 'blocked') openSettings();
            else void requestBluetoothPermissions().then(() => presence.setPhase('map_foreground'));
          }}
        />
        {copy.recovery ? (
          <AppText variant="caption" tone="tertiary" style={styles.recovery}>
            {copy.recovery}
          </AppText>
        ) : null}
        <Button label="Browse attendees instead" variant="ghost" onPress={onOpenDiscover} />
      </Gate>
    );
  }

  if (state === 'blocked_adapter') {
    return (
      <Gate>
        <EmptyState
          emoji="🔵"
          title={BLUETOOTH_OFF_COPY.title}
          body={BLUETOOTH_OFF_COPY.body}
          actionLabel={canRequestAdapterEnable() ? BLUETOOTH_OFF_COPY.primaryAction : 'Open Settings'}
          onAction={openSettings}
        />
        {!canRequestAdapterEnable() ? (
          <AppText variant="caption" tone="tertiary" style={styles.recovery}>
            {BLUETOOTH_OFF_COPY.recovery}
          </AppText>
        ) : null}
        <Button label="Browse attendees instead" variant="ghost" onPress={onOpenDiscover} />
      </Gate>
    );
  }

  if (state === 'unsupported') {
    return (
      <Gate>
        <EmptyState
          emoji="🙃"
          title={UNSUPPORTED_COPY.title}
          body={UNSUPPORTED_COPY.body}
          actionLabel={UNSUPPORTED_COPY.primaryAction}
          onAction={onOpenDiscover}
        />
      </Gate>
    );
  }

  /* --------------------------- the map --------------------------- */

  const isNavigating = navigation !== null && navigatingPerson !== null;

  return (
    <View style={[styles.root, { backgroundColor: colors.mapCanvas }]}>
      {/* The header is opaque and outside the map, so it never competes with
          the people layer or moves when the map is panned. */}
      {!isNavigating && event ? (
        <View style={styles.header}>
          <EventHeader
            event={event}
            zone={currentZone}
            peopleCount={people.length}
            syncing={sync?.phase === 'syncing' && people.length === 0}
            onLeave={() => setLeaveConfirmOpen(true)}
            onPickZone={() => setZonePickerOpen(true)}
            onOpenSettings={() => onOpenPrivacy?.()}
          />

          <View style={{ backgroundColor: colors.mapCanvas }}>
            {searchOpen ? (
              <View style={styles.searchRow}>
                <TextInput
                  value={mapQuery}
                  onChangeText={actions.setMapQuery}
                  placeholder="Find someone nearby..."
                  placeholderTextColor={colors.textTertiary}
                  autoFocus
                  style={[
                    styles.search,
                    typography.body,
                    {
                      backgroundColor: colors.surfaceSunken,
                      borderColor: colors.border,
                      color: colors.textPrimary,
                    },
                  ]}
                  accessibilityLabel="Search people nearby"
                />
                <Pressable
                  onPress={() => {
                    actions.setMapQuery('');
                    setSearchOpen(false);
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close search"
                  style={styles.searchClose}
                >
                  <AppText variant="caption" tone="secondary">
                    Cancel
                  </AppText>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setSearchOpen(true)}
                accessibilityRole="search"
                accessibilityLabel="Search people nearby"
                style={[
                  styles.searchStub,
                  { backgroundColor: colors.surfaceSunken, borderColor: colors.border },
                ]}
              >
                <AppText variant="caption" tone="tertiary">
                  {'\u{1F50E}  Find someone nearby...'}
                </AppText>
              </Pressable>
            )}

            <FilterBar
              filter={mapFilter}
              onChange={actions.setMapFilter}
              matchCount={matchedPeerIds?.size ?? people.length}
              totalCount={people.length}
              availableCount={availableCount}
              matchesNearbyCount={matchesNearbyCount}
              matchesOnly={Boolean(mapFilter.matchesOnly)}
              onShowMatches={() =>
                actions.setMapFilter(
                  mapFilter.matchesOnly ? {} : { matchesOnly: true },
                )
              }
              onOpenAdvanced={() => setAdvancedOpen(true)}
            />
          </View>
        </View>
      ) : null}

      <EventMap
        people={people}
        heading={heading.heading}
        headingTrusted={heading.quality === 'good' || heading.quality === 'fair'}
        orientation={orientation}
        zoom={zoom}
        selectedPeerId={selectedPeerId}
        navigatingPeerId={navigation?.targetPeerId ?? null}
        matchedPeerIds={matchedPeerIds}
        expandedClusterId={expandedClusterId}
        zones={event?.zones}
        currentZone={currentZone}
        venueNorthOffset={event?.venue.northOffsetDegrees ?? 0}
        venueLatitude={event?.venue.latitude}
        venueLongitude={event?.venue.longitude}
        basemap={basemap}
        recenterNonce={recenterNonce}
        onPanned={setPanned}
        onPinchIn={() => {
          haptics.select();
          actions.setZoom(zoomIn(zoom));
        }}
        onPinchOut={() => {
          haptics.select();
          actions.setZoom(zoomOut(zoom));
        }}
        hintInfo={hintInfo}
        connectionFor={connectionFor}
        onSelect={handleSelect}
        onLongPressPerson={handleLongPress}
        onOpenProfile={handleOpenProfile}
        onExpandCluster={(clusterId) => {
          haptics.reveal();
          actions.expandCluster(clusterId);
        }}
        onBackgroundPress={() => actions.selectPerson(null)}
      />

      {people.length === 0 && !isNavigating ? (
        <View style={styles.emptyOverlay} pointerEvents="box-none">
          {/* "Empty is an answer, not a spinner." The screen's job here is to
              explain the physics rather than imply something is still loading:
              nobody is in range because Bluetooth does not reach that far, and
              the honest next move is the full list. */}
          <EmptyState
            emoji="📡"
            title="Nobody in range yet"
            body={
              `Bluetooth reaches about 15 metres indoors, so this fills up as you walk into the room` +
              ` — not as it loads. Everyone at the event is already on your phone.`
            }
            actionLabel={
              event ? `Browse all ${event.attendeeCount.toLocaleString()}` : 'Browse all attendees'
            }
            onAction={onOpenDiscover}
          />
        </View>
      ) : null}

      {!isNavigating ? (
        <>
          <MapControls
            zoom={zoom}
            orientation={orientation}
            headingQuality={heading.quality}
            panned={panned}
            onZoomIn={() => actions.setZoom(zoomIn(zoom))}
            onZoomOut={() => actions.setZoom(zoomOut(zoom))}
            onRecenter={() => setRecenterNonce((value) => value + 1)}
            onToggleOrientation={actions.toggleOrientation}
            onOpenVenuePlan={() => setVenuePlanOpen(true)}
            onOpenLegend={() => setLegendOpen(true)}
            basemap={basemap}
            basemapAvailable={
              event?.venue.latitude !== undefined && event?.venue.longitude !== undefined
            }
            onToggleBasemap={() => {
              haptics.select();
              actions.toggleBasemap();
            }}
          />
          {!selectedPerson ? (
            walkCandidates.some((candidate) => candidate.match) ? (
              <View style={styles.queueWrap} pointerEvents="box-none">
                <WorthWalkingOver
                  candidates={walkCandidates}
                  totalNearby={people.length}
                  onOpen={(peerId) => {
                    haptics.reveal();
                    handleOpenProfile(peerId);
                  }}
                  onSeeAll={() => {
                    haptics.reveal();
                    setNearbyListOpen(true);
                  }}
                />
              </View>
            ) : (
              <MapStatusStrip
                peopleCount={people.length}
                sync={sync}
                headingQuality={heading.quality}
                offline={sync?.phase === 'offline'}
                advertising={advertiser?.state === 'advertising'}
                onPress={() => {
                  haptics.reveal();
                  setNearbyListOpen(true);
                }}
              />
            )
          ) : null}
        </>
      ) : null}

      {selectedPerson && !profileOpen && !isNavigating ? (
        <PersonPreviewBar
          person={selectedPerson}
          onOpenProfile={() => setProfileOpen(true)}
          onNavigate={handleNavigate}
          onDismiss={() => actions.selectPerson(null)}
        />
      ) : null}

      {isNavigating && navigation && navigatingPerson ? (
        <NavigationOverlay
          state={navigation}
          targetName={navigatingPerson.displayName}
          targetAvatar={navigatingPerson.attendee?.profile.avatar}
          onExit={actions.stopNavigation}
          onOpenProfile={() => handleOpenProfile(navigatingPerson.peerId)}
        />
      ) : null}

      <ProfileCard
        person={selectedPerson}
        visible={profileOpen && selectedPerson !== null}
        connectionState={connectionState}
        match={selectedPerson?.profileId ? queries.matchDetailFor(selectedPerson.profileId) : null}
        starter={selectedPerson?.profileId ? queries.starterFor(selectedPerson.profileId) : null}
        onClose={() => setProfileOpen(false)}
        onConnect={handleConnect}
        connectNotice={connectNotice}
        onCancelRequest={
          selectedPerson?.profileId
            ? () => void actions.cancelConnectionRequest(selectedPerson.profileId as string)
            : undefined
        }
        onDeclineRequest={
          selectedPerson?.profileId
            ? () => void actions.rejectConnectionRequest(selectedPerson.profileId as string)
            : undefined
        }
        onNavigate={handleNavigate}
        onBlock={() => {
          haptics.warn();
          if (selectedPerson?.profileId) void actions.block(selectedPerson.profileId);
          setProfileOpen(false);
        }}
        onReport={(input) => {
          haptics.warn();
          void actions.report(input);
          setProfileOpen(false);
        }}
      />

      <VenuePlanSheet
        event={event}
        visible={venuePlanOpen}
        onClose={() => setVenuePlanOpen(false)}
      />

      <MapLegendSheet visible={legendOpen} onClose={() => setLegendOpen(false)} />

      <ArrivedSheet
        visible={arrivedOpen && arrivedPerson !== null}
        name={arrivedPerson?.displayName ?? ''}
        subtitle={arrivedPerson?.subtitle ?? undefined}
        avatar={arrivedPerson?.attendee?.profile.avatar}
        starters={arrivedStarters}
        context={arrivedContext}
        onSaveWithNote={() => {
          setArrivedOpen(false);
          if (arrivedPerson?.profileId) setSaveNoteFor(arrivedPerson.profileId);
        }}
        onClose={() => {
          setArrivedOpen(false);
          actions.stopNavigation();
        }}
      />

      <SaveWithNoteSheet
        visible={saveNoteFor !== null}
        name={savePersonName}
        avatar={savePersonAvatar}
        eventName={event?.name ?? 'this event'}
        zoneName={currentZone?.name ?? null}
        initialNote={saveNoteFor ? (queries.savedFor(saveNoteFor)?.note ?? '') : ''}
        initialTags={saveNoteFor ? (queries.savedFor(saveNoteFor)?.tags ?? []) : []}
        canConnect={
          saveNoteFor ? queries.connectionStateFor(saveNoteFor) === 'none' : false
        }
        onClose={() => setSaveNoteFor(null)}
        onSave={({ note, tags, connect }) => {
          const profileId = saveNoteFor;
          if (!profileId) return;
          void actions.saveWithNote(profileId, {
            note: note || undefined,
            tags,
            metAtZone: currentZone?.name,
          });
          if (connect) void actions.connect(profileId);
          actions.stopNavigation();
        }}
      />

      <GoalsSheet
        visible={goalsOpen}
        goals={goals}
        onClose={() => setGoalsOpen(false)}
        onSave={(next) => void actions.setGoals(next)}
      />

      <NearbyListSheet
        visible={nearbyListOpen}
        people={people}
        onClose={() => setNearbyListOpen(false)}
        onSelect={handleSelect}
        onNavigate={(peerId) => actions.startNavigation(peerId)}
      />

      <AdvancedFilterSheet
        visible={advancedOpen}
        filter={mapFilter}
        companies={queries.facet('company', 10)}
        skills={queries.facet('skills', 10)}
        onClose={() => setAdvancedOpen(false)}
        onApply={actions.setMapFilter}
      />

      <Sheet
        visible={zonePickerOpen}
        title="Where are you?"
        subtitle={event?.venue.name}
        onClose={() => setZonePickerOpen(false)}
      >
        <ZonePickerList
          zones={event?.zones ?? []}
          currentZoneId={currentZoneId}
          onSelect={(zoneId) => {
            haptics.select();
            actions.setCurrentZone(zoneId);
            setZonePickerOpen(false);
          }}
        />
      </Sheet>

      <Sheet
        visible={leaveConfirmOpen}
        title="Leave this event?"
        onClose={() => setLeaveConfirmOpen(false)}
        footer={
          <>
            <Button
              label="Stay"
              variant="secondary"
              onPress={() => setLeaveConfirmOpen(false)}
              full
            />
            <Button
              label="Leave"
              variant="danger"
              onPress={() => {
                setLeaveConfirmOpen(false);
                void actions.leaveEvent();
              }}
              full
            />
          </>
        }
      >
        <AppText variant="body" tone="secondary">
          You will stop broadcasting, and this event&apos;s attendee list will be removed from your
          phone. Your connections are kept.
        </AppText>
      </Sheet>
    </View>
  );
}

function Gate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.gate, { backgroundColor: colors.background }]}>
      <View style={styles.gateInner}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /**
   * The ranked queue sits where the status strip did: pinned above the tab bar,
   * over the map rather than pushing it up. The radar stays the background of
   * the decision, which is the whole point of putting them on one screen.
   */
  queueWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },

  root: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  search: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    height: 40,
  },
  searchClose: { padding: space.sm },
  searchStub: {
    marginHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    height: 40,
    justifyContent: 'center',
  },
  emptyOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    paddingBottom: 96,
  },
  gate: { flex: 1 },
  gateInner: { flex: 1, justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg },
  recovery: { textAlign: 'center', paddingHorizontal: space.xl },
});
