/**
 * EmployeeDetailScreen.tsx — v3, the Host's employee record
 * -----------------------------------------------------------------------------
 * One employee, as the HOST sees them: live proximity, today's verified trail,
 * the month in aggregate, and the registry entry behind it all.
 *
 * Host-side only, and that is the point — the Host is the device that actually
 * holds the attendance record, so this is the one screen in the app that can
 * honestly show a check-in time next to a status.
 *
 * "Currently in range" and the check-in time are separate facts and are shown
 * separately. An employee can be PRESENT (checked in this morning) while not
 * detected right now, and conflating the two would misreport both.
 *
 * RSSI IS NEVER METRES. The meter reads in dBm against the configured
 * threshold and says "Nearby / Far", because that is the whole of what the
 * radio can honestly tell you.
 *
 * WHERE THE DESIGN'S NUMBERS COME FROM
 * ---------------------------------------------------------------------------
 * "5-sample mean" is this app's own RSSI_SMOOTHING_WINDOW, rendered from the
 * constant rather than typed in, so it cannot drift from the scanner.
 *
 * THE READINGS STRIP is collected here, live. The scanner deliberately strips
 * its internal sample buffer before publishing a detection, so no reading
 * history exists to read from — this screen accumulates smoothed values while
 * it is open. It samples on a fixed cadence rather than on every advertisement:
 * advertisements land several times a second, so an untimed strip would span a
 * few seconds and show a flat line. STRIP_INTERVAL_MS is what the footer's
 * "every Ns" reports, so the label and the data cannot disagree.
 *
 * The strip therefore fills over minutes rather than showing a backlog, which
 * is honest — nothing was recorded before you opened the screen.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { AttendanceRecord } from '../attendance/attendanceTypes';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon, type IconName } from '../components/Icon';
import { Screen, Txt } from '../components/ui';
import { EmptyState } from '../components/states';
import { formatClockTime } from '../constants/appConfig';
import { RSSI_SMOOTHING_WINDOW, SERVICE_UUID_16 } from '../constants/bluetoothConfig';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/** The window the meter is drawn across. Weakest .. strongest, in dBm. */
const RSSI_FLOOR = -100;
const RSSI_CEIL = -40;

/** How many live readings the strip holds. */
const STRIP_SIZE = 14;
/**
 * How often the strip takes a sample. Advertisements arrive several times a
 * second, so sampling every one would make the strip a flat few seconds of the
 * same value; at 30s the fourteen slots span seven minutes of real movement.
 */
const STRIP_INTERVAL_MS = 30_000;

function rssiFraction(rssi: number): number {
  return Math.max(0, Math.min(1, (rssi - RSSI_FLOOR) / (RSSI_CEIL - RSSI_FLOOR)));
}

function pct(fraction: number): DimensionValue {
  return ((fraction * 100).toFixed(2) + '%') as DimensionValue;
}

function hoursLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}

function clockFromMinutes(minutes: number): string {
  return (
    String(Math.floor(minutes / 60)).padStart(2, '0') +
    ':' +
    String(Math.round(minutes) % 60).padStart(2, '0')
  );
}

const EVENT_TITLE: Record<string, string> = {
  FIRST_DETECTED: 'First detected',
  CHECK_IN: 'Checked in',
  LEFT: 'Marked as left',
  RE_ENTRY: 'Back in range',
};

const EVENT_DETAIL: Record<string, string> = {
  FIRST_DETECTED: 'First advertisement of the day',
  CHECK_IN: 'Matched by manufacturerData',
  LEFT: 'Signal gone past the grace period',
  RE_ENTRY: 'Re-entered range after being marked left',
};

export function EmployeeDetailScreen() {
  const t = useTheme();
  const c = t.colors;
  const store = useAppStore();
  const navigation = useNavigation<{
    navigate: (s: string, p?: object) => void;
    goBack: () => void;
  }>();
  const route = useRoute<{ key: string; name: string; params?: { employeeId?: string } }>();

  const employeeId = route.params?.employeeId ?? '';

  const row = store.attendanceRows.find(r => r.employeeId === employeeId) ?? null;
  const employee = store.employees.find(e => e.employeeId === employeeId) ?? null;
  const threshold = store.settings.proximity.minimumRssi;
  const record = row?.record ?? null;
  const rssi = row?.currentRssi ?? null;
  const live = !!row?.currentlyNearby;

  /* --------------------------------------------------- live reading strip -- */

  /**
   * Accumulate smoothed readings on a fixed cadence.
   *
   * Sampling every advertisement would fill all fourteen slots within seconds
   * and show one repeated value; the interval is what makes the strip a history
   * rather than an instant. A slot is only taken when a reading genuinely
   * exists, so an out-of-range stretch leaves a gap instead of a zero.
   */
  const [readings, setReadings] = useState<number[]>([]);
  const rssiRef = useRef<number | null>(rssi);
  rssiRef.current = rssi;

  useEffect(() => {
    const take = () => {
      const current = rssiRef.current;
      if (current === null) return;
      setReadings(prev => [...prev, current].slice(-STRIP_SIZE));
    };
    take();
    const timer = setInterval(take, STRIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  /* ------------------------------------------------------------ the month -- */

  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[] | null>(null);
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    void store.attendanceManager.getAttendanceForEmployee(employeeId).then(rows => {
      if (alive) setMonthRecords(rows);
    });
    return () => {
      alive = false;
    };
  }, [employeeId, store.attendanceManager, store.todayRecords.length]);

  const month = useMemo(() => {
    const now = new Date();
    const key =
      now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const rows = (monthRecords ?? []).filter(r => r.date.startsWith(key));
    const present = rows.filter(r => r.checkInTime !== null);

    const checkIns = present.map(r => {
      const d = new Date(r.checkInTime as number);
      return d.getHours() * 60 + d.getMinutes();
    });
    const spans = present
      .filter(r => r.lastSeenTime !== null)
      .map(r => (r.lastSeenTime as number) - (r.checkInTime as number));

    return {
      recorded: rows.length,
      present: present.length,
      /** null, not zero, when the month holds no evidence either way. */
      ratePct: rows.length === 0 ? null : Math.round((present.length / rows.length) * 100),
      avgIn:
        checkIns.length === 0
          ? null
          : checkIns.reduce((a, b) => a + b, 0) / checkIns.length,
      avgOnSite:
        spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length,
    };
  }, [monthRecords]);

  /* --------------------------------------------------------------- trail -- */

  const trail = useMemo(() => {
    if (!record) return [];
    return [...record.events]
      .sort((a, b) => b.at - a.at)
      .map(e => ({
        title: EVENT_TITLE[e.type] ?? e.type,
        time: formatClockTime(e.at),
        detail:
          e.rssi === null || e.rssi === undefined
            ? EVENT_DETAIL[e.type] ?? ''
            : (EVENT_DETAIL[e.type] ?? '') + ' · ' + e.rssi + ' dBm',
        fg:
          e.type === 'CHECK_IN'
            ? c.success
            : e.type === 'LEFT'
            ? c.warning
            : c.primaryTint,
        soft:
          e.type === 'CHECK_IN'
            ? c.successSoft
            : e.type === 'LEFT'
            ? c.warningSoft
            : c.primarySoft,
      }));
  }, [record, c]);

  /* -------------------------------------------------------------- actions -- */

  const confirmDelete = useCallback(() => {
    if (!employee) return;
    Alert.alert(
      'Remove ' + employee.displayName + '?',
      'They will no longer be detected. Past attendance records are kept — removing someone does not rewrite history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void store.employeeManager.removeEmployee(employee.employeeId);
            navigation.goBack();
          },
        },
      ],
    );
  }, [employee, store.employeeManager, navigation]);

  if (!employee) {
    return (
      <Screen>
        <EmptyState
          icon="user"
          title="Employee not found"
          message="This person is no longer in the registry."
        />
      </Screen>
    );
  }

  /* --------------------------------------------------------------- derive -- */

  const status = row?.status ?? 'ABSENT';
  const tone =
    status === 'PRESENT'
      ? { fg: c.success, soft: c.successSoft, bd: c.successBorder }
      : status === 'LEFT'
      ? { fg: c.warning, soft: c.warningSoft, bd: c.warning }
      : { fg: c.textMuted, soft: c.surfaceMuted, bd: c.borderStrong };

  const onSiteMs =
    record?.checkInTime && record.lastSeenTime
      ? record.lastSeenTime - record.checkInTime
      : null;

  const stats = [
    {
      n: record?.checkInTime ? formatClockTime(record.checkInTime) : '--:--',
      label: 'CHECK IN',
      fg: record?.checkInTime ? c.success : c.textMuted,
    },
    {
      n: record?.lastSeenTime ? formatClockTime(record.lastSeenTime) : '--:--',
      label: 'LAST SEEN',
      fg: c.textPrimary,
    },
    {
      n: onSiteMs === null ? '—' : hoursLabel(onSiteMs),
      label: 'ON SITE',
      fg: onSiteMs === null ? c.textMuted : c.success,
    },
  ];

  const monthTiles = [
    {
      label: 'ATTENDANCE RATE',
      n: month.ratePct === null ? '—' : month.ratePct + '%',
      fg: month.ratePct === null ? c.textMuted : c.success,
    },
    { label: 'DAYS PRESENT', n: String(month.present), fg: c.textPrimary },
    {
      label: 'AVG CHECK-IN',
      n: month.avgIn === null ? '—' : clockFromMinutes(month.avgIn),
      fg: c.textPrimary,
    },
    {
      label: 'AVG ON SITE',
      n: month.avgOnSite === null ? '—' : hoursLabel(month.avgOnSite),
      fg: c.textPrimary,
    },
  ];

  const registry: { icon: IconName; label: string; value: string; mono: boolean }[] = [
    { icon: 'id-card', label: 'Employee ID', value: employee.employeeId, mono: true },
    { icon: 'users', label: 'Department', value: employee.department || '—', mono: false },
    { icon: 'mail', label: 'Email', value: employee.email || '—', mono: false },
    { icon: 'phone', label: 'Phone', value: employee.phone || '—', mono: true },
    {
      icon: 'bluetooth',
      label: 'Broadcast ID',
      value: employee.employeeId + ' · ' + SERVICE_UUID_16,
      mono: true,
    },
    { icon: 'building-2', label: 'Office', value: employee.office || '—', mono: false },
  ];

  /** Every day this device has ever recorded for them — what a removal keeps. */
  const recordedDays = (monthRecords ?? []).filter(r => r.checkInTime !== null).length;

  const strongest = readings.length ? Math.max(...readings) : null;
  const weakest = readings.length ? Math.min(...readings) : null;
  const card = { backgroundColor: c.surface, borderColor: c.border };

  return (
    <Screen>
      {/* --------------------------------------------------------- header -- */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon name="chevron-left" size={22} color={c.textPrimary} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Txt style={[styles.headerTitle, { color: c.textPrimary }]}>Employee record</Txt>
          <Txt mono style={[styles.headerId, { color: c.textMuted }]}>
            {employee.employeeId}
          </Txt>
        </View>

<Pressable
          onPress={() =>
            navigation.navigate('AddEmployee', { employeeId: employee.employeeId })
          }
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Edit employee"
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon name="square-pen" size={20} color={c.textSecondary} />
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate('History', { openExport: true })}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Export attendance"
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon name="download" size={20} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* ------------------------------------------------------- identity -- */}
      <View style={styles.identity}>
        <EmployeeAvatar
          name={employee.displayName}
          employeeId={employee.employeeId}
          size={62}
          photo={employee.photo}
          badge={live ? c.success : undefined}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>
            {employee.displayName}
          </Txt>
          <Txt mono style={[styles.sub, { color: c.textMuted }]} numberOfLines={1}>
            {[employee.employeeId, employee.department, employee.title]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
          <View style={[styles.pill, { backgroundColor: tone.soft, borderColor: tone.bd }]}>
            <View style={[styles.dot6, { backgroundColor: tone.fg }]} />
            <Txt style={[styles.pillText, { color: tone.fg }]}>
              {status + (live ? ' · IN RANGE' : '')}
            </Txt>
          </View>
        </View>
      </View>

      {/* ----------------------------------------------------- stat trio -- */}
      <View style={styles.trio}>
        {stats.map(s => (
          <View key={s.label} style={[styles.statCard, card, t.neu]}>
            <Txt style={[styles.statN, numeric, { color: s.fg }]}>{s.n}</Txt>
            <Txt style={[styles.statLabel, { color: c.textMuted }]}>{s.label}</Txt>
          </View>
        ))}
      </View>

      {/* ------------------------------------------------------ proximity -- */}
      <View style={[styles.proxCard, card, t.neu]}>
        <View style={styles.proxHead}>
          <Txt style={[styles.eyebrow, { color: c.textMuted }]}>PROXIMITY</Txt>
          {live ? (
            <View style={styles.liveChip}>
              <View style={[styles.dot6, { backgroundColor: c.success }]} />
              <Txt style={[styles.liveText, { color: c.success }]}>LIVE</Txt>
            </View>
          ) : null}
        </View>

        <View style={styles.proxValueRow}>
          <Txt
            style={[
              styles.proxValue,
              numeric,
              { color: rssi === null ? c.textMuted : rssi >= threshold ? c.success : c.warning },
            ]}>
            {rssi === null ? '—' : String(rssi)}
          </Txt>
          <Txt mono style={[styles.proxUnit, { color: c.textMuted }]}>
            {rssi === null
              ? 'not in range'
              : 'dBm · ' + RSSI_SMOOTHING_WINDOW + '-sample mean'}
          </Txt>
        </View>

        <View style={[styles.track, t.neuIn(c)]}>
          {/* Everything at or above the threshold — the band where a reading
              counts as a check-in. */}
          <View
            style={[
              styles.zone,
              {
                backgroundColor: c.successSoft,
                left: pct(rssiFraction(threshold)),
              },
            ]}
          />
          <View
            style={[
              styles.tick,
              { backgroundColor: c.warning, left: pct(rssiFraction(threshold)) },
            ]}
          />
          {rssi !== null ? (
            <View
              style={[
                styles.thumb,
                {
                  backgroundColor: rssi >= threshold ? c.success : c.warning,
                  borderColor: c.surface,
                  left: pct(rssiFraction(rssi)),
                },
              ]}
            />
          ) : null}
        </View>

        <View style={styles.scaleRow}>
          <Txt style={[styles.scaleLabel, { color: c.textMuted }]}>{'Far · ' + RSSI_FLOOR}</Txt>
          <Txt style={[styles.scaleLabel, { color: c.warning }]}>
            {'records at ' + threshold}
          </Txt>
          <Txt style={[styles.scaleLabel, { color: c.textMuted }]}>
            {'Nearby · ' + RSSI_CEIL}
          </Txt>
        </View>

        <Txt style={[styles.eyebrow, styles.stripHead, { color: c.textMuted }]}>
          {'LAST ' + STRIP_SIZE + ' READINGS'}
        </Txt>

        <View style={styles.bars}>
          {Array.from({ length: STRIP_SIZE }, (_, i) => {
            // Right-aligned: the newest reading sits at the right edge, and
            // slots with nothing observed yet stay empty rather than zeroed.
            const value = readings[i - (STRIP_SIZE - readings.length)];
            if (value === undefined) {
              return <View key={i} style={[styles.barSlot, { backgroundColor: c.surfaceMuted }]} />;
            }
            return (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    backgroundColor: value >= threshold ? c.success : c.warning,
                    height: 10 + rssiFraction(value) * 26,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.scaleRow}>
          <Txt style={[styles.scaleLabel, { color: c.textMuted }]}>
            {weakest === null
              ? 'no readings yet'
              : weakest + ' to ' + strongest + ' dBm range'}
          </Txt>
          <Txt style={[styles.scaleLabel, { color: c.textMuted }]}>
            {'every ' + STRIP_INTERVAL_MS / 1000 + 's'}
          </Txt>
        </View>
      </View>

      {/* ---------------------------------------------------------- today -- */}
      <View style={styles.sectionHead}>
        <Txt style={[styles.eyebrow, { color: c.textMuted }]}>TODAY</Txt>
        <Txt style={[styles.eventCount, { color: c.textMuted }]}>
          {trail.length + (trail.length === 1 ? ' event' : ' events')}
        </Txt>
      </View>

      {trail.length === 0 ? (
        <View style={[styles.note, t.neuIn(c)]}>
          <Icon name="info" size={16} color={c.textMuted} />
          <Txt style={[styles.noteText, { color: c.textMuted }]}>
            Nothing recorded today. Events appear here the moment this Host confirms a
            reading.
          </Txt>
        </View>
      ) : (
        <View style={styles.trail}>
          {trail.map((e, i) => (
            <View key={i} style={styles.trailRow}>
              <View style={styles.rail}>
                <View style={[styles.railDot, { backgroundColor: e.fg, borderColor: e.soft }]} />
                {i < trail.length - 1 ? (
                  <View style={[styles.railLine, { backgroundColor: c.border }]} />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.trailHead}>
                  <Txt style={[styles.trailTitle, { color: c.textPrimary }]}>{e.title}</Txt>
                  <Txt style={[styles.trailTime, numeric, { color: c.textSecondary }]}>
                    {e.time}
                  </Txt>
                </View>
                <Txt style={[styles.trailDetail, { color: c.textMuted }]}>{e.detail}</Txt>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ----------------------------------------------------- this month -- */}
      <Txt style={[styles.eyebrow, styles.sectionTop, { color: c.textMuted }]}>THIS MONTH</Txt>
      {[monthTiles.slice(0, 2), monthTiles.slice(2)].map((pair, i) => (
        <View key={i} style={i === 0 ? styles.grid : styles.gridNext}>
          {pair.map(tile => (
            <View key={tile.label} style={[styles.monthTile, card, t.neu]}>
              <Txt style={[styles.monthLabel, { color: c.textMuted }]}>{tile.label}</Txt>
              <Txt style={[styles.monthN, numeric, { color: tile.fg }]}>{tile.n}</Txt>
            </View>
          ))}
        </View>
      ))}

      {/* ------------------------------------------------------- registry -- */}
      <Txt style={[styles.eyebrow, styles.sectionTop, { color: c.textMuted }]}>REGISTRY</Txt>
      <View style={[styles.listCard, card, t.shadow(1)]}>
        {registry.map(r => (
          <View key={r.label} style={[styles.regRow, { borderTopColor: c.border }]}>
            <Icon name={r.icon} size={16} color={c.textMuted} />
            <Txt style={[styles.regLabel, { color: c.textMuted }]}>{r.label}</Txt>
            <Txt
              mono={r.mono}
              numberOfLines={1}
              style={[styles.regValue, { color: c.textPrimary }]}>
              {r.value}
            </Txt>
          </View>
        ))}

        {/* Removal lives with the entry it removes, and says what it keeps —
            taking someone off the roster does not rewrite their history. */}
        <Pressable
          onPress={confirmDelete}
          style={({ pressed }) => [
            styles.regRow,
            styles.removeRow,
            { borderTopColor: c.border },
            pressed ? { backgroundColor: c.errorSoft } : null,
          ]}>
          <Icon name="trash-2" size={16} color={c.error} />
          <View style={{ flex: 1 }}>
            <Txt style={[styles.removeTitle, { color: c.error }]}>Remove from registry</Txt>
            <Txt style={[styles.removeSub, { color: c.textMuted }]}>
              {recordedDays === 0
                ? 'Nothing has been recorded for them yet'
                : 'Keeps the ' +
                  recordedDays +
                  (recordedDays === 1 ? ' day' : ' days') +
                  ' already recorded'}
            </Txt>
          </View>
        </Pressable>
      </View>

      {/* -------------------------------------------------------- actions -- */}
      <Pressable
        onPress={() => navigation.navigate('History')}
        style={({ pressed }) => [
          styles.fullHistory,
          pressed ? { transform: [{ scale: 0.98 }] } : null,
        ]}>
        <LinearGradient
          colors={['#4F46E5', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <Icon name="history" size={17} color="#FFFFFF" />
        <Txt style={[styles.fullHistoryLabel, { color: '#FFFFFF' }]}>
          Full attendance history
        </Txt>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  headerTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, lineHeight: 21 },
  headerId: { fontSize: 11.5, lineHeight: 15, marginTop: 2 },

  identity: { alignItems: 'center', flexDirection: 'row', gap: 14, marginTop: 18 },
  name: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 21,
    letterSpacing: -0.4,
    lineHeight: 27,
  },
  sub: { fontSize: 11.5, lineHeight: 15, marginTop: 3 },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    height: 24,
    marginTop: 9,
    paddingHorizontal: 10,
  },
  pillText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10.5, letterSpacing: 0.7 },
  dot6: { borderRadius: 999, height: 6, width: 6 },

  trio: { flexDirection: 'row', gap: 9, marginTop: 22 },
  statCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  statN: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 21,
    letterSpacing: -0.7,
    lineHeight: 27,
  },
  statLabel: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.7,
    lineHeight: 13,
    marginTop: 4,
  },

  proxCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 22,
    padding: 16,
  },
  proxHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eyebrow: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 13,
  },
  liveChip: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  liveText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10, letterSpacing: 0.7 },
  proxValueRow: { alignItems: 'baseline', flexDirection: 'row', gap: 8, marginTop: 9 },
  proxValue: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 32,
    letterSpacing: -1.2,
    lineHeight: 40,
  },
  proxUnit: { fontSize: 12, lineHeight: 16 },

  track: {
    borderRadius: 999,
    height: 8,
    justifyContent: 'center',
    marginTop: 16,
  },
  zone: { borderRadius: 999, bottom: 0, position: 'absolute', right: 0, top: 0 },
  tick: { bottom: 0, position: 'absolute', top: 0, width: 2 },
  thumb: {
    borderRadius: 999,
    borderWidth: 2,
    height: 14,
    marginLeft: -7,
    position: 'absolute',
    width: 14,
  },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  scaleLabel: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10.5, lineHeight: 14 },

  stripHead: { marginTop: 16 },
  bars: { alignItems: 'flex-end', flexDirection: 'row', gap: 4, height: 36, marginTop: 10 },
  bar: { borderRadius: 2, flex: 1 },
  barSlot: { borderRadius: 2, flex: 1, height: 10 },

  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 26,
  },
  eventCount: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 11.5, lineHeight: 15 },
  sectionTop: { marginBottom: 12, marginTop: 26 },

  note: { borderRadius: 18, flexDirection: 'row', gap: 11, padding: 18 },
  noteText: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12.5,
    lineHeight: 19.5,
  },

  trail: { paddingLeft: 4 },
  trailRow: { flexDirection: 'row', gap: 14, paddingBottom: 18 },
  rail: { alignItems: 'center' },
  railDot: { borderRadius: 999, borderWidth: 4, height: 19, marginTop: 3, width: 19 },
  railLine: { flex: 1, marginTop: 4, width: 1.5 },
  trailHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  trailTitle: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14, lineHeight: 18 },
  trailTime: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13, lineHeight: 17 },
  trailDetail: {
    flexShrink: 1,
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  grid: { flexDirection: 'row', gap: 9 },
  gridNext: { flexDirection: 'row', gap: 9, marginTop: 9 },
  monthTile: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    padding: 14,
  },
  monthLabel: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 9.5,
    letterSpacing: 0.7,
    lineHeight: 12.5,
  },
  monthN: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 20,
    letterSpacing: -0.7,
    lineHeight: 26,
    marginTop: 6,
  },

  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  regRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  regLabel: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13, lineHeight: 17 },
  regValue: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 13,
    lineHeight: 17,
    textAlign: 'right',
  },

  fullHistory: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    justifyContent: 'center',
    marginTop: 22,
    overflow: 'hidden',
  },
  fullHistoryLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },

  removeRow: { alignItems: 'center' },
  removeTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, lineHeight: 18 },
  removeSub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 2,
  },
});
