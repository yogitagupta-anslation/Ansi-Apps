/**
 * RootNavigator — four tabs and two overlays, hand-rolled.
 *
 * A navigation library would be the reflex here, but this app's shape argues
 * against it. There are four peer tabs and two full-screen overlays; no deep
 * linking, no nested stacks, no gestures. What there *is* is a live map whose
 * animations and Bluetooth pipeline must not be torn down when someone glances
 * at Discover and comes back.
 *
 * So the map stays mounted for the life of the session and the other tabs mount
 * lazily on first visit and then stay. `display: none` rather than unmounting
 * is deliberate: React keeps the tree, the map keeps its Animated values, and
 * switching tabs costs nothing.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectionsScreen } from '../screens/ConnectionsScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { EventMapScreen } from '../screens/EventMapScreen';
import { EventSelectionScreen } from '../screens/EventSelectionScreen';
import { MyProfileScreen } from '../screens/MyProfileScreen';
import { PrivacyScreen } from '../screens/PrivacyScreen';
import { EventRecapScreen, type RecapErrand } from '../screens/EventRecapScreen';
import { OnboardingCardScreen } from '../screens/OnboardingCardScreen';
import { actions, queries } from './services';
import { AppText } from '../components/primitives';
import { Toast } from '../components/Toast';
import { IncomingRequestSheet } from '../components/IncomingRequestSheet';
import { sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';

export type TabKey = 'map' | 'discover' | 'connections' | 'me';
type Overlay = 'none' | 'edit_profile' | 'privacy' | 'recap';

/**
 * "Browse", not "Discover". The design renames it deliberately: Discover is a
 * promise the app cannot keep from a tab bar, while Browse says what the tab
 * actually does — it is the whole attendee list, and the flow document leans on
 * it as the escape hatch from an empty radar.
 */
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'map', label: 'Map', icon: '🗺' },
  { key: 'discover', label: 'Browse', icon: '🔎' },
  { key: 'connections', label: 'Network', icon: '🤝' },
  { key: 'me', label: 'Me', icon: '👤' },
];

export function RootNavigator(): React.ReactElement {
  const { colors } = useTheme();
  const boot = useStore(sessionStore, (state) => state.boot);
  const pendingConnections = useStore(
    sessionStore,
    (state) => state.connections.filter((c) => c.state === 'incoming_pending').length,
  );

  const event = useStore(sessionStore, (state) => state.event);
  /**
   * Requests live at the root, not inside a screen.
   *
   * Someone can send you a request while you are reading a profile, filtering
   * Discover or editing your own card. Rendering the sheet here means it reaches
   * the user wherever they are, and — because it sits above the tab tree — it
   * cannot be lost behind a screen that happens to be unmounted.
   */
  const incomingRequests = useStore(sessionStore, (state) => state.incomingRequests);
  const profile = useStore(sessionStore, (state) => state.profile);
  const saved = useStore(sessionStore, (state) => state.saved);
  const cardsOpened = useStore(sessionStore, (state) => state.cardsOpened);

  /**
   * A saved person with a note is an errand; one without is just a name. Only
   * the former belongs under "do this before you forget", or the list stops
   * being a to-do list and the user stops reading it.
   */
  const errands = useMemo<RecapErrand[]>(
    () =>
      saved
        .filter((person) => person.note && person.note.trim().length > 0)
        .map((person) => ({
          saved: person,
          attendee: queries.attendee(person.profileId),
          note: person.note as string,
        })),
    [saved],
  );

  const nextEvent = useMemo(() => queries.upcomingEvent(), [event]);

  const [tab, setTab] = useState<TabKey>('map');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set<TabKey>(['map']));

  useEffect(() => {
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)));
  }, [tab]);

  if (boot === 'onboarding' && profile) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <OnboardingCardScreen
          profile={profile}
          onDone={(input) => void actions.completeOnboarding(input)}
        />
        <Toast />
      </View>
    );
  }

  if (boot !== 'in_event') {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EventSelectionScreen />
        <Toast />
      </View>
    );
  }

  if (overlay === 'edit_profile') {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EditProfileScreen onDone={() => setOverlay('none')} />
        <Toast />
      </View>
    );
  }

  if (overlay === 'recap' && event) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <EventRecapScreen
          event={event}
          saved={saved}
          errands={errands}
          cardsOpened={cardsOpened}
          nextEvent={nextEvent}
          onOpenPerson={() => {
            setOverlay('none');
            setTab('connections');
          }}
          onExport={() => void actions.exportSaved()}
          onDismiss={() => setOverlay('none')}
          onDone={() => {
            setOverlay('none');
            void actions.leaveEvent();
          }}
        />
        <Toast />
      </View>
    );
  }

  if (overlay === 'privacy') {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <PrivacyScreen onBack={() => setOverlay('none')} />
        <Toast />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={styles.body}>
        {/* The map is never unmounted: tearing it down would restart every
            node animation and re-arm the radio for no reason. */}
        <Pane active={tab === 'map'}>
          <EventMapScreen
            onOpenDiscover={() => setTab('discover')}
            onOpenPrivacy={() => setOverlay('privacy')}
          />
        </Pane>

        {visited.has('discover') ? (
          <Pane active={tab === 'discover'}>
            <DiscoverScreen onOpenMap={() => setTab('map')} />
          </Pane>
        ) : null}

        {visited.has('connections') ? (
          <Pane active={tab === 'connections'}>
            <ConnectionsScreen onOpenDiscover={() => setTab('discover')} />
          </Pane>
        ) : null}

        {visited.has('me') ? (
          <Pane active={tab === 'me'}>
            <MyProfileScreen
              onEdit={() => setOverlay('edit_profile')}
              onOpenPrivacy={() => setOverlay('privacy')}
              onEndEvent={() => setOverlay('recap')}
            />
          </Pane>
        ) : null}
      </View>

      <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface }}>
        <View style={[styles.tabBar, { borderTopColor: colors.border }]}>
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                style={styles.tab}
              >
                <View>
                  <AppText variant="body" style={{ opacity: active ? 1 : 0.45 }}>
                    {item.icon}
                  </AppText>
                  {item.key === 'connections' && pendingConnections > 0 ? (
                    <View style={[styles.badge, { backgroundColor: colors.accent }]} />
                  ) : null}
                </View>
                <AppText variant="micro" tone={active ? 'accent' : 'tertiary'}>
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>

      <IncomingRequestSheet
        request={incomingRequests[0] ?? null}
        waiting={Math.max(0, incomingRequests.length - 1)}
        onAccept={() => {
          const request = incomingRequests[0];
          if (request) void actions.acceptConnectionRequest(request.profileId);
        }}
        onDecline={() => {
          const request = incomingRequests[0];
          if (request) void actions.rejectConnectionRequest(request.profileId);
        }}
        onDismiss={() => {
          // Dismissing is not answering. The request stays pending and stays in
          // Connections until it is answered or expires - swiping a sheet away
          // must not silently decline someone.
          setTab('connections');
        }}
      />

      <Toast />
    </View>
  );
}

/**
 * Hidden panes keep their state and their subscriptions but stop receiving
 * touches. `pointerEvents="none"` matters: without it an invisible pane still
 * swallows taps meant for the tab underneath.
 */
function Pane({ active, children }: { active: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <View
      style={[StyleSheet.absoluteFill, !active && styles.hidden]}
      pointerEvents={active ? 'auto' : 'none'}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
  hidden: { opacity: 0 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.xs },
  badge: {
    position: 'absolute',
    top: -2,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
