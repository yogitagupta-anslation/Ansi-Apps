/**
 * Automatic reconnection with exponential backoff.
 *
 * When a player drops mid-hunt the game must not end. The host holds the slot
 * (score, inventory, position) for TIMING.reconnectGraceMs while this class
 * keeps retrying the link. On success the player re-announces itself with the
 * same playerId and the host rebinds it to the new peerId.
 *
 * Backoff matters: retrying a BLE connect in a tight loop makes Android's
 * stack progressively slower and can wedge the adapter until a toggle.
 */
import {CONNECTION} from '../config/bleConfig';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {BleAdapterState, type BlePeer} from './BleTypes';
import type {ConnectionManager} from './ConnectionManager';
import type {CentralTransport} from './transport/Transport';

const log = createLogger('ReconnectionManager');

export interface ReconnectionManagerEvents {
  attemptStarted: {attempt: number; delayMs: number};
  reconnected: BlePeer;
  /** Stopped trying -- either the attempt cap or an explicit cancel. */
  gaveUp: {attempts: number; reason: string};
}

export class ReconnectionManager {
  readonly events = new Emitter<ReconnectionManagerEvents>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private active = false;
  private cancelled = false;

  constructor(
    private readonly transport: CentralTransport,
    private readonly connection: ConnectionManager,
  ) {}

  get isReconnecting(): boolean {
    return this.active;
  }

  get attemptCount(): number {
    return this.attempts;
  }

  /** Begin retrying the last connected device. Safe to call repeatedly. */
  start(deviceId: string): void {
    if (this.active) {
      return;
    }
    this.active = true;
    this.cancelled = false;
    this.attempts = 0;
    this.connection.markReconnecting();
    log.info(`reconnect loop started for ${deviceId}`);
    this.scheduleNext(deviceId);
  }

  private scheduleNext(deviceId: string): void {
    if (this.cancelled) {
      return;
    }

    const maxAttempts = CONNECTION.reconnectMaxAttempts;
    if (maxAttempts > 0 && this.attempts >= maxAttempts) {
      this.finish(`exhausted ${this.attempts} attempts`);
      return;
    }

    const delayMs = Math.min(
      CONNECTION.reconnectBaseDelayMs *
        Math.pow(CONNECTION.reconnectBackoffFactor, this.attempts),
      CONNECTION.reconnectMaxDelayMs,
    );

    this.attempts++;
    this.events.emit('attemptStarted', {attempt: this.attempts, delayMs});

    this.timer = setTimeout(() => {
      void this.tryConnect(deviceId);
    }, delayMs);
  }

  private async tryConnect(deviceId: string): Promise<void> {
    if (this.cancelled) {
      return;
    }

    // No point burning attempts while the radio is off; wait for it instead.
    const state = await this.transport.getAdapterState();
    if (state !== BleAdapterState.PoweredOn) {
      log.debug(`adapter is ${state}; deferring reconnect`);
      this.scheduleNext(deviceId);
      return;
    }

    try {
      const peer = await this.connection.connect(deviceId);
      log.info(`reconnected after ${this.attempts} attempt(s)`);
      this.active = false;
      this.attempts = 0;
      this.events.emit('reconnected', peer);
    } catch (err) {
      log.debug(`reconnect attempt ${this.attempts} failed`, err);
      this.scheduleNext(deviceId);
    }
  }

  cancel(reason = 'cancelled'): void {
    if (!this.active) {
      return;
    }
    this.cancelled = true;
    this.finish(reason);
  }

  private finish(reason: string): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const attempts = this.attempts;
    this.active = false;
    this.attempts = 0;
    log.info(`reconnect loop ended: ${reason}`);
    this.events.emit('gaveUp', {attempts, reason});
  }

  dispose(): void {
    this.cancelled = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.active = false;
    this.events.removeAllListeners();
  }
}
