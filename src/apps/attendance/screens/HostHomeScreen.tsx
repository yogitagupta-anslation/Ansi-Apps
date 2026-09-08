/**
 * HostHomeScreen.tsx — v3 "Orbit", the Host dashboard
 * -----------------------------------------------------------------------------
 * The host device's control centre: is it listening, who is in range, and what
 * has been recorded today.
 *
 * The orbit is the same component the employee sees, in its host role — the
 * three fixed nodes read BLUETOOTH / PERMISSIONS / IN RANGE, and tapping the
 * core toggles the scanner. Only four of its seven states are reachable here,
 * because those are the only four a scanning device can honestly be in:
 * permission (blocked), ready (idle), looking (scanning, nothing heard) and
 * found (scanning, someone in range).
 *
 * Every label, colour and button still derives from `deriveScannerUiState`, so
 * the screen reports the REAL radio and never the saved preference. The
 * recording rule printed under the button quotes this device's own configured
 * threshold and grace period rather than the mock's fixed "−65 dBm · 15 min".
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { requestScanPermissions } from '../bluetooth/permissions';
import { openLocationSettings } from '../bluetooth/BleAdvertiser';
import { deriveScannerUiState } from '../bluetooth/scannerUiState';
import { BlockerSheet, type BlockerKind } from '../components/BlockerSheet';
import { EmptyState, ErrorState } from '../components/states';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { Orbit, type OrbitState } from '../components/Orbit';
import { CheckInSuccessScreen } from './CheckInSuccessScreen';
import { Screen, Txt } from '../components/ui';
import { SERVICE_UUID_16 } from '../constants/bluetoothConfig';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/** Two digits so the count never changes width as it crosses 9. */
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function HostHomeScreen({ onSeeAll }: { onSeeAll: () => void }) {
  const navigation = useNavigation<{
    navigate: (s: string, p?: object) => void;
    getParent: () => { navigate: (s: string) => void } | undefined;
  }>();

  const t = useTheme();
  const c = t.colors;
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

  /** Registered employees the scanner can hear RIGHT NOW. Live proximity. */
  const detectedNow = store.scan.detected.filter(d => d.employee !== null);

  const live = visual.state === 'ACTIVE';

  /**
   * An empty roster does NOT block scanning.
   *
   * The old build refused to start until someone was registered, which left the
   * orbit reading "Tap to start scanning" while ignoring taps — the app looked
   * broken. The approved design has no such guard: the button toggles the
   * scanner outright, and the screen already says twice over that nobody is
   * registered (the counters footer, with its Registry link, and the in-range
   * empty state). Scanning an empty roster is honest — the radio genuinely
   * runs, it simply has no id it can recognise yet.
   *
   * Only a blocker the user cannot fix here — no BLE hardware, say — disables
   * the control, and then the blocker card below names it.
   */
  const startDisabled =
    (visual.action === 'start' || visual.action === 'resume') &&
    !!readiness?.blockers.some(b => !b.fixable);

  /* ---------------------------------------------------------- orbit state -- */

  const orbitState: OrbitState =
    visual.state === 'BLUETOOTH_OFF' || visual.state === 'PERMISSION_REQUIRED'
      ? 'permission'
      : !live
      ? 'ready'
      : detectedNow.length > 0
      ? 'found'
      : 'looking';

  /* ----------------------------------------------------------- scan rule -- */

  const graceMinutes = Math.round(store.settings.proximity.missingGracePeriodMs / 60_000);
  const hostRule = live
    ? 'Records an employee within ' +
      store.settings.proximity.minimumRssi +
      ' dBm · marks them LEFT after ' +
      graceMinutes +
      ' min of no signal'
    : 'Scanning is off. Nothing new is recorded — today’s register is unchanged.';

  /* ------------------------------------------------------------- counters -- */

  const counters = [
    { n: pad2(summary.presentCount), label: 'PRESENT', fg: c.success },
    { n: pad2(summary.leftCount), label: 'LEFT', fg: c.warning },
    { n: pad2(summary.absentCount), label: 'ABSENT', fg: c.textMuted },
  ];

  /** Recorded check-in per employee, for the right column of a detected row. */
  const recordedAt = new Map(
    store.todayRecords
      .filter(r => r.checkInTime !== null)
      .map(r => [r.employeeId, r.checkInTime as number]),
  );

  const card = { backgroundColor: c.surface, borderColor: c.border };

  return (
    <Screen>
      {/* ------------------------------------------------------- identity -- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt style={[styles.hostName, { color: c.textPrimary }]}>
            {store.settings.hostName || 'Attendance Host'}
          </Txt>
          {/* The design's "OFFICE_HQ_01 · f00d": this device's id beside the
              16-bit service UUID it advertises under. Both are real. */}
          <Txt mono style={[styles.hostId, { color: c.textMuted }]}>
            {store.settings.hostId + ' · ' + SERVICE_UUID_16}
          </Txt>
        </View>

        <View
          style={[
            styles.airPill,
            live
              ? { backgroundColor: c.successSoft, borderColor: c.successBorder }
              : { backgroundColor: c.surfaceMuted, borderColor: c.border },
          ]}>
          <View
            style={[styles.dot6, { backgroundColor: live ? c.success : c.textMuted }]}
          />
          <Txt style={[styles.airLabel, { color: live ? c.success : c.textMuted }]}>
            {live ? 'SCANNING' : 'IDLE'}
          </Txt>
        </View>
      </View>

      {/* ---------------------------------------------------------- orbit -- */}
      <View style={styles.orbitSlot}>
        <Orbit
          state={orbitState}
          role="host"
          // 300 on both roles.
          //
          // The artifact disagrees with itself here: its DIVISION note reads
          // "300px there, 252px on the Host scanner", but its markup sets
          // --k: 1 and hint-size 300px,300px on BOTH orbit slots. The markup
          // is what actually renders, and a host dial that shrank next to the
          // employee's read as a different component rather than the same one
          // in another role.
          size={300}
          rssi={detectedNow[0]?.smoothedRssi ?? null}
          onPress={() => void handleAction()}
          disabled={busy || startDisabled}
        />
      </View>

      {/* ---------------------------------------------------- scan toggle -- */}
      <Pressable
        onPress={() => void handleAction()}
        disabled={busy || startDisabled}
        style={({ pressed }) => [
          styles.scanBtn,
          live
            ? { backgroundColor: c.surface, borderColor: c.borderStrong }
            : { borderColor: 'transparent' },
          live ? t.neu : null,
          busy || startDisabled ? { opacity: 0.55 } : null,
          pressed ? { transform: [{ scale: 0.975 }] } : null,
        ]}>
        {live ? null : (
          <LinearGradient
            colors={['#4F46E5', '#7C3AED']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <Icon
          name={live ? 'square' : 'play'}
          size={17}
          color={live ? c.textPrimary : '#FFFFFF'}
        />
        <Txt style={[styles.scanBtnLabel, { color: live ? c.textPrimary : '#FFFFFF' }]}>
          {visual.actionLabel}
        </Txt>
      </Pressable>

      <Txt style={[styles.hostRule, { color: c.textMuted }]}>{hostRule}</Txt>

      {/* -------------------------------------------------------- counters -- */}
      <View style={[styles.countersCard, card, t.neu]}>
        <View style={styles.counterGrid}>
          {counters.map((counter, i) => (
            <Pressable
              key={counter.label}
              onPress={onSeeAll}
              style={({ pressed }) => [
                styles.counterCell,
                i < 2 ? { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border } : null,
                pressed ? { backgroundColor: c.surfaceMuted } : null,
              ]}>
              <View style={styles.counterTop}>
                <View style={[styles.dot7, { backgroundColor: counter.fg }]} />
                <Txt style={[styles.counterN, numeric, { color: counter.fg }]}>{counter.n}</Txt>
              </View>
              <Txt style={[styles.counterLabel, { color: c.textMuted }]}>{counter.label}</Txt>
            </Pressable>
          ))}
        </View>

        <View
          style={[
            styles.countersFooter,
            { backgroundColor: c.surfaceMuted, borderTopColor: c.border },
          ]}>
          <Icon name="users" size={14} color={c.textMuted} />
          <Txt style={[styles.headcount, { color: c.textMuted }]}>
            {hasEmployees
              ? store.employees.length +
                (store.employees.length === 1 ? ' employee' : ' employees') +
                ' registered on this device'
              : 'Nobody registered on this device'}
          </Txt>
          <Pressable
            hitSlop={8}
            onPress={() => navigation.getParent()?.navigate('Employees')}>
            <Txt style={[styles.registryLink, { color: c.primaryTint }]}>Registry</Txt>
          </Pressable>
        </View>
      </View>

      {/* ---------------------------------------------------- in range now -- */}
      <View style={styles.sectionHead}>
        <View style={{ flex: 1 }}>
          <Txt style={[styles.sectionTitle, { color: c.textPrimary }]}>In range now</Txt>
          <Txt style={[styles.sectionSub, { color: c.textMuted }]}>
            Signal strength, not distance
          </Txt>
        </View>
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="button">
          <Txt style={[styles.seeAll, { color: c.primaryTint }]}>See all</Txt>
        </Pressable>
      </View>

      {detectedNow.length === 0 ? (
        <View style={styles.nearbyEmpty}>
          <Image
            source={require('../assets/no-employees-nearby.png')}
            style={styles.nearbyArt}
            resizeMode="contain"
          />
          <Txt style={[styles.nearbyTitle, { color: c.textPrimary }]}>Nobody in range</Txt>
          <Txt style={[styles.nearbyBody, { color: c.textMuted }]}>
            {live
              ? 'Scanning is on and the radio is healthy — no employee phone is broadcasting nearby yet.'
              : 'Scanning is off, so nothing can be detected or recorded on this device.'}
          </Txt>
        </View>
      ) : (
        <View style={styles.detectedList}>
          {detectedNow.map(d => {
            const strong = d.isNearby;
            const barOn = strong ? c.success : c.warning;
            const recorded = recordedAt.get(d.employeeId);
            return (
              <Pressable
                key={d.employeeId}
                onPress={() =>
                  navigation.navigate('EmployeeDetail', { employeeId: d.employeeId })
                }
                style={({ pressed }) => [
                  styles.detectedRow,
                  card,
                  t.shadow(1),
                  pressed ? { transform: [{ scale: 0.98 }] } : null,
                ]}>
                <EmployeeAvatar
                  name={d.employee?.displayName ?? d.employeeId}
                  employeeId={d.employeeId}
                  size={40}
                  photo={d.employee?.photo}
                />

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt numberOfLines={1} style={[styles.rowName, { color: c.textPrimary }]}>
                    {d.employee?.displayName ?? d.employeeId}
                  </Txt>
                  <View style={styles.signalRow}>
                    <View style={styles.bars}>
                      <View style={[styles.bar, styles.bar1, { backgroundColor: barOn }]} />
                      <View style={[styles.bar, styles.bar2, { backgroundColor: barOn }]} />
                      <View
                        style={[
                          styles.bar,
                          styles.bar3,
                          { backgroundColor: strong ? c.success : c.surfaceMuted },
                        ]}
                      />
                    </View>
                    <Txt mono style={[styles.rssi, { color: c.textMuted }]}>
                      {d.smoothedRssi + ' dBm'}
                    </Txt>
                    <Txt style={[styles.prox, { color: strong ? c.success : c.warning }]}>
                      {strong ? 'NEARBY' : 'FAR'}
                    </Txt>
                  </View>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  <Txt style={[styles.rowTime, numeric, { color: c.textPrimary }]}>
                    {recorded === undefined ? '--:--' : formatClockTime(recorded)}
                  </Txt>
                  <Txt style={[styles.rowTimeCap, { color: c.textMuted }]}>
                    {recorded === undefined ? 'not recorded' : 'recorded'}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

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

      {/* BLUETOOTH_OFF is owned by the scan button + sheet above, so repeating
          it here would say the same thing twice. Everything else (location
          services, unsupported hardware) still surfaces. */}
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
            variant="host"
            employeeName={celebrate.employeeName}
            employeeId={celebrate.employeeId}
            checkInTime={celebrate.checkInTime}
            hostId={store.settings.hostId}
            photo={store.employees.find(e => e.employeeId === celebrate.employeeId)?.photo}
            onDismiss={() => setCelebrate(null)}
          />
        ) : null}
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  hostName: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 21,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  hostId: { fontSize: 11.5, marginTop: 3 },
  airPill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    height: 30,
    paddingHorizontal: 11,
  },
  airLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5, letterSpacing: 0.3 },
  dot6: { borderRadius: 999, height: 6, width: 6 },
  dot7: { borderRadius: 999, height: 7, width: 7 },

  orbitSlot: { alignItems: 'center', marginTop: 4 },

  scanBtn: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    height: 50,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scanBtnLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  hostRule: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 11,
    lineHeight: 16.5,
    marginTop: 12,
    textAlign: 'center',
  },

  countersCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 20,
    overflow: 'hidden',
  },
  counterGrid: { flexDirection: 'row' },
  counterCell: {
    alignItems: 'center',
    flex: 1,
    paddingBottom: 16,
    paddingHorizontal: 10,
    paddingTop: 18,
  },
  counterTop: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  counterN: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 28,
    letterSpacing: -1.2,
    lineHeight: 35,
  },
  counterLabel: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 9.5,
    letterSpacing: 0.9,
    marginTop: 8,
  },
  countersFooter: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headcount: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5 },
  registryLink: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5 },

  sectionHead: { alignItems: 'center', flexDirection: 'row', marginTop: 26 },
  sectionTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 },
  sectionSub: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, marginTop: 1 },
  seeAll: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13 },

  nearbyEmpty: { alignItems: 'center', paddingBottom: 8, paddingHorizontal: 16, paddingTop: 18 },
  nearbyArt: { height: 146, width: 146 },
  nearbyTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 16,
    letterSpacing: -0.3,
    lineHeight: 22,
    marginTop: 16,
  },
  nearbyBody: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12.5,
    lineHeight: 19.5,
    marginTop: 7,
    maxWidth: 258,
    textAlign: 'center',
  },

  detectedList: { gap: 9, marginTop: 14 },
  detectedRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowName: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14.5 },
  signalRow: { alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 5 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 2.5, height: 12 },
  bar: { borderRadius: 1, width: 3 },
  bar1: { height: 5 },
  bar2: { height: 8 },
  bar3: { height: 11 },
  rssi: { fontSize: 11 },
  prox: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11, letterSpacing: 0.3 },
  rowTime: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13 },
  rowTimeCap: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10.5, marginTop: 2 },
});
