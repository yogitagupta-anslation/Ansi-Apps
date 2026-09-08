/**
 * HistoryScreen.tsx — v3 "Orbit"
 * -----------------------------------------------------------------------------
 * Summary first, detail last: the month's rate as a ring, the weekly trend, the
 * totals, the calendar, then the day-by-day list that drills into one day.
 *
 * ONE LAYOUT, TWO SOURCES. Both roles get exactly this chrome; only what fills
 * it differs, because the two devices genuinely hold different things:
 *
 *   EMPLOYEE  their own days, delivered by a Host over the reply channel. The
 *             rate is their attendance; a calendar cell is their status; a row
 *             is their span and hours.
 *
 *   HOST      the company-wide day summaries it recorded itself. The rate is
 *             attendance across the roster; a cell is the share present that
 *             day; a row is how many attended.
 *
 * An employee device holds only its own delivered status and must never see,
 * let alone export, everyone else's attendance — so the export panel is gated
 * on the role here, and ReportExportService asserts the role again before it
 * reads anything.
 *
 * WHAT THE MOCK ASKED FOR THAT THIS APP CANNOT SAY
 * ---------------------------------------------------------------------------
 * The mock's breakdown and totals both count "Late — after 09:30". Nothing in
 * this system defines when a day is supposed to start: a Host records a
 * check-in whenever it first sees someone. Printing a lateness count would
 * enforce a rule nobody set, so that slot carries DAYS NOT REPORTED instead —
 * the distinction this app genuinely cares about, since a day with no delivery
 * is silence, not an absence.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Path } from 'react-native-svg';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { AttendanceDaySummary } from '../attendance/attendanceTypes';
import { AttendanceReports } from '../components/AttendanceReports';
import { Icon } from '../components/Icon';
import { Screen, Txt } from '../components/ui';
import { useAppStore } from '../state/appStore';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** Monday-first column heads, matching the grid build below. */
const CAL_HEAD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** The approved ring: 104 outer with an 80 core, so stroke 12 and r 46. */
const RING = 104;
const RING_STROKE = 12;
const RING_R = (RING - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;

/** Trend chart geometry, in the design's 320x116 viewBox. */
const CH = { x0: 20, x1: 300, yTop: 20, yBottom: 100 };

type Kind = 'present' | 'left' | 'absent' | 'none';

/** One day of the shown month, whichever source produced it. */
interface DayModel {
  date: string;
  day: number;
  weekday: string;
  kind: Kind;
  status: string;
  span: string;
  value: string;
  /** Minutes since midnight, employee only. Feeds the average check-in. */
  inMinutes: number | null;
  /** Minutes worked, employee only. Feeds the average working hours. */
  workedMinutes: number | null;
  /** Attendance share for the day, 0..1. Feeds the host rate and trend. */
  share: number;
}

function monthKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function minutesToClock(mins: number | null): string | null {
  if (mins === null) return null;
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function hoursLabel(mins: number): string {
  return Math.floor(mins / 60) + 'h ' + String(mins % 60).padStart(2, '0') + 'm';
}

export function HistoryScreen() {
  const t = useTheme();
  const c = t.colors;
  /**
   * This screen is BOTH an Employee tab root and a pushed screen in the Host's
   * stacks. Only the pushed case has somewhere to go back to, so the arrow is
   * conditional — a dead back button on a tab root is worse than none.
   */
  const navigation = useNavigation<{
    canGoBack: () => boolean;
    goBack: () => void;
    navigate: (screen: string, params?: object) => void;
  }>();
  /**
   * canGoBack() walks the whole navigation tree, so on the employee's History
   * TAB it answers true — the hub is behind the app. The route name is the
   * honest signal: 'HistoryMain' is the employee's tab root, 'History' is the
   * copy the Host stacks push.
   */
  const route = useRoute<{
    key: string;
    name: string;
    params?: { openExport?: boolean };
  }>();
  const canGoBack = route.name === 'History' && navigation.canGoBack();
  const store = useAppStore();
  const isEmployee = store.settings.role === 'EMPLOYEE';

  const [summaries, setSummaries] = useState<AttendanceDaySummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Opened straight from an Export tap, so the panel is already unfolded.
  const [showExport, setShowExport] = useState(() => route.params?.openExport === true);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const load = useCallback(async () => {
    if (isEmployee) return;
    setSummaries(await store.attendanceManager.getAttendanceHistory(365));
  }, [store.attendanceManager, isEmployee]);

  useEffect(() => {
    void load();
    // Reload when today's records change so a fresh check-in appears here too.
  }, [load, store.todayRecords.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const thisMonth = monthKey(new Date());
  const shownMonth = monthKey(month);
  const atCurrentMonth = shownMonth >= thisMonth;

  /* ---------------------------------------------------------- the month -- */

  const days = useMemo<DayModel[]>(() => {
    if (isEmployee) {
      return store.employeeHistory
        .filter(d => d.date.startsWith(shownMonth))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(d => {
          const inAt = minutesToClock(d.checkInMinutes);
          const outAt = minutesToClock(d.checkOutMinutes);
          const worked =
            d.checkInMinutes !== null && d.checkOutMinutes !== null
              ? d.checkOutMinutes - d.checkInMinutes
              : null;
          const date = parseDate(d.date);
          const kind: Kind =
            d.status === 'PRESENT' ? 'present' : d.status === 'LEFT' ? 'left' : 'absent';
          return {
            date: d.date,
            day: date.getDate(),
            weekday: WEEKDAYS[date.getDay()],
            kind,
            status: kind === 'left' ? 'CHECKED OUT' : d.status,
            span: inAt ? inAt + ' → ' + (outAt ?? 'now') : 'no times delivered',
            value: worked === null ? '—' : hoursLabel(worked),
            inMinutes: d.checkInMinutes,
            workedMinutes: worked,
            share: kind === 'absent' ? 0 : 1,
          };
        });
    }

    return (summaries ?? [])
      .filter(d => d.date.startsWith(shownMonth))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => {
        const date = parseDate(d.date);
        const share = d.totalEmployees > 0 ? d.presentCount / d.totalEmployees : 0;
        return {
          date: d.date,
          day: date.getDate(),
          weekday: WEEKDAYS[date.getDay()],
          // A host day is "present" when most of the roster turned up, "left"
          // when some did, and "absent" only when genuinely nobody did.
          kind: (share >= 0.75 ? 'present' : share > 0 ? 'left' : 'absent') as Kind,
          status: d.presentCount + ' OF ' + d.totalEmployees,
          span: d.leftCount > 0 ? d.leftCount + ' left early' : 'no early leavers',
          value: String(d.presentCount),
          inMinutes: null,
          workedMinutes: null,
          share,
        };
      });
  }, [isEmployee, store.employeeHistory, summaries, shownMonth]);

  const byDay = useMemo(() => new Map(days.map(d => [d.day, d])), [days]);

  /* ----------------------------------------------------------- the ring -- */

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  /** Today's headcount — see hostSlots for why the month has to borrow it. */
  const rosterSize = store.employees.length;

  const totals = useMemo(() => {
    const present = days.filter(d => d.kind === 'present').length;
    const left = days.filter(d => d.kind === 'left').length;
    const absent = days.filter(d => d.kind === 'absent').length;
    const recorded = days.length;
    const attended = present + left;

    const withIn = days.filter(d => d.inMinutes !== null);
    const withWork = days.filter(d => d.workedMinutes !== null);

    return {
      present,
      left,
      absent,
      recorded,
      attended,
      notReported: Math.max(0, daysInMonth - recorded),
      /** null, not zero, when there is no evidence either way. */
      rate: recorded === 0 ? null : attended / recorded,
      avgIn:
        withIn.length === 0
          ? null
          : Math.round(withIn.reduce((n, d) => n + (d.inMinutes ?? 0), 0) / withIn.length),
      avgWorked:
        withWork.length === 0
          ? null
          : Math.round(
              withWork.reduce((n, d) => n + (d.workedMinutes ?? 0), 0) / withWork.length,
            ),
      hostAttendances: days.reduce((n, d) => n + Number(d.value || 0), 0),
      hostLeft: (summaries ?? [])
        .filter(d => d.date.startsWith(shownMonth))
        .reduce((n, d) => n + d.leftCount, 0),
      /**
       * Roster-slots for the month.
       *
       * getDaySummaries cannot supply this: it derives a day from attendance
       * records alone and returns totalEmployees: 0, because nothing snapshots
       * how many people were registered on a past date. So the denominator is
       * built from the roster as it stands NOW — recorded days x current
       * headcount — which is an approximation, and the ring's caption says
       * "of N registered" rather than implying a historical figure.
       *
       * The alternative was a permanent "—" on every host month, which reads
       * as broken rather than as honest.
       */
      hostSlots:
        (summaries ?? []).filter(d => d.date.startsWith(shownMonth)).length *
        rosterSize,
      hostBest: days.reduce((best, d) => Math.max(best, Number(d.value || 0)), 0),
    };
  }, [days, daysInMonth, summaries, shownMonth, rosterSize]);

  /**
   * The host's rate is attendances over roster-slots, not days over days — one
   * day where 2 of 20 turned up is not a 100% day just because it was recorded.
   */
  const ratePct =
    totals.rate === null
      ? null
      : isEmployee
      ? Math.round(totals.rate * 100)
      : totals.hostSlots === 0
      ? null
      : Math.round((totals.hostAttendances / totals.hostSlots) * 100);

  /* ---------------------------------------------------------- the trend -- */

  /**
   * Weekly rate across the month. Weeks the Host never reported are dropped
   * rather than plotted at zero — a flat line to the floor would read as "we
   * had nobody in", which is not what an unreported week means.
   */
  const trend = useMemo(() => {
    const weeks: { label: string; rate: number }[] = [];
    const weekCount = Math.ceil((daysInMonth + ((new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7)) / 7);

    for (let w = 0; w < weekCount; w++) {
      const inWeek = days.filter(d => {
        const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
        return Math.floor((d.day - 1 + offset) / 7) === w;
      });
      if (inWeek.length === 0) continue;
      const rate = inWeek.reduce((n, d) => n + d.share, 0) / inWeek.length;
      weeks.push({ label: 'W' + (w + 1), rate });
    }
    return weeks;
  }, [days, daysInMonth, month]);

  const trendPoints = useMemo(() => {
    if (trend.length === 0) return [];
    const step = trend.length === 1 ? 0 : (CH.x1 - CH.x0) / (trend.length - 1);
    return trend.map((w, i) => ({
      x: CH.x0 + step * i,
      y: CH.yBottom - (CH.yBottom - CH.yTop) * Math.max(0, Math.min(1, w.rate)),
      rate: w.rate,
      label: w.label,
    }));
  }, [trend]);

  /* -------------------------------------------------------- the calendar -- */

  const calendar = useMemo(() => {
    // Monday-first: shift Sunday (0) to the end of the week.
    const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const cells: (DayModel | number | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(byDay.get(d) ?? d);
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (DayModel | number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [month, daysInMonth, byDay]);

  /* ----------------------------------------------------------- palettes -- */

  const tone = useCallback(
    (kind: Kind) =>
      kind === 'present'
        ? { fg: c.success, soft: c.successSoft, bd: c.successBorder }
        : kind === 'left'
        ? { fg: c.warning, soft: c.warningSoft, bd: c.warning }
        : kind === 'absent'
        ? { fg: c.textMuted, soft: c.surfaceMuted, bd: c.borderStrong }
        : { fg: c.textMuted, soft: 'transparent', bd: 'transparent' },
    [c],
  );

  const breakdown = isEmployee
    ? [
        { label: 'Present', n: totals.present, fg: c.success },
        { label: 'Checked out', n: totals.left, fg: c.warning },
        { label: 'Absent', n: totals.absent, fg: c.textMuted },
        { label: 'Not reported', n: totals.notReported, fg: c.textMuted },
      ]
    : [
        { label: 'Attendances', n: totals.hostAttendances, fg: c.success },
        { label: 'Left early', n: totals.hostLeft, fg: c.warning },
        { label: 'Days recorded', n: totals.recorded, fg: c.textMuted },
        { label: 'Days not recorded', n: totals.notReported, fg: c.textMuted },
      ];

  const monthRows = isEmployee
    ? [
        { label: 'Days present', val: String(totals.attended), fg: c.success },
        { label: 'Days absent', val: String(totals.absent), fg: c.textMuted },
        { label: 'Days not reported', val: String(totals.notReported), fg: c.textMuted },
        { label: 'Days checked out', val: String(totals.left), fg: c.warning },
        {
          label: 'Average check-in',
          val: totals.avgIn === null ? '—' : (minutesToClock(totals.avgIn) as string),
          fg: c.textSecondary,
        },
        {
          label: 'Average working hours',
          val: totals.avgWorked === null ? '—' : hoursLabel(totals.avgWorked),
          fg: c.textSecondary,
        },
      ]
    : [
        { label: 'Days recorded', val: String(totals.recorded), fg: c.textSecondary },
        { label: 'Total attendances', val: String(totals.hostAttendances), fg: c.success },
        {
          label: 'Average present per day',
          val:
            totals.recorded === 0
              ? '—'
              : (totals.hostAttendances / totals.recorded).toFixed(1),
          fg: c.textSecondary,
        },
        { label: 'Best day', val: totals.recorded === 0 ? '—' : String(totals.hostBest), fg: c.success },
        { label: 'Left early', val: String(totals.hostLeft), fg: c.warning },
        { label: 'Registered employees', val: String(store.employees.length), fg: c.textSecondary },
      ];

  const legend = isEmployee
    ? [
        { label: 'Present', kind: 'present' as Kind },
        { label: 'Checked out', kind: 'left' as Kind },
        { label: 'Absent', kind: 'absent' as Kind },
      ]
    : [
        { label: 'Most present', kind: 'present' as Kind },
        { label: 'Some present', kind: 'left' as Kind },
        { label: 'Nobody present', kind: 'absent' as Kind },
      ];

  const openDay = useCallback(
    (date: string) => navigation.navigate('DayDetail', { date }),
    [navigation],
  );

  const card = { backgroundColor: c.surface, borderColor: c.border };
  const prevMonthName = MONTHS[(month.getMonth() + 11) % 12];

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />
      }>
      {/* ---------------------------------------------------------- title -- */}
      <View style={styles.titleRow}>
        {canGoBack ? (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Icon name="chevron-left" size={22} color={c.textSecondary} />
          </Pressable>
        ) : null}
        <Txt style={[styles.title, { color: c.textPrimary }]}>History</Txt>
      </View>

      {/* ------------------------------------------------- month navigator -- */}
      <View style={[styles.monthBar, card, t.shadow(1)]}>
        <Pressable
          hitSlop={6}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          style={({ pressed }) => [
            styles.monthBtn,
            pressed ? { backgroundColor: c.surfaceMuted } : null,
          ]}>
          <Icon name="chevron-left" size={17} color={c.textSecondary} />
        </Pressable>

        <Txt style={[styles.monthLabel, { color: c.textPrimary }]}>
          {MONTHS[month.getMonth()] + ' ' + month.getFullYear()}
        </Txt>

        <Pressable
          hitSlop={6}
          disabled={atCurrentMonth}
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          style={({ pressed }) => [
            styles.monthBtn,
            pressed && !atCurrentMonth ? { backgroundColor: c.surfaceMuted } : null,
          ]}>
          <Icon
            name="chevron-right"
            size={17}
            color={atCurrentMonth ? c.textMuted : c.textSecondary}
          />
        </Pressable>
      </View>

      {days.length === 0 ? (
        /* ------------------------------------------------------- empty -- */
        <View style={styles.empty}>
          <Image
            source={require('../assets/no-records-month.png')}
            style={styles.emptyArt}
            resizeMode="contain"
          />
          <Txt style={[styles.emptyTitle, { color: c.textPrimary }]}>
            {'Nothing recorded in ' + MONTHS[month.getMonth()]}
          </Txt>
          <Txt style={[styles.emptyBody, { color: c.textMuted }]}>
            {isEmployee
              ? 'Attendance is written by the Host device. Pick another month, or check that your phone has synced.'
              : 'Attendance is written by this device while it scans. Pick another month, or check that scanning was running.'}
          </Txt>
          <Pressable
            onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            style={[styles.emptyBtn, { backgroundColor: c.surface, borderColor: c.borderStrong }, t.neu]}>
            <Icon name="chevron-left" size={15} color={c.textSecondary} />
            <Txt style={[styles.emptyBtnLabel, { color: c.textSecondary }]}>
              {'View ' + prevMonthName}
            </Txt>
          </Pressable>
        </View>
      ) : (
        <>
          {/* -------------------------------------------------- rate card -- */}
          <View style={[styles.rateCard, card, t.neu]}>
            <Txt style={[styles.eyebrow, { color: c.textMuted }]}>ATTENDANCE RATE</Txt>

            <View style={styles.rateRow}>
              <View style={styles.ringWrap}>
                <Svg width={RING} height={RING}>
                  <Circle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={RING_R}
                    stroke={c.surfaceMuted}
                    strokeWidth={RING_STROKE}
                    fill="none"
                  />
                  {ratePct !== null ? (
                    <Circle
                      cx={RING / 2}
                      cy={RING / 2}
                      r={RING_R}
                      stroke={c.success}
                      strokeWidth={RING_STROKE}
                      strokeLinecap="round"
                      fill="none"
                      strokeDasharray={RING_C + ' ' + RING_C}
                      strokeDashoffset={RING_C * (1 - ratePct / 100)}
                      // Start the arc at 12 o'clock, like the design's conic.
                      transform={'rotate(-90 ' + RING / 2 + ' ' + RING / 2 + ')'}
                    />
                  ) : null}
                </Svg>
                <View style={[styles.ringCore, { backgroundColor: c.surface }, t.neuIn(c)]}>
                  <Txt style={[styles.ringPct, numeric, { color: c.textPrimary }]}>
                    {ratePct === null ? '—' : ratePct + '%'}
                  </Txt>
                  <Txt style={[styles.ringCap, { color: c.textMuted }]}>
                    {isEmployee
                      ? 'OF ' + totals.recorded + ' DAYS'
                      : 'OF ' + rosterSize + ' REGISTERED'}
                  </Txt>
                </View>
              </View>

              <View style={styles.breakdown}>
                {breakdown.map(b => (
                  <View key={b.label} style={styles.breakRow}>
                    <View style={[styles.swatch, { backgroundColor: b.fg }]} />
                    <Txt style={[styles.breakLabel, { color: c.textSecondary }]}>{b.label}</Txt>
                    <Txt style={[styles.breakN, numeric, { color: c.textPrimary }]}>{b.n}</Txt>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* ------------------------------------------------------ trend -- */}
          <Txt style={[styles.heading, { color: c.textPrimary }]}>Attendance trend</Txt>
          <Txt style={[styles.subheading, { color: c.textMuted }]}>
            {'Weekly rate across ' + MONTHS[month.getMonth()]}
          </Txt>

          <View style={[styles.trendCard, card, t.shadow(1)]}>
            <Svg viewBox="0 0 320 116" width="100%" height={116}>
              <Line x1={14} y1={20} x2={306} y2={20} stroke={c.border} strokeWidth={1} strokeDasharray="3 5" />
              <Line x1={14} y1={60} x2={306} y2={60} stroke={c.border} strokeWidth={1} strokeDasharray="3 5" />
              <Line x1={14} y1={100} x2={306} y2={100} stroke={c.border} strokeWidth={1} />

              {trendPoints.length > 1 ? (
                <>
                  <Path
                    d={
                      'M' +
                      trendPoints.map(p => p.x + ' ' + p.y).join(' L') +
                      ' L' + trendPoints[trendPoints.length - 1].x + ' 100' +
                      ' L' + trendPoints[0].x + ' 100 Z'
                    }
                    fill={c.primarySoft}
                    opacity={0.85}
                  />
                  <Polyline
                    points={trendPoints.map(p => p.x + ',' + p.y).join(' ')}
                    fill="none"
                    stroke={c.primaryTint}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : null}

              {trendPoints.map((p, i) => {
                const last = i === trendPoints.length - 1;
                return (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={last ? 5.5 : 4}
                    fill={last ? c.success : c.surface}
                    stroke={last ? c.surface : c.primaryTint}
                    strokeWidth={2.5}
                  />
                );
              })}
            </Svg>

            <View style={styles.axisRow}>
              {trendPoints.map((p, i) => (
                <Txt
                  key={p.label}
                  style={[
                    styles.axisLabel,
                    { color: i === trendPoints.length - 1 ? c.success : c.textMuted },
                  ]}>
                  {p.label}
                </Txt>
              ))}
            </View>
          </View>

          {/* ------------------------------------------------ month totals -- */}
          <Txt style={[styles.heading, { color: c.textPrimary }]}>This month</Txt>
          <View style={[styles.listCard, card, t.shadow(1)]}>
            {monthRows.map(r => (
              <View key={r.label} style={[styles.totalRow, { borderTopColor: c.border }]}>
                <Txt style={[styles.totalLabel, { color: c.textSecondary }]}>{r.label}</Txt>
                <Txt style={[styles.totalVal, numeric, { color: r.fg }]}>{r.val}</Txt>
              </View>
            ))}
          </View>

          {/* --------------------------------------------------- calendar -- */}
          <Txt style={[styles.heading, { color: c.textPrimary }]}>Attendance calendar</Txt>
          <View style={[styles.calCard, card, t.shadow(1)]}>
            <View style={styles.calRow}>
              {CAL_HEAD.map((h, i) => (
                <Txt key={i} style={[styles.calHead, { color: c.textMuted }]}>
                  {h}
                </Txt>
              ))}
            </View>

            {calendar.map((row, ri) => (
              <View key={ri} style={[styles.calRow, { marginTop: 5 }]}>
                {row.map((cell, ci) => {
                  if (cell === null) {
                    return <View key={ci} style={styles.calCell} />;
                  }
                  if (typeof cell === 'number') {
                    // A day in the month the source never reported on.
                    return (
                      <View key={ci} style={[styles.calCell, styles.calCellBox]}>
                        <Txt style={[styles.calNum, numeric, { color: c.textMuted }]}>{cell}</Txt>
                      </View>
                    );
                  }
                  const p = tone(cell.kind);
                  return (
                    <Pressable
                      key={ci}
                      onPress={() => openDay(cell.date)}
                      style={({ pressed }) => [
                        styles.calCell,
                        styles.calCellBox,
                        { backgroundColor: p.soft, borderColor: p.bd },
                        pressed ? { opacity: 0.65 } : null,
                      ]}>
                      <Txt style={[styles.calNum, numeric, { color: p.fg }]}>{cell.day}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={[styles.legend, { borderTopColor: c.border }]}>
              {legend.map(l => {
                const p = tone(l.kind);
                return (
                  <View key={l.label} style={styles.legendItem}>
                    <View
                      style={[styles.legendSwatch, { backgroundColor: p.soft, borderColor: p.bd }]}
                    />
                    <Txt style={[styles.legendLabel, { color: c.textMuted }]}>{l.label}</Txt>
                  </View>
                );
              })}
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, { borderColor: c.border }]} />
                <Txt style={[styles.legendLabel, { color: c.textMuted }]}>No record</Txt>
              </View>
            </View>
          </View>

          {/* ---------------------------------------------- daily records -- */}
          <View style={styles.recordsHead}>
            <Txt style={[styles.heading, styles.recordsTitle, { color: c.textPrimary }]}>
              Daily records
            </Txt>
            {/* Export is HOST-only: this device is the only one that holds
                everyone's attendance, and an employee phone must never emit a
                report about anyone but itself. */}
            {!isEmployee ? (
              <Pressable
                onPress={() => setShowExport(v => !v)}
                style={[
                  styles.exportChip,
                  { backgroundColor: c.primarySoft, borderColor: c.primaryBorderSoft },
                ]}>
                <Icon name="download" size={13} color={c.primaryTint} />
                <Txt style={[styles.exportLabel, { color: c.primaryTint }]}>Export</Txt>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.listCard, styles.recordsCard, card, t.shadow(1)]}>
            {days.map(d => {
              const p = tone(d.kind);
              return (
                <Pressable
                  key={d.date}
                  onPress={() => openDay(d.date)}
                  style={({ pressed }) => [
                    styles.dayRow,
                    { borderTopColor: c.border },
                    pressed ? { backgroundColor: c.surfaceMuted } : null,
                  ]}>
                  <View style={styles.dateCol}>
                    <Txt style={[styles.dayNum, numeric, { color: c.textPrimary }]}>
                      {String(d.day).padStart(2, '0')}
                    </Txt>
                    <Txt style={[styles.dayWd, { color: c.textMuted }]}>{d.weekday}</Txt>
                  </View>

                  <View style={[styles.vDivider, { backgroundColor: c.border }]} />

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={[styles.statusBadge, { backgroundColor: p.soft }]}>
                      <Txt style={[styles.statusText, { color: p.fg }]}>{d.status}</Txt>
                    </View>
                    <Txt mono style={[styles.daySpan, { color: c.textMuted }]}>
                      {d.span}
                    </Txt>
                  </View>

                  <Txt style={[styles.dayHrs, numeric, { color: p.fg }]}>{d.value}</Txt>
                  <Icon name="chevron-right" size={15} color={c.textMuted} />
                </Pressable>
              );
            })}
          </View>

          {!isEmployee && showExport ? (
            <View style={{ marginTop: 14 }}>
              <AttendanceReports />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  backBtn: { marginLeft: -6 },
  title: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 26,
    letterSpacing: -0.7,
    lineHeight: 34,
  },

  monthBar: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 46,
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 6,
  },
  monthBtn: {
    alignItems: 'center',
    borderRadius: 11,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  monthLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14.5, letterSpacing: -0.2 },

  empty: { alignItems: 'center', paddingBottom: 8, paddingHorizontal: 16, paddingTop: 34 },
  emptyArt: { height: 150, width: 150 },
  emptyTitle: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 17,
    letterSpacing: -0.3,
    lineHeight: 23,
    marginTop: 20,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    maxWidth: 254,
    textAlign: 'center',
  },
  emptyBtn: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    height: 42,
    marginTop: 22,
    paddingHorizontal: 18,
  },
  emptyBtnLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13.5 },

  rateCard: {
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  eyebrow: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 10, letterSpacing: 1 },
  rateRow: { alignItems: 'center', flexDirection: 'row', gap: 20, marginTop: 14 },
  ringWrap: { alignItems: 'center', height: RING, justifyContent: 'center', width: RING },
  ringCore: {
    alignItems: 'center',
    borderRadius: 999,
    height: 80,
    justifyContent: 'center',
    position: 'absolute',
    width: 80,
  },
  ringPct: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 26,
    letterSpacing: -1,
    lineHeight: 32,
  },
  ringCap: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 8.5,
    letterSpacing: 0.8,
    marginTop: 1,
  },
  breakdown: { flex: 1, gap: 11 },
  breakRow: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  swatch: { borderRadius: 3, height: 8, width: 8 },
  breakLabel: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12.5 },
  breakN: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 15 },

  heading: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, marginTop: 26 },
  subheading: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, marginTop: 2 },

  trendCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  axisRow: { flexDirection: 'row', marginTop: 4 },
  axisLabel: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 10,
    textAlign: 'center',
  },

  listCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    overflow: 'hidden',
  },
  totalRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  totalLabel: { flex: 1, fontFamily: 'PlusJakartaSans_400Regular', fontSize: 13.5 },
  totalVal: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14.5 },

  calCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  calRow: { flexDirection: 'row', gap: 5 },
  calHead: {
    flex: 1,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 9.5,
    letterSpacing: 0.5,
    paddingBottom: 4,
    textAlign: 'center',
  },
  calCell: { alignItems: 'center', aspectRatio: 1, flex: 1, justifyContent: 'center' },
  calCellBox: { borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent' },
  calNum: { fontFamily: 'SpaceGrotesk_600SemiBold', fontSize: 11.5 },

  legend: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 14,
    paddingTop: 13,
  },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  legendSwatch: { borderRadius: 3, borderWidth: 1.5, height: 9, width: 9 },
  legendLabel: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 10.5 },

  recordsHead: { alignItems: 'center', flexDirection: 'row', marginTop: 26 },
  recordsTitle: { flex: 1, marginTop: 0 },
  exportChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    height: 32,
    paddingHorizontal: 12,
  },
  exportLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 12 },
  recordsCard: { marginTop: 12 },

  dayRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  dateCol: { alignItems: 'center', width: 40 },
  dayNum: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 17,
    letterSpacing: -0.5,
    lineHeight: 22,
  },
  dayWd: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 9.5, letterSpacing: 0.6 },
  vDivider: { height: 30, width: StyleSheet.hairlineWidth },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    height: 21,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  statusText: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 9.5, letterSpacing: 0.7 },
  daySpan: { fontSize: 11, marginTop: 5 },
  dayHrs: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 14 },
});
