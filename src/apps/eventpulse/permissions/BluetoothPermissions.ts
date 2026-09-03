/**
 * Bluetooth permissions, explained before they are requested.
 *
 * The brief is explicit (§43): no technical permission wall. So the flow is
 *
 *   plain-language screen  ->  system prompt  ->  recovery if refused
 *
 * and the plain-language screen says what the app will do with the radio in one
 * sentence, not what an OS permission string is called.
 *
 * Platform reality this encodes:
 *  - Android 12+ split Bluetooth into SCAN / ADVERTISE / CONNECT runtime
 *    permissions. `neverForLocation` on the scan permission is what lets us
 *    skip the location permission entirely — we genuinely do not want or derive
 *    location, and asking for it would be both intrusive and untrue.
 *  - Android 11 and below have no BLUETOOTH_SCAN, and the OS insists on
 *    location permission for BLE scanning. We ask for fine location there and
 *    say why.
 *  - iOS has one Bluetooth permission, granted through the first CoreBluetooth
 *    use, and the app can never turn the radio on itself.
 */

import { Linking, PermissionsAndroid, Platform } from 'react-native';

import type { BlePermissionState } from '../bluetooth/BleTransport';

export interface PermissionCopy {
  title: string;
  body: string;
  primaryAction: string;
  /** Shown when the OS will not prompt again. */
  recovery?: string;
}

export const PERMISSION_RATIONALE: PermissionCopy = {
  title: 'See who is around you',
  body:
    'EventPulse uses Bluetooth to notice which other attendees are nearby and roughly how far away they are. Android asks for the location permission before it will let any app scan for Bluetooth devices — EventPulse never reads or stores your location, and nothing about who is near you leaves your phone.',
  primaryAction: 'Turn on Bluetooth access',
};

export const PERMISSION_DENIED_COPY: PermissionCopy = {
  title: 'Nearby people are hidden',
  body:
    'Bluetooth permission is required to show attendees around you. You can still browse the full attendee list in Discover.',
  primaryAction: 'Enable Bluetooth access',
  recovery: 'Open Settings › EventPulse and allow Nearby devices.',
};

export const BLUETOOTH_OFF_COPY: PermissionCopy = {
  title: 'Bluetooth is off',
  body: 'Turn on Bluetooth to discover the people around you.',
  primaryAction: 'Turn on Bluetooth',
  recovery: 'Open Settings › Bluetooth and switch it on.',
};

export const UNSUPPORTED_COPY: PermissionCopy = {
  title: 'This device cannot scan for nearby people',
  body:
    'Its Bluetooth hardware does not support the low-energy scanning EventPulse needs. Discover and your connections still work normally.',
  primaryAction: 'Browse attendees',
};

/**
 * ACCESS_FINE_LOCATION is in this list, on Android 12+, for one reason only:
 * the hub's merged manifest can no longer declare BLUETOOTH_SCAN with
 * `neverForLocation`. BLE Attendance shares this APK and cannot see its own
 * employee advertisements when that flag is set, so it had to go app-wide —
 * see `plugins/withAttendanceNative.js`.
 *
 * Without the flag, Android 12+ treats a BLE scan as location-derived and
 * returns an empty result set unless this permission is held and Location is
 * switched on. EventPulse still never reads, stores or derives a location; it
 * just can no longer prove that to the OS for free.
 */
const ANDROID_12_PERMISSIONS = [
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.ACCESS_FINE_LOCATION',
] as const;

/**
 * Request whatever this OS version actually needs.
 *
 * Returns `blocked` when the user has chosen "don't ask again", which is the
 * only case where the UI should point at Settings instead of re-prompting —
 * re-prompting a blocked permission does nothing and looks broken.
 */
export async function requestBluetoothPermissions(): Promise<BlePermissionState> {
  if (Platform.OS !== 'android') {
    // iOS grants on first CoreBluetooth use; the native module reports the
    // outcome through `getPermissionState`.
    return 'undetermined';
  }

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;

  if (apiLevel >= 31) {
    const results = await PermissionsAndroid.requestMultiple([...ANDROID_12_PERMISSIONS]);
    const values = Object.values(results);
    if (values.every((value) => value === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
    if (values.some((value) => value === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return 'blocked';
    return 'denied';
  }

  // Pre-Android 12: BLE scanning is gated behind location, whether we want it
  // or not. The rationale screen explains this rather than letting the system
  // dialog imply we are tracking anyone.
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Allow EventPulse to find nearby attendees',
      message:
        'On this version of Android, Bluetooth scanning requires the location permission. EventPulse does not read or store your location.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );

  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

export async function checkBluetoothPermissions(): Promise<BlePermissionState> {
  if (Platform.OS !== 'android') return 'undetermined';

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;

  if (apiLevel >= 31) {
    const checks = await Promise.all(
      ANDROID_12_PERMISSIONS.map((permission) => PermissionsAndroid.check(permission)),
    );
    return checks.every(Boolean) ? 'granted' : 'undetermined';
  }

  const granted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return granted ? 'granted' : 'undetermined';
}

/** Send the user somewhere they can actually fix it. */
export function openSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/**
 * Android can ask the OS to enable the adapter; iOS cannot, and an app that
 * pretends otherwise just shows a button that does nothing.
 */
export function canRequestAdapterEnable(): boolean {
  return Platform.OS === 'android';
}
