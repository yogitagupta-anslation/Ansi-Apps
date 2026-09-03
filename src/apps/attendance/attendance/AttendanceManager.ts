/**
 * AttendanceManager.ts
 * -----------------------------------------------------------------------------
 * The attendance engine. The ONLY place allowed to create or modify an
 * attendance record.
 *
 *   BLE detection -> registered? -> nearby? -> N consecutive -> CHECK_IN
 *   while in range                                           -> lastSeenTime++
 *   silence > grace                                          -> LEFT
 *   detected again                                           -> RE_ENTRY
 *
 * TWO PROPERTIES THIS FILE GUARANTEES
 *
 * 1. Status is DERIVED, never assigned. Every read goes through
 *    deriveStatus(record, now, grace). Nothing anywhere sets `status = 'LEFT'`
 *    because a timer fired - the arithmetic on lastSeenTime decides, so a
 *    late, early or missed tick cannot corrupt the verdict.
 *
 * 2. A check-in is permanent. `checkInTime` is written once per employee per
 *    day and never cleared. Reloading, restarting, Bluetooth dying or the
 *    process being killed cannot erase it, because it lives in storage rather
 *    than React state.
 * -----------------------------------------------------------------------------
 */

import { todayDateString } from '../constants/appConfig';
import type { ProximityConfig } from '../constants/proximityConfig';
import type { DetectedEmployee } from '../employees/employeeTypes';
import { AttendanceStorage } from '../storage/AttendanceStorage';
import { log } from '../utils/logger';
import {
  deriveStatus,
  type AttendanceEvent,
  type AttendanceRecord,
  type AttendanceStatus,
  type DetectionOutcome,
  type TodaySummary,
} from './attendanceTypes';

export interface AttendanceManagerConfig {
  hostId: string;
  proximity: ProximityConfig;
}

type Listener = (records: AttendanceRecord[]) => void;

export class AttendanceManager {
  private config: AttendanceManagerConfig;

  /**
   * Today's records, cached in memory and kept in sync with storage.
   *
   * The scanner reports the same employee several times per second; hitting
   * the database on every advertisement would be slow and pointless. Storage
   * remains the source of truth - this is a write-through cache.
   */
  private todayCache = new Map<string, AttendanceRecord>();
  private cachedDate: string = todayDateString();

  /**
   * Consecutive qualifying detections per employee, in memory only.
   *
   * Deliberately NOT persisted: a confirmation streak is meaningless across an
   * app restart. After a restart the employee must be freshly confirmed, which
   * is the honest behaviour.
   */
  private detectionStreak = new Map<string, number>();

  /**
   * Employees whose lastSeenTime has moved since the last flush. Batches the
   * continuous "still here" updates so storage is written on a cadence rather
   * than on every advertisement.
   */
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private listeners = new Set<Listener>();

  constructor(config: AttendanceManagerConfig) {
    this.config = config;
  }

  /** Load today's records. Call once when Host mode starts. */
  async initialize(): Promise<void> {
    this.cachedDate = todayDateString();
    const records = await AttendanceStorage.getByDate(this.cachedDate);
    this.todayCache.clear();
    records.forEach(r => this.todayCache.set(r.employeeId, r));
    log.info(
      'ATTENDANCE',
      'Restored ' + records.length + ' record(s) for ' + this.cachedDate,
    );
    this.startFlushTimer();
    this.notify();
  }

  updateConfig(patch: Partial<AttendanceManagerConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  dispose(): void {
    this.stopFlushTimer();
    void this.flush();
  }

  /* ======================================================== detection === */

  /**
   * Feed one live detection in.
   *
   * Safe to call at any rate. Cheap in the common case: an already-checked-in
   * employee just has a timestamp bumped in memory.
   */
  async detectEmployee(detection: DetectedEmployee): Promise<DetectionOutcome> {
    const { employeeId, employee } = detection;

    // Re-checked here rather than trusting the caller: nothing marks
    // attendance for an unregistered or disabled id.
    if (!employee) {
      return { kind: 'NOT_REGISTERED', employeeId };
    }
    if (!employee.enabled) {
      return { kind: 'DISABLED', employeeId };
    }

    await this.rolloverIfNewDay();

    const now = Date.now();
    const existing = this.todayCache.get(employeeId) ?? null;
    const grace = this.config.proximity.missingGracePeriodMs;

    // Status BEFORE this detection - decides check-in vs re-entry.
    const statusBefore = deriveStatus(existing, now, grace);

    // --- already attended today -------------------------------------------
    if (existing && existing.checkInTime !== null) {
      const wasLeft = statusBefore === 'LEFT';

      const updated: AttendanceRecord = {
        ...existing,
        lastSeenTime: now,
        lastDetectedAt: now,
        // Re-entry clears leftTime: the employee is demonstrably back, so a
        // stale departure time would misrepresent the day.
        leftTime: wasLeft ? null : existing.leftTime,
        events: wasLeft
          ? [...existing.events, { type: 'RE_ENTRY', at: now, rssi: detection.smoothedRssi } as AttendanceEvent]
          : existing.events,
      };

      this.todayCache.set(employeeId, updated);

      if (wasLeft) {
        log.info(
          'ATTENDANCE',
          employee.displayName + ' (' + employeeId + ') re-entered range',
        );
        // A transition is worth writing immediately, not on the next flush.
        await this.persist(updated);
        this.notify();
        return { kind: 'RE_ENTERED', record: updated };
      }

      // Routine "still here": batch it.
      this.dirty.add(employeeId);
      return { kind: 'STILL_PRESENT', record: updated };
    }

    // --- not yet checked in today -----------------------------------------
    const threshold = this.config.proximity.minimumRssi;

    // Record the sighting even when too weak to count, so the Debug screen and
    // firstDetectedAt reflect that the employee WAS heard.
    const seedRecord: AttendanceRecord = existing ?? {
      id: this.cachedDate + ':' + employeeId,
      employeeId,
      employeeName: employee.displayName,
      date: this.cachedDate,
      checkInTime: null,
      lastSeenTime: null,
      leftTime: null,
      firstDetectedAt: now,
      lastDetectedAt: now,
      hostId: this.config.hostId,
      checkInRssi: null,
      events: [{ type: 'FIRST_DETECTED', at: now, rssi: detection.smoothedRssi }],
    };

    if (!detection.isNearby) {
      // Weak signal breaks the confirmation streak.
      this.detectionStreak.set(employeeId, 0);
      const touched = { ...seedRecord, lastDetectedAt: now };
      this.todayCache.set(employeeId, touched);
      this.dirty.add(employeeId);
      return { kind: 'TOO_FAR', rssi: detection.smoothedRssi, threshold };
    }

    const streak = (this.detectionStreak.get(employeeId) ?? 0) + 1;
    this.detectionStreak.set(employeeId, streak);

    const required = this.config.proximity.requiredConsecutiveDetections;

    if (streak < required) {
      log.info(
        'ATTENDANCE',
        'Detection ' + streak + '/' + required + ' for ' + employeeId,
      );
      const touched = { ...seedRecord, lastDetectedAt: now };
      this.todayCache.set(employeeId, touched);
      this.dirty.add(employeeId);
      return { kind: 'AWAITING_CONFIRMATION', detections: streak, required };
    }

    // --- confirmed: check in ----------------------------------------------
    const record: AttendanceRecord = {
      ...seedRecord,
      employeeName: employee.displayName,
      checkInTime: now,
      lastSeenTime: now,
      lastDetectedAt: now,
      checkInRssi: detection.smoothedRssi,
      events: [
        ...seedRecord.events,
        { type: 'CHECK_IN', at: now, rssi: detection.smoothedRssi },
      ],
    };

    this.todayCache.set(employeeId, record);
    await this.persist(record);

    log.info('ATTENDANCE', 'CHECK_IN ' + employee.displayName + ' (' + employeeId + ')');
    log.info('ATTENDANCE', 'Confirmed by ' + streak + ' consecutive detections at ' + detection.smoothedRssi + ' dBm');

    this.notify();
    return { kind: 'CHECKED_IN', record };
  }

  /* ============================================================== LEFT === */

  /**
   * Recompute PRESENT -> LEFT for everyone.
   *
   * Called on a timer, on foreground, and after restore. It is NOT a countdown:
   * the verdict is always `now - lastSeenTime > grace`, so running it late,
   * early, or twice makes no difference. That is what keeps the state honest
   * across backgrounding and process death.
   */
  async evaluateLeftStatuses(now: number = Date.now()): Promise<void> {
    const grace = this.config.proximity.missingGracePeriodMs;
    let changed = false;

    for (const [employeeId, record] of this.todayCache) {
      if (record.checkInTime === null || record.lastSeenTime === null) {
        continue;
      }
      // Already recorded as gone.
      if (record.leftTime !== null) {
        continue;
      }
      if (deriveStatus(record, now, grace) !== 'LEFT') {
        continue;
      }

      // leftTime is when the grace period ELAPSED, not when we noticed. If the
      // app was closed for an hour, the departure is still dated correctly.
      const leftAt = record.lastSeenTime + grace;

      const updated: AttendanceRecord = {
        ...record,
        leftTime: leftAt,
        events: [...record.events, { type: 'LEFT', at: leftAt }],
      };

      this.todayCache.set(employeeId, updated);
      await this.persist(updated);
      this.detectionStreak.delete(employeeId);
      changed = true;

      log.info(
        'ATTENDANCE',
        'LEFT ' + record.employeeName + ' (' + employeeId + ') - no detection for ' +
          Math.round((now - record.lastSeenTime) / 1000) + 's',
      );
    }

    if (changed) {
      this.notify();
    }
  }

  /* ============================================================= reads === */

  getStatus(employeeId: string, now: number = Date.now()): AttendanceStatus {
    return deriveStatus(
      this.todayCache.get(employeeId) ?? null,
      now,
      this.config.proximity.missingGracePeriodMs,
    );
  }

  getTodayRecord(employeeId: string): AttendanceRecord | null {
    return this.todayCache.get(employeeId) ?? null;
  }

  getTodayRecords(): AttendanceRecord[] {
    return Array.from(this.todayCache.values()).sort(
      (a, b) => (a.checkInTime ?? Infinity) - (b.checkInTime ?? Infinity),
    );
  }

  async getAttendanceHistory(limit = 90) {
    return AttendanceStorage.getDaySummaries(limit);
  }

  async getAttendanceForDate(date: string): Promise<AttendanceRecord[]> {
    return AttendanceStorage.getByDate(date);
  }

  async getAttendanceForEmployee(employeeId: string): Promise<AttendanceRecord[]> {
    return AttendanceStorage.getByEmployee(employeeId);
  }

  buildTodaySummary(totalEmployees: number, now: number = Date.now()): TodaySummary {
    const grace = this.config.proximity.missingGracePeriodMs;
    let presentCount = 0;
    let leftCount = 0;

    this.todayCache.forEach(record => {
      const status = deriveStatus(record, now, grace);
      if (status === 'PRESENT') {
        presentCount++;
      } else if (status === 'LEFT') {
        leftCount++;
      }
    });

    const attendedCount = presentCount + leftCount;
    return {
      date: this.cachedDate,
      presentCount,
      leftCount,
      absentCount: Math.max(0, totalEmployees - attendedCount),
      attendedCount,
      totalEmployees,
    };
  }

  /* ========================================================= internals === */

  /**
   * Roll over at midnight.
   *
   * Only the in-memory view of "today" resets. Yesterday's records stay in
   * storage untouched - a new day simply means nobody has checked in yet.
   */
  private async rolloverIfNewDay(): Promise<void> {
    const today = todayDateString();
    if (today === this.cachedDate) {
      return;
    }
    log.info('ATTENDANCE', 'Date rolled over to ' + today);
    await this.flush();
    this.cachedDate = today;
    this.detectionStreak.clear();
    const records = await AttendanceStorage.getByDate(today);
    this.todayCache.clear();
    records.forEach(r => this.todayCache.set(r.employeeId, r));
    this.notify();
  }

  private async persist(record: AttendanceRecord): Promise<void> {
    this.dirty.delete(record.employeeId);
    await AttendanceStorage.save(record);
  }

  /**
   * Write out batched lastSeenTime updates AND publish them.
   *
   * The notify() is load-bearing, not housekeeping. A routine "still here"
   * detection updates only the cache and marks the employee dirty — it does
   * not notify, because notifying on every advertisement would re-render the
   * whole app several times a second.
   *
   * Without a notify here, subscribers keep the record snapshot from the last
   * TRANSITION. Its lastSeenTime then never advances, so `deriveStatus` on the
   * UI side eventually reports LEFT for somebody standing in the room — while
   * buildTodaySummary(), which reads the live cache, still reports PRESENT.
   * That is exactly the split that showed one employee as Present in the
   * header tiles and Left in the list directly underneath.
   *
   * Publishing on the flush tick keeps subscribers within 5s of the cache at
   * a fixed, bounded render cost.
   */
  private async flush(): Promise<void> {
    if (this.dirty.size === 0) {
      return;
    }
    const ids = Array.from(this.dirty);
    this.dirty.clear();
    for (const id of ids) {
      const record = this.todayCache.get(id);
      if (record) {
        await AttendanceStorage.save(record);
      }
    }
    this.notify();
  }

  private startFlushTimer(): void {
    this.stopFlushTimer();
    // 5s: frequent enough that a crash loses almost nothing, infrequent enough
    // that a room full of employees is not writing storage continuously.
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 5000);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /* ===================================================== subscription === */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getTodayRecords());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const records = this.getTodayRecords();
    this.listeners.forEach(listener => listener(records));
  }

  /** Erase all history. Destructive; reachable only from a confirmation dialog. */
  async clearAllAttendance(): Promise<void> {
    await AttendanceStorage.clearAll();
    this.todayCache.clear();
    this.detectionStreak.clear();
    this.dirty.clear();
    log.warn('ATTENDANCE', 'All attendance history cleared by user');
    this.notify();
  }
}
