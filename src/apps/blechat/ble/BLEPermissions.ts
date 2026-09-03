import {PermissionsAndroid, Platform, Linking} from 'react-native';
import type {Permission} from 'react-native';
import type {PermissionState} from '../types/BLE';
import {logger} from '../utils/logger';

const TAG = 'Permissions';

export interface PermissionResult {
  state: PermissionState;
  /** Permissions the user refused, for display. */
  denied: string[];
  /** Permissions the user set to "don't ask again". Only a Settings trip fixes these. */
  blocked: string[];
}

/**
 * Which permissions BLE actually needs depends on the Android version:
 *
 *  API 31+ (Android 12+): BLUETOOTH_SCAN / BLUETOOTH_CONNECT / BLUETOOTH_ADVERTISE.
 *    Because the manifest declares BLUETOOTH_SCAN with neverForLocation, NO location
 *    permission is needed. Asking for one anyway would be requesting more than we use.
 *
 *  API 23..30: BLE scanning genuinely required a location permission at the OS level —
 *    scan results come back empty without it. BLUETOOTH / BLUETOOTH_ADMIN are install-time.
 *
 * iOS has no runtime request API for Bluetooth: the prompt appears the first time a
 * CBCentralManager / CBPeripheralManager is instantiated, and the answer surfaces as the
 * manager's authorization state. So there is nothing to request here.
 */
function requiredAndroidPermissions(): Permission[] {
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;

  if (api >= 31) {
    return [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    ];
  }

  return [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

export async function checkBlePermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    // iOS: authorization is reported by the BLE managers, not by a permissions API.
    return {state: 'unknown', denied: [], blocked: []};
  }

  const required = requiredAndroidPermissions();
  const denied: string[] = [];

  for (const permission of required) {
    const granted = await PermissionsAndroid.check(permission);
    if (!granted) {
      denied.push(shortName(permission));
    }
  }

  return {
    state: denied.length === 0 ? 'granted' : 'denied',
    denied,
    blocked: [],
  };
}

export async function requestBlePermissions(): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return {state: 'unknown', denied: [], blocked: []};
  }

  const required = requiredAndroidPermissions();
  logger.info(TAG, `requesting ${required.map(shortName).join(', ')}`);

  let results: Record<string, string>;
  try {
    results = await PermissionsAndroid.requestMultiple(required);
  } catch (err) {
    logger.error(TAG, 'requestMultiple threw', err);
    return {state: 'denied', denied: required.map(shortName), blocked: []};
  }

  const denied: string[] = [];
  const blocked: string[] = [];

  for (const permission of required) {
    const result = results[permission];
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      continue;
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      blocked.push(shortName(permission));
    } else {
      denied.push(shortName(permission));
    }
  }

  let state: PermissionState = 'granted';
  if (blocked.length > 0) {
    state = 'blocked';
  } else if (denied.length > 0) {
    state = 'denied';
  }

  logger.info(
    TAG,
    `result=${state}` +
      (denied.length ? ` denied=[${denied.join(',')}]` : '') +
      (blocked.length ? ` blocked=[${blocked.join(',')}]` : ''),
  );

  return {state, denied, blocked};
}

/** For permanently denied permissions the only remedy is the OS settings screen. */
export function openAppSettings(): void {
  Linking.openSettings().catch(err =>
    logger.error(TAG, 'openSettings failed', err),
  );
}

function shortName(permission: string): string {
  const parts = permission.split('.');
  return parts[parts.length - 1];
}

export function describePermissionState(state: PermissionState): string {
  switch (state) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied — tap to request again';
    case 'blocked':
      return 'Permanently denied — enable in system settings';
    case 'unavailable':
      return 'Not available on this device';
    default:
      return 'Not determined';
  }
}
