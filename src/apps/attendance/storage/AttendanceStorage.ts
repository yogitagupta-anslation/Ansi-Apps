/**
 * AttendanceStorage.ts
 * -----------------------------------------------------------------------------
 * Persistence for attendance records. Date-aware: records are keyed by
 * (date, employeeId), so a new day starts empty while history is preserved.
 *
 * This layer stores and retrieves. It holds no business rules - it never
 * decides whether someone is PRESENT or LEFT. That belongs to
 * AttendanceManager, which derives status from the timestamps stored here.
 * -----------------------------------------------------------------------------
 */

import type {
  AttendanceDaySummary,
  AttendanceEvent,
  AttendanceRecord,
} from '../attendance/attendanceTypes';
import { MAX_EVENTS_PER_RECORD } from '../attendance/attendanceTypes';
import { readJson, STORAGE_KEYS, WriteQueue, writeJson } from './AppStorage';

const queue = new WriteQueue();

async function readAll(): Promise<AttendanceRecord[]> {
  return readJson<AttendanceRecord[]>(STORAGE_KEYS.attendance, []);
}

/**
 * Records written by an older build may lack fields added later. Normalising on
 * read means a schema addition never turns into a crash on someone's existing
 * data - the missing fields simply come back null.
 */
/**
 * A run of CHECK_OUT events closer together than a person could produce.
 *
 * An earlier build recorded a declared departure on the LEVEL of the check-out
 * flag rather than its rising edge. The flag rides every advertisement until a
 * receipt comes back, so the Host appended a CHECK_OUT several times a second
 * — thousands on a single record — which pushed the day's real events out of
 * the 50-entry log entirely.
 *
 * Ten seconds is far above the advertisement interval that caused this and far
 * below any interval a human can produce: re-declaring a departure means
 * noticing a wrong time, reading the screen and tapping, which is tens of
 * seconds at the very least. So a gap under this bound is machine repetition,
 * not a person changing their mind.
 */
const DUPLICATE_CHECK_OUT_WINDOW_MS = 10_000;

/**
 * Collapse each run of machine-repeated CHECK_OUT events to its LAST entry.
 *
 * The last one is kept, not the first, because it is the one that matches the
 * record's stored `leftTime` — the repetition walked the departure forward,
 * and the final write is the time the record actually holds.
 *
 * Deliberately narrow. Only CHECK_OUT is touched, only consecutive ones, and
 * only within the window above, so a genuine correction minutes later survives
 * as its own event. Anything else in the log is left exactly as written: this
 * repairs a known defect, it does not tidy an audit trail to taste.
 *
 * What it cannot repair: on a badly affected record the real FIRST_DETECTED
 * and CHECK_IN entries were already evicted by the 50-entry cap before this
 * ran. Those are gone. The timestamps they described survive as fields on the
 * record itself, which is why the screens still show a correct check-in.
 */
function collapseRepeatedCheckOuts(events: AttendanceEvent[]): AttendanceEvent[] {
  const out: AttendanceEvent[] = [];

  for (const event of events) {
    const previous = out[out.length - 1];
    const isRepeat =
      event.type === 'CHECK_OUT' &&
      previous?.type === 'CHECK_OUT' &&
      event.at - previous.at <= DUPLICATE_CHECK_OUT_WINDOW_MS;

    if (isRepeat) {
      out[out.length - 1] = event;
    } else {
      out.push(event);
    }
  }

  return out;
}

function normalize(record: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: record.id ?? record.date + ':' + record.employeeId,
    employeeId: record.employeeId ?? '',
    employeeName: record.employeeName ?? '',
    date: record.date ?? '',
    checkInTime: record.checkInTime ?? null,
    lastSeenTime: record.lastSeenTime ?? record.checkInTime ?? null,
    leftTime: record.leftTime ?? null,
    // A record written before this field existed can only have got its
    // leftTime from the grace sweep, because declaring one was not possible
    // then. INFERRED is therefore the truthful backfill, not a guess.
    leftTimeSource: record.leftTimeSource ?? (record.leftTime != null ? 'INFERRED' : null),
    firstDetectedAt: record.firstDetectedAt ?? record.checkInTime ?? null,
    lastDetectedAt: record.lastDetectedAt ?? record.lastSeenTime ?? null,
    hostId: record.hostId ?? '',
    checkInRssi: record.checkInRssi ?? null,
    events: collapseRepeatedCheckOuts(record.events ?? []),
  };
}

export const AttendanceStorage = {
  /**
   * Every stored record, normalised. Used by the monthly report, which needs
   * to see across dates rather than one day at a time.
   *
   * Reads from disk each call rather than caching: reports are opened rarely,
   * and a stale cache here would silently under-report a month.
   */
  async getAll(): Promise<AttendanceRecord[]> {
    const all = await readAll();
    return all.map(normalize);
  },

  async getByDate(date: string): Promise<AttendanceRecord[]> {
    const all = await readAll();
    return all
      .filter(r => r.date === date)
      .map(normalize)
      .sort((a, b) => (a.checkInTime ?? 0) - (b.checkInTime ?? 0));
  },

  async findOne(employeeId: string, date: string): Promise<AttendanceRecord | null> {
    const all = await readAll();
    const found = all.find(r => r.employeeId === employeeId && r.date === date);
    return found ? normalize(found) : null;
  },

  async getByEmployee(employeeId: string): Promise<AttendanceRecord[]> {
    const all = await readAll();
    return all
      .filter(r => r.employeeId === employeeId)
      .map(normalize)
      .sort((a, b) => (b.checkInTime ?? 0) - (a.checkInTime ?? 0));
  },

  /**
   * Insert or update the record for (employeeId, date).
   *
   * The uniqueness guarantee lives here: one record per employee per day,
   * always. Repeated detections update the existing row rather than appending,
   * which is what makes the scanner's several-per-second callbacks harmless.
   */
  async save(record: AttendanceRecord): Promise<AttendanceRecord> {
    return queue.run(async () => {
      const all = await readAll();
      const index = all.findIndex(
        r => r.employeeId === record.employeeId && r.date === record.date,
      );

      // Cap the audit trail, keeping the most recent entries.
      const trimmed: AttendanceRecord = {
        ...record,
        events: record.events.slice(-MAX_EVENTS_PER_RECORD),
      };

      if (index >= 0) {
        all[index] = trimmed;
      } else {
        all.push(trimmed);
      }

      await writeJson(STORAGE_KEYS.attendance, all);
      return trimmed;
    });
  },

  /** Append an event to an existing record. No-op if the record is missing. */
  async appendEvent(
    employeeId: string,
    date: string,
    event: AttendanceEvent,
  ): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      const index = all.findIndex(r => r.employeeId === employeeId && r.date === date);
      if (index < 0) {
        return;
      }
      const record = normalize(all[index]);
      record.events = [...record.events, event].slice(-MAX_EVENTS_PER_RECORD);
      all[index] = record;
      await writeJson(STORAGE_KEYS.attendance, all);
    });
  },

  /**
   * Day-by-day roll-up, newest first.
   *
   * `presentCount` here means "attended at all that day" - anyone with a
   * check-in, whether or not they later left. For a past date that is the only
   * meaningful reading of the number.
   */
  async getDaySummaries(limit = 60): Promise<AttendanceDaySummary[]> {
    const all = await readAll();
    const byDate = new Map<string, { attended: number; left: number }>();

    all.forEach(raw => {
      const r = normalize(raw);
      if (r.checkInTime === null) {
        return;
      }
      const entry = byDate.get(r.date) ?? { attended: 0, left: 0 };
      entry.attended += 1;
      if (r.leftTime !== null) {
        entry.left += 1;
      }
      byDate.set(r.date, entry);
    });

    return Array.from(byDate.entries())
      .map(([date, e]) => ({
        date,
        presentCount: e.attended,
        leftCount: e.left,
        totalEmployees: 0,
      }))
      // ISO YYYY-MM-DD sorts correctly as a plain string.
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit);
  },

  async totalCount(): Promise<number> {
    return (await readAll()).length;
  },

  async clearAll(): Promise<void> {
    await queue.run(async () => {
      await writeJson(STORAGE_KEYS.attendance, []);
    });
  },
};
