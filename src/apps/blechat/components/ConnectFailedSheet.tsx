import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import type {LinkFailure, LinkFailureReason} from '../types/BLE';

/**
 * What to do about a connection that did not happen.
 *
 * This replaces an alert that said `GATT 133 during connecting` and then stopped. That
 * string is the truth and it belongs in a bug report, but as the entire response to a
 * failed tap it tells the person holding the phone nothing they can act on.
 *
 * The advice below is keyed on the FAILURE REASON rather than being three fixed tips.
 * The transport already classifies every failure into a typed reason, so "move closer"
 * can be shown when the link dropped mid-handshake and withheld when Bluetooth is simply
 * switched off — where moving closer would be useless advice confidently given. Anything
 * we cannot classify falls back to the honest generic set.
 *
 * The technical detail stays, in mono, at the bottom. It is the part a developer needs
 * and the part a user should be able to ignore, so it is last and quietest rather than
 * absent.
 */

interface Tip {
  icon: IconName;
  text: string;
}

const CLOSER: Tip = {icon: 'target', text: 'Move a little closer and try again'};
const OPEN_APP: Tip = {
  icon: 'device',
  text: 'Ask them to open BLE Chat, so their phone is listening',
};
const TOGGLE: Tip = {
  icon: 'bluetooth',
  text: 'If it keeps failing, both of you turn Bluetooth off and on',
};
const WAIT: Tip = {icon: 'clock', text: 'Wait a few seconds — the radio needs a moment between attempts'};
const FEWER: Tip = {
  icon: 'link',
  text: 'Disconnect from someone else first; a phone can only hold so many links',
};

/** What actually happened, said without jargon. */
const CAUSE: Partial<Record<LinkFailureReason, string>> = {
  PermissionDenied:
    'Android has not given BLE Chat permission to reach nearby devices, so the attempt never left this phone.',
  BluetoothOff: 'Bluetooth is switched off on this phone, so there was nothing to connect with.',
  BluetoothUnauthorized: 'This phone has blocked BLE Chat from using Bluetooth.',
  BluetoothUnsupported: 'This phone does not support the kind of Bluetooth BLE Chat needs.',
  DeviceUnavailable:
    'Their phone stopped answering. Usually that means it moved out of range between being seen and being called.',
  ConnectionTimeout:
    'Their phone never answered. It is probably out of range now, or its screen went off and the radio went quiet.',
  ConnectionRefused: 'Their phone answered and turned the connection down.',
  AndroidGattError:
    'Android refused the connection without saying why. This one is almost always temporary — a stale connection it has not cleaned up yet, or too many attempts too quickly.',
  ServiceNotFound:
    'Their phone connected but is not running the chat service, so there was nothing to talk to.',
  CharacteristicNotFound:
    'Their phone is running a version of the chat service this one does not recognise.',
  MtuFailed: 'The two phones could not agree on a packet size.',
  NotificationsFailed:
    'The link opened but their phone would not let this one subscribe to replies, so nothing could come back.',
  HandshakeTimeout:
    'Their phone answered, then went quiet before the introduction finished. Usually that means it moved just out of range.',
  HandshakeFailed: 'The introduction did not complete, so neither phone knows who the other is yet.',
};

function tipsFor(reason: LinkFailureReason): Tip[] {
  switch (reason) {
    case 'PermissionDenied':
    case 'BluetoothUnauthorized':
      // Nothing about distance or the other phone matters yet.
      return [];
    case 'BluetoothOff':
      return [];
    case 'BluetoothUnsupported':
      return [];
    case 'DeviceUnavailable':
    case 'ConnectionTimeout':
    case 'HandshakeTimeout':
      return [CLOSER, OPEN_APP, TOGGLE];
    case 'AndroidGattError':
      return [WAIT, FEWER, TOGGLE];
    case 'ServiceNotFound':
    case 'CharacteristicNotFound':
      return [OPEN_APP];
    case 'ConnectionRefused':
      return [FEWER, OPEN_APP];
    default:
      return [CLOSER, TOGGLE];
  }
}

interface Props {
  visible: boolean;
  /** Who we were trying to reach. */
  name: string;
  failure: LinkFailure | null;
  /** Dial attempts made on this link so far, for the technical footer. */
  attempts?: number;
  maxAttempts?: number;
  onRetry: () => void;
  onClose: () => void;
}

export function ConnectFailedSheet({
  visible,
  name,
  failure,
  attempts,
  maxAttempts,
  onRetry,
  onClose,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!failure) {
    return null;
  }

  const cause =
    CAUSE[failure.reason] ??
    'The connection did not complete, and the platform did not say why.';
  const tips = tipsFor(failure.reason);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Close" />

        {/* The Modal renders outside the screen's own SafeAreaView, so the sheet has to
            reserve the bottom gesture inset itself or its buttons sit under the strip. */}
        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.xl}]}>
          <View style={styles.grip} />

          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Icon name="alert" size={19} color={theme.error} strokeWidth={2} />
            </View>
            <AppText style={styles.title}>Couldn&apos;t reach {name}</AppText>
          </View>

          <AppText style={styles.cause}>{cause}</AppText>

          {tips.length > 0 ? (
            <>
              <DenseText style={styles.label}>WHAT USUALLY HELPS</DenseText>
              {tips.map(tip => (
                <View key={tip.text} style={styles.tip}>
                  <Icon name={tip.icon} size={16} color={theme.accent} strokeWidth={1.9} />
                  <AppText style={styles.tipText}>{tip.text}</AppText>
                </View>
              ))}
            </>
          ) : null}

          <View style={styles.actions}>
            <Touchable scale={false} onPress={onRetry} style={styles.retry}>
              <AppText style={styles.retryText}>Try again</AppText>
            </Touchable>
            <Touchable scale={false} onPress={onClose} style={styles.dismiss}>
              <AppText style={styles.dismissText}>Not now</AppText>
            </Touchable>
          </View>

          {/* Last and quietest: the part a bug report needs and a reader can ignore. */}
          <DenseText style={styles.technical} numberOfLines={2}>
            {failure.reason} during {failure.phase}
            {attempts !== undefined && maxAttempts !== undefined
              ? ` · attempt ${attempts} of ${maxAttempts}`
              : ''}
          </DenseText>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: t.isDark ? 'rgba(4,4,6,0.66)' : 'rgba(23,23,26,0.34)'},
  sheet: {
    backgroundColor: t.isDark ? t.surface : t.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  grip: {
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: t.border,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  headIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: t.error + '1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {...typography.title, color: t.text, flex: 1},
  cause: {...typography.body, color: t.textDim, marginTop: spacing.lg},
  label: {...typography.overline, color: t.textDim, marginTop: spacing.xl, marginBottom: spacing.md},
  tip: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 9},
  tipText: {...typography.body, color: t.text, flex: 1},
  actions: {gap: 9, marginTop: spacing.xl},
  retry: {
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {...typography.body, fontWeight: '500', color: t.onAccent},
  dismiss: {
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {...typography.body, fontWeight: '500', color: t.text},
  technical: {...typography.monoTiny, color: t.textFaint, textAlign: 'center', marginTop: spacing.lg},
}));
