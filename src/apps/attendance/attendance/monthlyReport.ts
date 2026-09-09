/**
 * monthlyReport.ts
 * -----------------------------------------------------------------------------
 * Builds a month's attendance report from the records ALREADY stored on the
 * Host. Pure computation: it reads, it never writes, and it never touches BLE.
 *
 * WHAT COUNTS AS A WORKING DAY — read this before changing any number here.
 *
 * The app has no holiday calendar and no configured work week, so it cannot
 * know that a given Sunday was a day off rather than a day nobody came in.
 * Rather than invent one, a WORKING DAY is defined as a calendar day in the
 * month on which this Host recorded at least one attendance record.
 *
 *   - A day the office ran and people were detected  -> working day.
 *   - A weekend, holiday, or a day the Host was off  -> no records -> excluded.
 *
 * This errs deliberately toward NOT marking people absent. Counting every
 * calendar day would brand everyone absent on Sundays; assuming Mon-Fri would
 * invent a schedule nobody configured. The one inaccuracy it accepts is a
 * working day where literally nobody was detected, which is indistinguishable
 * from a closed day using only this data — and treating it as closed is the
 * option that cannot unfairly penalise an employee.
 *
 * An employee is also never marked absent for days BEFORE they were registered.
 * Those cells report NOT_APPLICABLE, because there was no expectation to meet.
 * -----------------------------------------------------------------------------
 */

import type { AttendanceRecord, AttendanceStatus } from './attendanceTypes';
import type { Employee } from '../employees/employeeTypes';

/** What a single employee-day cell can be in a monthly report. */
export type DayCellStatus = AttendanceStatus | 'NOT_APPLICABLE';

export interface EmployeeDay {
  /** YYYY-MM-DD. */
  date: string;
  status: DayCellStatus;
  record: AttendanceRecord | null;
  /**
   * Observed presence span for the day: lastSeenTime - checkInTime.
   *
   * Both endpoints are REAL BLE observations. It is deliberately not
   * leftTime - checkInTime: leftTime is `lastSeen + gracePeriod`, i.e. the
   * moment the Host concluded the employee had gone, not a moment anybody was
   * actually seen. Using it would inflate every span by the grace period.
   *
   * null when the employee never checked in that day.
   */
  presenceMs: number | null;
}

export interface EmployeeMonthSummary {
  employeeId: string;
  employeeName: string;
  department?: string;
  present: number;
  left: number;
  absent: number;
  /**
   * Working days this employee could actually attend — excludes days before
   * they were registered. The denominator for their attendance percentage.
   */
  applicableDays: number;
  /**
   * (present + left) / applicableDays * 100, rounded to one decimal.
   *
   * LEFT counts as attendance: the person came in and was recorded. Treating
   * it as a miss would punish someone for leaving the Bluetooth range, which
   * is a proximity fact, not an attendance one.
   */
  attendancePercent: number;
  /** Sum of every day's observed presence span, in ms. */
  totalPresenceMs: number;
  /** totalPresenceMs / days attended. 0 when nothing was attended. */
  averagePresenceMs: number;
  /** Most recent check-in in the month, or null. */
  lastCheckIn: number | null;
  /**
   * Most recent LAST-SEEN in the month — the final moment the employee was
   * genuinely detected. Reported as the check-out because it is observed;
   * `lastMarkedLeft` carries the inferred departure separately.
   */
  lastCheckOut: number | null;
  /** Most recent leftTime, i.e. when the grace period elapsed. */
  lastMarkedLeft: number | null;
  days: EmployeeDay[];
}

export interface MonthlyReport {
  /** YYYY-MM. */
  monthKey: string;
  /** e.g. "August 2026". */
  monthLabel: string;
  year: number;
  /** 0-indexed, as JavaScript Date uses. */
  monthIndex: number;
  /** Every calendar day in the month, YYYY-MM-DD. */
  allDates: string[];
  /** Dates with at least one record. See the header note. */
  workingDates: string[];
  employees: EmployeeMonthSummary[];
  totals: { present: number; left: number; absent: number };
  totalEmployees: number;
  workingDays: number;
  /** True when the month holds no records at all. */
  isEmpty: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM for a given year and 0-indexed month. */
export function monthKeyOf(year: number, monthIndex: number): string {
  return year + '-' + pad(monthIndex + 1);
}

export function monthLabelOf(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const index = Number(month) - 1;
  return (MONTH_NAMES[index] ?? month) + ' ' + year;
}

/** Every YYYY-MM-DD in the month, in order. */
function datesInMonth(year: number, monthIndex: number): string[] {
  // Day 0 of the NEXT month is the last day of this one — handles leap years
  // without a table.
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const out: string[] = [];
  for (let day = 1; day <= dayCount; day++) {
    out.push(year + '-' + pad(monthIndex + 1) + '-' + pad(day));
  }
  return out;
}

/** YYYY-MM-DD from a timestamp, in LOCAL time to match how records are keyed. */
export function dateStringOf(timestamp: number): string {
  const d = new Date(timestamp);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * Distinct months that have at least one record, newest first.
 * Drives the month picker: a month with no data is never offered.
 */
export function monthsWithData(records: AttendanceRecord[]): string[] {
  const set = new Set<string>();
  records.forEach(r => {
    if (r.date && r.date.length >= 7) {
      set.add(r.date.slice(0, 7));
    }
  });
  return Array.from(set).sort().reverse();
}

/**
 * The status of one stored record, for REPORTING purposes.
 *
 * Deliberately NOT deriveStatus(): that function answers "what is this person's
 * status right now", which depends on the current clock and a grace period.
 * A historical report must not change every time it is opened, so a finished
 * day is read from the timestamps alone — a record with a leftTime is LEFT, a
 * record with a check-in is PRESENT, and that verdict is stable forever.
 */
function reportStatusOf(record: AttendanceRecord): AttendanceStatus {
  if (record.checkInTime === null) {
    return 'ABSENT';
  }
  return record.leftTime !== null ? 'LEFT' : 'PRESENT';
}

export function buildMonthlyReport(input: {
  monthKey: string;
  /** Every stored record; the function filters to the month itself. */
  records: AttendanceRecord[];
  employees: Employee[];
}): MonthlyReport {
  const { monthKey, records, employees } = input;
  const [yearPart, monthPart] = monthKey.split('-');
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;

  const allDates = datesInMonth(year, monthIndex);
  const monthRecords = records.filter(r => r.date.startsWith(monthKey));

  /**
   * Nothing after today can be a working day. Records cannot exist for the
   * future, so this changes no total — it is an explicit guard so a clock
   * skew or an imported record dated ahead cannot invent working days and
   * mark the whole company absent for them.
   */
  const today = dateStringOf(Date.now());

  // Working days = days this Host actually recorded something. See header.
  const datesWithRecords = new Set(monthRecords.map(r => r.date));
  const workingDates = allDates.filter(d => d <= today && datesWithRecords.has(d));
  // Set, not Array.includes, in the per-employee-per-day loop below: with 30
  // employees x 31 days the linear scan is ~29k comparisons for nothing.
  const workingDateSet = new Set(workingDates);

  // (employeeId -> date -> record) for O(1) lookup per cell.
  const byEmployee = new Map<string, Map<string, AttendanceRecord>>();
  monthRecords.forEach(r => {
    const forEmployee = byEmployee.get(r.employeeId) ?? new Map();
    forEmployee.set(r.date, r);
    byEmployee.set(r.employeeId, forEmployee);
  });

  /**
   * Report on everyone in the registry PLUS anyone who has records this month
   * but has since been removed. Dropping the latter would silently erase
   * attendance that genuinely happened.
   */
  const known = new Map<string, { name: string; department?: string; createdAt: number }>();
  employees.forEach(e => {
    known.set(e.employeeId, {
      name: e.displayName,
      department: e.department,
      createdAt: e.createdAt,
    });
  });
  monthRecords.forEach(r => {
    if (!known.has(r.employeeId)) {
      known.set(r.employeeId, {
        name: r.employeeName || r.employeeId,
        department: undefined,
        // No registry entry, so assume they were eligible all month.
        createdAt: 0,
      });
    }
  });

  const summaries: EmployeeMonthSummary[] = Array.from(known.entries())
    .map(([employeeId, meta]) => {
      const forEmployee = byEmployee.get(employeeId) ?? new Map<string, AttendanceRecord>();
      const registeredOn = meta.createdAt > 0 ? dateStringOf(meta.createdAt) : '';

      let present = 0;
      let left = 0;
      let absent = 0;
      let applicableDays = 0;
      let totalPresenceMs = 0;
      let attendedDays = 0;
      let lastCheckIn: number | null = null;
      let lastCheckOut: number | null = null;
      let lastMarkedLeft: number | null = null;

      const days: EmployeeDay[] = allDates.map(date => {
        const record = forEmployee.get(date) ?? null;

        if (!workingDateSet.has(date)) {
          // Not a working day for anyone — never an absence.
          return { date, status: 'NOT_APPLICABLE' as DayCellStatus, record, presenceMs: null };
        }
        if (registeredOn && date < registeredOn && !record) {
          // Employee did not exist yet and nothing was observed; no expectation
          // to meet. A day that DOES carry a record falls through and is counted:
          // the Host saw them, and an observation outranks a registry date that
          // may simply have been reset by a remove-and-re-add.
          return { date, status: 'NOT_APPLICABLE' as DayCellStatus, record, presenceMs: null };
        }

        applicableDays += 1;

        if (!record) {
          absent += 1;
          return { date, status: 'ABSENT' as DayCellStatus, record: null, presenceMs: null };
        }

        const status = reportStatusOf(record);
        if (status === 'PRESENT') {
          present += 1;
        } else if (status === 'LEFT') {
          left += 1;
        } else {
          absent += 1;
        }

        // Observed span only — see the EmployeeDay.presenceMs note.
        const presenceMs =
          record.checkInTime !== null && record.lastSeenTime !== null
            ? Math.max(0, record.lastSeenTime - record.checkInTime)
            : null;

        if (presenceMs !== null) {
          totalPresenceMs += presenceMs;
          attendedDays += 1;
        }
        // Days are walked in ascending date order, so a later day always wins.
        // Math.max also guards against an out-of-order record.
        if (record.checkInTime !== null) {
          lastCheckIn = lastCheckIn === null ? record.checkInTime : Math.max(lastCheckIn, record.checkInTime);
        }
        if (record.lastSeenTime !== null) {
          lastCheckOut = lastCheckOut === null ? record.lastSeenTime : Math.max(lastCheckOut, record.lastSeenTime);
        }
        if (record.leftTime !== null) {
          lastMarkedLeft = lastMarkedLeft === null ? record.leftTime : Math.max(lastMarkedLeft, record.leftTime);
        }

        return { date, status, record, presenceMs };
      });

      const attended = present + left;
      const attendancePercent =
        applicableDays > 0 ? Math.round((attended / applicableDays) * 1000) / 10 : 0;

      return {
        employeeId,
        employeeName: meta.name,
        department: meta.department,
        present,
        left,
        absent,
        applicableDays,
        attendancePercent,
        totalPresenceMs,
        averagePresenceMs: attendedDays > 0 ? Math.round(totalPresenceMs / attendedDays) : 0,
        lastCheckIn,
        lastCheckOut,
        lastMarkedLeft,
        days,
      };
    })
    // Employee ID order: that is how a roster is read and how the IDs were
    // handed out. Name order shuffles rows whenever someone is renamed.
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId, undefined, { numeric: true }));

  const totals = summaries.reduce(
    (acc, s) => ({
      present: acc.present + s.present,
      left: acc.left + s.left,
      absent: acc.absent + s.absent,
    }),
    { present: 0, left: 0, absent: 0 },
  );

  return {
    monthKey,
    monthLabel: monthLabelOf(monthKey),
    year,
    monthIndex,
    allDates,
    workingDates,
    employees: summaries,
    totals,
    totalEmployees: summaries.length,
    workingDays: workingDates.length,
    isEmpty: monthRecords.length === 0,
  };
}
