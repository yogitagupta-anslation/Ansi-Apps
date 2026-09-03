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

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let outIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_ALPHABET.indexOf(clean[i]);
    const c1 = B64_ALPHABET.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? B64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? B64_ALPHABET.indexOf(clean[i + 3]) : -1;

    out[outIndex++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) out[outIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 >= 0) out[outIndex++] = ((c2 & 0x03) << 6) | c3;
  }
  return out.subarray(0, outIndex);
}

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
