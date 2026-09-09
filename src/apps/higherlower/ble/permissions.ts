import { PermissionsAndroid, Platform } from 'react-native';
import type { Permission } from 'react-native';

/**
 * The runtime permissions a room needs, asked for at the moment the player
 * chooses to host or join rather than on launch — the request makes sense to
 * somebody who just tapped "Host a game" and to nobody who just opened a
 * guessing game.
 *
 * Android 12+ splits Bluetooth into scan / connect / advertise. Location comes
 * along because this binary cannot declare `neverForLocation` on its scan (a
 * sibling app in the same APK needs beacon-shaped adverts through the filter),
 * and without that flag the platform treats every scan as location-derived and
 * returns nothing. The game never reads a location; it just can no longer prove
 * that to the OS for free.
 *
 * iOS has no request API: the prompt appears when the BLE managers are created.
 */
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

export class BlePermissionError extends Error {
  constructor(readonly missing: string[]) {
    super(
      missing.length === 0
        ? 'Bluetooth permission was refused'
        : `Higher or Lower needs ${missing.join(' and ')} to find nearby phones. ` +
            'Grant it in Settings and try again.',
    );
    this.name = 'BlePermissionError';
  }
}

const shortName = (permission: string): string => permission.split('.').pop() ?? permission;

/** Asks for anything still missing. Throws with something a player can act on. */
export async function ensureBlePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const wanted = required();
  const results = await PermissionsAndroid.requestMultiple(wanted);
  const missing = wanted
    .filter((p) => results[p] !== PermissionsAndroid.RESULTS.GRANTED)
    .map(shortName);

  if (missing.length > 0) throw new BlePermissionError(missing);
}
