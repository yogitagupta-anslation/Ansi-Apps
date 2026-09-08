/**
 * employeeStats — the month and streak summaries an employee phone draws from the
 * days a Host delivered to it.
 *
 * The assertions that matter most here are the ones about ABSENCE OF EVIDENCE. This
 * app's defining rule is that it never reports a figure it has not observed, so a
 * month with no delivered days must yield null — not 0, and not a guess. A refactor
 * that "helpfully" defaulted those to zero would turn "we don't know" into "you were
 * never here", which is the one failure mode this screen exists to avoid.
 */

import type { StoredDay } from '../attendance/EmployeeStatusStore';
import {
  formatMinutesOfDay,
  monthKeyOf,
  monthKeyOfDate,
  summariseMonth,
  summariseStreaks,
} from '../state/employeeStats';

/** A delivered day. Minutes are since local midnight, as the Host sends them. */
function day(
  date: string,
  status: StoredDay['status'],
  checkInMinutes: number | null = null,
  checkOutMinutes: number | null = null,
): StoredDay {
  return {
    date,
    status,
    checkInMinutes,
    checkOutMinutes,
    hostId: 'HOST_TEST',
    receivedAt: 1_700_000_000_000,
  };
}

describe('monthKeyOf / monthKeyOfDate', () => {
  it('takes the month from a YYYY-MM-DD key', () => {
    expect(monthKeyOf('2026-09-07')).toBe('2026-09');
  });

  it('zero-pads a single-digit month from a Date', () => {
    // Local-time construction on purpose: days are keyed in local time, so a UTC
    // reading would shift the month for anyone east or west of Greenwich.
    expect(monthKeyOfDate(new Date(2026, 0, 31))).toBe('2026-01');
  });
});

describe('summariseMonth', () => {
  it('reports null, not zero, when the Host has delivered nothing', () => {
    const summary = summariseMonth([], '2026-09');

    expect(summary.recorded).toBe(0);
    expect(summary.ratePct).toBeNull();
    expect(summary.avgCheckInMinutes).toBeNull();
  });

  it('reports a null average check-in when days arrived without times', () => {
    // Delivered and present, but the Host sent no clock times: the rate is knowable,
    // the average arrival is not, and the two must not be conflated.
    const summary = summariseMonth([day('2026-09-01', 'PRESENT')], '2026-09');

    expect(summary.present).toBe(1);
    expect(summary.ratePct).toBe(100);
    expect(summary.avgCheckInMinutes).toBeNull();
  });

  it('counts LEFT as attended', () => {
    const summary = summariseMonth(
      [day('2026-09-01', 'PRESENT'), day('2026-09-02', 'LEFT')],
      '2026-09',
    );

    expect(summary.present).toBe(2);
    expect(summary.absent).toBe(0);
    expect(summary.ratePct).toBe(100);
  });

  it('rates attendance against days actually delivered, not the calendar', () => {
    // Three delivered days, one of them absent. September has 30 days, but the 27
    // the Host never mentioned are silence — they must not become absences.
    const summary = summariseMonth(
      [
        day('2026-09-01', 'PRESENT'),
        day('2026-09-02', 'PRESENT'),
        day('2026-09-03', 'ABSENT'),
      ],
      '2026-09',
    );

    expect(summary.recorded).toBe(3);
    expect(summary.absent).toBe(1);
    expect(summary.ratePct).toBe(67);
  });

  it('ignores days belonging to another month', () => {
    const summary = summariseMonth(
      [day('2026-08-31', 'PRESENT'), day('2026-09-01', 'PRESENT')],
      '2026-09',
    );

    expect(summary.recorded).toBe(1);
  });

  it('averages only the days that carried a check-in', () => {
    const summary = summariseMonth(
      [
        day('2026-09-01', 'PRESENT', 540), // 09:00
        day('2026-09-02', 'PRESENT', 560), // 09:20
        day('2026-09-03', 'PRESENT'), // no time delivered — excluded
      ],
      '2026-09',
    );

    expect(summary.avgCheckInMinutes).toBe(550);
  });
});

describe('summariseStreaks', () => {
  it('reports zeroes and null bounds with nothing recorded', () => {
    const streaks = summariseStreaks([]);

    expect(streaks).toEqual({
      current: 0,
      longest: 0,
      longestFrom: null,
      longestTo: null,
    });
  });

  it('does not break a run on a gap in the record', () => {
    // Nothing was delivered for the 2nd and 3rd. This phone cannot tell a weekend
    // from an unsynced day, so silence must not cut the streak.
    const streaks = summariseStreaks([
      day('2026-09-01', 'PRESENT'),
      day('2026-09-04', 'PRESENT'),
    ]);

    expect(streaks.current).toBe(2);
    expect(streaks.longest).toBe(2);
  });

  it('breaks a run on a recorded absence', () => {
    const streaks = summariseStreaks([
      day('2026-09-01', 'PRESENT'),
      day('2026-09-02', 'ABSENT'),
      day('2026-09-03', 'PRESENT'),
    ]);

    expect(streaks.current).toBe(1);
    expect(streaks.longest).toBe(1);
  });

  it('takes the current streak as the run ending at the newest day', () => {
    const streaks = summariseStreaks([
      day('2026-09-01', 'PRESENT'),
      day('2026-09-02', 'PRESENT'),
      day('2026-09-03', 'PRESENT'),
      day('2026-09-04', 'ABSENT'),
      day('2026-09-05', 'PRESENT'),
    ]);

    expect(streaks.current).toBe(1);
    expect(streaks.longest).toBe(3);
    expect(streaks.longestFrom).toBe('2026-09-01');
    expect(streaks.longestTo).toBe('2026-09-03');
  });

  it('orders the days itself rather than trusting the caller', () => {
    const streaks = summariseStreaks([
      day('2026-09-03', 'PRESENT'),
      day('2026-09-01', 'PRESENT'),
      day('2026-09-02', 'PRESENT'),
    ]);

    expect(streaks.longest).toBe(3);
    expect(streaks.longestFrom).toBe('2026-09-01');
    expect(streaks.longestTo).toBe('2026-09-03');
  });

  it('keeps the FIRST of two equally long runs as the best', () => {
    const streaks = summariseStreaks([
      day('2026-09-01', 'PRESENT'),
      day('2026-09-02', 'PRESENT'),
      day('2026-09-03', 'ABSENT'),
      day('2026-09-04', 'PRESENT'),
      day('2026-09-05', 'PRESENT'),
    ]);

    expect(streaks.longest).toBe(2);
    expect(streaks.longestFrom).toBe('2026-09-01');
    expect(streaks.current).toBe(2);
  });
});

describe('formatMinutesOfDay', () => {
  it('zero-pads both halves', () => {
    expect(formatMinutesOfDay(9 * 60 + 4)).toBe('09:04');
    expect(formatMinutesOfDay(0)).toBe('00:00');
  });

  it('wraps a full day rather than printing hour 24', () => {
    expect(formatMinutesOfDay(24 * 60)).toBe('00:00');
  });
});
