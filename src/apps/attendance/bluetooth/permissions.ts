/**
 * permissions.ts
 * -----------------------------------------------------------------------------
 * Android runtime permission handling for BLE scanning and BLE advertising.
 *
 * Android's Bluetooth permission model changed completely in Android 12
 * (API 31), so this file branches on Platform.Version.
 *
 *   Android 11 and below (API <= 30)
 *     BLUETOOTH, BLUETOOTH_ADMIN     install-time, nothing to request
 *     ACCESS_FINE_LOCATION           RUNTIME, and genuinely required - without
 *                                    it a BLE scan starts "successfully" and
 *                                    then reports zero devices, forever.
 *
 *   Android 12 and above (API >= 31)
 *     BLUETOOTH_SCAN                 RUNTIME - required to scan
 *     BLUETOOTH_ADVERTISE            RUNTIME - required to advertise
 *     BLUETOOTH_CONNECT              RUNTIME - required to read the local
 *                                    adapter name and to connect
 *     ACCESS_FINE_LOCATION           RUNTIME - see the note below
 *
 * WHY WE STILL ASK FOR LOCATION ON ANDROID 12+
 * -----------------------------------------------------------------------------
 * Android 12 lets an app declare BLUETOOTH_SCAN with
 * android:usesPermissionFlags="neverForLocation", which drops the location
 * requirement. We deliberately do NOT do that, because that flag also makes the
 * platform filter location-bearing beacon advertisements out of scan results.
 * For a prototype whose entire purpose is "prove the advertisement is seen",
 * an extra permission prompt is a far smaller cost than results silently
 * disappearing. See docs/ANDROID_BLE_NOTES.md for the trade-off in full.
 * -----------------------------------------------------------------------------
 */

import { PermissionsAndroid, Platform, Linking } from 'react-native';
import type { Permission } from 'react-native';
import { log } from '../utils/logger';

export interface PermissionResult {
  granted: boolean;
  /** Permissions the user refused this time. */
  denied: string[];
  /**
   * Permissions refused with "Don't ask again". A second request() call for
   * these returns instantly without showing a dialog, so the only way forward
   * is the system app settings screen.
   */
  blocked: string[];
  message: string;
}

/**
 * Android 12 permission constants are missing from PermissionsAndroid.PERMISSIONS
 * on older React Native versions. The raw strings are stable platform values, so
 * fall back to them rather than passing `undefined` into request().
 */
const P = {
  FINE_LOCATION: (PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION ||
    'android.permission.ACCESS_FINE_LOCATION') as Permission,
  BLUETOOTH_SCAN: ((PermissionsAndroid.PERMISSIONS as Record<string, string>)
    .BLUETOOTH_SCAN || 'android.permission.BLUETOOTH_SCAN') as Permission,
  BLUETOOTH_ADVERTISE: ((PermissionsAndroid.PERMISSIONS as Record<string, string>)
    .BLUETOOTH_ADVERTISE ||
    'android.permission.BLUETOOTH_ADVERTISE') as Permission,
  BLUETOOTH_CONNECT: ((PermissionsAndroid.PERMISSIONS as Record<string, string>)
    .BLUETOOTH_CONNECT || 'android.permission.BLUETOOTH_CONNECT') as Permission,
  POST_NOTIFICATIONS: ((PermissionsAndroid.PERMISSIONS as Record<string, string>)
    .POST_NOTIFICATIONS || 'android.permission.POST_NOTIFICATIONS') as Permission,
};

function isAndroid13OrHigher(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

function isAndroid12OrHigher(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 31;
}

/** Strip the "android.permission." prefix so log lines and UI stay readable. */
function shortName(permission: string): string {
  return permission.replace('android.permission.', '');
}

async function requestAll(permissions: Permission[]): Promise<PermissionResult> {
  if (Platform.OS !== 'android') {
    return {
      granted: false,
      denied: [],
      blocked: [],
      message:
        'This prototype is Android-only. iOS cannot advertise a custom ' +
        'manufacturer-data payload in the background and is out of scope for v1.',
    };
  }

  if (permissions.length === 0) {
    return {
      granted: true,
      denied: [],
      blocked: [],
      message: 'No runtime permissions required on this Android version.',
    };
  }

  log.info(
    'PERMISSION',
    'Requesting: ' + permissions.map(shortName).join(', '),
  );

  let results: Record<string, string>;
  try {
    results = await PermissionsAndroid.requestMultiple(permissions);
  } catch (error) {
    const message = 'Permission request threw: ' + String(error);
    log.error('PERMISSION', message);
    return { granted: false, denied: permissions, blocked: [], message };
  }

  const denied: string[] = [];
  const blocked: string[] = [];

  permissions.forEach(permission => {
    const result = results[permission];
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return;
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      blocked.push(permission);
    } else {
      denied.push(permission);
    }
  });

  const granted = denied.length === 0 && blocked.length === 0;

  if (granted) {
    log.info('PERMISSION', 'All permissions granted');
    return {
      granted: true,
      denied: [],
      blocked: [],
      message: 'All required permissions granted.',
    };
  }

  const parts: string[] = [];
  if (denied.length > 0) {
    parts.push('Denied: ' + denied.map(shortName).join(', ') + '.');
  }
  if (blocked.length > 0) {
    parts.push(
      'Permanently denied: ' +
        blocked.map(shortName).join(', ') +
        '. Enable them in Settings > Apps > BleAttendance > Permissions.',
    );
  }

  const message = parts.join(' ');
  log.error('PERMISSION', message);

  return { granted: false, denied, blocked, message };
}

/**
 * Permissions needed to SCAN for advertisements (Host Mode).
 *
 * BLUETOOTH_CONNECT is genuinely required, not a cheap add: StatusDeliveryService
 * connects to the employee phone to write the status report back. On Android 12+
 * the same permission also gates reading the local adapter name for the
 * diagnostics panel.
 */
export async function requestScanPermissions(): Promise<PermissionResult> {
  const permissions: Permission[] = isAndroid12OrHigher()
    ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT, P.FINE_LOCATION]
    : [P.FINE_LOCATION];

  return requestAll(permissions);
}

/**
 * Permissions needed to ADVERTISE (Employee Mode).
 *
 * On Android 11 and below there is nothing to request: BLUETOOTH_ADMIN is an
 * install-time permission and advertising does not require location.
 *
 * BLUETOOTH_CONNECT is requested alongside BLUETOOTH_ADVERTISE on 12+ because
 * openGattServer needs it. Without it advertising still runs and the Host still
 * marks attendance, but the reply channel silently does not exist and the
 * employee is never told their own check-in.
 */
export async function requestAdvertisePermissions(): Promise<PermissionResult> {
  const permissions: Permission[] = isAndroid12OrHigher()
    ? [P.BLUETOOTH_ADVERTISE, P.BLUETOOTH_CONNECT]
    : [];

  /**
   * POST_NOTIFICATIONS (Android 13+) is requested here because the foreground
   * service that keeps advertising alive while the app is backgrounded MUST
   * show an ongoing notification.
   *
   * Without it the service still runs and advertising still works - only the
   * notification is hidden. So it is requested but NOT treated as required:
   * a denial must not block advertising.
   */
  if (isAndroid13OrHigher()) {
    permissions.push(P.POST_NOTIFICATIONS);
  }

  const result = await requestAll(permissions);

  // Re-evaluate ignoring POST_NOTIFICATIONS: it is nice to have, not essential.
  if (!result.granted) {
    const blockers = [...result.denied, ...result.blocked].filter(
      p => p !== P.POST_NOTIFICATIONS,
    );
    if (blockers.length === 0) {
      log.warn(
        'PERMISSION',
        'Notifications denied - advertising still works, but the ongoing ' +
          'notification will be hidden while it runs in the background.',
      );
      return {
        granted: true,
        denied: [],
        blocked: [],
        message: 'Bluetooth permissions granted (notification permission declined).',
      };
    }
  }

  return result;
}

/** Check without prompting - used to render current state on screen. */
export async function hasScanPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const permissions = isAndroid12OrHigher()
    ? [P.BLUETOOTH_SCAN, P.FINE_LOCATION]
    : [P.FINE_LOCATION];

  const checks = await Promise.all(
    permissions.map(p => PermissionsAndroid.check(p)),
  );
  return checks.every(Boolean);
}

/** Check without prompting - used to render current state on screen. */
export async function hasAdvertisePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  if (!isAndroid12OrHigher()) {
    return true;
  }
  return PermissionsAndroid.check(P.BLUETOOTH_ADVERTISE);
}

/** Open this app's system settings page, for permanently-denied permissions. */
export function openAppSettings(): void {
  log.info('PERMISSION', 'Opening app settings');
  Linking.openSettings().catch(error => {
    log.error('PERMISSION', 'Could not open settings: ' + String(error));
  });
}

/** Human-readable Android version label for the diagnostics panel. */
export function androidVersionLabel(): string {
  if (Platform.OS !== 'android') {
    return Platform.OS;
  }
  return 'Android API ' + String(Platform.Version);
}
