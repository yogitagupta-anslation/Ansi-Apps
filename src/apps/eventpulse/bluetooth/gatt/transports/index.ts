/**
 * The GATT transport factory.
 *
 * Probes the two native libraries at runtime and reports honestly when a role
 * is missing, in the same shape Treasure Hunt's `ble/transport/index.ts` uses.
 * The rule both follow: if a capability is absent, say so and let the UI tell
 * the user. Never fall back to something that looks like it works.
 *
 * This file and `BlePlxGattTransport.ts` are the only two in the GATT layer
 * that import `react-native` or a BLE package. Everything else is plain
 * TypeScript, which is what lets the eventpulse Jest project run in a bare node
 * environment with no mocks at all.
 */

import { Platform } from 'react-native';

import { config } from '../../../runtime/config';
import { GattTransportError, type GattTransport } from '../GattTransport';

export type GattTransportProbe =
  | { available: true; transport: GattTransport }
  | { available: false; reason: string };

/**
 * Build the real transport.
 *
 * The central half is required — without `react-native-ble-plx` there is no
 * GATT at all. The peripheral half is optional and degrades: a phone that
 * cannot host can still connect out, which is a genuinely useful half-capability
 * and is reported through `getCapabilities()` rather than by failing here.
 */
export function createGattTransport(): GattTransportProbe {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return { available: false, reason: `GATT is not supported on ${Platform.OS}.` };
  }

  if (config.gattStack === 'blechat') {
    const probe = createBleChatTransport();
    // Deliberately no silent fallback. If the stack that was asked for is not
    // there, saying so is worth more than quietly running the other one and
    // leaving a test result that means nothing.
    return probe;
  }

  let plx: unknown;
  try {
    // Required lazily so a missing native module surfaces as an unavailable
    // probe rather than a redbox at import time.
    const module = require('react-native-ble-plx') as {
      BleManager: new () => unknown;
    };
    plx = new module.BleManager();
  } catch (error) {
    return {
      available: false,
      reason:
        'react-native-ble-plx is not linked into this build, so EventPulse cannot open a ' +
        'connection to another phone. Rebuild the development client.',
    };
  }

  let peripheral: unknown = null;
  try {
    peripheral = require('react-native-ble-peripheral-manager');
  } catch {
    // Central-only. Reported through getCapabilities(); not fatal.
    peripheral = null;
  }

  try {
    const { BlePlxGattTransport } =
      require('./BlePlxGattTransport') as typeof import('./BlePlxGattTransport');
    return {
      available: true,
      transport: new BlePlxGattTransport(
        plx as ConstructorParameters<typeof BlePlxGattTransport>[0],
        peripheral as ConstructorParameters<typeof BlePlxGattTransport>[1],
      ),
    };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof GattTransportError
          ? error.message
          : 'The EventPulse GATT transport could not be constructed in this build.',
    };
  }
}

/**
 * The BleChat-backed stack.
 *
 * Required lazily, like everything else here, so a build without the native
 * modules reports an unavailable probe rather than throwing at import time.
 */
function createBleChatTransport(): GattTransportProbe {
  try {
    const { BleChatGattTransport, isBleChatTransportAvailable } =
      require('./BleChatGattTransport') as typeof import('./BleChatGattTransport');

    if (!isBleChatTransportAvailable()) {
      return {
        available: false,
        reason:
          'The BleChat native BLE modules are not in this build. Run `npx expo prebuild -p ' +
          'android` and rebuild, or unset EXPO_PUBLIC_EVENTPULSE_GATT to use the previous ' +
          'transport.',
      };
    }

    return { available: true, transport: new BleChatGattTransport() };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof GattTransportError
          ? error.message
          : 'The BleChat-backed GATT transport could not be constructed in this build.',
    };
  }
}
