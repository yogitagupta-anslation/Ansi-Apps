import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

/**
 * Typed wrapper over the shared native peripheral module.
 *
 * react-native-ble-plx implements the central role only -- its own README says
 * it does not support talking between phones -- so the half of the link that
 * advertises and answers is native: Kotlin on Android, Swift on iOS. The module
 * is generic: it takes the service and characteristic UUIDs as arguments, which
 * is why this game can host on its own UUIDs without touching it.
 *
 * No game logic lives here. It moves base64 frames and events, nothing else.
 */

interface NativeBlePeripheral {
  getCapabilities(): Promise<PeripheralCapabilities>;
  start(
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
    peerIdPrefix: string,
    displayName: string,
    interestMask: number,
  ): Promise<{ advertising: boolean }>;
  /**
   * Rebuilds the advertised payload without disturbing the GATT server, so a
   * seat filling up does not drop the phones already in the room. Added after
   * the module shipped: absent on an older build, which is why every call site
   * treats it as optional.
   */
  updateAdvertisement?(
    peerIdPrefix: string,
    displayName: string,
    interestMask: number,
  ): Promise<{ advertising: boolean }>;
  stop(): Promise<boolean>;
  send(centralId: string, base64Data: string): Promise<boolean>;
}

export interface PeripheralCapabilities {
  hasBluetooth: boolean;
  bluetoothEnabled: boolean;
  supportsMultipleAdvertisement: boolean;
  hasAdvertiser: boolean;
  isAdvertising: boolean;
  sdkInt: number;
  missingPermissions: string[];
}

export interface PeripheralHandlers {
  onCentralConnected(centralId: string): void;
  onCentralDisconnected(centralId: string): void;
  onData(centralId: string, base64: string): void;
  onSubscription(centralId: string, enabled: boolean): void;
  onMtu(centralId: string, mtu: number): void;
  onError(message: string): void;
}

function nativeModule(): NativeBlePeripheral | null {
  return (NativeModules.BlePeripheral as NativeBlePeripheral | undefined) ?? null;
}

export function peripheralAvailable(): boolean {
  return nativeModule() !== null;
}

export class Peripheral {
  private native = nativeModule();
  private subscriptions: Array<{ remove: () => void }> = [];
  private mtuByCentral = new Map<string, number>();
  private subscribed = new Set<string>();
  private advertising = false;

  constructor(private readonly handlers: PeripheralHandlers) {}

  get isAdvertising(): boolean {
    return this.advertising;
  }

  async getCapabilities(): Promise<PeripheralCapabilities | null> {
    if (!this.native) return null;
    try {
      return await this.native.getCapabilities();
    } catch {
      return null;
    }
  }

  private attach(): void {
    if (this.subscriptions.length > 0 || !this.native) return;
    const emitter = new NativeEventEmitter(NativeModules.BlePeripheral as never);
    const h = this.handlers;

    this.subscriptions.push(
      emitter.addListener('BlePeripheral:state', (p: { advertising: boolean; error?: string }) => {
        this.advertising = p.advertising;
        if (p.error) h.onError(p.error);
      }),
      emitter.addListener('BlePeripheral:centralConnected', (p: { centralId: string }) =>
        h.onCentralConnected(p.centralId),
      ),
      emitter.addListener('BlePeripheral:centralDisconnected', (p: { centralId: string }) => {
        this.mtuByCentral.delete(p.centralId);
        this.subscribed.delete(p.centralId);
        h.onCentralDisconnected(p.centralId);
      }),
      emitter.addListener('BlePeripheral:data', (p: { centralId: string; data: string }) =>
        h.onData(p.centralId, p.data),
      ),
      emitter.addListener(
        'BlePeripheral:subscription',
        (p: { centralId: string; enabled: boolean }) => {
          if (p.enabled) this.subscribed.add(p.centralId);
          else this.subscribed.delete(p.centralId);
          h.onSubscription(p.centralId, p.enabled);
        },
      ),
      emitter.addListener('BlePeripheral:mtu', (p: { centralId: string; mtu: number }) => {
        this.mtuByCentral.set(p.centralId, p.mtu);
        h.onMtu(p.centralId, p.mtu);
      }),
      emitter.addListener('BlePeripheral:error', (p: { message: string }) => h.onError(p.message)),
    );
  }

  async start(
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
    prefixHex: string,
    displayName: string,
    mask: number,
  ): Promise<void> {
    if (!this.native) {
      throw new Error(
        `Hosting needs the Bluetooth peripheral module, which is not linked on ${Platform.OS}. ` +
          'Rebuild the app — a JS reload cannot add native code.',
      );
    }
    this.attach();
    await this.native.start(serviceUuid, rxUuid, txUuid, prefixHex, displayName, mask);
    this.advertising = true;
  }

  /** Best effort: an older build has no such method, and a stale advert is survivable. */
  async updateAdvertisement(prefixHex: string, displayName: string, mask: number): Promise<void> {
    if (!this.native?.updateAdvertisement || !this.advertising) return;
    try {
      await this.native.updateAdvertisement(prefixHex, displayName, mask);
    } catch {
      // The room still works; the scan list is simply a beat behind.
    }
  }

  async send(centralId: string, base64: string): Promise<void> {
    if (!this.native) throw new Error('Bluetooth peripheral module unavailable');
    await this.native.send(centralId, base64);
  }

  isSubscribed(centralId: string): boolean {
    return this.subscribed.has(centralId);
  }

  mtu(centralId: string): number | undefined {
    return this.mtuByCentral.get(centralId);
  }

  async stop(): Promise<void> {
    if (this.native) {
      try {
        await this.native.stop();
      } catch {
        // Already down, or the adapter went away underneath us.
      }
    }
    this.advertising = false;
    this.mtuByCentral.clear();
    this.subscribed.clear();
    this.subscriptions.forEach((s) => s.remove());
    this.subscriptions = [];
  }
}
