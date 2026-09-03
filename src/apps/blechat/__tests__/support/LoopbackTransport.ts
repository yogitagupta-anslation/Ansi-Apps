import {BLE_SERVICE_UUID, DEFAULT_ATT_MTU} from '../../config/constants';
import {bitmaskToInterests} from '../../config/interests';
import {FragmentedLink} from '../../messaging/FragmentedLink';
import type {
  DiscoveredAdvertisement,
  GattDiagnostics,
  LinkId,
  LinkRole,
} from '../../types/BLE';
import type {
  ITransport,
  PeerLinkTransport,
  TransportDataEvent,
  TransportDiscoveredEvent,
  TransportLinkDownEvent,
  TransportLinkEvent,
  TransportPhaseEvent,
} from '../../types/Transport';
import {EventBus} from '../../utils/EventBus';
import {
  isCentralLink,
  stripPrefix,
  toCentralLinkId,
  toPeripheralLinkId,
} from '../../utils/linkId';

/**
 * An in-memory ITransport used ONLY by tests.
 *
 * This is the "separate unit-test mock" carve-out: it is not imported by any application
 * code, and it does not pretend to be Bluetooth. It stands in for the radio so that
 * everything ABOVE the radio — discovery, handshake, packet codec, fragmentation and
 * reassembly, deduplication, TTL, ACK, delivery-state transitions — can be exercised
 * without two phones.
 *
 * It deliberately reuses the real fragment()/Reassembler implementation and enforces a
 * per-write MTU exactly as the BLE link does, so a message really is chopped into frames
 * and rebuilt. What it CANNOT tell you is whether the radio, the GATT server, advertising,
 * MTU negotiation or notification flow control work — only hardware can.
 */

interface LoopLink {
  role: LinkRole;
  remote: LoopbackTransport;
  remoteLinkId: LinkId;
  /** The SAME fragmentation/ARQ implementation the BLE transport uses. */
  fragmenter: FragmentedLink;
  gatt: GattDiagnostics;
}

type LoopEvents = {
  txFrame: {linkId: LinkId; bytes: number};
  rxFrame: {linkId: LinkId; bytes: number};
  linkPhase: TransportPhaseEvent;
  linkUp: TransportLinkEvent;
  linkDown: TransportLinkDownEvent;
  data: TransportDataEvent;
  discovered: TransportDiscoveredEvent;
};

/** The shared medium. Nodes can only find each other through this. */
export class VirtualAir {
  private nodes = new Map<string, LoopbackTransport>();

  register(node: LoopbackTransport): void {
    this.nodes.set(node.id, node);
  }

  get(id: string): LoopbackTransport | undefined {
    return this.nodes.get(id);
  }

  /** Every advertising node becomes visible to every other node, as a scan would. */
  scan(): void {
    for (const observer of this.nodes.values()) {
      for (const other of this.nodes.values()) {
        if (other === observer || !other.advertising) {
          continue;
        }
        observer.receiveAdvertisement(other);
      }
    }
  }
}

export class LoopbackTransport implements ITransport, PeerLinkTransport {
  readonly name = 'loopback';
  readonly bus = new EventBus<LoopEvents>();

  advertising = false;
  /** Frames dropped so far, when dropEveryNthFrame is set. */
  droppedFrames = 0;
  /** Set to simulate a lossy link; 0 disables. */
  dropEveryNthFrame = 0;

  private links = new Map<LinkId, LoopLink>();
  private frameCounter = 0;
  /** Every frame handed to the air, including retransmissions. */
  sentFrameCount = 0;

  constructor(
    readonly id: string,
    private readonly air: VirtualAir,
    readonly displayName: string,
    readonly peerIdPrefix: string,
    /** Per-write payload limit, mirroring the ATT MTU. */
    readonly mtu: number = DEFAULT_ATT_MTU,
  ) {
    air.register(this);
  }

  /**
   * What this node puts in its advertisement, as a catalogue bitmask.
   *
   * Stored packed rather than as a list, so the harness exercises the same lossy round
   * trip a real advertisement does — a custom interest has no bit and does not survive.
   */
  interestMask = 0;

  // ---- lifecycle --------------------------------------------------------

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    for (const linkId of Array.from(this.links.keys())) {
      await this.disconnect(linkId);
    }
    this.bus.removeAll();
  }

  async startScanning(): Promise<void> {
    this.air.scan();
  }

  async stopScanning(): Promise<void> {}

  startAdvertising(): void {
    this.advertising = true;
  }

  stopAdvertising(): void {
    this.advertising = false;
  }

  receiveAdvertisement(other: LoopbackTransport): void {
    const adv: DiscoveredAdvertisement & {linkId: LinkId} = {
      linkId: toCentralLinkId(other.id),
      deviceName: null,
      advertisedName: other.displayName,
      peerIdPrefix: other.peerIdPrefix,
      advertisedInterests: bitmaskToInterests(other.interestMask),
      rssi: -55,
      timestamp: Date.now(),
      // Every node on the virtual air is a chat peer by construction.
      isChatPeer: true,
      isConnectable: true,
      serviceUuids: [BLE_SERVICE_UUID.toLowerCase()],
    };
    this.bus.emit('discovered', adv);
  }

  // ---- connection -------------------------------------------------------

  async connect(linkId: LinkId): Promise<LinkId> {
    if (!isCentralLink(linkId)) {
      throw new Error('Only central links can be dialled');
    }
    if (this.links.has(linkId)) {
      return linkId;
    }

    // Entering the first phase before anything can fail, so a failure is attributed to
    // the stage it happened in exactly as the real transport does.
    this.bus.emit('linkPhase', {linkId, phase: 'connecting'});

    const remote = this.air.get(stripPrefix(linkId));
    if (!remote) {
      throw new Error(`No node ${stripPrefix(linkId)} on the air`);
    }
    if (!remote.advertising) {
      // A BLE peripheral that is not advertising is not connectable. Modelling that is
      // what makes "peer went away" testable.
      throw new Error(`Node ${stripPrefix(linkId)} is not advertising`);
    }

    const remoteLinkId = toPeripheralLinkId(this.id);

    // Walk the remaining phases a real connection does, so anything driven by them is
    // exercised off-device too. Both ends then come up, mirroring a real connection
    // where the peripheral learns of the central via its GATT server callback.
    for (const phase of [
      'discoveringServices',
      'negotiatingMtu',
      'enablingNotifications',
    ] as const) {
      this.bus.emit('linkPhase', {linkId, phase});
    }

    this.registerLink(linkId, 'central', remote, remoteLinkId);
    remote.registerLink(remoteLinkId, 'peripheral', this, linkId);

    return linkId;
  }

  private registerLink(
    linkId: LinkId,
    role: LinkRole,
    remote: LoopbackTransport,
    remoteLinkId: LinkId,
  ): void {
    this.links.set(linkId, {
      role,
      remote,
      remoteLinkId,
      fragmenter: new FragmentedLink(linkId, {
        sendFrame: frame => this.deliverFrame(linkId, frame),
        currentMtu: () => this.mtu,
      }),
      gatt: {
        serviceFound: true,
        rxCharacteristicFound: true,
        txCharacteristicFound: true,
        notificationsEnabled: true,
        mtu: this.mtu,
      },
    });
    this.bus.emit('linkUp', {linkId, role});
  }

  /**
   * The harness connects synchronously, so there is never a window to cancel in. Closing
   * whatever exists is the honest equivalent.
   */
  async cancelConnect(linkId: LinkId): Promise<void> {
    await this.disconnect(linkId);
  }

  async disconnect(linkId: LinkId): Promise<void> {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    this.links.delete(linkId);
    this.bus.emit('linkDown', {
      linkId,
      role: link.role,
      reason: 'local disconnect',
    });
    link.remote.handleRemoteDisconnect(link.remoteLinkId);
  }

  /**
   * The radio going away, as opposed to either side choosing to close the link — a peer
   * walking out of range, or the stack dropping the connection.
   *
   * Distinct from `disconnect()` because the two must not be conflated: one is a failure
   * worth reconnecting after, the other is a decision.
   */
  simulateDrop(linkId: LinkId): void {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    this.links.delete(linkId);
    this.bus.emit('linkDown', {
      linkId,
      role: link.role,
      reason: 'connection lost',
    });
    link.remote.handleRemoteDisconnect(link.remoteLinkId);
  }

  private handleRemoteDisconnect(linkId: LinkId): void {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    this.links.delete(linkId);
    this.bus.emit('linkDown', {
      linkId,
      role: link.role,
      reason: 'remote disconnected',
    });
  }

  // ---- io ---------------------------------------------------------------

  async send(linkId: LinkId, data: Uint8Array): Promise<void> {
    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`No link ${linkId}`);
    }
    await link.fragmenter.send(data);
  }

  /** Carry one frame across the virtual air, dropping it if loss is configured. */
  private async deliverFrame(linkId: LinkId, frame: Uint8Array): Promise<void> {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    this.frameCounter += 1;
    this.sentFrameCount += 1;
    if (
      this.dropEveryNthFrame > 0 &&
      this.frameCounter % this.dropEveryNthFrame === 0
    ) {
      this.droppedFrames += 1;
      return;
    }
    this.bus.emit('txFrame', {linkId, bytes: frame.length});
    link.remote.receiveFrame(link.remoteLinkId, frame);
  }

  /** Half-finished inbound streams across all links. */
  get pendingStreamCount(): number {
    let n = 0;
    for (const link of this.links.values()) {
      n += link.fragmenter.pendingStreams;
    }
    return n;
  }

  /** Run one round of retransmission requests, as the BLE transport's timer does. */
  pumpArq(now = Date.now()): void {
    for (const link of this.links.values()) {
      link.fragmenter.requestMissing(now);
    }
  }

  private receiveFrame(linkId: LinkId, frame: Uint8Array): void {
    const link = this.links.get(linkId);
    if (!link) {
      return;
    }
    this.bus.emit('rxFrame', {linkId, bytes: frame.length});
    const complete = link.fragmenter.receive(frame);
    if (complete) {
      this.bus.emit('data', {linkId, data: complete});
    }
  }

  getGatt(linkId: LinkId): GattDiagnostics | null {
    return this.links.get(linkId)?.gatt ?? null;
  }

  get linkIds(): LinkId[] {
    return Array.from(this.links.keys());
  }

  // ---- subscriptions ----------------------------------------------------

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
}
