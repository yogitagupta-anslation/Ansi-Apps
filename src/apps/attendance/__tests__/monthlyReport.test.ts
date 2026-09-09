/**
 * monthlyReport — the Host's month view of what it ACTUALLY recorded.
 *
 * Two properties matter more here than any count, and most of these tests exist to
 * pin them down:
 *
 *   1. The report never accuses anyone of a day they could not have attended. A
 *      calendar day the Host recorded nothing on is not a working day (it is
 *      indistinguishable from a weekend or a closed office), and a day before an
 *      employee was registered is NOT_APPLICABLE — not ABSENT. A refactor that
 *      turned either of those into an absence would invent misconduct out of
 *      silence.
 *
 *   2. A figure the Host did not observe is null, never 0. `presenceMs` with no
 *      check-in, and `lastCheckIn` / `lastCheckOut` / `lastMarkedLeft` for someone
 *      never seen, must stay null: "we did not observe this" and "this was zero"
 *      are different claims, and only one of them is true.
 *
 * Every timestamp below is built from a LOCAL Date. The module keys days in local
 * time, so a UTC string would move the calendar day for anyone off GMT and this
 * suite would pass in exactly one timezone.
 */

import type { AttendanceRecord } from '../attendance/attendanceTypes';
import type { Employee } from '../employees/employeeTypes';
import type { EmployeeDay, EmployeeMonthSummary, MonthlyReport } from '../attendance/monthlyReport';
import {
  buildMonthlyReport,
  dateStringOf,
  monthKeyOf,
  monthLabelOf,
  monthsWithData,
} from '../attendance/monthlyReport';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A frozen "now", well after the month under test so nothing in August 2026 reads
 * as being in the future. `buildMonthlyReport` consults the clock directly to
 * refuse future working days, so the clock is the one thing this suite must pin.
 */
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime(); // 2026-09-15 12:00, local

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** A local-time timestamp at a given hour on a YYYY-MM-DD day. */
function at(date: string, hour: number, minute = 0): number {
  const parts = date.split('-');
  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    hour,
    minute,
    0,
    0,
  ).getTime();
}

function employee(
  employeeId: string,
  displayName: string,
  createdAt: number,
  department?: string,
): Employee {
  return {
    employeeId,
    displayName,
    department,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  };
}

function record(
  employeeId: string,
  date: string,
  times: {
    checkInTime?: number | null;
    lastSeenTime?: number | null;
    leftTime?: number | null;
  } = {},
  employeeName: string = employeeId,
): AttendanceRecord {
  const checkInTime = times.checkInTime ?? null;
  const lastSeenTime = times.lastSeenTime ?? null;
  const leftTime = times.leftTime ?? null;
  return {
    // These fixtures predate declared check-outs: a leftTime here is always the
    // grace sweep's deduction.
    leftTimeSource: leftTime !== null ? ('INFERRED' as const) : null,
    id: date + ':' + employeeId,
    employeeId,
    employeeName,
    date,
    checkInTime,
    lastSeenTime,
    leftTime: times.leftTime ?? null,
    firstDetectedAt: checkInTime,
    lastDetectedAt: lastSeenTime,
    hostId: 'HOST_TEST',
    checkInRssi: -55,
    events: [],
  };
}

/** Checked in and never marked gone: PRESENT. */
function presentDay(
  employeeId: string,
  date: string,
  checkIn: [number, number] = [9, 0],
  lastSeen: [number, number] = [17, 0],
): AttendanceRecord {
  return record(employeeId, date, {
    checkInTime: at(date, checkIn[0], checkIn[1]),
    lastSeenTime: at(date, lastSeen[0], lastSeen[1]),
  });
}

/** Checked in, then the grace period elapsed: LEFT. */
function leftDay(
  employeeId: string,
  date: string,
  checkIn: [number, number],
  lastSeen: [number, number],
  markedLeft: [number, number],
): AttendanceRecord {
  return record(employeeId, date, {
    checkInTime: at(date, checkIn[0], checkIn[1]),
    lastSeenTime: at(date, lastSeen[0], lastSeen[1]),
    leftTime: at(date, markedLeft[0], markedLeft[1]),
  });
}

function summaryFor(report: MonthlyReport, employeeId: string): EmployeeMonthSummary {
  const found = report.employees.find(e => e.employeeId === employeeId);
  if (!found) {
    throw new Error('no summary for ' + employeeId + ' in ' + report.monthKey);
  }
  return found;
}

function cellOn(summary: EmployeeMonthSummary, date: string): EmployeeDay {
  const cell = summary.days.find(d => d.date === date);
  if (!cell) {
    throw new Error('no day cell for ' + date);
  }
  return cell;
}

function statusOn(summary: EmployeeMonthSummary, date: string): string {
  return cellOn(summary, date).status;
}

const ALICE = 'EMP_001';
const BOB = 'EMP_002';
const MONTH = '2026-08';

/**
 * The shared month. ALICE was registered before it started; BOB was registered on
 * the 12th, halfway through, which is what makes the pre-registration cells
 * observable. The Host recorded something on the 3rd, 4th, 5th, 12th and 13th, and
 * nothing on any other calendar day.
 *
 *            3rd      4th      5th      12th     13th
 *   ALICE    PRESENT  LEFT     —        PRESENT  —
 *   BOB      (unreg)  (unreg)  PRESENT  PRESENT  LEFT
 */
function month(): { records: AttendanceRecord[]; employees: Employee[] } {
  return {
    employees: [
      employee(ALICE, 'Alice', at('2026-07-20', 8, 0), 'Engineering'),
      employee(BOB, 'Bob', at('2026-08-12', 9, 0), 'HR'),
    ],
    records: [
      presentDay(ALICE, '2026-08-03'),
      leftDay(ALICE, '2026-08-04', [9, 5], [12, 30], [12, 45]),
      // ALICE has no record on the 5th — BOB's is what makes it a working day.
      presentDay(BOB, '2026-08-05'),
      presentDay(ALICE, '2026-08-12', [9, 10], [17, 10]),
      presentDay(BOB, '2026-08-12'),
      // ALICE has no record on the 13th.
      leftDay(BOB, '2026-08-13', [9, 0], [15, 0], [15, 15]),
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* monthKeyOf                                                                  */
/* -------------------------------------------------------------------------- */

describe('monthKeyOf', () => {
  it('turns a 0-indexed month into a zero-padded YYYY-MM', () => {
    expect(monthKeyOf(2026, 0)).toBe('2026-01');
    expect(monthKeyOf(2026, 7)).toBe('2026-08');
  });

  it('keeps December in its own year rather than rolling over to month 13', () => {
    expect(monthKeyOf(2026, 11)).toBe('2026-12');
  });

  it('produces keys that sort chronologically as plain strings', () => {
    // monthsWithData and the month filter in buildMonthlyReport both lean on
    // lexicographic ordering of these keys, so the zero padding is load-bearing.
    const keys = [monthKeyOf(2026, 9), monthKeyOf(2026, 0), monthKeyOf(2025, 11)];

    expect([...keys].sort()).toEqual(['2025-12', '2026-01', '2026-10']);
  });
});

/* -------------------------------------------------------------------------- */
/* monthLabelOf                                                                */
/* -------------------------------------------------------------------------- */

describe('monthLabelOf', () => {
  it('names the month and keeps the year', () => {
    expect(monthLabelOf('2026-08')).toBe('August 2026');
    expect(monthLabelOf('2026-01')).toBe('January 2026');
    expect(monthLabelOf('2026-12')).toBe('December 2026');
  });

  it('falls back to the raw month number rather than printing "undefined"', () => {
    expect(monthLabelOf('2026-13')).toBe('13 2026');
  });
});

/* -------------------------------------------------------------------------- */
/* dateStringOf                                                                */
/* -------------------------------------------------------------------------- */

describe('dateStringOf', () => {
  it('reads the calendar day in LOCAL time, not UTC', () => {
    // A minute before local midnight and a second after it. Read as UTC these land
    // on the neighbouring day for anyone east or west of Greenwich, and every record
    // would then be filed under the wrong date.
    expect(dateStringOf(new Date(2026, 7, 31, 23, 59, 0).getTime())).toBe('2026-08-31');
    expect(dateStringOf(new Date(2026, 7, 1, 0, 0, 1).getTime())).toBe('2026-08-01');
  });

  it('zero-pads a single-digit month and day', () => {
    expect(dateStringOf(new Date(2026, 2, 5, 13, 0, 0).getTime())).toBe('2026-03-05');
  });

  it('agrees with the date a record is keyed under', () => {
    // This function and a record's `date` field must produce the same string, or a
    // record silently drops out of its own month.
    expect(dateStringOf(at('2026-08-04', 9, 5))).toBe('2026-08-04');
  });
});

/* -------------------------------------------------------------------------- */
/* monthsWithData                                                              */
/* -------------------------------------------------------------------------- */

describe('monthsWithData', () => {
  it('returns nothing when no records exist', () => {
    expect(monthsWithData([])).toEqual([]);
  });

  it('lists only months that genuinely hold a record, newest first', () => {
    // July is missing from the list because nothing was ever recorded in it: the
    // month picker must not offer a month whose report would be empty.
    const months = monthsWithData([
      presentDay(ALICE, '2026-06-30'),
      presentDay(ALICE, '2026-08-03'),
      presentDay(BOB, '2026-08-04'),
      presentDay(ALICE, '2026-09-01'),
    ]);

    expect(months).toEqual(['2026-09', '2026-08', '2026-06']);
  });

  it('lists a month once however many records it holds', () => {
    const months = monthsWithData([
      presentDay(ALICE, '2026-08-03'),
      presentDay(BOB, '2026-08-03'),
      presentDay(ALICE, '2026-08-04'),
    ]);

    expect(months).toEqual(['2026-08']);
  });

  it('orders across a year boundary by date, not by month number', () => {
    const months = monthsWithData([
      presentDay(ALICE, '2025-12-01'),
      presentDay(ALICE, '2026-01-05'),
    ]);

    expect(months).toEqual(['2026-01', '2025-12']);
  });

  it('skips a record whose date is missing or too short to carry a month', () => {
    const months = monthsWithData([
      record(ALICE, ''),
      record(ALICE, '2026'),
      presentDay(ALICE, '2026-08-03'),
    ]);

    expect(months).toEqual(['2026-08']);
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — an empty month                                         */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — an empty month', () => {
  it('reports isEmpty when there are no records at all', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, records: [], employees: [] });

    expect(report.isEmpty).toBe(true);
    expect(report.workingDays).toBe(0);
    expect(report.workingDates).toEqual([]);
    expect(report.totals).toEqual({ present: 0, left: 0, absent: 0 });
  });

  it('reports isEmpty when every record belongs to a different month', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-07-31'), presentDay(ALICE, '2026-09-01')],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(report.isEmpty).toBe(true);
    expect(report.workingDays).toBe(0);
  });

  it('marks every day of an empty month NOT_APPLICABLE instead of ABSENT', () => {
    // Nobody was recorded, so nobody can be shown to have missed anything.
    // Thirty-one absences here would be a fabricated month of misconduct.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });
    const alice = summaryFor(report, ALICE);

    expect(alice.days).toHaveLength(31);
    expect(alice.days.every(d => d.status === 'NOT_APPLICABLE')).toBe(true);
    expect(alice.absent).toBe(0);
    expect(alice.applicableDays).toBe(0);
  });

  it('still lists the full calendar and the whole roster for an empty month', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-08-12', 9, 0)),
      ],
    });

    expect(report.allDates).toHaveLength(31);
    expect(report.allDates[0]).toBe('2026-08-01');
    expect(report.allDates[30]).toBe('2026-08-31');
    expect(report.totalEmployees).toBe(2);
  });

  it('leaves every observed timestamp null for an employee with no records', () => {
    // The "never observed" case. A 0 would read as a check-in at the Unix epoch.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });
    const alice = summaryFor(report, ALICE);

    expect(alice.lastCheckIn).toBeNull();
    expect(alice.lastCheckOut).toBeNull();
    expect(alice.lastMarkedLeft).toBeNull();
    expect(alice.days.every(d => d.presenceMs === null)).toBe(true);
    expect(alice.days.every(d => d.record === null)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — which days count as working days                       */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — working days', () => {
  it('counts only the days this Host actually recorded something', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(report.workingDates).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-12',
      '2026-08-13',
    ]);
    expect(report.workingDays).toBe(5);
    expect(report.isEmpty).toBe(false);
  });

  it('marks a day with no records NOT_APPLICABLE for everyone, never ABSENT', () => {
    // 2026-08-01 was a Saturday, but the module cannot know that — it knows only that
    // nothing was recorded, which is exactly the evidence a closed office leaves.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(statusOn(summaryFor(report, ALICE), '2026-08-01')).toBe('NOT_APPLICABLE');
    expect(statusOn(summaryFor(report, BOB), '2026-08-01')).toBe('NOT_APPLICABLE');
  });

  it('never treats a date after today as a working day', () => {
    // Clock skew or an imported record dated ahead must not invent a working day and
    // mark the whole company absent for it. Today is frozen at 2026-09-15.
    const report = buildMonthlyReport({
      monthKey: '2026-09',
      records: [presentDay(ALICE, '2026-09-10'), presentDay(BOB, '2026-09-20')],
      employees: [
        employee(ALICE, 'Alice', at('2026-09-01', 8, 0)),
        employee(BOB, 'Bob', at('2026-09-01', 8, 0)),
      ],
    });

    expect(report.workingDates).toEqual(['2026-09-10']);
    expect(statusOn(summaryFor(report, ALICE), '2026-09-20')).toBe('NOT_APPLICABLE');
    expect(summaryFor(report, ALICE).absent).toBe(0);
  });

  it('does not credit attendance for a record dated in the future', () => {
    const report = buildMonthlyReport({
      monthKey: '2026-09',
      records: [presentDay(BOB, '2026-09-20')],
      employees: [employee(BOB, 'Bob', at('2026-09-01', 8, 0))],
    });
    const bob = summaryFor(report, BOB);

    expect(bob.present).toBe(0);
    expect(bob.applicableDays).toBe(0);
    // The record is still attached to its cell — hidden from the counts, not erased.
    expect(cellOn(bob, '2026-09-20').record).not.toBeNull();
  });

  it('includes today itself as a working day when today has a record', () => {
    const report = buildMonthlyReport({
      monthKey: '2026-09',
      records: [presentDay(ALICE, '2026-09-15', [9, 0], [11, 0])],
      employees: [employee(ALICE, 'Alice', at('2026-09-01', 8, 0))],
    });

    expect(report.workingDates).toEqual(['2026-09-15']);
    expect(summaryFor(report, ALICE).present).toBe(1);
  });

  it('ignores records that belong to another month', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(ALICE, '2026-07-31'),
        presentDay(ALICE, '2026-08-03'),
        presentDay(ALICE, '2026-09-01'),
      ],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(report.workingDates).toEqual(['2026-08-03']);
    expect(summaryFor(report, ALICE).present).toBe(1);
  });

  it('sizes the calendar from the month itself, leap February included', () => {
    const leap = buildMonthlyReport({ monthKey: '2024-02', records: [], employees: [] });
    const common = buildMonthlyReport({ monthKey: '2026-02', records: [], employees: [] });
    const thirty = buildMonthlyReport({ monthKey: '2026-09', records: [], employees: [] });

    expect(leap.allDates).toHaveLength(29);
    expect(leap.allDates[28]).toBe('2024-02-29');
    expect(common.allDates).toHaveLength(28);
    expect(thirty.allDates).toHaveLength(30);
  });

  it('carries the month identity through to the report header', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, records: [], employees: [] });

    expect(report.monthKey).toBe('2026-08');
    expect(report.monthLabel).toBe('August 2026');
    expect(report.year).toBe(2026);
    expect(report.monthIndex).toBe(7);
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — the registration window                                */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — the registration window', () => {
  it('marks an EMPTY day before an employee was registered NOT_APPLICABLE, not ABSENT', () => {
    // BOB was registered on the 12th. The 3rd and 4th were working days on which he
    // did not yet exist and nothing was observed — no expectation for him to miss.
    // The 5th was also before his registry entry, but it carries a record, so it is
    // counted rather than excused; see 'the pre-registration rule' below.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const bob = summaryFor(report, BOB);

    expect(statusOn(bob, '2026-08-03')).toBe('NOT_APPLICABLE');
    expect(statusOn(bob, '2026-08-04')).toBe('NOT_APPLICABLE');
    expect(statusOn(bob, '2026-08-05')).toBe('PRESENT');
    expect(bob.absent).toBe(0);
    // Nor an observed span: there is nothing to report for a day he did not have.
    expect(cellOn(bob, '2026-08-03').presenceMs).toBeNull();
  });

  it('excludes pre-registration days from the attendance denominator', () => {
    // Five working days in the month. Two of them — the 3rd and 4th — fall before BOB
    // existed AND carry nothing for him, so they are not his to answer for. The other
    // three are: the 12th and 13th follow his registry entry, and the 5th precedes it
    // but holds a record, which is an observation and outranks the registry date.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const bob = summaryFor(report, BOB);

    expect(report.workingDays).toBe(5);
    expect(bob.applicableDays).toBe(3);
    expect(bob.attendancePercent).toBe(100);
  });

  it('counts the registration day itself as applicable', () => {
    // Registered at 09:00 on the 12th and recorded that same day: the boundary is the
    // calendar day, not the exact moment, so day one still counts.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(statusOn(summaryFor(report, BOB), '2026-08-12')).toBe('PRESENT');
  });

  it('gives an employee registered before the month every working day', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(summaryFor(report, ALICE).applicableDays).toBe(5);
  });

  it('takes the registration boundary from the LOCAL calendar day of createdAt', () => {
    // Registered at 23:30 local on the 12th. Read as UTC that timestamp can land on
    // the 13th, which would wrongly excuse the 12th as pre-registration.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-12'), presentDay(BOB, '2026-08-12')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', new Date(2026, 7, 12, 23, 30, 0).getTime()),
      ],
    });
    const bob = summaryFor(report, BOB);

    expect(statusOn(bob, '2026-08-12')).toBe('PRESENT');
    expect(bob.applicableDays).toBe(1);
  });

  it('gives no applicable days to an employee registered after the month ended', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-03')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-09-01', 9, 0)),
      ],
    });
    const bob = summaryFor(report, BOB);

    expect(bob.applicableDays).toBe(0);
    expect(bob.absent).toBe(0);
    expect(bob.days.every(d => d.status === 'NOT_APPLICABLE')).toBe(true);
  });

  /* ------------------------------------------------------------------------ *
   * REGRESSION GUARD — the pre-registration rule must only decline to invent an
   * absence; it must never discard attendance that WAS observed.
   *
   * The rule exists so nobody is marked ABSENT for a day they did not yet
   * exist for. On a day that carries no record there is nothing to lose by it.
   * But the check runs before the record is ever looked at, so a day that DOES
   * carry a record — proof the employee was detected and checked in — is
   * silently reduced to NOT_APPLICABLE: dropped from `present`, from
   * `applicableDays`, from `lastCheckIn`, and from the month totals, while the
   * record sits attached to the very cell that denies it.
   *
   * This reaches real data whenever createdAt moves after the fact: an employee
   * deleted and re-added with the same employeeId gets a fresh createdAt, and
   * every day they attended earlier that month vanishes from the report.
   *
   * It also contradicts the module's own reasoning a few lines further down,
   * where an employee missing from the registry is deliberately kept because
   * "dropping the latter would silently erase attendance that genuinely
   * happened". Same principle, opposite outcome.
   *
   * The fix consults the record first and applies the pre-registration excuse
   * only to empty cells. These two tests hold that line.
   * ------------------------------------------------------------------------ */

  it('counts a day the employee was genuinely recorded, even before their registry entry', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-05'), presentDay(BOB, '2026-08-05')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        // Re-added to the registry on the 12th, a week after this record was made.
        employee(BOB, 'Bob', at('2026-08-12', 9, 0)),
      ],
    });
    const bob = summaryFor(report, BOB);

    expect(statusOn(bob, '2026-08-05')).toBe('PRESENT');
    expect(bob.present).toBe(1);
    expect(report.totals.present).toBe(2);
  });

  it('never reports lastCheckIn as null while holding a record that has a check-in', () => {
    // null means "no check-in was ever observed". Here one was observed, stored, and
    // handed back on the day cell — so null is not missing data, it is a false claim.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-05'), presentDay(BOB, '2026-08-05')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-08-12', 9, 0)),
      ],
    });
    const bob = summaryFor(report, BOB);

    expect(cellOn(bob, '2026-08-05').record).not.toBeNull();
    expect(bob.lastCheckIn).toBe(at('2026-08-05', 9, 0));
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — per-employee counts                                    */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — per-employee counts', () => {
  it('counts a record carrying a leftTime as LEFT and one without as PRESENT', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(statusOn(alice, '2026-08-03')).toBe('PRESENT');
    expect(statusOn(alice, '2026-08-04')).toBe('LEFT');
    expect(alice.present).toBe(2);
    expect(alice.left).toBe(1);
  });

  it('marks a working day with no record for a registered employee ABSENT', () => {
    // ALICE has no record on the 5th or the 13th, but BOB does, so those days ran.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(statusOn(alice, '2026-08-05')).toBe('ABSENT');
    expect(statusOn(alice, '2026-08-13')).toBe('ABSENT');
    expect(alice.absent).toBe(2);
    expect(cellOn(alice, '2026-08-05').record).toBeNull();
  });

  it('counts a stored record that never reached a check-in as ABSENT', () => {
    // Some advertisements arrived but confirmation never happened: a record exists,
    // attendance does not.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(BOB, '2026-08-03'),
        record(ALICE, '2026-08-03', { checkInTime: null, lastSeenTime: null }),
      ],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-07-20', 8, 0)),
      ],
    });
    const alice = summaryFor(report, ALICE);

    expect(statusOn(alice, '2026-08-03')).toBe('ABSENT');
    expect(alice.absent).toBe(1);
    expect(alice.present).toBe(0);
    expect(alice.lastCheckIn).toBeNull();
  });

  it('counts LEFT as attendance in the percentage', () => {
    // Leaving Bluetooth range is a proximity fact, not an attendance one: the person
    // came in, and the record proves it.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const bob = summaryFor(report, BOB);

    // The 5th and the 12th, plus the 13th he left on: 3 of 3 applicable days.
    expect(bob.present).toBe(2);
    expect(bob.left).toBe(1);
    expect(bob.absent).toBe(0);
    expect(bob.attendancePercent).toBe(100);
  });

  it('rates attendance against applicable days, not against the whole month', () => {
    // ALICE: 2 present + 1 left of 5 applicable days = 60%, not 3/31.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(summaryFor(report, ALICE).attendancePercent).toBe(60);
  });

  it('rounds a recurring attendance percentage to one decimal', () => {
    // Two attended of three applicable days: 66.666… must not print as 67 or 66.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(ALICE, '2026-08-03'),
        presentDay(ALICE, '2026-08-04'),
        presentDay(BOB, '2026-08-05'),
      ],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-07-20', 8, 0)),
      ],
    });

    expect(summaryFor(report, ALICE).attendancePercent).toBe(66.7);
  });

  it('sums the per-employee counts into the month totals', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    // ALICE 2 present + 1 left + 2 absent; BOB 2 present + 1 left + 0 absent.
    expect(report.totals).toEqual({ present: 4, left: 2, absent: 2 });
  });

  it('gives every employee one day cell per calendar day of the month', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.days.map(d => d.date)).toEqual(report.allDates);
    expect(alice.present + alice.left + alice.absent).toBe(alice.applicableDays);
  });

  it('carries the registry name and department onto the summary', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.employeeName).toBe('Alice');
    expect(alice.department).toBe('Engineering');
  });

  it('orders employees by id numerically, so EMP_10 follows EMP_2', () => {
    // Name order would reshuffle every row the moment somebody is renamed.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [],
      employees: [
        employee('EMP_10', 'Zoe', at('2026-07-20', 8, 0)),
        employee('EMP_2', 'Adam', at('2026-07-20', 8, 0)),
        employee('EMP_1', 'Mia', at('2026-07-20', 8, 0)),
      ],
    });

    expect(report.employees.map(e => e.employeeId)).toEqual(['EMP_1', 'EMP_2', 'EMP_10']);
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — observed presence, and what stays unknown              */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — observed presence', () => {
  it('measures presence from check-in to LAST SEEN, not to the inferred leftTime', () => {
    // leftTime is lastSeen + the grace period: the moment the Host concluded the
    // person had gone, not a moment anybody was observed. Using it would inflate
    // every span in the app by one grace period.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [leftDay(ALICE, '2026-08-04', [9, 5], [12, 30], [12, 45])],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(cellOn(summaryFor(report, ALICE), '2026-08-04').presenceMs).toBe(
      3 * HOUR + 25 * MINUTE,
    );
  });

  it('reports a null presence span, not zero, on a day with no check-in', () => {
    // The employee was never confirmed present. A 0 would claim an observed
    // zero-length visit; null says the Host has nothing to report.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(BOB, '2026-08-03')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-07-20', 8, 0)),
      ],
    });
    const alice = summaryFor(report, ALICE);

    expect(statusOn(alice, '2026-08-03')).toBe('ABSENT');
    expect(cellOn(alice, '2026-08-03').presenceMs).toBeNull();
  });

  it('reports a null presence span when the employee checked in but was never seen again', () => {
    // Attendance is known, duration is not, and the two must not be conflated: the
    // day still counts as PRESENT while the span stays unknown.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [record(ALICE, '2026-08-03', { checkInTime: at('2026-08-03', 9, 0) })],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });
    const alice = summaryFor(report, ALICE);

    expect(statusOn(alice, '2026-08-03')).toBe('PRESENT');
    expect(alice.present).toBe(1);
    expect(cellOn(alice, '2026-08-03').presenceMs).toBeNull();
    expect(alice.lastCheckIn).toBe(at('2026-08-03', 9, 0));
    expect(alice.lastCheckOut).toBeNull();
  });

  it('averages presence over the days that carried a span, not over working days', () => {
    // Two spans of 8h and one of 3h25m across three attended days.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.totalPresenceMs).toBe(8 * HOUR + (3 * HOUR + 25 * MINUTE) + 8 * HOUR);
    expect(alice.averagePresenceMs).toBe(alice.totalPresenceMs / 3);
  });

  it('does not let an absent day drag the presence average toward zero', () => {
    // ALICE was absent twice. If those days entered the divisor the average would be
    // two fifths lower than anything actually observed.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.averagePresenceMs).toBeGreaterThan(alice.totalPresenceMs / 5);
  });

  it('never reports a negative span from out-of-order timestamps', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        record(ALICE, '2026-08-03', {
          checkInTime: at('2026-08-03', 17, 0),
          lastSeenTime: at('2026-08-03', 9, 0),
        }),
      ],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(cellOn(summaryFor(report, ALICE), '2026-08-03').presenceMs).toBe(0);
  });

  it('keeps the latest check-in and the latest last-seen of the month', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.lastCheckIn).toBe(at('2026-08-12', 9, 10));
    expect(alice.lastCheckOut).toBe(at('2026-08-12', 17, 10));
  });

  it('tracks the inferred departure separately from the observed last-seen', () => {
    // ALICE's only LEFT day was the 4th, but she was seen again on the 12th. Reporting
    // the 4th's leftTime as her check-out would claim she was last seen eight days
    // earlier than she actually was.
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });
    const alice = summaryFor(report, ALICE);

    expect(alice.lastMarkedLeft).toBe(at('2026-08-04', 12, 45));
    expect(alice.lastCheckOut).toBe(at('2026-08-12', 17, 10));
    expect(alice.lastMarkedLeft as number).toBeLessThan(alice.lastCheckOut as number);
  });

  it('reports the observed last-seen as the check-out on a month ending with a LEFT day', () => {
    // The 4th is ALICE's last recorded day and she was marked gone on it. The
    // check-out must be 12:30 — the last moment she was genuinely detected — while
    // 12:45, the moment the grace period elapsed, belongs to lastMarkedLeft alone.
    // Reporting 12:45 as a check-out would dress an inference up as an observation.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(ALICE, '2026-08-03'),
        leftDay(ALICE, '2026-08-04', [9, 5], [12, 30], [12, 45]),
      ],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });
    const alice = summaryFor(report, ALICE);

    expect(alice.lastCheckOut).toBe(at('2026-08-04', 12, 30));
    expect(alice.lastMarkedLeft).toBe(at('2026-08-04', 12, 45));
    expect(alice.lastCheckOut as number).toBeLessThan(alice.lastMarkedLeft as number);
  });

  it('leaves lastMarkedLeft null for someone who never triggered the grace period', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-03')],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(summaryFor(report, ALICE).lastMarkedLeft).toBeNull();
  });

  it('takes the latest timestamps even when the records arrive out of order', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(ALICE, '2026-08-12', [9, 10], [17, 10]),
        presentDay(ALICE, '2026-08-03', [9, 0], [17, 0]),
      ],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });

    expect(summaryFor(report, ALICE).lastCheckIn).toBe(at('2026-08-12', 9, 10));
  });
});

/* -------------------------------------------------------------------------- */
/* buildMonthlyReport — who appears in the report                              */
/* -------------------------------------------------------------------------- */

describe('buildMonthlyReport — the roster', () => {
  it('reports an employee who has records but has since left the registry', () => {
    // Dropping them would silently erase attendance that genuinely happened.
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [
        presentDay(ALICE, '2026-08-03'),
        record(
          'EMP_099',
          '2026-08-03',
          {
            checkInTime: at('2026-08-03', 9, 0),
            lastSeenTime: at('2026-08-03', 17, 0),
          },
          'Ghost',
        ),
      ],
      employees: [employee(ALICE, 'Alice', at('2026-07-20', 8, 0))],
    });
    const ghost = summaryFor(report, 'EMP_099');

    expect(report.totalEmployees).toBe(2);
    // The name snapshotted on the record, since the registry can no longer supply one.
    expect(ghost.employeeName).toBe('Ghost');
    expect(ghost.department).toBeUndefined();
    expect(ghost.present).toBe(1);
  });

  it('falls back to the id when a de-registered employee has no name on the record', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [record('EMP_099', '2026-08-03', { checkInTime: at('2026-08-03', 9, 0) }, '')],
      employees: [],
    });

    expect(summaryFor(report, 'EMP_099').employeeName).toBe('EMP_099');
  });

  it('prefers the current registry name over the name snapshotted on the record', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [record(ALICE, '2026-08-03', { checkInTime: at('2026-08-03', 9, 0) }, 'Old Name')],
      employees: [employee(ALICE, 'Alice Renamed', at('2026-07-20', 8, 0))],
    });

    expect(summaryFor(report, ALICE).employeeName).toBe('Alice Renamed');
  });

  it('lists a registered employee with no records rather than omitting them', () => {
    const report = buildMonthlyReport({
      monthKey: MONTH,
      records: [presentDay(ALICE, '2026-08-03')],
      employees: [
        employee(ALICE, 'Alice', at('2026-07-20', 8, 0)),
        employee(BOB, 'Bob', at('2026-07-20', 8, 0)),
      ],
    });
    const bob = summaryFor(report, BOB);

    expect(report.totalEmployees).toBe(2);
    // BOB missed the one working day and is shown as absent, not dropped.
    expect(bob.absent).toBe(1);
    expect(bob.applicableDays).toBe(1);
  });

  it('does not double-count an employee who is both registered and has records', () => {
    const report = buildMonthlyReport({ monthKey: MONTH, ...month() });

    expect(report.employees.filter(e => e.employeeId === ALICE)).toHaveLength(1);
    expect(report.totalEmployees).toBe(2);
  });
});
