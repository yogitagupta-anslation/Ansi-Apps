/**
 * BleManager.ts
 * -----------------------------------------------------------------------------
 * Shared Bluetooth facade: the single react-native-ble-plx instance, live
 * adapter state, and a readiness check that answers "can this phone do its job
 * right now, and if not, exactly why".
 *
 * ROLE / CAPABILITY MAP
 * -----------------------------------------------------------------------------
 *   HOST      scans   -> BLUETOOTH_SCAN + location permission + location
 *                        services ON. Needs no advertising capability at all.
 *   EMPLOYEE  advertises -> BLUETOOTH_ADVERTISE + peripheral-role hardware.
 *                        Needs no location permission and no location services.
 *
 * These requirement sets are almost disjoint, which is why readiness is
 * evaluated per role rather than globally.
 *
 * TERMINOLOGY, because these get conflated constantly:
 *   Bluetooth Classic  - the older, higher-throughput stack (audio, files).
 *                        Not used here at all.
 *   Bluetooth LE (BLE) - the low-energy stack. This is what we use.
 *   Pairing / bonding  - exchanging long-term keys. NOT required, NOT used.
 *   Connection (GATT)  - a link between two devices. NOT required, NOT used.
 *   Advertising        - broadcasting to anyone listening. USED (Employee).
 *   Scanning           - listening for those broadcasts. USED (Host).
 * -----------------------------------------------------------------------------
 */

import { Platform } from 'react-native';
import { BleManager as PlxBleManager, State } from 'react-native-ble-plx';
import type { AppRole } from '../constants/appConfig';
import { describeError, log } from '../utils/logger';
import {
  getCapabilities,
  isLocationServicesEnabled,
  NATIVE_MODULE_AVAILABLE,
  type AdvertiserCapabilities,
} from './BleAdvertiser';
import {
  androidVersionLabel,
  hasAdvertisePermissions,
  hasScanPermissions,
} from './permissions';

/* =============================================================================
 * SHARED react-native-ble-plx INSTANCE
 * ========================================================================== */

let managerInstance: PlxBleManager | null = null;
let managerInitError: string | null = null;

/**
 * Created lazily, never at module scope. Constructing a BleManager touches the
 * native BLE stack; doing that at import time means a failure happens before
 * any error handling is mounted and shows up as a blank white screen.
 */
export function getBleManager(): PlxBleManager | null {
  if (managerInstance) {
    return managerInstance;
  }
  if (managerInitError) {
    return null;
  }

  try {
    log.info('BLE', 'Initializing BLE manager...');
    managerInstance = new PlxBleManager();
    log.info('BLE', 'react-native-ble-plx manager created');
    return managerInstance;
  } catch (error) {
    managerInitError = describeError(error);
    log.error(
      'BLE',
      'BLE library initialization failure: ' +
        managerInitError +
        '. Usually this means react-native-ble-plx is in package.json but the ' +
        'app was not rebuilt natively afterwards.',
    );
    return null;
  }
}

export function getManagerInitError(): string | null {
  return managerInitError;
}

/**
 * Tear down the BLE stack. Full app teardown only - a destroyed manager cannot
 * be reused, and any later getBleManager() hands back a dead object.
 */
export function destroyBleManager(): void {
  if (managerInstance) {
    log.info('BLE', 'Destroying BLE manager');
    try {
      managerInstance.destroy();
    } catch (error) {
      log.warn('BLE', 'destroy() threw: ' + describeError(error));
    }
    managerInstance = null;
  }
}

/* =============================================================================
 * ADAPTER STATE
 * ========================================================================== */

export type BluetoothState =
  | 'Unknown'
  | 'Resetting'
  | 'Unsupported'
  | 'Unauthorized'
  | 'PoweredOff'
  | 'PoweredOn';

export interface BluetoothStatus {
  state: BluetoothState;
  /** Hardware exists and the app is allowed to use it. */
  available: boolean;
  /** Hardware exists, is allowed, and is switched on. */
  ready: boolean;
  message: string;
}

function describeState(state: BluetoothState): BluetoothStatus {
  switch (state) {
    case 'PoweredOn':
      return { state, available: true, ready: true, message: 'Bluetooth is on and ready.' };
    case 'PoweredOff':
      return {
        state,
        available: true,
        ready: false,
        message: 'Bluetooth is switched off. Turn it on to continue.',
      };
    case 'Unsupported':
      return {
        state,
        available: false,
        ready: false,
        message:
          'This device does not support Bluetooth Low Energy. Use a physical ' +
          'phone - most emulators report this.',
      };
    case 'Unauthorized':
      return {
        state,
        available: false,
        ready: false,
        message: 'The app is not authorised to use Bluetooth. Grant the permissions and retry.',
      };
    case 'Resetting':
      return {
        state,
        available: true,
        ready: false,
        message: 'The Bluetooth stack is restarting. Wait a moment.',
      };
    default:
      return {
        state: 'Unknown',
        available: false,
        ready: false,
        message: 'Bluetooth state is not known yet.',
      };
  }
}

/**
 * Subscribe to real adapter state. Fires immediately with the current value,
 * then on every change - including the user toggling Bluetooth from the
 * notification shade, which is exactly what happens during a live demo.
 */
export function observeBluetoothState(
  callback: (status: BluetoothStatus) => void,
): () => void {
  const manager = getBleManager();

  if (!manager) {
    callback({
      state: 'Unsupported',
      available: false,
      ready: false,
      message: managerInitError || 'BLE manager unavailable - see the log.',
    });
    return () => {};
  }

  // `true` asks ble-plx to emit current state now, not only on next change.
  const subscription = manager.onStateChange(state => {
    const status = describeState(state as BluetoothState);
    log.info('BLE', 'Adapter state: ' + status.state);
    callback(status);
  }, true);

  return () => {
    try {
      subscription.remove();
    } catch {
      /* already removed */
    }
  };
}

export async function getBluetoothStatus(): Promise<BluetoothStatus> {
  const manager = getBleManager();
  if (!manager) {
    return describeState('Unsupported');
  }
  try {
    return describeState((await manager.state()) as BluetoothState);
  } catch (error) {
    log.error('BLE', 'state() failed: ' + describeError(error));
    return describeState('Unknown');
  }
}

export { State };

/* =============================================================================
 * READINESS
 * -----------------------------------------------------------------------------
 * One call answering "can this role work right now, and if not why". Every
 * blocker maps to a real failure mode that would otherwise present as
 * "the app just doesn't do anything".
 * ========================================================================== */

export type BlockerCode =
  | 'NOT_ANDROID'
  | 'NATIVE_MODULE_MISSING'
  | 'BLE_UNSUPPORTED'
  | 'ADVERTISING_UNSUPPORTED'
  | 'BLUETOOTH_OFF'
  | 'PERMISSIONS_MISSING'
  | 'LOCATION_SERVICES_OFF'
  | 'BLE_INIT_FAILED';

export interface Blocker {
  code: BlockerCode;
  title: string;
  detail: string;
  /** Whether the user can fix it, from in-app or from Settings. */
  fixable: boolean;
}

export interface Readiness {
  ready: boolean;
  blockers: Blocker[];
  bluetooth: BluetoothStatus;
  capabilities: AdvertiserCapabilities;
  permissionsGranted: boolean;
  locationServicesOn: boolean;
  platformLabel: string;
}

export async function checkReadiness(role: AppRole): Promise<Readiness> {
  const blockers: Blocker[] = [];
  const isHost = role === 'HOST';

  const [bluetooth, capabilities, locationServicesOn, permissionsGranted] =
    await Promise.all([
      getBluetoothStatus(),
      getCapabilities(),
      isLocationServicesEnabled(),
      isHost ? hasScanPermissions() : hasAdvertisePermissions(),
    ]);

  if (Platform.OS !== 'android') {
    blockers.push({
      code: 'NOT_ANDROID',
      title: 'Android only',
      detail:
        'Phase 1 targets Android. iOS cannot broadcast custom manufacturer ' +
        'data, so an iOS employee phone could not be identified this way.',
      fixable: false,
    });
  }

  // The native module serves capability queries and the advertiser. The Host
  // needs it for capability/location checks; the Employee needs it to advertise.
  if (!NATIVE_MODULE_AVAILABLE) {
    blockers.push({
      code: 'NATIVE_MODULE_MISSING',
      title: 'Native BLE module not linked',
      detail:
        'The BleAdvertiser Kotlin module was not found at runtime. Register ' +
        'BleAdvertiserPackage() in MainApplication.kt and run a full native ' +
        'rebuild. Reloading Metro is not enough - native code only changes on ' +
        'a rebuild.',
      fixable: true,
    });
  }

  if (managerInitError) {
    blockers.push({
      code: 'BLE_INIT_FAILED',
      title: 'BLE library failed to initialize',
      detail: managerInitError,
      fixable: true,
    });
  }

  if (bluetooth.state === 'Unsupported' || capabilities.bleSupported === false) {
    blockers.push({
      code: 'BLE_UNSUPPORTED',
      title: 'Bluetooth Low Energy not supported',
      detail: 'This device reports no BLE hardware. Use a physical phone.',
      fixable: false,
    });
  }

  if (bluetooth.state === 'PoweredOff') {
    blockers.push({
      code: 'BLUETOOTH_OFF',
      title: 'Bluetooth is off',
      detail: 'Switch Bluetooth on, then retry.',
      fixable: true,
    });
  }

  // Peripheral-role hardware is an EMPLOYEE concern only. A Host that can only
  // scan is perfectly fine.
  if (!isHost && !capabilities.advertisingSupported) {
    blockers.push({
      code: 'ADVERTISING_UNSUPPORTED',
      title: 'This phone cannot advertise over BLE',
      detail:
        'BluetoothAdapter.getBluetoothLeAdvertiser() returned null, meaning ' +
        'the chipset does not support the peripheral role. No app can work ' +
        'around this - use this phone as the Host instead, and a different ' +
        'phone as the Employee.',
      fixable: false,
    });
  }

  if (!permissionsGranted) {
    blockers.push({
      code: 'PERMISSIONS_MISSING',
      title: 'Bluetooth permissions not granted',
      detail: isHost
        ? 'Host mode needs Nearby devices (BLUETOOTH_SCAN) and location ' +
          'permission to receive BLE advertisements. Without them the scan ' +
          'starts and then reports nothing at all.'
        : 'Employee mode needs Nearby devices (BLUETOOTH_ADVERTISE) to ' +
          'broadcast your identifier.',
      fixable: true,
    });
  }

  // Location services gate SCANNING only. Advertising works with them off.
  if (isHost && !locationServicesOn) {
    blockers.push({
      code: 'LOCATION_SERVICES_OFF',
      title: 'Location services are off',
      detail:
        'Android requires the location master switch to be ON for BLE ' +
        'scanning. This is the most common silent failure: the scan starts ' +
        'with no error and simply never reports a device.',
      fixable: true,
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    bluetooth,
    capabilities,
    permissionsGranted,
    locationServicesOn,
    platformLabel: androidVersionLabel(),
  };
}
