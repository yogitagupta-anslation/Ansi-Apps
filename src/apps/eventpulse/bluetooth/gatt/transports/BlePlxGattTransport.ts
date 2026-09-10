/**
 * The real GATT transport.
 *
 * Two libraries, because no single one does both halves:
 *
 *   client half (central)     react-native-ble-plx              — scan, connect, write, subscribe
 *   server half (peripheral)  react-native-ble-peripheral-manager — host the service, notify
 *
 * Both are already compiled into this APK and autolinked. Neither is new. The
 * same pairing is proven in this repo by `src/apps/treasure-hunt/ble/transport/`,
 * and the awkward parts below — MTU, backpressure, the notify queue — are the
 * lessons that implementation already paid for.
 *
 * WHAT THIS FILE IS NOT. It is not testable off-device, and no test imports it.
 * Everything with a decision in it — framing, envelopes, the link state machine,
 * the session layer — lives above the seam in plain TypeScript precisely so
 * that this file can stay thin enough to review by eye.
 *
 * THE iOS RULE. `EventPulseBle.swift:180` built a `CBUUID` from a 13-21 byte
 * advertisement payload; `CBUUID(data:)` takes 2, 4 or 16 bytes and raises an
 * uncatchable Objective-C exception otherwise. Nothing here derives a UUID from
 * data. Every UUID is a fixed constant from `GattProfile`, validated on the way
 * in, and every payload travels in a characteristic VALUE as base64.
 *
 * PLATFORM DIFFERENCES, all handled below:
 *
 *   MTU          Android must ask (`requestMTU`) and starts at 23 until it
 *                succeeds. iOS negotiates on its own and exposes the result as
 *                `device.mtu`; there is no request API.
 *   Peripheral   Some Android chipsets expose no advertiser at all. iOS can
 *                advertise on any BLE device, but only one service set at a
 *                time and only while the app is foregrounded.
 *   Backpressure `updateValue` returning false means NOTHING was transmitted.
 *                The frame has to be re-sent after the stack drains, or it is
 *                silently lost.
 *   Identity     A `deviceId` is a MAC address on Android and an opaque
 *                CoreBluetooth UUID on iOS. It is never an identity, and it is
 *                not stable across reinstalls on iOS.
 */

import { Platform } from 'react-native';

import { base64ToBytes, bytesToBase64 } from '../../../utils/base64';
import {
  ANDROID_REQUESTED_MTU,
  ATT_DEFAULT_MTU,
  CONNECT_TIMEOUT_MS,
  GATT_CHAR_RX_UUID,
  GATT_CHAR_TX_UUID,
  GATT_SERVICE_UUID,
  IOS_ASSUMED_MTU,
  isValidUuid128,
  payloadBytesForMtu,
} from '../GattProfile';
import { GattReassembler, GroupIdSource, fragmentMessage } from '../GattFraming';
import { GattLink, type GattLinkState } from '../GattLink';
import {
  GattTransportError,
  type GattCapabilities,
  type GattDisconnectReason,
  type GattPeer,
  type GattTransport,
  type GattTransportEvents,
} from '../GattTransport';

/* ------------------------------------------------------------------ *
 * Minimal structural types for the two libraries.
 *
 * Typed here rather than imported so this module still compiles when the
 * packages are absent from a given build, and so the exact surface we depend on
 * is visible in one place.
 * ------------------------------------------------------------------ */

interface PlxCharacteristic {
  value: string | null;
}

interface PlxSubscription {
  remove(): void;
}

interface PlxDevice {
  id: string;
  name: string | null;
  mtu?: number;
  discoverAllServicesAndCharacteristics(): Promise<PlxDevice>;
  requestMTU(mtu: number): Promise<PlxDevice>;
  onDisconnected(listener: (error: unknown, device: PlxDevice | null) => void): PlxSubscription;
  monitorCharacteristicForService(
    serviceUuid: string,
    characteristicUuid: string,
    listener: (error: unknown, characteristic: PlxCharacteristic | null) => void,
  ): PlxSubscription;
  writeCharacteristicWithResponseForService(
    serviceUuid: string,
    characteristicUuid: string,
    valueBase64: string,
  ): Promise<PlxCharacteristic>;
}

interface PlxScannedDevice {
  id: string;
  name: string | null;
  localName?: string | null;
  rssi: number | null;
}

interface PlxManager {
  startDeviceScan(
    serviceUuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (error: unknown, device: PlxScannedDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
  connectToDevice(deviceId: string, options?: { timeout?: number }): Promise<PlxDevice>;
  cancelDeviceConnection(deviceId: string): Promise<PlxDevice>;
}

interface PeripheralManagerModule {
  /**
   * Must be called once before anything else, and it can leave its promise
   * pending for ever on some devices — hence the race in `startPeripheral`.
   */
  start(): Promise<void>;
  addService(uuid: string, primary: boolean): void;
  removeService(uuid: string): void;
  /**
   * NOTE THE ARGUMENT ORDER: properties comes BEFORE permissions.
   * `node_modules/react-native-ble-peripheral-manager/src/index.tsx:216-228`.
   * Getting it the wrong way round produces a characteristic that is neither
   * notifiable nor writable, and nothing reports an error — the link simply
   * never carries anything.
   */
  addCharacteristicToServiceBase64(
    serviceUuid: string,
    characteristicUuid: string,
    properties: number,
    permissions: number,
    valueBase64: string,
  ): void;
  startAdvertising(options: { name?: string; serviceUuids?: string[] }): Promise<void>;
  stopAdvertising(): Promise<void>;
  updateValueBase64(
    serviceUuid: string,
    characteristicUuid: string,
    valueBase64: string,
    centralUuids?: string[],
  ): Promise<boolean>;
  respondToRequestBase64(requestId: number, status: number, valueBase64: string): void;
  onDidReceiveWriteRequests(
    listener: (event: {
      requests: { requestId: number; central?: { uuid?: string }; valueBase64?: string }[];
    }) => void,
  ): { remove(): void };
  onDidSubscribeToCharacteristic(
    listener: (event: { central?: { uuid?: string }; characteristic?: { uuid?: string } }) => void,
  ): { remove(): void };
  onDidUnsubscribeFromCharacteristic(
    listener: (event: { central?: { uuid?: string } }) => void,
  ): { remove(): void };
  onReadyToUpdateSubscribers(listener: () => void): { remove(): void };
}

const ATT_SUCCESS = 0;

/**
 * Values from the library's own enums
 * (`src/NativeBlePeripheralManager.ts:36-58`), inlined so this module depends on
 * the package's runtime shape only through the functions it calls.
 */
const PROPERTY_READ = 0x02;
const PROPERTY_WRITE = 0x08;
const PROPERTY_NOTIFY = 0x10;
const PERMISSION_READABLE = 0x01;
const PERMISSION_WRITEABLE = 0x02;

/** `start()` can never settle on some devices; do not wait on it for ever. */
const NATIVE_START_TIMEOUT_MS = 3_000;

interface Link {
  peer: GattPeer;
  link: GattLink;
  reassembler: GattReassembler;
  groupIds: GroupIdSource;
  device?: PlxDevice;
  subscriptions: PlxSubscription[];
}

export class BlePlxGattTransport implements GattTransport {
  readonly name = 'ble-plx+peripheral-manager';

  private readonly plx: PlxManager;
  private readonly peripheral: PeripheralManagerModule | null;

  private readonly links = new Map<string, Link>();
  private readonly listeners = new Set<Partial<GattTransportEvents>>();
  private readonly nativeSubscriptions: { remove(): void }[] = [];

  private servicePublished = false;
  private nativeStarted = false;
  private advertising = false;
  private scanning = false;
  /** Resolves when the peripheral stack says its transmit queue has drained. */
  private readyWaiters: (() => void)[] = [];
  /** Serialises notifies: the stack accepts one outstanding update at a time. */
  private txChain: Promise<unknown> = Promise.resolve();

  constructor(plx: PlxManager, peripheral: PeripheralManagerModule | null) {
    this.plx = plx;
    this.peripheral = peripheral;

    // A malformed profile UUID would reach CoreBluetooth and throw where it
    // cannot be caught. Fail here instead, at construction, where it is obvious.
    for (const uuid of [GATT_SERVICE_UUID, GATT_CHAR_TX_UUID, GATT_CHAR_RX_UUID]) {
      if (!isValidUuid128(uuid)) {
        throw new GattTransportError('internal', `profile UUID ${uuid} is not a 128-bit UUID`, {
          recoverable: false,
        });
      }
    }
  }

  async getCapabilities(): Promise<GattCapabilities> {
    return {
      supportsCentral: true,
      supportsPeripheral: this.peripheral !== null,
      unavailableReason:
        this.peripheral === null
          ? 'This build has no BLE peripheral support, so other attendees cannot open a link to this phone. Connecting out to them still works.'
          : undefined,
    };
  }

  /* ---------------------------------------------------------------- *
   * Server half
   * ---------------------------------------------------------------- */

  async startPeripheral(options: { displayName?: string } = {}): Promise<void> {
    const peripheral = this.requirePeripheral();

    if (!this.nativeStarted) {
      // The module needs an explicit start, and on some devices that promise
      // never settles. Racing a timeout and carrying on is what Treasure Hunt
      // learned to do here; blocking for ever would hang the caller instead.
      await Promise.race([
        peripheral.start().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, NATIVE_START_TIMEOUT_MS)),
      ]);
      this.nativeStarted = true;
    }

    if (!this.servicePublished) {
      // Remove OUR service only, never `removeAllServices()`.
      //
      // The peripheral manager is one process-wide object shared with the other
      // BLE apps in this hub. Treasure Hunt's host transport calls
      // `removeAllServices()` before publishing, which would delete EventPulse's
      // service; doing the same back would delete a running game's. Scoping the
      // removal to our own UUID is the only neighbourly option.
      try {
        peripheral.removeService(GATT_SERVICE_UUID);
      } catch {
        // Not published yet. Expected on the first call.
      }

      peripheral.addService(GATT_SERVICE_UUID, true);

      // TX: server -> client by notification. Read is included so a central that
      // prefers to poll can, but nothing in EventPulse does.
      peripheral.addCharacteristicToServiceBase64(
        GATT_SERVICE_UUID,
        GATT_CHAR_TX_UUID,
        PROPERTY_NOTIFY | PROPERTY_READ,
        PERMISSION_READABLE,
        '',
      );

      // RX: client -> server by write with response.
      peripheral.addCharacteristicToServiceBase64(
        GATT_SERVICE_UUID,
        GATT_CHAR_RX_UUID,
        PROPERTY_WRITE,
        PERMISSION_WRITEABLE,
        '',
      );

      this.attachPeripheralListeners(peripheral);
      this.servicePublished = true;
    }

    try {
      await peripheral.startAdvertising({
        name: options.displayName,
        serviceUuids: [GATT_SERVICE_UUID],
      });
      this.advertising = true;
    } catch (error) {
      throw new GattTransportError(
        'advertise_failed',
        'Could not start advertising the EventPulse service. Some Android chipsets have no BLE advertiser at all.',
        { cause: error },
      );
    }
  }

  async stopPeripheral(): Promise<void> {
    if (!this.peripheral || !this.advertising) return;
    try {
      await this.peripheral.stopAdvertising();
    } catch {
      // Stopping an advertiser that already stopped is not worth surfacing.
    }
    this.advertising = false;
  }

  private attachPeripheralListeners(peripheral: PeripheralManagerModule): void {
    this.nativeSubscriptions.push(
      peripheral.onDidSubscribeToCharacteristic((event) => {
        const centralId = event.central?.uuid;
        if (!centralId || event.characteristic?.uuid?.toLowerCase() !== GATT_CHAR_TX_UUID) return;
        // A central subscribing to TX is the moment an inbound link becomes
        // usable: before that there is nowhere to notify.
        this.openInboundLink(centralId);
      }),
    );

    this.nativeSubscriptions.push(
      peripheral.onDidUnsubscribeFromCharacteristic((event) => {
        const centralId = event.central?.uuid;
        if (centralId) this.dropLink(centralId, 'remote');
      }),
    );

    this.nativeSubscriptions.push(
      peripheral.onDidReceiveWriteRequests((event) => {
        for (const request of event.requests) {
          const centralId = request.central?.uuid;
          if (centralId && request.valueBase64) {
            this.ingest(centralId, base64ToBytes(request.valueBase64));
          }
          try {
            peripheral.respondToRequestBase64(request.requestId, ATT_SUCCESS, '');
          } catch {
            // The central may already be gone; the write still counted.
          }
        }
      }),
    );

    this.nativeSubscriptions.push(
      peripheral.onReadyToUpdateSubscribers(() => {
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const resolve of waiters) resolve();
      }),
    );
  }

  private openInboundLink(centralId: string): void {
    if (this.links.has(centralId)) return;
    const link = new GattLink(centralId, Date.now());
    link.event({ kind: 'connect' }, Date.now());
    link.event({ kind: 'ready' }, Date.now());

    const peer: GattPeer = {
      deviceId: centralId,
      role: 'peripheral',
      // The peripheral side is never told the negotiated MTU by either library.
      // Assuming the floor is the only safe choice: fragments sized for a larger
      // MTU than the link actually has are silently truncated.
      mtu: ATT_DEFAULT_MTU,
      connectedAt: Date.now(),
    };

    this.links.set(centralId, {
      peer,
      link,
      reassembler: new GattReassembler(),
      groupIds: new GroupIdSource(),
      subscriptions: [],
    });
    this.emit('onPeerConnected', peer);
  }

  /* ---------------------------------------------------------------- *
   * Client half
   * ---------------------------------------------------------------- */

  async startScan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.plx.startDeviceScan([GATT_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.emit(
          'onError',
          new GattTransportError('internal', 'BLE scan failed', { cause: error }),
        );
        return;
      }
      if (!device) return;
      this.emit('onDiscovery', {
        deviceId: device.id,
        displayName: device.localName ?? device.name ?? undefined,
        rssi: device.rssi ?? undefined,
        discoveredAt: Date.now(),
      });
    });
  }

  async stopScan(): Promise<void> {
    if (!this.scanning) return;
    this.scanning = false;
    try {
      this.plx.stopDeviceScan();
    } catch {
      // Stopping a scan that already stopped is benign.
    }
  }

  async connect(deviceId: string, options: { timeoutMs?: number } = {}): Promise<GattPeer> {
    const existing = this.links.get(deviceId);
    if (existing?.link.isUsable) return existing.peer;
    if (existing?.link.isBusy) {
      throw new GattTransportError('connect_failed', `already connecting to ${deviceId}`);
    }

    const now = Date.now();
    const link = new GattLink(deviceId, now);
    link.event({ kind: 'connect' }, now, options.timeoutMs ?? CONNECT_TIMEOUT_MS);

    const entry: Link = {
      peer: { deviceId, role: 'central', mtu: initialAssumedMtu(), connectedAt: now },
      link,
      reassembler: new GattReassembler(),
      groupIds: new GroupIdSource(),
      subscriptions: [],
    };
    this.links.set(deviceId, entry);

    try {
      const device = await this.plx.connectToDevice(deviceId, {
        timeout: options.timeoutMs ?? CONNECT_TIMEOUT_MS,
      });
      entry.device = device;

      await device.discoverAllServicesAndCharacteristics();

      // MTU. Android has to ask and starts at 23; iOS negotiated already and
      // simply reports what it settled on.
      let mtu = initialAssumedMtu();
      if (Platform.OS === 'android') {
        try {
          const updated = await device.requestMTU(ANDROID_REQUESTED_MTU);
          mtu = updated.mtu ?? mtu;
        } catch {
          // A refused request is not fatal — it means we stay at the floor.
        }
      } else {
        mtu = device.mtu ?? mtu;
      }
      entry.peer = { ...entry.peer, mtu };

      entry.subscriptions.push(
        device.onDisconnected(() => this.dropLink(deviceId, 'remote')),
      );
      entry.subscriptions.push(
        device.monitorCharacteristicForService(
          GATT_SERVICE_UUID,
          GATT_CHAR_TX_UUID,
          (error, characteristic) => {
            if (error) {
              this.dropLink(deviceId, 'error');
              return;
            }
            if (characteristic?.value) {
              this.ingest(deviceId, base64ToBytes(characteristic.value));
            }
          },
        ),
      );

      link.event({ kind: 'ready' }, Date.now());
      this.emit('onPeerConnected', entry.peer);
      this.emit('onMtuChanged', deviceId, mtu);
      return entry.peer;
    } catch (error) {
      link.event({ kind: 'fail', reason: 'error' }, Date.now());
      this.cleanupLink(deviceId);
      throw new GattTransportError('connect_failed', `could not open a link to ${deviceId}`, {
        cause: error,
      });
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const entry = this.links.get(deviceId);
    if (!entry) return;
    entry.link.event({ kind: 'disconnect' }, Date.now());
    try {
      if (entry.peer.role === 'central') await this.plx.cancelDeviceConnection(deviceId);
    } catch {
      // Already gone. The drop below still runs, so state converges either way.
    }
    this.dropLink(deviceId, 'local');
  }

  /* ---------------------------------------------------------------- *
   * Traffic
   * ---------------------------------------------------------------- */

  async send(deviceId: string, payload: Uint8Array): Promise<void> {
    const entry = this.links.get(deviceId);
    if (!entry || !entry.link.isUsable) {
      throw new GattTransportError('not_connected', `no live link to ${deviceId}`);
    }

    const frames = fragmentMessage(payload, payloadBytesForMtu(entry.peer.mtu), entry.groupIds);

    for (const frame of frames) {
      if (entry.peer.role === 'central') {
        const device = entry.device;
        if (!device) throw new GattTransportError('not_connected', `link to ${deviceId} has no device`);
        try {
          await device.writeCharacteristicWithResponseForService(
            GATT_SERVICE_UUID,
            GATT_CHAR_RX_UUID,
            bytesToBase64(frame),
          );
        } catch (error) {
          throw new GattTransportError('write_failed', `write to ${deviceId} failed`, {
            cause: error,
          });
        }
      } else {
        await this.enqueueTx(() => this.notifyFrame(frame, [deviceId]));
      }
    }
  }

  /**
   * Push one frame to a subscribed central, honouring backpressure.
   *
   * `updateValue` returning false means the transmit queue was full and NOTHING
   * was sent. Carrying on regardless drops the frame silently and the far side
   * waits for a fragment that will never arrive, so the only correct response
   * is to wait for the stack to drain and re-send this exact frame.
   */
  private async notifyFrame(frame: Uint8Array, centralUuids?: string[]): Promise<void> {
    const peripheral = this.requirePeripheral();
    const value = bytesToBase64(frame);
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let accepted: boolean;
      try {
        accepted = await peripheral.updateValueBase64(
          GATT_SERVICE_UUID,
          GATT_CHAR_TX_UUID,
          value,
          centralUuids,
        );
      } catch (error) {
        throw new GattTransportError('notify_failed', 'notify failed', { cause: error });
      }
      if (accepted) return;
      await this.waitForReady();
    }

    throw new GattTransportError(
      'notify_failed',
      'notify dropped: the transmit queue stayed full',
    );
  }

  private waitForReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  /** One notify at a time; the stack accepts a single outstanding update. */
  private enqueueTx<T>(work: () => Promise<T>): Promise<T> {
    const run = this.txChain.then(work);
    this.txChain = run.catch(() => undefined);
    return run;
  }

  private ingest(deviceId: string, frame: Uint8Array): void {
    const entry = this.links.get(deviceId);
    if (!entry || !entry.link.isUsable) return;
    try {
      const message = entry.reassembler.push(frame);
      if (message) this.emit('onMessage', deviceId, message);
    } catch (error) {
      this.emit(
        'onError',
        new GattTransportError('internal', `discarded a malformed frame from ${deviceId}`, {
          cause: error,
        }),
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * Teardown
   * ---------------------------------------------------------------- */

  private dropLink(deviceId: string, reason: GattDisconnectReason): void {
    const entry = this.links.get(deviceId);
    if (!entry) return;
    entry.link.event({ kind: 'drop', reason }, Date.now());
    this.cleanupLink(deviceId);
    this.emit('onPeerDisconnected', deviceId, reason);
  }

  private cleanupLink(deviceId: string): void {
    const entry = this.links.get(deviceId);
    if (!entry) return;
    for (const subscription of entry.subscriptions) {
      try {
        subscription.remove();
      } catch {
        // A subscription belonging to a device that is already gone.
      }
    }
    entry.subscriptions = [];
    entry.reassembler.reset();
    this.links.delete(deviceId);
  }

  getPeers(): GattPeer[] {
    return [...this.links.values()].filter((l) => l.link.isUsable).map((l) => l.peer);
  }

  getPeer(deviceId: string): GattPeer | undefined {
    const entry = this.links.get(deviceId);
    return entry?.link.isUsable ? entry.peer : undefined;
  }

  getLinkState(deviceId: string): GattLinkState {
    return this.links.get(deviceId)?.link.state ?? 'idle';
  }

  subscribe(events: Partial<GattTransportEvents>): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  async shutdown(): Promise<void> {
    await this.stopScan();
    await this.stopPeripheral();
    for (const deviceId of [...this.links.keys()]) {
      await this.disconnect(deviceId).catch(() => undefined);
    }
    for (const subscription of this.nativeSubscriptions) {
      try {
        subscription.remove();
      } catch {
        // Best effort on the way out.
      }
    }
    this.nativeSubscriptions.length = 0;
    this.listeners.clear();
    // NOT plx.destroy(): react-native-ble-plx's BleManager is a process-wide
    // singleton shared with the other BLE apps in this hub. Destroying it here
    // would take Treasure Hunt's radio down with us.
  }

  private requirePeripheral(): PeripheralManagerModule {
    if (!this.peripheral) {
      throw new GattTransportError(
        'unavailable',
        'BLE peripheral support is not available in this build, so this phone cannot host a link.',
        { recoverable: false },
      );
    }
    return this.peripheral;
  }

  private emit<K extends keyof GattTransportEvents>(
    name: K,
    ...args: Parameters<NonNullable<GattTransportEvents[K]>>
  ): void {
    for (const listener of [...this.listeners]) {
      const handler = listener[name];
      if (handler) (handler as (...a: unknown[]) => void)(...args);
    }
  }
}

/**
 * The MTU to assume before the real one is known.
 *
 * Android starts at the 23-byte BLE minimum until `requestMTU` succeeds, so
 * assuming anything larger there truncates the first messages of every link.
 * iOS negotiates on connect and settles around 185.
 */
function initialAssumedMtu(): number {
  return Platform.OS === 'ios' ? IOS_ASSUMED_MTU : ATT_DEFAULT_MTU;
}
