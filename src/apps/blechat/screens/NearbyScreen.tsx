import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  LayoutAnimation,
  Platform,
  RefreshControl,
  UIManager,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {avatarHue, radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {sharedInterests} from '../config/interests';
import {EmptyState} from '../components/ui/Surface';
import {Screen} from '../components/ui/Screen';
import {BreathingDot, FadeIn, Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {LABELS as LINK_STATE_LABELS} from '../components/ConnectionIndicator';
import {PeerProfileSheet} from '../components/PeerProfileSheet';
import {RECONNECT_MAX_ATTEMPTS} from '../config/constants';
import {describeFailure} from '../ble/LinkErrors';
import {AppText, DenseText} from '../components/AppText';
import {InitialAvatar} from '../components/ui/Primitives';
import {MascotAvatar} from '../components/ui/Mascot';
import {Radar, isLive} from '../components/ui/Radar';
import {
  ConnectRing,
  ConnectedRing,
  StageChecklist,
  isConnecting,
  stageCaption,
} from '../components/ui/ConnectProgress';
import {ByteSparkline, TrafficRing, trafficLabel} from '../components/ui/Traffic';
import {useLinkTraffic} from '../peers/useLinkTraffic';
import {qualityLabel} from '../peers/LinkMetrics';
import {classifyDevice, type DeviceClass} from '../ble/DeviceClassifier';
import {bleChat} from '../services/BleChatService';
import {toggleFavoritePeer, useAppStore, type DiscoveredDevice} from '../state/appStore';
import type {Peer} from '../types/Peer';
import type {LinkState} from '../types/BLE';
import type {RootTabScreenProps} from '../navigation/types';
import {relativeTime} from '../utils/time';
import {isCentralLink} from '../utils/linkId';

// Opt-in flag Android needs for LayoutAnimation outside a native-driver context. A no-op
// everywhere else, so this is safe to call unconditionally at module load.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SortMode = 'match' | 'signal' | 'name' | 'recent';

const SORTS: Array<{key: SortMode; label: string}> = [
  {key: 'match', label: 'Match'},
  {key: 'signal', label: 'Signal'},
  {key: 'name', label: 'Name'},
  {key: 'recent', label: 'Recent'},
];

/**
 * Nearby: who is around, why they are worth talking to, and what you can do about it.
 *
 * The row used to be two competing columns — identity down the left, a stack of badges
 * and buttons down the right — which meant the action you wanted moved vertically
 * depending on how much the left column had to say. It is now three stacked bands, in
 * that order, so the buttons are in the same place on every card whatever state it is
 * in. State, quality, MTU and RSSI collapse into one meta line under the name; the
 * signal bars sit beside it. The three-figure stats banner became the subtitle, and the
 * connect-to-everyone promo became a single dashed line.
 *
 * None of the underlying honesty moved: an unconnectable device still says so, a failed
 * link still leads with its reason, and the quality score is still withheld until there
 * is enough evidence for it to mean anything.
 */
export function NearbyScreen({navigation}: RootTabScreenProps<'Nearby'>) {
  const styles = useStyles();
  const theme = useTheme();

  const devices = useAppStore(s => s.devices);
  const peers = useAppStore(s => s.peers);
  const scanning = useAppStore(s => s.scanning);
  const bluetoothState = useAppStore(s => s.bluetoothState);
  const blockedPeerIds = useAppStore(s => s.blockedPeerIds);
  const favoritePeerIds = useAppStore(s => s.favoritePeerIds);

  // Defaults to what the app is for: finding someone worth talking to, not the strongest
  // radio in the room.
  const [sort, setSort] = useState<SortMode>('match');
  const myInterests = useAppStore(s => s.settings.interests);

  // Scan continuously while this screen is actually being looked at, and fall back to
  // the paced profile on the way out. Someone watching a discovery list wants results
  // now; the same behaviour on every other screen is what drains the battery.
  useFocusEffect(
    useCallback(() => {
      bleChat.setScanIntensity('active');
      return () => bleChat.setScanIntensity('balanced');
    }, []),
  );
  /**
   * Pull-to-rescan.
   *
   * A discovery list is the one screen where "try again" is a real, cheap action, and a
   * drag is how everybody already asks for it. The spinner is held for as long as a scan
   * restart actually takes rather than a fixed beat — the gesture reports the radio's
   * work, not a canned animation.
   */
  const [rescanning, setRescanning] = useState(false);

  const onRescan = useCallback(() => {
    setRescanning(true);
    void bleChat
      .stopScanning()
      .then(() => bleChat.startScanning())
      .catch(err =>
        Alert.alert('Scanning', err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setRescanning(false));
  }, []);

  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [profilePeerId, setProfilePeerId] = useState<string | null>(null);

  /** Chat peers carry live connection state; other devices are display-only. */
  const peerByLink = useMemo(() => {
    const map = new Map<string, Peer>();
    for (const peer of peers) {
      if (peer.linkId) {
        map.set(peer.linkId, peer);
      }
    }
    return map;
  }, [peers]);

  const rows = useMemo(() => {
    let list = devices.map(device => ({
      device,
      cls: classifyDevice(device.serviceUuids, device.name),
      peer: peerByLink.get(device.linkId) ?? null,
    }));

    if (verifiedOnly) {
      list = list.filter(row => row.peer?.authenticated);
    }

    return list.sort((a, b) => {
      // Chat peers first regardless of sort: they are the only actionable rows.
      if (a.cls.kind !== b.cls.kind) {
        if (a.cls.kind === 'chat') {
          return -1;
        }
        if (b.cls.kind === 'chat') {
          return 1;
        }
      }
      // Favorites next, ahead of whatever sort mode is chosen — pinning someone is a
      // stronger, more deliberate signal than any automatic ranking.
      const aFav = a.peer?.peerId ? favoritePeerIds.includes(a.peer.peerId) : false;
      const bFav = b.peer?.peerId ? favoritePeerIds.includes(b.peer.peerId) : false;
      if (aFav !== bFav) {
        return aFav ? -1 : 1;
      }
      if (sort === 'match') {
        const shared = (row: typeof a) =>
          row.peer ? sharedInterests(myInterests, row.peer.interests).length : 0;
        const diff = shared(b) - shared(a);
        if (diff !== 0) {
          return diff;
        }
        // Equal overlap: fall through to signal, so the nearer person comes first.
        return (b.device.rssi ?? -200) - (a.device.rssi ?? -200);
      }
      if (sort === 'name') {
        const label = (row: typeof a) =>
          row.peer?.displayName ?? row.device.name ?? 'zz';
        return label(a).localeCompare(label(b));
      }
      if (sort === 'recent') {
        return b.device.lastSeen - a.device.lastSeen;
      }
      return (b.device.rssi ?? -200) - (a.device.rssi ?? -200);
    });
  }, [devices, peerByLink, sort, myInterests, verifiedOnly, favoritePeerIds]);

  /**
   * What actually renders: chat-capable devices only. A stranger's headphones or a
   * fitness band advertise BLE too, but there is nothing this app can do with them — no
   * chat service, nobody to message — so listing them next to real people was pure
   * clutter, and on a real phone in a crowded room, real cost: every one of them was
   * still a row this screen re-sorted and re-rendered once a second. `rows` (all of it)
   * remains the source for the true total and the connectable/not-connectable counts.
   */
  const chatRows = useMemo(
    () => rows.filter(row => row.cls.kind === 'chat'),
    [rows],
  );
  const otherDevicesCount = rows.length - chatRows.length;

  // Rows the list actually shows change as chat devices are seen or go stale; animating
  // that instead of snapping is what turns "the list keeps jumping" into something that
  // reads as alive. Keyed on the filtered count, not the raw scan total — a stranger's
  // headphones going in and out of range must not trigger this.
  const rowCount = chatRows.length;
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, [rowCount]);

  /**
   * People we have talked to who are not advertising right now.
   *
   * Kept in their own section rather than mixed into the live scan: a row you cannot act
   * on this second is not the same as one you can, and interleaving them makes the list
   * look like it is flickering as peers come and go.
   */
  const recent = useMemo(() => {
    // Keyed on both identity and link: an advertisement that has not finished its
    // handshake has no peerId yet, so matching on peerId alone let the same person
    // appear live above and "Not in range · seen just now" below at the same time.
    const inRange = new Set<string>();
    for (const row of chatRows) {
      if (row.peer?.peerId) inRange.add(row.peer.peerId);
      if (row.peer?.peerIdPrefix) inRange.add(`p:${row.peer.peerIdPrefix}`);
      if (row.device.linkId) inRange.add(`l:${row.device.linkId}`);
    }
    return peers
      .filter(
        p =>
          p.peerId !== null &&
          !inRange.has(p.peerId) &&
          !(p.peerIdPrefix && inRange.has(`p:${p.peerIdPrefix}`)) &&
          !(p.linkId && inRange.has(`l:${p.linkId}`)),
      )
      .sort((a, b) => {
        const aFav = a.peerId ? favoritePeerIds.includes(a.peerId) : false;
        const bFav = b.peerId ? favoritePeerIds.includes(b.peerId) : false;
        if (aFav !== bFav) {
          return aFav ? -1 : 1;
        }
        return b.lastSeen - a.lastSeen;
      });
  }, [chatRows, peers, favoritePeerIds]);

  // isConnectable is null on iOS, where the platform does not expose it. Unknown is
  // counted as connectable rather than inventing a "not connectable" claim. Scoped to
  // chat-capable devices only — whether a stranger's headphones are "connectable" is not
  // a question this app has an answer worth showing.
  /**
   * The radar's contents: everything chat-capable in range, at its measured signal.
   *
   * `live` is what drives each blip's ripple, and it is a fact about the radio — heard
   * from in the last few seconds — not a decorative loop.
   */
  const blips = useMemo(
    () =>
      chatRows.map(row => ({
        key: row.device.linkId,
        name: row.peer?.displayName ?? row.device.name ?? 'Someone',
        rssi: row.device.rssi,
        live: isLive(row.device.lastSeen),
      })),
    [chatRows],
  );

  const notConnectable = chatRows.filter(r => r.device.isConnectable === false).length;
  const connectable = chatRows.length - notConnectable;

  const toggleScan = useCallback(() => {
    const action = scanning ? bleChat.stopScanning() : bleChat.startScanning();
    action.catch(err =>
      Alert.alert('Scanning', err instanceof Error ? err.message : String(err)),
    );
  }, [scanning]);

  const onConnectAll = useCallback(() => {
    const queued = bleChat.connectToEveryone();
    Alert.alert(
      queued > 0 ? 'Connecting' : 'Nothing to connect to',
      queued > 0
        ? `${queued} peer(s) queued. They are dialled a few at a time — issuing every ` +
            'connect at once is one of the most reliable ways to make them all fail.'
        : 'Every peer in range is already connected.',
    );
  }, []);

  const onCancel = useCallback((linkId: string) => {
    bleChat.peerManager.cancelConnect(linkId).catch(() => undefined);
  }, []);

  const onConnect = useCallback((linkId: string) => {
    bleChat.peerManager.connect(linkId).catch(err =>
      Alert.alert(
        'Connection failed',
        err instanceof Error ? err.message : String(err),
      ),
    );
  }, []);

  const onOpenChat = useCallback(
    (peer: Peer) => {
      if (!peer.peerId) {
        return;
      }
      navigation.navigate('Chat', {
        peerId: peer.peerId,
        displayName: peer.displayName ?? 'Peer',
      });
    },
    [navigation],
  );

  const onBlock = useCallback((peerId: string, name: string) => {
    Alert.alert(
      `Block ${name}?`,
      "You won't connect to them again, and any live link is closed now. " +
        'Undo this any time from Settings > Blocked.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            bleChat.peerManager.blockPeer(peerId);
            // Harmless if the profile sheet was not open: closing an already-closed
            // sheet is a no-op.
            setProfilePeerId(null);
          },
        },
      ],
    );
  }, []);

  /**
   * The three figures that used to be a stat banner, as one line.
   *
   * They were never worth a card each: "3 peers · 3 connectable · 4 other devices
   * hidden" says the same thing in a fifth of the height, and the count that matters is
   * already the first thing on the line.
   */
  const subtitleTail = [
    `${connectable} connectable`,
    notConnectable > 0 ? `${notConnectable} not connectable` : null,
    otherDevicesCount > 0
      ? `${otherDevicesCount} other device${otherDevicesCount === 1 ? '' : 's'} hidden`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen>
      <FlatList
        data={chatRows}
        keyExtractor={item => item.device.linkId}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={rescanning}
            onRefresh={onRescan}
            tintColor={theme.accent}
            colors={[theme.accent]}
            progressBackgroundColor={theme.surface}
          />
        }
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <AppText style={styles.title} numberOfLines={1}>
                  Nearby
                </AppText>
                <View style={styles.subtitleRow}>
                  {/* The dot only lives while a scan does. A static one would look the
                      same whether the radio is sweeping or wedged — which is also why
                      the word beside it says "Scanning" rather than relying on the beat,
                      since reduce-motion holds the dot still. */}
                  <BreathingDot
                    size={6}
                    active={scanning}
                    color={scanning ? theme.accent : theme.textFaint}
                  />
                  <DenseText style={styles.subtitle} numberOfLines={1}>
                    {scanning ? 'Scanning' : 'Not scanning'}
                    {' · '}
                    {chatRows.length} peer{chatRows.length === 1 ? '' : 's'}
                    {subtitleTail ? ` · ${subtitleTail}` : ''}
                  </DenseText>
                </View>
              </View>
              {/* A word in the accent, not a filled chip. This is the one action on the
                  screen, and the screen below it is now a list of rows with no fills at
                  all — a lavender pill up here would be the loudest thing on it. */}
              <Touchable
                scale={false}
                onPress={toggleScan}
                style={styles.stopButton}
                accessibilityRole="button"
                accessibilityLabel={scanning ? 'Stop scanning' : 'Start scanning'}>
                <DenseText style={styles.stopText}>
                  {scanning ? 'Stop' : 'Scan'}
                </DenseText>
              </Touchable>
            </View>

            {/* Four sort modes, all visible. The old control was a single button that
                cycled through them, so choosing one meant tapping until the right label
                came up and there was no way to see what the others were. */}
            <View style={styles.controls}>
              <View style={styles.segmented}>
                {SORTS.map(option => {
                  const active = option.key === sort;
                  return (
                    <Touchable
                      key={option.key}
                      scale={false}
                      onPress={() => setSort(option.key)}
                      accessibilityLabel={`Sort by ${option.label}`}
                      accessibilityState={{selected: active}}
                      style={
                        active ? [styles.segment, styles.segmentActive] : styles.segment
                      }>
                      <DenseText
                        style={active ? styles.segmentTextActive : styles.segmentText}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1}>
                        {option.label}
                      </DenseText>
                    </Touchable>
                  );
                })}
              </View>
              <Touchable
                scale={false}
                onPress={() => setVerifiedOnly(v => !v)}
                accessibilityLabel="Show verified peers only"
                accessibilityState={{selected: verifiedOnly}}
                style={
                  verifiedOnly
                    ? [styles.filterButton, styles.filterButtonActive]
                    : styles.filterButton
                }>
                <Icon
                  name="shield"
                  color={verifiedOnly ? theme.ok : theme.textDim}
                  size={15}
                />
              </Touchable>
            </View>

            {/* The map, above the list. Not instead of it: the radar answers "who is
                around and how close", the rows answer "what can I do about them". */}
            {chatRows.length > 0 ? (
              <DiscoveryRadar blips={blips} scanning={scanning} />
            ) : null}

            {/* Dashed, and one line. As a full promo card with an icon tile and two
                lines of copy it read as an advertisement for a feature rather than a
                thing you could tap. */}
            {chatRows.length > 0 ? (
              <Touchable scale={false} onPress={onConnectAll} style={styles.connectAll}>
                <Icon name="broadcast" color={theme.textDim} size={15} />
                <DenseText style={styles.connectAllText} numberOfLines={1}>
                  Connect to all {chatRows.length} — dialled one at a time
                </DenseText>
                <DenseText style={styles.connectAllGo}>Go</DenseText>
              </Touchable>
            ) : null}

            {/* The list below is people who are in range right now; the footer's EARLIER
                is people who were. Naming both is what makes the second one legible. */}
            {chatRows.length > 0 ? (
              <View style={styles.ruleHeader}>
                <DenseText style={styles.ruleTitle}>IN RANGE</DenseText>
              </View>
            ) : null}
          </>
        }
        renderItem={({item, index}) => (
          <FadeIn index={index}>
            <PeerCard
              device={item.device}
              cls={item.cls}
              peer={item.peer}
              myInterests={myInterests}
              onConnect={onConnect}
              onCancel={onCancel}
              onOpenChat={onOpenChat}
              onBlock={onBlock}
              onOpenProfile={setProfilePeerId}
            />
          </FadeIn>
        )}
        ListFooterComponent={
          recent.length > 0 ? (
            <View style={styles.recentBlock}>
              <View style={styles.ruleHeader}>
                <DenseText style={styles.ruleTitle}>EARLIER</DenseText>
              </View>
              {recent.map((peer, index) => (
                <FadeIn key={peer.peerId!} index={index}>
                  <RecentRow
                    peer={peer}
                    onConnect={onConnect}
                    onOpenChat={onOpenChat}
                    onOpenProfile={setProfilePeerId}
                  />
                </FadeIn>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          bluetoothState === 'PoweredOn' && scanning ? (
            <DiscoveryRadar blips={blips} scanning={scanning} />
          ) : (
            <EmptyState
              glyph={bluetoothState === 'PoweredOn' ? '◎' : '⃠'}
              title={bluetoothState !== 'PoweredOn' ? 'Bluetooth is off' : 'Not scanning'}
              detail={
                bluetoothState !== 'PoweredOn'
                  ? 'Turn Bluetooth on to find people nearby.'
                  : 'Tap Scan to look for nearby Bluetooth LE devices.'
              }
            />
          )
        }
      />
      <PeerProfileSheet
        visible={profilePeerId !== null}
        peer={peers.find(p => p.peerId === profilePeerId) ?? null}
        myInterests={myInterests}
        blocked={profilePeerId !== null && blockedPeerIds.includes(profilePeerId)}
        onClose={() => setProfilePeerId(null)}
        onBlock={() => {
          const p = peers.find(x => x.peerId === profilePeerId);
          if (p?.peerId) {
            onBlock(p.peerId, p.displayName ?? 'this person');
          }
        }}
        onUnblock={() => {
          if (profilePeerId) {
            bleChat.peerManager.unblockPeer(profilePeerId);
          }
        }}
        onOpenChat={
          profilePeerId
            ? () => {
                const p = peers.find(x => x.peerId === profilePeerId);
                if (p) {
                  setProfilePeerId(null);
                  onOpenChat(p);
                }
              }
            : undefined
        }
      />
    </Screen>
  );
}

/**
 * The scanning empty state — the radar the pull gesture turns into.
 *
 * Only shown while a scan is actually running with Bluetooth on: that is the one state
 * where "still looking" is true and an animated illustration does not lie about what the
 * app is doing. Bluetooth-off and not-scanning fall back to the plain `EmptyState`, since
 * a sweeping radar behind "turn Bluetooth on" would say the opposite of what is true.
 *
 * With peers in range this is not an empty state at all — it is the map of them, which is
 * why it also renders above the list.
 */
function DiscoveryRadar({
  blips,
  scanning,
}: {
  blips: React.ComponentProps<typeof Radar>['blips'];
  scanning: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.radarWrap}>
      <Radar size={260} blips={blips} scanning={scanning} />
      <DenseText style={styles.radarCaption}>
        {blips.length === 0
          ? 'Anything advertising in range will appear here.'
          : 'Distance from centre is measured RSSI — nothing is placed for looks.'}
      </DenseText>
    </View>
  );
}

/** A small tap target inline with the name, rather than another absolute-positioned
 * corner icon competing with the block button for the same real estate. */
function FavoriteStar({peerId}: {peerId: string}) {
  const theme = useTheme();
  const isFavorite = useAppStore(s => s.favoritePeerIds.includes(peerId));
  return (
    <Touchable
      scale={false}
      onPress={() => toggleFavoritePeer(peerId)}
      hitSlop={8}
      accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
      <Icon
        name={isFavorite ? 'starFilled' : 'star'}
        color={isFavorite ? theme.tileAmberFg : theme.textFaint}
        size={14}
      />
    </Touchable>
  );
}

/**
 * One person, in three bands: who they are, why they are worth your time, and what you
 * can do about it.
 *
 * The action band is always last and always the same height, so the button you want does
 * not move between a peer with four shared interests and one with none.
 */
function PeerCard({
  device,
  cls,
  peer,
  myInterests,
  onConnect,
  onCancel,
  onOpenChat,
  onBlock,
  onOpenProfile,
}: {
  device: DiscoveredDevice;
  cls: DeviceClass;
  peer: Peer | null;
  myInterests: string[];
  onConnect: (linkId: string) => void;
  onCancel: (linkId: string) => void;
  onOpenChat: (peer: Peer) => void;
  onBlock: (peerId: string, name: string) => void;
  onOpenProfile: (peerId: string) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();

  const connected = peer?.state === 'connected';
  const reconnecting = peer?.state === 'reconnecting' || (peer?.reconnectAttempt ?? 0) > 0;
  const connecting = peer !== null && isConnecting(peer.state);
  const traffic = useLinkTraffic(peer);
  const busy =
    peer !== null &&
    peer.state !== 'connected' &&
    peer.state !== 'disconnected' &&
    peer.state !== 'failed' &&
    peer.state !== 'discovering';
  const failed = !connected && !busy && !reconnecting && !!peer?.failure;
  const unconnectable = device.isConnectable === false;

  const name = peer?.displayName ?? device.name ?? 'Someone nearby';

  /**
   * A word and a measurement, split.
   *
   * These used to be one joined sentence — state, quality, MTU and signal all in the same
   * grey run-on. They are two different kinds of thing: the first is a STATUS, which is
   * what colour is for in this app, and the rest are MEASUREMENTS, which belong in mono
   * so a column of them aligns down the list. Every value that was in the sentence is
   * still here.
   */
  const word = failed
    ? describeFailure(peer!.failure!)
    : connected
    ? traffic.active
      ? trafficLabel(traffic)
      : 'Connected'
    : connecting
    ? stageCaption(peer!.state)
    : reconnecting
    ? `Reconnecting ${peer!.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}`
    : busy
    ? LINK_STATE_LABELS[peer!.state]
    : unconnectable
    ? 'Not connectable'
    : 'Available';

  const wordColor = failed
    ? theme.error
    : connected
    ? theme.ok
    : reconnecting || busy || connecting
    ? theme.warn
    : unconnectable
    ? theme.textDim
    : theme.textDim;

  // U+2212, not a hyphen: in a mono column the true minus is the width of a digit, so
  // the values line up on their first significant figure instead of drifting a pixel.
  const measurement = [
    device.rssi !== null ? String(device.rssi).replace('-', '−') : null,
    connected && peer?.gatt ? String(peer.gatt.mtu) : null,
    connected ? qualityLabel(peer?.metrics?.quality ?? null) : null,
    connected ? null : `seen ${relativeTime(device.lastSeen)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const shared = peer ? sharedInterests(myInterests, peer.interests) : [];
  const rest = (peer?.interests ?? []).filter(
    i => !shared.some(s => s.toLowerCase() === i.toLowerCase()),
  );

  return (
    <View style={styles.row}>
      {/* ---- who ---- */}
      <View style={styles.rowHead}>
        <Ringed
          state={peer?.state ?? null}
          trafficActive={traffic.active}
          uptimeMs={peer?.metrics?.currentUptimeMs ?? 0}>
          {peer?.peerId ? (
            <Touchable
              scale={false}
              onPress={() => onOpenProfile(peer.peerId!)}
              accessibilityLabel={`View ${name}'s profile`}>
              <MascotAvatar
                size={38}
                tint={avatarHue(theme, peer.peerId).fg}
                status={connected ? theme.ok : null}
              />
            </Touchable>
          ) : (
            <MascotAvatar
              size={38}
              tint={failed ? theme.neutral : avatarHue(theme, device.linkId).fg}
              faded={failed ? 0.5 : 0}
            />
          )}
        </Ringed>

        <View style={styles.rowBody}>
          <View style={styles.nameRow}>
            <AppText style={styles.name} numberOfLines={1}>
              {name}
            </AppText>
            {/* Every handshake is authenticated or the link never reaches "connected" —
                this is not a claim beyond what the crypto already proved. */}
            {peer?.authenticated ? (
              <Icon name="shield" color={theme.ok} size={12} strokeWidth={2} />
            ) : null}
            {peer?.peerId ? <FavoriteStar peerId={peer.peerId} /> : null}
          </View>
          <View style={styles.metaRow}>
            <DenseText style={[styles.metaWord, {color: wordColor}]} numberOfLines={1}>
              {word}
            </DenseText>
            {measurement.length > 0 ? (
              <DenseText style={styles.metaValue} numberOfLines={1}>
                {measurement}
              </DenseText>
            ) : null}
          </View>
        </View>

        <RowAction
          styles={styles}
          unconnectable={unconnectable}
          cls={cls}
          connected={connected}
          busy={busy}
          reconnecting={reconnecting}
          failed={failed}
          onOpenChat={() => onOpenChat(peer!)}
          onCancel={() => onCancel(device.linkId)}
          onConnect={() => onConnect(device.linkId)}
        />

        {/* Profile, block and the failure detail, behind one glyph.
            They were three bordered icon buttons on a row that has just lost its own
            border; as a menu they stay one tap away and stop being three more boxes. */}
        {peer?.peerId || failed ? (
          <Touchable
            scale={false}
            onPress={() =>
              openPeerMenu({
                name,
                peerId: peer?.peerId ?? null,
                failure: failed ? describeFailure(peer!.failure!) : null,
                onOpenProfile,
                onBlock,
              })
            }
            style={styles.more}
            accessibilityLabel={`More options for ${name}`}>
            <AppText style={styles.moreGlyph} maxFontSizeMultiplier={1}>
              ···
            </AppText>
          </Touchable>
        ) : null}
      </View>

      {/* The five stages, named. The ring says how far; this says which — and the name
          is the only part a bug report can use. */}
      {connecting ? <StageChecklist state={peer!.state} /> : null}

      {/* What is actually on the link, for the last few seconds. Rendered only while
          connected: on any other state there is no link to have traffic on. */}
      {connected && traffic.history.some(v => v > 0) ? (
        <ByteSparkline traffic={traffic} />
      ) : null}

      {/* ---- why ----
          Words, not chips, and indented to clear the avatar so they read as belonging to
          the name above rather than starting a new column. Shared ones take the accent;
          the rest stay grey. */}
      {!failed && !connecting && (shared.length > 0 || rest.length > 0) ? (
        <View style={styles.interests}>
          {shared.length > 0 ? (
            <DenseText style={styles.interestShared}>{shared.join(', ')}</DenseText>
          ) : null}
          {shared.length > 0 && rest.length > 0 ? (
            <DenseText style={styles.interestSep}>·</DenseText>
          ) : null}
          {rest.length > 0 ? (
            <DenseText style={styles.interestRest}>{rest.join(', ')}</DenseText>
          ) : null}
        </View>
      ) : null}

    </View>
  );
}

/**
 * The one action on a row.
 *
 * One, not three. Every state here already had a primary thing to do; what it also had
 * was a second and third button competing with it for the same strip of width. The
 * secondary ones now live behind the row's overflow glyph, which leaves this able to sit
 * on the head row beside the name instead of claiming a band of its own.
 *
 * Only the connected state gets the accent outline: an accent on every row is the same
 * as an accent on none.
 */
function RowAction({
  styles,
  unconnectable,
  cls,
  connected,
  busy,
  reconnecting,
  failed,
  onOpenChat,
  onCancel,
  onConnect,
}: {
  styles: ReturnType<typeof useStyles>;
  unconnectable: boolean;
  cls: DeviceClass;
  connected: boolean;
  busy: boolean;
  reconnecting: boolean;
  failed: boolean;
  onOpenChat: () => void;
  onCancel: () => void;
  onConnect: () => void;
}) {
  if (unconnectable) {
    return (
      <View style={[styles.pill, styles.pillDisabled]}>
        <DenseText style={[styles.pillText, styles.pillDisabledText]} numberOfLines={1}>
          {cls.kind === 'chat' ? 'Unreachable' : 'Not chat'}
        </DenseText>
      </View>
    );
  }

  const [label, onPress, accent] = connected
    ? (['Open', onOpenChat, true] as const)
    : busy || reconnecting
    ? // Every attempt keeps a way out: tapping Connect by accident should not commit the
      // phone to a full timeout plus the whole retry budget.
      (['Cancel', onCancel, false] as const)
    : failed
    ? (['Retry', onConnect, false] as const)
    : (['Connect', onConnect, false] as const);

  return (
    <Touchable
      scale={false}
      onPress={onPress}
      style={[styles.pill, accent ? styles.pillAccent : styles.pillNeutral]}>
      <DenseText
        style={[styles.pillText, accent ? styles.pillAccentText : styles.pillNeutralText]}
        numberOfLines={1}>
        {label}
      </DenseText>
    </Touchable>
  );
}

/**
 * The row's overflow menu.
 *
 * A plain Alert rather than a custom sheet: it is two or three destinations, the platform
 * already draws one correctly, and a bespoke sheet here would be a new overlay to
 * maintain for no gain. Block is marked destructive so it reads as the one that cannot be
 * undone by tapping again.
 */
function openPeerMenu({
  name,
  peerId,
  failure,
  onOpenProfile,
  onBlock,
}: {
  name: string;
  peerId: string | null;
  failure: string | null;
  onOpenProfile: (peerId: string) => void;
  onBlock: (peerId: string, name: string) => void;
}): void {
  const buttons: Array<{
    text: string;
    style?: 'cancel' | 'destructive';
    onPress?: () => void;
  }> = [];

  if (failure !== null) {
    buttons.push({
      text: 'Why did this fail?',
      onPress: () => Alert.alert('Why did this fail?', failure),
    });
  }
  if (peerId !== null) {
    buttons.push({text: 'View profile', onPress: () => onOpenProfile(peerId)});
    buttons.push({
      text: 'Block',
      style: 'destructive',
      onPress: () => onBlock(peerId, name),
    });
  }
  buttons.push({text: 'Cancel', style: 'cancel'});

  Alert.alert(name, undefined, buttons);
}

/**
 * Whatever ring the link has earned, if any.
 *
 * Four states, four different things worth saying: mid-connect it is a five-segment
 * progress ring, just-connected it is those segments closed into one with a tick,
 * live-and-carrying-bytes it is an expanding traffic ring, and live-and-idle it is
 * nothing at all. That last one is the important case — a still avatar means
 * a healthy link with nothing on it, which is a different thing from a link in trouble,
 * and a ring that always pulsed could not tell them apart.
 */
function Ringed({
  state,
  trafficActive,
  uptimeMs,
  children,
}: {
  state: LinkState | null;
  trafficActive: boolean;
  /** How long this link has been up, from the transport's own metrics. */
  uptimeMs: number;
  children: React.ReactNode;
}) {
  // Every branch occupies the same box. Letting the ring add its own width would move
  // the name and the meta line sideways the moment a connection started, which is the
  // one place in this card where nothing has actually changed about the text.
  const body =
    state !== null && isConnecting(state) ? (
      <ConnectRing size={44} state={state}>
        {children}
      </ConnectRing>
    ) : // The five segments closing into one. Held on the link's real uptime rather than
    // a timer of our own, so the completion mark cannot outlive the link it marks.
    state === 'connected' && uptimeMs > 0 && uptimeMs < 2500 ? (
      <ConnectedRing size={44}>{children}</ConnectedRing>
    ) : state === 'connected' ? (
      <TrafficRing size={54} active={trafficActive}>
        {children}
      </TrafficRing>
    ) : (
      children
    );

  return <View style={{width: 54, height: 54, alignItems: 'center', justifyContent: 'center'}}>{body}</View>;
}

/**
 * A peer we know but cannot see this second.
 *
 * Deliberately plainer than a live card: there is no signal to show and no state to
 * watch, only who they are and when they were last around. Giving it the full three-band
 * treatment would make an unreachable person look as actionable as a present one.
 */
function RecentRow({
  peer,
  onConnect,
  onOpenChat,
  onOpenProfile,
}: {
  peer: Peer;
  onConnect: (linkId: string) => void;
  onOpenChat: (peer: Peer) => void;
  onOpenProfile: (peerId: string) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  /**
   * Only a central link can be dialled — a peripheral one belongs to the remote peer,
   * who is the only side that can open it. Offering "Connect" on one produced an error
   * dialog every time, and worse, the refusal used to be recorded as a failure against
   * a link that was alive and carrying messages.
   */
  const dialable = peer.linkId !== null && isCentralLink(peer.linkId);
  return (
    <Touchable
      scale={false}
      onPress={() => (dialable ? onConnect(peer.linkId!) : onOpenChat(peer))}
      style={styles.recentRow}>
      <Touchable
        scale={false}
        onPress={() => (peer.peerId ? onOpenProfile(peer.peerId) : undefined)}
        accessibilityLabel="View profile">
        <InitialAvatar
          name={peer.displayName}
          seed={peer.peerId ?? ''}
          size={38}
          bg={theme.surfaceAlt}
          fg={theme.textFaint}
        />
      </Touchable>
      <View style={styles.grow}>
        <AppText style={styles.recentName} numberOfLines={1}>
          {peer.displayName ?? 'Someone you have met'}
        </AppText>
        <DenseText style={styles.recentMeta} numberOfLines={1}>
          Not in range · seen {relativeTime(peer.lastSeen)} · redialled automatically
        </DenseText>
      </View>
      <DenseText style={styles.recentAction}>{dialable ? 'Connect' : 'Chat'}</DenseText>
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  content: {padding: spacing.lg + 4, paddingBottom: spacing.xl},
  grow: {flex: 1},

  // ---- header ------------------------------------------------------------
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md},
  headerText: {flex: 1},
  title: {...typography.display, color: t.text, lineHeight: 32},
  subtitleRow: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9},
  subtitleDot: {width: 6, height: 6, borderRadius: 3},
  subtitle: {...typography.caption, color: t.textDim, flex: 1},
  stopButton: {paddingTop: 6, paddingLeft: spacing.sm},
  stopText: {...typography.callout, color: t.accent},

  // ---- sort --------------------------------------------------------------
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginTop: 22,
    borderBottomWidth: 1,
    borderBottomColor: t.divider,
  },
  // Underlined tabs rather than a raised chip on a filled track. The track was a box and
  // the chip was a box on top of it, for a control whose whole job is to say which one of
  // four words is current — which an underline says with no fill at all.
  segmented: {flex: 1, flexDirection: 'row', gap: 18},
  segment: {alignItems: 'center', paddingBottom: 9, borderBottomWidth: 1.5, borderBottomColor: 'transparent'},
  segmentActive: {borderBottomColor: t.text},
  segmentText: {...typography.caption, color: t.textDim},
  segmentTextActive: {...typography.caption, color: t.text, fontWeight: '500'},
  filterButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  filterButtonActive: {},

  connectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    marginTop: 10,
  },
  connectAllText: {...typography.caption, color: t.textDim, flex: 1},
  connectAllGo: {...typography.callout, color: t.accent},

  // ---- peer row ----------------------------------------------------------
  //
  // Not a card. This was a bordered, shadowed, rounded container holding three stacked
  // bands; it is now a plain row on the page with a hairline beneath it. The negative
  // margin cancels the list's own padding so that hairline runs edge to edge, which is
  // what makes a run of rows read as one list rather than as a stack of separate things.
  row: {
    marginHorizontal: -(spacing.lg + 4),
    paddingHorizontal: spacing.lg + 4,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: t.divider,
  },
  rowHead: {flexDirection: 'row', alignItems: 'center', gap: 13},
  rowBody: {flex: 1, minWidth: 0},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  name: {...typography.headline, color: t.text, flexShrink: 1},
  nameMuted: {...typography.headline, fontWeight: '400', color: t.textDim, flexShrink: 1},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3},
  // The status word carries the colour; nothing behind it does.
  metaWord: {...typography.caption, flexShrink: 1},
  // Measurements are mono so a column of them aligns down the list and stops competing
  // with the name, which is the thing you actually scan for.
  metaValue: {...typography.monoSmall, color: t.textDim},

  // Shared interests are coloured words rather than filled chips: the accent still marks
  // them, without adding four more boxes to a row that just lost its own.
  interests: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    // Clears the 38pt avatar and its 13pt gap, so the line hangs under the name.
    paddingLeft: 51,
  },
  interestShared: {...typography.caption, color: t.accentQuiet},
  interestRest: {...typography.caption, color: t.textDim},
  interestSep: {...typography.caption, color: t.separator},

  // One pill, on the right of the head row, sized to its label.
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexShrink: 0,
  },
  pillText: {...typography.callout},
  pillAccent: {borderColor: t.accent},
  pillAccentText: {color: t.accent},
  pillNeutral: {borderColor: t.border},
  pillNeutralText: {color: t.text},
  pillDisabled: {borderColor: t.divider},
  pillDisabledText: {color: t.textFaint},
  // The overflow affordance, in the same language as the thread header's.
  more: {paddingHorizontal: 6, paddingVertical: 4, flexShrink: 0},
  moreGlyph: {fontSize: 17, color: t.textDim, lineHeight: 20},

  // ---- recently connected ------------------------------------------------
  recentBlock: {marginTop: 6},
  // A label and space, no rule line. The hairlines under the rows already say where one
  // group stops; a second horizontal line above the label was drawing the same boundary
  // twice.
  ruleHeader: {marginTop: 26, marginBottom: 2},
  ruleTitle: {...typography.overline, color: t.textDim},
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginHorizontal: -(spacing.lg + 4),
    paddingHorizontal: spacing.lg + 4,
    paddingVertical: spacing.lg,
  },
  recentName: {...typography.headline, fontWeight: '400', color: t.textDim},
  recentMeta: {...typography.caption, color: t.textDim, marginTop: 3},
  recentAction: {...typography.callout, color: t.accent},

  // ---- radar ---------------------------------------------------------------
  radarWrap: {alignItems: 'center', paddingTop: 6, paddingBottom: spacing.lg},
  radarCaption: {
    ...typography.caption,
    color: t.textFaint,
    fontSize: 11,
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
}));
