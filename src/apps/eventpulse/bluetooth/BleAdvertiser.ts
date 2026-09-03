/**
 * BleAdvertiser — broadcasts our own compact presence frame.
 *
 * Three behaviours worth calling out:
 *
 *  1. **Invisible means silent.** When the user picks Invisible (or leaves the
 *     event) we stop advertising outright. There is no "advertise but ask peers
 *     not to render me" mode — privacy that depends on other people's clients
 *     behaving is not privacy.
 *
 *  2. **Rotation is seamless.** The peer id changes on a schedule. We swap the
 *     payload in place; peers resolve the new id from the directory table they
 *     already hold, so nobody blinks out of existence at the boundary.
 *
 *  3. **Peripheral support is optional.** Several Android chipsets cannot
 *     advertise at all, and iOS restricts it heavily in the background. We
 *     report that as a degraded state ("others can't see you yet") instead of
 *     treating it as a fatal error, and keep scanning.
 */

import type { PresenceStatus } from '../types';
import { EVENTPULSE_SERVICE_UUID_16, encodeAdvertisement } from './BleProtocol';
import type { AdvertisePresence, BleTransport, BleTransportError, ScanMode } from './BleTransport';
import type { Scheduler } from './BleScanner';
import { systemScheduler } from './BleScanner';

export type AdvertiserState =
  | 'idle'
  | 'advertising'
  | 'suppressed_invisible'
  | 'unsupported'
  | 'blocked_adapter'
  | 'error';

export interface AdvertiserStatus {
  state: AdvertiserState;
  currentPeerId: string | null;
  nextRotationAt: number | null;
  lastError?: { code: string; message: string };
}

export interface BleAdvertiserOptions {
  transport: BleTransport;
  scheduler?: Scheduler;
  serviceUuid16?: number;
  /** Supplies the presence frame contents; called again on every rotation. */
  getPresence: () => AdvertisePresence | null;
  /** When the next peer-id rotation is due, in epoch ms. */
  getNextRotationAt: () => number | null;
  onStatus?: (status: AdvertiserStatus) => void;
  mode?: ScanMode;
}

/** A little early so the new id is live before the old one is meant to expire. */
const ROTATION_LEAD_MS = 2_000;
const MIN_ROTATION_CHECK_MS = 5_000;

export class BleAdvertiser {
  private readonly transport: BleTransport;
  private readonly scheduler: Scheduler;
  private readonly serviceUuid16: number;
  private readonly getPresence: () => AdvertisePresence | null;
  private readonly getNextRotationAt: () => number | null;
  private readonly onStatus?: (status: AdvertiserStatus) => void;
  private readonly mode: ScanMode;

  private state: AdvertiserState = 'idle';
  private currentPeerId: string | null = null;
  private rotationHandle: unknown = null;
  private lastError: { code: string; message: string } | undefined;
  private running = false;
  private supportsPeripheral: boolean | null = null;

  constructor(options: BleAdvertiserOptions) {
    this.transport = options.transport;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.serviceUuid16 = options.serviceUuid16 ?? EVENTPULSE_SERVICE_UUID_16;
    this.getPresence = options.getPresence;
    this.getNextRotationAt = options.getNextRotationAt;
    this.onStatus = options.onStatus;
    this.mode = options.mode ?? 'balanced';
  }

  async start(): Promise<AdvertiserStatus> {
    if (this.running) return this.status();
    this.running = true;

    if (this.supportsPeripheral === null) {
      const capabilities = await this.transport.getCapabilities();
      this.supportsPeripheral = capabilities.supportsPeripheral;
    }
    if (!this.supportsPeripheral) {
      this.setState('unsupported');
      return this.status();
    }

    await this.publish();
    this.scheduleRotation();
    return this.status();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearRotationTimer();
    this.currentPeerId = null;
    try {
      await this.transport.stopAdvertising();
    } catch {
      // Already stopped; nothing to surface.
    }
    this.setState('idle');
  }

  /**
   * Re-read presence and push it to the radio. Call after any change that
   * affects the frame: availability, display name, profile version, visibility.
   */
  async refresh(): Promise<void> {
    if (!this.running) return;
    await this.publish();
    this.scheduleRotation();
  }

  private async publish(): Promise<void> {
    const presence = this.getPresence();

    if (!presence) {
      // Invisible, or not currently in an event.
      if (this.currentPeerId !== null || this.state === 'advertising') {
        try {
          await this.transport.stopAdvertising();
        } catch {
          /* ignore */
        }
      }
      this.currentPeerId = null;
      this.setState('suppressed_invisible');
      return;
    }

    let payload: Uint8Array;
    try {
      payload = encodeAdvertisement({
        eventCode: presence.eventCode,
        peerId: presence.peerId,
        avatarId: presence.avatarId,
        displayTag: presence.displayTag,
        profileVersion: presence.profileVersion,
        status: presence.status,
        capabilities: presence.capabilities,
      });
    } catch (error) {
      this.lastError = { code: 'encode_failed', message: (error as Error).message };
      this.setState('error');
      return;
    }

    const options = {
      serviceUuid16: this.serviceUuid16,
      payload,
      mode: this.mode,
      txPowerLevel: 'medium' as const,
    };

    try {
      if (this.state === 'advertising' && this.currentPeerId !== null) {
        await this.transport.updateAdvertising(options);
      } else {
        await this.transport.startAdvertising(options);
      }
      this.currentPeerId = presence.peerId;
      this.lastError = undefined;
      this.setState('advertising');
    } catch (error) {
      const transportError = error as BleTransportError;
      this.lastError = { code: transportError.code ?? 'internal', message: transportError.message };
      if (transportError.code === 'unsupported') this.setState('unsupported');
      else if (transportError.code === 'adapter_off') this.setState('blocked_adapter');
      else this.setState('error');
    }
  }

  private scheduleRotation(): void {
    this.clearRotationTimer();
    const next = this.getNextRotationAt();
    if (next === null) return;

    const delay = Math.max(next - this.scheduler.now() - ROTATION_LEAD_MS, MIN_ROTATION_CHECK_MS);
    this.rotationHandle = this.scheduler.setTimeout(() => {
      void (async () => {
        if (!this.running) return;
        await this.publish();
        this.scheduleRotation();
      })();
    }, delay);
  }

  private clearRotationTimer(): void {
    if (this.rotationHandle !== null) {
      this.scheduler.clearTimeout(this.rotationHandle);
      this.rotationHandle = null;
    }
  }

  private setState(state: AdvertiserState): void {
    this.state = state;
    this.onStatus?.(this.status());
  }

  status(): AdvertiserStatus {
    return {
      state: this.state,
      currentPeerId: this.currentPeerId,
      nextRotationAt: this.getNextRotationAt(),
      lastError: this.lastError,
    };
  }
}

/** Availability maps onto the 2-bit wire status; `invisible` never advertises. */
export function presenceStatusFor(availability: string): PresenceStatus | null {
  switch (availability) {
    case 'available':
      return 'available';
    case 'maybe':
      return 'maybe';
    case 'busy':
      return 'busy';
    default:
      return null;
  }
}
