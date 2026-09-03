/**
 * Test-environment stubs.
 *
 * These are the ONLY mocks in the project, and they exist so the pure protocol logic can
 * be tested off-device. Nothing in src/ ever substitutes a fake for a real BLE operation:
 * the app either performs a genuine radio operation or reports that it cannot.
 */

// react-native-get-random-values installs a native CSPRNG that has no JS-test equivalent.
// Node's webcrypto is a real CSPRNG, so tests use that rather than a stub sequence.
const {webcrypto} = require('crypto');
if (!global.crypto) {
  global.crypto = webcrypto;
}
jest.mock('react-native-get-random-values', () => ({}));

// The backing store lives on globalThis rather than in the module closure so it SURVIVES
// jest.resetModules(). That is not a convenience: it is what makes "kill the app and
// reopen it" testable. A restart throws away every in-memory object while the device's
// storage stays exactly where it was, and a store that reset with the module registry
// would model the opposite.
// Created here rather than inside the mock factory so it exists even before the first
// require of AsyncStorage — a test that only imports types would otherwise find nothing.
/* global globalThis */
globalThis.__asyncStorageStore = globalThis.__asyncStorageStore ?? new Map();

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = globalThis.__asyncStorageStore;
  return {
    __esModule: true,
    default: {
      getItem: async key => (store.has(key) ? store.get(key) : null),
      setItem: async (key, value) => {
        store.set(key, value);
      },
      removeItem: async key => {
        store.delete(key);
      },
      getAllKeys: async () => Array.from(store.keys()),
      // v2 of async-storage calls this multiRemove; the app moved to that name when it
      // moved to the hub's pinned version, and a mock that kept the old one would let a
      // real breakage pass.
      multiRemove: async keys => {
        keys.forEach(k => store.delete(k));
      },
      multiGet: async keys => keys.map(k => [k, store.has(k) ? store.get(k) : null]),
      multiSet: async entries => {
        entries.forEach(([k, v]) => store.set(k, v));
      },
      clear: async () => {
        store.clear();
      },
    },
  };
});

// react-native-ble-plx requires a native binary; instantiating it under Jest would throw.
//
// This stub does NOT simulate BLE. It performs no scanning, no connecting and no data
// transfer — real BLE behaviour is verified on hardware and nowhere else. The one thing
// it does model is the adapter STATE callback, because turning Bluetooth off is an event
// the OS delivers to us and the interesting code is our own reaction to it: tearing down
// links and stopping the scan. Driving that callback tests our teardown, not the radio.
globalThis.__bleStateListeners = globalThis.__bleStateListeners ?? new Set();
globalThis.__setBleState = state => {
  globalThis.__bleAdapterState = state;
  for (const listener of globalThis.__bleStateListeners) {
    listener(state);
  }
};

jest.mock('react-native-ble-plx', () => ({
  BleManager: class {
    onStateChange(listener, emitCurrentState) {
      globalThis.__bleStateListeners.add(listener);
      if (emitCurrentState) {
        listener(globalThis.__bleAdapterState ?? 'Unknown');
      }
      return {
        remove() {
          globalThis.__bleStateListeners.delete(listener);
        },
      };
    }
    state() {
      return Promise.resolve(globalThis.__bleAdapterState ?? 'Unknown');
    }
    destroy() {}
  },
  State: {
    PoweredOn: 'PoweredOn',
    PoweredOff: 'PoweredOff',
    Unauthorized: 'Unauthorized',
    Unsupported: 'Unsupported',
    Resetting: 'Resetting',
    Unknown: 'Unknown',
  },
  ScanMode: {LowLatency: 2},
}));
