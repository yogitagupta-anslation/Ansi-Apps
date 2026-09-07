/**
 * Test-environment stubs.
 *
 * These are the ONLY mocks in the project, and they exist so the pure protocol logic can
 * be tested off-device. Nothing in src/ ever substitutes a fake for a real BLE operation:
 * the app either performs a genuine radio operation or reports that it cannot.
 */

// react-native-get-random-values installs a native CSPRNG that has no JS-test equivalent.
// Node's webcrypto is a real CSPRNG, so tests use that rather than a stub sequence.
const { webcrypto } = require("crypto");
if (!global.crypto) {
  global.crypto = webcrypto;
}
jest.mock("react-native-get-random-values", () => ({}));

// The backing store lives on globalThis rather than in the module closure so it SURVIVES
// jest.resetModules(). That is not a convenience: it is what makes "kill the app and
// reopen it" testable. A restart throws away every in-memory object while the device's
// storage stays exactly where it was, and a store that reset with the module registry
// would model the opposite.
// Created here rather than inside the mock factory so it exists even before the first
// require of AsyncStorage — a test that only imports types would otherwise find nothing.
/* global globalThis */
globalThis.__asyncStorageStore = globalThis.__asyncStorageStore ?? new Map();

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = globalThis.__asyncStorageStore;
  return {
    __esModule: true,
    default: {
      getItem: async (key) => (store.has(key) ? store.get(key) : null),
      setItem: async (key, value) => {
        store.set(key, value);
      },
      removeItem: async (key) => {
        store.delete(key);
      },
      getAllKeys: async () => Array.from(store.keys()),
      // v2 of async-storage calls this multiRemove; the app moved to that name when it
      // moved to the hub's pinned version, and a mock that kept the old one would let a
      // real breakage pass.
      multiRemove: async (keys) => {
        keys.forEach((k) => store.delete(k));
      },
      multiGet: async (keys) =>
        keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
      multiSet: async (entries) => {
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
globalThis.__setBleState = (state) => {
  globalThis.__bleAdapterState = state;
  for (const listener of globalThis.__bleStateListeners) {
    listener(state);
  }
};

/**
 * BleError and BleErrorCode are NOT native — they are the library's plain-JS error type
 * and its published code table, and the classifier's whole job is reading them. Leaving
 * them off this mock made `err instanceof BleError` a TypeError under test (`instanceof
 * undefined`), so every path through classifyBleError that was not an Android 133 threw
 * instead of classifying, and no test could reach the mapping at all.
 *
 * The numbers are copied from react-native-ble-plx/src/BleError.js rather than imported,
 * because that file is untransformed Flow under this Jest config. They are part of the
 * library's public API and stable; a drift would show up as a test asserting a reason the
 * app no longer produces.
 */
const BleErrorCode = {
  UnknownError: 0,
  OperationCancelled: 2,
  OperationTimedOut: 3,
  OperationStartFailed: 4,
  BluetoothUnsupported: 100,
  BluetoothUnauthorized: 101,
  BluetoothPoweredOff: 102,
  DeviceConnectionFailed: 200,
  DeviceDisconnected: 201,
  DeviceNotFound: 204,
  DeviceNotConnected: 205,
  DeviceMTUChangeFailed: 206,
  ServicesDiscoveryFailed: 300,
  ServiceNotFound: 302,
  ServicesNotDiscovered: 303,
  CharacteristicsDiscoveryFailed: 400,
  CharacteristicNotifyChangeFailed: 403,
  CharacteristicNotFound: 404,
  CharacteristicsNotDiscovered: 405,
};

class BleError extends Error {
  constructor(nativeBleError, message) {
    super(typeof message === "string" ? message : "Unknown error occurred");
    const native =
      typeof nativeBleError === "string"
        ? { errorCode: BleErrorCode.UnknownError, reason: nativeBleError }
        : (nativeBleError ?? {});
    this.errorCode = native.errorCode ?? BleErrorCode.UnknownError;
    this.attErrorCode = native.attErrorCode ?? null;
    this.iosErrorCode = native.iosErrorCode ?? null;
    this.androidErrorCode = native.androidErrorCode ?? null;
    this.reason = native.reason ?? null;
    this.name = "BleError";
  }
}
jest.mock("react-native-ble-plx", () => {
  const BleErrorCode = {
    UnknownError: 0,
    OperationCancelled: 2,
    OperationTimedOut: 3,
    OperationStartFailed: 4,
    BluetoothUnsupported: 100,
    BluetoothUnauthorized: 101,
    BluetoothPoweredOff: 102,
    DeviceConnectionFailed: 200,
    DeviceDisconnected: 201,
    DeviceNotFound: 204,
    DeviceNotConnected: 205,
    DeviceMTUChangeFailed: 206,
    ServicesDiscoveryFailed: 300,
    ServiceNotFound: 302,
    ServicesNotDiscovered: 303,
    CharacteristicsDiscoveryFailed: 400,
    CharacteristicNotifyChangeFailed: 403,
    CharacteristicNotFound: 404,
    CharacteristicsNotDiscovered: 405,
  };

  class BleError extends Error {
    // Same contract as the real one: the second argument is a code -> message mapping,
    // and the message is looked up from it by the error's own code.
    constructor(nativeBleError, errorMessageMapping) {
      super();
      const mapping =
        typeof errorMessageMapping === "string" ? {} : (errorMessageMapping ?? {});
      const native =
        typeof nativeBleError === "string"
          ? { errorCode: BleErrorCode.UnknownError, reason: nativeBleError }
          : (nativeBleError ?? {});
      this.errorCode = native.errorCode ?? BleErrorCode.UnknownError;
      this.message =
        (typeof errorMessageMapping === "string" ? errorMessageMapping : null) ??
        mapping[this.errorCode] ??
        mapping[BleErrorCode.UnknownError] ??
        "Unknown error occurred";
      this.attErrorCode = native.attErrorCode ?? null;
      this.iosErrorCode = native.iosErrorCode ?? null;
      this.androidErrorCode = native.androidErrorCode ?? null;
      this.reason = native.reason ?? null;
      this.name = "BleError";
    }
  }

  return {
    BleError,
    BleErrorCode,
    BleManager: class {
      onStateChange(listener, emitCurrentState) {
        globalThis.__bleStateListeners.add(listener);
        if (emitCurrentState) {
          listener(globalThis.__bleAdapterState ?? "Unknown");
        }
        return {
          remove() {
            globalThis.__bleStateListeners.delete(listener);
          },
        };
      }
      state() {
        return Promise.resolve(globalThis.__bleAdapterState ?? "Unknown");
      }
      destroy() {}
    },
    State: {
      PoweredOn: "PoweredOn",
      PoweredOff: "PoweredOff",
      Unauthorized: "Unauthorized",
      Unsupported: "Unsupported",
      Resetting: "Resetting",
      Unknown: "Unknown",
    },
    ScanMode: { LowLatency: 2 },
  };
});
