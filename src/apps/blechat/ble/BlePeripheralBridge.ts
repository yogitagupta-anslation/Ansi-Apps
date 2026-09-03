import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
} from '../config/constants';

const TAG = 'Peripheral';

export interface PeripheralCapabilities {
  hasBluetooth: boolean;
  bluetoothEnabled: boolean;
  supportsMultipleAdvertisement: boolean;
  hasAdvertiser: boolean;
  isAdvertising: boolean;
  sdkInt: number;
  missingPermissions: string[];
}

interface NativeBlePeripheral {
  getCapabilities(): Promise<PeripheralCapabilities>;
  start(
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
    peerIdPrefix: string,
    displayName: string,
    /** 24-bit catalogue bitmask, so scanners see interests before connecting. */
    interestMask: number,
  ): Promise<{advertising: boolean}>;
  stop(): Promise<boolean>;
  send(centralId: string, base64Data: string): Promise<boolean>;
}

type PeripheralEvents = {
  state: {advertising: boolean; error?: string};
  centralConnected: {centralId: string};
  centralDisconnected: {centralId: string; status?: number};
  data: {centralId: string; data: string};
  subscription: {centralId: string; enabled: boolean};
  mtu: {centralId: string; mtu: number};
  error: {message: string};
};

/**
 * Thin, typed wrapper over the native peripheral module (Kotlin on Android,
 * Swift on iOS). No protocol logic lives here — it moves base64 frames and events.
 */
class BlePeripheralBridge {
  readonly bus = new EventBus<PeripheralEvents>();

  private native: NativeBlePeripheral | null =
    (NativeModules.BlePeripheral as NativeBlePeripheral | undefined) ?? null;
  private emitter: NativeEventEmitter | null = null;
  private subscriptions: Array<{remove: () => void}> = [];
  private started = false;

  /** MTU per connected central, as reported by the platform. */
  private mtuByCentral = new Map<string, number>();
  private subscribedCentrals = new Set<string>();

  get isAvailable(): boolean {
    return this.native !== null;
  }

  get isAdvertising(): boolean {
    return this.started;
  }

  private ensureEmitter(): NativeEventEmitter {
    if (!this.emitter) {
      this.emitter = new NativeEventEmitter(
        NativeModules.BlePeripheral as never,
      );
    }
    return this.emitter;
  }

  private attach(): void {
    if (this.subscriptions.length > 0) {
      return;
    }
    const e = this.ensureEmitter();

    this.subscriptions.push(
      e.addListener('BlePeripheral:state', (p: PeripheralEvents['state']) => {
        this.started = p.advertising;
        if (p.error) {
          logger.error(TAG, `advertising error: ${p.error}`);
        } else {
          logger.info(TAG, p.advertising ? 'advertising' : 'not advertising');
        }
        this.bus.emit('state', p);
      }),
      e.addListener(
        'BlePeripheral:centralConnected',
        (p: PeripheralEvents['centralConnected']) => {
          logger.info(TAG, `central connected ${p.centralId}`);
          this.bus.emit('centralConnected', p);
        },
      ),
      e.addListener(
        'BlePeripheral:centralDisconnected',
        (p: PeripheralEvents['centralDisconnected']) => {
          logger.info(TAG, `central disconnected ${p.centralId}`);
          this.mtuByCentral.delete(p.centralId);
          this.subscribedCentrals.delete(p.centralId);
          this.bus.emit('centralDisconnected', p);
        },
      ),
      e.addListener('BlePeripheral:data', (p: PeripheralEvents['data']) => {
        this.bus.emit('data', p);
      }),
      e.addListener(
        'BlePeripheral:subscription',
        (p: PeripheralEvents['subscription']) => {
          if (p.enabled) {
            this.subscribedCentrals.add(p.centralId);
          } else {
            this.subscribedCentrals.delete(p.centralId);
          }
          logger.info(
            TAG,
            `${p.centralId} notifications ${p.enabled ? 'ON' : 'OFF'}`,
          );
          this.bus.emit('subscription', p);
        },
      ),
      e.addListener('BlePeripheral:mtu', (p: PeripheralEvents['mtu']) => {
        this.mtuByCentral.set(p.centralId, p.mtu);
        logger.info(TAG, `MTU ${p.centralId} = ${p.mtu}`);
        this.bus.emit('mtu', p);
      }),
      e.addListener('BlePeripheral:error', (p: PeripheralEvents['error']) => {
        logger.error(TAG, p.message);
        this.bus.emit('error', p);
      }),
    );
  }

  async getCapabilities(): Promise<PeripheralCapabilities | null> {
    if (!this.native) {
      return null;
    }
    try {
      return await this.native.getCapabilities();
    } catch (err) {
      logger.error(TAG, 'getCapabilities failed', err);
      return null;
    }
  }

  /**
   * Begin advertising and hosting the GATT server.
   * Rejects with a real reason (no advertiser hardware, Bluetooth off, permission
   * missing) rather than silently pretending to have started.
   */
  async start(
    peerIdPrefix: string,
    displayName: string,
    interestMask = 0,
  ): Promise<void> {
    if (!this.native) {
      throw new Error(
        `Native BlePeripheral module is not linked on ${Platform.OS}. ` +
          'Rebuild the app after a clean install — a JS-only reload cannot add it.',
      );
    }
    this.attach();
    await this.native.start(
      BLE_SERVICE_UUID,
      BLE_RX_CHAR_UUID,
      BLE_TX_CHAR_UUID,
      peerIdPrefix,
      displayName,
      interestMask,
    );
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.native) {
      return;
    }
    try {
      await this.native.stop();
    } catch (err) {
      logger.warn(TAG, 'stop failed', err);
    }
    this.started = false;
    this.mtuByCentral.clear();
    this.subscribedCentrals.clear();
    for (const s of this.subscriptions) {
      s.remove();
    }
    this.subscriptions = [];
  }

  /** Send one MTU-sized frame. Fragmentation happens above this call. */
  async sendFrame(centralId: string, base64Data: string): Promise<void> {
    if (!this.native) {
      throw new Error('Native BlePeripheral module unavailable');
    }
    await this.native.send(centralId, base64Data);
  }

  getMtu(centralId: string): number | undefined {
    return this.mtuByCentral.get(centralId);
  }

  isSubscribed(centralId: string): boolean {
    return this.subscribedCentrals.has(centralId);
  }
}

export const blePeripheral = new BlePeripheralBridge();
