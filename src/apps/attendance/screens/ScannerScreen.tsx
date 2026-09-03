/**
 * ScannerScreen.tsx
 * -----------------------------------------------------------------------------
 * The Host's scanner: start/stop, live detection count, and scanner health.
 *
 * WHAT THE RINGS DO AND DO NOT MEAN
 * ----------------------------------
 * The pulsing rings indicate that a scan is RUNNING. They are not a radar.
 * BLE gives no bearing at all, and RSSI is not a distance — it moves with
 * orientation, bodies, pockets and walls. So nothing is ever plotted at an
 * angle or a radius, because any such position would be invented.
 *
 * The rings only animate while `scan.scanning` is true, which comes from the
 * BLE layer, never from the stored preference. A stopped scanner must never
 * look busy.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/AppHeader';
import { RadarPulse } from '../components/RadarPulse';
import { SettingGroup, SettingRow } from '../components/SettingRow';
import { StatusBadge } from '../components/StatusBadge';
import { Banner, Button, Card, Screen, SectionHeader, Txt } from '../components/ui';
import { EmptyState } from '../components/states';
import { requestScanPermissions } from '../bluetooth/permissions';
import { openLocationSettings, requestEnableBluetooth } from '../bluetooth/BleAdvertiser';
import { formatClockTime } from '../constants/appConfig';
import type { ResumeBlockedReason } from '../state/appStore';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function ScannerScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{ navigate: (s: string, p?: object) => void; goBack: () => void }>();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = store.scan;
  const readiness = store.readiness;

  /** REAL radio state. Never the stored preference. */
  const scanning = scan.scanning;

  const detected = scan.detected ?? [];
  const registered = detected.filter(d => d.employee !== null);
  const unknown = detected.length - registered.length;

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      /**
       * Ask for the scan permissions BEFORE touching the radio. Calling
       * startScanning() cold fails with BLE error 101 ("Location Permission
       * missing") without ever showing Android's permission dialog — the
       * request is what surfaces the dialog.
       */
      const permission = await requestScanPermissions();
      if (!permission.granted) {
        setError(permission.message);
        await store.refreshReadiness();
        return;
      }
      await store.startScanning();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await store.stopScanning();
    } finally {
      setBusy(false);
    }
  }, [store]);

  return (
    <Screen>
      <PageHeader
        title="Scanner"
        subtitle="This device detects employees"
        onBack={() => navigation.goBack()}
        right={
          <StatusBadge
            label={scanning ? 'Active' : 'Stopped'}
            tone={scanning ? 'success' : 'neutral'}
            size="sm"
          />
        }
      />

      {/* ----------------------------------------------------------- radar -- */}
      <Card>
        <View style={{ paddingVertical: t.spacing.lg }}>
          <RadarPulse
            active={scanning}
            color={scanning ? t.colors.success : t.colors.textMuted}
          />

          <Txt variant="heading" align="center" style={{ marginTop: t.spacing.xl }}>
            {scanning ? 'Scanning for employees…' : 'Scanner is stopped'}
          </Txt>
          <Txt
            variant="caption"
            color={t.colors.textSecondary}
            align="center"
            style={{ marginTop: 4 }}>
            {scanning
              ? detected.length + ' device' + (detected.length === 1 ? '' : 's') + ' detected'
              : 'No advertisements are being received'}
          </Txt>
        </View>
      </Card>

      {error ? <Banner tone="danger" title="Could not start scanning" detail={error} /> : null}

      {store.scanResumePending && !scanning ? (
        <Banner
          tone="warning"
          title="Scanner is not running"
          detail={describeBlockedReason(store.resumeBlockedReason)}
          actionLabel={
            store.resumeBlockedReason === 'BLUETOOTH_OFF' ? 'Turn on Bluetooth' : 'Try again'
          }
          onAction={
            store.resumeBlockedReason === 'BLUETOOTH_OFF'
              ? () => void requestEnableBluetooth().then(store.refreshReadiness)
              : handleStart
          }
        />
      ) : null}

      {/* Readiness blockers carry their own fix action where one exists. */}
      {readiness?.blockers.map(blocker => (
        <Banner
          key={blocker.code}
          tone="danger"
          title={blocker.title}
          detail={blocker.detail}
          actionLabel={
            blocker.code === 'BLUETOOTH_OFF'
              ? 'Turn on Bluetooth'
              : blocker.code === 'LOCATION_SERVICES_OFF'
              ? 'Open location settings'
              : undefined
          }
          onAction={
            blocker.code === 'BLUETOOTH_OFF'
              ? () => void requestEnableBluetooth().then(store.refreshReadiness)
              : blocker.code === 'LOCATION_SERVICES_OFF'
              ? () => void openLocationSettings().then(store.refreshReadiness)
              : undefined
          }
        />
      ))}

      {scanning ? (
        <Button
          title="STOP SCANNING"
          onPress={handleStop}
          variant="danger"
          icon="square"
          busy={busy}
          size="lg"
        />
      ) : (
        <Button
          title="START SCANNING"
          onPress={handleStart}
          variant="success"
          icon="play"
          busy={busy}
          disabled={!readiness?.bluetooth.ready}
          size="lg"
        />
      )}

      {/* --------------------------------------------------- scanner state -- */}
      <SectionHeader title="Scanner status" style={{ marginTop: t.spacing.xl }} />
      <SettingGroup
        footer={
          unknown > 0
            ? unknown +
              ' unregistered device' +
              (unknown === 1 ? '' : 's') +
              ' seen. These are counted but never given attendance — only IDs in the registry can be recorded.'
            : undefined
        }>
        <SettingRow
          icon="radio"
          iconTone={scanning ? 'success' : 'neutral'}
          title="Radio"
          value={scanning ? 'Scanning' : 'Idle'}
          valueTone={scanning ? 'success' : 'neutral'}
        />
        <SettingRow
          icon="activity"
          iconTone="neutral"
          title="Advertisements received"
          value={String(scan.statistics.advertisementsReceived)}
        />
        <SettingRow
          icon="clock"
          iconTone="neutral"
          title="Scanning since"
          value={scan.startedAt ? formatClockTime(scan.startedAt) : '—'}
        />
        <SettingRow
          icon="users"
          iconTone="neutral"
          title="Registered employees in range"
          value={String(registered.length)}
        />
      </SettingGroup>

      {/* ------------------------------------------------------- in range -- */}
      <SectionHeader
        title="Currently in range"
        subtitle="Live proximity, not attendance"
        style={{ marginTop: t.spacing.lg }}
      />

      {registered.length === 0 ? (
        <Card>
          <EmptyState
            /* Illustrated only while genuinely scanning. A stopped scanner has
               not looked for anyone, so "we didn't find anybody" art would
               overstate what the device actually did. */
            art={scanning ? 'noEmployeesNearby' : undefined}
            icon="radio"
            title={scanning ? 'No employees nearby' : 'Scanner is stopped'}
            message={
              scanning
                ? "We didn't detect any registered employees in range. Make sure employees are nearby and their attendance broadcasting is turned on."
                : 'Start the scanner to detect employees nearby.'
            }
          />
        </Card>
      ) : (
        <Card padded={false}>
          {registered.map((d, i) => (
            <Pressable
              key={d.employeeId}
              onPress={() =>
                navigation.navigate('EmployeeDetail', { employeeId: d.employeeId })
              }
              accessibilityRole="button"
              accessibilityLabel={'Open ' + (d.employee?.displayName ?? d.employeeId)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderTopColor: t.colors.border,
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.7 : 1,
                  padding: t.spacing.lg,
                },
              ]}>
              <EmployeeAvatar
                name={d.employee?.displayName ?? d.employeeId}
                employeeId={d.employeeId}
                size={40}
                photo={d.employee?.photo}
                badge={t.colors.success}
              />
              <View style={{ flex: 1, marginLeft: t.spacing.md }}>
                <Txt variant="bodyMedium" numberOfLines={1}>
                  {d.employee?.displayName ?? d.employeeId}
                </Txt>
                <Txt variant="caption" color={t.colors.textMuted} mono>
                  {d.employeeId}
                </Txt>
              </View>
              <Icon name="chevron-right" size={18} color={t.colors.textMuted} />
            </Pressable>
          ))}
        </Card>
      )}

      <View style={{ marginTop: t.spacing.sm }}>
        <Txt variant="caption" color={t.colors.textMuted} style={{ lineHeight: 18 }}>
          Signal strength is used to judge nearness, but it is not a distance —
          it changes with orientation, obstacles and whether the phone is in a
          pocket. Technical readings are on the Debug screen.
        </Txt>
      </View>
    </Screen>
  );
}

/**
 * Reason codes -> sentences a person can act on. The raw enum ("PERMISSIONS_
 * MISSING") leaked into the banner before this, and its Try-again button
 * retried an operation that could never succeed without the permission dialog.
 */
function describeBlockedReason(reason: ResumeBlockedReason | null): string {
  switch (reason) {
    case 'BLUETOOTH_OFF':
      return 'Bluetooth is switched off, so nothing can be detected.';
    case 'PERMISSIONS_MISSING':
      return 'Bluetooth permissions have not been granted. Tap Try again to be asked for them.';
    case 'NOT_SUPPORTED':
      return 'This device does not support the Bluetooth features scanning needs.';
    case 'FAILED':
      return 'The last attempt to start the scanner failed. Tap Try again to retry.';
    default:
      return 'Scanning is switched on in settings but the radio is not scanning. No attendance can be recorded until it is.';
  }
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
});
