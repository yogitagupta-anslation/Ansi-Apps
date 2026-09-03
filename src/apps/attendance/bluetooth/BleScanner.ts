/**
 * BleScanner.ts
 * -----------------------------------------------------------------------------
 * HOST side of the system. BLE CENTRAL role: listens for employee
 * advertisements, resolves each against the local employee registry, tracks
 * RSSI, and reports confirmed detections upward.
 *
 * Uses react-native-ble-plx, which fully supports what is needed here: scanning,
 * reading advertisement contents, and reading RSSI directly from the scan
 * callback. We never connect to an employee phone - `Device.readRSSI()`, which
 * would require an active GATT connection, is never called.
 *
 * WHAT THIS FILE DOES NOT DO
 * -----------------------------------------------------------------------------
 * It does not mark attendance, touch storage, or know what attendance is. It
 * reports detections; AttendanceManager decides what they mean. The employee
 * registry is injected as a resolver function so this layer never imports a
 * repository.
 * -----------------------------------------------------------------------------
 */

import { ScanMode } from 'react-native-ble-plx';
import type { Device } from 'react-native-ble-plx';
import {
  RSSI_SMOOTHING_WINDOW,
  SCAN_THROTTLE_LIMIT,
  SCAN_THROTTLE_WINDOW_MS,
  SERVICE_UUID_128,
  SERVICE_UUID_16_FULL,
  UI_REFRESH_MS,
  UNKNOWN_DEVICE_STALE_MS,
} from '../constants/bluetoothConfig';
import type { Employee, DetectedEmployee, ScanStatistics } from '../employees/employeeTypes';
import { emptyScanStatistics } from '../employees/employeeTypes';
import { assertHost } from '../role/RoleService';
import { describeError, log } from '../utils/logger';
import { getBleManager } from './BleManager';
import { parseAdvertisement } from './BleAdvertisementParser';

/* =============================================================================
 * TYPES
 * ========================================================================== */

/** A nearby BLE device that is NOT our app. Debug visibility only. */
export interface UnknownDevice {
  deviceId: string;
  name: string | null;
  rssi: number;
  lastSeenAt: number;
  seenCount: number;
}

export interface ScanSnapshot {
  scanning: boolean;
  error: string | null;
  /** Employees currently being heard, strongest signal first. */
  detected: DetectedEmployee[];
  /** Non-app devices, for the Debug screen only. */
  unknownDevices: UnknownDevice[];
  statistics: ScanStatistics;
  startedAt: number | null;
}

export interface ScannerConfig {
  /** Smoothed RSSI at or above this counts as nearby. */
  rssiThreshold: number;
  /** Drop an employee from live proximity after this long with no advertisement. */
  detectionTimeoutMs: number;
  verboseLogging: boolean;
  /** Injected registry lookup. Returns null for an unregistered id. */
  resolveEmployee: (employeeId: string) => Employee | null;
  /** Called for every advertisement from a REGISTERED, ENABLED employee. */
  onDetection: (detection: DetectedEmployee) => void;

  /**
   * Whether to apply an OS-level ScanFilter on our service UUID.
   *
   * KEEP THIS TRUE unless actively debugging. Since Android 8.1 (API 27) the
   * platform SILENTLY returns zero scan results for a filterless scan whenever
   * the screen is off - and on some Samsung devices even an empty filter is not
   * enough. A filterless scan therefore appears to work perfectly in testing
   * (screen on) and then finds nobody in real use.
   *
   * Filtering also lets the Bluetooth controller do the matching in hardware,
   * which cuts wakeups and battery drain.
   *
   * The cost: filtered scans never report non-app devices, so the Debug
   * screen's "unknown devices" list stays empty. That list exists to answer
   * "is my radio receiving anything at all?", so the Debug screen can turn
   * filtering off temporarily - with that trade-off stated in the UI.
   */
  useServiceUuidFilter: boolean;
}

type SnapshotListener = (snapshot: ScanSnapshot) => void;

/* =============================================================================
 * INTERNAL STATE
 * ========================================================================== */

interface EmployeeTracker extends DetectedEmployee {
  rssiSamples: number[];
}

const employees = new Map<string, EmployeeTracker>();
const unknownDevices = new Map<string, UnknownDevice>();
const listeners = new Set<SnapshotListener>();

let scanning = false;
let scanError: string | null = null;
let startedAt: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let statistics: ScanStatistics = emptyScanStatistics();
let config: ScannerConfig | null = null;

/** Android throttles an app that starts more than 5 scans in 30 seconds. */
const recentScanStarts: number[] = [];

/* =============================================================================
 * RSSI
 * -----------------------------------------------------------------------------
 * RSSI is an approximate proximity indicator, never a distance. See the long
 * note in bluetoothConfig.ts.
 * ========================================================================== */

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/* =============================================================================
 * SNAPSHOT
 * ========================================================================== */

function buildSnapshot(): ScanSnapshot {
  const detected: DetectedEmployee[] = [];
  employees.forEach(tracker => {
    // Strip the internal sample buffer from what leaves this module.
    const { rssiSamples, ...rest } = tracker;
    void rssiSamples;
    detected.push(rest);
  });
  detected.sort((a, b) => b.smoothedRssi - a.smoothedRssi);

  const unknown: UnknownDevice[] = [];
  unknownDevices.forEach(d => unknown.push(d));
  unknown.sort((a, b) => b.rssi - a.rssi);

  return {
    scanning,
    error: scanError,
    detected,
    unknownDevices: unknown,
    statistics: { ...statistics },
    startedAt,
  };
}

function emit(): void {
  const snapshot = buildSnapshot();
  listeners.forEach(listener => listener(snapshot));
}

export function subscribeToScan(listener: SnapshotListener): () => void {
  listeners.add(listener);
  listener(buildSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getScanSnapshot(): ScanSnapshot {
  return buildSnapshot();
}

/**
 * Remove employees and devices that have gone quiet.
 *
 * This affects LIVE PROXIMITY only. Attendance records are untouched - an
 * employee dropping out of range here does not and must not change the fact
 * that they checked in earlier.
 */
function pruneStale(): void {
  const now = Date.now();
  const timeout = config?.detectionTimeoutMs ?? 10000;

  employees.forEach((tracker, employeeId) => {
    if (now - tracker.lastSeenAt > timeout) {
      employees.delete(employeeId);
      log.info('SCAN', 'Employee ' + employeeId + ' no longer detected');
    }
  });

  unknownDevices.forEach((device, id) => {
    if (now - device.lastSeenAt > UNKNOWN_DEVICE_STALE_MS) {
      unknownDevices.delete(id);
    }
  });
}

/* =============================================================================
 * SCAN CALLBACK
 * ========================================================================== */

function handleUnknownDevice(device: Device): void {
  statistics.rejectedUnknownDevices++;

  const existing = unknownDevices.get(device.id);
  unknownDevices.set(device.id, {
    deviceId: device.id,
    name: device.name ?? device.localName ?? null,
    rssi: device.rssi ?? existing?.rssi ?? -127,
    lastSeenAt: Date.now(),
    seenCount: (existing?.seenCount ?? 0) + 1,
  });
}

function handleDevice(device: Device): void {
  if (!config) {
    return;
  }

  statistics.advertisementsReceived++;

  const parsed = parseAdvertisement(device);

  // Not our application - a random nearby Bluetooth device. Never treated as
  // an employee; recorded for the Debug screen and discarded.
  if (!parsed.isOurApp) {
    handleUnknownDevice(device);
    return;
  }

  if (parsed.malformed || !parsed.employeeId) {
    statistics.rejectedMalformed++;
    log.warn(
      'SCAN',
      'Our service UUID matched but the payload did not parse' +
        (parsed.rawManufacturerHex ? ' (raw: ' + parsed.rawManufacturerHex + ')' : ''),
    );
    return;
  }

  const employeeId = parsed.employeeId;
  const employee = config.resolveEmployee(employeeId);

  // Only registered employees count. An unknown id is logged and dropped.
  if (!employee) {
    statistics.rejectedUnknownEmployees++;
    if (config.verboseLogging) {
      log.warn('SCAN', 'Unregistered employee id: ' + employeeId);
    }
    return;
  }

  if (!employee.enabled) {
    statistics.rejectedUnknownEmployees++;
    if (config.verboseLogging) {
      log.warn('SCAN', 'Employee ' + employeeId + ' is disabled - ignoring');
    }
    return;
  }

  const now = Date.now();
  const rssi = device.rssi ?? -127;
  const existing = employees.get(employeeId);

  const samples = existing ? existing.rssiSamples.slice() : [];
  samples.push(rssi);
  if (samples.length > RSSI_SMOOTHING_WINDOW) {
    samples.shift();
  }
  const smoothedRssi = average(samples);

  const isNearby = smoothedRssi >= config.rssiThreshold;

  // Consecutive nearby readings. A single strong reading can be a reflection
  // from across the room; a run of them cannot. Any non-nearby reading resets
  // the run to zero.
  const consecutiveNearbyReadings = isNearby
    ? (existing?.consecutiveNearbyReadings ?? 0) + 1
    : 0;

  if (!isNearby) {
    statistics.rejectedWeakSignals++;
  }

  const isFirstSighting = !existing;

  const tracker: EmployeeTracker = {
    employeeId,
    employee,
    rssi,
    smoothedRssi,
    rssiSamples: samples,
    isNearby,
    consecutiveNearbyReadings,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    advertisementCount: (existing?.advertisementCount ?? 0) + 1,
    deviceId: device.id,
  };

  employees.set(employeeId, tracker);

  if (isFirstSighting) {
    statistics.knownEmployeesDetected++;
    log.info('SCAN', 'Advertisement received');
    log.info('SCAN', 'Employee ID: ' + employeeId);
    log.info('SCAN', 'RSSI: ' + rssi);
    log.info('SCAN', 'Employee recognized: ' + employee.displayName);
    log.info('SCAN', 'Matched by: ' + parsed.matchedBy.join(', '));
  } else if (config.verboseLogging) {
    log.info('SCAN', employeeId + ' rssi=' + rssi + ' smoothed=' + smoothedRssi);
  }

  // Hand the detection upward. AttendanceManager decides what it means; this
  // layer has no opinion about attendance.
  const { rssiSamples, ...detection } = tracker;
  void rssiSamples;
  config.onDetection(detection);
}

/* =============================================================================
 * START / STOP
 * ========================================================================== */

export interface StartScanResult {
  success: boolean;
  error: string | null;
}

export function startScan(scannerConfig: ScannerConfig): StartScanResult {
  // ROLE GUARD — enforcement, not decoration.
  //
  // Scanning is a HOST-only operation. Hiding the button is not sufficient:
  // this function can be reached from a deep link, a stale callback firing
  // after a role change, a restored "scanningEnabled" preference, or simply a
  // future refactor calling the wrong thing. Checking here means an Employee
  // device cannot start attendance scanning by any path.
  //
  // Throws rather than returning false so the mistake cannot be swallowed.
  assertHost('BleScanner.startScan');

  if (scanning) {
    log.warn('SCAN', 'Scan already running - ignoring duplicate start');
    // Adopt the new configuration so a settings change takes effect live.
    config = scannerConfig;
    return { success: true, error: null };
  }

  const manager = getBleManager();
  if (!manager) {
    const error =
      'Scanning unavailable: the BLE manager could not be created. Check that ' +
      'react-native-ble-plx is installed and the app was rebuilt natively.';
    scanError = error;
    log.error('SCAN', error);
    emit();
    return { success: false, error };
  }

  // Android silently throttles an app that scans too frequently.
  const now = Date.now();
  while (
    recentScanStarts.length > 0 &&
    now - recentScanStarts[0] > SCAN_THROTTLE_WINDOW_MS
  ) {
    recentScanStarts.shift();
  }
  recentScanStarts.push(now);
  if (recentScanStarts.length > SCAN_THROTTLE_LIMIT - 1) {
    log.warn(
      'SCAN',
      'Started ' +
        recentScanStarts.length +
        ' scans in the last 30s. Android throttles more than ' +
        SCAN_THROTTLE_LIMIT +
        ' scan starts per 30-second window, after which results stop arriving ' +
        'with no error reported. Wait 30s before starting again.',
    );
  }

  config = scannerConfig;
  scanError = null;
  startedAt = now;
  employees.clear();
  unknownDevices.clear();
  statistics = emptyScanStatistics();

  log.info('BLE', 'BLE scanner started');
  log.info('SCAN', 'Service UUID (16-bit): ' + SERVICE_UUID_16_FULL);
  log.info('SCAN', 'Service UUID (128-bit): ' + SERVICE_UUID_128);
  log.info('SCAN', 'RSSI threshold: ' + scannerConfig.rssiThreshold + ' dBm');

  const filterUuids = scannerConfig.useServiceUuidFilter
    ? [SERVICE_UUID_16_FULL]
    : null;

  log.info(
    'SCAN',
    filterUuids
      ? 'Scan filter: ON (service UUID) - required for screen-off scanning'
      : 'Scan filter: OFF (debug) - all devices visible, but Android 8.1+ ' +
        'returns nothing while the screen is off',
  );

  try {
    manager.startDeviceScan(
      // A non-null ScanFilter is not merely an optimisation: without one,
      // Android 8.1+ silently returns zero results whenever the screen is off.
      filterUuids,
      {
        // Low latency scans continuously and performs an ACTIVE scan, which is
        // what makes the scan-response packet (the 128-bit UUID) visible.
        scanMode: ScanMode ? ScanMode.LowLatency : 2,
        // Report every advertisement, not just first sighting, so RSSI updates.
        allowDuplicates: true,
        legacyScan: true,
      },
      (error, device) => {
        if (error) {
          scanError = describeError(error);
          scanning = false;
          log.error('SCAN', 'Scan failed: ' + scanError);
          stopFlushTimer();
          emit();
          return;
        }
        if (device) {
          handleDevice(device);
        }
      },
    );

    scanning = true;
    startFlushTimer();
    emit();
    return { success: true, error: null };
  } catch (error) {
    scanError = describeError(error);
    scanning = false;
    log.error('SCAN', 'startDeviceScan threw: ' + scanError);
    emit();
    return { success: false, error: scanError };
  }
}

export function stopScan(): void {
  const manager = getBleManager();

  if (manager && scanning) {
    try {
      manager.stopDeviceScan();
      log.info('BLE', 'BLE scanner stopped');
    } catch (error) {
      log.warn('SCAN', 'stopDeviceScan threw: ' + describeError(error));
    }
  }

  scanning = false;
  stopFlushTimer();
  employees.clear();
  emit();
}

/**
 * The scan callback fires many times per second. Pushing each one into React
 * state would re-render the employee list constantly and drop frames, so
 * detections accumulate in the maps above and the UI is notified on a fixed
 * interval instead.
 */
function startFlushTimer(): void {
  stopFlushTimer();
  flushTimer = setInterval(() => {
    pruneStale();
    emit();
  }, UI_REFRESH_MS);
}

function stopFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export function isScanning(): boolean {
  return scanning;
}

/** Let the attendance layer report how many records exist, for the Debug counters. */
export function setAttendanceMarkedToday(count: number): void {
  statistics.attendanceMarkedToday = count;
}

/** Apply changed settings to a running scan without restarting the radio. */
export function updateScannerConfig(partial: Partial<ScannerConfig>): void {
  if (config) {
    config = { ...config, ...partial };
  }
}
