/**
 * BleScanner — owns the radio lifecycle and the only timers in the BLE stack.
 *
 * It glues four pieces together:
 *   transport (packets)  ->  PeerRegistry (state)  ->  throttled snapshot  ->  UI
 *                        ^
 *                        |
 *                   ScanPolicy (how hard to scan)
 *
 * Critically, it *never* pushes a UI update per packet. Packets fold into the
 * registry synchronously; the UI is handed an aggregated snapshot on a fixed
 * cadence chosen by the scan policy (120 ms while navigating, 5 s in the
 * background). This is what keeps the map at 60 fps in a room of 500 people.
 */

import type { BleScanResult, PeerRecord } from '../types';
import { EVENTPULSE_SERVICE_UUID_16 } from './BleProtocol';
import type {
  BleAdapterState,
  BlePermissionState,
  BleTransport,
  BleTransportError,
} from './BleTransport';
import type { PeerChange, PeerRegistry } from './PeerRegistry';
import { AppPhase, ScanPlan, ScanPolicyInput, computeScanPlan, scanPlansEqual } from './ScanPolicy';

export interface Scheduler {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

export const systemScheduler: Scheduler = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

export interface ScannerSnapshot {
  peers: PeerRecord[];
  changes: PeerChange[];
  at: number;
}

export type ScannerRuntimeState =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'duty_paused'
  | 'blocked_permission'
  | 'blocked_adapter'
  | 'unsupported'
  | 'error';

export interface ScannerStatus {
  state: ScannerRuntimeState;
  adapterState: BleAdapterState;
  permission: BlePermissionState;
  plan: ScanPlan;
  peerCount: number;
  lastError?: { code: string; message: string };
  /** Timestamp of the last accepted packet; drives the "no signal" hint. */
  lastPacketAt: number | null;
}

export interface BleScannerOptions {
  transport: BleTransport;
  registry: PeerRegistry;
  scheduler?: Scheduler;
  serviceUuid16?: number;
  onSnapshot?: (snapshot: ScannerSnapshot) => void;
  onStatus?: (status: ScannerStatus) => void;
}

const INITIAL_POLICY: ScanPolicyInput = {
  phase: 'app_foreground',
  peerCount: 0,
  batteryLevel: null,
  batteryCharging: false,
  navigating: false,
  seekingFirstPeer: true,
};

const TTL_TICK_MS = 1_000;

export class BleScanner {
  private readonly transport: BleTransport;
  private readonly registry: PeerRegistry;
  private readonly scheduler: Scheduler;
  private readonly serviceUuid16: number;
  private readonly onSnapshot?: (snapshot: ScannerSnapshot) => void;
  private readonly onStatus?: (status: ScannerStatus) => void;

  private policyInput: ScanPolicyInput = { ...INITIAL_POLICY };
  private plan: ScanPlan = computeScanPlan(INITIAL_POLICY);

  private runtimeState: ScannerRuntimeState = 'idle';
  private adapterState: BleAdapterState = 'unknown';
  private permission: BlePermissionState = 'undetermined';
  private lastError: { code: string; message: string } | undefined;
  private lastPacketAt: number | null = null;

  private unsubscribe: (() => void) | null = null;
  private flushHandle: unknown = null;
  private ttlHandle: unknown = null;
  private dutyHandle: unknown = null;
  private radioOn = false;
  private started = false;
  private lastFlushedRevision = -1;

  constructor(options: BleScannerOptions) {
    this.transport = options.transport;
    this.registry = options.registry;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.serviceUuid16 = options.serviceUuid16 ?? EVENTPULSE_SERVICE_UUID_16;
    this.onSnapshot = options.onSnapshot;
    this.onStatus = options.onStatus;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async start(): Promise<ScannerStatus> {
    if (this.started) return this.status();
    this.started = true;
    this.setRuntimeState('starting');

    this.unsubscribe = this.transport.subscribe({
      onScanResult: (result) => this.handleScanResult(result),
      onAdapterStateChange: (state) => this.handleAdapterState(state),
      onError: (error) => this.handleError(error),
    });

    const capabilities = await this.transport.getCapabilities();
    if (!capabilities.supportsCentral) {
      this.setRuntimeState('unsupported');
      return this.status();
    }

    this.permission = await this.transport.getPermissionState();
    if (this.permission === 'undetermined') {
      this.permission = await this.transport.requestPermissions();
    }
    if (this.permission !== 'granted') {
      this.setRuntimeState('blocked_permission');
      return this.status();
    }

    this.adapterState = await this.transport.getAdapterState();
    if (this.adapterState !== 'powered_on') {
      this.setRuntimeState('blocked_adapter');
      return this.status();
    }

    this.startTimers();
    await this.applyPlan(true);
    return this.status();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopTimers();
    if (this.radioOn) {
      this.radioOn = false;
      await safe(() => this.transport.stopScan());
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setRuntimeState('idle');
  }

  /** Called when the user leaves the event, or blocks someone mid-session. */
  reset(): void {
    this.registry.clear();
    this.lastFlushedRevision = -1;
    this.flush(true);
  }

  /* ---------------------------------------------------------------- *
   * Policy
   * ---------------------------------------------------------------- */

  setPhase(phase: AppPhase): void {
    this.updatePolicy({ phase });
  }

  setNavigating(navigating: boolean): void {
    this.updatePolicy({ navigating });
  }

  setBattery(level: number | null, charging: boolean): void {
    this.updatePolicy({ batteryLevel: level, batteryCharging: charging });
  }

  private updatePolicy(patch: Partial<ScanPolicyInput>): void {
    this.policyInput = {
      ...this.policyInput,
      ...patch,
      peerCount: this.registry.size,
      seekingFirstPeer: this.registry.size === 0,
    };
    const next = computeScanPlan(this.policyInput);
    if (scanPlansEqual(next, this.plan)) return;
    this.plan = next;
    if (this.started) void this.applyPlan(false);
    this.emitStatus();
  }

  private async applyPlan(initial: boolean): Promise<void> {
    this.restartFlushTimer();
    this.clearDutyTimer();

    if (this.plan.onMs === 0 && this.plan.offMs === 0 && this.plan.mode === 'low_power' && !initial) {
      // Policy asked for a fully idle radio (app inactive).
      if (this.radioOn) {
        this.radioOn = false;
        await safe(() => this.transport.stopScan());
      }
      this.setRuntimeState('duty_paused');
      return;
    }

    await this.startRadio();
    if (this.plan.offMs > 0) this.scheduleDutyCycle();
  }

  private scheduleDutyCycle(): void {
    this.clearDutyTimer();
    this.dutyHandle = this.scheduler.setTimeout(() => {
      void (async () => {
        if (!this.started) return;
        if (this.radioOn) {
          this.radioOn = false;
          await safe(() => this.transport.stopScan());
          this.setRuntimeState('duty_paused');
          this.dutyHandle = this.scheduler.setTimeout(() => this.scheduleDutyResume(), this.plan.offMs);
        } else {
          this.scheduleDutyResume();
        }
      })();
    }, this.plan.onMs);
  }

  private scheduleDutyResume(): void {
    void (async () => {
      if (!this.started) return;
      await this.startRadio();
      if (this.plan.offMs > 0) this.scheduleDutyCycle();
    })();
  }

  private async startRadio(): Promise<void> {
    if (this.radioOn) {
      // Mode may have changed; restart so the new scan mode takes effect.
      await safe(() => this.transport.stopScan());
      this.radioOn = false;
    }
    try {
      await this.transport.startScan({
        serviceUuid16: this.serviceUuid16,
        mode: this.plan.mode,
        allowDuplicates: true,
      });
      this.radioOn = true;
      this.lastError = undefined;
      this.setRuntimeState('scanning');
    } catch (error) {
      this.handleError(error as BleTransportError);
    }
  }

  /* ---------------------------------------------------------------- *
   * Timers
   * ---------------------------------------------------------------- */

  private startTimers(): void {
    this.restartFlushTimer();
    this.ttlHandle = this.scheduler.setInterval(() => {
      const changes = this.registry.tick(this.scheduler.now());
      if (changes.length) this.flush(false);
      // Density may have shifted enough to change the plan.
      if (this.policyInput.peerCount !== this.registry.size) this.updatePolicy({});
    }, TTL_TICK_MS);
  }

  private restartFlushTimer(): void {
    if (this.flushHandle !== null) this.scheduler.clearInterval(this.flushHandle);
    this.flushHandle = this.scheduler.setInterval(() => this.flush(false), this.plan.flushIntervalMs);
  }

  private clearDutyTimer(): void {
    if (this.dutyHandle !== null) {
      this.scheduler.clearTimeout(this.dutyHandle);
      this.dutyHandle = null;
    }
  }

  private stopTimers(): void {
    if (this.flushHandle !== null) this.scheduler.clearInterval(this.flushHandle);
    if (this.ttlHandle !== null) this.scheduler.clearInterval(this.ttlHandle);
    this.flushHandle = null;
    this.ttlHandle = null;
    this.clearDutyTimer();
  }

  /* ---------------------------------------------------------------- *
   * Packet path — must stay allocation-light
   * ---------------------------------------------------------------- */

  private handleScanResult(result: BleScanResult): void {
    const outcome = this.registry.ingest(result);
    if (outcome.accepted) this.lastPacketAt = result.timestamp;
  }

  /** Push an aggregated snapshot if anything actually changed. */
  flush(force: boolean): void {
    if (!force && this.registry.version === this.lastFlushedRevision) return;
    this.lastFlushedRevision = this.registry.version;
    const changes = this.registry.drainChanges();
    this.onSnapshot?.({
      peers: this.registry.getVisible(),
      changes,
      at: this.scheduler.now(),
    });
    this.emitStatus();
  }

  /* ---------------------------------------------------------------- *
   * Adapter + errors
   * ---------------------------------------------------------------- */

  private handleAdapterState(state: BleAdapterState): void {
    const previous = this.adapterState;
    this.adapterState = state;

    if (state === 'powered_on' && previous !== 'powered_on' && this.started) {
      void this.applyPlan(false);
      return;
    }

    if (state !== 'powered_on') {
      this.radioOn = false;
      // Everyone we were tracking is unverifiable now; clearing is honest.
      this.registry.clear();
      this.flush(true);
      this.setRuntimeState(state === 'unsupported' ? 'unsupported' : 'blocked_adapter');
      return;
    }
    this.emitStatus();
  }

  private handleError(error: BleTransportError): void {
    this.lastError = { code: error.code ?? 'internal', message: error.message };
    if (error.code === 'permission_denied') this.setRuntimeState('blocked_permission');
    else if (error.code === 'adapter_off') this.setRuntimeState('blocked_adapter');
    else if (error.code === 'unsupported') this.setRuntimeState('unsupported');
    else this.setRuntimeState('error');
  }

  private setRuntimeState(state: ScannerRuntimeState): void {
    if (this.runtimeState === state) {
      this.emitStatus();
      return;
    }
    this.runtimeState = state;
    this.emitStatus();
  }

  status(): ScannerStatus {
    return {
      state: this.runtimeState,
      adapterState: this.adapterState,
      permission: this.permission,
      plan: this.plan,
      peerCount: this.registry.size,
      lastError: this.lastError,
      lastPacketAt: this.lastPacketAt,
    };
  }

  private emitStatus(): void {
    this.onStatus?.(this.status());
  }
}

async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Stopping a radio that is already stopped is not an error worth surfacing.
  }
}
