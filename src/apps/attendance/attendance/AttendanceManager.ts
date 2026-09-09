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

      /**
       * Re-entry clears an INFERRED departure but never a DECLARED one.
       *
       * An inferred leftTime is a deduction from silence, and this detection
       * is direct evidence against it — so it goes. A declared one is the
       * employee's own statement, already delivered back to their phone and
       * shown to them as confirmed; a later sighting does not unsay it, it
       * only adds that they were seen again, which the RE_ENTRY event below
       * records. Clearing it would take back a number the app had displayed.
       *
       * They can declare a second departure later if they really do work on;
       * recordDeclaredCheckOut accepts a LATER time for exactly that.
       */
      const clearsLeft = wasLeft && existing.leftTimeSource !== 'DECLARED';

      const updated: AttendanceRecord = {
        ...existing,
        lastSeenTime: now,
        lastDetectedAt: now,
        leftTime: clearsLeft ? null : existing.leftTime,
        leftTimeSource: clearsLeft ? null : existing.leftTimeSource,
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
      leftTimeSource: null,
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
        // Deduced from silence, not stated by anyone. Labelling it here is what
        // lets re-entry know it is allowed to take this one back.
        leftTimeSource: 'INFERRED',
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

  /* =================================================== declared exit === */

  /**
   * Record a departure the EMPLOYEE declared, which this Host has just
   * observed on the air.
   *
   * WHOSE OBSERVATION IS THIS? The employee's phone raises a flag in its
   * advertisement; `leftAt` is the moment THIS Host first saw that flag, on
   * this Host's own clock. Nothing is inferred and no clock is imported from
   * the other device, so there is no skew to correct and nothing to reconcile.
   * The lag between the tap and this instant is one scan interval — about a
   * second — because the flag rides the advertisement rather than waiting for
   * a connection.
   *
   * WHY NOT JUST SET leftTime? Because `deriveStatus` would disagree. It reads
   * `lastSeenTime` arithmetic alone and will keep saying PRESENT while the
   * phone is still in range — correctly, since the radio genuinely still hears
   * it. Those are two different true facts, and `leftTimeSource` is what keeps
   * them distinguishable instead of letting one quietly overwrite the other.
   * Within one grace period of the person actually walking out the two agree
   * again, on their own.
   *
   * Returns the updated record, or null when the declaration was refused —
   * refusals are logged and are never turned into an approximate time.
   */
  async recordDeclaredCheckOut(
    employeeId: string,
    leftAt: number,
  ): Promise<AttendanceRecord | null> {
    await this.rolloverIfNewDay();

    const existing = this.todayCache.get(employeeId) ?? null;

    // Nobody can leave a day they never arrived on. This is not an edge case:
    // a phone can advertise the flag before its Host has confirmed a check-in.
    if (!existing || existing.checkInTime === null) {
      log.warn(
        'ATTENDANCE',
        'Declared check-out from ' + employeeId + ' ignored - no check-in today',
      );
      return null;
    }

    // A departure before the arrival is incoherent. Clamping it into range
    // would manufacture a time nobody observed, so it is refused outright.
    if (leftAt < existing.checkInTime) {
      log.warn(
        'ATTENDANCE',
        'Declared check-out from ' + employeeId + ' ignored - earlier than check-in',
      );
      return null;
    }

    /**
     * An INFERRED departure already standing is left alone: the grace sweep
     * observed real silence, and a declaration arriving afterwards is the
     * stale one. A DECLARED departure may be replaced, but only by a LATER
     * one — that is someone who came back, worked on and is now leaving
     * again. Moving a declared time EARLIER would rewrite a number the
     * employee has already been shown as confirmed.
     */
    if (existing.leftTime !== null) {
      const replaceable =
        existing.leftTimeSource === 'DECLARED' && leftAt > existing.leftTime;
      if (!replaceable) {
        return null;
      }
    }

    const updated: AttendanceRecord = {
      ...existing,
      leftTime: leftAt,
      leftTimeSource: 'DECLARED',
      events: [...existing.events, { type: 'CHECK_OUT', at: leftAt }],
    };

    this.todayCache.set(employeeId, updated);
    await this.persist(updated);
    this.detectionStreak.delete(employeeId);
    this.notify();

    log.info(
      'ATTENDANCE',
      'CHECK_OUT ' + existing.employeeName + ' (' + employeeId + ') declared departure',
    );

    return updated;
  }

  /**
   * Take back a declared departure. The employee says they are still here.
   *
   * WHY THIS IS HONEST. A declared departure is a statement, and a statement
   * can be mistaken — a pocket press, or leaving and immediately returning.
   * The employee is the only one who knows, and the Host has direct evidence
   * agreeing with them: the radio is still hearing the phone, which is why
   * `deriveStatus` has been saying PRESENT throughout. Clearing the departure
   * removes a claim the record should never have held; it does not invent one.
   *
   * ONLY A DECLARED DEPARTURE. An INFERRED one was deduced from real silence
   * and is not the employee's to retract — and it does not need retracting,
   * because a fresh detection already clears it on re-entry.
   *
   * The CHECK_OUT event stays in the log with a CHECK_OUT_CANCELLED after it.
   * Both happened, and an audit trail that quietly dropped the first would be
   * a worse record than one that shows a person changing their mind.
   */
  async cancelDeclaredCheckOut(employeeId: string): Promise<AttendanceRecord | null> {
    await this.rolloverIfNewDay();

    const existing = this.todayCache.get(employeeId) ?? null;

    if (!existing || existing.leftTime === null) {
      return null;
    }

    if (existing.leftTimeSource !== 'DECLARED') {
      log.warn(
        'ATTENDANCE',
        'Cancel from ' + employeeId + ' ignored - departure was inferred, not declared',
      );
      return null;
    }

    const now = Date.now();

    const updated: AttendanceRecord = {
      ...existing,
      leftTime: null,
      leftTimeSource: null,
      events: [...existing.events, { type: 'CHECK_OUT_CANCELLED', at: now }],
    };

    this.todayCache.set(employeeId, updated);
    await this.persist(updated);
    this.notify();

    log.info(
      'ATTENDANCE',
      'CHECK_OUT_CANCELLED ' + existing.employeeName + ' (' + employeeId + ') is still here',
    );

    return updated;
  }

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
