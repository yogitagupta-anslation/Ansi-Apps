/**
 * BlockerSheet.tsx
 * -----------------------------------------------------------------------------
 * Bottom sheet shown when a radio action is blocked by something fixable:
 * Bluetooth is off, or a runtime permission is missing.
 *
 * THE CONTRACT
 * ------------
 * "Turn on Bluetooth" triggers the NATIVE Android enable dialog
 * (ACTION_REQUEST_ENABLE through the Kotlin module) — never a toast, never a
 * bare instruction. When the native flow reports success the sheet resolves
 * itself: it briefly shows a success state, fires `onFixed`, and closes, so
 * the user does not have to come back and press the original button again.
 *
 * If the user declines the dialog the sheet stays open with the button still
 * available — declining is not an error, it is a decision, and the sheet says
 * what remains true: the radio cannot run until Bluetooth is on.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestEnableBluetooth } from '../bluetooth/BleAdvertiser';
import {
  openAppSettings,
  requestAdvertisePermissions,
  requestScanPermissions,
} from '../bluetooth/permissions';
import { useTheme } from '../theme/ThemeContext';
import { Icon, IconBadge, type IconName } from './Icon';
import { Button, Txt } from './ui';

export type BlockerKind = 'bluetooth' | 'permissions';

export function BlockerSheet({
  visible,
  kind,
  /** Which permission set applies: the Host scans, the Employee advertises. */
  role,
  onClose,
  /** Called once the blocker is genuinely fixed. The caller retries its action. */
  onFixed,
}: {
  visible: boolean;
  kind: BlockerKind;
  role: 'scan' | 'advertise';
  onClose: () => void;
  onFixed: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState(false);
  const [fixed, setFixed] = useState(false);
  /** Set when the permission request came back "Don't ask again". */
  const [needsSettings, setNeedsSettings] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset transient state whenever the sheet is (re)opened.
  useEffect(() => {
    if (visible) {
      setBusy(false);
      setFixed(false);
      setNeedsSettings(false);
    }
    return () => {
      if (closeTimer.current) {
        clearTimeout(closeTimer.current);
      }
    };
  }, [visible]);

  const succeed = useCallback(() => {
    setFixed(true);
    onFixed();
    // Hold the success state just long enough to be read, then dismiss.
    closeTimer.current = setTimeout(onClose, 900);
  }, [onFixed, onClose]);

  const handleFix = useCallback(async () => {
    setBusy(true);
    try {
      if (kind === 'bluetooth') {
        /**
         * BLUETOOTH_CONNECT must be granted BEFORE the enable dialog: Android
         * requires it just to ASK the user to turn Bluetooth on, and on a
         * fresh install it is not granted yet. Without this step the native
         * module rejects and the button silently does nothing — verified on
         * device, which is how this line got here.
         */
        const prereq =
          role === 'scan'
            ? await requestScanPermissions()
            : await requestAdvertisePermissions();
        if (!prereq.granted) {
          if (prereq.blocked.length > 0) {
            setNeedsSettings(true);
          }
          return;
        }

        // Native ACTION_REQUEST_ENABLE dialog. Resolves true only when the
        // adapter is actually on — declined or failed both come back false.
        const enabled = await requestEnableBluetooth();
        if (enabled) {
          succeed();
        }
        return;
      }

      const result =
        role === 'scan'
          ? await requestScanPermissions()
          : await requestAdvertisePermissions();
      if (result.granted) {
        succeed();
      } else if (result.blocked.length > 0) {
        // "Don't ask again": another request() would return instantly without
        // a dialog, so the only honest path left is the app settings screen.
        setNeedsSettings(true);
      }
    } finally {
      setBusy(false);
    }
  }, [kind, role, succeed]);

  const copy =
    kind === 'bluetooth'
      ? {
          icon: 'bluetooth-off' as IconName,
          title: 'Bluetooth is off',
          message:
            role === 'scan'
              ? 'Bluetooth must be turned on to scan for employees nearby.'
              : 'Bluetooth must be turned on before attendance broadcasting can start.',
          action: 'Turn on Bluetooth',
        }
      : {
          icon: 'shield-alert' as IconName,
          title: 'Permissions required',
          message:
            role === 'scan'
              ? 'Allow Bluetooth permissions so this device can detect employees.'
              : 'Allow Bluetooth permissions so this phone can broadcast your attendance ID.',
          action: 'Allow permissions',
        };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable
        style={[styles.scrim, { backgroundColor: t.colors.scrim }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      />

      <View
        style={[
          styles.sheet,
          {
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            paddingBottom: insets.bottom + t.spacing.xl,
            paddingHorizontal: t.spacing.xl,
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: t.colors.borderStrong }]} />

        {fixed ? (
          <View style={styles.body}>
            <IconBadge
              name="circle-check"
              color={t.colors.success}
              background={t.colors.successSoft}
              diameter={64}
              size={30}
            />
            <Txt variant="title" align="center" style={{ marginTop: t.spacing.lg }}>
              {kind === 'bluetooth' ? 'Bluetooth is on' : 'Permissions granted'}
            </Txt>
            <Txt
              variant="caption"
              color={t.colors.textSecondary}
              align="center"
              style={{ marginTop: 6 }}>
              Resuming automatically…
            </Txt>
          </View>
        ) : (
          <View style={styles.body}>
            <IconBadge
              name={copy.icon}
              color={t.colors.warning}
              background={t.colors.warningSoft}
              diameter={64}
              size={30}
            />
            <Txt variant="title" align="center" style={{ marginTop: t.spacing.lg }}>
              {copy.title}
            </Txt>
            <Txt
              variant="body"
              color={t.colors.textSecondary}
              align="center"
              style={{ lineHeight: 22, marginTop: 8, maxWidth: 300 }}>
              {copy.message}
            </Txt>

            {needsSettings ? (
              <View style={[styles.settingsNote, { backgroundColor: t.colors.warningSoft, borderRadius: t.radius.md, marginTop: t.spacing.lg, padding: t.spacing.md }]}>
                <Icon name="info" size={14} color={t.colors.warning} />
                <Txt variant="caption" color={t.colors.textSecondary} style={{ flex: 1, marginLeft: 8, lineHeight: 18 }}>
                  Android will no longer show the permission dialog. Allow
                  Bluetooth permissions in the app's system settings, then
                  return here.
                </Txt>
              </View>
            ) : null}

            <View style={{ alignSelf: 'stretch', marginTop: t.spacing.xl }}>
              {needsSettings ? (
                <Button
                  title="Open app settings"
                  onPress={() => openAppSettings()}
                  variant="primary"
                  icon="settings"
                  size="lg"
                />
              ) : (
                <Button
                  title={copy.action}
                  onPress={handleFix}
                  busy={busy}
                  variant="primary"
                  icon={kind === 'bluetooth' ? 'bluetooth' : 'shield-check'}
                  size="lg"
                />
              )}
              <View style={{ marginTop: t.spacing.sm }}>
                <Button title="Not now" onPress={onClose} variant="ghost" />
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: { paddingTop: 8 },
  grabber: { alignSelf: 'center', borderRadius: 2, height: 4, marginBottom: 16, width: 38 },
  body: { alignItems: 'center', paddingTop: 8 },
  settingsNote: { alignItems: 'flex-start', flexDirection: 'row' },
});
