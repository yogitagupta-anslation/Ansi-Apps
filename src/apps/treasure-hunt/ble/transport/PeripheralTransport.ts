/**
 * Host-side transport: a real BLE peripheral (GATT server) built on
 * react-native-ble-peripheral-manager.
 *
 * Why this library and not react-native-ble-plx: ble-plx is central-only and
 * documents that it cannot do phone-to-phone peripheral work. This package
 * wraps CBPeripheralManager on iOS and BluetoothGattServer on Android, which is
 * exactly the GATT-server surface hosting needs. See
 * docs/BLE-CAPABILITY-MATRIX.md for the verification notes.
 *
 * Two behaviours here are BLE realities rather than design choices:
 *
 *  1. Backpressure. updateValue() returns false when the transmit queue is
 *     full. When that happens the frame MUST be re-sent after
 *     onReadyToUpdateSubscribers fires -- pushing regardless silently drops it.
 *
 *  2. Per-central addressing. A notify can target specific subscribed centrals.
 *     Targeted sends are used for private data (a player's own proximity) and
 *     broadcasts for shared events.
 */
import {
  CharacteristicPermissions,
  CharacteristicProperties,
  ManagerState,
  addCharacteristicToServiceBase64,
  addService,
  getState,
  isAdvertising as nativeIsAdvertising,
  onDidReceiveWriteRequests,
  onDidStartAdvertising,
  onDidSubscribeToCharacteristic,
  onDidUnsubscribeFromCharacteristic,
  onDidUpdateState,
  onReadyToUpdateSubscribers,
  removeAllServices,
  respondToRequestBase64,
  setName,
  start as nativeStart,
  startAdvertising as nativeStartAdvertising,
  stopAdvertising as nativeStopAdvertising,
  updateValueBase64,
} from 'react-native-ble-peripheral-manager';

import {
  BLE_CHAR_HOST_TX_UUID,
  BLE_CHAR_PLAYER_RX_UUID,
  BLE_SERVICE_UUID,
  MAX_CONCURRENT_PEERS,
  buildAdvertisedName,
  payloadBytesForMtu,
} from '../../config/bleConfig';
import {
  BleAdapterState,
  BleError,
  BleErrorCode,
  BleLinkState,
  BleRole,
  type BlePeer,
  type TransportEvents,
} from '../BleTypes';
import {Reassembler, fragment} from '../Framer';
import {initialAssumedMtu} from './mtu';
import {Emitter} from '../../utils/emitter';
import {base64ToBytes, bytesToBase64} from '../../utils/base64';
import {createLogger} from '../../utils/logger';
import {delay} from '../../utils/time';
import type {PeripheralTransport as IPeripheralTransport} from './Transport';

const log = createLogger('PeripheralTransport');

/**
 * Whether the native peripheral manager has been started in THIS PROCESS.
 *
 * `start()` / `stop()` act on a native singleton that outlives any JS-side
 * transport instance, and the module's one-shot AdvertiseCallback means a
 * SECOND `start()` never settles its promise -- hosting a second game hung on
 * the Create Game spinner forever. Tracking it per process, rather than per
 * instance, means we start it exactly once.
 */
let nativeManagerStarted = false;

/** How long to wait on the module's start() promise before proceeding. */
const NATIVE_START_TIMEOUT_MS = 2500;

/** How long to wait for the adapter to confirm that advertising began. */
const ADVERTISE_CONFIRM_TIMEOUT_MS = 8000;

/** ATT success code, used when acknowledging a write request. */
const ATT_SUCCESS = 0x00;

function mapState(state: number): BleAdapterState {
  switch (state) {
    case ManagerState.PoweredOn:
      return BleAdapterState.PoweredOn;
    case ManagerState.PoweredOff:
      return BleAdapterState.PoweredOff;
    case ManagerState.Unauthorized:
      return BleAdapterState.Unauthorized;
    case ManagerState.Unsupported:
      return BleAdapterState.Unsupported;
    case ManagerState.Resetting:
      return BleAdapterState.Resetting;
    default:
      return BleAdapterState.Unknown;
  }
}

interface CentralLink {
  peer: BlePeer;
  reassembler: Reassembler;
}

interface Subscription {
  remove(): void;
}

export class BlePeripheralHostTransport implements IPeripheralTransport {
  readonly role = BleRole.Peripheral as const;
  readonly events = new Emitter<TransportEvents>();

  private links = new Map<string, CentralLink>();
  private subs: Subscription[] = [];
  private started = false;
  private advertising = false;
  private serviceReady = false;
  private lastAdapterState: BleAdapterState = BleAdapterState.Unknown;

  /** Resolvers waiting for the advertising-start callback. */
  private advertisingWaiters: Array<(ok: boolean, error?: string) => void> = [];

  /** Resolvers waiting for the native transmit queue to drain. */
  private readyWaiters: Array<() => void> = [];
  /** Serialises all notifies so backpressure is observed globally. */
  private txChain: Promise<unknown> = Promise.resolve();

  async initialize(): Promise<BleAdapterState> {
    if (!this.started) {
      this.attachListeners();
      if (!nativeManagerStarted) {
        try {
          /*
           * Race the timeout for the same reason startAdvertising does: the
           * module can leave this promise pending forever. `start()` also
           * self-advertises with empty options, which startAdvertising clears
           * before publishing ours.
           */
          await Promise.race([
            nativeStart(),
            delay(NATIVE_START_TIMEOUT_MS).then(() => {
              log.warn('native start() did not settle; continuing');
            }),
          ]);
        } catch (err) {
          throw new BleError(
            'could not start the BLE peripheral manager',
            BleErrorCode.PeripheralUnavailable,
            err,
          );
        }
        nativeManagerStarted = true;
      }
      this.started = true;
    }

    const state = mapState(await getState());
    this.lastAdapterState = state;
    return state;
  }

  async getAdapterState(): Promise<BleAdapterState> {
    if (!this.started) {
      return this.lastAdapterState;
    }
    const state = mapState(await getState());
    this.lastAdapterState = state;
    return state;
  }

  private attachListeners(): void {
    this.subs.push(
      onDidUpdateState(event => {
        const mapped = mapState(event.state);
        this.lastAdapterState = mapped;
        this.events.emit('adapterState', mapped);
        if (mapped !== BleAdapterState.PoweredOn) {
          this.serviceReady = false;
          this.advertising = false;
          this.dropAllLinks('bluetooth adapter left the powered-on state');
        }
      }) as Subscription,
    );

    this.subs.push(
      onDidSubscribeToCharacteristic(event => {
        if (event.characteristicUUID.toLowerCase() !== BLE_CHAR_HOST_TX_UUID.toLowerCase()) {
          return;
        }
        this.onCentralSubscribed(event.centralUUID);
      }) as Subscription,
    );

    this.subs.push(
      onDidUnsubscribeFromCharacteristic(event => {
        if (event.characteristicUUID.toLowerCase() !== BLE_CHAR_HOST_TX_UUID.toLowerCase()) {
          return;
        }
        this.dropLink(event.centralUUID, 'central unsubscribed');
      }) as Subscription,
    );

    this.subs.push(
      onDidReceiveWriteRequests(event => {
        // Acknowledge first: an unanswered write request stalls the central.
        try {
          respondToRequestBase64(event.requestId, ATT_SUCCESS, '');
        } catch (err) {
          log.warn('respondToRequest failed', err);
        }

        for (const request of event.requests ?? []) {
          if (request.characteristicUUID.toLowerCase() !== BLE_CHAR_PLAYER_RX_UUID.toLowerCase()) {
            continue;
          }
          this.onFrameReceived(request.centralUUID, request.value);
        }
      }) as Subscription,
    );

    this.subs.push(
      onDidStartAdvertising(event => {
        const waiters = this.advertisingWaiters;
        this.advertisingWaiters = [];
        for (const waiter of waiters) {
          waiter(event.success !== false, event.error);
        }
      }) as Subscription,
    );

    this.subs.push(
      onReadyToUpdateSubscribers(() => {
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const resolve of waiters) {
          resolve();
        }
      }) as Subscription,
    );
  }

  // -------------------------------------------------------------------------
  // GATT service + advertising
  // -------------------------------------------------------------------------

  private async publishService(): Promise<void> {
    if (this.serviceReady) {
      return;
    }
    try {
      removeAllServices();
      addService(BLE_SERVICE_UUID, true);

      // Host -> players. Notify only; players never read it directly.
      addCharacteristicToServiceBase64(
        BLE_SERVICE_UUID,
        BLE_CHAR_HOST_TX_UUID,
        CharacteristicProperties.Notify | CharacteristicProperties.Read,
        CharacteristicPermissions.Readable,
        '',
      );

      // Players -> host. Write with response so the central knows it landed.
      addCharacteristicToServiceBase64(
        BLE_SERVICE_UUID,
        BLE_CHAR_PLAYER_RX_UUID,
        CharacteristicProperties.Write | CharacteristicProperties.WriteWithoutResponse,
        CharacteristicPermissions.Writeable,
        '',
      );

      this.serviceReady = true;
    } catch (err) {
      throw new BleError(
        'could not publish the treasure hunt GATT service',
        BleErrorCode.ServiceSetupFailed,
        err,
      );
    }
  }

  async startAdvertising(gameCode: string): Promise<void> {
    const state = await this.getAdapterState();
    if (state !== BleAdapterState.PoweredOn) {
      throw new BleError(
        `cannot advertise while the adapter is ${state}`,
        state === BleAdapterState.Unauthorized
          ? BleErrorCode.PermissionDenied
          : BleErrorCode.BluetoothOff,
      );
    }

    // The native advertiser is a process-wide singleton and can survive a
    // JS-side restart, so a fresh host would otherwise be rejected with
    // "Already advertising". Clear any stale broadcast before starting.
    try {
      if (await nativeIsAdvertising()) {
        // Expected on every host start: the module begins advertising by
        // itself during start(), so this is routine, not a fault.
        log.debug('clearing the module default advertisement before ours');
        nativeStopAdvertising();
        this.advertising = false;
        await delay(150);
      }
    } catch (err) {
      log.debug('could not query advertising state', err);
    }

    await this.publishService();

    const localName = buildAdvertisedName(gameCode);
    try {
      // Android puts the adapter name in the scan record; iOS uses localName.
      setName(localName);
    } catch (err) {
      log.warn('setName failed; falling back to localName only', err);
    }

    /*
     * Do not rely on the promise returned by startAdvertising alone.
     *
     * The native module builds its AdvertiseCallback once and captures the
     * promise from the FIRST call in that closure. A later call therefore
     * resolves the stale promise and leaves the new one pending forever. The
     * module also starts advertising by itself during start(), so ours is
     * almost always the second call.
     *
     * The onDidStartAdvertising event fires correctly every time, so settle on
     * whichever arrives first and then confirm against the adapter.
     */
    const started = new Promise<void>((resolve, reject) => {
      this.advertisingWaiters.push((ok, error) => {
        if (ok) {
          resolve();
        } else {
          reject(new BleError(error ?? 'advertising failed', BleErrorCode.AdvertiseFailed));
        }
      });
    });

    const nativeCall = nativeStartAdvertising({
      localName,
      serviceUUIDs: [BLE_SERVICE_UUID],
    });

    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new BleError(
              'the adapter did not confirm advertising in time',
              BleErrorCode.Timeout,
            ),
          ),
        ADVERTISE_CONFIRM_TIMEOUT_MS,
      );
    });

    try {
      // A genuine native rejection still surfaces immediately.
      await Promise.race([started, nativeCall, timeout]);
    } catch (err) {
      throw err instanceof BleError
        ? err
        : new BleError('could not start advertising', BleErrorCode.AdvertiseFailed, err);
    }

    // Trust the adapter, not our own bookkeeping.
    let confirmed = false;
    try {
      confirmed = await nativeIsAdvertising();
    } catch {
      // If the query itself fails, fall back to the race result.
      confirmed = true;
    }

    if (!confirmed) {
      throw new BleError(
        'the adapter reported that advertising is not running',
        BleErrorCode.AdvertiseFailed,
      );
    }

    this.advertising = true;
    log.info(`advertising as "${localName}"`);
  }

  async stopAdvertising(): Promise<void> {
    // Do not gate on our own flag: the native advertiser can be running even
    // when this instance believes it is not (for example after a JS reload).
    try {
      nativeStopAdvertising();
    } catch (err) {
      log.warn('stopAdvertising threw', err);
    }
    if (this.advertising) {
      this.advertising = false;
      this.events.emit('adapterState', this.lastAdapterState);
    }
  }

  async isAdvertising(): Promise<boolean> {
    if (!this.started) {
      return false;
    }
    try {
      return await nativeIsAdvertising();
    } catch {
      return this.advertising;
    }
  }

  // -------------------------------------------------------------------------
  // Peers
  // -------------------------------------------------------------------------

  private onCentralSubscribed(centralUUID: string): void {
    if (this.links.has(centralUUID)) {
      return;
    }

    if (this.links.size >= MAX_CONCURRENT_PEERS) {
      // Accept the link but tell the game layer, which rejects the join. The
      // radio has already accepted the connection by this point -- refusing at
      // the GATT layer is not something the peripheral API exposes.
      log.warn(`central ${centralUUID} subscribed beyond the peer cap`);
    }

    const now = Date.now();
    const peer: BlePeer = {
      peerId: centralUUID,
      state: BleLinkState.Connected,
      // The peripheral API does not report the negotiated MTU, so the
      // conservative default is used. Fragmentation makes this correct, just
      // chattier than strictly necessary.
      mtu: initialAssumedMtu(),
      connectedAt: now,
      lastRxAt: now,
      lastTxAt: 0,
    };

    this.links.set(centralUUID, {peer, reassembler: new Reassembler()});
    log.info(`central ${centralUUID} subscribed (${this.links.size} connected)`);
    this.events.emit('peerConnected', {...peer});
  }

  private dropLink(peerId: string, reason: string): void {
    const link = this.links.get(peerId);
    if (!link) {
      return;
    }
    this.links.delete(peerId);
    link.reassembler.reset();
    link.peer.state = BleLinkState.Disconnected;
    log.info(`central ${peerId} gone: ${reason}`);
    this.events.emit('peerDisconnected', {peerId, reason});
  }

  private dropAllLinks(reason: string): void {
    for (const peerId of Array.from(this.links.keys())) {
      this.dropLink(peerId, reason);
    }
  }

  private onFrameReceived(peerId: string, base64Value: string): void {
    // A write can arrive before the subscribe callback on some Android stacks.
    if (!this.links.has(peerId)) {
      this.onCentralSubscribed(peerId);
    }

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
      log.warn(`dropping malformed frame from ${peerId}`, err);
    }
  }

  getPeers(): BlePeer[] {
    return Array.from(this.links.values()).map(link => ({...link.peer}));
  }

  getPeer(peerId: string): BlePeer | undefined {
    const link = this.links.get(peerId);
    return link ? {...link.peer} : undefined;
  }

  // -------------------------------------------------------------------------
  // Sending (notify) with real backpressure handling
  // -------------------------------------------------------------------------

  /**
   * Wait until the native transmit queue can accept more, or until `timeoutMs`
   * elapses. Resolving on timeout rather than rejecting is deliberate: if the
   * ready callback is missed we would rather retry the frame than wedge the
   * whole send chain.
   */
  private waitForReady(timeoutMs = 2000): Promise<void> {
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      this.readyWaiters.push(finish);
      setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Push one frame, retrying while the stack reports a full queue.
   * @param centralUUIDs undefined = every subscribed central.
   */
  private async notifyFrame(frame: Uint8Array, centralUUIDs?: string[]): Promise<void> {
    const value = bytesToBase64(frame);
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let accepted: boolean;
      try {
        accepted = await updateValueBase64(
          BLE_SERVICE_UUID,
          BLE_CHAR_HOST_TX_UUID,
          value,
          centralUUIDs,
        );
      } catch (err) {
        throw new BleError('notify failed', BleErrorCode.NotifyFailed, err);
      }

      if (accepted) {
        return;
      }

      // Queue full. Block until the stack says it has drained, then re-send
      // this exact frame -- a rejected updateValue transmitted nothing.
      log.debug(`transmit queue full, waiting (attempt ${attempt + 1})`);
      await this.waitForReady();
    }

    throw new BleError(
      'notify dropped: transmit queue stayed full',
      BleErrorCode.NotifyFailed,
    );
  }

  /** Queue work on the single global transmit chain. */
  private enqueueTx<T>(work: () => Promise<T>): Promise<T> {
    const run = this.txChain.then(work);
    this.txChain = run.catch(() => undefined);
    return run;
  }

  async send(peerId: string, payload: Uint8Array): Promise<void> {
    const link = this.links.get(peerId);
    if (!link) {
      throw new BleError(`no link for central ${peerId}`, BleErrorCode.Disconnected);
    }

    const frames = fragment(payload, payloadBytesForMtu(link.peer.mtu));

    await this.enqueueTx(async () => {
      for (const frame of frames) {
        // Still connected? A central can vanish mid-message.
        if (!this.links.has(peerId)) {
          throw new BleError(`central ${peerId} left mid-send`, BleErrorCode.Disconnected);
        }
        await this.notifyFrame(frame, [peerId]);
      }
      link.peer.lastTxAt = Date.now();
    });
  }

  async broadcast(payload: Uint8Array, excludePeerId?: string): Promise<void> {
    const targets = Array.from(this.links.keys()).filter(id => id !== excludePeerId);
    if (targets.length === 0) {
      return;
    }

    // Smallest MTU across the audience, so one encoding fits every listener.
    const mtu = targets.reduce((min, id) => {
      const peerMtu = this.links.get(id)?.peer.mtu ?? initialAssumedMtu();
      return Math.min(min, peerMtu);
    }, Number.POSITIVE_INFINITY);

    const frames = fragment(payload, payloadBytesForMtu(mtu));
    const now = Date.now();

    await this.enqueueTx(async () => {
      for (const frame of frames) {
        await this.notifyFrame(frame, targets);
      }
      for (const id of targets) {
        const link = this.links.get(id);
        if (link) {
          link.peer.lastTxAt = now;
        }
      }
    });
  }

  async shutdown(): Promise<void> {
    await this.stopAdvertising();
    this.dropAllLinks('host transport shutting down');

    try {
      removeAllServices();
    } catch (err) {
      log.warn('removeAllServices threw', err);
    }
    this.serviceReady = false;

    for (const sub of this.subs) {
      try {
        sub.remove();
      } catch {
        // Listener already detached.
      }
    }
    this.subs = [];

    // Let any in-flight notify settle before tearing the manager down.
    await Promise.race([this.txChain, delay(500)]);

    /*
     * Deliberately NOT calling nativeStop(). The manager is a process-wide
     * singleton and restarting it leaves the next start() pending forever, so
     * a second hosted game never got past the spinner. Advertising is stopped
     * and the services removed above, which is what actually needs releasing.
     */
    this.started = false;

    this.readyWaiters = [];
    this.advertisingWaiters = [];
    this.events.removeAllListeners();
  }
}
