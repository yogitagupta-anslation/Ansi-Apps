/**
 * EmployeeHomeScreen.tsx  — v3 "Orbit"
 * -----------------------------------------------------------------------------
 * Greeting, live clock, the Orbit, three capability wells, and today's figures.
 *
 * WHERE EVERY NUMBER COMES FROM — the honesty contract of this screen.
 *
 *   The ORBIT controls this phone's radio. Tapping it starts broadcasting the
 *   employee ID; tapping again stops. That is all it can truthfully do.
 *
 *   The TIMES come ONLY from the status report the Host delivers back over the
 *   BLE reply channel after it actually records the check-in. Until one arrives
 *   they show dashes. Tapping the orbit never fills them in.
 *
 * WHICH ORBIT STATES THIS SCREEN CAN HONESTLY REACH. The component knows seven;
 * an employee phone can only observe four of them. It broadcasts one-way and is
 * never told whether a Host heard it, so "device found" and "connected" are not
 * facts this side of the exchange holds. Claiming them would be theatre, so the
 * employee orbit moves between ready → scanning → checked-in, plus permission
 * when the radio is blocked. The Host, which really does discover and connect,
 * uses the full set.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { requestAdvertisePermissions } from '../bluetooth/permissions';
import { BlockerSheet, type BlockerKind } from '../components/BlockerSheet';
import { CheckInSuccessScreen } from './CheckInSuccessScreen';
import { Orbit, type OrbitState } from '../components/Orbit';
import { Banner, Button, Card, Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function greetingFor(d: Date): string {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "Sep 7, Mon" — the approved short date. */
function shortDate(d: Date): string {
  return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + WEEKDAYS[d.getDay()];
}

function formatHours(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

export function EmployeeHomeScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{
    navigate: (screen: string) => void;
    getParent: () => { navigate: (screen: string) => void } | undefined;
  }>();

  const [busy, setBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<BlockerKind | null>(null);

  const adv = store.advertiser;
  const readiness = store.readiness;
  const report = store.employeeStatusReport;
  const { employeeId, employeeName, employeeDepartment } = store.settings;

  const configured = employeeId.trim().length > 0;
  const onAir = adv.state === 'ACTIVE';
  const btReady = !!readiness?.bluetooth.ready;
  const permsReady = !!readiness?.permissionsGranted;

  /**
   * Celebrate a check-in the moment the HOST'S REPORT ARRIVES — not when the
   * orbit is tapped. Being recorded is a separate fact that arrives later over
   * the reply channel, and this screen must only cheer for the second one.
   *
   * `seenReportKey` is seeded on the first render so reopening the app to an
   * already-delivered report does not replay the confetti.
   */
  const seenReportKey = useRef<string | null | undefined>(undefined);
  const [celebrate, setCelebrate] = useState<typeof report>(null);

  useEffect(() => {
    const key = report ? report.date + '|' + report.checkInTime : null;
    if (seenReportKey.current === undefined) {
      seenReportKey.current = key;
      return;
    }
    if (key && key !== seenReportKey.current) {
      seenReportKey.current = key;
      if (report && report.status === 'PRESENT') {
        setCelebrate(report);
      }
    }
  }, [report]);

  /** Live wall clock. UI-only; one tick per second is cheap and honest. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* ------------------------------------------------------------- actions -- */

  const handleStart = useCallback(async () => {
    setBusy(true);
    setPermissionError(null);
    try {
      await store.refreshReadiness();
      if (store.readiness && !store.readiness.bluetooth.ready) {
        setSheet('bluetooth');
        return;
      }
      const permission = await requestAdvertisePermissions();
      if (!permission.granted) {
        if (permission.blocked.length > 0) {
          setSheet('permissions');
        } else {
          setPermissionError(permission.message);
        }
        return;
      }
      const result = await store.startAdvertising();
      if (!result.success) {
        if (store.advertiser.state === 'BLUETOOTH_DISABLED') {
          setSheet('bluetooth');
        } else if (result.error) {
          setPermissionError(result.error);
        }
      }
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await store.stopAdvertising();
    } finally {
      setBusy(false);
      void store.refreshReadiness();
    }
  }, [store]);

  const handleTap = useCallback(() => {
    if (!configured) {
      navigation.getParent()?.navigate('Profile');
      return;
    }
    if (onAir) {
      void handleStop();
    } else {
      void handleStart();
    }
  }, [configured, onAir, handleStart, handleStop, navigation]);

  /* --------------------------------------------------------- orbit state -- */

  const orbitState: OrbitState = report
    ? 'present'
    : !btReady || !permsReady
    ? 'permission'
    : onAir
    ? 'scanning'
    : 'ready';

  /* ---------------------------------------------------- delivered values -- */

  const checkInLabel = report ? formatClockTime(report.checkInTime) : '--:--';
  const checkOutLabel = report?.leftTime ? formatClockTime(report.leftTime) : '--:--';
  const totalLabel = report
    ? formatHours((report.leftTime ?? now.getTime()) - report.checkInTime)
    : '--:--';
  const valueTone = report ? t.colors.success : t.colors.textMuted;

  const wells = [
    { label: 'BLUETOOTH', value: btReady ? 'On' : 'Off', ok: btReady },
    { label: 'PERMISSIONS', value: permsReady ? 'Granted' : 'Needed', ok: permsReady },
    { label: 'CONNECTION', value: onAir ? 'On air' : '—', ok: onAir },
  ];

  const cells = [
    { label: 'CHECK IN', value: checkInLabel, tone: valueTone },
    // Check-out only ever arrives as a LEFT update, so it is never green.
    { label: 'CHECK OUT', value: checkOutLabel, tone: t.colors.textMuted },
    { label: 'TOTAL', value: totalLabel, tone: valueTone },
  ];

  return (
    <Screen contentStyle={styles.root}>
      {/* ------------------------------------------------------- greeting -- */}
      <Txt style={[styles.greeting, { color: t.colors.textMuted }]}>{greetingFor(now)}</Txt>
      <Txt style={[styles.headline, { color: t.colors.textPrimary }]}>
        {employeeName ? 'Hey ' + employeeName.split(' ')[0] : 'Welcome'}
      </Txt>
      <Txt
        variant="caption"
        color={t.colors.textMuted}
        mono
        style={{ marginTop: 4, fontSize: 11.5 }}>
        {configured
          ? employeeDepartment
            ? employeeId + ' · ' + employeeDepartment
            : employeeId
          : 'Set up your profile to begin'}
      </Txt>

      {/* ---------------------------------------------------------- clock -- */}
      <View style={styles.clockRow}>
        <Txt style={[styles.clock, numeric, { color: t.colors.textPrimary }]}>
          {formatClockTime(now.getTime())}
        </Txt>
        <Txt style={[styles.date, { color: t.colors.textSecondary }]}>{shortDate(now)}</Txt>
      </View>

      {/* ---------------------------------------------------------- orbit -- */}
      <View style={styles.orbitSlot}>
        <Orbit
          state={orbitState}
          role="employee"
          size={300}
          deviceName={report?.hostId}
          checkInTime={report ? formatClockTime(report.checkInTime) : undefined}
          sub={configured ? undefined : 'Set up your profile first'}
          onPress={handleTap}
          disabled={busy}
        />
      </View>

      {/* -------------------------------------------------- capability wells -- */}
      <View style={styles.wellRow}>
        {wells.map(w => (
          <View key={w.label} style={[styles.well, t.neuIn(t.colors)]}>
            <Txt style={[styles.wellLabel, { color: t.colors.textMuted }]}>{w.label}</Txt>
            <View style={styles.wellValueRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: w.ok ? t.colors.success : t.colors.textMuted },
                ]}
              />
              <Txt
                style={[
                  styles.wellValue,
                  { color: w.ok ? t.colors.success : t.colors.textMuted },
                ]}>
                {w.value}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      {/* ---------------------------------------------------------- today -- */}
      <View style={styles.todayHead}>
        <Txt style={[styles.todayTitle, { color: t.colors.textPrimary }]}>Today</Txt>
        <Pressable
          hitSlop={8}
          onPress={() => navigation.getParent()?.navigate('Attendance')}>
          <Txt style={[styles.detailsLink, { color: t.colors.primaryTint }]}>Details</Txt>
        </Pressable>
      </View>

      <View style={styles.cellRow}>
        {cells.map(c => (
          <View
            key={c.label}
            style={[
              styles.cell,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              t.shadow(1),
            ]}>
            <Txt style={[styles.cellLabel, { color: t.colors.textMuted }]}>{c.label}</Txt>
            <Txt style={[styles.cellValue, numeric, { color: c.tone }]}>{c.value}</Txt>
          </View>
        ))}
      </View>

      <Txt style={[styles.provenance, { color: t.colors.textMuted }]}>
        {report
          ? 'Reported by ' + report.hostId + ' at ' + formatClockTime(report.reportedAt) + ', delivered over Bluetooth.'
          : 'Times appear once the Host records you and sends the receipt back.'}
      </Txt>

      {/* --------------------------------------------------------- banners -- */}
      {permissionError ? (
        <View style={{ marginTop: t.spacing.lg }}>
          <Banner tone="danger" title="Could not start broadcasting" detail={permissionError} />
        </View>
      ) : null}
      {adv.state === 'ERROR' && adv.error ? (
        <View style={{ marginTop: t.spacing.md }}>
          <Banner tone="danger" title="Broadcast failed" detail={adv.error} />
        </View>
      ) : null}
      {store.advertisingResumePending && !onAir ? (
        <View style={{ marginTop: t.spacing.md }}>
          <Banner
            tone="warning"
            title="Attendance is not on air"
            detail="You asked to be broadcasting, but the radio is not. Nothing is being sent until this is resolved."
            actionLabel="Try again"
            onAction={() => void handleStart()}
          />
        </View>
      ) : null}

      {!configured ? (
        <View style={{ marginTop: t.spacing.lg }}>
          <Card accent={t.colors.warning}>
            <Txt variant="heading">Finish setting up your profile</Txt>
            <Txt variant="caption" color={t.colors.textSecondary} style={{ marginTop: 4 }}>
              Add your Employee ID so the office system can recognise you. It must match the ID your
              administrator registered.
            </Txt>
            <View style={{ marginTop: t.spacing.md }}>
              <Button
                title="Set up profile"
                onPress={() => navigation.getParent()?.navigate('Profile')}
                variant="neutral"
              />
            </View>
          </Card>
        </View>
      ) : null}

      <Modal
        visible={celebrate !== null}
        animationType="fade"
        onRequestClose={() => setCelebrate(null)}
        statusBarTranslucent>
        {celebrate ? (
          <CheckInSuccessScreen
            variant="employee"
            employeeName={employeeName || 'You'}
            employeeId={celebrate.employeeId}
            checkInTime={celebrate.checkInTime}
            hostId={celebrate.hostId}
            photo={store.settings.employeePhoto || undefined}
            onDismiss={() => setCelebrate(null)}
          />
        ) : null}
      </Modal>

      <BlockerSheet
        visible={sheet !== null}
        kind={sheet ?? 'bluetooth'}
        role="advertise"
        onClose={() => setSheet(null)}
        onFixed={() => void handleStart()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The orbit slot is the only flexible row, so the column fills one viewport.
  // No paddingBottom here: Screen derives its own from the tab bar and the
  // gesture inset, and overriding it would trap the last row under the bar.
  root: { flexGrow: 1 },

  greeting: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 13, letterSpacing: 0.1 },
  headline: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 23,
    letterSpacing: -0.5,
    lineHeight: 30,
    marginTop: 3,
  },

  clockRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 18,
  },
  clock: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 38,
    letterSpacing: -1.4,
    lineHeight: 46,
  },
  date: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 12.5 },

  orbitSlot: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 300 },

  wellRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  well: { alignItems: 'center', borderRadius: 14, flex: 1, paddingHorizontal: 8, paddingVertical: 10 },
  wellLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9, letterSpacing: 0.8 },
  wellValueRow: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 6 },
  dot: { borderRadius: 999, height: 6, width: 6 },
  wellValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5 },

  todayHead: { alignItems: 'center', flexDirection: 'row', marginTop: 26 },
  todayTitle: { flex: 1, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  detailsLink: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12.5 },

  cellRow: { flexDirection: 'row', gap: 9, marginTop: 11 },
  cell: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  cellLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9.5, letterSpacing: 0.8 },
  cellValue: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 17, marginTop: 6 },

  provenance: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 11,
    lineHeight: 16.5,
    marginTop: 11,
    textAlign: 'center',
  },
});
