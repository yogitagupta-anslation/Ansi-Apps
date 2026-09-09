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

interface NativeBleModule {
  getCapabilities(): Promise<BleCapabilityReport>;
  getAdapterState(): Promise<BleAdapterState>;
  requestPermissions(): Promise<BlePermissionState>;
  getPermissionState(): Promise<BlePermissionState>;
  requestEnable(): Promise<boolean>;
  startScan(serviceUuid16: number, mode: string, allowDuplicates: boolean): Promise<void>;
  stopScan(): Promise<void>;
  startAdvertising(serviceUuid16: number, payloadBase64: string, mode: string, txPower: string): Promise<void>;
  updateAdvertising(serviceUuid16: number, payloadBase64: string, mode: string, txPower: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  destroy(): Promise<void>;
}

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

  requestPermissions(): Promise<BlePermissionState> {
    return this.module.requestPermissions();
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
