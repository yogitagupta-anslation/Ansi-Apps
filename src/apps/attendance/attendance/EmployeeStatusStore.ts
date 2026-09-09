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
import { readJson, writeJson, STORAGE_KEYS } from '../storage/AppStorage';
import { log } from '../utils/logger';

/**
 * Owned by STORAGE_KEYS so the wipe can see them.
 *
 * These were local string literals, invisible to clearAllLocalData, and that is
 * how "Erase all local data" came to leave an employee's own attendance behind.
 */
const STORAGE_KEY = STORAGE_KEYS.employeeStatusReport;
const HISTORY_KEY = STORAGE_KEYS.employeeHistory;

/** One day as this phone knows it. Times are minutes since local midnight. */
export interface StoredDay {
  date: string;
  status: HistoryDay['status'];
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
  /**
   * checkOutMinutes is a departure this employee STATED and a Host recorded,
   * rather than the last moment the Host heard this phone.
   *
   * Optional because every day stored before check-outs existed predates the
   * distinction; absent reads as "observed", which is what those days were.
   * The screens use it to avoid claiming "the Host stopped seeing this device"
   * about a departure where the Host was, in fact, still seeing it.
   */
  checkOutDeclared?: boolean;
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
      ...(d.checkOutDeclared ? { checkOutDeclared: true } : {}),
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
      ...(report.leftTimeDeclared ? { checkOutDeclared: true } : {}),
      hostId: report.hostId,
      receivedAt: now,
    });

    /**
     * A stored DECLARED check-out is never replaced by an observed one.
     *
     * Ordinarily the incoming block simply wins — it is the Host's current
     * view and corrects anything stale. But a declared departure is a number
     * this phone has already shown its owner as confirmed, and the Host's
     * history reports the last observed signal for any day it does not mark
     * declared. A Host on an older build never sends the marks at all, so
     * without this guard yesterday's stated 18:00 would quietly become the
     * 18:34 the radio last heard, on a screen that had promised otherwise.
     *
     * The narrow rule: keep the declaration, take everything else from the
     * incoming day, so status and check-in still correct normally.
     */
    const days = { ...history.days };
    incoming.forEach(day => {
      const stored = days[day.date];
      const wouldDropDeclaration =
        stored?.checkOutDeclared === true &&
        !day.checkOutDeclared &&
        stored.checkOutMinutes !== null;

      days[day.date] = wouldDropDeclaration
        ? {
            ...day,
            checkOutMinutes: stored.checkOutMinutes,
            checkOutDeclared: true,
          }
        : day;
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

  /**
   * Forget everything this phone was told about its own attendance.
   *
   * Storage is cleared by clearAllLocalData, which now covers both keys. This
   * handles the half that lives in memory: `cached` and `history` are
   * module-level and survive any amount of key deletion, so without this the
   * screens keep rendering the erased times until the next app launch — the
   * user asks to erase their data and watches it stay on screen.
   *
   * `loaded` is reset too, so a later initialize() re-reads from disk rather
   * than short-circuiting on a flag set before the wipe.
   */
  clear(): void {
    cached = null;
    history = { days: {}, lastSyncedAt: null };
    loaded = false;
    notify();
  },
};
