/**
 * employeeTypes.ts
 * -----------------------------------------------------------------------------
 * The employee registry lives on the HOST device. Only employees present and
 * enabled in this registry can ever have attendance marked - an advertisement
 * carrying an unknown id is counted and logged, then discarded.
 * -----------------------------------------------------------------------------
 */

export interface Employee {
  /**
   * Application-level identifier, e.g. "EMP_001". This is what travels over the
   * air inside the BLE advertisement. Opaque by design - never a name, never a
   * MAC address, never a Bluetooth device name.
   */
  employeeId: string;

  /** Display name. Resolved locally on the Host; never broadcast. */
  displayName: string;

  /** Optional department, e.g. "HR". Local metadata only - never broadcast. */
  department?: string;

  /**
   * Job title and office, e.g. "Engineer" and "HQ · Floor 4". Local directory
   * metadata only — like every field but employeeId, neither is ever broadcast
   * and neither takes any part in matching an advertisement.
   */
  title?: string;
  office?: string;

  /**
   * Contact details. Local metadata only, never broadcast and never used for
   * matching - an advertisement carries the employeeId and nothing else. Kept
   * so the Host can show a directory entry without needing a backend.
   */
  phone?: string;
  email?: string;

  /**
   * Optional profile photo as a base64 data URI (downscaled at pick time).
   * Local metadata only — never broadcast, and at ~50 KB it is data, not a
   * pointer, so it cannot dangle when Android clears the picker's cache.
   */
  photo?: string;

  /**
   * A disabled employee stays in the registry but is ignored by the scanner, so
   * someone on leave can be excluded without deleting their history.
   */
  enabled: boolean;

  createdAt: number;
  updatedAt: number;
}

/** Fields a user can supply when creating or editing an employee. */
export interface EmployeeInput {
  employeeId: string;
  displayName: string;
  department?: string;
  title?: string;
  office?: string;
  phone?: string;
  email?: string;
  photo?: string;
  enabled?: boolean;
}

/**
 * An employee as the Host currently sees them over the air. This is LIVE
 * PROXIMITY, which is a completely separate concept from attendance:
 * an employee can be PRESENT (checked in earlier) while not currently detected.
 */
export interface DetectedEmployee {
  employeeId: string;
  /** Resolved from the registry, null if the id is not registered. */
  employee: Employee | null;

  /** Most recent raw RSSI reading, in dBm. */
  rssi: number;
  /** Moving average over the smoothing window, in dBm. */
  smoothedRssi: number;

  /** Whether the smoothed signal currently passes the proximity threshold. */
  isNearby: boolean;
  /** Consecutive nearby readings so far, toward the confirmation requirement. */
  consecutiveNearbyReadings: number;

  firstSeenAt: number;
  lastSeenAt: number;
  /** Total advertisements received from this employee this scan session. */
  advertisementCount: number;

  /**
   * BLE device address. Android rotates this roughly every 15 minutes for
   * privacy, so it is shown for debugging only and never used as an identity.
   */
  deviceId: string;
}

/** Why an advertisement was discarded. Surfaced as counters on the Debug screen. */
export type RejectionReason =
  | 'NOT_OUR_APP'
  | 'UNKNOWN_EMPLOYEE'
  | 'DISABLED_EMPLOYEE'
  | 'WEAK_SIGNAL'
  | 'MALFORMED_PAYLOAD';

export interface ScanStatistics {
  advertisementsReceived: number;
  knownEmployeesDetected: number;
  attendanceMarkedToday: number;
  rejectedUnknownDevices: number;
  rejectedUnknownEmployees: number;
  rejectedWeakSignals: number;
  rejectedMalformed: number;
}

export const emptyScanStatistics = (): ScanStatistics => ({
  advertisementsReceived: 0,
  knownEmployeesDetected: 0,
  attendanceMarkedToday: 0,
  rejectedUnknownDevices: 0,
  rejectedUnknownEmployees: 0,
  rejectedWeakSignals: 0,
  rejectedMalformed: 0,
});
