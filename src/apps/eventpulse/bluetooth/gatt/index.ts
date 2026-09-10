/**
 * The GATT layer's public surface.
 *
 * DELIBERATELY PURE. Nothing exported from here imports `react-native` or a BLE
 * package, so a test — or any module that only needs the types — can import the
 * barrel without dragging a native dependency in. The two files that do touch
 * native code are reached through `./transports` instead, and only by the
 * composition root.
 */

export * from './GattProfile';
export * from './GattFraming';
export * from './GattMessage';
export * from './GattLink';
export * from './GattTransport';
export * from './GattSessionManager';
export { InMemoryGattTransport } from './transports/InMemoryGattTransport';
export type {
  InMemoryGattOptions,
  InMemoryWireFaults,
} from './transports/InMemoryGattTransport';
