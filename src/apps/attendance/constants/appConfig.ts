/**
 * appConfig.ts
 * -----------------------------------------------------------------------------
 * Non-Bluetooth application constants: storage keys, defaults, app identity.
 * -----------------------------------------------------------------------------
 */

export const APP_NAME = 'BLE Attendance';
export const APP_VERSION = '1.0.0';

/** The two roles this installation can take. Chosen on the Home screen. */
export type AppRole = 'HOST' | 'EMPLOYEE';

/* =============================================================================
 * STORAGE
 * -----------------------------------------------------------------------------
 * SQLite table names and the keys used by the settings store. All storage
 * access goes through the repository layer in src/storage - UI never touches
 * the database directly.
 * ========================================================================== */

export const DB_NAME = 'ble_attendance.db';
export const DB_VERSION = 1;

export const TABLE_EMPLOYEES = 'employees';
export const TABLE_ATTENDANCE = 'attendance';
export const TABLE_SETTINGS = 'settings';

export const SETTINGS_KEYS = {
  role: 'app.role',
  theme: 'app.theme',
  debugMode: 'app.debugMode',
  verboseLogging: 'app.verboseLogging',

  hostId: 'host.id',
  hostName: 'host.name',

  employeeId: 'employee.id',
  employeeName: 'employee.name',
  employeeDepartment: 'employee.department',
  employeePhone: 'employee.phone',
  employeeEmail: 'employee.email',
  employeePhoto: 'employee.photo',

  rssiThreshold: 'attendance.rssiThreshold',
  requiredNearbyReadings: 'attendance.requiredNearbyReadings',
  detectionTimeoutMs: 'attendance.detectionTimeoutMs',
  missingGracePeriodMs: 'attendance.missingGracePeriodMs',

  /**
   * The user's scanning PREFERENCE - "scanning should be on" - not a claim
   * that the radio is scanning. Restored at startup, at which point the app
   * attempts a real resume and reports honestly if it cannot.
   */
  scanningEnabled: 'ble.scanningEnabled',
  advertisingEnabled: 'ble.advertisingEnabled',
} as const;

/* =============================================================================
 * DEFAULTS
 * ========================================================================== */

export const DEFAULT_HOST_ID = 'HOST_001';
export const DEFAULT_HOST_NAME = 'Main Office';

/**
 * Generate a persistent, per-installation Host ID such as "HOST-8A31F".
 *
 * Called once, the first time a device becomes a Host, and then stored. It is
 * stamped onto every attendance record so that records from different Hosts
 * can be told apart later — which matters if the office ever runs more than
 * one attendance point.
 *
 * Not cryptographic and not a security control: it identifies a device, it
 * does not authenticate one.
 */
export function generateHostId(): string {
  const alphabet = '0123456789ABCDEF';
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return 'HOST-' + suffix;
}

/**
 * Deliberately empty. An employee installation must be configured before it can
 * advertise - broadcasting a default id would let every unconfigured phone
 * masquerade as the same employee.
 */
export const DEFAULT_EMPLOYEE_ID = '';
export const DEFAULT_EMPLOYEE_NAME = '';

/* =============================================================================
 * VALIDATION
 * ========================================================================== */

/**
 * Employee ids are restricted to characters that survive the ASCII-only BLE
 * payload encoding. Enforced at entry so a bad id can never reach the radio.
 */
export const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const DATE_FORMAT_HINT = 'YYYY-MM-DD';

/** Local calendar date as YYYY-MM-DD. Used as the attendance dedup key. */
export function todayDateString(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  );
}

/** Human-readable clock time, e.g. "09:05 AM". */
export function formatClockTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return String(hour12).padStart(2, '0') + ':' + minutes + ' ' + suffix;
}

/** Human-readable date, e.g. "20 Aug 2026". */
export function formatDisplayDate(dateString: string): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const parts = dateString.split('-');
  if (parts.length !== 3 || !parts.every(part => /^\d+$/.test(part))) {
    return dateString;
  }
  const [year, month, day] = parts;
  const monthIndex = Number(month) - 1;
  const monthName = months[monthIndex] ?? month;
  return Number(day) + ' ' + monthName + ' ' + year;
}
