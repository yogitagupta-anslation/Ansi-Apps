/**
 * deriveStatus / millisSinceLastSeen — the arithmetic the whole attendance state machine
 * rests on.
 *
 * Both functions are pure and time-parameterised: the same record and the same `now`
 * must always give the same answer. That property is not a nicety, it is the reason a
 * check-in survives a restart — status is recomputed from stored timestamps rather than
 * remembered, so a timer that fires late, twice, or never changes nothing.
 *
 * The assertions that matter most are the ones about ABSENCE OF EVIDENCE and the
 * transition that must never exist. `millisSinceLastSeen` must answer null — not 0 —
 * for a device it has never heard from, because 0 would claim "seen just now". And a
 * record carrying a check-in must never derive back to ABSENT, because ABSENT means
 * "never detected today" and would erase an attendance the device really did observe.
 */

import type { AttendanceRecord } from '../attendance/attendanceTypes';
import { deriveStatus, millisSinceLastSeen } from '../attendance/attendanceTypes';

/** The shipped default, so the numbers here match what a device actually runs. */
const GRACE = 3 * 60_000;

/** A fixed wall clock. Nothing in this file reads the real one. */
const CHECK_IN = 1_700_000_000_000;

/** A confirmed check-in, seen at the moment it checked in. Override to taste. */
function record(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    leftTimeSource: null,
    id: '2026-09-07:EMP_1',
    employeeId: 'EMP_1',
    employeeName: 'Test Employee',
    date: '2026-09-07',
    checkInTime: CHECK_IN,
    lastSeenTime: CHECK_IN,
    leftTime: null,
    firstDetectedAt: CHECK_IN,
    lastDetectedAt: CHECK_IN,
    hostId: 'HOST_TEST',
    checkInRssi: -62,
    events: [{ type: 'CHECK_IN', at: CHECK_IN, rssi: -62 }],
    ...overrides,
  };
}

describe('deriveStatus — ABSENT means never detected today', () => {
  it('reads ABSENT when there is no record for today at all', () => {
    expect(deriveStatus(null, CHECK_IN, GRACE)).toBe('ABSENT');
  });

  it('reads ABSENT when a record exists but the check-in was never confirmed', () => {
    // Advertisements arrived — firstDetectedAt/lastDetectedAt are set — but not enough
    // of them, close enough, to confirm. Detected is not the same as present.
    const unconfirmed = record({
      checkInTime: null,
      lastSeenTime: null,
      checkInRssi: null,
      events: [{ type: 'FIRST_DETECTED', at: CHECK_IN, rssi: -80 }],
    });

    expect(deriveStatus(unconfirmed, CHECK_IN, GRACE)).toBe('ABSENT');
  });

  it('reads ABSENT for an unconfirmed record even when it was seen this instant', () => {
    // lastSeenTime is as fresh as it gets; without a check-in it still proves nothing.
    const unconfirmed = record({ checkInTime: null, checkInRssi: null });

    expect(deriveStatus(unconfirmed, CHECK_IN, GRACE)).toBe('ABSENT');
  });
});

describe('deriveStatus — PRESENT inside the grace period', () => {
  it('reads PRESENT at the instant of the last advertisement', () => {
    expect(deriveStatus(record(), CHECK_IN, GRACE)).toBe('PRESENT');
  });

  it('reads PRESENT one millisecond inside the grace period', () => {
    expect(deriveStatus(record(), CHECK_IN + GRACE - 1, GRACE)).toBe('PRESENT');
  });

  it('reads PRESENT at exactly the grace period, which is reached but not exceeded', () => {
    // The boundary. LEFT is `> grace`, so equality is still PRESENT: an employee is not
    // marked gone by the tick that merely completes the grace they were granted.
    expect(deriveStatus(record(), CHECK_IN + GRACE, GRACE)).toBe('PRESENT');
  });

  it('reads PRESENT again after a re-entry, ignoring the earlier leftTime', () => {
    // Left at 12:00, detected again at 12:30. The status follows lastSeenTime, not the
    // stale departure stamp the manager clears on re-entry.
    const reEntered = record({
      leftTime: CHECK_IN + 60_000,
      lastSeenTime: CHECK_IN + 600_000,
    });

    expect(deriveStatus(reEntered, CHECK_IN + 600_000, GRACE)).toBe('PRESENT');
  });

  it('reads PRESENT, never ABSENT, for a checked-in record with no lastSeenTime', () => {
    // Defensive branch: a confirmed check-in with nothing to measure from cannot be
    // measured into LEFT, and must never fall back to ABSENT — that would delete the
    // one fact the record exists to hold.
    const noSightings = record({ lastSeenTime: null });

    expect(deriveStatus(noSightings, CHECK_IN + 30 * 60_000, GRACE)).toBe('PRESENT');
  });
});

describe('deriveStatus — LEFT once the grace period is exceeded', () => {
  it('reads LEFT one millisecond past the grace period', () => {
    expect(deriveStatus(record(), CHECK_IN + GRACE + 1, GRACE)).toBe('LEFT');
  });

  it('reads LEFT hours after the last advertisement', () => {
    expect(deriveStatus(record(), CHECK_IN + 8 * 3_600_000, GRACE)).toBe('LEFT');
  });

  it('reads LEFT from the timestamps alone, with no leftTime recorded yet', () => {
    // The sweep that writes leftTime may not have run — after a restart it certainly
    // has not. The verdict is arithmetic on lastSeenTime, not a stored flag.
    const notYetSwept = record({ leftTime: null });

    expect(deriveStatus(notYetSwept, CHECK_IN + GRACE + 1, GRACE)).toBe('LEFT');
  });

  it('honours a zero grace period: PRESENT at zero elapsed, LEFT one millisecond later', () => {
    expect(deriveStatus(record(), CHECK_IN, 0)).toBe('PRESENT');
    expect(deriveStatus(record(), CHECK_IN + 1, 0)).toBe('LEFT');
  });

  it('honours a longer configured grace period before calling anyone gone', () => {
    // The same elapsed time reads differently under a different setting, so the config
    // is genuinely consulted rather than a constant being baked in.
    const now = CHECK_IN + 10 * 60_000;

    expect(deriveStatus(record(), now, 5 * 60_000)).toBe('LEFT');
    expect(deriveStatus(record(), now, 15 * 60_000)).toBe('PRESENT');
  });
});

describe('deriveStatus — the transition that must never exist', () => {
  it('never derives ABSENT from a record that carries a check-in, at any elapsed time', () => {
    const deltas = [0, 1, GRACE - 1, GRACE, GRACE + 1, 8 * 3_600_000, 30 * 86_400_000];

    for (const delta of deltas) {
      expect(deriveStatus(record(), CHECK_IN + delta, GRACE)).not.toBe('ABSENT');
    }
  });

  it('derives the same status after a restart, from the persisted record alone', () => {
    // Round-tripping through JSON is what actually happens between two app launches.
    // Same record, same `now`, same answer — no in-memory state involved.
    const now = CHECK_IN + GRACE + 5_000;
    const persisted: AttendanceRecord = JSON.parse(JSON.stringify(record()));

    expect(deriveStatus(record(), now, GRACE)).toBe('LEFT');
    expect(deriveStatus(persisted, now, GRACE)).toBe('LEFT');
  });

  it('returns the same answer when called repeatedly with the same now', () => {
    const now = CHECK_IN + GRACE;
    const subject = record();

    expect(deriveStatus(subject, now, GRACE)).toBe('PRESENT');
    expect(deriveStatus(subject, now, GRACE)).toBe('PRESENT');
    expect(deriveStatus(subject, now, GRACE)).toBe('PRESENT');
  });

  it('does not mutate the record it was handed', () => {
    const subject = record();
    const before = JSON.parse(JSON.stringify(subject));

    deriveStatus(subject, CHECK_IN + GRACE + 1, GRACE);

    expect(subject).toEqual(before);
  });

  it('reads PRESENT rather than LEFT when the clock has moved backwards', () => {
    // Clock skew must not manufacture a departure: a negative elapsed time is not an
    // exceeded grace period.
    expect(deriveStatus(record(), CHECK_IN - 60_000, GRACE)).toBe('PRESENT');
  });
});

describe('millisSinceLastSeen', () => {
  it('reports null, not zero, when there is no record at all', () => {
    // 0 would read as "seen just now" — the opposite of never heard from.
    expect(millisSinceLastSeen(null, CHECK_IN)).toBeNull();
  });

  it('reports null, not zero, when the record has never been seen', () => {
    expect(millisSinceLastSeen(record({ lastSeenTime: null }), CHECK_IN)).toBeNull();
  });

  it('reports zero only at the exact instant of the last advertisement', () => {
    // Here 0 is observed, not assumed: the device really did hear from it just now.
    expect(millisSinceLastSeen(record(), CHECK_IN)).toBe(0);
  });

  it('reports the elapsed milliseconds since the last advertisement', () => {
    expect(millisSinceLastSeen(record(), CHECK_IN + 90_000)).toBe(90_000);
  });

  it('measures from the last advertisement, not from the check-in', () => {
    const stillHere = record({ lastSeenTime: CHECK_IN + 3_600_000 });

    expect(millisSinceLastSeen(stillHere, CHECK_IN + 3_660_000)).toBe(60_000);
  });

  it('reports elapsed time for a detected-but-unconfirmed record, which reads ABSENT', () => {
    // Elapsed time and status are independent readings: one is how long since a radio
    // packet, the other is whether attendance was ever confirmed.
    const unconfirmed = record({ checkInTime: null, checkInRssi: null });
    const now = CHECK_IN + 45_000;

    expect(millisSinceLastSeen(unconfirmed, now)).toBe(45_000);
    expect(deriveStatus(unconfirmed, now, GRACE)).toBe('ABSENT');
  });

  it('reports a negative elapsed time rather than clamping when the clock moved backwards', () => {
    // Clamping to 0 would claim a sighting that did not happen at that moment; the
    // honest answer is the arithmetic the device can actually observe.
    expect(millisSinceLastSeen(record(), CHECK_IN - 5_000)).toBe(-5_000);
  });

  it('returns the same answer when called repeatedly with the same now', () => {
    const subject = record();

    expect(millisSinceLastSeen(subject, CHECK_IN + 1_000)).toBe(1_000);
    expect(millisSinceLastSeen(subject, CHECK_IN + 1_000)).toBe(1_000);
  });
});
