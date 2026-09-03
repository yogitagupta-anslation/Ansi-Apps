import React, {useCallback, useMemo, useState} from 'react';
import {Alert, Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BluetoothStatus} from '../components/BluetoothStatus';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, Pulse, Touchable} from '../components/Motion';
import {Card} from '../components/ui/Surface';
import {Screen} from '../components/ui/Screen';
import {GroupAvatar, InitialAvatar} from '../components/ui/Primitives';
import {Mascot} from '../components/ui/Mascot';
import {Icon, type IconName} from '../components/ui/Icon';
import {GradientSurface, Wordmark, brandGradient} from '../components/ui/Gradient';
import {elevation, radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {openAppSettings} from '../ble/BLEPermissions';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import {sharedInterests} from '../config/interests';
import type {RootTabScreenProps} from '../navigation/types';

/**
 * Home answers one question first — is anyone here? — and then gets out of the way.
 *
 * The screen used to open with five equal-weight blocks: a Bluetooth card, an identity
 * card, a stat card and two buttons. Five things asking for attention at once is the
 * same as none of them asking, so nothing on it read as the point. Now there is a
 * single hero that states the count and offers the one action that follows from it, a
 * three-fact strip under it, the conversations you actually come back to, and the radio
 * detail demoted to one row.
 *
 * Nothing was dropped in the process. The identity moved into the avatar button (which
 * is where you would tap to change it anyway), the groups fold into the conversation
 * list where they belong, and every honest status — refused link budget, queued
 * messages, permission trouble — still surfaces, just no longer at the same volume as
 * everything else.
 */
export function HomeScreen({navigation}: RootTabScreenProps<'Home'>) {
  const styles = useStyles();
  const theme = useTheme();

  const identity = useAppStore(s => s.identity);
  const myInterests = useAppStore(s => s.settings.interests);
  const links = useAppStore(s => s.links);
  const bluetoothState = useAppStore(s => s.bluetoothState);
  const permission = useAppStore(s => s.permission);
  const peripheral = useAppStore(s => s.peripheral);
  const scanning = useAppStore(s => s.scanning);
  const peers = useAppStore(s => s.peers);
  const initError = useAppStore(s => s.initError);
  const groups = useAppStore(s => s.groups);
  const conversations = useAppStore(s => s.conversations);
  const unread = useAppStore(s => s.unread);

  // Summed from the peer records the store already keeps, so this cannot drift from the
  // per-conversation counts shown inside each chat.
  const queuedTotal = peers.reduce((total, p) => total + p.queuedCount, 0);
  const connected = peers.filter(p => p.state === 'connected');
  const withSharedInterests = peers.filter(
    p => sharedInterests(myInterests, p.interests).length > 0,
  ).length;

  const [profileMenuVisible, setProfileMenuVisible] = useState(false);

  /**
   * The three most recent threads, and only three. This is the shortcut back into a
   * conversation, not the conversation list — Chats owns that, and a Home that tried to
   * be both would be the old screen again.
   */
  const recent = useMemo(() => {
    const rows = Object.entries(conversations)
      .map(([conversationId, messages]) => {
        const last = messages.length ? messages[messages.length - 1] : null;
        const group = groups.find(g => g.id === conversationId);
        const members = group
          ? peers.filter(p => p.peerId !== null && group.members.includes(p.peerId))
          : [];
        return {
          conversationId,
          group,
          name:
            group?.name ??
            peers.find(p => p.peerId === conversationId)?.displayName ??
            'Unknown',
          preview: last
            ? (last.direction === 'outgoing' ? 'You: ' : '') + last.text
            : '',
          at: last?.receivedAt ?? 0,
          unread: unread[conversationId] ?? 0,
          online: group
            ? members.some(p => p.state === 'connected')
            : peers.some(p => p.peerId === conversationId && p.state === 'connected'),
          // Only groups carry this: "2 of 3 reachable" is the fact that decides whether
          // sending is worth it, and it has no meaning for a single peer.
          reach: group
            ? `${members.filter(p => p.state === 'connected').length} of ${
                group.members.length
              } reachable`
            : null,
        };
      })
      .filter(row => row.at > 0)
      .sort((a, b) => b.at - a.at);
    return rows.slice(0, 3);
  }, [conversations, groups, peers, unread]);

  const onRequestPermission = useCallback(() => {
    bleChat.requestPermissions().catch(err => Alert.alert('Permissions', String(err)));
  }, []);

  const onEnableBluetooth = useCallback(() => {
    bleChat.enableBluetooth().catch(err =>
      Alert.alert('Bluetooth', err instanceof Error ? err.message : String(err)),
    );
  }, []);

  const toggleScan = useCallback(() => {
    const action = scanning ? bleChat.stopScanning() : bleChat.startScanning();
    action.catch(err =>
      Alert.alert('Scanning', err instanceof Error ? err.message : String(err)),
    );
  }, [scanning]);

  /**
   * The radio only gets a full card when it needs something from you. Working hardware
   * is a one-line fact; hardware that is off, or unpermitted, is a task — and a task
   * needs its buttons.
   */
  const radioNeedsAttention =
    bluetoothState !== 'PoweredOn' || permission.state !== 'granted';

  // The best MTU any live link negotiated — that is the figure the fragmenter sizes
  // to, and the one worth reporting when there is more than one peer.
  const bestMtu = connected.reduce((best, p) => Math.max(best, p.gatt?.mtu ?? 0), 0);

  const radioDetail = [
    scanning ? 'Scanning' : 'Not scanning',
    peripheral.advertising ? 'discoverable' : 'not discoverable',
    bestMtu > 0 ? `MTU ${bestMtu} granted` : `${peers.length} seen`,
  ].join(' · ');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <FadeIn>
          <View style={styles.masthead}>
            <Wordmark
              flat="BLE"
              flatColor={theme.text}
              gradientText="Chat"
              gradient={brandGradient(theme)}
              fontSize={22}
              width={124}
              height={30}
            />
            <View style={styles.grow} />
            {/* Labelled, not a bare dot — a lone coloured circle in the corner reads as
                decoration, and with a word beside it it is the radio's real state. The
                pulse is one of only two loops on this screen, and only runs while
                something is genuinely ongoing: a static dot looks the same whether the
                radio is scanning or wedged. */}
            <View
              style={[
                styles.livePill,
                {backgroundColor: scanning ? theme.tileGreen : theme.surfaceAlt},
              ]}>
              <Pulse active={scanning}>
                <View
                  style={[
                    styles.liveDot,
                    {backgroundColor: scanning ? theme.tileGreenFg : theme.textDim},
                  ]}
                />
              </Pulse>
              <DenseText
                style={[
                  styles.liveLabel,
                  {color: scanning ? theme.tileGreenFg : theme.textDim},
                ]}
                maxFontSizeMultiplier={1}>
                {scanning ? 'Live' : 'Idle'}
              </DenseText>
            </View>

            {/* Who you are, and the way in to changing it. The identity card that used
                to sit below said the same thing in ten times the space, on the screen
                you look at most often and change least. */}
            <Touchable
              scale={false}
              onPress={() => setProfileMenuVisible(true)}
              style={styles.profileButton}
              accessibilityLabel={`Profile and settings — ${
                identity?.displayName || 'no name set'
              }`}>
              <Mascot size={26} />
            </Touchable>
          </View>
        </FadeIn>

        {initError ? (
          <FadeIn index={1}>
            <Card style={styles.errorCard}>
              <DenseText style={styles.errorText}>Startup failed: {initError}</DenseText>
            </Card>
          </FadeIn>
        ) : null}

        {/* ---- hero: the whole reason to open the app ------------------------ */}
        <FadeIn index={1}>
          <GradientSurface
            gradient={brandGradient(theme)}
            radius={26}
            style={styles.hero}>
            {/* The only decorative element on the screen, and it is doing work: the ring
                is anchored to the count, so a hero with nobody in it looks visibly
                emptier rather than merely reading a different number. */}
            <View style={styles.heroRing} pointerEvents="none" />

            <View style={styles.heroEyebrow}>
              <Icon name="radar" color="rgba(255,255,255,0.9)" size={15} />
              <DenseText style={styles.heroEyebrowText}>AROUND YOU RIGHT NOW</DenseText>
            </View>

            <View style={styles.heroCountRow}>
              <AppText style={styles.heroCount} maxFontSizeMultiplier={1.1}>
                {peers.length}
              </AppText>
              <AppText style={styles.heroCountLabel}>
                {peers.length === 1 ? 'person in range' : 'people in range'}
              </AppText>
            </View>

            <View style={styles.heroFacesRow}>
              {peers.length > 0 ? (
                <View style={styles.heroFaces}>
                  {peers.slice(0, 3).map((peer, i) => (
                    <View
                      key={peer.linkId}
                      style={[
                        styles.heroFace,
                        i > 0 && styles.heroFaceOverlap,
                        {borderColor: theme.gradient[1]},
                      ]}>
                      <InitialAvatar
                        name={peer.displayName}
                        seed={peer.peerId ?? peer.linkId}
                        size={28}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              <DenseText style={styles.heroFacesText} numberOfLines={1}>
                {peers.length === 0
                  ? 'Nobody discovered yet'
                  : withSharedInterests > 0
                  ? `${withSharedInterests} share your interests`
                  : 'No shared interests yet'}
              </DenseText>
            </View>

            <View style={styles.heroActions}>
              <Touchable
                scale={false}
                onPress={() => navigation.navigate('Nearby')}
                style={styles.heroPrimary}
                accessibilityLabel="See who's nearby">
                <Icon name="target" color={theme.gradient[1]} size={17} />
                <AppText style={[styles.heroPrimaryText, {color: theme.gradient[0]}]}>
                  See who&apos;s nearby
                </AppText>
              </Touchable>
              <Touchable
                scale={false}
                onPress={toggleScan}
                style={styles.heroSecondary}
                accessibilityLabel={scanning ? 'Stop scanning' : 'Start scanning'}>
                <Icon
                  name={scanning ? 'stop' : 'radar'}
                  color="#ffffff"
                  size={scanning ? 12 : 16}
                />
              </Touchable>
            </View>
          </GradientSurface>
        </FadeIn>

        {/* ---- link ledger: three facts, each one tappable ------------------- */}
        <FadeIn index={2}>
          <View style={styles.ledger}>
            <LedgerCell
              icon="link"
              iconColor={theme.tileGreenFg}
              value={String(connected.length)}
              suffix={`/${links.effectiveBudget}`}
              label="Connected"
              onPress={() => navigation.navigate('Nearby')}
            />
            <LedgerCell
              icon="clock"
              iconColor={theme.tileAmberFg}
              value={String(links.waiting.length)}
              label="Waiting for a slot"
              onPress={() => navigation.navigate('Nearby')}
            />
            {/* Filled, not outlined. Queued mail is the one number here that means
                something of yours has not happened yet, and it used to be a sentence
                buried under the stats. */}
            <LedgerCell
              icon="inbox"
              iconColor={theme.tileAmberFg}
              value={String(queuedTotal)}
              label="Queued to send"
              filled={queuedTotal > 0}
              onPress={() => navigation.navigate('Chats')}
            />
          </View>
        </FadeIn>

        {/* A budget the radio lowered is worth saying out loud. Holding fewer links than
            asked for silently looks like a bug rather than a fact. */}
        {links.budgetLearned ? (
          <FadeIn index={2}>
            <DenseText style={styles.budgetNote}>
              This phone refused a {links.effectiveBudget + 1}th link, so the limit is{' '}
              {links.effectiveBudget}. Controllers cap how many connections they hold and
              do not report the number.
            </DenseText>
          </FadeIn>
        ) : null}

        {/* ---- continue where you left off ---------------------------------- */}
        <FadeIn index={3}>
          <View style={styles.sectionHead}>
            <DenseText style={styles.sectionTitle}>PICK UP WHERE YOU LEFT OFF</DenseText>
            <View style={styles.grow} />
            <Touchable scale={false} onPress={() => navigation.navigate('Chats')}>
              <DenseText style={styles.sectionAction}>All chats</DenseText>
            </Touchable>
          </View>

          <Card padded={false} style={styles.listCard}>
            {recent.map((row, i) => (
              <Touchable
                key={row.conversationId}
                scale={false}
                onPress={() =>
                  navigation.navigate(
                    'Chat',
                    row.group
                      ? {groupId: row.group.id, displayName: row.group.name}
                      : {peerId: row.conversationId, displayName: row.name},
                  )
                }
                style={i > 0 ? [styles.listRow, styles.listRowDivided] : styles.listRow}>
                {row.group ? (
                  <GroupAvatar size={40} online={row.online} />
                ) : (
                  <InitialAvatar
                    name={row.name}
                    seed={row.conversationId}
                    size={40}
                    online={row.online}
                  />
                )}
                <View style={styles.listBody}>
                  <View style={styles.listTop}>
                    <AppText style={styles.listName} numberOfLines={1}>
                      {row.name}
                    </AppText>
                    <DenseText style={styles.listMeta} numberOfLines={1}>
                      {row.reach ?? shortTime(row.at)}
                    </DenseText>
                  </View>
                  <DenseText style={styles.listPreview} numberOfLines={1}>
                    {row.preview}
                  </DenseText>
                </View>
                {row.unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <DenseText style={styles.unreadText} maxFontSizeMultiplier={1}>
                      {row.unread > 99 ? '99+' : row.unread}
                    </DenseText>
                  </View>
                ) : (
                  <DenseText style={styles.listMeta}>{shortTime(row.at)}</DenseText>
                )}
              </Touchable>
            ))}

            {recent.length === 0 ? (
              <View style={styles.emptyRow}>
                <DenseText style={styles.emptyText}>
                  No conversations yet. Anyone you connect to on Nearby will appear here.
                </DenseText>
              </View>
            ) : null}

            {/* Groups used to be their own section with its own header and empty state.
                A group is a conversation; it belongs in the list of conversations, and
                starting one belongs at the end of that list. */}
            <Touchable
              scale={false}
              onPress={() => navigation.navigate('NewGroup')}
              style={
                recent.length > 0
                  ? [styles.newGroupRow, styles.listRowDivided]
                  : styles.newGroupRow
              }>
              <View style={[styles.newGroupTile, {backgroundColor: theme.accentSoft}]}>
                <Icon name="plus" color={theme.accent} size={13} />
              </View>
              <DenseText style={styles.newGroupText}>New group</DenseText>
              <View style={styles.grow} />
              <DenseText style={styles.newGroupHint} numberOfLines={1}>
                one message, several peers
              </DenseText>
            </Touchable>
          </Card>
        </FadeIn>

        {/* ---- the radio ----------------------------------------------------- */}
        <FadeIn index={4}>
          {radioNeedsAttention ? (
            <View style={styles.block}>
              <BluetoothStatus
                state={bluetoothState}
                permission={permission}
                peripheral={peripheral}
                scanning={scanning}
                onRequestPermission={onRequestPermission}
                onEnableBluetooth={onEnableBluetooth}
                onOpenSettings={openAppSettings}
              />
            </View>
          ) : (
            <Touchable
              scale={false}
              onPress={() => navigation.navigate('Settings', {section: 'system'})}
              accessibilityLabel="Bluetooth and permission diagnostics">
              <Card padded={false} style={[styles.block, styles.radioRow]}>
                <View style={[styles.radioTile, {backgroundColor: theme.accentSoft}]}>
                  <Icon name="bluetooth" color={theme.accent} size={19} />
                </View>
                <View style={styles.grow}>
                  <AppText style={styles.radioTitle}>Bluetooth active</AppText>
                  <DenseText style={styles.radioDetail} numberOfLines={1}>
                    {radioDetail}
                  </DenseText>
                </View>
                <Icon name="chevronRight" color={theme.textFaint} size={16} />
              </Card>
            </Touchable>
          )}
        </FadeIn>

        <FadeIn index={5}>
          <View style={styles.warning}>
            <Icon name="shield" color={theme.textFaint} size={13} />
            <DenseText style={styles.warningText}>
              Traffic is unencrypted — treat this prototype as overhearable.
            </DenseText>
          </View>
        </FadeIn>
      </ScrollView>

      <ProfileMenu
        visible={profileMenuVisible}
        onClose={() => setProfileMenuVisible(false)}
        onNavigate={section => {
          setProfileMenuVisible(false);
          navigation.navigate('Settings', {section});
        }}
      />
    </Screen>
  );
}

/** 24-hour clock, because a chat list is scanned rather than read. */
function shortTime(at: number): string {
  if (!at) {
    return '';
  }
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`;
}

/**
 * One cell of the link ledger.
 *
 * `filled` is reserved for the queue: an outlined cell states a fact, a filled one says
 * something is pending. Using it for anything else would spend the only emphasis this
 * strip has.
 */
function LedgerCell({
  icon,
  iconColor,
  value,
  suffix,
  label,
  filled,
  onPress,
}: {
  icon: IconName;
  iconColor: string;
  value: string;
  suffix?: string;
  label: string;
  filled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Touchable scale={false} onPress={onPress} style={styles.ledgerCellWrap}>
      <View
        style={[
          styles.ledgerCell,
          filled && {backgroundColor: theme.tileAmber, borderColor: theme.tileAmberFg + '55'},
        ]}>
        <View style={styles.ledgerTop}>
          <Icon name={icon} color={filled ? theme.tileAmberFg : iconColor} size={13} />
          <AppText
            style={[styles.ledgerValue, filled && {color: theme.tileAmberFg}]}
            maxFontSizeMultiplier={1.1}>
            {value}
            {suffix ? <DenseText style={styles.ledgerSuffix}>{suffix}</DenseText> : null}
          </AppText>
        </View>
        <DenseText
          style={[styles.ledgerLabel, filled && {color: theme.tileAmberFg}]}
          numberOfLines={2}>
          {label}
        </DenseText>
      </View>
    </Touchable>
  );
}

/**
 * The dropdown under the profile icon. Three destinations, not one flat "Settings" —
 * they land on the matching category there rather than the top, which is the whole
 * point of having categories in the first place.
 */
function ProfileMenu({
  visible,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  onClose: () => void;
  onNavigate: (section: 'profile' | 'app' | 'system') => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const items: Array<{
    key: 'profile' | 'app' | 'system';
    icon: IconName;
    label: string;
    detail: string;
  }> = [
    {key: 'profile', icon: 'pencil', label: 'Profile settings', detail: 'Name, interests, peer ID'},
    {key: 'app', icon: 'gear', label: 'App settings', detail: 'Appearance, radio, blocked, data'},
    {key: 'system', icon: 'device', label: 'System settings', detail: 'Bluetooth & permission diagnostics'},
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View style={[styles.menuCard, {top: insets.top + 56}]}>
        {items.map((item, index) => (
          <Touchable
            key={item.key}
            scale={false}
            onPress={() => onNavigate(item.key)}
            style={index > 0 ? styles.menuRowDivided : styles.menuRow}>
            <View style={styles.menuIconWrap}>
              <Icon name={item.icon} color={theme.accent} size={16} />
            </View>
            <View style={styles.menuText}>
              <AppText style={styles.menuLabel} numberOfLines={1}>
                {item.label}
              </AppText>
              <DenseText style={styles.menuDetail} numberOfLines={1}>
                {item.detail}
              </DenseText>
            </View>
          </Touchable>
        ))}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  content: {padding: spacing.lg + 4, paddingBottom: spacing.xl * 2},
  grow: {flex: 1},
  block: {marginTop: spacing.lg},

  // ---- masthead ----------------------------------------------------------
  masthead: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2},
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  liveDot: {width: 7, height: 7, borderRadius: 3.5},
  liveLabel: {...typography.caption, fontWeight: '700'},
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    overflow: 'hidden',
  },

  errorCard: {borderColor: t.error, marginTop: spacing.lg},
  errorText: {...typography.callout, color: t.error, lineHeight: 18},

  // ---- hero --------------------------------------------------------------
  hero: {padding: 20, marginTop: spacing.lg, overflow: 'hidden'},
  heroRing: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroEyebrow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  heroEyebrowText: {
    ...typography.overline,
    color: 'rgba(255,255,255,0.82)',
    letterSpacing: 0.9,
  },
  heroCountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm + 2,
    marginTop: spacing.sm + 2,
  },
  heroCount: {
    color: '#ffffff',
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -1.6,
    lineHeight: 46,
  },
  heroCountLabel: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
    paddingBottom: 5,
  },
  heroFacesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: spacing.md + 2,
  },
  heroFaces: {flexDirection: 'row'},
  heroFace: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroFaceOverlap: {marginLeft: -10},
  heroFacesText: {color: 'rgba(255,255,255,0.86)', fontSize: 13, flex: 1},
  heroActions: {flexDirection: 'row', gap: spacing.sm, marginTop: 18},
  heroPrimary: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  heroPrimaryText: {fontSize: 15, fontWeight: '700'},
  heroSecondary: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- ledger ------------------------------------------------------------
  ledger: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md + 2},
  ledgerCellWrap: {flex: 1},
  ledgerCell: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  ledgerTop: {flexDirection: 'row', alignItems: 'center', gap: 5},
  ledgerValue: {color: t.text, fontSize: 17, fontWeight: '700'},
  ledgerSuffix: {color: t.textFaint, fontSize: 13, fontWeight: '600'},
  ledgerLabel: {...typography.caption, color: t.textDim, fontSize: 11, marginTop: 3},

  budgetNote: {
    ...typography.caption,
    color: t.warn,
    lineHeight: 16,
    marginTop: spacing.sm + 2,
    paddingHorizontal: 2,
  },

  // ---- sections ----------------------------------------------------------
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: spacing.sm + 2,
  },
  sectionTitle: {...typography.overline, color: t.textDim},
  sectionAction: {...typography.caption, color: t.accent, fontWeight: '700'},

  listCard: {borderRadius: 18, overflow: 'hidden'},
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  listRowDivided: {borderTopWidth: 1, borderTopColor: t.divider},
  listBody: {flex: 1, minWidth: 0},
  listTop: {flexDirection: 'row', alignItems: 'center', gap: 6},
  listName: {...typography.body, color: t.text, fontWeight: '700', flexShrink: 1},
  listMeta: {...typography.caption, color: t.textFaint, fontSize: 11},
  listPreview: {...typography.caption, color: t.textDim, marginTop: 2},
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {...typography.caption, color: '#ffffff', fontSize: 11, fontWeight: '700'},

  emptyRow: {paddingHorizontal: 14, paddingVertical: 16},
  emptyText: {...typography.caption, color: t.textDim, lineHeight: 17},

  newGroupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  newGroupTile: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newGroupText: {...typography.callout, color: t.accent, fontWeight: '700'},
  newGroupHint: {...typography.caption, color: t.textFaint, flexShrink: 1},

  // ---- radio -------------------------------------------------------------
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  radioTile: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioTitle: {...typography.callout, color: t.text, fontWeight: '700', fontSize: 14},
  radioDetail: {...typography.caption, color: t.textDim, marginTop: 1},

  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: spacing.md + 2,
    paddingHorizontal: 2,
  },
  warningText: {
    ...typography.caption,
    color: t.textFaint,
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },

  // ---- profile menu ------------------------------------------------------
  menuCard: {
    position: 'absolute',
    right: spacing.lg,
    width: 250,
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: t.border,
    paddingVertical: spacing.xs,
    ...elevation(t, 2),
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  menuRowDivided: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: t.divider,
  },
  menuIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {flex: 1},
  menuLabel: {...typography.callout, color: t.text, fontWeight: '700'},
  menuDetail: {...typography.caption, color: t.textDim, fontSize: 11, marginTop: 1},
}));
