/**
 * Host advertising.
 *
 * Publishes the treasure-hunt GATT service and broadcasts the lobby code in the
 * advertised local name so a scanning player can show "Hunt #4821" before
 * connecting.
 *
 * Advertising is stopped once the match begins: the lobby is closed, and a
 * silent radio saves power and leaves more airtime for game traffic.
 */
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {BleError, BleErrorCode} from './BleTypes';
import type {PeripheralTransport} from './transport/Transport';

const log = createLogger('BleAdvertiser');

export interface BleAdvertiserEvents {
  advertisingChanged: boolean;
  error: BleError;
}

export class BleAdvertiser {
  readonly events = new Emitter<BleAdvertiserEvents>();

  private currentCode: string | null = null;
  private advertising = false;

  constructor(private readonly transport: PeripheralTransport) {}

  get isAdvertising(): boolean {
    return this.advertising;
  }

  get gameCode(): string | null {
    return this.currentCode;
  }

  async start(gameCode: string): Promise<void> {
    if (this.advertising && this.currentCode === gameCode) {
      return;
    }
    if (this.advertising) {
      await this.stop();
    }

    try {
      await this.transport.startAdvertising(gameCode);
      this.currentCode = gameCode;
      this.advertising = true;
      this.events.emit('advertisingChanged', true);
      log.info(`advertising lobby ${gameCode}`);
    } catch (err) {
      const error =
        err instanceof BleError
          ? err
          : new BleError('advertising failed', BleErrorCode.AdvertiseFailed, err);
      this.events.emit('error', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.advertising) {
      return;
    }
    await this.transport.stopAdvertising();
    this.advertising = false;
    this.currentCode = null;
    this.events.emit('advertisingChanged', false);
    log.info('advertising stopped');
  }

  /** Ask the native layer directly, in case the OS stopped us behind our back. */
  async verify(): Promise<boolean> {
    const actual = await this.transport.isAdvertising();
    if (actual !== this.advertising) {
      log.warn(`advertising state drifted (thought ${this.advertising}, actually ${actual})`);
      this.advertising = actual;
      this.events.emit('advertisingChanged', actual);
    }
    return actual;
  }

  dispose(): void {
    void this.stop();
    this.events.removeAllListeners();
  }
}
