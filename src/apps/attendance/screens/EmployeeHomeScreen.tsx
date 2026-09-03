/**
 * EmployeeHomeScreen.tsx
 * -----------------------------------------------------------------------------
 * The employee's punch-clock home: live clock, one big circular Check in /
 * Check out control, and a Check-in / Check-out / Total-hours row underneath.
 *
 * WHERE EVERY NUMBER COMES FROM — the honesty contract of this screen.
 *
 *   The BUTTON controls this phone's radio. "Check in" starts broadcasting
 *   the employee ID; "Check out" stops it. That is all it can truthfully do.
 *
 *   The TIMES in the bottom row come ONLY from the status report the Host
 *   delivers back over the BLE reply channel after it actually records the
 *   check-in. Until a report arrives they show dashes. Pressing the button
 *   never fills them in by itself — a phone that cannot reach a Host shows
 *   "broadcasting" and dashes, which is exactly the truth.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppHeader } from '../components/AppHeader';
import { requestAdvertisePermissions } from '../bluetooth/permissions';
import { BlockerSheet, type BlockerKind } from '../components/BlockerSheet';
import { CheckInButton } from '../components/CheckInButton';
import { CheckInSuccessScreen } from './CheckInSuccessScreen';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon, type IconName } from '../components/Icon';
import { SettingGroup, SettingRow } from '../components/SettingRow';
import { Banner, Button, Card, Screen, SectionHeader, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatPunchDate(d: Date): string {
  return (
    MONTHS[d.getMonth()] + ' -' + d.getDate() + ' ' + d.getFullYear() + ' - ' + WEEKDAYS[d.getDay()]
  );
}

/** "7h 25m" from a millisecond span; sub-minute spans round down to 0m. */
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

  const goToTab = useCallback(
    (tab: string) => navigation.getParent()?.navigate(tab),
    [navigation],
  );

  const [busy, setBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<BlockerKind | null>(null);

  const adv = store.advertiser;
  const readiness = store.readiness;
  const report = store.employeeStatusReport;
  const { employeeId, employeeName } = store.settings;

  const configured = employeeId.trim().length > 0;
  const onAir = adv.state === 'ACTIVE';

  /**
   * Celebrate a check-in the moment the HOST'S REPORT ARRIVES — not when the
   * button is pressed. Pressing the button only starts the radio; being
   * recorded is a separate fact that arrives later over the reply channel,
   * and this screen must only cheer for the second one.
   *
   * `seenReportKey` is seeded on the first render so reopening the app to an
   * already-delivered report does not replay the confetti. Only a report that
   * appears (or changes) after that first pass counts as new.
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
      // Only a fresh CHECK-IN is celebrated. A LEFT update changes the record
      // but is not good news, so it updates the screen silently.
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

  const handlePunch = useCallback(() => {
    if (onAir) {
      void handleStop();
    } else {
      void handleStart();
    }
  }, [onAir, handleStart, handleStop]);

  /* ---------------------------------------------------- delivered values -- */

  // ONLY the Host-delivered report may populate these. See header comment.
  const checkInLabel = report ? formatClockTime(report.checkInTime) : '--:--';
  const checkOutLabel = report?.leftTime ? formatClockTime(report.leftTime) : '--:--';
  const totalLabel = report
    ? formatHours((report.leftTime ?? now.getTime()) - report.checkInTime)
    : '--:--';

  const allSystemsGo = !!readiness?.bluetooth.ready && !!readiness?.permissionsGranted;

  return (
    <Screen>
      <AppHeader
        name={employeeName ? 'Hey ' + employeeName.split(' ')[0] : 'Welcome'}
        subtitle={configured ? 'Mark your attendance' : 'Set up your profile to begin'}
        showAvatar={false}
        right={
          <Pressable
            onPress={() => navigation.navigate('Profile')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open your profile">
            <EmployeeAvatar
              name={employeeName || '?'}
              employeeId={employeeId || 'unset'}
              size={48}
              photo={store.settings.employeePhoto || undefined}
              badge={onAir ? t.colors.success : undefined}
            />
          </Pressable>
        }
      />

      {/* ------------------------------------------------------- the clock -- */}
      <View style={styles.clockBlock}>
        <Txt variant="display" align="center" style={styles.clock}>
          {formatClockTime(now.getTime())}
        </Txt>
        <Txt variant="caption" color={t.colors.textSecondary} align="center" style={{ marginTop: 4 }}>
          {formatPunchDate(now)}
        </Txt>
      </View>

      {/* ------------------------------------------------------ the button -- */}
      <View style={{ marginVertical: t.spacing.xl }}>
        <CheckInButton
          live={onAir}
          busy={busy}
          disabled={!configured}
          onPress={handlePunch}
        />
        <Txt
          variant="caption"
          color={onAir ? t.colors.success : t.colors.textMuted}
          align="center"
          style={{ marginTop: t.spacing.md }}>
          {onAir
            ? 'Broadcasting ' + (adv.employeeId ?? employeeId) + ' — the Host can detect you'
            : configured
            ? 'Tap to start attendance broadcasting'
            : 'Add your Employee ID in Profile to begin'}
        </Txt>
      </View>

      {/* ------------------------------------------- Host-reported numbers -- */}
      <View style={[styles.punchRow, { marginBottom: t.spacing.sm }]}>
        <PunchStat icon="log-in" value={checkInLabel} label="Check in" />
        <PunchStat icon="log-out" value={checkOutLabel} label="Check out" />
        <PunchStat icon="timer" value={totalLabel} label="Total hrs" />
      </View>
      <Txt
        variant="caption"
        color={t.colors.textMuted}
        align="center"
        style={{ lineHeight: 17, marginBottom: t.spacing.lg }}>
        {report
          ? 'Reported by ' + report.hostId + ' at ' + formatClockTime(report.reportedAt) + ', delivered over Bluetooth.'
          : 'Times appear when the office Host records you and sends the status to this phone.'}
      </Txt>

      {/* --------------------------------------------------------- banners -- */}
      {permissionError ? (
        <Banner tone="danger" title="Could not start broadcasting" detail={permissionError} />
      ) : null}
      {adv.state === 'ERROR' && adv.error ? (
        <Banner tone="danger" title="Broadcast failed" detail={adv.error} />
      ) : null}
      {store.advertisingResumePending && !onAir ? (
        <Banner
          tone="warning"
          title="Attendance is not on air"
          detail="You asked to be broadcasting, but the radio is not. Nothing is being sent until this is resolved."
          actionLabel="Try again"
          onAction={() => void handleStart()}
        />
      ) : null}

      {!configured ? (
        <Card accent={t.colors.warning}>
          <Txt variant="heading">Finish setting up your profile</Txt>
          <Txt variant="caption" color={t.colors.textSecondary} style={{ lineHeight: 19, marginTop: 4 }}>
            Add your Employee ID so the office system can recognise you. It must
            match the ID your administrator registered.
          </Txt>
          <View style={{ marginTop: t.spacing.md }}>
            <Button
              title="Set up profile"
              onPress={() => navigation.navigate('Profile')}
              variant="neutral"
            />
          </View>
        </Card>
      ) : null}

      {/* --------------------------------------------------- device status -- */}
      <SectionHeader
        title="Device status"
        style={{ marginTop: t.spacing.md }}
        right={
          <Txt variant="caption" color={allSystemsGo ? t.colors.success : t.colors.warning}>
            {allSystemsGo ? 'All systems normal' : 'Needs attention'}
          </Txt>
        }
      />
      <SettingGroup>
        <SettingRow
          icon="bluetooth"
          iconTone={readiness?.bluetooth.ready ? 'success' : 'warning'}
          title="Bluetooth"
          value={readiness?.bluetooth.ready ? 'On' : 'Off'}
          valueTone={readiness?.bluetooth.ready ? 'success' : 'warning'}
          onPress={readiness?.bluetooth.ready ? undefined : () => setSheet('bluetooth')}
        />
        <SettingRow
          icon="radio-tower"
          iconTone={onAir ? 'success' : 'neutral'}
          title="Broadcasting"
          value={onAir ? 'Active' : 'Off'}
          valueTone={onAir ? 'success' : 'neutral'}
        />
        <SettingRow
          icon="shield-check"
          iconTone={readiness?.permissionsGranted ? 'success' : 'warning'}
          title="App permissions"
          value={readiness?.permissionsGranted ? 'Granted' : 'Needed'}
          valueTone={readiness?.permissionsGranted ? 'success' : 'warning'}
          onPress={() => void store.refreshReadiness()}
        />
      </SettingGroup>

      {/* Quick actions — restored by request: the tabs reach the same places,
          but the tiles are the faster, more discoverable path. */}
      <SectionHeader title="Quick actions" style={{ marginTop: t.spacing.lg }} />
      <View style={styles.quickRow}>
        <QuickAction icon="user" label="My Profile" onPress={() => navigation.navigate('Profile')} />
        <QuickAction icon="history" label="History" onPress={() => goToTab('History')} />
        <QuickAction icon="settings" label="Settings" onPress={() => goToTab('Settings')} />
      </View>

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

/* ------------------------------------------------------------ QuickAction -- */

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [{ flex: 1 }, pressed ? { opacity: 0.7 } : null]}>
      <View
        style={[
          styles.quick,
          {
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
            borderRadius: t.radius.lg,
            paddingVertical: t.spacing.lg,
          },
        ]}>
        <View
          style={[
            styles.quickIcon,
            { backgroundColor: t.colors.primarySoft, borderRadius: 20 },
          ]}>
          <Icon name={icon} size={18} color={t.colors.primary} />
        </View>
        <Txt variant="caption" color={t.colors.textSecondary} align="center" style={{ marginTop: 8 }}>
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

/* -------------------------------------------------------------- PunchStat -- */

function PunchStat({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.punchStat}>
      <View
        style={[
          styles.punchIcon,
          { borderColor: t.colors.successBorder, borderRadius: t.radius.md },
        ]}>
        <Icon name={icon} size={18} color={t.colors.success} />
      </View>
      <Txt variant="bodyStrong" style={{ marginTop: 8 }}>
        {value}
      </Txt>
      <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  clockBlock: { marginTop: 4 },
  clock: { fontSize: 44, letterSpacing: -1, lineHeight: 52 },
  punchRow: { flexDirection: 'row', justifyContent: 'space-around' },
  punchStat: { alignItems: 'center', flex: 1 },
  punchIcon: {
    alignItems: 'center',
    borderWidth: 1.2,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  quickRow: { flexDirection: 'row', gap: 10 },
  quick: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  quickIcon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
});
