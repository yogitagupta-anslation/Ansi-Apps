/**
 * DayDetailScreen.tsx — v3 "Orbit"
 * -----------------------------------------------------------------------------
 * One day, and the evidence behind it. Pushed from History — from a calendar
 * cell or a daily-record row.
 *
 * The point of this screen is PROVENANCE. Attendance in this app is not typed
 * in by anyone; it is inferred from radio signal, so every recorded day should
 * be able to answer "who wrote this, how, and on what evidence". That is what
 * the verification card and the event timeline are for.
 *
 * TWO ROLES, TWO HONEST ANSWERS
 * ---------------------------------------------------------------------------
 * HOST      Holds the real audit trail: the record it wrote, the RSSI at the
 *           moment of the match, and the append-only event log. Its day is the
 *           whole roster, so the trio counts people rather than clock times.
 *
 * EMPLOYEE  Holds only what a Host delivered — status, check-in, check-out and
 *           which Host sent it. Signal strength and confirmation counts are
 *           NOT part of the reply payload, so those two rows say "not
 *           delivered" rather than borrowing a number from somewhere else. The
 *           mock's "−54 dBm · 3 readings" is a Host-side fact; printing it on
 *           an employee phone would be inventing a measurement.
 * -----------------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { AttendanceRecord } from '../attendance/attendanceTypes';
import { Icon } from '../components/Icon';
import { Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const WEEKDAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function minutesToClock(mins: number | null): string {
  if (mins === null) return '--:--';
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function hoursLabel(mins: number): string {
  return Math.floor(mins / 60) + 'h ' + String(mins % 60).padStart(2, '0') + 'm';
}

const EVENT_TITLE: Record<string, string> = {
  FIRST_DETECTED: 'First detected',
  CHECK_IN: 'Checked in',
  LEFT: 'Marked as left',
  RE_ENTRY: 'Back in range',
};

export function DayDetailScreen() {
  const t = useTheme();
  const c = t.colors;
  const store = useAppStore();
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<{ key: string; name: string; params: { date: string } }>();
  const date = route.params?.date ?? '';

  const isEmployee = store.settings.role === 'EMPLOYEE';

  /* ------------------------------------------------------- host records -- */

  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  useEffect(() => {
    if (isEmployee || !date) return;
    let alive = true;
    void store.attendanceManager.getAttendanceForDate(date).then(rows => {
      if (alive) setRecords(rows);
    });
    return () => {
      alive = false;
    };
  }, [isEmployee, date, store.attendanceManager]);

  /* --------------------------------------------------- employee's day -- */

  const stored = useMemo(
    () => store.employeeHistory.find(d => d.date === date) ?? null,
    [store.employeeHistory, date],
  );

  const day = parseDate(date);
  const title = MONTHS[day.getMonth()] + ' ' + day.getDate();

  /* ------------------------------------------------------------- verdict -- */

  const kind: 'present' | 'left' | 'absent' = isEmployee
    ? stored === null
      ? 'absent'
      : stored.status === 'PRESENT'
      ? 'present'
      : stored.status === 'LEFT'
      ? 'left'
      : 'absent'
    : (records?.filter(r => r.checkInTime !== null).length ?? 0) === 0
    ? 'absent'
    : (records?.filter(r => r.leftTime !== null).length ?? 0) > 0
    ? 'left'
    : 'present';

  const palette =
    kind === 'present'
      ? { fg: c.success, soft: c.successSoft, bd: c.successBorder }
      : kind === 'left'
      ? { fg: c.warning, soft: c.warningSoft, bd: c.warning }
      : { fg: c.textMuted, soft: c.surfaceMuted, bd: c.borderStrong };

  const checkedIn = records?.filter(r => r.checkInTime !== null) ?? [];
  const leftCount = records?.filter(r => r.leftTime !== null).length ?? 0;

  const badge = isEmployee
    ? kind === 'present'
      ? 'PRESENT · STILL ON SITE'
      : kind === 'left'
      ? 'CHECKED OUT'
      : 'ABSENT · NO RECORD'
    : kind === 'absent'
    ? 'NOBODY RECORDED'
    : checkedIn.length + ' OF ' + store.employees.length + ' PRESENT';

  /* ---------------------------------------------------------- the trio -- */

  const worked =
    stored && stored.checkInMinutes !== null && stored.checkOutMinutes !== null
      ? stored.checkOutMinutes - stored.checkInMinutes
      : null;

  const cells = isEmployee
    ? [
        {
          label: 'CHECK IN',
          val: minutesToClock(stored?.checkInMinutes ?? null),
          fg: kind === 'absent' ? c.textMuted : palette.fg,
        },
        {
          label: 'CHECK OUT',
          val: minutesToClock(stored?.checkOutMinutes ?? null),
          // Neutral even on a recorded day: checking out is not a verdict.
          fg: kind === 'absent' ? c.textMuted : c.textPrimary,
        },
        {
          label: 'TOTAL',
          val: worked === null ? '—' : hoursLabel(worked),
          fg: kind === 'absent' ? c.textMuted : palette.fg,
        },
      ]
    : [
        {
          label: 'PRESENT',
          val: String(checkedIn.length),
          fg: kind === 'absent' ? c.textMuted : c.success,
        },
        { label: 'LEFT', val: String(leftCount), fg: leftCount > 0 ? c.warning : c.textMuted },
        {
          label: 'ROSTER',
          val: String(store.employees.length),
          fg: c.textPrimary,
        },
      ];

  /* ----------------------------------------------------- verification -- */

  const rssis = checkedIn.map(r => r.checkInRssi).filter((n): n is number => n !== null);
  const confirmations = records?.reduce((n, r) => n + r.events.length, 0) ?? 0;

  const verifyRows: { label: string; val: string; mono: boolean }[] = isEmployee
    ? [
        {
          label: 'Recorded by',
          val: stored?.hostId ?? 'not recorded',
          mono: stored !== null,
        },
        { label: 'Method', val: stored ? 'BLE manufacturerData' : '—', mono: false },
        // The reply payload carries no signal reading and no confirmation
        // count, so this phone genuinely does not hold them.
        { label: 'Signal at match', val: 'not delivered', mono: false },
        { label: 'Confirmations', val: 'not delivered', mono: false },
      ]
    : [
        {
          label: 'Recorded by',
          val: checkedIn[0]?.hostId ?? store.settings.hostId,
          mono: true,
        },
        { label: 'Method', val: kind === 'absent' ? '—' : 'BLE manufacturerData', mono: false },
        {
          label: 'Signal at match',
          val:
            rssis.length === 0
              ? '—'
              : rssis.length === 1
              ? rssis[0] + ' dBm'
              : Math.max(...rssis) + ' to ' + Math.min(...rssis) + ' dBm',
          mono: rssis.length > 0,
        },
        {
          label: 'Confirmations',
          val: confirmations === 0 ? 'none' : confirmations + ' events',
          mono: false,
        },
      ];

  /* ---------------------------------------------------------- timeline -- */

  const trail = useMemo(() => {
    if (isEmployee) {
      if (!stored) return [];
      const base = parseDate(stored.date).getTime();
      const events: { title: string; detail: string; at: number; fg: string; soft: string }[] = [];
      if (stored.checkInMinutes !== null) {
        events.push({
          title: 'Checked in',
          detail: 'Recorded by ' + stored.hostId,
          at: base + stored.checkInMinutes * 60_000,
          fg: c.success,
          soft: c.successSoft,
        });
      }
      if (stored.checkOutMinutes !== null) {
        events.push({
          title: 'Marked as left',
          detail: 'The Host stopped seeing this device',
          at: base + stored.checkOutMinutes * 60_000,
          fg: c.warning,
          soft: c.warningSoft,
        });
      }
      events.push({
        title: 'Delivered to this phone',
        detail: 'Written over the reply channel',
        at: stored.receivedAt,
        fg: c.primaryTint,
        soft: c.primarySoft,
      });
      return events.sort((a, b) => b.at - a.at);
    }

    // HOST: the append-only audit trail, flattened across everyone that day.
    return (records ?? [])
      .flatMap(r =>
        r.events.map(e => ({
          title: (EVENT_TITLE[e.type] ?? e.type) + ' · ' + r.employeeName,
          detail:
            e.rssi === null || e.rssi === undefined
              ? 'No signal reading on this event'
              : 'Signal ' + e.rssi + ' dBm at the moment of the event',
          at: e.at,
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
        })),
      )
      .sort((a, b) => b.at - a.at);
  }, [isEmployee, stored, records, c]);

  const card = { backgroundColor: c.surface, borderColor: c.border };

  return (
    <Screen>
      <Pressable
        onPress={() => navigation.goBack()}
        style={({ pressed }) => [
          styles.back,
          card,
          t.neu,
          pressed ? { transform: [{ scale: 0.93 }] } : null,
        ]}>
        <Icon name="chevron-left" size={18} color={c.textPrimary} />
      </Pressable>

      {/* ---------------------------------------------------------- head -- */}
      <Txt style={[styles.eyebrowDay, { color: c.textMuted }]}>{WEEKDAYS[day.getDay()]}</Txt>
      <Txt style={[styles.title, { color: c.textPrimary }]}>{title}</Txt>

      <View style={[styles.badge, { backgroundColor: palette.soft, borderColor: palette.bd }]}>
        <View style={[styles.dot6, { backgroundColor: palette.fg }]} />
        <Txt style={[styles.badgeText, { color: palette.fg }]}>{badge}</Txt>
      </View>

      {/* ---------------------------------------------------------- trio -- */}
      <View style={styles.trio}>
        {cells.map(cell => (
          <View key={cell.label} style={[styles.tile, card, t.neu]}>
            <Txt style={[styles.tileLabel, { color: c.textMuted }]}>{cell.label}</Txt>
            <Txt style={[styles.tileValue, numeric, { color: cell.fg }]}>{cell.val}</Txt>
          </View>
        ))}
      </View>

      {/* -------------------------------------------------- verification -- */}
      <Txt style={[styles.eyebrow, { color: c.textMuted }]}>HOW THIS WAS VERIFIED</Txt>
      <View style={[styles.listCard, card, t.shadow(1)]}>
        {verifyRows.map(r => (
          <View key={r.label} style={[styles.verifyRow, { borderTopColor: c.border }]}>
            <Txt style={[styles.verifyLabel, { color: c.textMuted }]}>{r.label}</Txt>
            <Txt mono={r.mono} style={[styles.verifyVal, { color: c.textSecondary }]}>
              {r.val}
            </Txt>
          </View>
        ))}
      </View>

      {/* ------------------------------------------------------- events -- */}
      <Txt style={[styles.eyebrow, styles.eyebrowEvents, { color: c.textMuted }]}>EVENTS</Txt>

      {trail.length === 0 ? (
        <View style={[styles.note, t.neuIn(c)]}>
          <Icon name="info" size={16} color={c.textMuted} />
          <Txt style={[styles.noteText, { color: c.textMuted }]}>
            {isEmployee
              ? 'No device was detected on ' + title + ', so the Host wrote no record for this day.'
              : 'Nothing was detected on ' + title + ', so this device wrote no record for that day.'}
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
                  <Txt numberOfLines={1} style={[styles.trailTitle, { color: c.textPrimary }]}>
                    {e.title}
                  </Txt>
                  <Txt style={[styles.trailTime, numeric, { color: c.textSecondary }]}>
                    {formatClockTime(e.at)}
                  </Txt>
                </View>
                <Txt style={[styles.trailDetail, { color: c.textMuted }]}>{e.detail}</Txt>
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },

  eyebrowDay: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 20,
  },
  title: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 28,
    letterSpacing: -0.8,
    lineHeight: 36,
    marginTop: 4,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    height: 26,
    marginTop: 12,
    paddingHorizontal: 11,
  },
  dot6: { borderRadius: 999, height: 6, width: 6 },
  badgeText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10.5, letterSpacing: 0.7 },

  trio: { flexDirection: 'row', gap: 9, marginTop: 22 },
  tile: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 14,
  },
  tileLabel: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9.5, letterSpacing: 0.8 },
  tileValue: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 18, marginTop: 7 },

  eyebrow: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 26,
  },
  eyebrowEvents: { marginBottom: 12 },

  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  verifyRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  verifyLabel: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13 },
  verifyVal: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 12.5 },

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
  railDot: {
    // The design's 4px halo. RN has no spread-only shadow, so the ring is a
    // border on a larger dot — same 19px footprint, same 11px core.
    borderRadius: 999,
    borderWidth: 4,
    height: 19,
    marginTop: 3,
    width: 19,
  },
  railLine: { flex: 1, marginTop: 4, width: 1.5 },
  trailHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  trailTitle: { flex: 1, fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 14 },
  trailTime: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 13 },
  trailDetail: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, marginTop: 2 },
});
