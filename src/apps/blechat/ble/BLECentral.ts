import {
  BleManager,
  Device,
  Characteristic,
  Subscription,
  State,
  BleError,
  ScanMode,
} from 'react-native-ble-plx';
import {Platform} from 'react-native';
import {
  CONNECT_TIMEOUT_MS,
  BLE_LOCAL_NAME_PREFIX,
  BLE_MANUFACTURER_ID,
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
  DEFAULT_ATT_MTU,
  REQUESTED_MTU,
} from '../config/constants';
import type {
  BluetoothState,
  DiscoveredAdvertisement,
  GattDiagnostics,
  LinkState,
} from '../types/BLE';
import {BleLinkError, classifyBleError, isGattBusy} from './LinkErrors';
import {
  isNativeGattAvailable,
  nativeConnect,
  nativeDisconnect,
  nativeGattBus,
  nativeWrite,
} from './NativeGattClient';
import {withConnectRetry} from './ConnectRetry';
import {
  CONNECT_TEARDOWN_SETTLE_MS,
  SCAN_STARTS_PER_WINDOW,
  SCAN_START_MARGIN_MS,
  SCAN_START_WINDOW_MS,
  GATT_BUSY_MAX_RETRIES,
  GATT_BUSY_RETRY_MS,
  NOTIFY_SETTLE_MS,
  POST_CONNECT_SCAN_QUIET_MS,
} from '../config/constants';
import {base64ToBytes, bytesToHex} from '../utils/bytes';
import {
  bitmaskToInterests,
  bytesToBitmask,
  INTEREST_MASK_BYTES,
} from '../config/interests';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {
  ScanDutyCycle,
  type ScanIntensity,
  type ScanTelemetry,
} from './ScanDutyCycle';

const TAG = 'Central';

/** The platform's own words when the scan-start budget is spent. */
function isScanRateLimited(error: {message?: string} | null): boolean {
  const text = (error?.message ?? '').toLowerCase();
  return (
    text.includes('cannot start scanning') ||
    text.includes('scanning too frequently') ||
    text.includes('registration failed')
  );
}

type CentralEvents = {
  bluetoothState: BluetoothState;
  discovered: DiscoveredAdvertisement;
  /** Emitted as the connection walks the state machine, so the UI can follow along. */
  phase: {linkId: string; phase: LinkState};
  connected: {linkId: string; gatt: GattDiagnostics};
  disconnected: {linkId: string; reason: string | null};
  data: {linkId: string; base64: string};
  scanError: {message: string};
};

interface CentralLink {
  device: Device;
  rx: Characteristic;
  tx: Characteristic;
  mtu: number;
  monitor: Subscription | null;
  disconnectSub: Subscription | null;
  /**
   * Which write the REMOTE characteristic actually accepts, read from what was
   * discovered rather than assumed. Android refuses a write whose mode the
   * characteristic does not declare before it reaches the radio, and reports that as
   * "Operation was rejected" — a local refusal that looks exactly like a peer problem.
   */
  writeMode: 'withResponse' | 'withoutResponse';
}

/**
 * BLE CENTRAL role, on react-native-ble-plx.
 *
 * Scanning is filtered by our service UUID, so a device only ever appears as a peer if
 * it is genuinely advertising this application's GATT service. Nothing here fabricates
 * devices or connection state.
 */
export class BLECentral {
  readonly bus = new EventBus<CentralEvents>();

  private manager: BleManager | null = null;
  private stateSub: Subscription | null = null;
  private links = new Map<string, CentralLink>();
  /**
   * Links carried by our own Kotlin GATT client rather than by ble-plx.
   *
   * Kept apart because a native link has no ble-plx Device or Characteristic behind it —
   * the address IS the handle. Scanning still comes from ble-plx, which works.
   */
  private nativeLinks = new Map<string, {mtu: number; writeWithResponse: boolean}>();
  private nativeSubscribed = false;
  /** Attempts the user has abandoned, so the retry loop stops rather than pressing on. */
  private cancelling = new Set<string>();
  private scanning = false;
  /**
   * Links that are asking for radio silence, and the timers that end it.
   *
   * A set rather than a flag: with several peers being dialled at once, the scan must
   * stay off until the LAST of them is past its handshake, not until the first one
   * finishes.
   */
  private scanHolds = new Map<string, ReturnType<typeof setTimeout> | null>();
  /**
   * When each scan was actually started, for the last half-minute.
   *
   * Android counts starts, not scanning time, and refuses the sixth in any thirty second
   * window. Pausing for every connection spends them quickly, so they are budgeted here
   * rather than discovered by a failure.
   */
  private scanStarts: number[] = [];
  private deferredScan: ReturnType<typeof setTimeout> | null = null;
  private intensity: ScanIntensity = 'balanced';
  /**
   * Paces the radio. Without it the scan ran continuously in the most power-hungry mode
   * Android offers, for as long as the app was open.
   */
  private readonly duty = new ScanDutyCycle({
    startRadio: lowPower => this.beginRadioScan(lowPower),
    stopRadio: () => this.endRadioScan(),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: handle => clearTimeout(handle),
  });
  private currentState: BluetoothState = 'Unknown';

  get bluetoothState(): BluetoothState {
    return this.currentState;
  }

  get isScanning(): boolean {
    return this.scanning;
  }

  init(): void {
    if (this.manager) {
      return;
    }
    // On iOS this instantiation is what triggers the system Bluetooth prompt.
    this.manager = new BleManager();

    if (isNativeGattAvailable && !this.nativeSubscribed) {
      this.nativeSubscribed = true;
      nativeGattBus.on('data', ({address, base64}) => {
        this.bus.emit('data', {linkId: address, base64});
      });
      nativeGattBus.on('disconnected', ({address, status}) => {
        if (this.nativeLinks.delete(address)) {
          this.handleDisconnected(address, `remote disconnected (status ${status})`);
        }
      });
      logger.info(TAG, 'native GATT client available; links will use it');
    }

    this.stateSub = this.manager.onStateChange(state => {
      this.currentState = mapState(state);
      logger.info(TAG, `Bluetooth state: ${this.currentState}`);
      this.bus.emit('bluetoothState', this.currentState);
      if (state !== State.PoweredOn) {
        // The stack tears links down itself; make sure our bookkeeping follows.
        for (const linkId of Array.from(this.links.keys())) {
          this.handleDisconnected(linkId, 'Bluetooth turned off');
        }
        this.scanning = false;
      }
    }, true);
  }

  async refreshState(): Promise<BluetoothState> {
    if (!this.manager) {
      return 'Unknown';
    }
    const state = await this.manager.state();
    this.currentState = mapState(state);
    return this.currentState;
  }

  /** Android only. iOS deliberately offers no programmatic way to enable Bluetooth. */
  async enableBluetooth(): Promise<void> {
    if (Platform.OS !== 'android' || !this.manager) {
      throw new Error(
        'Bluetooth can only be enabled by the user from Control Centre / Settings on iOS',
      );
    }
    await this.manager.enable();
  }

  // ---- scanning ---------------------------------------------------------

  startScan(): void {
    if (!this.manager) {
      throw new Error('BLECentral.init() has not been called');
    }
    if (this.scanning) {
      return;
    }
    if (this.currentState !== 'PoweredOn') {
      throw new Error(`Cannot scan while Bluetooth is ${this.currentState}`);
    }

    // `scanning` reflects the USER'S intent — they asked to look for people, and the app
    // is doing so. It deliberately stays true through the rest periods below: an
    // indicator that blinked off every few seconds would say the app had stopped
    // looking, which is not what is happening.
    this.scanning = true;
    logger.info(TAG, `scan started (service ${BLE_SERVICE_UUID}) at ${this.intensity}`);
    this.duty.start(this.intensity);
  }

  /**
   * How hard to look. Set by the app as the user moves around: continuous while the
   * Nearby screen is open, paced otherwise, paced hard in the background.
   */
  setScanIntensity(intensity: ScanIntensity): void {
    this.intensity = intensity;
    if (this.scanning) {
      this.duty.setIntensity(intensity);
      logger.info(TAG, `scan intensity now ${intensity}`);
    }
  }

  /** Diagnostics: whether the radio is mid-burst, as opposed to resting between them. */
  get isRadioBursting(): boolean {
    return this.duty.isBursting;
  }

  /** What the radio has actually been doing — the evidence a battery test needs. */
  scanTelemetry(): ScanTelemetry {
    return this.duty.telemetry();
  }

  /** How long until Android would accept another scan start, 0 when one is free. */
  private msUntilScanAllowed(): number {
    const now = Date.now();
    this.scanStarts = this.scanStarts.filter(t => now - t < SCAN_START_WINDOW_MS);
    if (this.scanStarts.length < SCAN_STARTS_PER_WINDOW) {
      return 0;
    }
    const oldest = this.scanStarts[0];
    return SCAN_START_WINDOW_MS - (now - oldest) + SCAN_START_MARGIN_MS;
  }

  /** One burst of real scanning. Driven by the duty cycler, never called directly. */
  private beginRadioScan(lowPower: boolean): void {
    if (!this.manager) {
      return;
    }
    // Spend a start only if the platform will accept one; otherwise wait for the window
    // to roll rather than burning the attempt on a refusal.
    const wait = this.msUntilScanAllowed();
    if (wait > 0) {
      if (this.deferredScan) {
        return;
      }
      logger.info(TAG, `scan start budget spent; waiting ${wait}ms for the window`);
      this.deferredScan = setTimeout(() => {
        this.deferredScan = null;
        if (this.scanning) {
          this.beginRadioScan(lowPower);
        }
      }, wait);
      return;
    }
    this.scanStarts.push(Date.now());
    this.manager.startDeviceScan(
      // Unfiltered: the Nearby screen lists every BLE device in range, not only chat
      // peers. Chat peers are identified by parseAdvertisement instead, which checks for
      // this application's service UUID — so a non-peer can still never be treated as one.
      null,
      {
        allowDuplicates: true,
        scanMode: lowPower ? ScanMode.LowPower : ScanMode.LowLatency,
      },
      (error, device) => {
        if (error) {
          /**
           * Being rate-limited is not a broken radio.
           *
           * Tearing the whole cycle down here left the app not scanning until the user
           * went and asked again, for a condition that clears itself in seconds. The
           * budget above should prevent this, but the count is per app and survives a
           * restart, so it can still be met on the way in — and the right answer is to
           * wait, not to stop.
           */
          if (isScanRateLimited(error)) {
            logger.warn(TAG, 'scan refused: too many starts recently, waiting it out');
            // Treat the window as full, so the next start is deferred rather than tried.
            const now = Date.now();
            this.scanStarts = Array.from(
              {length: SCAN_STARTS_PER_WINDOW},
              (_, i) => now - i,
            );
            this.beginRadioScan(lowPower);
            return;
          }
          // Any other scan error ends the cycle: continuing to pace a radio that is
          // refusing to scan would hide the failure behind the rest periods.
          this.scanning = false;
          this.duty.stop();
          logger.error(TAG, `scan error: ${error.message}`);
          this.bus.emit('scanError', {message: error.message});
          return;
        }
        if (!device) {
          return;
        }
        this.bus.emit('discovered', parseAdvertisement(device));
      },
    );
  }

  private endRadioScan(): void {
    this.manager?.stopDeviceScan();
  }

  stopScan(): void {
    if (!this.manager || !this.scanning) {
      return;
    }
    this.duty.stop();
    this.scanning = false;
    logger.info(TAG, 'scan stopped');
  }

  // ---- connection -------------------------------------------------------

  /**
   * Full central-side bring-up: connect, negotiate MTU, discover GATT, locate our
   * service and both characteristics, subscribe to notifications.
   * Every step can fail for real reasons and none of them are skipped.
   */
  /**
   * Connect, retrying the failures that are worth retrying.
   *
   * Android's stack fails connectGatt with status 133 routinely — a stale GATT cache, a
   * reconnect issued before the last teardown finished, too many concurrent links — and
   * it is transient nearly every time. Reporting the first failure as final would tell
   * the user a peer sitting a metre away is unreachable. The retry policy itself lives in
   * ConnectRetry so it can be tested without a Bluetooth stack.
   */
  async connect(linkId: string): Promise<GattDiagnostics> {
    if (!this.manager) {
      throw new Error('BLECentral.init() has not been called');
    }
    if (this.links.has(linkId)) {
      throw new Error(`Already connected to ${linkId}`);
    }

    // A scan running during connection makes GATT operations flaky on many Android
    // stacks, so pause it for the duration — and for the handshake immediately after,
    // which is the write that was being refused. See holdScan.
    const wasScanning = this.scanning;
    this.holdScan(linkId);
    if (wasScanning) {
      this.stopScan();
    }

    try {
      return await withConnectRetry({
        label: linkId,
        // Checked between attempts: a cancel that lands mid-connect should stop the next
        // one rather than being noticed only after the whole budget is spent.
        shouldAbort: () => this.cancelling.has(linkId),
        attempt: attempt => this.attemptConnect(linkId, attempt),
        // A half-open GATT client still counts against Android's connection limit, so
        // leaving one behind makes the next attempt fail exactly the same way.
        cleanup: async () => {
          try {
            await this.manager?.cancelDeviceConnection(linkId);
          } catch {
            // Nothing left to cancel.
          }
          await delay(CONNECT_TEARDOWN_SETTLE_MS);
        },
        sleep: delay,
      });
    } catch (err) {
      // Only now is the failure final, so this is the only place the UI is told.
      this.bus.emit('phase', {linkId, phase: 'failed'});
      try {
        await this.manager.cancelDeviceConnection(linkId);
      } catch {
        // Already gone — nothing to clean up.
      }
      throw err;
    } finally {
      this.cancelling.delete(linkId);
      // NOT resumed here. The link is up but the handshake has not happened yet, and
      // restarting the scan across it is what made the first write fail.
      this.scheduleScanRelease(linkId, wasScanning);
    }
  }

  /** Ask for radio silence on this link's behalf. */
  private holdScan(linkId: string): void {
    const existing = this.scanHolds.get(linkId);
    if (existing) {
      clearTimeout(existing);
    }
    // No timer yet — the hold lasts until the connect settles and schedules its end.
    this.scanHolds.set(linkId, null);
  }

  /**
   * End the silence once the handshake has had its moment.
   *
   * Bounded by a timer rather than waiting for the handshake to report back, so this
   * layer needs to know nothing about handshakes — and so a peer that never answers
   * cannot leave scanning switched off for good.
   */
  private scheduleScanRelease(linkId: string, resume: boolean): void {
    const existing = this.scanHolds.get(linkId);
    if (existing) {
      clearTimeout(existing);
    }
    this.scanHolds.set(
      linkId,
      setTimeout(() => this.releaseScan(linkId, resume), POST_CONNECT_SCAN_QUIET_MS),
    );
  }

  /** Drop this link's claim on the radio, and scan again if nothing else holds it. */
  releaseScan(linkId: string, resume = true): void {
    const timer = this.scanHolds.get(linkId);
    if (timer) {
      clearTimeout(timer);
    }
    this.scanHolds.delete(linkId);
    if (!resume || this.scanHolds.size > 0 || this.scanning) {
      return;
    }
    if (this.currentState !== 'PoweredOn') {
      return;
    }
    try {
      this.startScan();
    } catch {
      // Scanning is best-effort here; the connection is what matters.
    }
  }

  /**
   * Abandon an in-flight connection attempt.
   *
   * Cancelling the GATT operation is what makes the pending connect reject; the flag is
   * what stops that rejection being read as a transient failure worth retrying.
   */
  async cancelConnect(linkId: string): Promise<void> {
    this.cancelling.add(linkId);
    logger.info(TAG, `${linkId}: connection cancelled by the user`);
    try {
      await this.manager?.cancelDeviceConnection(linkId);
    } catch {
      // Nothing in flight to cancel.
    }
  }

  /** One full connection attempt: connect, discover, negotiate, subscribe. */
  private async attemptConnect(
    linkId: string,
    attempt: number,
  ): Promise<GattDiagnostics> {
    if (!this.manager) {
      throw new Error('BLECentral.init() has not been called');
    }

    const gatt: GattDiagnostics = {
      serviceFound: false,
      rxCharacteristicFound: false,
      txCharacteristicFound: false,
      notificationsEnabled: false,
      mtu: DEFAULT_ATT_MTU,
    };

    // Tracks which stage we are in, so a throw from anywhere is attributed correctly.
    let phase: LinkState = 'connecting';
    const enter = (next: LinkState) => {
      phase = next;
      this.bus.emit('phase', {linkId, phase: next});
      logger.info(TAG, `${linkId}: ${next}`);
    };

    if (isNativeGattAvailable) {
      /**
       * Our own client owns this link.
       *
       * It reaches the same place — connected, services discovered, MTU settled,
       * notifications subscribed — and reports the framework's real status when
       * something is refused, which the library's pre-Android-13 call cannot.
       */
      try {
        enter('connecting');
        const link = await nativeConnect(linkId);
        enter('discoveringServices');
        gatt.serviceFound = true;
        gatt.rxCharacteristicFound = true;
        gatt.txCharacteristicFound = true;
        enter('negotiatingMtu');
        gatt.mtu = link.mtu;
        logger.info(TAG, `${linkId}: negotiated MTU ${gatt.mtu}`);
        enter('enablingNotifications');
        gatt.notificationsEnabled = true;
        // Bit 0x08 is WRITE, 0x04 is WRITE_NO_RESPONSE, as the framework reports them.
        const writeWithResponse = (link.rxProperties & 0x08) !== 0;
        this.nativeLinks.set(linkId, {mtu: link.mtu, writeWithResponse});
        logger.info(
          TAG,
          `${linkId}: ready via the native client ` +
            `(write ${writeWithResponse ? 'with' : 'without'} response)`,
        );
        this.bus.emit('connected', {linkId, gatt});
        return gatt;
      } catch (err) {
        const linkError = classifyBleError(err, phase);
        logger.error(TAG, `${linkId}: native attempt ${attempt} failed — ${linkError.message}`);
        await nativeDisconnect(linkId);
        throw linkError;
      }
    }

    try {
      enter('connecting');
      let device = await this.manager.connectToDevice(linkId, {
        // Android negotiates the MTU as part of connect; iOS reports what it chose.
        requestMTU: Platform.OS === 'android' ? REQUESTED_MTU : undefined,
        timeout: CONNECT_TIMEOUT_MS,
      });

      enter('discoveringServices');
      device = await device.discoverAllServicesAndCharacteristics();

      enter('negotiatingMtu');
      gatt.mtu = device.mtu ?? DEFAULT_ATT_MTU;
      if (gatt.mtu <= DEFAULT_ATT_MTU) {
        // Not fatal: 20 usable bytes per write still works, fragmentation just does more
        // of the lifting. Worth surfacing because it makes large messages much slower.
        logger.warn(
          TAG,
          `${linkId}: MTU stayed at ${gatt.mtu}; large messages will be slow`,
        );
      } else {
        logger.info(TAG, `${linkId}: negotiated MTU ${gatt.mtu}`);
      }

      const services = await device.services();
      const service = services.find(
        s => s.uuid.toLowerCase() === BLE_SERVICE_UUID.toLowerCase(),
      );
      if (!service) {
        throw new BleLinkError(
          'ServiceNotFound',
          'discoveringServices',
          `Device ${linkId} does not expose the chat service ${BLE_SERVICE_UUID}`,
        );
      }
      gatt.serviceFound = true;

      const characteristics = await service.characteristics();
      const rx = characteristics.find(
        c => c.uuid.toLowerCase() === BLE_RX_CHAR_UUID.toLowerCase(),
      );
      const tx = characteristics.find(
        c => c.uuid.toLowerCase() === BLE_TX_CHAR_UUID.toLowerCase(),
      );

      if (!rx) {
        throw new BleLinkError(
          'CharacteristicNotFound',
          'discoveringServices',
          `RX characteristic ${BLE_RX_CHAR_UUID} missing on remote service`,
        );
      }
      gatt.rxCharacteristicFound = true;

      if (!tx) {
        throw new BleLinkError(
          'CharacteristicNotFound',
          'discoveringServices',
          `TX characteristic ${BLE_TX_CHAR_UUID} missing on remote service`,
        );
      }
      gatt.txCharacteristicFound = true;
      const writeMode: 'withResponse' | 'withoutResponse' = rx.isWritableWithResponse
        ? 'withResponse'
        : 'withoutResponse';
      logger.info(
        TAG,
        `${linkId}: RX and TX characteristics found ` +
          `(rx write: response=${rx.isWritableWithResponse} ` +
          `noResponse=${rx.isWritableWithoutResponse}, using ${writeMode}; ` +
          `tx notify=${tx.isNotifiable})`,
      );
      if (!rx.isWritableWithResponse && !rx.isWritableWithoutResponse) {
        throw new BleLinkError(
          'CharacteristicNotFound',
          'discoveringServices',
          'The RX characteristic on the peer accepts no writes at all',
        );
      }

      enter('enablingNotifications');

      const link: CentralLink = {
        device,
        rx,
        tx,
        mtu: gatt.mtu,
        monitor: null,
        disconnectSub: null,
        writeMode,
      };

      // Subscribing writes the CCCD on the remote peripheral, which is what makes the
      // remote side able to push data to us.
      link.monitor = tx.monitor((error, characteristic) => {
        if (error) {
          if (!isDisconnectError(error)) {
            logger.error(TAG, `notification error on ${linkId}: ${error.message}`);
          }
          return;
        }
        if (characteristic?.value) {
          this.bus.emit('data', {linkId, base64: characteristic.value});
        }
      });
      /**
       * Let the subscription settle before anything writes.
       *
       * `monitor()` writes the CCCD, and Android clears its one-operation-at-a-time
       * busy flag from that write's completion callback. The handshake's first write
       * landed in the same millisecond and was refused outright — start failure, zero
       * milliseconds, no radio traffic. A pause here costs a fraction of a second once
       * per connection and removes a failure that happened every single time.
       */
      await delay(NOTIFY_SETTLE_MS);
      gatt.notificationsEnabled = true;
      logger.info(TAG, `${linkId}: notifications enabled`);

      link.disconnectSub = device.onDisconnected((error, d) => {
        this.handleDisconnected(
          d?.id ?? linkId,
          error ? error.message : 'remote disconnected',
        );
      });

      this.links.set(linkId, link);
      this.bus.emit('connected', {linkId, gatt});
      if (attempt > 1) {
        logger.info(TAG, `${linkId}: connected on attempt ${attempt}`);
      }
      return gatt;
    } catch (err) {
      const linkError = classifyBleError(err, phase);
      logger.error(
        TAG,
        `${linkId}: attempt ${attempt} failed during ${linkError.phase} — ` +
          `${linkError.reason}: ${linkError.message}`,
      );
      // Thrown classified but NOT reported as final: connect() decides whether another
      // attempt follows, and emitting 'failed' here would flash an error for a link that
      // is about to succeed.
      throw linkError;
    }
  }

  async disconnect(linkId: string): Promise<void> {
    if (this.nativeLinks.delete(linkId)) {
      await nativeDisconnect(linkId);
      this.handleDisconnected(linkId, 'local disconnect');
      return;
    }
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    link.monitor?.remove();
    link.disconnectSub?.remove();
    this.links.delete(linkId);
    try {
      await this.manager?.cancelDeviceConnection(linkId);
    } catch (err) {
      logger.warn(TAG, `cancelDeviceConnection(${linkId}): ${describeError(err)}`);
    }
    this.bus.emit('disconnected', {linkId, reason: 'local disconnect'});
  }

  private handleDisconnected(linkId: string, reason: string | null): void {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    link.monitor?.remove();
    link.disconnectSub?.remove();
    this.links.delete(linkId);
    logger.warn(TAG, `link ${linkId} down: ${reason ?? 'unknown'}`);
    this.bus.emit('disconnected', {linkId, reason});
  }

  // ---- io ---------------------------------------------------------------

  /** Write one MTU-sized frame to the remote RX characteristic. */
  async sendFrame(linkId: string, base64: string): Promise<void> {
    const nativeLink = this.nativeLinks.get(linkId);
    if (nativeLink) {
      // The native side serialises operations itself and rejects with the framework's
      // own status, so there is nothing to re-offer or reinterpret here.
      await nativeWrite(linkId, base64, nativeLink.writeWithResponse);
      return;
    }

    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`No central link ${linkId}`);
    }
    /**
     * Re-offer a write the GATT client refused to start.
     *
     * Not a retry of a failed transmission — the radio never saw it. Android rejects an
     * operation issued while its client is still busy with the previous one, and clears
     * that flag from the previous operation's completion callback, so back-to-back
     * writes race it by a millisecond. Fragments of one message go out back to back,
     * which is exactly the pattern that hits it.
     *
     * Anything that is NOT that condition is thrown on untouched, so a real failure
     * still reads as a real failure.
     */
    for (let attempt = 0; ; attempt++) {
      try {
        // Write-with-response gives per-frame flow control from the peripheral, which
        // keeps fragment ordering intact. Write-without-response is faster but can
        // outrun the remote stack and silently drop frames — so it is used only when
        // the remote characteristic does not accept the safer one.
        if (link.writeMode === 'withResponse') {
          await link.rx.writeWithResponse(base64);
        } else {
          await link.rx.writeWithoutResponse(base64);
        }
        return;
      } catch (err) {
        if (!isGattBusy(err) || attempt >= GATT_BUSY_MAX_RETRIES) {
          throw err;
        }
        // Still connected? A busy client on a link that has since dropped is a
        // disconnect, and waiting on it would only delay the real answer.
        if (!this.links.has(linkId)) {
          throw err;
        }
        const wait = GATT_BUSY_RETRY_MS * (attempt + 1);
        logger.debug(
          TAG,
          `${linkId}: write refused as busy, re-offering in ${wait}ms ` +
            `(attempt ${attempt + 1}/${GATT_BUSY_MAX_RETRIES})`,
        );
        await delay(wait);
      }
    }
  }

  async readRssi(linkId: string): Promise<number | null> {
    const link = this.links.get(linkId);
    if (!link) {
      return null;
    }
    try {
      const updated = await link.device.readRSSI();
      return updated.rssi ?? null;
    } catch {
      return null;
    }
  }

  getMtu(linkId: string): number {
    return (
      this.nativeLinks.get(linkId)?.mtu ??
      this.links.get(linkId)?.mtu ??
      DEFAULT_ATT_MTU
    );
  }

  isConnected(linkId: string): boolean {
    return this.links.has(linkId);
  }

  get linkIds(): string[] {
    return Array.from(this.links.keys());
  }

  async destroy(): Promise<void> {
    this.stopScan();
    for (const linkId of Array.from(this.links.keys())) {
      await this.disconnect(linkId);
    }
    this.stateSub?.remove();
    this.stateSub = null;
    this.manager?.destroy();
    this.manager = null;
  }
}

// ---- helpers ------------------------------------------------------------

function mapState(state: State): BluetoothState {
  switch (state) {
    case State.PoweredOn:
      return 'PoweredOn';
    case State.PoweredOff:
      return 'PoweredOff';
    case State.Unauthorized:
      return 'Unauthorized';
    case State.Unsupported:
      return 'Unsupported';
    case State.Resetting:
      return 'Resetting';
    default:
      return 'Unknown';
  }
}

/**
 * Pull whatever identity the advertisement carries.
 *
 * Android peers put a version byte + 8 peer-id bytes + a name in manufacturer-specific
 * data. iOS cannot set manufacturer data at all, so iOS peers encode the peer-id prefix
 * in the local name as "BC-<hex>". Both are handled; neither is required, because the
 * authoritative identity always comes from the HELLO handshake after connecting.
 */
/**
 * Manufacturer payload layout.
 *
 *   v1   version | peer-id prefix (8) | name
 *   v2   version | peer-id prefix (8) | interest bitmask (3, LE) | name
 *
 * v1 is still read: an older phone in the room should still appear as a peer, it simply
 * has no interests to show until it connects.
 */
const ADV_PREFIX_BYTES = 8;

export function parseAdvertisement(device: Device): DiscoveredAdvertisement {
  let peerIdPrefix: string | null = null;
  let advertisedName: string | null = null;
  let advertisedInterests: string[] = [];

  if (device.manufacturerData) {
    try {
      const bytes = base64ToBytes(device.manufacturerData);
      // ble-plx hands back the raw AD payload including the 2-byte little-endian
      // company identifier.
      if (bytes.length >= 3) {
        const companyId = bytes[0] | (bytes[1] << 8);
        if (companyId === BLE_MANUFACTURER_ID) {
          const body = bytes.subarray(2);
          const version = body[0];
          const nameAt =
            1 +
            ADV_PREFIX_BYTES +
            (version >= 2 ? INTEREST_MASK_BYTES : 0);

          if (body.length >= 1 + ADV_PREFIX_BYTES && version >= 1) {
            peerIdPrefix = bytesToHex(body.subarray(1, 1 + ADV_PREFIX_BYTES));

            if (version >= 2 && body.length >= nameAt) {
              advertisedInterests = bitmaskToInterests(
                bytesToBitmask(
                  body.subarray(1 + ADV_PREFIX_BYTES, nameAt),
                ),
              );
            }
            if (body.length > nameAt) {
              advertisedName = decodeAscii(body.subarray(nameAt));
            }
          }
        }
      }
    } catch {
      // A malformed advertisement is not fatal; identity still arrives via HELLO.
    }
  }

  const localName = device.localName ?? device.name ?? null;
  if (!peerIdPrefix && localName?.startsWith(BLE_LOCAL_NAME_PREFIX)) {
    // iOS cannot advertise manufacturer data at all, so everything it can say has to fit
    // in the local name: 16 hex of peer-id prefix, optionally followed by 6 hex of
    // interest bitmask.
    const candidate = localName.slice(BLE_LOCAL_NAME_PREFIX.length);
    const match = /^([0-9a-fA-F]{16})([0-9a-fA-F]{6})?$/.exec(candidate);
    if (match) {
      peerIdPrefix = match[1].toLowerCase();
      if (match[2]) {
        advertisedInterests = bitmaskToInterests(parseInt(match[2], 16));
      }
    }
  }

  const serviceUuids = (device.serviceUUIDs ?? []).map(u => u.toLowerCase());

  return {
    linkId: device.id,
    deviceName: device.name ?? null,
    advertisedName: advertisedName ?? localName,
    peerIdPrefix,
    advertisedInterests,
    rssi: device.rssi ?? null,
    timestamp: Date.now(),
    // The single test that decides whether this is one of ours.
    isChatPeer: serviceUuids.includes(BLE_SERVICE_UUID.toLowerCase()),
    isConnectable: device.isConnectable ?? null,
    serviceUuids,
  };
}

function decodeAscii(bytes: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      break;
    }
    out += String.fromCharCode(bytes[i]);
  }
  return out.length > 0 ? out : null;
}

function isDisconnectError(error: BleError): boolean {
  const m = error.message?.toLowerCase() ?? '';
  return m.includes('disconnect') || m.includes('cancelled');
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Promise-based sleep, so the retry policy stays free of timer plumbing. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
