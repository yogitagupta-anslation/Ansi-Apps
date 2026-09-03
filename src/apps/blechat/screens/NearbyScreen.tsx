import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Alert,
  FlatList,
  LayoutAnimation,
  Platform,
  UIManager,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect} from '@react-navigation/native';
import {radius, spacing, typography, type Theme} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {sharedInterests} from '../config/interests';
import {EmptyState} from '../components/ui/Surface';
import {FadeIn, Pulse, RadarPing, Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {GradientSurface, brandGradient} from '../components/ui/Gradient';
import {LABELS as LINK_STATE_LABELS} from '../components/ConnectionIndicator';
import {QualityBadge} from '../components/ui/QualityBadge';
import {PeerProfileSheet} from '../components/PeerProfileSheet';
import {RECONNECT_MAX_ATTEMPTS} from '../config/constants';
import {describeFailure} from '../ble/LinkErrors';
import {AppText, DenseText} from '../components/AppText';
import {SignalBars} from '../components/ui/Primitives';
import {
  classifyDevice,
  describeClass,
  kindTone,
  type DeviceClass,
} from '../ble/DeviceClassifier';
import {bleChat} from '../services/BleChatService';
import {toggleFavoritePeer, useAppStore, type DiscoveredDevice} from '../state/appStore';
import type {Peer} from '../types/Peer';
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

const SORT_LABEL: Record<SortMode, string> = {
  match: 'Shared Interests',
  signal: 'Signal Strength',
  name: 'Name',
  recent: 'Recently Seen',
};

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
  const notConnectable = chatRows.filter(r => r.device.isConnectable === false).length;
  const connectable = chatRows.length - notConnectable;

  const toggleScan = useCallback(() => {
    const action = scanning ? bleChat.stopScanning() : bleChat.startScanning();
    action.catch(err =>
      Alert.alert('Scanning', err instanceof Error ? err.message : String(err)),
    );
  }, [scanning]);

  const cycleSort = useCallback(() => {
    setSort(s =>
      s === 'match'
        ? 'signal'
        : s === 'signal'
        ? 'name'
        : s === 'name'
        ? 'recent'
        : 'match',
    );
  }, []);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={chatRows}
        keyExtractor={item => item.device.linkId}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <AppText style={styles.title} numberOfLines={1}>
                  Nearby Peers
                </AppText>
                <View style={styles.subtitleRow}>
                  {scanning ? (
                    <DenseText style={styles.subtitle} numberOfLines={1}>
                      Scanning for{' '}
                      <DenseText style={styles.subtitleAccent}>BLE</DenseText> devices...
                    </DenseText>
                  ) : (
                    <DenseText style={styles.subtitle} numberOfLines={1}>
                      {bluetoothState === 'PoweredOn'
                        ? 'Scanner idle'
                        : 'Bluetooth is ' + bluetoothState}
                    </DenseText>
                  )}
                  {/* Purely decorative pulse, echoing the one on Home's scan chip — it
                      does not encode a real value, only that a scan is in progress. */}
                  {scanning && (
                    <View style={styles.subtitleDots}>
                      {[0, 1, 2].map(i => (
                        <View
                          key={i}
                          style={[
                            styles.subtitleDot,
                            {backgroundColor: theme.accent, opacity: 1 - i * 0.3},
                          ]}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </View>
              {/* Filled lavender chip rather than an outline, and purple rather than red
                  — this is a mode toggle (Scan/Stop), not a destructive action, so it
                  reads as the brand's own control language rather than a warning. */}
              <Touchable scale={false} onPress={toggleScan} style={styles.stopButton}>
                <Icon name="stop" color={theme.tilePurpleFg} size={12} />
                <DenseText style={styles.stopText}>
                  {scanning ? 'Stop' : 'Scan'}
                </DenseText>
              </Touchable>
            </View>

            <View style={styles.banner}>
              <View style={styles.statRow}>
                <BannerStat
                  icon="bluetooth"
                  value={chatRows.length}
                  label="Devices found"
                  fg={theme.tileBlueFg}
                />
                <View style={styles.statDivider} />
                <BannerStat
                  icon="link"
                  value={connectable}
                  label="Connectable"
                  fg={theme.tileGreenFg}
                />
                <View style={styles.statDivider} />
                <BannerStat
                  icon="block"
                  value={notConnectable}
                  label="Not connectable"
                  fg={theme.tilePurpleFg}
                />
              </View>
            </View>

            {/* One full-width action rather than a third control squeezed into the list
                header — three competing items on one line is what made this look busy. */}
            <Touchable scale={false} onPress={onConnectAll} style={styles.ctaCard}>
              <View style={styles.ctaIconWrap}>
                <Icon name="broadcast" color={theme.tilePurpleFg} size={24} />
              </View>
              <View style={styles.ctaText}>
                <AppText style={styles.ctaTitle} numberOfLines={1}>
                  Connect to everyone in range
                </AppText>
                <DenseText style={styles.ctaSubtitle} numberOfLines={1}>
                  Start discovering and chatting instantly.
                </DenseText>
              </View>
              <View style={styles.ctaButton}>
                <Icon name="people" color={theme.tilePurpleFg} size={14} />
                <DenseText style={styles.ctaButtonText}>Connect</DenseText>
              </View>
            </Touchable>

            <View style={styles.listHeader}>
              <AppText style={styles.listTitle}>Nearby devices</AppText>
              <View style={styles.flex} />
              <Touchable
                scale={false}
                onPress={() => setVerifiedOnly(v => !v)}
                style={
                  verifiedOnly
                    ? [styles.filterChip, styles.filterChipActive]
                    : styles.filterChip
                }>
                <Icon
                  name="shield"
                  color={verifiedOnly ? theme.tileGreenFg : theme.textDim}
                  size={13}
                />
                <DenseText
                  style={[
                    styles.filterChipText,
                    verifiedOnly && {color: theme.tileGreenFg},
                  ]}
                  numberOfLines={1}>
                  Verified only
                </DenseText>
              </Touchable>
              <Touchable scale={false} onPress={cycleSort} style={styles.sortButton}>
                <Icon name="sort" color={theme.tilePurpleFg} size={13} />
                <DenseText style={styles.sortText} numberOfLines={1}>
                  {SORT_LABEL[sort]}
                </DenseText>
              </Touchable>
            </View>
            {otherDevicesCount > 0 && (
              <DenseText style={styles.otherDevicesNote}>
                +{otherDevicesCount} other Bluetooth device
                {otherDevicesCount === 1 ? '' : 's'} nearby — not shown, nothing to chat
                with there.
              </DenseText>
            )}
          </>
        }
        renderItem={({item, index}) => (
          <FadeIn index={index}>
            <DeviceRow
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
              <View style={styles.listHeader}>
                <AppText style={styles.listGlyph} maxFontSizeMultiplier={1}>
                  ◷
                </AppText>
                <AppText style={styles.listTitle}>Recently Connected</AppText>
              </View>
              <DenseText style={styles.recentHint}>
                Not in range right now. They are dialled again automatically when they
                come back.
              </DenseText>
              {recent.map((peer, index) => (
                <FadeIn key={peer.peerId!} index={index}>
                  <RecentRow
                    peer={peer}
                    myInterests={myInterests}
                    onConnect={onConnect}
                    onOpenChat={onOpenChat}
                    onBlock={onBlock}
                    onOpenProfile={setProfilePeerId}
                  />
                </FadeIn>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          bluetoothState === 'PoweredOn' && scanning ? (
            <RadarEmptyState />
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
    </SafeAreaView>
  );
}

/**
 * The scanning empty state: a radar sweep rather than a plain icon-and-text block.
 *
 * Only shown while a scan is actually running with Bluetooth on — the one state where
 * "still looking" is true and an animated illustration does not lie about what the app is
 * doing. Bluetooth-off and not-scanning fall back to the plain `EmptyState`, since a
 * pinging radar behind "turn Bluetooth on" would say the opposite of what is true. The
 * rings genuinely ping — this component is only ever mounted while `scanning` is true, so
 * `active` needs no prop of its own; it unmounts (and the animation stops) the moment
 * scanning does.
 */
function RadarEmptyState() {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.radarWrap}>
      <View style={styles.radarRings}>
        <View style={[styles.ring, styles.ring1]} />
        <RadarPing active size={220} color={theme.tilePurpleFg} delay={0} />
        <RadarPing active size={220} color={theme.tilePurpleFg} delay={600} />
        <RadarPing active size={220} color={theme.tilePurpleFg} delay={1200} />
        <GradientSurface
          gradient={brandGradient(theme)}
          radius={999}
          style={styles.radarCore}>
          <Icon name="bluetooth" color={theme.onAccent} size={22} />
        </GradientSurface>
        <View style={[styles.radarDot, {backgroundColor: theme.tileGreenFg, top: 18, left: 34}]} />
        <View style={[styles.radarDot, {backgroundColor: theme.tileBlueFg, bottom: 30, right: 10}]} />
        <View style={[styles.radarDot, {backgroundColor: theme.tilePurpleFg, bottom: 8, left: 6}]} />
      </View>
      <AppText style={styles.radarTitle}>Looking for devices</AppText>
      <DenseText style={styles.radarDetail}>
        Anything advertising in range will appear here.
      </DenseText>
      <View style={styles.featureRow}>
        <FeaturePill icon="search" label="Scanning nearby" fg={theme.tileBlueFg} />
        <FeaturePill icon="broadcast" label="Low energy" fg={theme.tileGreenFg} />
        <FeaturePill icon="shield" label="Private & secure" fg={theme.tilePurpleFg} />
      </View>
    </View>
  );
}

function FeaturePill({icon, label, fg}: {icon: IconName; label: string; fg: string}) {
  const styles = useStyles();
  return (
    <View style={styles.featurePill}>
      <Icon name={icon} color={fg} size={13} />
      <DenseText style={styles.featurePillText} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

function BannerStat({
  icon,
  value,
  label,
  fg,
}: {
  icon: IconName;
  value: number;
  label: string;
  fg: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Icon name={icon} color={fg} size={18} />
      <AppText style={styles.statValue}>{String(value)}</AppText>
      <DenseText style={styles.statLabel} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

/**
 * "Visual cues like icons or colour changes to show if the device is connected,
 * connecting, or offline" — one small badge, reused everywhere a link state needs to be
 * named rather than guessed from a button's shape.
 */
function ConnectionBadge({
  icon,
  label,
  tone,
  pulse,
}: {
  icon: IconName;
  label: string;
  tone: string;
  /** Set only for a state that is genuinely still in progress — reconnecting, dialling. */
  pulse?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.badge, {backgroundColor: tone + '1f'}]}>
      <Pulse active={!!pulse}>
        <Icon name={icon} color={tone} size={12} strokeWidth={2.2} />
      </Pulse>
      <DenseText style={[styles.badgeText, {color: tone}]} numberOfLines={1}>
        {label}
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
        color={isFavorite ? theme.tileAmberFg : theme.textDim}
        size={14}
      />
    </Touchable>
  );
}

function DeviceRow({
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

  const tone = toneColor(kindTone(cls.kind), theme);
  const isChat = cls.kind === 'chat';
  const connected = peer?.state === 'connected';
  const reconnecting = peer?.state === 'reconnecting' || (peer?.reconnectAttempt ?? 0) > 0;
  const busy =
    peer !== null &&
    peer.state !== 'connected' &&
    peer.state !== 'disconnected' &&
    peer.state !== 'failed' &&
    peer.state !== 'discovering';

  return (
    <View style={[styles.row, isChat && styles.rowChat]}>
      {/* A known identity only — blocking a device we have never handshaken with would
          block nothing real, since there is no proven peerId to refuse yet. */}
      {isChat && peer?.peerId && (
        <Touchable
          scale={false}
          onPress={() =>
            onBlock(peer.peerId!, peer.displayName ?? device.name ?? 'this device')
          }
          hitSlop={10}
          style={styles.blockCorner}
          accessibilityLabel="Block">
          <Icon name="block" color={theme.textDim} size={14} />
        </Touchable>
      )}

      {/* The avatar doubles as the entry point to the profile card — a tap target that
          does not compete with the row's per-state action buttons on the other side. */}
      {isChat && peer?.peerId ? (
        <Touchable
          scale={false}
          onPress={() => onOpenProfile(peer.peerId!)}
          style={[styles.avatar, {backgroundColor: tone + '1f'}]}
          accessibilityLabel="View profile">
          <AppText style={[styles.avatarGlyph, {color: tone}]} maxFontSizeMultiplier={1}>
            {cls.glyph}
          </AppText>
        </Touchable>
      ) : (
        <View style={[styles.avatar, {backgroundColor: tone + '1f'}]}>
          <AppText style={[styles.avatarGlyph, {color: tone}]} maxFontSizeMultiplier={1}>
            {cls.glyph}
          </AppText>
        </View>
      )}

      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <AppText style={[styles.deviceName, styles.nameText]} numberOfLines={1}>
            {/* A person, if we know one. Never a hex address. */}
            {isChat
              ? peer?.displayName ?? device.name ?? 'Someone nearby'
              : device.name ?? 'Unknown Device'}
          </AppText>
          {/* Every handshake is authenticated or the link never reaches "connected" —
              this is not a claim beyond what the crypto already proved, just making that
              proof visible rather than silent. */}
          {peer?.authenticated && (
            <Icon name="shield" color={theme.tileGreenFg} size={13} strokeWidth={2} />
          )}
          {isChat && peer?.peerId && <FavoriteStar peerId={peer.peerId} />}
        </View>

        {isChat ? (
          <InterestTags
            interests={peer?.interests ?? []}
            mine={myInterests}
            placeholder={
              peer?.peerId
                ? 'No interests shared'
                : 'No interests advertised'
            }
          />
        ) : (
          // A sensor or a pair of earbuds has no name to introduce itself with, so its
          // address is the only identifier there is — and it is genuinely useful there.
          <View style={styles.idRow}>
            <View style={styles.bleBadge}>
              <DenseText style={styles.bleBadgeText}>BLE</DenseText>
            </View>
            <DenseText style={styles.deviceId} numberOfLines={1}>
              {device.address}
            </DenseText>
          </View>
        )}

        <DenseText style={styles.category} numberOfLines={1}>
          {describeClass(cls) + '   ·   Last seen ' + relativeTime(device.lastSeen)}
        </DenseText>

        {/*
          "Connected" on its own does not distinguish a link carrying messages instantly
          from one limping at the edge of range — and the second is what explains a slow
          message. Every value here is measured, and the score is withheld entirely until
          there is enough evidence for it to mean anything.
        */}
        {connected && peer && (
          <View style={styles.healthRow}>
            <QualityBadge score={peer.metrics?.quality ?? null} />
            <DenseText style={styles.health} numberOfLines={1}>
              {[
                peer.gatt ? `MTU ${peer.gatt.mtu}` : null,
                peer.rssi !== null ? `${peer.rssi} dBm` : null,
              ]
                .filter(Boolean)
                .join('   ·   ')}
            </DenseText>
          </View>
        )}
      </View>

      <View style={styles.rowRight}>
        <View style={styles.rssiRow}>
          <SignalBars rssi={device.rssi} size="sm" />
          <DenseText style={styles.rssiText}>
            {device.rssi !== null ? device.rssi + ' dBm' : '—'}
          </DenseText>
        </View>

        {device.isConnectable === false ? (
          <ConnectionBadge icon="block" label="Not connectable" tone={theme.textDim} />
        ) : !isChat ? (
          // Honest: reachable over BLE, but it does not speak our protocol, so offering
          // "Connect" would start a handshake that can never succeed.
          <View style={styles.notChat}>
            <DenseText style={styles.notChatText} numberOfLines={2}>
              Not a BLE Chat device
            </DenseText>
          </View>
        ) : connected && peer ? (
          <View style={styles.stack}>
            <ConnectionBadge icon="link" label="Connected" tone={theme.tileGreenFg} />
            <Touchable
              scale={false}
              onPress={() => onOpenChat(peer)}
              style={styles.connectFilled}>
              <DenseText style={styles.connectFilledText}>Open chat</DenseText>
            </Touchable>
          </View>
        ) : reconnecting && peer ? (
          // Still being worked on. Showing "disconnected" here would read as a dead end
          // when the app is mid-retry.
          <View style={styles.stack}>
            <ConnectionBadge
              icon="clock"
              label={`Reconnecting ${peer.reconnectAttempt}/${RECONNECT_MAX_ATTEMPTS}`}
              tone={theme.tileAmberFg}
              pulse
            />
            <Touchable
              scale={false}
              onPress={() => onCancel(device.linkId)}
              style={styles.cancelButton}>
              <DenseText style={styles.cancelText}>Cancel</DenseText>
            </Touchable>
          </View>
        ) : busy && peer ? (
          // Every attempt gets a way out. Tapping Connect by accident should not commit
          // the phone to a full timeout plus the whole retry budget.
          <View style={styles.stack}>
            <ConnectionBadge
              icon="clock"
              label={LINK_STATE_LABELS[peer.state]}
              tone={theme.tileAmberFg}
              pulse
            />
            <Touchable
              scale={false}
              onPress={() => onCancel(device.linkId)}
              style={styles.cancelButton}>
              <DenseText style={styles.cancelText}>Cancel</DenseText>
            </Touchable>
          </View>
        ) : peer?.failure ? (
          // The reason, not just "failed" — "Peer is not running the chat service" and
          // "Bluetooth is turned off" call for completely different actions.
          <View style={styles.stack}>
            <ConnectionBadge icon="alert" label="Failed" tone={theme.error} />
            <DenseText style={styles.failureText} numberOfLines={3}>
              {describeFailure(peer.failure)}
            </DenseText>
            <Touchable
              scale={false}
              onPress={() => onConnect(device.linkId)}
              style={styles.connectOutline}>
              <DenseText style={styles.connectOutlineText}>Retry</DenseText>
            </Touchable>
          </View>
        ) : (
          <View style={styles.stack}>
            <ConnectionBadge icon="target" label="Available" tone={theme.tileBlueFg} />
            <Touchable
              scale={false}
              onPress={() => onConnect(device.linkId)}
              style={styles.connectOutline}>
              <DenseText style={styles.connectOutlineText}>Connect</DenseText>
            </Touchable>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * A peer we know but cannot see this second.
 *
 * Deliberately plainer than a live row: there is no signal to show and no state to watch,
 * only who they are, what you had in common, and when they were last around.
 */
function RecentRow({
  peer,
  myInterests,
  onConnect,
  onOpenChat,
  onBlock,
  onOpenProfile,
}: {
  peer: Peer;
  myInterests: string[];
  onConnect: (linkId: string) => void;
  onOpenChat: (peer: Peer) => void;
  onBlock: (peerId: string, name: string) => void;
  onOpenProfile: (peerId: string) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {peer.peerId && (
        <Touchable
          scale={false}
          onPress={() => onBlock(peer.peerId!, peer.displayName ?? 'this person')}
          hitSlop={10}
          style={styles.blockCorner}
          accessibilityLabel="Block">
          <Icon name="block" color={theme.textDim} size={14} />
        </Touchable>
      )}
      {peer.peerId ? (
        <Touchable
          scale={false}
          onPress={() => onOpenProfile(peer.peerId!)}
          style={[styles.avatar, styles.recentAvatar]}
          accessibilityLabel="View profile">
          <AppText style={styles.avatarGlyph} maxFontSizeMultiplier={1}>
            ◍
          </AppText>
        </Touchable>
      ) : (
        <View style={[styles.avatar, styles.recentAvatar]}>
          <AppText style={styles.avatarGlyph} maxFontSizeMultiplier={1}>
            ◍
          </AppText>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <AppText style={[styles.deviceName, styles.nameText]} numberOfLines={1}>
            {peer.displayName ?? 'Someone you have met'}
          </AppText>
          {peer.authenticated && (
            <Icon name="shield" color={theme.tileGreenFg} size={13} strokeWidth={2} />
          )}
          {peer.peerId && <FavoriteStar peerId={peer.peerId} />}
        </View>
        <InterestTags
          interests={peer.interests}
          mine={myInterests}
          placeholder="No interests shared"
        />
        <DenseText style={styles.category} numberOfLines={1}>
          {'Last seen ' + relativeTime(peer.lastSeen)}
        </DenseText>
      </View>
      <View style={styles.rowRight}>
        <Touchable
          scale={false}
          onPress={() => (peer.linkId ? onConnect(peer.linkId) : onOpenChat(peer))}
          style={styles.connectOutline}>
          <DenseText style={styles.connectOutlineText}>
            {peer.linkId ? 'Connect' : 'Open chat'}
          </DenseText>
        </Touchable>
      </View>
    </View>
  );
}

/** Shared interests first and highlighted; the rest as quiet context. */
function InterestTags({
  interests,
  mine,
  placeholder,
}: {
  interests: string[];
  mine: string[];
  placeholder: string;
}) {
  const styles = useStyles();
  if (interests.length === 0) {
    return <DenseText style={styles.tagPlaceholder}>{placeholder}</DenseText>;
  }
  const shared = sharedInterests(mine, interests);
  const rest = interests.filter(
    i => !shared.some(s => s.toLowerCase() === i.toLowerCase()),
  );
  return (
    <View style={styles.tagRow}>
      {/* maxFontSizeMultiplier=1: a short badge label like this has no slack between the
          text's un-scaled auto-measured width and the pill's rounded edge — any
          accessibility scaling here is exactly what clips a trailing character with no
          ellipsis. */}
      {shared.map(interest => (
        <View key={interest} style={[styles.tag, styles.tagShared]}>
          <DenseText
            style={[styles.tagText, styles.tagTextShared]}
            maxFontSizeMultiplier={1}>
            {interest}
          </DenseText>
        </View>
      ))}
      {rest.map(interest => (
        <View key={interest} style={styles.tag}>
          <DenseText style={styles.tagText} maxFontSizeMultiplier={1}>
            {interest}
          </DenseText>
        </View>
      ))}
    </View>
  );
}

function toneColor(tone: ReturnType<typeof kindTone>, t: Theme): string {
  switch (tone) {
    case 'accent':
      return t.accent;
    case 'ok':
      return t.ok;
    case 'purple':
      return t.purple;
    case 'amber':
      return t.amber;
    default:
      return t.neutral;
  }
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},
  flex: {flex: 1},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {flex: 1},
  title: {...typography.display, color: t.text},
  subtitleRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2},
  subtitle: {...typography.caption, color: t.textDim},
  subtitleAccent: {color: t.accent, fontWeight: '700'},
  subtitleDots: {flexDirection: 'row', gap: 3},
  subtitleDot: {width: 4, height: 4, borderRadius: 2},
  // Filled lavender rather than outlined — a mode toggle, in the brand's own colour.
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.tilePurple,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  stopText: {...typography.callout, color: t.tilePurpleFg, fontWeight: '700'},

  // A plain surface rather than a tinted panel. A coloured block at the top of a list
  // reads as a promotion; this is status, and status should be quiet.
  banner: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },

  statRow: {flexDirection: 'row', alignItems: 'center'},
  stat: {flex: 1, alignItems: 'center', gap: 6},
  statValue: {...typography.numeric, fontSize: 19, color: t.text},
  statLabel: {...typography.caption, color: t.textDim, textAlign: 'center'},
  statDivider: {width: 1, height: 40, backgroundColor: t.border},

  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  listGlyph: {color: t.textDim, fontSize: 12},
  listTitle: {...typography.overline, color: t.textDim},
  otherDevicesNote: {
    ...typography.caption,
    color: t.textDim,
    fontSize: 11,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  sortGlyph: {color: t.textDim, fontSize: 13},
  sortText: {...typography.caption, color: t.textDim},
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  filterChipActive: {backgroundColor: t.tileGreen, borderColor: t.tileGreenFg + '55'},
  filterChipText: {...typography.caption, color: t.textDim},

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  // Top-right corner, out of the way of every state-dependent layout `rowRight` already
  // has to juggle — a block affordance earns a fixed spot, not another branch in that
  // conditional.
  blockCorner: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    padding: 4,
    zIndex: 1,
  },
  // A chat peer is distinguished by a slightly brighter border, not by a coloured
  // stripe down the side. The stripe was the loudest element in a list whose whole job
  // is to be scanned quickly.
  rowChat: {borderColor: t.accent + '44'},
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A default colour, overridden inline per row: without one, a plain RN Text falls
  // back to the platform default (black), which is close to invisible on the dark
  // surfaceAlt background the "recently connected" avatar uses.
  avatarGlyph: {fontSize: 20, color: t.textDim},
  rowBody: {flex: 1, minWidth: 0},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  deviceName: {color: t.text, fontSize: 16, fontWeight: '700'},
  nameText: {flexShrink: 1},
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 3,
  },
  bleBadge: {
    backgroundColor: t.accentSoft,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  bleBadgeText: {color: t.accent, fontSize: 10, fontWeight: '800'},

  // The "connect to everyone" action as a small promo card rather than a plain button —
  // it is the one action on this screen that acts on every row at once, which is worth
  // more visual weight than a row-level Connect.
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.glow,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  ctaIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {flex: 1},
  ctaTitle: {...typography.headline, color: t.text},
  ctaSubtitle: {...typography.caption, color: t.textDim, marginTop: 2},
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  ctaButtonText: {...typography.callout, color: t.tilePurpleFg, fontWeight: '700'},

  stack: {alignItems: 'flex-end', gap: spacing.xs},
  recentBlock: {marginTop: spacing.lg},
  recentHint: {
    color: t.textDim,
    fontSize: 11,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  recentAvatar: {backgroundColor: t.surfaceAlt},
  cancelButton: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  cancelText: {color: t.textDim, fontSize: 12},
  failureText: {
    color: t.error,
    fontSize: 11,
    textAlign: 'right',
    maxWidth: 130,
  },
  healthRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 4},
  health: {color: t.ok, fontSize: 11},
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  // flexShrink: 0 — this sits in a flexWrap row; without it, a flex layout is allowed to
  // squeeze a chip narrower than its text needs before it wraps to the next line, which
  // can clip the last character or two with no ellipsis to show for it.
  tag: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    flexShrink: 0,
  },
  tagShared: {backgroundColor: t.accentSoft, borderColor: t.accent},
  tagText: {color: t.textDim, fontSize: 11},
  tagTextShared: {color: t.accent, fontWeight: '700'},
  tagPlaceholder: {color: t.textDim, fontSize: 11, marginTop: spacing.xs},
  deviceId: {
    color: t.textDim,
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  category: {color: t.textDim, fontSize: 11, marginTop: 3},

  rowRight: {alignItems: 'flex-end', gap: spacing.sm},
  rssiRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  rssiText: {color: t.ok, fontSize: 12, fontWeight: '600'},

  // The badge every connection state renders through — one shape, coloured per state,
  // so "connected / connecting / offline" is read from the icon and tint rather than
  // guessed from which of several differently-shaped buttons happens to be showing.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  badgeText: {...typography.caption, fontWeight: '700'},

  connectFilled: {
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  connectFilledText: {color: t.onAccent, fontWeight: '700', fontSize: 13},
  connectOutline: {
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  connectOutlineText: {color: t.accent, fontWeight: '700', fontSize: 13},
  notChat: {maxWidth: 110},
  notChatText: {color: t.textDim, fontSize: 11, textAlign: 'right'},

  radarWrap: {alignItems: 'center', paddingVertical: spacing.xl, paddingTop: spacing.lg},
  radarRings: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
  },
  ring1: {width: 220, height: 220},
  radarCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarDot: {position: 'absolute', width: 8, height: 8, borderRadius: 4},
  radarTitle: {...typography.headline, color: t.text},
  radarDetail: {
    ...typography.caption,
    color: t.textDim,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 260,
  },
  featureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  featurePillText: {...typography.caption, color: t.text, fontWeight: '600'},
}));
