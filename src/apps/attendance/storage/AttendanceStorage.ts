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
function normalize(record: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: record.id ?? record.date + ':' + record.employeeId,
    employeeId: record.employeeId ?? '',
    employeeName: record.employeeName ?? '',
    date: record.date ?? '',
    checkInTime: record.checkInTime ?? null,
    lastSeenTime: record.lastSeenTime ?? record.checkInTime ?? null,
    leftTime: record.leftTime ?? null,
    firstDetectedAt: record.firstDetectedAt ?? record.checkInTime ?? null,
    lastDetectedAt: record.lastDetectedAt ?? record.lastSeenTime ?? null,
    hostId: record.hostId ?? '',
    checkInRssi: record.checkInRssi ?? null,
    events: record.events ?? [],
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
