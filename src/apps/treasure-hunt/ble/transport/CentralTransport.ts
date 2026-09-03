/**
 * Player-side transport: a real BLE central built on react-native-ble-plx.
 *
 * Verified capability (see docs/BLE-CAPABILITY-MATRIX.md): react-native-ble-plx
 * supports scanning, connecting, service discovery, MTU negotiation, and
 * characteristic write + notify on both iOS and Android. It does NOT support
 * peripheral mode, which is why hosting uses a different library entirely.
 *
 * Nothing here is simulated. Every call goes to the native stack.
 */
import {Platform} from 'react-native';
import {
  BleManager as PlxManager,
  State as PlxState,
  type BleError as PlxError,
  type Characteristic,
  type Device,
  type Subscription,
} from 'react-native-ble-plx';

import {
  ANDROID_REQUESTED_MTU,
  BLE_CHAR_HOST_TX_UUID,
  BLE_CHAR_PLAYER_RX_UUID,
  BLE_SERVICE_UUID,
  CONNECTION,
  SCAN,
  parseAdvertisedName,
  payloadBytesForMtu,
} from '../../config/bleConfig';
import {
  BleAdapterState,
  BleError,
  BleErrorCode,
  BleLinkState,
  BleRole,
  type BlePeer,
  type DiscoveredHost,
  type TransportEvents,
} from '../BleTypes';
import {Reassembler, fragment} from '../Framer';
import {initialAssumedMtu} from './mtu';
import {Emitter} from '../../utils/emitter';
import {base64ToBytes, bytesToBase64} from '../../utils/base64';
import {createLogger} from '../../utils/logger';
import type {CentralTransport as ICentralTransport} from './Transport';

const log = createLogger('CentralTransport');

function mapState(state: PlxState): BleAdapterState {
  switch (state) {
    case PlxState.PoweredOn:
      return BleAdapterState.PoweredOn;
    case PlxState.PoweredOff:
      return BleAdapterState.PoweredOff;
    case PlxState.Unauthorized:
      return BleAdapterState.Unauthorized;
    case PlxState.Unsupported:
      return BleAdapterState.Unsupported;
    case PlxState.Resetting:
      return BleAdapterState.Resetting;
    default:
      return BleAdapterState.Unknown;
  }
}

interface CentralLink {
  peer: BlePeer;
  device: Device;
  reassembler: Reassembler;
  notifySub: Subscription | null;
  disconnectSub: Subscription | null;
  /** Serialises writes -- a BLE stack rejects overlapping writes on one link. */
  writeChain: Promise<unknown>;
}

export class BlePlxCentralTransport implements ICentralTransport {
  readonly role = BleRole.Central as const;
  readonly events = new Emitter<TransportEvents>();

  private manager: PlxManager | null = null;
  private stateSub: Subscription | null = null;
  private links = new Map<string, CentralLink>();
  private discovered = new Map<string, DiscoveredHost>();
  private scanning = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAdapterState: BleAdapterState = BleAdapterState.Unknown;

  private get plx(): PlxManager {
    if (!this.manager) {
      throw new BleError('Central transport used before initialize()', BleErrorCode.Unknown);
    }
    return this.manager;
  }

  async initialize(): Promise<BleAdapterState> {
    if (!this.manager) {
      this.manager = new PlxManager();
      this.stateSub = this.manager.onStateChange(state => {
        const mapped = mapState(state);
        this.lastAdapterState = mapped;
        this.events.emit('adapterState', mapped);
        if (mapped !== BleAdapterState.PoweredOn) {
          // The stack tears links down itself; mirror that in our bookkeeping.
          this.failAllLinks('bluetooth adapter left the powered-on state');
        }
      }, true);
    }
    const state = mapState(await this.plx.state());
    this.lastAdapterState = state;
    return state;
  }

  async getAdapterState(): Promise<BleAdapterState> {
    if (!this.manager) {
      return this.lastAdapterState;
    }
    return mapState(await this.plx.state());
  }

  // -------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------

  async startScan(onDiscover: (host: DiscoveredHost) => void): Promise<void> {
    const state = await this.getAdapterState();
    if (state !== BleAdapterState.PoweredOn) {
      throw new BleError(
        `cannot scan while the adapter is ${state}`,
        state === BleAdapterState.Unauthorized
          ? BleErrorCode.PermissionDenied
          : BleErrorCode.BluetoothOff,
      );
    }

    if (this.scanning) {
      return;
    }
    this.scanning = true;
    this.discovered.clear();

    this.plx.startDeviceScan(
      [BLE_SERVICE_UUID],
      // allowDuplicates keeps RSSI and lastSeenAt fresh so stale hosts age out.
      {allowDuplicates: true},
      (error: PlxError | null, device: Device | null) => {
        if (error) {
          log.error('scan failed', error);
          this.scanning = false;
          this.events.emit(
            'error',
            new BleError(error.message ?? 'scan failed', BleErrorCode.ScanFailed, error),
          );
          return;
        }
        if (!device) {
          return;
        }

        const advertisedName = device.localName ?? device.name;
        const gameCode = parseAdvertisedName(advertisedName);
        if (!gameCode) {
          // Advertises our service UUID but not our name format -- ignore it.
          return;
        }

        const now = Date.now();
        const existing = this.discovered.get(device.id);

        if (existing) {
          // Throttle: an allowDuplicates scan fires many times per second.
          if (now - existing.lastSeenAt < SCAN.dedupeIntervalMs) {
            return;
          }
          existing.lastSeenAt = now;
          existing.rssi = device.rssi;
          existing.gameCode = gameCode;
          onDiscover({...existing});
          return;
        }

        const host: DiscoveredHost = {
          deviceId: device.id,
          gameCode,
          name: advertisedName,
          rssi: device.rssi,
          firstSeenAt: now,
          lastSeenAt: now,
        };
        this.discovered.set(device.id, host);
        log.info(`discovered host ${gameCode} (${device.id}) rssi=${device.rssi ?? 'n/a'}`);
        onDiscover({...host});
      },
    );

    this.scanTimer = setTimeout(() => {
      void this.stopScan();
    }, SCAN.timeoutMs);
  }

  async stopScan(): Promise<void> {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (!this.scanning || !this.manager) {
      this.scanning = false;
      return;
    }
    this.scanning = false;
    try {
      this.plx.stopDeviceScan();
    } catch (err) {
      log.warn('stopDeviceScan threw', err);
    }
  }

  /** Hosts whose advertisement has not been refreshed recently. */
  pruneStaleHosts(): DiscoveredHost[] {
    const cutoff = Date.now() - SCAN.staleHostMs;
    const removed: DiscoveredHost[] = [];
    for (const [id, host] of this.discovered) {
      if (host.lastSeenAt < cutoff) {
        this.discovered.delete(id);
        removed.push(host);
      }
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // Connecting
  // -------------------------------------------------------------------------

  async connect(deviceId: string): Promise<BlePeer> {
    const existing = this.links.get(deviceId);
    if (existing && existing.peer.state === BleLinkState.Connected) {
      return existing.peer;
    }

    // Scanning while connecting slows the connection down badly on Android.
    await this.stopScan();

    let device: Device;
    try {
      device = await this.plx.connectToDevice(deviceId, {
        timeout: CONNECTION.connectTimeoutMs,
        // Android only; harmless elsewhere. Avoids the 30s autoConnect path.
        autoConnect: false,
      });
    } catch (err) {
      throw new BleError(
        `could not connect to ${deviceId}`,
        BleErrorCode.ConnectFailed,
        err,
      );
    }

    try {
      await device.discoverAllServicesAndCharacteristics();
    } catch (err) {
      await this.safeCancel(deviceId);
      throw new BleError(
        'connected but service discovery failed',
        BleErrorCode.ConnectFailed,
        err,
      );
    }

    // Larger MTU means fewer fragments per message. Android must ask; iOS
    // negotiates on its own and exposes no request API.
    let mtu = initialAssumedMtu();
    if (Platform.OS === 'android') {
      try {
        const updated = await device.requestMTU(ANDROID_REQUESTED_MTU);
        mtu = updated.mtu ?? mtu;
      } catch (err) {
        log.warn(`MTU request refused, staying at ${mtu}`, err);
      }
    } else {
      mtu = device.mtu ?? mtu;
    }

    const peer: BlePeer = {
      peerId: deviceId,
      state: BleLinkState.Connected,
      mtu,
      connectedAt: Date.now(),
      lastRxAt: Date.now(),
      lastTxAt: 0,
    };

    const link: CentralLink = {
      peer,
      device,
      reassembler: new Reassembler(),
      notifySub: null,
      disconnectSub: null,
      writeChain: Promise.resolve(),
    };

    link.disconnectSub = device.onDisconnected((error, disconnected) => {
      const id = disconnected?.id ?? deviceId;
      log.warn(`link to ${id} dropped${error ? `: ${error.message}` : ''}`);
      this.teardownLink(id, error?.message ?? 'peer disconnected');
    });

    try {
      link.notifySub = device.monitorCharacteristicForService(
        BLE_SERVICE_UUID,
        BLE_CHAR_HOST_TX_UUID,
        (error: PlxError | null, characteristic: Characteristic | null) => {
          if (error) {
            // A cancelled monitor during teardown is expected, not an error.
            if (!this.links.has(deviceId)) {
              return;
            }
            log.error('notification stream failed', error);
            this.events.emit(
              'error',
              new BleError(error.message ?? 'notify failed', BleErrorCode.NotifyFailed, error),
            );
            return;
          }
          if (!characteristic?.value) {
            return;
          }
          this.onFrameReceived(deviceId, characteristic.value);
        },
      );
    } catch (err) {
      await this.safeCancel(deviceId);
      throw new BleError(
        'could not subscribe to host notifications',
        BleErrorCode.NotifyFailed,
        err,
      );
    }

    this.links.set(deviceId, link);
    this.events.emit('peerConnected', {...peer});
    this.events.emit('mtuChanged', {peerId: deviceId, mtu});
    log.info(`connected to host ${deviceId} at MTU ${mtu}`);
    return {...peer};
  }

  async disconnect(peerId: string): Promise<void> {
    this.teardownLink(peerId, 'local disconnect');
    await this.safeCancel(peerId);
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  private onFrameReceived(peerId: string, base64Value: string): void {
    const link = this.links.get(peerId);
    if (!link) {
      return;
    }
    link.peer.lastRxAt = Date.now();

    try {
      const complete = link.reassembler.push(base64ToBytes(base64Value));
      if (complete) {
        this.events.emit('data', {peerId, bytes: complete});
      }
    } catch (err) {
      // A malformed frame must never propagate into the native callback.
      log.warn(`dropping malformed frame from ${peerId}`, err);
    }
  }

  async send(peerId: string, payload: Uint8Array): Promise<void> {
    const link = this.links.get(peerId);
    if (!link || link.peer.state !== BleLinkState.Connected) {
      throw new BleError(`no connected link for ${peerId}`, BleErrorCode.Disconnected);
    }

    const frames = fragment(payload, payloadBytesForMtu(link.peer.mtu));

    // Chain writes on this link: issuing two concurrent GATT writes to the same
    // characteristic makes Android return an immediate failure for the second.
    const run = link.writeChain.then(async () => {
      for (const frame of frames) {
        await link.device.writeCharacteristicWithResponseForService(
          BLE_SERVICE_UUID,
          BLE_CHAR_PLAYER_RX_UUID,
          bytesToBase64(frame),
        );
      }
      link.peer.lastTxAt = Date.now();
    });

    // Keep the chain alive even when this send rejects.
    link.writeChain = run.catch(() => undefined);

    try {
      await run;
    } catch (err) {
      throw new BleError(`write to ${peerId} failed`, BleErrorCode.WriteFailed, err);
    }
  }

  async broadcast(payload: Uint8Array, excludePeerId?: string): Promise<void> {
    // A player is only ever connected to the host, so this is a single send in
    // practice. Implemented for interface completeness.
    const targets = Array.from(this.links.keys()).filter(id => id !== excludePeerId);
    await Promise.allSettled(targets.map(id => this.send(id, payload)));
  }

  getPeers(): BlePeer[] {
    return Array.from(this.links.values()).map(link => ({...link.peer}));
  }

  getPeer(peerId: string): BlePeer | undefined {
    const link = this.links.get(peerId);
    return link ? {...link.peer} : undefined;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  private teardownLink(peerId: string, reason: string): void {
    const link = this.links.get(peerId);
    if (!link) {
      return;
    }
    this.links.delete(peerId);

    link.notifySub?.remove();
    link.disconnectSub?.remove();
    link.reassembler.reset();
    link.peer.state = BleLinkState.Disconnected;

    this.events.emit('peerDisconnected', {peerId, reason});
  }

  private failAllLinks(reason: string): void {
    for (const peerId of Array.from(this.links.keys())) {
      this.teardownLink(peerId, reason);
    }
  }

  private async safeCancel(deviceId: string): Promise<void> {
    if (!this.manager) {
      return;
    }
    try {
      await this.plx.cancelDeviceConnection(deviceId);
    } catch {
      // Already gone -- nothing to do.
    }
  }

  async shutdown(): Promise<void> {
    await this.stopScan();
    this.failAllLinks('transport shutting down');
    for (const id of Array.from(this.discovered.keys())) {
      await this.safeCancel(id);
    }
    this.discovered.clear();
    this.stateSub?.remove();
    this.stateSub = null;
    // NOT manager.destroy(). react-native-ble-plx's BleManager is a process-wide
    // singleton: its constructor returns BleManager.sharedInstance, so the object
    // held here is the very same one BLE Chat and Attendance hold. destroy() calls
    // BleModule.destroyClient(), which tears down the one native client for every
    // app in the hub and leaves their cached handles throwing
    // BluetoothManagerDestroyed until the process restarts.
    //
    // Releasing our reference is the whole of this app's teardown: the scan is
    // stopped and the links are gone above, and the next init() reattaches to the
    // live shared instance.
    this.manager = null;
    this.events.removeAllListeners();
  }
}
