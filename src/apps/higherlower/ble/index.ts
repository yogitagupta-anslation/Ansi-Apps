import { MockBleTransport } from './MockBleTransport';
import { BleTransport } from './transport';

export * from './protocol';
export * from './transport';
export { makeRoomCode } from './MockBleTransport';

/**
 * Builds the link the multiplayer screens talk to.
 *
 * Today that is always the simulator, which is what makes Multiplayer playable
 * in Expo Go with no second phone. Wiring the real radio means adding a driver
 * next to MockBleTransport that implements `BleTransport` and returning it here
 * when the native modules are present:
 *
 *   1. Central side (scan / connect / subscribe): react-native-ble-plx.
 *   2. Peripheral side (advertise / accept writes): ble-plx cannot advertise, so
 *      the host needs a peripheral module such as react-native-ble-advertiser.
 *   3. One service UUID for the game, two characteristics: host->peers notify,
 *      peers->host write. `send` writes; `onMessage` fans notifications out.
 *   4. Request an MTU of 185 after connecting so a whole protocol message fits
 *      in one packet -- see MAX_PAYLOAD in protocol.ts.
 *   5. Both need a dev build plus runtime permissions: BLUETOOTH_SCAN,
 *      BLUETOOTH_ADVERTISE and BLUETOOTH_CONNECT on Android 12+, and
 *      NSBluetoothAlwaysUsageDescription on iOS.
 *
 * Nothing above this file knows which one it got.
 */
export function createTransport(): BleTransport {
  return new MockBleTransport();
}
