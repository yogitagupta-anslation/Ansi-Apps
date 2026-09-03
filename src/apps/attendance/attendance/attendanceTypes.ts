/**
 * attendanceTypes.ts
 * -----------------------------------------------------------------------------
 * THE STATE MACHINE
 *
 *   ABSENT ──(confirmed nearby)──> PRESENT ──(grace exceeded)──> LEFT
 *      ▲                              ▲                            │
 *      │                              └────(detected again)────────┘
 *      │
 *   the starting state each day: registered but not yet detected
 *
 * WHAT EACH STATE MEANS
 *
 *   ABSENT   Registered, but not detected at all today. This is the DEFAULT,
 *            not a punishment - it simply means no advertisement has been
 *            received from this employee since midnight.
 *
 *   PRESENT  Confirmed nearby by repeated real BLE detections.
 *
 *   LEFT     Was PRESENT, then went undetected for longer than the grace
 *            period. LEFT is NOT the same as ABSENT: it preserves checkInTime,
 *            so the record still proves the person attended.
 *
 * THE TRANSITION THAT MUST NEVER EXIST
 *
 *   PRESENT -> ABSENT is impossible by design. Reloading the UI, restarting
 *   the app, losing Bluetooth or killing the process cannot erase a check-in,
 *   because state is derived from stored timestamps rather than held in memory.
 *
 *   LEFT is not a downgrade to absent - checkInTime survives it. An employee
 *   who checked in at 09:20 and left at 12:49 attended; the record says so.
 *
 * WHY STATUS IS DERIVED, NOT STORED-AND-MUTATED
 *
 *   `status` is computed from timestamps via deriveStatus() below, so it can
 *   never drift out of sync with the evidence. A timer firing late, early, or
 *   not at all changes nothing: the arithmetic on lastSeenTime is what decides.
 * -----------------------------------------------------------------------------
 */

export type AttendanceStatus = 'ABSENT' | 'PRESENT' | 'LEFT';

export interface AttendanceRecord {
  /** Stable id and dedup key: `${date}:${employeeId}`. */
  id: string;

  employeeId: string;
  /** Snapshotted at check-in so history stays correct if the name is edited. */
  employeeName: string;

  /** Local calendar date, YYYY-MM-DD. With employeeId, unique. */
  date: string;

  /**
   * When the employee was CONFIRMED present. Set exactly once per day and
   * never cleared - this is the attendance fact.
   */
  checkInTime: number | null;

  /** Most recent valid advertisement. Updated continuously while in range. */
  lastSeenTime: number | null;

  /**
   * When the grace period was found to have been exceeded. Cleared on
   * re-entry, because the employee is demonstrably back.
   */
  leftTime: number | null;

  /** First ever advertisement today, including ones before confirmation. */
  firstDetectedAt: number | null;
  /** Most recent advertisement today, confirmed or not. */
  lastDetectedAt: number | null;

  /** Which Host recorded this. */
  hostId: string;

  /** Smoothed RSSI at the moment of check-in, for auditing. */
  checkInRssi: number | null;

  /** Append-only audit trail. See AttendanceEvent. */
  events: AttendanceEvent[];
}

/* =============================================================================
 * EVENT HISTORY
 * ========================================================================== */

export type AttendanceEventType =
  | 'FIRST_DETECTED'
  | 'CHECK_IN'
  | 'LEFT'
  | 'RE_ENTRY';

export interface AttendanceEvent {
  type: AttendanceEventType;
  at: number;
  /** Smoothed RSSI at the moment of the event, when one applies. */
  rssi?: number | null;
}

/**
 * Routine BLE detections are deliberately NOT written to the event log - the
 * scanner reports several per second and would bury the meaningful
 * transitions. `lastSeenTime` already carries that information.
 */
export const MAX_EVENTS_PER_RECORD = 50;

/* =============================================================================
 * DERIVED STATUS
 * ========================================================================== */

/**
 * The single source of truth for an employee's status.
 *
 * Pure and time-parameterised: given the same record and the same `now`, it
 * always returns the same answer. That is what makes the status safe to
 * recompute after an app restart, on foreground, or on a UI tick.
 */
export function deriveStatus(
  record: AttendanceRecord | null,
  now: number,
  missingGracePeriodMs: number,
): AttendanceStatus {
  // No record for today: never detected.
  if (!record || record.checkInTime === null) {
    return 'ABSENT';
  }

  // Checked in, but never seen since (should not happen - defensive).
  if (record.lastSeenTime === null) {
    return 'PRESENT';
  }

  // The whole LEFT decision, in one line of arithmetic.
  return now - record.lastSeenTime > missingGracePeriodMs ? 'LEFT' : 'PRESENT';
}

/** How long since the last advertisement, or null if never seen. */
export function millisSinceLastSeen(
  record: AttendanceRecord | null,
  now: number,
): number | null {
  if (!record || record.lastSeenTime === null) {
    return null;
  }
  return now - record.lastSeenTime;
}

/* =============================================================================
 * VIEW MODELS
 * ========================================================================== */

/**
 * An employee joined to today's attendance plus live proximity.
 *
 * `status` and `currentlyNearby` are independent on purpose:
 *   status          - persistent, derived from stored timestamps
 *   currentlyNearby - transient, from the live scanner
 *
 * PRESENT while not currently nearby is valid and expected: the advertisement
 * was simply missed this instant, and the grace period has not elapsed.
 */
export interface AttendanceRow {
  employeeId: string;
  employeeName: string;
  record: AttendanceRecord | null;
  status: AttendanceStatus;
  currentlyNearby: boolean;
  currentRssi: number | null;
}

export interface AttendanceDaySummary {
  date: string;
  presentCount: number;
  leftCount: number;
  totalEmployees: number;
}

export interface TodaySummary {
  date: string;
  /** Currently PRESENT. */
  presentCount: number;
  /** Attended today but has since left. */
  leftCount: number;
  /** Registered and never detected today. */
  absentCount: number;
  /** Attended at all today: present + left. */
  attendedCount: number;
  totalEmployees: number;
}

/** Result of feeding one detection into the attendance engine. */
export type DetectionOutcome =
  | { kind: 'CHECKED_IN'; record: AttendanceRecord }
  | { kind: 'RE_ENTERED'; record: AttendanceRecord }
  | { kind: 'STILL_PRESENT'; record: AttendanceRecord }
  | { kind: 'AWAITING_CONFIRMATION'; detections: number; required: number }
  | { kind: 'TOO_FAR'; rssi: number; threshold: number }
  | { kind: 'NOT_REGISTERED'; employeeId: string }
  | { kind: 'DISABLED'; employeeId: string };
