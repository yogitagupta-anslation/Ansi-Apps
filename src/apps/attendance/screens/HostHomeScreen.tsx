/**
 * HostHomeScreen.tsx
 * -----------------------------------------------------------------------------
 * Host dashboard — the attendance control centre.
 *
 * BLE vocabulary is deliberately absent: "Attendance scanner", "employees
 * nearby", not "BLE central scanning service UUID". Raw diagnostics live on the
 * Debug screen.
 *
 * The status headline always reflects the REAL radio, never the saved
 * preference. See appStore for the desired-vs-actual split.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Modal, StyleSheet, View } from 'react-native';
import { requestScanPermissions } from '../bluetooth/permissions';
import { openLocationSettings } from '../bluetooth/BleAdvertiser';
import { deriveScannerUiState } from '../bluetooth/scannerUiState';
import { BlockerSheet, type BlockerKind } from '../components/BlockerSheet';
import { DetectedEmptyState } from '../components/states';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { AppHeader } from '../components/AppHeader';
import { EmployeeListItem } from '../components/EmployeeListItem';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';

import { StatTile, StatTileRow } from '../components/StatTile';
import { CheckInSuccessScreen } from './CheckInSuccessScreen';
import { EmptyState, ErrorState, SummarySkeleton } from '../components/states';
import { Button, Card, SectionHeader, Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function HostHomeScreen({ onSeeAll }: { onSeeAll: () => void }) {
  const navigation = useNavigation<{ navigate: (s: string, p?: object) => void }>();

  const t = useTheme();
  const store = useAppStore();
  const [busy, setBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const scanning = store.scan.scanning;
  const readiness = store.readiness;
  const summary = store.todaySummary;

  /**
   * Celebrate a check-in only when one is genuinely NEW.
   *
   * `seenCheckIns` is seeded on the first render from whatever is already
   * recorded, so opening the app to a day of existing records does not fire a
   * burst of confetti for check-ins that happened hours ago. Only ids that
   * appear after that first pass are treated as new.
   */
  const seenCheckIns = useRef<Set<string> | null>(null);
  const [celebrate, setCelebrate] = useState<{
    employeeName: string;
    employeeId: string;
    checkInTime: number;
  } | null>(null);

  useEffect(() => {
    const checkedIn = store.todayRecords.filter(r => r.checkInTime !== null);

    if (seenCheckIns.current === null) {
      seenCheckIns.current = new Set(checkedIn.map(r => r.employeeId));
      return;
    }

    const fresh = checkedIn.find(r => !seenCheckIns.current?.has(r.employeeId));
    if (fresh && fresh.checkInTime !== null) {
      seenCheckIns.current.add(fresh.employeeId);
      setCelebrate({
        employeeName: fresh.employeeName,
        employeeId: fresh.employeeId,
        // Read from the written record, never stamped at render time.
        checkInTime: fresh.checkInTime,
      });
    }
  }, [store.todayRecords]);
  const hasEmployees = store.employees.length > 0;

  /** Which blocker sheet is open, if any. */
  const [sheet, setSheet] = useState<BlockerKind | null>(null);

  /**
   * Start the scanner for real: permission dialog first, then the radio.
   * Every failure path routes to the matching BlockerSheet rather than
   * failing silently — the exact bug this flow replaces was a Resume button
   * that did nothing while Bluetooth was off.
   */
  const startForReal = useCallback(async () => {
    setBusy(true);
    setPermissionError(null);
    try {
      // Bluetooth outranks permissions: nothing else is fixable while the
      // adapter is down, and the permission dialog on top of a dead radio
      // would just be a confusing detour.
      await store.refreshReadiness();
      const permission = await requestScanPermissions();
      if (!permission.granted) {
        if (permission.blocked.length > 0) {
          setSheet('permissions');
        } else {
          setPermissionError(permission.message);
        }
        return;
      }
      const result = await store.startScanning();
      if (!result) {
        // startScanning returned false with permissions fine — almost always
        // the adapter. Re-check and open the sheet that names it.
        await store.refreshReadiness();
        setSheet('bluetooth');
      }
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  const handleAction = useCallback(async () => {
    switch (visualRef.current.action) {
      case 'stop':
        setBusy(true);
        try {
          await store.stopScanning();
        } finally {
          setBusy(false);
        }
        return;
      case 'enable-bluetooth':
        setSheet('bluetooth');
        return;
      case 'grant-permissions':
        setSheet('permissions');
        return;
      default:
        // start / resume / retry all mean the same thing to the radio.
        await startForReal();
    }
  }, [store, startForReal]);

  /**
   * The sheet reports the blocker fixed (Bluetooth on / permission granted).
   * Retry immediately — the user should never have to press Resume again.
   * The store's adapter listener also reconciles, but startScanning is
   * duplicate-start safe, so the race is harmless.
   */
  const handleBlockerFixed = useCallback(() => {
    void startForReal();
  }, [startForReal]);

  // Only employees who have actually been detected today appear here, newest
  // check-in first. Never a placeholder or a registered-but-absent person.
  const recent = store.attendanceRows
    .filter(r => r.record?.checkInTime)
    .sort((a, b) => (b.record?.checkInTime ?? 0) - (a.record?.checkInTime ?? 0))
    .slice(0, 5);

  /** The one scanner-state derivation, shared with the Scanner screen. */
  const visual = deriveScannerUiState({
    scanning,
    scanningEnabled: store.settings.scanningEnabled,
    readiness,
    resumeBlockedReason: store.resumeBlockedReason,
    scanError: store.scan.error,
  });
  // The dispatcher reads through a ref so its useCallback identity is stable.
  const visualRef = useRef(visual);
  visualRef.current = visual;

  const toneColor =
    visual.tone === 'success'
      ? t.colors.success
      : visual.tone === 'warning'
      ? t.colors.warning
      : visual.tone === 'danger'
      ? t.colors.error
      : t.colors.textSecondary;
  const toneSoft =
    visual.tone === 'success'
      ? t.colors.successSoft
      : visual.tone === 'warning'
      ? t.colors.warningSoft
      : visual.tone === 'danger'
      ? t.colors.errorSoft
      : t.colors.surfaceMuted;

  /** Registered employees the scanner can hear RIGHT NOW. Live proximity. */
  const detectedNow = store.scan.detected.filter(d => d.employee !== null);

  return (
    <Screen>
      <AppHeader
        name={store.settings.hostName || 'Attendance Host'}
        subtitle={store.settings.hostId}
        avatarSeed={store.settings.hostId}
        showAvatar={false}
        right={
          <StatusBadge
            label={
              visual.state === 'ACTIVE'
                ? 'Active'
                : visual.state === 'IDLE'
                ? 'Idle'
                : 'Needs attention'
            }
            tone={visual.tone === 'neutral' ? 'neutral' : visual.tone}
            size="sm"
          />
        }
      />

      {/* ================================ summary ================================ */}
      {!store.ready ? (
        <SummarySkeleton />
      ) : (
        <StatTileRow>
          <StatTile count={summary.presentCount} label="Present" tone="success" onPress={onSeeAll} />
          <StatTile count={summary.leftCount} label="Left" tone="warning" onPress={onSeeAll} />
          <StatTile count={summary.absentCount} label="Absent" tone="danger" onPress={onSeeAll} />
        </StatTileRow>
      )}

      {/* Full scanner view: radar, live detections, scanner health. */}
      <Card onPress={() => navigation.navigate('Scanner')}>
        <View style={styles.scannerLink}>
          <View
            style={[
              styles.scannerLinkIcon,
              { backgroundColor: scanning ? t.colors.successSoft : t.colors.surfaceMuted },
            ]}>
            <Icon
              name="radar"
              size={20}
              color={scanning ? t.colors.success : t.colors.textMuted}
            />
          </View>
          <View style={{ flex: 1, marginLeft: t.spacing.md }}>
            <Txt variant="heading">Open scanner</Txt>
            <Txt variant="caption" color={t.colors.textSecondary} style={{ marginTop: 2 }}>
              {scanning
                ? store.scan.detected.length + ' device(s) currently detected'
                : 'Scanner is stopped'}
            </Txt>
          </View>
          <Icon name="chevron-right" size={18} color={t.colors.textMuted} />
        </View>
      </Card>

      {/* ============================== scanner card ============================== */}
      <Card accent={visual.state === 'IDLE' ? undefined : toneColor}>
        <View style={styles.scannerHeader}>
          <View
            style={[
              styles.scannerIcon,
              { backgroundColor: toneSoft, borderRadius: t.radius.md },
            ]}>
            <Icon name={visual.icon} size={22} color={toneColor} />
          </View>

          <View style={{ flex: 1, marginLeft: t.spacing.md }}>
            <Txt variant="overline" color={t.colors.textMuted}>
              ATTENDANCE SCANNER
            </Txt>
            <Txt
              variant="heading"
              color={visual.state === 'IDLE' ? t.colors.textPrimary : toneColor}
              style={{ marginTop: 2 }}>
              {visual.title}
            </Txt>
          </View>
        </View>

        <Txt variant="caption" color={t.colors.textSecondary} style={{ lineHeight: 19, marginTop: t.spacing.md }}>
          {visual.detail}
        </Txt>

        {scanning ? (
          <View style={[styles.statsRow, { borderTopColor: t.colors.border, marginTop: t.spacing.lg, paddingTop: t.spacing.md }]}>
            <View style={{ flex: 1 }}>
              <Txt variant="overline" color={t.colors.textMuted}>
                NEARBY NOW
              </Txt>
              <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
                {store.scan.detected.length}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="overline" color={t.colors.textMuted}>
                SIGNALS SEEN
              </Txt>
              <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
                {store.scan.statistics.advertisementsReceived}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="overline" color={t.colors.textMuted}>
                STARTED
              </Txt>
              <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
                {store.scan.startedAt ? formatClockTime(store.scan.startedAt) : '—'}
              </Txt>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: t.spacing.lg }}>
          <Button
            title={visual.actionLabel.toUpperCase()}
            onPress={() => void handleAction()}
            variant={
              visual.action === 'stop'
                ? 'neutral'
                : visual.action === 'start' || visual.action === 'resume'
                ? 'success'
                : 'primary'
            }
            icon={
              visual.action === 'stop'
                ? 'square'
                : visual.action === 'enable-bluetooth'
                ? 'bluetooth'
                : visual.action === 'grant-permissions'
                ? 'shield-check'
                : 'play'
            }
            busy={busy}
            disabled={
              (visual.action === 'start' || visual.action === 'resume') &&
              (!hasEmployees || !!readiness?.blockers.some(b => !b.fixable))
            }
          />
        </View>
      </Card>

      {/* ============================= detected now ============================= */}
      {scanning ? (
        <>
          <SectionHeader
            title="Detected now"
            subtitle="Live proximity — being in range is not a check-in"
          />
          {detectedNow.length === 0 ? (
            <Card>
              <DetectedEmptyState onCheckAgain={() => void store.reconcileRadioState()} />
            </Card>
          ) : (
            <Card padded={false}>
              {detectedNow.map((d, i) => (
                <View
                  key={d.employeeId}
                  style={[
                    styles.detectedRow,
                    {
                      borderTopColor: t.colors.border,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
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
                  <StatusBadge label="In range" tone="success" size="sm" />
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}

      {/* =============================== problems =============================== */}
      {permissionError ? (
        <ErrorState
          icon="shield"
          title="Permission needed"
          message={permissionError}
          actionLabel="Try again"
          onAction={() => void startForReal()}
        />
      ) : null}

      {/* BLUETOOTH_OFF is owned by the scanner state card + sheet above, so
          repeating it here would say the same thing twice. Everything else
          (location services, unsupported hardware) still surfaces. */}
      {readiness?.blockers
        .filter(blocker => blocker.code !== 'BLUETOOTH_OFF')
        .map(blocker => (
          <ErrorState
            key={blocker.code}
            icon="triangle-alert"
            title={blocker.title}
            message={blocker.detail}
            actionLabel={
              blocker.code === 'LOCATION_SERVICES_OFF' ? 'Open location settings' : undefined
            }
            onAction={
              blocker.code === 'LOCATION_SERVICES_OFF'
                ? () => void openLocationSettings().then(store.refreshReadiness)
                : undefined
            }
          />
        ))}

      {/* No "scanning but nothing detected" banner here: the Detected-now
          empty state below already carries exactly that message, and saying
          it twice made the dashboard read like something was wrong. */}

      {!hasEmployees ? (
        <Card>
          <EmptyState
            /* The app's first-run state: nothing works until someone is
               registered, so this one earns the full illustration. */
            art="noEmployeesRegistered"
            icon="users"
            title="No employees registered"
            message="You haven't added any employees yet. Add your first employee to start attendance tracking."
            actionLabel="Add employee"
            /**
             * Straight to the form, nested inside the Employees tab. This was
             * wired to onSeeAll (the Attendance tab) — a button that says "Add
             * employee" and opens a different list is a broken promise.
             */
            onAction={() =>
              navigation.navigate('Employees', { screen: 'AddEmployee' })
            }
          />
        </Card>
      ) : null}

      {/* ============================ recent check-ins ============================ */}
      {hasEmployees ? (
        <>
          <SectionHeader
            title="Recent check-ins"
            subtitle={summary.attendedCount + ' of ' + summary.totalEmployees + ' attended today'}
            action="See all"
            onAction={onSeeAll}
          />

          {recent.length === 0 ? (
            <Card>
              <EmptyState
                icon={scanning ? 'search' : visual.state === 'BLUETOOTH_OFF' ? 'bluetooth-off' : 'clock'}
                title={
                  scanning
                    ? 'No check-ins yet'
                    : visual.state === 'BLUETOOTH_OFF'
                    ? 'Scanning is paused'
                    : 'Scanner is off'
                }
                message={
                  scanning
                    ? 'Employees will appear here as soon as they are detected nearby.'
                    : visual.state === 'BLUETOOTH_OFF'
                    ? // Same cause the state card names — never "start the scanner"
                      // when the scanner is not the thing that is wrong.
                      'Check-ins resume once Bluetooth is back on.'
                    : 'Start the scanner to begin detecting employees.'
                }
                compact
              />
            </Card>
          ) : (
            recent.map(row => (
              <EmployeeListItem
                key={row.employeeId}
                row={row}
                photo={store.employees.find(e => e.employeeId === row.employeeId)?.photo}
                onPress={() =>
                  navigation.navigate('EmployeeDetail', { employeeId: row.employeeId })
                }
              />
            ))
          )}
        </>
      ) : null}
      <BlockerSheet
        visible={sheet !== null}
        kind={sheet ?? 'bluetooth'}
        role="scan"
        onClose={() => setSheet(null)}
        onFixed={handleBlockerFixed}
      />

      <Modal
        visible={celebrate !== null}
        animationType="fade"
        onRequestClose={() => setCelebrate(null)}
        statusBarTranslucent>
        {celebrate ? (
          <CheckInSuccessScreen
            employeeName={celebrate.employeeName}
            employeeId={celebrate.employeeId}
            checkInTime={celebrate.checkInTime}
            photo={store.employees.find(e => e.employeeId === celebrate.employeeId)?.photo}
            onDismiss={() => setCelebrate(null)}
          />
        ) : null}
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scannerLink: { alignItems: 'center', flexDirection: 'row' },
  scannerLinkIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  scannerHeader: { alignItems: 'center', flexDirection: 'row' },
  scannerIcon: { alignItems: 'center', height: 46, justifyContent: 'center', width: 46 },
  statsRow: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  detectedRow: { alignItems: 'center', flexDirection: 'row' },
});
