/**
 * Android runtime permissions for the BLE test.
 *
 * Android 12 (API 31) and above
 *   BLUETOOTH_SCAN       — required to scan.
 *   BLUETOOTH_CONNECT    — required to open a GATT connection, and to read or
 *                          set the adapter name.
 *   BLUETOOTH_ADVERTISE  — required to advertise. Only the peripheral needs it,
 *                          but this test is both roles at once, so it asks.
 *   ACCESS_FINE_LOCATION — required HERE, and this is the part that surprises
 *                          people. A scan permission declared
 *                          `neverForLocation` skips it, but this APK cannot use
 *                          that flag: BLE Attendance shares the process and the
 *                          platform filters its beacon-shaped advertisements
 *                          out of every scan result when the flag is set, so it
 *                          is stripped app-wide in
 *                          `plugins/withAttendanceNative.js`. The manifest
 *                          therefore carries
 *                          `tools:remove="android:usesPermissionFlags"` on
 *                          BLUETOOTH_SCAN, and Android treats every scan in
 *                          this app as location-derived. Without this
 *                          permission — and with Location switched on in system
 *                          settings — a scan returns nothing at all, with no
 *                          error to explain why.
 *
 * Android 11 (API 30) and below
 *   BLUETOOTH and BLUETOOTH_ADMIN are install-time and need no prompt.
 *   ACCESS_FINE_LOCATION is the only runtime permission, and scanning is
 *   silently empty without it.
 *
 * iOS is deliberately out of scope for this test.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

import { bleTestLog } from './BleTestLog';

export interface PermissionOutcome {
  granted: boolean;
  missing: string[];
  message?: string;
}

function required(): Permission[] {
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;

  if (api >= 31) {
    return [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ];
  }
  return [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

/** The permission names this build needs, for display. */
export function requiredPermissionNames(): string[] {
  return required().map((permission) => String(permission).replace('android.permission.', ''));
}

export async function requestBleTestPermissions(): Promise<PermissionOutcome> {
  if (Platform.OS !== 'android') {
    return { granted: false, missing: [], message: 'This test is Android-only for now.' };
  }

  const permissions = required();
  bleTestLog.step('Requesting permissions', requiredPermissionNames().join(', '));

  try {
    const results = await PermissionsAndroid.requestMultiple(permissions);
    const missing = permissions
      .filter((permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED)
      .map((permission) => String(permission).replace('android.permission.', ''));

    if (missing.length > 0) {
      bleTestLog.fail('Permissions not granted', missing.join(', '));
      return {
        granted: false,
        missing,
        message: `Not granted: ${missing.join(', ')}. Grant them in Settings > Apps > Permissions.`,
      };
    }

    bleTestLog.ok('Permissions granted', requiredPermissionNames().join(', '));
    return { granted: true, missing: [] };
  } catch (error) {
    bleTestLog.fail('Permission request threw', error);
    return { granted: false, missing: [], message: 'Could not request permissions.' };
  }
}

/** Check without prompting, so the screen can show the true starting state. */
export async function hasBleTestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  for (const permission of required()) {
    if (!(await PermissionsAndroid.check(permission))) return false;
  }
  return true;
}
