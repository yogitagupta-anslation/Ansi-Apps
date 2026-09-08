/**
 * employeeStats.ts
 * -----------------------------------------------------------------------------
 * Pure summaries over the days a Host has delivered to THIS employee phone.
 * Profile and History both draw these figures, so they are derived in one place
 * — two screens quietly disagreeing about someone's attendance rate would be
 * worse than either being wrong on its own.
 *
 * WHAT THIS FILE WILL NOT DO
 * ---------------------------------------------------------------------------
 * The approved design's overview grid has a LATE tile reading "after 09:30".
 * This system has no such thing: a Host records a check-in whenever it first
 * sees the employee, and nothing anywhere — settings, config, the record itself
 * — defines when a working day is supposed to start. Judging every stored
 * check-in against a 09:30 line invented here would report a policy violation
 * against a policy nobody set, and it would be wrong for every workplace that
 * does not start at half past nine.
 *
 * So the fourth figure is the AVERAGE CHECK-IN TIME, which the stored
 * checkInMinutes genuinely supports. It occupies the same tile and answers the
 * same underlying question — how the month's arrivals actually went — without
 * inventing the rule that "late" would need.
 *
 * Every function here returns null rather than a zero when it has no evidence.
 * A person with no delivered days has an UNKNOWN attendance rate, not one of
 * 0%, and the screens render dashes for the difference.
 * -----------------------------------------------------------------------------
 */

import type { StoredDay } from '../attendance/EmployeeStatusStore';

/** A day counts as attended when the Host recorded any presence at all. */
function attended(day: StoredDay): boolean {
  return day.status === 'PRESENT' || day.status === 'LEFT';
}

/** 'YYYY-MM' for the month a 'YYYY-MM-DD' key falls in. */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** 'YYYY-MM' for a Date, in LOCAL time to match how days are keyed. */
export function monthKeyOfDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export interface MonthOverview {
  /** Days the Host reported at all — the denominator for `rate`. */
  recorded: number;
  present: number;
  absent: number;
  /** 0–100, or null when the Host has reported nothing for this month. */
  ratePct: number | null;
  /** Minutes since local midnight, or null when no day carried a check-in. */
  avgCheckInMinutes: number | null;
}

/**
 * Summarise one month. `days` may hold any months; only `monthKey` is counted.
 *
 * `recorded` deliberately counts only days a Host actually delivered. It is NOT
 * the number of days in the calendar month: this phone cannot know whether an
 * undelivered day was a holiday, a weekend, a day the Host was off, or a day
 * the employee genuinely missed. Counting silence as absence would manufacture
 * absences out of a Host that simply never synced.
 */
export function summariseMonth(days: StoredDay[], monthKey: string): MonthOverview {
  let present = 0;
  let absent = 0;
  let checkInSum = 0;
  let checkInCount = 0;

  for (const day of days) {
    if (monthKeyOf(day.date) !== monthKey) continue;
    if (attended(day)) {
      present += 1;
      if (day.checkInMinutes !== null) {
        checkInSum += day.checkInMinutes;
        checkInCount += 1;
      }
    } else {
      absent += 1;
    }
  }

  const recorded = present + absent;
  return {
    recorded,
    present,
    absent,
    ratePct: recorded === 0 ? null : Math.round((present / recorded) * 100),
    avgCheckInMinutes: checkInCount === 0 ? null : Math.round(checkInSum / checkInCount),
  };
}

export interface StreakSummary {
  /** Length of the run ending at the most recently recorded day. */
  current: number;
  longest: number;
  /** Inclusive 'YYYY-MM-DD' bounds of the longest run, or null when none. */
  longestFrom: string | null;
  longestTo: string | null;
}

/**
 * Current and best runs of attended days.
 *
 * A run is broken by a recorded ABSENT day and by nothing else. Gaps in the
 * record — weekends, holidays, days the Host never delivered — do not break it,
 * because this phone has no way to tell a day off from a day unreported, and
 * cutting someone's streak on a Saturday would be a fabricated verdict.
 * "Work days" in the design is exactly this: days that were worked.
 */
export function summariseStreaks(days: StoredDay[]): StreakSummary {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));

  let run = 0;
  let runStart: string | null = null;
  let longest = 0;
  let longestFrom: string | null = null;
  let longestTo: string | null = null;

  for (const day of ordered) {
    if (attended(day)) {
      if (run === 0) runStart = day.date;
      run += 1;
      if (run > longest) {
        longest = run;
        longestFrom = runStart;
        longestTo = day.date;
      }
    } else {
      run = 0;
      runStart = null;
    }
  }

  // `run` is whatever survived to the end of the ordered walk, which is the
  // run ending at the newest recorded day — the current streak by definition.
  return { current: run, longest, longestFrom, longestTo };
}

/** "09:14" from minutes since local midnight. */
export function formatMinutesOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return String(h).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
