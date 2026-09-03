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
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {sharedInterests} from '../config/interests';
import {EmptyState} from '../components/ui/Surface';
import {Screen} from '../components/ui/Screen';
import {FadeIn, Pulse, Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {LABELS as LINK_STATE_LABELS} from '../components/ConnectionIndicator';
import {PeerProfileSheet} from '../components/PeerProfileSheet';
import {RECONNECT_MAX_ATTEMPTS} from '../config/constants';
import {describeFailure} from '../ble/LinkErrors';
import {AppText, DenseText} from '../components/AppText';
import {InitialAvatar, SignalBars} from '../components/ui/Primitives';
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
    const inRange = new Set(chatRows.map(r => r.peer?.peerId).filter(Boolean));
    return peers
      .filter(p => p.peerId !== null && !inRange.has(p.peerId))
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
                      same whether the radio is sweeping or wedged. */}
                  <Pulse active={scanning}>
                    <View
                      style={[
                        styles.subtitleDot,
                        {backgroundColor: scanning ? theme.accent : theme.textFaint},
                      ]}
                    />
                  </Pulse>
                  <DenseText style={styles.subtitle} numberOfLines={1}>
                    <DenseText style={styles.subtitleStrong}>
                      {chatRows.length} peer{chatRows.length === 1 ? '' : 's'}
                    </DenseText>
                    {subtitleTail ? ` · ${subtitleTail}` : ''}
                  </DenseText>
                </View>
              </View>
              {/* Filled lavender chip rather than an outline, and purple rather than red
                  — this is a mode toggle (Scan/Stop), not a destructive action, so it
                  reads as the brand's own control language rather than a warning. */}
              <Touchable scale={false} onPress={toggleScan} style={styles.stopButton}>
                <Icon
                  name={scanning ? 'stop' : 'radar'}
                  color={theme.accent}
                  size={scanning ? 12 : 14}
                />
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
                <DenseText style={styles.ruleTitle}>RECENTLY CONNECTED</DenseText>
                <View style={styles.rule} />
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
   * One line, not four badges.
   *
   * State, quality, MTU and signal were a pill, a pill, a fragment and a number spread
   * across two columns. Every one of them is still here — they are just facts about the
   * same link, so they read as one sentence about it.
   */
  const meta = failed
    ? describeFailure(peer!.failure!)
    : [
        connected
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
          : 'Available',
        connected ? qualityLabel(peer?.metrics?.quality ?? null) : null,
        connected && peer?.gatt ? `MTU ${peer.gatt.mtu}` : null,
        device.rssi !== null ? `${device.rssi} dBm` : null,
        connected ? null : `seen ${relativeTime(device.lastSeen)}`,
      ]
        .filter(Boolean)
        .join(' · ');

  const shared = peer ? sharedInterests(myInterests, peer.interests) : [];
  const rest = (peer?.interests ?? []).filter(
    i => !shared.some(s => s.toLowerCase() === i.toLowerCase()),
  );

  return (
    <View style={failed ? [styles.card, styles.cardFailed] : styles.card}>
      {/* ---- who ---- */}
      <View style={styles.cardHead}>
        <Ringed
          state={peer?.state ?? null}
          trafficActive={traffic.active}
          uptimeMs={peer?.metrics?.currentUptimeMs ?? 0}>
          {peer?.peerId ? (
            <Touchable
              scale={false}
              onPress={() => onOpenProfile(peer.peerId!)}
              accessibilityLabel={`View ${name}'s profile`}>
              <InitialAvatar
                name={name}
                seed={peer.peerId}
                size={44}
                online={connected ? true : undefined}
                bg={failed ? theme.error + '1f' : undefined}
                fg={failed ? theme.error : undefined}
              />
            </Touchable>
          ) : (
            <InitialAvatar
              name={name}
              seed={device.linkId}
              size={44}
              bg={failed ? theme.error + '1f' : undefined}
              fg={failed ? theme.error : undefined}
            />
          )}
        </Ringed>

        <View style={styles.cardHeadBody}>
          <View style={styles.nameRow}>
            <AppText style={styles.name} numberOfLines={1}>
              {name}
            </AppText>
            {/* Every handshake is authenticated or the link never reaches "connected" —
                this is not a claim beyond what the crypto already proved. */}
            {peer?.authenticated ? (
              <Icon name="shield" color={theme.ok} size={13} strokeWidth={2} />
            ) : null}
            {peer?.peerId ? <FavoriteStar peerId={peer.peerId} /> : null}
            {failed ? (
              <View style={[styles.statePill, {backgroundColor: theme.error + '1f'}]}>
                <DenseText
                  style={[styles.statePillText, {color: theme.error}]}
                  maxFontSizeMultiplier={1}>
                  FAILED
                </DenseText>
              </View>
            ) : null}
            <View style={styles.grow} />
            {!failed ? <SignalBars rssi={device.rssi} size="sm" /> : null}
          </View>
          <DenseText
            style={failed ? [styles.meta, {color: theme.error}] : styles.meta}
            numberOfLines={2}>
            {meta}
          </DenseText>
        </View>
      </View>

      {/* The five stages, named. The ring says how far; this says which — and the name
          is the only part a bug report can use. */}
      {connecting ? <StageChecklist state={peer!.state} /> : null}

      {/* What is actually on the link, for the last few seconds. Rendered only while
          connected: on any other state there is no link to have traffic on. */}
      {connected && traffic.history.some(v => v > 0) ? (
        <ByteSparkline traffic={traffic} />
      ) : null}

      {/* ---- why ---- */}
      {!failed && !connecting && (shared.length > 0 || rest.length > 0) ? (
        <View style={styles.interests}>
          {shared.map(interest => (
            <View key={interest} style={styles.chipShared}>
              <DenseText style={styles.chipSharedText} maxFontSizeMultiplier={1}>
                {interest}
              </DenseText>
            </View>
          ))}
          {shared.length > 0 ? (
            <DenseText style={styles.sharedCount} maxFontSizeMultiplier={1}>
              {shared.length} shared
            </DenseText>
          ) : null}
          {rest.map(interest => (
            <View key={interest} style={styles.chip}>
              <DenseText style={styles.chipText} maxFontSizeMultiplier={1}>
                {interest}
              </DenseText>
            </View>
          ))}
        </View>
      ) : null}

      {/* ---- what you can do ---- */}
      <View style={styles.actions}>
        {unconnectable ? (
          <View style={[styles.actionPrimary, styles.actionDisabled]}>
            <DenseText style={styles.actionDisabledText} numberOfLines={1}>
              {cls.kind === 'chat' ? 'Not connectable' : 'Not a BLE Chat device'}
            </DenseText>
          </View>
        ) : connected && peer ? (
          <Touchable
            scale={false}
            onPress={() => onOpenChat(peer)}
            style={[styles.actionPrimary, styles.actionFilled]}>
            <Icon name="chatBubble" color={theme.onAccent} size={14} />
            <DenseText style={styles.actionFilledText}>Open chat</DenseText>
          </Touchable>
        ) : busy || reconnecting ? (
          // Every attempt gets a way out. Tapping Connect by accident should not commit
          // the phone to a full timeout plus the whole retry budget.
          <Touchable
            scale={false}
            onPress={() => onCancel(device.linkId)}
            style={[styles.actionPrimary, styles.actionOutlineNeutral]}>
            <DenseText style={styles.actionOutlineNeutralText}>Cancel</DenseText>
          </Touchable>
        ) : failed ? (
          <>
            <Touchable
              scale={false}
              onPress={() => onConnect(device.linkId)}
              style={[styles.actionPrimary, styles.actionOutlineNeutral]}>
              <DenseText style={styles.actionOutlineNeutralText}>Retry</DenseText>
            </Touchable>
            <Touchable
              scale={false}
              onPress={() =>
                Alert.alert('Why did this fail?', describeFailure(peer!.failure!))
              }
              style={[styles.actionPrimary, styles.actionPlain]}>
              <DenseText style={styles.actionPlainText} numberOfLines={1}>
                Why did this fail?
              </DenseText>
            </Touchable>
          </>
        ) : (
          <Touchable
            scale={false}
            onPress={() => onConnect(device.linkId)}
            style={[styles.actionPrimary, styles.actionOutline]}>
            <Icon name="link" color={theme.accent} size={14} />
            <DenseText style={styles.actionOutlineText}>Connect</DenseText>
          </Touchable>
        )}

        {/* A known identity only — blocking a device we have never handshaken with would
            block nothing real, since there is no proven peerId to refuse yet. */}
        {!failed && peer?.peerId ? (
          <>
            <Touchable
              scale={false}
              onPress={() => onOpenProfile(peer.peerId!)}
              style={styles.actionIcon}
              accessibilityLabel="View profile">
              <Icon name="device" color={theme.textDim} size={15} />
            </Touchable>
            <Touchable
              scale={false}
              onPress={() => onBlock(peer.peerId!, name)}
              style={styles.actionIcon}
              accessibilityLabel="Block">
              <Icon name="block" color={theme.textDim} size={15} />
            </Touchable>
          </>
        ) : null}
      </View>
    </View>
  );
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
  return (
    <Touchable
      scale={false}
      onPress={() => (peer.linkId ? onConnect(peer.linkId) : onOpenChat(peer))}
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
      <DenseText style={styles.recentAction}>
        {peer.linkId ? 'Connect' : 'Chat'}
      </DenseText>
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  content: {padding: spacing.lg + 4, paddingBottom: spacing.xl},
  grow: {flex: 1},

  // ---- header ------------------------------------------------------------
  header: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  headerText: {flex: 1},
  title: {fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: t.text},
  subtitleRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3},
  subtitleDot: {width: 6, height: 6, borderRadius: 3},
  subtitle: {...typography.caption, color: t.textDim, flex: 1},
  subtitleStrong: {color: t.text, fontWeight: '700'},
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: t.accentSoft,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
  },
  stopText: {...typography.callout, color: t.accent, fontWeight: '700'},

  // ---- sort --------------------------------------------------------------
  controls: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14},
  segmented: {
    flex: 1,
    flexDirection: 'row',
    gap: 2,
    backgroundColor: t.surfaceAlt,
    borderRadius: 12,
    padding: 3,
  },
  segment: {flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 9},
  // A raised chip, not a tint: the selected segment should look like it is on top of the
  // track rather than a differently-coloured part of it.
  segmentActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: t.isDark ? 0.3 : 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  segmentText: {...typography.caption, color: t.textDim, fontWeight: '600'},
  segmentTextActive: {...typography.caption, color: t.text, fontWeight: '700'},
  filterButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {borderColor: t.ok, backgroundColor: t.tileGreen},

  connectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.textFaint + '77',
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginTop: 14,
    marginBottom: 14,
  },
  connectAllText: {...typography.callout, color: t.text, fontWeight: '600', flex: 1},
  connectAllGo: {...typography.callout, color: t.accent, fontWeight: '700'},

  // ---- peer card ---------------------------------------------------------
  card: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: t.isDark ? 0.2 : 0.05,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  cardFailed: {borderColor: t.error + '55'},
  cardHead: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  cardHeadBody: {flex: 1, minWidth: 0},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  name: {fontSize: 16, fontWeight: '700', color: t.text, flexShrink: 1},
  statePill: {borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2},
  statePillText: {fontSize: 10, fontWeight: '800', letterSpacing: 0.4},
  meta: {...typography.caption, color: t.textDim, fontSize: 11, marginTop: 3},

  interests: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 11,
  },
  // flexShrink: 0 — in a wrapping row a flex layout may squeeze a chip narrower than its
  // text needs before wrapping it, which clips the last character with no ellipsis.
  chipShared: {
    backgroundColor: t.accentSoft,
    borderWidth: 1,
    borderColor: t.accent + '33',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    flexShrink: 0,
  },
  chipSharedText: {fontSize: 11, fontWeight: '700', color: t.accent},
  sharedCount: {fontSize: 11, fontWeight: '600', color: t.textFaint},
  chip: {
    borderWidth: 1,
    borderColor: t.divider,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    flexShrink: 0,
  },
  chipText: {fontSize: 11, color: t.textFaint},

  actions: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 12},
  actionPrimary: {
    flex: 1,
    height: 38,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionFilled: {backgroundColor: t.accent},
  actionFilledText: {...typography.callout, color: t.onAccent, fontWeight: '700'},
  actionOutline: {borderWidth: 1, borderColor: t.accent},
  actionOutlineText: {...typography.callout, color: t.accent, fontWeight: '700'},
  actionOutlineNeutral: {borderWidth: 1, borderColor: t.border},
  actionOutlineNeutralText: {...typography.callout, color: t.text, fontWeight: '700'},
  actionPlain: {},
  actionPlainText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  actionDisabled: {borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt},
  actionDisabledText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- recently connected ------------------------------------------------
  recentBlock: {marginTop: 6},
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 16,
    marginBottom: 8,
  },
  ruleTitle: {...typography.overline, color: t.textDim},
  rule: {flex: 1, height: 1, backgroundColor: t.divider},
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.divider,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  recentName: {...typography.callout, fontSize: 14, fontWeight: '700', color: t.text},
  recentMeta: {...typography.caption, color: t.textFaint, fontSize: 11, marginTop: 2},
  recentAction: {...typography.callout, color: t.textDim, fontWeight: '700'},

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
