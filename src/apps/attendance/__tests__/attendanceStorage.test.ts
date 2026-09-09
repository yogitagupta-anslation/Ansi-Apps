/**
 * attendanceStorage.test.ts
 * -----------------------------------------------------------------------------
 * Repair-on-read for the duplicated CHECK_OUT bug.
 *
 * An earlier build recorded a declared departure on the LEVEL of the check-out
 * flag instead of its rising edge. The flag sits in every advertisement until a
 * receipt arrives, so the Host appended a CHECK_OUT several times a second —
 * thousands on one record — and the 50-entry cap then evicted the day's real
 * events to make room for the noise.
 *
 * The scanner no longer does this, but any device that ran the buggy build
 * still holds the damage, so the read path collapses it. These tests fix the
 * boundary of that repair, because it is the kind of rule that quietly grows
 * into "tidy the audit trail" if nobody writes down where it stops.
 * -----------------------------------------------------------------------------
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AttendanceStorage } from '../storage/AttendanceStorage';
import { STORAGE_KEYS } from '../storage/AppStorage';
import type { AttendanceEvent, AttendanceRecord } from '../attendance/attendanceTypes';

const DATE = '2026-09-08';
const T0 = 1_768_469_400_000;

function record(events: AttendanceEvent[]): AttendanceRecord {
  return {
    id: DATE + ':EMP_1',
    employeeId: 'EMP_1',
    employeeName: 'Test Employee',
    date: DATE,
    checkInTime: T0,
    lastSeenTime: T0,
    leftTime: null,
    leftTimeSource: null,
    firstDetectedAt: T0,
    lastDetectedAt: T0,
    hostId: 'HOST-A1B2',
    checkInRssi: -50,
    events,
  };
}

/** Seeds the raw table, bypassing save() so the stored events reach normalize untouched. */
async function seed(events: AttendanceEvent[]): Promise<AttendanceEvent[]> {
  await AsyncStorage.setItem(STORAGE_KEYS.attendance, JSON.stringify([record(events)]));
  const [read] = await AttendanceStorage.getByDate(DATE);
  return read.events;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('AttendanceStorage — repeated CHECK_OUT repair', () => {
  it('collapses a machine-generated run to a single event', async () => {
    // The bug's signature: one per advertisement, milliseconds apart.
    const burst: AttendanceEvent[] = Array.from({ length: 200 }, (_, i) => ({
      type: 'CHECK_OUT' as const,
      at: T0 + i * 40,
    }));

    const events = await seed(burst);

    expect(events).toHaveLength(1);
  });

  it('keeps the LAST of the run, because that is the time the record holds', async () => {
    // The repetition walked leftTime forward, so the final write is the
    // departure actually stored. Keeping the first would contradict the record.
    const events = await seed([
      { type: 'CHECK_OUT', at: T0 },
      { type: 'CHECK_OUT', at: T0 + 3_000 },
      { type: 'CHECK_OUT', at: T0 + 6_000 },
    ]);

    expect(events).toEqual([{ type: 'CHECK_OUT', at: T0 + 6_000 }]);
  });

  it('preserves a genuine correction made minutes later', async () => {
    // Someone noticing a wrong time and re-declaring. Not machine repetition,
    // and it must survive: it is the whole point of "check out again".
    const events = await seed([
      { type: 'CHECK_OUT', at: T0 },
      { type: 'CHECK_OUT', at: T0 + 13 * 60_000 },
    ]);

    expect(events).toHaveLength(2);
  });

  it('does not merge across the window boundary', async () => {
    // Exactly at the bound collapses; a millisecond beyond it does not.
    const atBound = await seed([
      { type: 'CHECK_OUT', at: T0 },
      { type: 'CHECK_OUT', at: T0 + 10_000 },
    ]);
    expect(atBound).toHaveLength(1);

    await AsyncStorage.clear();

    const pastBound = await seed([
      { type: 'CHECK_OUT', at: T0 },
      { type: 'CHECK_OUT', at: T0 + 10_001 },
    ]);
    expect(pastBound).toHaveLength(2);
  });

  it('never merges CHECK_OUTs separated by another event', async () => {
    // A re-entry between them means the person left and came back. Two
    // departures either side of that are distinct facts however close in time.
    const events = await seed([
      { type: 'CHECK_OUT', at: T0 },
      { type: 'RE_ENTRY', at: T0 + 1_000 },
      { type: 'CHECK_OUT', at: T0 + 2_000 },
    ]);

    expect(events.map(e => e.type)).toEqual(['CHECK_OUT', 'RE_ENTRY', 'CHECK_OUT']);
  });

  it('leaves every other event type exactly as written', async () => {
    // Repetition of anything else is not this bug and is not ours to tidy.
    const original: AttendanceEvent[] = [
      { type: 'FIRST_DETECTED', at: T0, rssi: -55 },
      { type: 'CHECK_IN', at: T0 + 500, rssi: -50 },
      { type: 'RE_ENTRY', at: T0 + 900 },
      { type: 'RE_ENTRY', at: T0 + 950 },
      { type: 'LEFT', at: T0 + 1_000 },
    ];

    const events = await seed(original);

    expect(events).toEqual(original);
  });

  it('leaves a lone CHECK_OUT alone', async () => {
    const events = await seed([
      { type: 'CHECK_IN', at: T0 },
      { type: 'CHECK_OUT', at: T0 + 60_000 },
    ]);

    expect(events).toHaveLength(2);
  });
});
