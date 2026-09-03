/**
 * Transport factories.
 *
 * These probe the native modules at runtime and report honestly when a role is
 * unavailable. If BLE peripheral support is missing the app says so and blocks
 * hosting -- it does not fall back to a simulated host.
 */
import {Platform} from 'react-native';
import {BleRole} from '../BleTypes';
import type {
  CentralTransport,
  PeripheralTransport,
  TransportProbe,
} from './Transport';
import {createLogger} from '../../utils/logger';

const log = createLogger('transport');

export * from './Transport';
export {BlePlxCentralTransport} from './CentralTransport';
export {BlePeripheralHostTransport} from './PeripheralTransport';

/**
 * Create the player-side transport.
 * react-native-ble-plx supports central role on both iOS and Android.
 */
export function createCentralTransport(): TransportProbe<CentralTransport> {
  try {
    // Required lazily so a missing native module surfaces as an unavailable
    // probe rather than a redbox at import time.
    const {BlePlxCentralTransport} = require('./CentralTransport') as typeof import('./CentralTransport');
    return {available: true, transport: new BlePlxCentralTransport()};
  } catch (err) {
    log.error('central transport unavailable', err);
    return {
      available: false,
      reason:
        'The Bluetooth module (react-native-ble-plx) is not linked into this build. ' +
        'Rebuild the native app after installing dependencies.',
    };
  }
}

/**
 * Create the host-side transport.
 *
 * Peripheral (GATT server) support is the fragile half of BLE on phones:
 *  - Android exposes BluetoothGattServer from API 21, but a minority of chipsets
 *    report no BluetoothLeAdvertiser at all and simply cannot host.
 *  - iOS supports CBPeripheralManager on every BLE device.
 * Either way the failure shows up when startAdvertising is called, which is
 * where the user-facing error is raised.
 */
export function createPeripheralTransport(): TransportProbe<PeripheralTransport> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return {
      available: false,
      reason: `Hosting is not supported on ${Platform.OS}.`,
    };
  }

  try {
    const {BlePeripheralHostTransport} =
      require('./PeripheralTransport') as typeof import('./PeripheralTransport');
    return {available: true, transport: new BlePeripheralHostTransport()};
  } catch (err) {
    log.error('peripheral transport unavailable', err);
    return {
      available: false,
      reason:
        'BLE peripheral support (react-native-ble-peripheral-manager) is not linked into ' +
        'this build. Hosting needs a GATT server; joining a nearby host still works.',
    };
  }
}

export {BleRole};
