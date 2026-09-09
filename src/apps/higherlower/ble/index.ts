import { MockBleTransport } from './MockBleTransport';
import { centralAvailable, NativeBleTransport } from './NativeBleTransport';
import { peripheralAvailable } from './peripheral';
import { BleTransport } from './transport';

export * from './protocol';
export * from './transport';
export { makeRoomCode, normalizeCode } from './advertisement';
export {
  DEFAULT_CAPACITY,
  MAX_CAPACITY,
  MIN_CAPACITY,
} from './constants';

/**
 * Builds the link the multiplayer screens talk to.
 *
 * Two phones in the same room get the real radio: the host advertises a GATT
 * service and the joiners connect to it. That needs native code on both halves
 * of the link -- react-native-ble-plx for the central side, the BlePeripheral
 * module for the side that advertises -- so it only exists in a dev build.
 *
 * Launched from Expo Go there is no native radio to talk to, and rather than
 * show a Multiplayer tab that can only fail, the simulator stands in: the same
 * screens, the same protocol, opponents played by the solo AI. Everything above
 * this file is identical either way, and `transport.simulated` is what the UI
 * uses to say so out loud instead of pretending.
 */
export function createTransport(): BleTransport {
  return nativeBleAvailable() ? new NativeBleTransport() : new MockBleTransport();
}

/** Both halves of the link have to be present; one alone cannot host a game. */
export function nativeBleAvailable(): boolean {
  return peripheralAvailable() && centralAvailable();
}
