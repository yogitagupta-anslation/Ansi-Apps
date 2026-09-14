/**
 * NativeBleTransport — the bridge to the platform radio.
 *
 * This file is deliberately thin. Everything that could hold a bug worth
 * testing (framing, dedup, smoothing, presence state) lives above the seam in
 * plain TypeScript; the native side only does what JavaScript cannot: talk to
 * `BluetoothLeScanner` / `BluetoothLeAdvertiser` on Android and `CBCentralManager`
 * / `CBPeripheralManager` on iOS.
 *
 * Native counterparts:
 *   android/app/src/main/java/com/eventpulse/ble/EventPulseBleModule.kt
 *   ios/EventPulse/EventPulseBle.swift
 *
 * Packets cross the bridge as base64 because sending a JS array per packet is
 * measurably expensive at conference densities.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { BleScanResult } from '../../types';
import { requestBluetoothPermissions } from '../../permissions/BluetoothPermissions';
import { base64ToBytes, bytesToBase64 } from '../../utils/base64';

// Re-exported: these used to live here, and `bytesToBase64` in particular is
// imported by name elsewhere. The implementation moved to utils/base64.ts so it
// could be unit-tested and shared with the GATT transport.
export { base64ToBytes, bytesToBase64 };
import {
  BleTransportError,
  type AdvertiseOptions,
  type BleAdapterState,
  type BleCapabilityReport,
  type BlePermissionState,
  type BleTransport,
  type BleTransportEvents,
  type ScanOptions,
} from '../BleTransport';

interface NativeScanEvent {
  data: string; // base64
  rssi: number;
  timestamp: number;
  deviceKey?: string;
}

/** What the native gate can see. Used for tracing, never for control flow. */
export interface BlePermissionDiagnostics {
  /** Short names, e.g. BLUETOOTH_CONNECT. Empty when everything is granted. */
  missing: string[];
  granted: boolean;
  sdkInt: number;
  /**
   * The adapter's current name, or null when it could not be read.
   *
   * Null is meaningful: reading it needs BLUETOOTH_CONNECT on API 31+, which is
   * the same permission the peripheral library needs to write it.
   */
  adapterName: string | null;
}

interface NativeBleModule {
  getCapabilities(): Promise<BleCapabilityReport>;
  getAdapterState(): Promise<BleAdapterState>;
  requestPermissions(): Promise<BlePermissionState>;
  getPermissionState(): Promise<BlePermissionState>;
  getPermissionDiagnostics(): Promise<BlePermissionDiagnostics>;
  requestEnable(): Promise<boolean>;
  startScan(serviceUuid16: number, mode: string, allowDuplicates: boolean): Promise<void>;
  stopScan(): Promise<void>;
  startAdvertising(serviceUuid16: number, payloadBase64: string, mode: string, txPower: string): Promise<void>;
  updateAdvertising(serviceUuid16: number, payloadBase64: string, mode: string, txPower: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * How long to wait on the system permission dialog before carrying on.
 *
 * Long enough for someone to actually read and answer it; short enough that
 * a dialog which never returns a result cannot strand the app on its loading
 * screen.
 */
const PERMISSION_PROMPT_TIMEOUT_MS = 30_000;

const SCAN_EVENT = 'EventPulseBleScanResult';
const ADAPTER_EVENT = 'EventPulseBleAdapterState';
const ERROR_EVENT = 'EventPulseBleError';

export class NativeBleTransport implements BleTransport {
  readonly name = 'native';

  private readonly module: NativeBleModule;
  private readonly emitter: NativeEventEmitter;
  private readonly listeners = new Set<Partial<BleTransportEvents>>();
  private subscriptions: { remove(): void }[] = [];

  constructor() {
    const nativeModule = NativeModules.EventPulseBle as NativeBleModule | undefined;
    if (!nativeModule) {
      throw new BleTransportError(
        'unsupported',
        'EventPulseBle native module is not linked. Run a development build — Expo Go and ' +
          'plain JS builds cannot advertise or scan.',
        false,
      );
    }
    this.module = nativeModule;
    this.emitter = new NativeEventEmitter(NativeModules.EventPulseBle);
    this.attach();
  }

  private attach(): void {
    this.subscriptions.push(
      this.emitter.addListener(SCAN_EVENT, (event: NativeScanEvent) => {
        const result: BleScanResult = {
          data: base64ToBytes(event.data),
          rssi: event.rssi,
          timestamp: event.timestamp || Date.now(),
          deviceKey: event.deviceKey,
        };
        for (const listener of this.listeners) listener.onScanResult?.(result);
      }),
    );

    this.subscriptions.push(
      this.emitter.addListener(ADAPTER_EVENT, (state: BleAdapterState) => {
        for (const listener of this.listeners) listener.onAdapterStateChange?.(state);
      }),
    );

    this.subscriptions.push(
      this.emitter.addListener(ERROR_EVENT, (event: { code: string; message: string }) => {
        const error = new BleTransportError(
          (event.code as BleTransportError['code']) ?? 'internal',
          event.message ?? 'Unknown Bluetooth error',
        );
        for (const listener of this.listeners) listener.onError?.(error);
      }),
    );
  }

  getCapabilities(): Promise<BleCapabilityReport> {
    return this.module.getCapabilities();
  }

  getAdapterState(): Promise<BleAdapterState> {
    return this.module.getAdapterState();
  }

  /**
   * Ask for real.
   *
   * The native `requestPermissions` only ever *reported* the current answer —
   * the prompt was deliberately left to JavaScript so the rationale screen and
   * the system dialog stayed in one place. But nothing on this path ever called
   * the JavaScript one, so the scanner's "undetermined, so ask" branch asked
   * the module a question it could not act on and took the answer as final.
   *
   * Prompting here keeps the original split — the rationale still belongs to
   * the screen — while making the transport's own request mean what it says.
   */
  async requestPermissions(): Promise<BlePermissionState> {
    /*
     * Bounded, because this sits on the boot path.
     *
     * `presence.start()` is awaited before the event screen can open, so a
     * prompt that never settles does not fail — it hangs the app on its
     * loading screen with nothing on screen to explain why. That is exactly
     * what happened the first time this genuinely asked: the system dialog
     * appeared, was dismissed without a result, and the promise stayed pending
     * for ever.
     *
     * Waiting is still right — the app cannot scan without an answer — but
     * waiting FOR EVER is not. The native call afterwards re-reads the real
     * grant state, so a timeout reports the truth rather than a guess, and the
     * scanner's existing `blocked_permission` path shows the rationale.
     */
    await Promise.race([
      requestBluetoothPermissions().catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, PERMISSION_PROMPT_TIMEOUT_MS)),
    ]);
    return this.module.requestPermissions();
  }

  getPermissionDiagnostics(): Promise<BlePermissionDiagnostics> {
    return this.module.getPermissionDiagnostics();
  }

  getPermissionState(): Promise<BlePermissionState> {
    return this.module.getPermissionState();
  }

  /**
   * iOS never allows an app to switch the radio on; the native module resolves
   * false there and the UI routes the user to Settings instead.
   */
  requestEnable(): Promise<boolean> {
    if (Platform.OS === 'ios') return Promise.resolve(false);
    return this.module.requestEnable();
  }

  startScan(options: ScanOptions): Promise<void> {
    return this.module.startScan(options.serviceUuid16, options.mode, options.allowDuplicates);
  }

  stopScan(): Promise<void> {
    return this.module.stopScan();
  }

  startAdvertising(options: AdvertiseOptions): Promise<void> {
    return this.module.startAdvertising(
      options.serviceUuid16,
      bytesToBase64(options.payload),
      options.mode,
      options.txPowerLevel ?? 'medium',
    );
  }

  updateAdvertising(options: AdvertiseOptions): Promise<void> {
    return this.module.updateAdvertising(
      options.serviceUuid16,
      bytesToBase64(options.payload),
      options.mode,
      options.txPowerLevel ?? 'medium',
    );
  }

  stopAdvertising(): Promise<void> {
    return this.module.stopAdvertising();
  }

  subscribe(events: Partial<BleTransportEvents>): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  async destroy(): Promise<void> {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    this.listeners.clear();
    await this.module.destroy();
  }
}

/** True when a development build with the native module is present. */
export function isNativeBleAvailable(): boolean {
  return Boolean(NativeModules.EventPulseBle);
}
