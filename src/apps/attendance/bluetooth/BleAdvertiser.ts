/**
 * BleAdvertiser.ts
 * -----------------------------------------------------------------------------
 * EMPLOYEE side of the system. Puts this phone into the BLE PERIPHERAL role so
 * it broadcasts the employee's identifier for a Host to pick up.
 *
 * WHY A CUSTOM NATIVE MODULE RATHER THAN A LIBRARY
 * -----------------------------------------------------------------------------
 * react-native-ble-plx - which this app uses for scanning - implements the BLE
 * CENTRAL role only. It can scan, connect, discover services and read RSSI. It
 * CANNOT make a phone advertise. That is a documented scope decision by the
 * library, not a bug and not a flag that can be switched on.
 *
 * Running a scanner does NOT make a phone discoverable. Scanning and advertising
 * are two different Android APIs and must be implemented separately:
 *
 *     scanning     ->  BluetoothLeScanner     (react-native-ble-plx)
 *     advertising  ->  BluetoothLeAdvertiser  (our Kotlin module)
 *
 * So this file is the JS side of
 * android/app/src/main/java/com/bleattendance/ble/BleAdvertiserModule.kt,
 * which drives BluetoothLeAdvertiser directly. Verified working on-device:
 * Android's own AdvertiseCallback.onStartSuccess fires and is reported back
 * here as an event.
 * -----------------------------------------------------------------------------
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { decodeStatusReport, type StatusReport } from './statusReport';
import {
  CHECKOUT_UUID_16_FULL,
  MANUFACTURER_ID,
  MAX_EMPLOYEE_ID_BYTES,
  SERVICE_UUID_128,
  SERVICE_UUID_16_FULL,
  STATUS_CHAR_UUID,
} from '../constants/bluetoothConfig';
import { EMPLOYEE_ID_PATTERN } from '../constants/appConfig';
import { assertEmployee } from '../role/RoleService';
import { hasAdvertisePermissions } from './permissions';
import type { AdvertisingState } from './advertisingState';
import { base64ToBytes, bytesToHex } from '../utils/bytes';
import { describeError, log } from '../utils/logger';
import { buildManufacturerPayload } from './BleAdvertisementParser';

/** What this specific handset's Bluetooth adapter can actually do. */
export interface AdvertiserCapabilities {
  bleSupported: boolean;
  /**
   * Whether this phone can act as a BLE peripheral, determined by
   * BluetoothAdapter.getBluetoothLeAdvertiser() returning non-null. A real
   * minority of budget and older Android phones return null - their chipset
   * supports the central role only, and no app can work around that.
   */
  advertisingSupported: boolean;
  multipleAdvertisementSupported: boolean;
  extendedAdvertisingSupported: boolean;
  maxAdvertisingDataLength: number;
  bluetoothEnabled: boolean;
  locationServicesEnabled: boolean;
  adapterName: string;
  error?: string;
}

export interface AdvertiserState {
  /**
   * What the radio is ACTUALLY doing. Never inferred from a stored preference -
   * only ACTIVE means an advertisement is genuinely on air, and that is
   * reachable only from Android's onStartSuccess callback.
   */
  state: AdvertisingState;
  /** Kept for compatibility; equivalent to state === 'ACTIVE'. */
  advertising: boolean;
  /** The id currently on air, or null when not advertising. */
  employeeId: string | null;
  error: string | null;
  /** Raw AdvertiseCallback.onStartFailure code, when one was reported. */
  errorCode: number | null;
  /** When the last successful start was confirmed. For the debug panel. */
  lastStartedAt: number | null;
}

type StateListener = (state: AdvertiserState) => void;

const NATIVE_MODULE_NAME = 'BleAdvertiser';
const EVENT_NAME = 'BleAdvertiserStateChanged';

const NativeBleAdvertiser = NativeModules[NATIVE_MODULE_NAME];

export const NATIVE_MODULE_AVAILABLE = !!NativeBleAdvertiser;

const MISSING_MODULE_MESSAGE =
  'Native module "' +
  NATIVE_MODULE_NAME +
  '" not found. The JavaScript loaded but the Kotlin advertiser was not linked ' +
  'into the build. Check that BleAdvertiserPackage() is registered in ' +
  'MainApplication.kt, and that you ran a full native rebuild rather than just ' +
  'reloading Metro.';

if (!NATIVE_MODULE_AVAILABLE && Platform.OS === 'android') {
  log.error('ADVERTISE', MISSING_MODULE_MESSAGE);
}

const emitter = NATIVE_MODULE_AVAILABLE
  ? new NativeEventEmitter(NativeBleAdvertiser)
  : null;

let currentState: AdvertiserState = {
  state: 'OFF',
  advertising: false,
  employeeId: null,
  error: null,
  errorCode: null,
  lastStartedAt: null,
};

const listeners = new Set<StateListener>();

/**
 * The one place advertiser state changes.
 *
 * `advertising` is derived from `state` here rather than passed in, so the
 * boolean can never disagree with the state machine.
 */
function setState(patch: Partial<AdvertiserState> & { state: AdvertisingState }): void {
  currentState = {
    ...currentState,
    ...patch,
    advertising: patch.state === 'ACTIVE',
  };
  listeners.forEach(listener => listener(currentState));
}

if (emitter) {
  // THE ONLY PATH TO 'ACTIVE'.
  //
  // This event is emitted from Android's own AdvertiseCallback. Nothing else
  // in the app may set ACTIVE, which is what guarantees the UI cannot claim to
  // be broadcasting unless the platform confirmed it.
  emitter.addListener(
    EVENT_NAME,
    (event: { advertising?: boolean; error?: string; errorCode?: number }) => {
      const confirmed = !!event.advertising;

      if (confirmed) {
        setState({
          state: 'ACTIVE',
          // Keep the id we asked for; native does not echo it back.
          employeeId: currentState.employeeId,
          error: null,
          errorCode: null,
          lastStartedAt: Date.now(),
        });
        log.info('ADVERTISE', 'onStartSuccess - advertisement confirmed on air');
        return;
      }

      if (event.error) {
        setState({
          state: 'ERROR',
          employeeId: null,
          error: event.error,
          errorCode: event.errorCode ?? null,
        });
        log.error('ADVERTISE', 'onStartFailure: ' + event.error);
        return;
      }

      // Native reported "not advertising" with no error: a clean stop.
      setState({ state: 'OFF', employeeId: null, error: null, errorCode: null });
      log.info('ADVERTISE', 'Advertising stopped');
    },
  );
}

/**
 * Validate an employee id before it can reach the radio.
 *
 * Catching an over-long id here produces a message that says what to do, rather
 * than letting Android fail with the opaque ADVERTISE_FAILED_DATA_TOO_LARGE.
 */
export function validateEmployeeId(employeeId: string): string | null {
  const trimmed = employeeId.trim();

  if (trimmed.length === 0) {
    return 'Employee ID is required before you can start advertising.';
  }
  if (!EMPLOYEE_ID_PATTERN.test(trimmed)) {
    return 'Employee ID may only contain letters, numbers, hyphen and underscore.';
  }
  if (trimmed.length > MAX_EMPLOYEE_ID_BYTES) {
    return (
      'Employee ID is ' +
      trimmed.length +
      ' characters. The 31-byte BLE advertising packet leaves room for at most ' +
      MAX_EMPLOYEE_ID_BYTES +
      '.'
    );
  }
  return null;
}

/** Query what this phone's Bluetooth adapter supports. */
export async function getCapabilities(): Promise<AdvertiserCapabilities> {
  const unavailable: AdvertiserCapabilities = {
    bleSupported: false,
    advertisingSupported: false,
    multipleAdvertisementSupported: false,
    extendedAdvertisingSupported: false,
    maxAdvertisingDataLength: 0,
    bluetoothEnabled: false,
    locationServicesEnabled: false,
    adapterName: 'unknown',
  };

  if (!NATIVE_MODULE_AVAILABLE) {
    return { ...unavailable, error: MISSING_MODULE_MESSAGE };
  }

  try {
    return (await NativeBleAdvertiser.getCapabilities()) as AdvertiserCapabilities;
  } catch (error) {
    const message = describeError(error);
    log.error('ADVERTISE', 'getCapabilities failed: ' + message);
    return { ...unavailable, error: message };
  }
}

/**
 * Location services (the GPS master toggle) must be ON for BLE SCANNING on
 * Android 6-11, and on 12+ whenever the app scans using ACCESS_FINE_LOCATION
 * rather than the neverForLocation flag. Advertising is unaffected.
 *
 * This is the classic silent failure: permissions granted, scan starts with no
 * error, and zero devices are ever reported.
 *
 * Served by the same native module, so it lives here.
 */
export async function isLocationServicesEnabled(): Promise<boolean> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return false;
  }
  try {
    return await NativeBleAdvertiser.isLocationServicesEnabled();
  } catch (error) {
    log.warn('ADVERTISE', 'isLocationServicesEnabled failed: ' + describeError(error));
    return false;
  }
}

export interface AdvertiseResult {
  success: boolean;
  error: string | null;
}

/**
 * Start broadcasting this employee's identifier.
 *
 * CONNECTABLE on purpose - see `connectable: true` and the comment beside it
 * further down this function. Hearing the advertisement is enough for the Host
 * to mark attendance, but not for the employee to ever be TOLD about it: the
 * Host connects back and writes the status report into the GATT characteristic.
 *
 * The cost is real and deliberate. A connectable advertisement means any BLE
 * central in range can connect without a pairing prompt, and the characteristic
 * is unauthenticated, so a stranger who has read the employee id off the air can
 * write a fabricated report. Documented as an accepted risk in the TRUST
 * BOUNDARY note in bluetooth/statusReport.ts.
 */
export async function startAdvertising(employeeId: string): Promise<AdvertiseResult> {
  // ROLE GUARD — see the matching guard in BleScanner.startScan.
  //
  // Advertising an employee identity is an EMPLOYEE-only operation. A Host
  // broadcasting an employee ID would be detected by itself or another Host as
  // a present employee, which is exactly the kind of silent data corruption
  // that hiding a button does not prevent.
  assertEmployee('BleAdvertiser.startAdvertising');

  /**
   * Duplicate-start guard, mirroring BleScanner. Auto-reconcile (Bluetooth
   * coming back on, app foregrounding) can race a user tap; without this the
   * second native start fails with ALREADY_STARTED and the error handler
   * would flip the UI to ERROR while the radio is in fact happily on air.
   */
  if (
    (currentState.state === 'ACTIVE' || currentState.state === 'STARTING') &&
    currentState.employeeId === employeeId
  ) {
    log.warn('ADVERTISE', 'Already advertising this id - ignoring duplicate start');
    return { success: true, error: null };
  }

  if (!NATIVE_MODULE_AVAILABLE) {
    setState({ state: 'UNSUPPORTED', employeeId: null, error: MISSING_MODULE_MESSAGE });
    return { success: false, error: MISSING_MODULE_MESSAGE };
  }

  const validationError = validateEmployeeId(employeeId);
  if (validationError) {
    log.error('ADVERTISE', validationError);
    setState({ state: 'ERROR', employeeId: null, error: validationError });
    return { success: false, error: validationError };
  }

  // PRE-FLIGHT — classify why we cannot advertise BEFORE touching the radio,
  // so the UI can name the actual blocker instead of a generic failure.
  const caps = await getCapabilities();

  if (!caps.bleSupported || !caps.advertisingSupported) {
    const message = caps.bluetoothEnabled
      ? "This phone's Bluetooth chipset does not support the peripheral role, so it cannot advertise."
      : 'Bluetooth is off, so advertising support cannot be determined.';
    setState({
      state: caps.bluetoothEnabled ? 'UNSUPPORTED' : 'BLUETOOTH_DISABLED',
      employeeId: null,
      error: message,
    });
    return { success: false, error: message };
  }

  if (!caps.bluetoothEnabled) {
    const message = 'Bluetooth is switched off.';
    setState({ state: 'BLUETOOTH_DISABLED', employeeId: null, error: message });
    return { success: false, error: message };
  }

  if (!(await hasAdvertisePermissions())) {
    const message = 'The Nearby devices (BLUETOOTH_ADVERTISE) permission is not granted.';
    setState({ state: 'PERMISSION_DENIED', employeeId: null, error: message });
    return { success: false, error: message };
  }

  const trimmed = employeeId.trim();
  const manufacturerData = buildManufacturerPayload(trimmed);

  log.info('ADVERTISE', 'Starting employee advertising');
  log.info('ADVERTISE', 'Employee ID: ' + trimmed);
  log.info(
    'ADVERTISE',
    'Payload: companyId=0x' +
      MANUFACTURER_ID.toString(16).toUpperCase() +
      ' bytes=[' +
      bytesToHex(manufacturerData) +
      '] (' +
      manufacturerData.length +
      ' bytes)',
  );

  // STARTING, not ACTIVE: the advertisement is only genuinely on air once
  // Android calls back. Remember the id so that callback can report it.
  setState({ state: 'STARTING', employeeId: trimmed, error: null, errorCode: null });

  try {
    // PAYLOAD SPLIT - do not change without re-reading this.
    //
    // Manufacturer data goes in the PRIMARY packet ONLY, and the 128-bit UUID
    // in the scan response ONLY. Putting manufacturer data in BOTH would be a
    // silent, platform-specific bug: react-native-ble-plx's Android parser
    // ASSIGNS rather than appends when it meets a second 0xFF structure, so the
    // scan-response copy overwrites the advertisement copy and only one
    // survives - while iOS concatenates them (ble-plx issue #483).
    //
    // Budget for the primary packet. CONNECTABLE since the reply channel was
    // added, which costs the 3-byte flags structure Android now injects:
    //   flags                 3 bytes
    //   16-bit service UUID   4 bytes
    //   manufacturer data     4 + 1 version + len(employeeId)
    //   -> "EMP_001" totals 19 bytes of 31; ids up to 19 chars still fit.
    //
    // Connectable is REQUIRED for the attendance reply channel: the Host
    // connects to this phone and writes the recorded status into the GATT
    // characteristic below. Non-connectable would silently disable the
    // employee's ability to ever see their own check-in.
    await NativeBleAdvertiser.startAdvertising({
      shortServiceUuid: SERVICE_UUID_16_FULL,
      longServiceUuid: SERVICE_UUID_128,
      // Handed over at start so the two sides can never disagree about which
      // UUID means "leaving". Raising the flag later carries no UUID of its own.
      checkOutServiceUuid: CHECKOUT_UUID_16_FULL,
      manufacturerId: MANUFACTURER_ID,
      manufacturerData,
      connectable: true,
      statusCharUuid: STATUS_CHAR_UUID,
      includeDeviceName: false,
      advertiseMode: 'lowLatency',
      txPowerLevel: 'high',
    });

    // Success here only means Android accepted the request. The authoritative
    // confirmation arrives asynchronously via onStartSuccess on the emitter.
    log.info('ADVERTISE', 'Request accepted by Android, awaiting onStartSuccess');
    return { success: true, error: null };
  } catch (error) {
    const message = describeError(error);
    log.error('ADVERTISE', 'startAdvertising failed: ' + message);
    setState({ state: 'ERROR', employeeId: null, error: message, errorCode: null });
    return { success: false, error: message };
  }
}

/**
 * Declare, or withdraw, a departure.
 *
 * Adds one 16-bit service UUID to the scan response for as long as a check-out
 * is pending. A Host sees it on its next scan — about a second — and records
 * the departure on its own clock, then writes the receipt back over the GATT
 * channel that stays open throughout.
 *
 * WHAT THIS DOES NOT DO. It does not check anybody out. This phone cannot: the
 * Host owns the attendance record, and the only honest evidence a check-out
 * happened is a status report coming back with a leftTime in it. A resolved
 * promise here means the flag is up, nothing more — so the UI must keep saying
 * "waiting" until a report arrives, and must never paint a time of its own.
 *
 * Silently a no-op when the phone is not broadcasting: the service ignores the
 * request, because a flag on a silent radio is a message nobody can receive.
 */
export async function setCheckOutIntent(pending: boolean): Promise<AdvertiseResult> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return { success: false, error: MISSING_MODULE_MESSAGE };
  }

  try {
    await NativeBleAdvertiser.setCheckOutIntent(pending);
    log.info('ADVERTISE', 'Check-out flag ' + (pending ? 'raised' : 'lowered'));
    return { success: true, error: null };
  } catch (error) {
    const message = describeError(error);
    log.error('ADVERTISE', 'setCheckOutIntent failed: ' + message);
    return { success: false, error: message };
  }
}

export async function stopAdvertising(): Promise<AdvertiseResult> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return { success: false, error: MISSING_MODULE_MESSAGE };
  }

  log.info('ADVERTISE', 'Stopping employee advertising');

  try {
    await NativeBleAdvertiser.stopAdvertising();
    setState({ state: 'OFF', employeeId: null, error: null, errorCode: null });
    log.info('ADVERTISE', 'Advertising stopped');
    return { success: true, error: null };
  } catch (error) {
    const message = describeError(error);
    log.error('ADVERTISE', 'stopAdvertising failed: ' + message);
    return { success: false, error: message };
  }
}

/** Ask native for ground truth rather than trusting the cached JS state. */
export async function isAdvertising(): Promise<boolean> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return false;
  }
  try {
    return await NativeBleAdvertiser.isAdvertising();
  } catch {
    return false;
  }
}

export function getAdvertiserState(): AdvertiserState {
  return currentState;
}

export function subscribeToAdvertiserState(listener: StateListener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/* =============================================================================
 * SYSTEM SETTINGS HELPERS
 * -----------------------------------------------------------------------------
 * Not advertising features, but served by the same native module (it already
 * holds the Context and the BluetoothAdapter), so exposing them here avoids a
 * second native module for two Intents.
 * ========================================================================== */

/**
 * Show the system "allow this app to turn on Bluetooth?" dialog.
 *
 * Uses the ACTION_REQUEST_ENABLE intent rather than BluetoothAdapter.enable(),
 * which was deprecated in Android 13 and now returns false without doing
 * anything for ordinary apps.
 */
export async function requestEnableBluetooth(): Promise<boolean> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return false;
  }
  try {
    return await NativeBleAdvertiser.requestEnableBluetooth();
  } catch (error) {
    log.error('BLE', 'requestEnableBluetooth failed: ' + describeError(error));
    return false;
  }
}

/** Open system location settings so the user can switch the master toggle on. */
export async function openLocationSettings(): Promise<boolean> {
  if (!NATIVE_MODULE_AVAILABLE) {
    return false;
  }
  try {
    return await NativeBleAdvertiser.openLocationSettings();
  } catch (error) {
    log.error('BLE', 'openLocationSettings failed: ' + describeError(error));
    return false;
  }
}

/* ========================================================== reply channel == */

const STATUS_EVENT_NAME = 'BleStatusReportReceived';

/**
 * Subscribe to attendance status reports written to this device by a Host.
 *
 * Decoding is strict (see statusReport.ts) and malformed radio input is
 * silently dropped after a log line — never surfaced as a report.
 */
export function subscribeToStatusReports(
  callback: (report: StatusReport) => void,
): () => void {
  if (!emitter) {
    return () => {};
  }
  const sub = emitter.addListener(STATUS_EVENT_NAME, (event: { data?: string }) => {
    const report = decodeStatusReport(base64ToBytes(event?.data));
    if (!report) {
      log.warn('ADVERTISE', 'Dropped malformed status report from the air');
      return;
    }
    log.info(
      'ADVERTISE',
      'Status report received: ' + report.status + ' for ' + report.employeeId +
        ' from ' + report.hostId,
    );
    callback(report);
  });
  return () => sub.remove();
}
