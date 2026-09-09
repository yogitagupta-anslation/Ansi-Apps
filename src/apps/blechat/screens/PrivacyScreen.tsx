import React, {useCallback, useEffect, useState} from 'react';
import {Alert, AppState, Modal, ScrollView, Switch, View} from 'react-native';

import {AppText, DenseText} from '../components/AppText';
import {Touchable} from '../components/Motion';
import {Icon, type IconName} from '../components/ui/Icon';
import {Screen} from '../components/ui/Screen';
import {AppLockScreen} from './AppLockScreen';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {bleChat} from '../services/BleChatService';
import {storage} from '../storage/LocalStorage';
import {useAppStore} from '../state/appStore';
import {hashPin} from '../security/AppLock';
import {describeKind, isAlarming} from '../security/SecurityLog';
import {relativeTime} from '../utils/time';
import type {RootStackScreenProps} from '../navigation/types';

/**
 * Privacy & security — who can reach you, and what this phone is holding.
 *
 * The read-only rows at the bottom matter as much as the controls above them. This app
 * makes real claims about encryption and key storage, and a screen that only offered
 * switches would leave those claims somewhere the user cannot check. What the device
 * actually manages to do — hardware-backed key or not — is stated as a fact, including
 * when the answer is the weaker one.
 */
export function PrivacyScreen({navigation}: RootStackScreenProps<'Privacy'>) {
  const styles = useStyles();
  const theme = useTheme();

  const blockedPeerIds = useAppStore(s => s.blockedPeerIds);
  const peers = useAppStore(s => s.peers);
  const securityEvents = useAppStore(s => s.securityEvents);

  const [lockEnabled, setLockEnabled] = useState(false);
  const [lockSetupVisible, setLockSetupVisible] = useState(false);
  const [keyProtection] = useState(() => storage.getKeyProtection());

  const refreshLock = useCallback(() => {
    void storage.loadAppLock().then(({enabled}) => setLockEnabled(enabled));
  }, []);
  useEffect(() => {
    refreshLock();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshLock();
      }
    });
    return () => sub.remove();
  }, [refreshLock]);

  /**
   * Empty every thread that is loaded, then drop the stored keys.
   *
   * Going through the message service rather than straight to storage is what makes the
   * chat list update while you watch instead of after a restart; the storage sweep
   * afterwards catches threads this session never opened.
   */
  const clearEverything = async () => {
    for (const conversationId of Object.keys(useAppStore.getState().conversations)) {
      await bleChat.messages.clearConversation(conversationId);
    }
    await storage.clearMessages();
  };

  const nameFor = (peerId: string) =>
    peers.find(p => p.peerId === peerId)?.displayName ?? 'Someone you blocked';

  const toggleLock = (next: boolean) => {
    if (next) {
      setLockSetupVisible(true);
      return;
    }
    Alert.alert(
      'Turn off the lock?',
      'Anyone holding this phone will be able to read your conversations.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => {
            void storage.clearAppLock().then(refreshLock);
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Touchable
          scale={false}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back">
          <Icon name="chevronLeft" size={20} color={theme.text} />
        </Touchable>
        <AppText style={styles.title}>Privacy</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <DenseText style={styles.sectionLabel}>THIS PHONE</DenseText>
        <View style={styles.row}>
          <Disc icon="key" />
          <View style={styles.rowText}>
            <AppText style={styles.rowLabel}>Lock the app</AppText>
            <DenseText style={styles.rowHint}>
              {lockEnabled
                ? 'A PIN is needed every time you come back'
                : 'Anyone holding this phone can read your conversations'}
            </DenseText>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={toggleLock}
            trackColor={{false: theme.border, true: theme.accent}}
            thumbColor="#ffffff"
            accessibilityLabel="Lock the app"
          />
        </View>

        <DenseText style={styles.sectionLabel}>BLOCKED</DenseText>
        {blockedPeerIds.length === 0 ? (
          <DenseText style={styles.empty}>
            Nobody. Blocking somebody closes the link and refuses the next one.
          </DenseText>
        ) : (
          blockedPeerIds.map(peerId => (
            <View key={peerId} style={styles.row}>
              <Disc icon="block" tone={theme.error} />
              <View style={styles.rowText}>
                <AppText style={styles.rowLabel}>{nameFor(peerId)}</AppText>
                <DenseText style={styles.rowHint}>Will not connect</DenseText>
              </View>
              <Touchable
                scale={false}
                onPress={() => bleChat.peerManager.unblockPeer(peerId)}
                style={styles.pill}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${nameFor(peerId)}`}>
                <DenseText style={styles.pillText}>Unblock</DenseText>
              </Touchable>
            </View>
          ))
        )}

        <DenseText style={styles.sectionLabel}>WHAT THIS PHONE HOLDS</DenseText>
        <Fact
          icon="shield"
          label="Message storage"
          value={
            keyProtection === 'hardware'
              ? 'Encrypted, key held by secure hardware'
              : keyProtection === 'software'
              ? 'Encrypted, key stored alongside'
              : 'Working it out'
          }
          hint={
            keyProtection === 'hardware'
              ? 'The key cannot be read out of the device, only used by it.'
              : keyProtection === 'software'
              ? 'This device has no usable secure hardware, so the key sits beside the messages. That defends against a casual copy of the files, not against somebody who reads the key too.'
              : undefined
          }
        />
        <Fact
          icon="device"
          label="Screenshots"
          value="Allowed (test build)"
          hint="Normally blocked by the OS so chat content cannot be captured. Left on for this build so bug reports can include screenshots."
        />

        <DenseText style={styles.sectionLabel}>SECURITY HISTORY</DenseText>
        {securityEvents.length === 0 ? (
          <DenseText style={styles.empty}>
            Nothing to report. Identity changes, refused handshakes and verification
            decisions are recorded here as they happen.
          </DenseText>
        ) : (
          securityEvents.slice(0, 20).map(event => (
            <View key={event.id} style={styles.eventRow}>
              <View
                style={[
                  styles.eventDot,
                  {backgroundColor: isAlarming(event.kind) ? theme.warn : theme.textFaint},
                ]}
              />
              <View style={styles.eventText}>
                <AppText style={styles.eventKind}>{describeKind(event.kind)}</AppText>
                <DenseText style={styles.eventDetail}>{event.detail}</DenseText>
              </View>
              <DenseText style={styles.eventWhen}>{relativeTime(event.at)}</DenseText>
            </View>
          ))
        )}

        <DenseText style={styles.sectionLabel}>DATA</DenseText>
        <Touchable
          scale={false}
          onPress={() =>
            Alert.alert(
              'Clear chat history?',
              'Deletes every message on this phone. The other side keeps their copy — there is no server to delete it from.',
              [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => {
                    void clearEverything().catch((err: unknown) =>
                      Alert.alert(
                        'Could not clear',
                        err instanceof Error ? err.message : String(err),
                      ),
                    );
                  },
                },
              ],
            )
          }
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel="Clear chat history">
          <Disc icon="trash" tone={theme.error} />
          <View style={styles.rowText}>
            <AppText style={[styles.rowLabel, {color: theme.error}]}>Clear chat history</AppText>
            <DenseText style={styles.rowHint}>
              Every message on this phone. Your identity stays.
            </DenseText>
          </View>
        </Touchable>
      </ScrollView>

      <Modal
        visible={lockSetupVisible}
        animationType="slide"
        onRequestClose={() => setLockSetupVisible(false)}>
        <AppLockScreen
          mode="setup"
          onCancel={() => setLockSetupVisible(false)}
          onSetupComplete={pin => {
            void storage.saveAppLockPin(hashPin(pin)).then(() => {
              setLockSetupVisible(false);
              refreshLock();
            });
          }}
        />
      </Modal>
    </Screen>
  );
}

function Disc({icon, tone}: {icon: IconName; tone?: string}) {
  const styles = useStyles();
  const theme = useTheme();
  const colour = tone ?? theme.accent;
  return (
    <View style={[styles.rowIcon, {backgroundColor: colour + (theme.isDark ? '26' : '14')}]}>
      <Icon name={icon} size={16} color={colour} strokeWidth={1.9} />
    </View>
  );
}

function Fact({
  icon,
  label,
  value,
  hint,
}: {
  icon: IconName;
  label: string;
  value: string;
  hint?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Disc icon={icon} />
      <View style={styles.rowText}>
        <AppText style={styles.rowLabel}>{label}</AppText>
        <DenseText style={styles.rowValue}>{value}</DenseText>
        {hint ? <DenseText style={styles.rowHint}>{hint}</DenseText> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  head: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10},
  back: {padding: 4},
  title: {fontSize: 28, fontWeight: '600', letterSpacing: -1, color: t.text, flex: 1},
  content: {paddingBottom: spacing.xl},

  sectionLabel: {
    ...typography.overline,
    color: t.textDim,
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 8,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 18},
  rowIcon: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center'},
  rowText: {flex: 1},
  rowLabel: {fontSize: 14.5, color: t.text},
  rowValue: {...typography.caption, color: t.text, marginTop: 2},
  rowHint: {...typography.caption, color: t.textDim, marginTop: 2},
  empty: {...typography.caption, color: t.textDim, paddingHorizontal: 18, paddingBottom: 4},

  pill: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  pillText: {fontSize: 12.5, fontWeight: '500', color: t.text},

  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  eventDot: {width: 6, height: 6, borderRadius: 3, marginTop: 6},
  eventText: {flex: 1},
  eventKind: {fontSize: 13, color: t.text},
  eventDetail: {...typography.caption, color: t.textDim, marginTop: 1},
  eventWhen: {...typography.monoTiny, color: t.textFaint},
}));
