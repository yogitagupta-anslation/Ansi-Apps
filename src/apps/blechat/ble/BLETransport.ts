import {
  DEFAULT_ATT_MTU,
  PEER_STALE_MS,
} from '../config/constants';
import {FragmentedLink} from '../messaging/FragmentedLink';
import {NACK_QUIET_MS} from '../config/constants';
import type {ScanIntensity, ScanTelemetry} from './ScanDutyCycle';
import type {
  DiscoveredAdvertisement,
  GattDiagnostics,
  LinkId,
  LinkRole,
  BluetoothState,
} from '../types/BLE';
import type {
  ITransport,
  PeerLinkTransport,
  TransportDataEvent,
  TransportDiscoveredEvent,
  TransportLinkDownEvent,
  TransportLinkEvent,
  TransportPhaseEvent,
} from '../types/Transport';
import {bytesToBase64, base64ToBytes} from '../utils/bytes';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {BLECentral, describeError} from './BLECentral';
import {
  isCentralLink,
  stripPrefix,
  toCentralLinkId,
  toPeripheralLinkId,
} from '../utils/linkId';
import {blePeripheral} from './BlePeripheralBridge';

const TAG = 'Transport';

// Link addressing lives in utils/linkId so peers/ and messaging/ can use it without
// importing the BLE layer. Re-exported here for callers already reaching for it.
export {
  isCentralLink,
  toCentralLinkId,
  toPeripheralLinkId,
  stripPrefix,
} from '../utils/linkId';

export type TransportEvents = {
  linkUp: TransportLinkEvent;
  linkDown: TransportLinkEvent & {reason: string | null};
  data: TransportDataEvent;
  /** Chat peers only. Feeds PeerManager. */
  discovered: DiscoveredAdvertisement & {linkId: LinkId};
  /** Every BLE device seen, chat peer or not. Feeds the Nearby list. */
  deviceSeen: DiscoveredAdvertisement & {linkId: LinkId};
  linkPhase: TransportPhaseEvent;
  bluetoothState: BluetoothState;
  scanError: {message: string};
  peripheralError: {message: string};
  txFrame: {linkId: LinkId; bytes: number};
  rxFrame: {linkId: LinkId; bytes: number};
};

interface LinkRecord {
  role: LinkRole;
  /** Fragmentation, reassembly and selective retransmission for this link. */
  fragmenter: FragmentedLink;
  gatt: GattDiagnostics | null;
}

/**
 * The one BLE surface the rest of the app talks to.
 *
 * It hides the fact that a peer can be reached either because we connected to it
 * (central) or because it connected to us (peripheral). Above this class, a link is just
 * a bidirectional byte pipe; fragmentation and reassembly happen here so both roles share
 * exactly one implementation.
 */
export class BLETransport implements ITransport, PeerLinkTransport {
  readonly name = 'ble';
  readonly bus = new EventBus<TransportEvents>();

  private central = new BLECentral();
  private links = new Map<LinkId, LinkRecord>();
  private discovered = new Map<LinkId, DiscoveredAdvertisement>();
  private running = false;
  /** Drives the retransmission requests for every open link. */
  private arqTimer: ReturnType<typeof setInterval> | null = null;
  private peripheralActive = false;
  private unsubscribers: Array<() => void> = [];

  get bluetoothState(): BluetoothState {
    return this.central.bluetoothState;
  }

  /** How hard to scan. See ScanDutyCycle — the radio is paced, not run flat out. */
  setScanIntensity(intensity: ScanIntensity): void {
    this.central.setScanIntensity(intensity);
  }

  scanTelemetry(): ScanTelemetry {
    return this.central.scanTelemetry();
  }

  get isScanning(): boolean {
    return this.central.isScanning;
  }

  get isAdvertising(): boolean {
    return this.peripheralActive;
  }

  get centralApi(): BLECentral {
    return this.central;
  }

  // ---- lifecycle --------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.central.init();
    this.wireCentral();
    this.wirePeripheral();

    // One timer for all links: each asks for anything still missing once its inbound
    // streams have gone quiet.
    this.arqTimer = setInterval(() => {
      for (const link of this.links.values()) {
        link.fragmenter.requestMissing();
      }
    }, NACK_QUIET_MS);
  }

  /**
   * Bring up the peripheral role. Separate from start() because it needs the local
   * identity, and because it can legitimately fail on hardware without an advertiser
   * while the central role keeps working.
   */
  async startPeripheral(
    peerIdPrefix: string,
    displayName: string,
    interestMask = 0,
  ): Promise<void> {
    try {
      await blePeripheral.start(peerIdPrefix, displayName, interestMask);
      this.peripheralActive = true;
      logger.info(TAG, 'peripheral role active');
    } catch (err) {
      this.peripheralActive = false;
      const message = describeError(err);
      logger.error(TAG, `peripheral role unavailable: ${message}`);
      this.bus.emit('peripheralError', {message});
      throw err;
    }
  }

  /** Abandon an in-flight dial. Only the central role can be mid-connect. */
  async cancelConnect(linkId: LinkId): Promise<void> {
    await this.central.cancelConnect(linkId);
  }

  async stopPeripheral(): Promise<void> {
    await blePeripheral.stop();
    this.peripheralActive = false;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.arqTimer) {
      clearInterval(this.arqTimer);
      this.arqTimer = null;
    }
    for (const un of this.unsubscribers) {
      un();
    }
    this.unsubscribers = [];
    await this.stopPeripheral();
    await this.central.destroy();
    this.links.clear();
    this.discovered.clear();
  }

  // ---- scanning ---------------------------------------------------------

  async startScanning(): Promise<void> {
    this.central.startScan();
  }

  async stopScanning(): Promise<void> {
    this.central.stopScan();
  }

  getDiscovered(): Array<DiscoveredAdvertisement & {linkId: LinkId}> {
    const now = Date.now();
    const out: Array<DiscoveredAdvertisement & {linkId: LinkId}> = [];
    for (const [linkId, adv] of this.discovered) {
      if (now - adv.timestamp > PEER_STALE_MS && !this.links.has(linkId)) {
        this.discovered.delete(linkId);
        continue;
      }
      out.push({...adv, linkId});
    }
    return out;
  }

  // ---- connection -------------------------------------------------------

  async connect(linkId: LinkId): Promise<LinkId> {
    if (!isCentralLink(linkId)) {
      throw new Error(
        'Only central links can be dialled. A peripheral link is created by the remote peer.',
      );
    }
    if (this.links.has(linkId)) {
      return linkId;
    }
    await this.central.connect(stripPrefix(linkId));
    return linkId;
  }

  async disconnect(linkId: LinkId): Promise<void> {
    if (isCentralLink(linkId)) {
      await this.central.disconnect(stripPrefix(linkId));
    } else {
      // A peripheral cannot force a central to go away; the remote owns that link.
      // Drop our local state so nothing is sent to it any more.
      this.teardownLink(linkId, 'local drop');
    }
  }

  // ---- io ---------------------------------------------------------------

  /**
   * Fragment `data` to the negotiated MTU and push every frame in order.
   * Resolves only once the last frame has actually been handed to the BLE stack,
   * so callers can treat a resolved promise as a real transmission.
   */
  async send(
    linkId: LinkId,
    data: Uint8Array,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`No link ${linkId}`);
    }
    await link.fragmenter.send(data, onProgress);
  }

  /** Push one already-framed chunk onto the correct BLE role. */
  private async writeFrame(linkId: LinkId, frame: Uint8Array): Promise<void> {
    const b64 = bytesToBase64(frame);
    if (isCentralLink(linkId)) {
      await this.central.sendFrame(stripPrefix(linkId), b64);
    } else {
      await blePeripheral.sendFrame(stripPrefix(linkId), b64);
    }
    this.bus.emit('txFrame', {linkId, bytes: frame.length});
  }

  getMtu(linkId: LinkId): number {
    if (isCentralLink(linkId)) {
      return this.central.getMtu(stripPrefix(linkId));
    }
    return blePeripheral.getMtu(stripPrefix(linkId)) ?? DEFAULT_ATT_MTU;
  }

  getGatt(linkId: LinkId): GattDiagnostics | null {
    return this.links.get(linkId)?.gatt ?? null;
  }

  get linkIds(): LinkId[] {
    return Array.from(this.links.keys());
  }

  getRole(linkId: LinkId): LinkRole | null {
    return this.links.get(linkId)?.role ?? null;
  }

  async readRssi(linkId: LinkId): Promise<number | null> {
    if (!isCentralLink(linkId)) {
      // A peripheral has no API to read the RSSI of a connected central on either OS.
      return null;
    }
    return this.central.readRssi(stripPrefix(linkId));
  }

  // ---- ITransport event adapters ----------------------------------------

  onLinkUp(cb: (e: TransportLinkEvent) => void): () => void {
    return this.bus.on('linkUp', cb);
  }
  onLinkDown(cb: (e: TransportLinkDownEvent) => void): () => void {
    return this.bus.on('linkDown', cb);
  }
  onData(cb: (e: TransportDataEvent) => void): () => void {
    return this.bus.on('data', cb);
  }
  onDiscovered(cb: (e: TransportDiscoveredEvent) => void): () => void {
    return this.bus.on('discovered', cb);
  }
  onLinkPhase(cb: (e: TransportPhaseEvent) => void): () => void {
    return this.bus.on('linkPhase', cb);
  }

  // ---- internals --------------------------------------------------------

  private wireCentral(): void {
    this.unsubscribers.push(
      this.central.bus.on('bluetoothState', state => {
        this.bus.emit('bluetoothState', state);
      }),

      this.central.bus.on('scanError', e => {
        this.bus.emit('scanError', e);
      }),

      this.central.bus.on('discovered', adv => {
        const linkId = toCentralLinkId(adv.linkId);
        const previous = this.discovered.get(linkId);
        this.discovered.set(linkId, {...adv, linkId});

        // Everything goes to the device list; only chat peers continue to PeerManager.
        this.bus.emit('deviceSeen', {...adv, linkId});
        if (!adv.isChatPeer) {
          return;
        }
        // Only announce genuinely new devices loudly; RSSI refreshes are frequent.
        if (!previous) {
          logger.info(
            TAG,
            `discovered ${adv.advertisedName ?? adv.deviceName ?? linkId}` +
              (adv.peerIdPrefix ? ` peer=${adv.peerIdPrefix.slice(0, 8)}` : '') +
              ` rssi=${adv.rssi ?? '?'}`,
          );
        }
        this.bus.emit('discovered', {...adv, linkId});
      }),

      this.central.bus.on('phase', ({linkId, phase}) => {
        this.bus.emit('linkPhase', {linkId: toCentralLinkId(linkId), phase});
      }),

      this.central.bus.on('connected', ({linkId, gatt}) => {
        const id = toCentralLinkId(linkId);
        this.registerLink(id, 'central', gatt);
      }),

      this.central.bus.on('disconnected', ({linkId, reason}) => {
        this.teardownLink(toCentralLinkId(linkId), reason);
      }),

      this.central.bus.on('data', ({linkId, base64}) => {
        this.handleFrame(toCentralLinkId(linkId), base64);
      }),
    );
  }

  private wirePeripheral(): void {
    this.unsubscribers.push(
      blePeripheral.bus.on('subscription', ({centralId, enabled}) => {
        const linkId = toPeripheralLinkId(centralId);
        if (enabled) {
          // Only once notifications are on can we actually push data back, so this —
          // not the raw connection — is when a peripheral link becomes usable.
          this.registerLink(linkId, 'peripheral', {
            serviceFound: true,
            rxCharacteristicFound: true,
            txCharacteristicFound: true,
            notificationsEnabled: true,
            mtu: blePeripheral.getMtu(centralId) ?? DEFAULT_ATT_MTU,
          });
        } else {
          this.teardownLink(linkId, 'central unsubscribed');
        }
      }),

      blePeripheral.bus.on('centralDisconnected', ({centralId}) => {
        this.teardownLink(toPeripheralLinkId(centralId), 'central disconnected');
      }),

      blePeripheral.bus.on('data', ({centralId, data}) => {
        this.handleFrame(toPeripheralLinkId(centralId), data);
      }),

      blePeripheral.bus.on('mtu', ({centralId, mtu}) => {
        const link = this.links.get(toPeripheralLinkId(centralId));
        if (link?.gatt) {
          link.gatt.mtu = mtu;
        }
      }),

      blePeripheral.bus.on('state', ({advertising}) => {
        this.peripheralActive = advertising;
      }),

      blePeripheral.bus.on('error', e => {
        this.bus.emit('peripheralError', e);
      }),
    );
  }

  private registerLink(
    linkId: LinkId,
    role: LinkRole,
    gatt: GattDiagnostics,
  ): void {
    if (this.links.has(linkId)) {
      return;
    }
    this.links.set(linkId, {
      role,
      fragmenter: new FragmentedLink(linkId, {
        sendFrame: frame => this.writeFrame(linkId, frame),
        currentMtu: () => this.getMtu(linkId),
      }),
      gatt,
    });
    logger.info(TAG, `link up ${linkId} (${role}, MTU ${gatt.mtu})`);
    this.bus.emit('linkUp', {linkId, role});
  }

  private teardownLink(linkId: LinkId, reason: string | null): void {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    link.fragmenter.reset();
    this.links.delete(linkId);
    logger.info(TAG, `link down ${linkId}: ${reason ?? 'unknown'}`);
    this.bus.emit('linkDown', {linkId, role: link.role, reason});
  }

  private handleFrame(linkId: LinkId, base64: string): void {
    const link = this.links.get(linkId);
    if (!link) {
      // Data before the link is registered (a race on the subscription event).
      logger.warn(TAG, `frame for unknown link ${linkId}, dropped`);
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(base64);
    } catch (err) {
      logger.warn(TAG, `undecodable frame on ${linkId}: ${describeError(err)}`);
      return;
    }
    this.bus.emit('rxFrame', {linkId, bytes: bytes.length});

    // Control frames (NACKs) are absorbed here and never surface as application data.
    const complete = link.fragmenter.receive(bytes);
    if (complete) {
      this.bus.emit('data', {linkId, data: complete});
    }
  }
}
