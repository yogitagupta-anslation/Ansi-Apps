/**
 * The single seam between EventPulse and the radio.
 *
 * Everything above this interface is pure TypeScript and runs identically in
 * Node, in Jest and on device. Below it sit three implementations:
 *
 *  - `NativeBleTransport`     — the Kotlin / CoreBluetooth bridge (real hardware)
 *  - `SimulatedBleTransport`  — a crowd simulator for the dev build and demos
 *  - hand-rolled fakes        — inside unit tests
 *
 * Keeping the seam this thin is what makes the BLE stack testable at all: a
 * simulator or emulator cannot exercise real advertising, so the logic that
 * matters must not live in native code.
 */

import type { BleScanResult, PresenceStatus } from '../types';
import type { PeerCapabilities } from '../types';

export type BleAdapterState =
  | 'unknown'
  | 'unsupported'
  | 'unauthorized'
  | 'powered_off'
  | 'powered_on'
  | 'resetting';

export type BlePermissionState = 'granted' | 'denied' | 'blocked' | 'unavailable' | 'undetermined';

export interface BleCapabilityReport {
  supportsCentral: boolean;
  /**
   * Peripheral (advertising) support. Notably absent on some older Android
   * chipsets, and constrained on iOS in the background — the UI degrades to
   * scan-only rather than failing.
   */
  supportsPeripheral: boolean;
  supportsExtendedAdvertising: boolean;
  maxAdvertisementBytes: number;
}

export type ScanMode = 'low_power' | 'balanced' | 'low_latency';

export interface ScanOptions {
  /** 16-bit service-data UUID to filter on, applied in the radio where possible. */
  serviceUuid16: number;
  mode: ScanMode;
  /**
   * Ask the platform to report duplicate packets. We *want* them (RSSI is only
   * useful as a stream) but they must be cheap to reject — see `PeerRegistry`.
   */
  allowDuplicates: boolean;
}

export interface AdvertiseOptions {
  serviceUuid16: number;
  payload: Uint8Array;
  mode: ScanMode;
  /** Advertised TX power level hint; affects the distance model calibration. */
  txPowerLevel?: 'ultra_low' | 'low' | 'medium' | 'high';
}

export interface BleTransportEvents {
  onScanResult(result: BleScanResult): void;
  onAdapterStateChange(state: BleAdapterState): void;
  onError(error: BleTransportError): void;
}

export type BleTransportErrorCode =
  | 'permission_denied'
  | 'adapter_off'
  | 'unsupported'
  | 'advertise_failed'
  | 'scan_failed'
  | 'internal';

export class BleTransportError extends Error {
  readonly code: BleTransportErrorCode;
  readonly recoverable: boolean;

  constructor(code: BleTransportErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = 'BleTransportError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface BleTransport {
  readonly name: string;

  getCapabilities(): Promise<BleCapabilityReport>;
  getAdapterState(): Promise<BleAdapterState>;
  requestPermissions(): Promise<BlePermissionState>;
  getPermissionState(): Promise<BlePermissionState>;

  /** Ask the OS to enable Bluetooth. Resolves false where the platform forbids it (iOS). */
  requestEnable(): Promise<boolean>;

  startScan(options: ScanOptions): Promise<void>;
  stopScan(): Promise<void>;

  startAdvertising(options: AdvertiseOptions): Promise<void>;
  updateAdvertising(options: AdvertiseOptions): Promise<void>;
  stopAdvertising(): Promise<void>;

  subscribe(events: Partial<BleTransportEvents>): () => void;

  destroy(): Promise<void>;
}

/** What the advertiser needs to build a frame. Assembled by `PresenceController`. */
export interface AdvertisePresence {
  eventCode: number;
  peerId: string;
  avatarId: string;
  displayTag: string;
  profileVersion: number;
  status: PresenceStatus;
  capabilities: PeerCapabilities;
}
