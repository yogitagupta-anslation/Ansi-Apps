/**
 * EventPulse's GATT transport, carried by BleChat's native BLE modules.
 *
 * Same `GattTransport` contract as before, so nothing above this file changes:
 * `GattSessionManager`, `ConnectionRequestCoordinator`, the radar, the profile
 * cards and the Connect action all keep working against the interface they
 * already use. Only the metal underneath is different.
 *
 * WHY NOT SIT ON BleChat's `BLETransport`
 * ---------------------------------------
 * That was the obvious shape, and it is wrong here for one concrete reason:
 * `BLETransport` and the two JS wrappers under it hardcode BleChat's own
 * service and characteristic UUIDs at the call site —
 * `NativeGattClient.ts:81-86` and `BlePeripheralBridge.ts:172-179`. Going
 * through them would put EventPulse's traffic on BleChat's service, on
 * BleChat's characteristics, sharing one process-wide GATT server with a
 * running chat. Two apps in one APK would become indistinguishable on the air.
 *
 * The Kotlin underneath has no such opinion: `BleClientModule.connect` and
 * `BlePeripheralModule.start` both take the service, RX and TX UUIDs as
 * parameters. So this file calls those same proven native modules directly and
 * passes EventPulse's UUIDs. Nothing native is copied, forked or reimplemented
 * — it is the identical Kotlin, asked a different question.
 *
 * WHAT IS ACTUALLY REUSED
 * -----------------------
 *   central role   `NativeModules.BleClient`     — the Android 13+ write path
 *                                                  BleChat wrote precisely
 *                                                  because ble-plx writes came
 *                                                  back refused with no reason
 *   server role    `NativeModules.BlePeripheral` — openGattServer, addService,
 *                                                  notify, sendResponse
 *   scanning       react-native-ble-plx          — the one thing BleChat kept
 *                                                  ble-plx for, because it works
 *
 * FRAGMENTATION IS NOT DUPLICATED
 * -------------------------------
 * BleChat fragments inside `BLETransport`, which this file deliberately does
 * not use, so BleChat's fragmenter is never in this path and cannot double up.
 * EventPulse's own `GattFraming` does the work instead — the same framing the
 * current transport uses. That is on purpose: it keeps the wire format
 * identical between the two transports, so switching back is a rollback rather
 * than a protocol migration.
 *
 * IDENTITY
 * --------
 * `deviceId` here is a transport handle and nothing else. It carries BleChat's
 * role prefix (`c:` we dialled them, `p:` they dialled us) so the two
 * directions can never collide on one address. The rotating peer id travels in
 * the advertisement and is surfaced as `discovery.displayName`; mapping that to
 * a person remains the session layer's job, exactly as before.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';

import { trace } from '../../../runtime/diagnostics';
import { base64ToBytes, bytesToBase64 } from '../../../utils/base64';
import { bytesToHex } from '../../../utils/bytes';
import {
  ATT_DEFAULT_MTU,
  GATT_CHAR_RX_UUID,
  GATT_CHAR_TX_UUID,
  GATT_SERVICE_UUID,
  payloadBytesForMtu,
} from '../GattProfile';
import { GattReassembler, GroupIdSource, fragmentMessage } from '../GattFraming';
import { GattLink, type GattLinkState } from '../GattLink';
import {
  GattTransportError,
  type GattCapabilities,
  type GattDisconnectReason,
  type GattDiscovery,
  type GattPeer,
  type GattTransport,
  type GattTransportEvents,
} from '../GattTransport';

/* ------------------------------------------------------------------ *
 * The native surface
 *
 * Declared here because BleChat's own wrappers pin its UUIDs. Every member
 * below mirrors a `@ReactMethod` in the Kotlin and is cited to it, because
 * hand-written interfaces over `NativeModules` are exactly what hid three
 * silent GATT bugs in the previous transport: TypeScript checks this file
 * against this declaration, never against the module.
 * ------------------------------------------------------------------ */

/** `modules/blechat/android/bleclient/BleClientModule.kt` */
interface NativeBleClient {
  /** :92 — resolves once services, characteristics and MTU are all settled. */
  connect(
    address: string,
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
  ): Promise<{ address: string; mtu: number; rxProperties: number }>;
  /** :126 */
  disconnect(address: string): Promise<boolean>;
  /** :154 — `withResponse` picks the ATT write type. */
  write(address: string, base64: string, withResponse: boolean): Promise<boolean>;
}

/** `modules/blechat/android/bleperipheral/BlePeripheralModule.kt` */
interface NativeBlePeripheral {
  getCapabilities(): Promise<{
    hasBluetooth: boolean;
    bluetoothEnabled: boolean;
    supportsMultipleAdvertisement: boolean;
    hasAdvertiser: boolean;
    isAdvertising: boolean;
    sdkInt: number;
    missingPermissions: string[];
  }>;
  /**
   * The UUIDs are parameters, which is the whole reason this transport can
   * exist without forking anything.
   *
   * `peerIdPrefix` is hex and is padded to 8 bytes inside the manufacturer
   * payload (`BlePeripheralModule.kt:321-329`); EventPulse's rotating peer id
   * is 4 bytes, so it fits with room to spare.
   */
  start(
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
    peerIdPrefix: string,
    displayName: string,
    interestMask: number,
  ): Promise<{ advertising: boolean }>;
  stop(): Promise<boolean>;
  send(centralId: string, base64Data: string): Promise<boolean>;
}

/**
 * What a scan result has to tell us. A structural subset of ble-plx's `Device`,
 * so the real manager satisfies it without a cast and a test can supply four
 * fields instead of a class.
 */
export interface ScannedDevice {
  id: string;
  name: string | null;
  localName?: string | null;
  rssi?: number | null;
  manufacturerData?: string | null;
}

/** The only scanner calls this transport makes. */
export interface GattScanner {
  state(): Promise<string>;
  startDeviceScan(
    serviceUuids: string[] | null,
    options: { allowDuplicates?: boolean } | null,
    listener: (error: { message: string } | null, device: ScannedDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
}

/**
 * A native event source, narrowed to subscribe-and-unsubscribe.
 *
 * Generic in the payload so each call site declares the shape it expects
 * alongside the event name it expects it from — which is the only place those
 * two facts are known together.
 */
export interface NativeEvents {
  addListener<T>(event: string, handler: (payload: T) => void): { remove(): void };
}

/**
 * Everything this transport touches outside itself.
 *
 * Injected rather than reached for, so the adapter's own logic — addressing,
 * framing, link bookkeeping, event translation — can be tested against fakes
 * without a device, a radio or a native module. The production path passes the
 * real ones and is the default.
 */
export interface BleChatTransportDeps {
  client: NativeBleClient;
  peripheral: NativeBlePeripheral;
  clientEvents: NativeEvents;
  peripheralEvents: NativeEvents;
  scanner: GattScanner;
}

/** ble-plx reports adapter state as a string enum; this is the only value we need. */
const POWERED_ON: string = State.PoweredOn;

const nativeClient = (NativeModules as { BleClient?: NativeBleClient }).BleClient ?? null;
const nativePeripheral =
  (NativeModules as { BlePeripheral?: NativeBlePeripheral }).BlePeripheral ?? null;

/** Android only. The client module is Kotlin and has no iOS counterpart. */
export function isBleChatTransportAvailable(): boolean {
  return Platform.OS === 'android' && nativeClient !== null && nativePeripheral !== null;
}

/** The real modules, resolved once when no dependencies are supplied. */
function productionDeps(): BleChatTransportDeps {
  if (!nativeClient || !nativePeripheral) {
    throw new GattTransportError(
      'unavailable',
      'The BleChat native BLE modules are not in this build.',
    );
  }
  return {
    client: nativeClient,
    peripheral: nativePeripheral,
    clientEvents: new NativeEventEmitter(
      NativeModules.BleClient as ConstructorParameters<typeof NativeEventEmitter>[0],
    ),
    peripheralEvents: new NativeEventEmitter(
      NativeModules.BlePeripheral as ConstructorParameters<typeof NativeEventEmitter>[0],
    ),
    scanner: new BleManager(),
  };
}

/** Company id BleChat's advertisement uses. `blechat/config/constants.ts:29`. */
const MANUFACTURER_ID = 0xffff;
/** `BlePeripheralModule.kt` PEER_ID_PREFIX_BYTES. */
const ADV_PREFIX_BYTES = 8;
/** EventPulse peer ids are 4 bytes rendered as 8 hex characters. */
const PEER_ID_BYTES = 4;

const CENTRAL_PREFIX = 'c:';
const PERIPHERAL_PREFIX = 'p:';

function isCentral(deviceId: string): boolean {
  return deviceId.startsWith(CENTRAL_PREFIX);
}

function stripRole(deviceId: string): string {
  return deviceId.slice(2);
}

/**
 * Pull the rotating peer id back out of an advertisement.
 *
 * Mirrors `BLECentral.parseAdvertisement` (`blechat/ble/BLECentral.ts:874-905`)
 * rather than inventing a second reading of the same bytes: ble-plx hands back
 * the raw AD payload including the two-byte little-endian company id, then the
 * body is `version | peerIdPrefix(8) | interestMask(3) | name`.
 */
function peerIdFromAdvertisement(device: ScannedDevice): string | undefined {
  if (!device.manufacturerData) return undefined;
  try {
    const bytes = base64ToBytes(device.manufacturerData);
    if (bytes.length < 3) return undefined;
    if ((bytes[0] | (bytes[1] << 8)) !== MANUFACTURER_ID) return undefined;

    const body = bytes.subarray(2);
    if (body[0] < 1 || body.length < 1 + ADV_PREFIX_BYTES) return undefined;

    // Only the first four bytes are ours; the field is eight wide and the rest
    // is the padding the native side added.
    return bytesToHex(body.subarray(1, 1 + PEER_ID_BYTES)).toUpperCase();
  } catch {
    // A malformed advertisement is noise from some other device, not an error.
    return undefined;
  }
}

interface LinkEntry {
  peer: GattPeer;
  link: GattLink;
  reassembler: GattReassembler;
  groupIds: GroupIdSource;
  /** False when the far side only accepts write-without-response. */
  writeWithResponse: boolean;
}

export class BleChatGattTransport implements GattTransport {
  readonly name = 'blechat-native';

  private readonly deps: BleChatTransportDeps;
  private readonly links = new Map<string, LinkEntry>();
  private readonly listeners = new Set<Partial<GattTransportEvents>>();
  private readonly nativeSubscriptions: { remove(): void }[] = [];
  private scanning = false;
  private advertising = false;
  private listenersAttached = false;

  constructor(deps: BleChatTransportDeps = productionDeps()) {
    this.deps = deps;
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  subscribe(events: Partial<GattTransportEvents>): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  private emit<K extends keyof GattTransportEvents>(
    event: K,
    ...args: Parameters<GattTransportEvents[K]>
  ): void {
    for (const listener of this.listeners) {
      const handler = listener[event] as ((...a: Parameters<GattTransportEvents[K]>) => void) | undefined;
      handler?.(...args);
    }
  }


  async getCapabilities(): Promise<GattCapabilities> {
    try {
      const caps = await this.deps.peripheral.getCapabilities();
      return {
        supportsCentral: caps.hasBluetooth,
        supportsPeripheral: caps.hasAdvertiser && caps.supportsMultipleAdvertisement,
        unavailableReason: caps.hasAdvertiser
          ? undefined
          : 'This phone has no BLE advertiser, so it cannot be found by others.',
      };
    } catch (error) {
      return {
        supportsCentral: false,
        supportsPeripheral: false,
        unavailableReason: error instanceof Error ? error.message : 'Bluetooth is unavailable.',
      };
    }
  }

  /**
   * Attach the native listeners once.
   *
   * Both modules emit through the global device emitter, so a second set of
   * listeners would deliver every frame twice — which reassembly would report
   * as a duplicate fragment rather than as the wiring mistake it is.
   */
  private attachNativeListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    const clientEvents = this.deps.clientEvents;
    this.nativeSubscriptions.push(
      clientEvents.addListener('bleClientData', (event: { address: string; base64: string }) => {
        this.ingest(CENTRAL_PREFIX + event.address, base64ToBytes(event.base64));
      }),
      clientEvents.addListener(
        'bleClientDisconnected',
        (event: { address: string; status: number }) => {
          trace('GATT', 'native client disconnected', {
            address: event.address,
            status: event.status,
          });
          this.dropLink(CENTRAL_PREFIX + event.address, 'remote');
        },
      ),
    );

    const peripheralEvents = this.deps.peripheralEvents;
    this.nativeSubscriptions.push(
      peripheralEvents.addListener(
        'BlePeripheral:centralConnected',
        (event: { centralId: string }) => {
          this.openInboundLink(event.centralId);
        },
      ),
      peripheralEvents.addListener(
        'BlePeripheral:centralDisconnected',
        (event: { centralId: string }) => {
          this.dropLink(PERIPHERAL_PREFIX + event.centralId, 'remote');
        },
      ),
      peripheralEvents.addListener(
        'BlePeripheral:data',
        (event: { centralId: string; data: string }) => {
          this.ingest(PERIPHERAL_PREFIX + event.centralId, base64ToBytes(event.data));
        },
      ),
      peripheralEvents.addListener(
        'BlePeripheral:mtu',
        (event: { centralId: string; mtu: number }) => {
          const entry = this.links.get(PERIPHERAL_PREFIX + event.centralId);
          if (!entry) return;
          entry.peer = { ...entry.peer, mtu: event.mtu };
          this.emit('onMtuChanged', entry.peer.deviceId, event.mtu);
        },
      ),
      peripheralEvents.addListener('BlePeripheral:error', (event: { message: string }) => {
        this.emit('onError', new GattTransportError('internal', event.message));
      }),
    );
  }

  /* ---------------------------------------------------------------- *
   * Server half
   * ---------------------------------------------------------------- */

  async startPeripheral(options: { displayName?: string } = {}): Promise<void> {
    const peripheral = this.deps.peripheral;
    this.attachNativeListeners();

    const peerId = options.displayName ?? '';
    trace('GATT', 'peripheral start requested', { peerId, transport: this.name });

    try {
      /*
       * The peer id goes in the manufacturer payload, not the adapter name.
       *
       * This is the single biggest behavioural difference from the previous
       * transport, and it is a fix rather than a side effect: the old library
       * published identity by renaming the phone's global Bluetooth adapter,
       * which needs BLUETOOTH_CONNECT, fails silently without it, and renames
       * the user's device as a side effect of advertising. Nothing here
       * touches the adapter name.
       */
      const result = await peripheral.start(
        GATT_SERVICE_UUID,
        GATT_CHAR_RX_UUID,
        GATT_CHAR_TX_UUID,
        peerId,
        peerId,
        0,
      );
      this.advertising = result.advertising;
      trace('GATT', 'advertising STARTED', {
        peerId,
        serviceUUID: GATT_SERVICE_UUID,
        transport: this.name,
      });
    } catch (error) {
      trace('GATT', 'advertising FAILED', {
        peerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new GattTransportError(
        'advertise_failed',
        'Could not start advertising the EventPulse service.',
        { cause: error },
      );
    }
  }

  async stopPeripheral(): Promise<void> {
    if (!this.advertising) return;
    try {
      await this.deps.peripheral.stop();
    } catch {
      // Stopping an advertiser that already stopped is not worth surfacing.
    }
    this.advertising = false;
  }

  private openInboundLink(centralId: string): void {
    const deviceId = PERIPHERAL_PREFIX + centralId;
    if (this.links.has(deviceId)) return;

    const link = new GattLink(deviceId, Date.now());
    link.event({ kind: 'connect' }, Date.now());
    link.event({ kind: 'ready' }, Date.now());

    const peer: GattPeer = {
      deviceId,
      role: 'peripheral',
      // The server side is told the real MTU by the `:mtu` event; until then
      // the ATT floor is the only safe assumption.
      mtu: ATT_DEFAULT_MTU,
      connectedAt: Date.now(),
    };

    this.links.set(deviceId, {
      peer,
      link,
      reassembler: new GattReassembler(),
      groupIds: new GroupIdSource(),
      writeWithResponse: true,
    });

    trace('GATT', 'inbound link opened', { deviceId, transport: this.name });
    this.emit('onPeerConnected', peer);
  }

  /* ---------------------------------------------------------------- *
   * Scan
   * ---------------------------------------------------------------- */

  async startScan(): Promise<void> {
    if (this.scanning) return;

    const scanner = this.deps.scanner;
    const state = await scanner.state();
    if (state !== POWERED_ON) {
      throw new GattTransportError('adapter_off', `Bluetooth is not on (${state}).`);
    }

    this.scanning = true;
    trace('GATT', 'scanner START', { filterServiceUuid: GATT_SERVICE_UUID, transport: this.name });

    scanner.startDeviceScan([GATT_SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.scanning = false;
        this.emit(
          'onError',
          new GattTransportError('internal', `scan failed: ${error.message}`, { cause: error }),
        );
        return;
      }
      if (!device) return;

      /*
       * The peer id comes out of the manufacturer payload, and falls back to
       * the advertised local name.
       *
       * The fallback matters during a rollout: a phone still running the old
       * transport publishes its peer id as the adapter name, and should stay
       * findable by a phone that has already moved to this one.
       */
      const displayName =
        peerIdFromAdvertisement(device) ?? device.localName ?? device.name ?? undefined;

      const discovery: GattDiscovery = {
        deviceId: CENTRAL_PREFIX + device.id,
        displayName,
        rssi: device.rssi ?? undefined,
        discoveredAt: Date.now(),
      };
      this.emit('onDiscovery', discovery);
    });
  }

  async stopScan(): Promise<void> {
    if (!this.scanning) return;
    try {
      this.deps.scanner.stopDeviceScan();
    } catch {
      // Already stopped.
    }
    this.scanning = false;
  }

  /* ---------------------------------------------------------------- *
   * Client half
   * ---------------------------------------------------------------- */

  async connect(deviceId: string, _options: { timeoutMs?: number } = {}): Promise<GattPeer> {
    const existing = this.links.get(deviceId);
    if (existing) return existing.peer;

    if (!isCentral(deviceId)) {
      throw new GattTransportError(
        'not_connected',
        `${deviceId} is an inbound link; it cannot be dialled.`,
      );
    }

    const client = this.deps.client;
    this.attachNativeListeners();

    // Scanning while dialling makes both slower and is a common cause of flaky
    // links on Android.
    await this.stopScan();

    const address = stripRole(deviceId);
    const link = new GattLink(deviceId, Date.now());
    link.event({ kind: 'connect' }, Date.now());

    trace('GATT', 'connect attempt', { deviceId, transport: this.name });

    let result: { mtu: number; rxProperties: number };
    try {
      /*
       * One call, and it resolves late on purpose.
       *
       * The native side connects, discovers services and characteristics,
       * settles the MTU and subscribes to notifications before resolving, so a
       * resolved promise here means the link can actually carry a message —
       * which is exactly what this interface promises its callers.
       */
      result = await client.connect(address, GATT_SERVICE_UUID, GATT_CHAR_RX_UUID, GATT_CHAR_TX_UUID);
    } catch (error) {
      link.event({ kind: 'fail', reason: 'error' }, Date.now());
      trace('GATT', 'connect FAILED', {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new GattTransportError('connect_failed', `could not open a link to ${deviceId}`, {
        cause: error,
      });
    }

    link.event({ kind: 'ready' }, Date.now());

    // 0x08 is WRITE, 0x04 is WRITE_NO_RESPONSE, as the framework reports them.
    const writeWithResponse = (result.rxProperties & 0x08) !== 0;

    const peer: GattPeer = {
      deviceId,
      role: 'central',
      mtu: result.mtu,
      connectedAt: Date.now(),
    };

    this.links.set(deviceId, {
      peer,
      link,
      reassembler: new GattReassembler(),
      groupIds: new GroupIdSource(),
      writeWithResponse,
    });

    trace('GATT', 'connected', { deviceId, mtu: result.mtu, writeWithResponse });
    this.emit('onPeerConnected', peer);
    this.emit('onMtuChanged', deviceId, result.mtu);
    return peer;
  }

  async disconnect(deviceId: string): Promise<void> {
    const entry = this.links.get(deviceId);
    if (!entry) return;

    if (isCentral(deviceId)) {
      try {
        await this.deps.client.disconnect(stripRole(deviceId));
      } catch {
        // Already gone; the drop below still converges.
      }
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

    // EventPulse's framing, at this link's MTU. BleChat's fragmenter lives in
    // `BLETransport`, which this transport does not use, so there is exactly
    // one fragmentation layer in this path.
    const frames = fragmentMessage(payload, payloadBytesForMtu(entry.peer.mtu), entry.groupIds);

    for (const frame of frames) {
      const base64 = bytesToBase64(frame);
      try {
        if (isCentral(deviceId)) {
          await this.deps.client.write(stripRole(deviceId), base64, entry.writeWithResponse);
        } else {
          await this.deps.peripheral.send(stripRole(deviceId), base64);
        }
      } catch (error) {
        throw new GattTransportError('write_failed', `write to ${deviceId} failed`, {
          cause: error,
        });
      }
    }
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

  private dropLink(deviceId: string, reason: GattDisconnectReason): void {
    const entry = this.links.get(deviceId);
    if (!entry) return;
    entry.link.event({ kind: 'disconnect' }, Date.now());
    this.links.delete(deviceId);
    this.emit('onPeerDisconnected', deviceId, reason);
  }

  /* ---------------------------------------------------------------- *
   * Inspection
   * ---------------------------------------------------------------- */

  getPeers(): GattPeer[] {
    return [...this.links.values()].map((entry) => entry.peer);
  }

  getPeer(deviceId: string): GattPeer | undefined {
    return this.links.get(deviceId)?.peer;
  }

  getLinkState(deviceId: string): GattLinkState {
    return this.links.get(deviceId)?.link.state ?? 'idle';
  }

  async shutdown(): Promise<void> {
    await this.stopScan();
    await this.stopPeripheral();

    for (const deviceId of [...this.links.keys()]) {
      await this.disconnect(deviceId);
    }

    for (const subscription of this.nativeSubscriptions) {
      try {
        subscription.remove();
      } catch {
        // A listener that is already gone is not a problem.
      }
    }
    this.nativeSubscriptions.length = 0;
    this.listenersAttached = false;

    // Note there is no `destroy()` here: the BleManager is process-wide and
    // shared with the other BLE apps in this hub, so tearing it down would take
    // their scanning with it.
  }
}
