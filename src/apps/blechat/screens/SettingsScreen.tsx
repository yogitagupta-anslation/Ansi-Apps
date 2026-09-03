import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {bleChat} from '../services/BleChatService';
import {storage} from '../storage/LocalStorage';
import {useAppStore} from '../state/appStore';
import type {AppSettings} from '../storage/LocalStorage';
import {InterestPicker} from '../components/InterestPicker';
import {AppText, DenseText} from '../components/AppText';
import {Button, Card, KeyValue, SectionHeader} from '../components/ui/Surface';
import {Mascot} from '../components/ui/Mascot';
import {Screen} from '../components/ui/Screen';
import {Icon, type IconName} from '../components/ui/Icon';
import {Touchable} from '../components/Motion';
import {AppLockScreen} from './AppLockScreen';
import {hashPin} from '../security/AppLock';
import {MAX_DISPLAY_NAME_LENGTH} from '../config/interests';
import {LINK_BUDGET_MAX} from '../config/constants';
import {shortId} from '../utils/id';
import {describeKind, isAlarming} from '../security/SecurityLog';
import {relativeTime} from '../utils/time';
import type {RootStackScreenProps} from '../navigation/types';

type Category = 'profile' | 'app' | 'system';

const TABS: Array<{key: Category; label: string}> = [
  {key: 'profile', label: 'Profile'},
  {key: 'app', label: 'App'},
  {key: 'system', label: 'System'},
];

export function SettingsScreen({route, navigation}: RootStackScreenProps<'Settings'>) {
  const styles = useStyles();
  const theme = useTheme();
  const settings = useAppStore(s => s.settings);
  const identity = useAppStore(s => s.identity);
  const peripheral = useAppStore(s => s.peripheral);
  const links = useAppStore(s => s.links);
  const blockedPeerIds = useAppStore(s => s.blockedPeerIds);
  const peers = useAppStore(s => s.peers);
  const securityEvents = useAppStore(s => s.securityEvents);
  // Read once on mount: the protection level is decided when the key is first loaded
  // and does not change while the app runs.
  const [keyProtection, setKeyProtection] = useState(storage.getKeyProtection());

  /**
   * Which category is on screen — a tab, not a scroll offset.
   *
   * Profile, App and System used to be coloured headings inside one very long scroll,
   * and arriving from Home's menu meant measuring each heading's y position and
   * animating to it after a timeout, because the measurement had not landed on first
   * render. A deep link is now a tab selection: nothing to measure, nothing to race.
   */
  const [tab, setTab] = useState<Category>(route.params?.section ?? 'profile');

  useEffect(() => {
    if (route.params?.section) {
      setTab(route.params.section);
    }
  }, [route.params?.section]);

  // A blocked peerId alone is not a name — the person may not be in range, or may never
  // have been, if they were blocked straight from a Nearby row before a full handshake
  // completed elsewhere. shortId is what is left to show at that point.
  const blockedPeople = blockedPeerIds.map(peerId => ({
    peerId,
    displayName: peers.find(p => p.peerId === peerId)?.displayName ?? null,
  }));

  const [name, setName] = useState(settings.displayName);
  const [pinLockEnabled, setPinLockEnabled] = useState(false);
  const [lockSetupVisible, setLockSetupVisible] = useState(false);

  useEffect(() => {
    setName(settings.displayName);
  }, [settings.displayName]);

  useEffect(() => {
    storage.loadAppLock().then(({enabled}) => setPinLockEnabled(enabled));
  }, []);

  useEffect(() => {
    // A read is what forces the key to load on a fresh install, so the reported level
    // is the real one rather than 'unknown'.
    storage.loadOutbox().then(() => setKeyProtection(storage.getKeyProtection()));
  }, []);

  const save = (patch: Partial<AppSettings>) => {
    bleChat.updateSettings(patch).catch(err =>
      Alert.alert('Settings', err instanceof Error ? err.message : String(err)),
    );
  };

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === settings.displayName) {
      setName(settings.displayName);
      return;
    }
    save({displayName: trimmed});
  };

  return (
    // A Stack screen, not a Tab screen — unlike Home/Chats/Nearby/Debug there is no tab
    // bar underneath reserving the bottom gesture-nav inset, so this one has to claim it
    // itself or the last rows (Unblock, Clear chat history) can rest right under the strip.
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Touchable
          scale={false}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.headerIconButton}
          accessibilityLabel="Back">
          <Icon name="chevronLeft" color={theme.text} size={22} />
        </Touchable>
        <AppText style={styles.heading}>Settings</AppText>
      </View>

      <View style={styles.tabsWrap}>
        <View style={styles.tabs}>
          {TABS.map(option => {
            const active = option.key === tab;
            return (
              <Touchable
                key={option.key}
                scale={false}
                onPress={() => setTab(option.key)}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                style={active ? [styles.tab, styles.tabActive] : styles.tab}>
                <AppText
                  style={active ? styles.tabTextActive : styles.tabText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.1}>
                  {option.label}
                </AppText>
              </Touchable>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'profile' ? (
          <>
            {/* Who you are, as other people see it — the same card the hub's avatar
                button leads to. It sits above the fields rather than being assembled
                from them, so the first thing this tab shows is the result. */}
            <View style={styles.identityCard}>
              <Mascot size={54} />
              <View style={styles.flex}>
                <AppText style={styles.identityName} numberOfLines={1}>
                  {settings.displayName || 'No name set'}
                </AppText>
                <DenseText style={styles.identityMeta} numberOfLines={1}>
                  {settings.interests.length > 0
                    ? settings.interests.join(' · ')
                    : 'No interests yet'}
                </DenseText>
              </View>
            </View>
          <Section title="Identity">
            <AppText style={styles.label}>Display name</AppText>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              onBlur={commitName}
              onSubmitEditing={commitName}
              placeholder="Your name"
              placeholderTextColor={theme.textDim}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              returnKeyType="done"
            />
            <DenseText style={styles.hint}>
              What other people see. Sent in the handshake and, on Android, carried in
              the advertisement — kept short because the scan response is only 31 bytes.
            </DenseText>

            <AppText style={[styles.label, styles.spaced]}>Interests</AppText>
            <DenseText style={styles.hint}>
              Shared with every peer you connect to, and highlighted on their Nearby
              screen when they match. Changes reach the next peer you meet.
            </DenseText>
            <View style={styles.picker}>
              <InterestPicker
                selected={settings.interests}
                onChange={next => save({interests: next})}
              />
            </View>

            <AppText style={[styles.label, styles.spaced]}>Peer ID</AppText>
            <DenseText style={styles.mono} selectable>
              {identity?.peerId ?? '...'}
            </DenseText>
            <DenseText style={styles.hint}>
              The technical identity, derived from this installation's public key. Other
              people are shown your name, never this — it lives here for diagnostics.
            </DenseText>
          </Section>
          </>
        ) : null}

        {tab === 'app' ? (
          <>

        <Section title="Appearance">
          <AppText style={styles.label}>Theme</AppText>
          <View style={styles.segmented}>
            {(['system', 'light', 'dark'] as const).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.segment,
                  settings.themeMode === mode && styles.segmentActive,
                ]}
                onPress={() => save({themeMode: mode})}>
                <AppText
                  numberOfLines={1}
                  style={[
                    styles.segmentText,
                    settings.themeMode === mode && styles.segmentTextActive,
                  ]}>
                  {mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
                </AppText>
              </TouchableOpacity>
            ))}
          </View>
          <DenseText style={styles.hint}>
            System follows your device appearance setting and switches live.
          </DenseText>
        </Section>

        <Section title="Radio">
          <Toggle
            first
            label="Scan automatically"
            value={settings.autoStartScanning}
            onChange={v => save({autoStartScanning: v})}
            hint="Start looking for peers as soon as Bluetooth is available."
          />
          <Toggle
            label="Be discoverable"
            value={settings.autoAdvertise}
            onChange={v => save({autoAdvertise: v})}
            hint="Run the peripheral role so other phones can find and connect to this one."
          />
          <Toggle
            label="Reconnect automatically"
            value={settings.autoReconnect}
            onChange={v => save({autoReconnect: v})}
            hint="Re-dial a peer with exponential backoff after the link drops."
          />
          <Toggle
            label="Connect automatically"
            value={settings.autoConnect}
            onChange={v => save({autoConnect: v})}
            hint="Dial every chat peer discovered, up to the limit below. Off is a fair choice for battery or a crowded room."
          />
          {/* Deliberately not a Switch. Relaying is not implemented — the flag only
              travels in the handshake and changes nothing about what the app does — so
              presenting it as a working control would be a lie told by the UI. */}
          <View style={styles.unbuiltRow}>
            <View style={styles.flex}>
              <AppText style={styles.unbuiltLabel}>Relay messages for others</AppText>
              <DenseText style={styles.hint}>
                Passing messages along for peers who are out of range of each other.
                Not built yet — this app only delivers over a direct link.
              </DenseText>
            </View>
            <View style={styles.comingBadge}>
              <DenseText style={styles.comingBadgeText} maxFontSizeMultiplier={1}>
                PHASE 2
              </DenseText>
            </View>
          </View>

          <AppText style={[styles.label, styles.spaced]}>
            Simultaneous connections
          </AppText>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() =>
                save({maxConnections: Math.max(1, settings.maxConnections - 1)})
              }>
              <AppText style={styles.stepGlyph}>−</AppText>
            </TouchableOpacity>
            <AppText style={styles.stepValue}>{settings.maxConnections}</AppText>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() =>
                save({
                  maxConnections: Math.min(
                    LINK_BUDGET_MAX,
                    settings.maxConnections + 1,
                  ),
                })
              }>
              <AppText style={styles.stepGlyph}>+</AppText>
            </TouchableOpacity>
            {links.budgetLearned && (
              <DenseText style={styles.stepNote} numberOfLines={2}>
                Radio granted {links.effectiveBudget}
              </DenseText>
            )}
          </View>
          <DenseText style={styles.hint}>
            A request, not a promise. Bluetooth controllers cap how many links they hold
            — commonly around seven — and no API reports the number, so the app finds it
            by trying and lowers this to match. Raising it here makes it try again.
          </DenseText>
        </Section>

        <Section title="Security">
          <View style={styles.toggleRowFirst}>
            <View style={styles.flex}>
              <AppText style={styles.toggleLabel}>App PIN lock</AppText>
              <DenseText style={styles.hint}>
                {pinLockEnabled
                  ? 'Locked whenever the app leaves the foreground. Not encryption — a ' +
                    'local screen lock.'
                  : 'Off. Anyone holding this unlocked phone can open straight into ' +
                    'your conversations.'}
              </DenseText>
            </View>
            <Switch
              value={pinLockEnabled}
              onValueChange={v => {
                if (v) {
                  setLockSetupVisible(true);
                  return;
                }
                Alert.alert(
                  'Turn off app lock?',
                  'The app will no longer ask for a PIN.',
                  [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Turn off',
                      style: 'destructive',
                      onPress: () => {
                        storage.clearAppLock().then(() => setPinLockEnabled(false));
                      },
                    },
                  ],
                );
              }}
              trackColor={{true: theme.accent, false: theme.border}}
              thumbColor={theme.isDark ? undefined : '#ffffff'}
            />
          </View>
          {pinLockEnabled && (
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setLockSetupVisible(true)}>
              <DenseText style={[styles.label, {color: theme.accent}]}>
                Change PIN
              </DenseText>
            </TouchableOpacity>
          )}
        </Section>

        <Section title="Security history">
          {securityEvents.length === 0 ? (
            <DenseText style={styles.hint}>
              Nothing to report. Identity changes, refused handshakes and verification
              decisions are recorded here as they happen.
            </DenseText>
          ) : (
            securityEvents.slice(0, 20).map((event, index) => (
              <View
                key={event.id}
                style={index === 0 ? styles.eventRowFirst : styles.eventRow}>
                <View
                  style={[
                    styles.eventDot,
                    {
                      backgroundColor: isAlarming(event.kind)
                        ? theme.error
                        : theme.textDim,
                    },
                  ]}
                />
                <View style={styles.flex}>
                  <AppText
                    style={[
                      styles.toggleLabel,
                      isAlarming(event.kind) ? {color: theme.error} : null,
                    ]}>
                    {describeKind(event.kind)}
                    {event.displayName ? ` · ${event.displayName}` : ''}
                  </AppText>
                  <DenseText style={styles.hint}>{event.detail}</DenseText>
                  <DenseText style={styles.eventWhen}>
                    {relativeTime(event.at)}
                  </DenseText>
                </View>
              </View>
            ))
          )}
        </Section>

        {blockedPeople.length > 0 && (
          <Section title="Blocked">
            {blockedPeople.map(({peerId, displayName}, index) => (
              <View
                key={peerId}
                style={index === 0 ? styles.blockedRowFirst : styles.blockedRow}>
                <View style={styles.flex}>
                  <AppText style={styles.toggleLabel} numberOfLines={1}>
                    {displayName ?? 'Someone you have not met'}
                  </AppText>
                  <DenseText style={styles.hint}>{shortId(peerId)}</DenseText>
                </View>
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() =>
                    Alert.alert(
                      `Unblock ${displayName ?? 'this person'}?`,
                      "You'll be able to connect to each other again.",
                      [
                        {text: 'Cancel', style: 'cancel'},
                        {
                          text: 'Unblock',
                          onPress: () => bleChat.peerManager.unblockPeer(peerId),
                        },
                      ],
                    )
                  }>
                  <AppText style={styles.unblockText} numberOfLines={1}>
                    Unblock
                  </AppText>
                </TouchableOpacity>
              </View>
            ))}
          </Section>
        )}

        <Section title="Data">
          <Button
            label="Clear chat history"
            variant="danger"
            onPress={() =>
              Alert.alert('Clear chat history', 'Delete all stored messages?', [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => {
                    storage.clearMessages().catch(() => undefined);
                    Alert.alert(
                      'Cleared',
                      'Stored messages deleted. Restart the app to refresh the view.',
                    );
                  },
                },
              ])
            }
          />
        </Section>
          </>
        ) : null}

        {tab === 'system' ? (
          <>

        <Section title="Peripheral capability">
          {peripheral.capabilities ? (
            <>
              <Row
                label="Native module linked"
                value={peripheral.available ? 'yes' : 'no'}
              />
              <Row
                label="Hardware advertiser"
                value={peripheral.capabilities.hasAdvertiser ? 'yes' : 'no'}
              />
              <Row
                label="Multi-advertisement"
                value={
                  peripheral.capabilities.supportsMultipleAdvertisement ? 'yes' : 'no'
                }
              />
              <Row label="Advertising now" value={peripheral.advertising ? 'yes' : 'no'} />
              {peripheral.capabilities.missingPermissions.length > 0 && (
                <Row
                  label="Missing permissions"
                  value={peripheral.capabilities.missingPermissions.join(', ')}
                />
              )}
            </>
          ) : (
            <DenseText style={styles.hint}>
              Capability probe has not run yet. It runs once Bluetooth is powered on.
            </DenseText>
          )}
          {peripheral.error && (
            <DenseText style={styles.error}>{peripheral.error}</DenseText>
          )}
        </Section>

        <Section title="Data at rest">
          <Row
            label="Message storage"
            value={
              keyProtection === 'hardware'
                ? 'Encrypted, hardware key'
                : keyProtection === 'software'
                ? 'Encrypted, software key'
                : 'Checking...'
            }
          />
          <DenseText style={styles.hint}>
            {keyProtection === 'hardware'
              ? 'Messages are encrypted, and the key that unlocks them is held in this ' +
                'phone’s secure hardware where it cannot be exported. Copying the ' +
                'app’s files to another device gets an attacker nothing. It does ' +
                'not protect an unlocked phone in someone else’s hands.'
              : keyProtection === 'software'
              ? 'Messages are encrypted, but this device has no usable secure hardware, ' +
                'so the key is stored alongside them. That defends against a casual ' +
                'copy of the files, not against someone who reads the key too.'
              : 'Working out how this device can protect the key.'}
          </DenseText>
        </Section>

        <Section title="Device security">
          <Row label="Screenshots & screen recording" value="Allowed (test build)" />
          <DenseText style={styles.hint}>
            Normally blocked at the OS level so chat content can't be captured — turned
            off for this test build so bug screenshots can be taken and sent during
            development. Re-enable before treating this as anything but a test build.
          </DenseText>
        </Section>
          </>
        ) : null}

        <DenseText style={styles.footnote}>
          Phase 1 packets are plaintext JSON. Authentication and end-to-end encryption are
          Phase 4 work; until then this prototype must not be considered secure.
        </DenseText>
      </ScrollView>

      <Modal
        visible={lockSetupVisible}
        animationType="slide"
        onRequestClose={() => setLockSetupVisible(false)}>
        <AppLockScreen
          mode="setup"
          onCancel={() => setLockSetupVisible(false)}
          onSetupComplete={pin => {
            storage.saveAppLockPin(hashPin(pin)).then(() => {
              setPinLockEnabled(true);
              setLockSetupVisible(false);
            });
          }}
        />
      </Modal>
    </Screen>
  );
}

/**
 * A titled group of settings.
 *
 * The label sits ABOVE the card rather than inside it, matching every other list in the
 * app. A heading inside a bordered box competes with the first row for the top of that
 * box; outside, it does the one job a section header has.
 */
function Section({title, children}: {title: string; children: React.ReactNode}) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      <Card>{children}</Card>
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
  hint,
  first,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint: string;
  /** The first row in a card has the card's own edge above it already. */
  first?: boolean;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={first ? styles.toggleRowFirst : styles.toggleRow}>
      <View style={styles.flex}>
        <AppText style={styles.toggleLabel}>{label}</AppText>
        <DenseText style={styles.hint}>{hint}</DenseText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{true: theme.accent, false: theme.border}}
        thumbColor={theme.isDark ? undefined : '#ffffff'}
      />
    </View>
  );
}

function Row({label, value}: {label: string; value: string}) {
  return <KeyValue label={label} value={value} mono />;
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},

  tabsWrap: {paddingHorizontal: spacing.lg + 4, paddingBottom: spacing.md},
  tabs: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: t.surfaceAlt,
    borderRadius: 12,
    padding: 3,
  },
  tab: {flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9},
  // A raised chip, not a tint: the selected tab should look like it is on top of the
  // track rather than a differently-coloured part of it.
  tabActive: {
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOpacity: t.isDark ? 0.3 : 0.08,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  tabText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  tabTextActive: {...typography.callout, color: t.text, fontWeight: '700'},

  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 22,
    padding: spacing.lg,
  },
  identityName: {fontSize: 19, fontWeight: '700', letterSpacing: -0.3, color: t.text},
  identityMeta: {...typography.caption, color: t.textDim, marginTop: 2},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerIconButton: {padding: 4},
  content: {padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xl * 2},
  heading: {...typography.display, color: t.text},

  section: {marginBottom: spacing.lg},

  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: {...typography.headline, fontWeight: '800'},

  label: {...typography.callout, color: t.text, fontWeight: '600'},
  spaced: {marginTop: spacing.lg},
  hint: {...typography.caption, color: t.textDim, marginTop: 3, lineHeight: 16},
  picker: {marginTop: spacing.md},

  input: {
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: t.text,
    ...typography.body,
    marginTop: spacing.sm,
  },
  mono: {
    color: t.textDim,
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: spacing.sm,
  },

  // A segmented control rather than three buttons: the options are mutually exclusive
  // and short, which is exactly what a segment is for.
  segmented: {
    flexDirection: 'row',
    backgroundColor: t.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    marginTop: spacing.sm,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm + 1,
    alignItems: 'center',
  },
  segmentActive: {backgroundColor: t.accent},
  segmentText: {...typography.callout, color: t.textDim, fontWeight: '600'},
  segmentTextActive: {color: t.onAccent},

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {color: t.text, fontSize: 18},
  stepValue: {
    ...typography.title,
    color: t.text,
    minWidth: 26,
    textAlign: 'center',
  },
  stepNote: {...typography.caption, color: t.warn, flexShrink: 1},

  // Rows are separated by a hairline rather than by margin: inside one card, spaced
  // rows read as unrelated blocks that happen to share a border.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  toggleRowFirst: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  flex: {flex: 1, marginRight: spacing.md},
  toggleLabel: {...typography.callout, color: t.text, fontWeight: '600'},

  // A row for something that exists in the design but not yet in the code. Dimmed and
  // badged rather than switchable, so it reads as a plan rather than a setting.
  unbuiltRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  unbuiltLabel: {...typography.callout, color: t.textDim, fontWeight: '600'},
  comingBadge: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    flexShrink: 0,
  },
  comingBadgeText: {
    ...typography.caption,
    color: t.textDim,
    fontWeight: '700',
    fontSize: 10,
  },

  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  eventRowFirst: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  eventDot: {width: 7, height: 7, borderRadius: 4, marginTop: 6, flexShrink: 0},
  eventWhen: {...typography.caption, color: t.textDim, fontSize: 10, marginTop: 3},

  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  blockedRowFirst: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.md,
  },
  unblockButton: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  unblockText: {...typography.caption, color: t.text, fontWeight: '600'},

  error: {...typography.caption, color: t.error, marginTop: spacing.sm},
  footnote: {
    ...typography.caption,
    color: t.textDim,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: spacing.sm,
  },
}));
