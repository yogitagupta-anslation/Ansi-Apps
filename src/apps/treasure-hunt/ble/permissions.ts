/**
 * Runtime Bluetooth permissions.
 *
 * Android
 *   API < 31 : BLE scanning is treated as a location capability, so
 *              ACCESS_FINE_LOCATION must be granted at runtime. BLUETOOTH and
 *              BLUETOOTH_ADMIN are install-time only.
 *   API >= 31: the Bluetooth permissions split out. BLUETOOTH_SCAN and
 *              BLUETOOTH_CONNECT are needed to join; BLUETOOTH_ADVERTISE is
 *              additionally needed to host. ACCESS_FINE_LOCATION is needed too.
 *
 *              As a standalone app this declared
 *              android:usesPermissionFlags="neverForLocation" on the scan
 *              permission, which skipped the location prompt entirely. Inside the
 *              hub that flag is gone: BLE Attendance shares this APK and the
 *              platform filters its beacon-shaped advertisements out of every
 *              scan result when the flag is set, so it had to be stripped
 *              app-wide — see plugins/withAttendanceNative.js. Without it,
 *              Android 12+ treats a scan as location-derived and returns nothing
 *              unless this permission is held and Location is switched on.
 *              The game still has no concept of real-world position.
 *
 * iOS
 *   There is no runtime request API. CoreBluetooth shows the system prompt on
 *   first use, driven by NSBluetoothAlwaysUsageDescription in Info.plist. The
 *   result surfaces later as an Unauthorized adapter state, which the UI
 *   already handles.
 */
import {PermissionsAndroid, Platform} from 'react-native';
import type {Permission} from 'react-native';
import {BleRole} from './BleTypes';
import {createLogger} from '../utils/logger';

const log = createLogger('permissions');

export interface PermissionResult {
  granted: boolean;
  /** Permissions the user actively refused. */
  denied: string[];
  /** Permissions refused with "don't ask again" -- only Settings can fix these. */
  blocked: string[];
  message?: string;
}

const GRANTED = PermissionsAndroid.RESULTS.GRANTED;
const NEVER_ASK_AGAIN = PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

function androidPermissionsFor(role: BleRole): Permission[] {
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;

  if (apiLevel >= 31) {
    const perms: Permission[] = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ];
    if (role === BleRole.Peripheral) {
      perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE);
    }
    return perms;
  }

  // Pre-12: scanning is gated behind location.
  return [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
}

export async function requestBlePermissions(role: BleRole): Promise<PermissionResult> {
  if (Platform.OS === 'ios') {
    // Nothing to request up front; CoreBluetooth prompts on first use.
    return {granted: true, denied: [], blocked: []};
  }

  if (Platform.OS !== 'android') {
    return {
      granted: false,
      denied: [],
      blocked: [],
      message: `Bluetooth is not supported on ${Platform.OS}.`,
    };
  }

  const permissions = androidPermissionsFor(role);

  try {
    const results = await PermissionsAndroid.requestMultiple(permissions);
    const denied: string[] = [];
    const blocked: string[] = [];

    for (const permission of permissions) {
      const result = results[permission];
      if (result === GRANTED) {
        continue;
      }
      if (result === NEVER_ASK_AGAIN) {
        blocked.push(permission);
      } else {
        denied.push(permission);
      }
    }

    const granted = denied.length === 0 && blocked.length === 0;
    if (!granted) {
      log.warn('bluetooth permissions incomplete', {denied, blocked});
    }

    return {
      granted,
      denied,
      blocked,
      message: granted
        ? undefined
        : blocked.length > 0
          ? 'Bluetooth permission was permanently denied. Enable it in Settings > Apps > Treasure Hunt > Permissions.'
          : 'Treasure Hunt needs Bluetooth permission to find nearby players.',
    };
  } catch (err) {
    log.error('permission request threw', err);
    return {
      granted: false,
      denied: permissions.map(String),
      blocked: [],
      message: 'Could not request Bluetooth permissions.',
    };
  }
}

/** Check without prompting -- used to decide whether to show a rationale. */
export async function hasBlePermissions(role: BleRole): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const permissions = androidPermissionsFor(role);
  for (const permission of permissions) {
    if (!(await PermissionsAndroid.check(permission))) {
      return false;
    }
  }
  return true;
}
