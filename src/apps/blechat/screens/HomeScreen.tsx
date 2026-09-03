import React, {useCallback, useState} from 'react';
import {Alert, Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {BluetoothStatus} from '../components/BluetoothStatus';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, Pulse, Touchable} from '../components/Motion';
import {Card} from '../components/ui/Surface';
import {Mascot} from '../components/ui/Mascot';
import {Icon, type IconName} from '../components/ui/Icon';
import {IconTile} from '../components/ui/IconTile';
import {GradientSurface, Wordmark, brandGradient} from '../components/ui/Gradient';
import {elevation, radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {openAppSettings} from '../ble/BLEPermissions';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import type {RootTabScreenProps} from '../navigation/types';

/** Cycled across interest chips and group tiles so a busy list still reads as varied. */
const HUES: Array<{bg: (t: ReturnType<typeof useTheme>) => string; fg: (t: ReturnType<typeof useTheme>) => string}> = [
  {bg: t => t.tilePurple, fg: t => t.tilePurpleFg},
  {bg: t => t.tileGreen, fg: t => t.tileGreenFg},
  {bg: t => t.tileBlue, fg: t => t.tileBlueFg},
  {bg: t => t.tileAmber, fg: t => t.tileAmberFg},
];

export function HomeScreen({navigation}: RootTabScreenProps<'Home'>) {
  const styles = useStyles();
  const theme = useTheme();

  const identity = useAppStore(s => s.identity);
  const interests = useAppStore(s => s.settings.interests);
  const links = useAppStore(s => s.links);
  const bluetoothState = useAppStore(s => s.bluetoothState);
  const permission = useAppStore(s => s.permission);
  const peripheral = useAppStore(s => s.peripheral);
  const scanning = useAppStore(s => s.scanning);
  const peers = useAppStore(s => s.peers);
  const initError = useAppStore(s => s.initError);
  const groups = useAppStore(s => s.groups);

  // Summed from the peer records the store already keeps, so this cannot drift from the
  // per-conversation counts shown inside each chat.
  const queuedTotal = peers.reduce((total, p) => total + p.queuedCount, 0);
  const queuedPeerCount = peers.filter(p => p.queuedCount > 0).length;

  const connected = peers.filter(p => p.state === 'connected');
  const [profileMenuVisible, setProfileMenuVisible] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
              fontSize={30}
              width={168}
              height={40}
            />
            <View style={styles.mastheadRight}>
              {/* Labelled, not a bare dot — a lone coloured circle in the corner reads as
                  decoration, and with a word beside it it is the radio's real state. The
                  pulse is the only looping animation on the screen, and only runs while
                  something is genuinely ongoing: a static dot looks the same whether the
                  radio is scanning or wedged. */}
              <View
                style={[
                  styles.scanChip,
                  {
                    backgroundColor: scanning ? theme.tileGreen : theme.surfaceAlt,
                  },
                ]}>
                <Pulse active={scanning}>
                  <View
                    style={[
                      styles.scanDot,
                      {backgroundColor: scanning ? theme.tileGreenFg : theme.textDim},
                    ]}
                  />
                </Pulse>
                <DenseText
                  style={[
                    styles.scanLabel,
                    {color: scanning ? theme.tileGreenFg : theme.textDim},
                  ]}>
                  {scanning ? 'Scanning' : 'Idle'}
                </DenseText>
              </View>

              {/* The identity card below already shows who you are; this is the
                  shortcut to changing it, and to the settings that aren't about you
                  at all — kept as one small button rather than three, since the menu
                  underneath is where the actual categories live. */}
              <Touchable
                scale={false}
                onPress={() => setProfileMenuVisible(true)}
                style={styles.profileButton}
                accessibilityLabel="Profile and settings">
                <Mascot size={28} />
              </Touchable>
            </View>
          </View>
          {/* Full-width below the header row, rather than squeezed into the same column
              as the wordmark: that is the only way it and the trailing sparkle fit on
              one line the way the reference does. */}
          <DenseText style={styles.subtitle}>
            Peer-to-peer over Bluetooth. No server, no internet. ✨
          </DenseText>
        </FadeIn>

        {initError ? (
          <FadeIn index={1}>
            <Card style={styles.errorCard}>
              <DenseText style={styles.errorText}>
                Startup failed: {initError}
              </DenseText>
            </Card>
          </FadeIn>
        ) : null}

        <FadeIn index={1}>
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
        </FadeIn>

        {/* Identity. The peerId deliberately does not appear: it is a 32-character hex
            string that means nothing to the person holding the phone, and this is the
            first screen they see. It still lives in Settings and Debug. */}
        <FadeIn index={2}>
          <Card style={[styles.block, styles.identityCard]}>
            <View style={styles.identityRow}>
              <Mascot size={72} />
              <View style={styles.grow}>
                <View style={styles.identityTop}>
                  <AppText style={styles.identityName} numberOfLines={1}>
                    {identity?.displayName || 'No name set'}
                  </AppText>
                  <View style={styles.devicePill}>
                    <DenseText style={styles.devicePillText}>This device</DenseText>
                  </View>
                </View>

                {interests.length > 0 ? (
                  <View style={styles.tagRow}>
                    {interests.slice(0, 3).map((interest, i) => {
                      const hue = HUES[i % HUES.length];
                      return (
                        <View
                          key={interest}
                          style={[
                            styles.tag,
                            {backgroundColor: hue.bg(theme)},
                          ]}>
                          {/* maxFontSizeMultiplier=1: a short badge label like this has no
                              slack between the text's un-scaled auto-measured width and
                              the pill's rounded edge — any accessibility scaling here is
                              exactly what clips a trailing character with no ellipsis. */}
                          <DenseText
                            style={[styles.tagText, {color: hue.fg(theme)}]}
                            maxFontSizeMultiplier={1}>
                            {interest}
                          </DenseText>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Touchable
                    scale={false}
                    onPress={() => navigation.navigate('Settings')}>
                    <DenseText style={styles.addInterests}>
                      Add interests so people know what to talk to you about
                    </DenseText>
                  </Touchable>
                )}
              </View>
              <Touchable
                scale={false}
                onPress={() => navigation.navigate('Settings')}
                accessibilityLabel="Edit profile">
                <View
                  style={[styles.editButton, {backgroundColor: theme.tilePurple}]}>
                  <Icon name="pencil" color={theme.tilePurpleFg} size={16} />
                </View>
              </Touchable>
            </View>
          </Card>
        </FadeIn>

        {/* Three figures reading left to right as the funnel they actually are:
            seen, connected, waiting for a slot. */}
        <FadeIn index={3}>
          <Card style={styles.block} padded={false}>
            <View style={styles.statsRow}>
              <Stat
                icon="people"
                color={theme.tileBlueFg}
                label="Nearby"
                value={String(peers.length)}
              />
              <View style={styles.statDivider} />
              <Stat
                icon="link"
                color={theme.tileGreenFg}
                label="Connected"
                value={`${connected.length}/${links.effectiveBudget}`}
              />
              <View style={styles.statDivider} />
              <Stat
                icon="clock"
                color={theme.tileAmberFg}
                label="Waiting"
                value={String(links.waiting.length)}
              />
            </View>

            {/* Everything waiting to go out, in one place. Per-conversation counts
                already exist inside each chat, but with three people out of range that
                means opening three chats to learn nothing is stuck. */}
            {queuedTotal > 0 ? (
              <Touchable
                scale={false}
                onPress={() => navigation.navigate('Chats')}
                style={styles.queuedNote}
                accessibilityLabel="See queued messages">
                <Icon name="clock" color={theme.tileAmberFg} size={14} />
                <DenseText style={styles.queuedText}>
                  {queuedTotal} message{queuedTotal === 1 ? '' : 's'} waiting to send
                  {queuedPeerCount > 1 ? ` to ${queuedPeerCount} people` : ''} — they
                  will go out when {queuedPeerCount > 1 ? 'each is' : 'they are'} back
                  in range.
                </DenseText>
              </Touchable>
            ) : null}

            {/* A budget the radio lowered is worth saying out loud. Holding fewer links
                than asked for silently looks like a bug rather than a fact. */}
            {links.budgetLearned ? (
              <View style={styles.budgetNote}>
                <DenseText style={styles.budgetText}>
                  This phone refused a {links.effectiveBudget + 1}th link, so the limit
                  is {links.effectiveBudget}. Controllers cap how many connections they
                  hold and do not report the number.
                </DenseText>
              </View>
            ) : null}
          </Card>
        </FadeIn>

        <FadeIn index={4}>
          <View style={styles.actions}>
            <Touchable
              scale={false}
              onPress={() => navigation.navigate('Nearby')}
              style={styles.primaryButtonWrap}>
              <GradientSurface
                gradient={brandGradient(theme)}
                radius={radius.pill}
                style={styles.primaryButton}>
                <Icon name="target" color={theme.onAccent} size={18} />
                <AppText style={styles.primaryButtonText}>View nearby</AppText>
                <Icon name="chevronRight" color={theme.onAccent} size={18} />
              </GradientSurface>
            </Touchable>
            <Touchable
              scale={false}
              onPress={toggleScan}
              style={styles.secondaryButton}>
              <Icon name="stop" color={theme.error} size={14} />
              <AppText style={styles.secondaryButtonText}>
                {scanning ? 'Stop' : 'Scan'}
              </AppText>
            </Touchable>
          </View>
        </FadeIn>

        <FadeIn index={5}>
          <View style={styles.block}>
            <View style={styles.groupsHeader}>
              <DenseText style={styles.groupsTitle}>GROUPS</DenseText>
              <View style={styles.grow} />
              <Touchable
                scale={false}
                onPress={() => navigation.navigate('NewGroup')}
                style={styles.newGroupRow}>
                <DenseText
                  style={[styles.newGroupText, {color: theme.tilePurpleFg}]}>
                  New group
                </DenseText>
                <View
                  style={[styles.plusCircle, {backgroundColor: theme.tilePurple}]}>
                  <Icon name="plus" color={theme.tilePurpleFg} size={13} />
                </View>
              </Touchable>
            </View>

            {groups.length === 0 ? (
              <AccentRow
                accent={theme.tilePurpleFg}
                icon="people"
                tileBg={theme.tilePurple}
                tileFg={theme.tilePurpleFg}
                title="A group sends one message"
                detail="to several peers at once."
              />
            ) : (
              <View style={styles.groupList}>
                {groups.map((group, i) => {
                  const hue = HUES[i % HUES.length];
                  return (
                    <View key={group.id} style={i > 0 ? styles.groupSpacing : null}>
                      <AccentRow
                        accent={hue.fg(theme)}
                        icon="people"
                        tileBg={hue.bg(theme)}
                        tileFg={hue.fg(theme)}
                        title={group.name}
                        detail={`${group.members.length} members`}
                        onPress={() =>
                          navigation.navigate('Chat', {
                            groupId: group.id,
                            displayName: group.name,
                          })
                        }
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </FadeIn>

        <FadeIn index={7}>
          <View style={styles.block}>
            <AccentRow
              accent={theme.tileAmberFg}
              icon="shield"
              tileBg={theme.tileAmber}
              tileFg={theme.tileAmberFg}
              title="Traffic is unencrypted."
              detail="Do not treat this prototype as secure."
            />
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
    </SafeAreaView>
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
      <View style={[styles.menuCard, {top: insets.top + 64}]}>
        {items.map((item, index) => (
          <Touchable
            key={item.key}
            scale={false}
            onPress={() => onNavigate(item.key)}
            style={index > 0 ? styles.menuRowDivided : styles.menuRow}>
            <View style={styles.menuIconWrap}>
              <Icon name={item.icon} color={theme.tilePurpleFg} size={16} />
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

function Stat({
  icon,
  color,
  label,
  value,
}: {
  icon: IconName;
  color: string;
  label: string;
  value: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Icon name={icon} color={color} size={19} />
      <AppText style={styles.statValue}>{value}</AppText>
      <DenseText style={styles.statLabel} numberOfLines={1}>
        {label}
      </DenseText>
    </View>
  );
}

/**
 * A card with a coloured accent bar down the left edge, an icon tile, two lines of text
 * and a trailing chevron — the row style used for both the group placeholder and the
 * security notice. `onPress` is optional: the security notice has nowhere to go, and is
 * shown the same way rather than inventing a destination for it.
 */
function AccentRow({
  accent,
  icon,
  tileBg,
  tileFg,
  title,
  detail,
  onPress,
}: {
  accent: string;
  icon: IconName;
  tileBg: string;
  tileFg: string;
  title: string;
  detail: string;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const content = (
    <Card padded={false} style={styles.accentCard}>
      <View style={[styles.accentBar, {backgroundColor: accent}]} />
      <View style={styles.accentBody}>
        <IconTile icon={icon} bg={tileBg} fg={tileFg} size={38} iconSize={18} />
        <View style={styles.grow}>
          <AppText style={styles.accentTitle} numberOfLines={1}>
            {title}
          </AppText>
          <DenseText style={styles.accentDetail} numberOfLines={1}>
            {detail}
          </DenseText>
        </View>
        <Icon name="chevronRight" color={theme.textDim} size={16} />
      </View>
    </Card>
  );
  return onPress ? (
    <Touchable scale={false} onPress={onPress}>
      {content}
    </Touchable>
  ) : (
    content
  );
}

const useStyles = makeStyles(t => ({
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
    borderTopColor: t.border,
  },
  menuIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    backgroundColor: t.tilePurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: {flex: 1},
  menuLabel: {...typography.callout, color: t.text, fontWeight: '700'},
  menuDetail: {...typography.caption, color: t.textDim, fontSize: 11, marginTop: 1},

  safe: {flex: 1, backgroundColor: t.bg},
  content: {padding: spacing.lg, paddingBottom: spacing.xl * 2},
  grow: {flex: 1},
  block: {marginTop: spacing.lg},

  masthead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  mastheadRight: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  profileButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    overflow: 'hidden',
  },
  subtitle: {...typography.caption, color: t.textDim, marginTop: spacing.sm},
  scanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  scanDot: {width: 7, height: 7, borderRadius: 3.5},
  scanLabel: {...typography.caption, fontWeight: '700'},

  errorCard: {borderColor: t.error, marginTop: spacing.lg},
  errorText: {...typography.callout, color: t.error, lineHeight: 18},

  identityCard: {borderRadius: radius.xl + 2},
  identityRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  identityTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap'},
  identityName: {...typography.title, color: t.text},
  devicePill: {
    backgroundColor: t.tilePurple,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  devicePillText: {...typography.caption, color: t.tilePurpleFg, fontWeight: '700'},
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  // flexShrink: 0 — this sits in a flexWrap row; without it, a flex layout is allowed to
  // squeeze a chip narrower than its text needs before it wraps to the next line, which
  // can clip the last character or two with no ellipsis to show for it.
  tag: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    flexShrink: 0,
  },
  tagText: {...typography.caption, fontWeight: '700'},
  addInterests: {...typography.callout, color: t.tilePurpleFg, marginTop: spacing.sm},
  editButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Centred rather than stretched: a divider that runs the full height of the row reads
  // as a cell border, where a short centred one reads as separating three figures.
  statsRow: {flexDirection: 'row', alignItems: 'center'},
  stat: {flex: 1, alignItems: 'center', paddingVertical: spacing.lg, gap: 6},
  statValue: {...typography.numeric, color: t.text},
  statLabel: {...typography.caption, color: t.textDim},
  statDivider: {width: 1, height: 40, backgroundColor: t.border},
  queuedNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  queuedText: {
    ...typography.caption,
    color: t.textDim,
    lineHeight: 16,
    flex: 1,
  },

  budgetNote: {
    borderTopWidth: 1,
    borderTopColor: t.border,
    padding: spacing.md,
  },
  budgetText: {...typography.caption, color: t.warn, lineHeight: 16},

  actions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg},
  primaryButtonWrap: {flex: 1.7},
  primaryButton: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: {...typography.headline, color: t.onAccent, fontWeight: '700'},
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 54,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
  },
  secondaryButtonText: {...typography.headline, color: t.text, fontWeight: '700'},

  groupsHeader: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm},
  groupsTitle: {...typography.overline, color: t.textDim},
  newGroupRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
  newGroupText: {...typography.callout, fontWeight: '700'},
  plusCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  groupList: {},
  groupSpacing: {marginTop: spacing.sm},

  accentCard: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: radius.xl,
  },
  accentBar: {width: 4},
  accentBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  accentTitle: {...typography.headline, color: t.text},
  accentDetail: {...typography.caption, color: t.textDim, marginTop: 1},
}));
