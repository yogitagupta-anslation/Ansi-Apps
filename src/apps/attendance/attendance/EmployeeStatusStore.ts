/**
 * EmployeeStatusStore.ts
 * -----------------------------------------------------------------------------
 * The employee device's own copy of its attendance, AS REPORTED BY A HOST over
 * the BLE reply channel. The only place the employee UI may read a check-in
 * time or a past day from — everything here arrived over the air from a Host
 * write, never from local guessing.
 *
 * WHAT THIS IS AND IS NOT
 * -----------------------
 * It is a LOG OF WHAT WAS DELIVERED, not a mirror of the Host's database. The
 * employee phone learns about a day only when a Host is in range and writes to
 * it. So:
 *
 *   - a day the phone was never told about is UNKNOWN, not absent;
 *   - history is complete only up to `lastSyncedAt`;
 *   - the Host remains the system of record, and the UI says so.
 *
 * Presenting this as authoritative would be the same lie as the old fake
 * PRESENT card, one level deeper.
 *
 * MERGE RULE: a delivered day always replaces a stored one for the same date.
 * The Host is the authority, so its latest word wins — including corrections,
 * such as a PRESENT day later becoming LEFT.
 * -----------------------------------------------------------------------------
 */

import type { HistoryDay, StatusReport } from '../bluetooth/statusReport';
import { todayDateString } from '../constants/appConfig';
import { readJson, writeJson } from '../storage/AppStorage';
import { log } from '../utils/logger';

const STORAGE_KEY = '@bleattendance/employeeStatusReport';
const HISTORY_KEY = '@bleattendance/employeeHistory';

/** One day as this phone knows it. Times are minutes since local midnight. */
export interface StoredDay {
  date: string;
  status: HistoryDay['status'];
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
  /** Which Host reported it, for attribution. */
  hostId: string;
  /** When this phone received it. */
  receivedAt: number;
}

interface HistoryFile {
  /** date -> day. Keyed so a re-delivery corrects rather than duplicates. */
  days: Record<string, StoredDay>;
  lastSyncedAt: number | null;
}

type Listener = (report: StatusReport | null) => void;
type HistoryListener = (history: HistoryFile) => void;

let cached: StatusReport | null = null;
let history: HistoryFile = { days: {}, lastSyncedAt: null };
let loaded = false;
const listeners = new Set<Listener>();
const historyListeners = new Set<HistoryListener>();

function notify(): void {
  const today = EmployeeStatusStore.getTodayReport();
  listeners.forEach(listener => listener(today));
  historyListeners.forEach(listener => listener(history));
}

/** Minutes since midnight for a timestamp on its own day. */
function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export const EmployeeStatusStore = {
  async initialize(): Promise<void> {
    if (loaded) {
      return;
    }
    cached = await readJson<StatusReport | null>(STORAGE_KEY, null);
    history = await readJson<HistoryFile>(HISTORY_KEY, { days: {}, lastSyncedAt: null });
    loaded = true;
    notify();
  },

  /**
   * Accept a report from the radio. Returns true when today's status was
   * stored; history is merged regardless, because a stale-dated report can
   * still carry days this phone has never seen.
   */
  async accept(report: StatusReport): Promise<boolean> {
    const now = Date.now();

    /* ------------------------------------------------------- history -- */

    const incoming: StoredDay[] = (report.historyDays ?? []).map(d => ({
      date: d.date,
      status: d.status,
      checkInMinutes: d.checkInMinutes,
      checkOutMinutes: d.checkOutMinutes,
      hostId: report.hostId,
      receivedAt: now,
    }));

    // The report's own day is authoritative for itself and may be fresher than
    // the history block, so it is merged last.
    incoming.push({
      date: report.date,
      status: report.status,
      checkInMinutes: minutesOfDay(report.checkInTime),
      // Today has no observed check-out until the Host says the person left.
      checkOutMinutes: report.leftTime !== null ? minutesOfDay(report.leftTime) : null,
      hostId: report.hostId,
      receivedAt: now,
    });

    const days = { ...history.days };
    incoming.forEach(day => {
      days[day.date] = day;
    });
    history = { days, lastSyncedAt: now };
    await writeJson(HISTORY_KEY, history);

    /* --------------------------------------------------- today status -- */

    let storedToday = true;
    if (cached) {
      if (report.date < cached.date) {
        log.warn('ADVERTISE', 'Dropped status report for past date ' + report.date);
        storedToday = false;
      } else if (report.date === cached.date && report.reportedAt <= cached.reportedAt) {
        // Duplicate or replayed delivery; the stored one is newer or equal.
        storedToday = false;
      }
    }
    if (storedToday) {
      cached = report;
      await writeJson(STORAGE_KEY, report);
    }

    notify();
    return storedToday;
  },

  /** Today's report, or null. Past days are history, not current status. */
  getTodayReport(): StatusReport | null {
    if (!cached || cached.date !== todayDateString()) {
      return null;
    }
    return cached;
  },

  /** Every day this phone has been told about, newest first. */
  getHistory(): StoredDay[] {
    return Object.values(history.days).sort((a, b) => b.date.localeCompare(a.date));
  },

  /** When a Host last wrote to this phone, or null if never. */
  getLastSyncedAt(): number | null {
    return history.lastSyncedAt;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(EmployeeStatusStore.getTodayReport());
    return () => {
      listeners.delete(listener);
    };
  },

  subscribeHistory(listener: HistoryListener): () => void {
    historyListeners.add(listener);
    listener(history);
    return () => {
      historyListeners.delete(listener);
    };
  },
};
