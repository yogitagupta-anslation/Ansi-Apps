/**
 * A deterministic loopback GATT transport.
 *
 * This is NOT a simulator and it must never ship as one. It does not pretend a
 * radio exists, it does not invent peers, and nothing constructs it outside a
 * test or an explicit developer harness. What it is: two objects wired to each
 * other so the entire stack above the seam — framing, reassembly, the envelope,
 * the link state machine, the session layer — can be exercised for real,
 * including at a 20-byte MTU where fragmentation actually happens.
 *
 * Everything a real link does badly, this one can be told to do badly:
 *   - a chosen MTU, so fragment boundaries are exercised deliberately
 *   - delivery that reorders, duplicates or drops frames
 *   - a connect that fails, or never completes
 *   - a peer that vanishes mid-message
 *
 * That is the difference between a test that proves the transport works and a
 * test that proves a mock was called.
 */

import {
  ATT_DEFAULT_MTU,
  CONNECT_TIMEOUT_MS,
  payloadBytesForMtu,
} from '../GattProfile';
import {
  GattReassembler,
  GroupIdSource,
  fragmentMessage,
} from '../GattFraming';
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

export interface InMemoryGattOptions {
  deviceId: string;
  /** MTU reported for every link. Default is the un-negotiated BLE minimum. */
  mtu?: number;
  displayName?: string;
  /** Injected clock. Tests drive it; nothing here reads the wall clock. */
  now?: () => number;
  capabilities?: Partial<GattCapabilities>;
}

/** How the wire misbehaves. All default to "perfectly". */
export interface InMemoryWireFaults {
  /** Deliver every frame twice. */
  duplicateFrames?: boolean;
  /** Deliver each message's frames back to front. */
  reverseFragments?: boolean;
  /** Drop the frame at this index within each message. */
  dropFragmentIndex?: number;
  /** Refuse the next connect attempt with this code. */
  failConnect?: 'connect_failed' | 'connect_timeout' | null;
  /** Accept the connect but never complete it, so the caller's timeout runs. */
  stallConnect?: boolean;
}

interface Wired {
  peer: GattPeer;
  link: GattLink;
  reassembler: GattReassembler;
  groupIds: GroupIdSource;
  remote: InMemoryGattTransport | null;
}

export class InMemoryGattTransport implements GattTransport {
  readonly name = 'in-memory';
  readonly deviceId: string;

  readonly faults: InMemoryWireFaults = {};

  private readonly mtu: number;
  private readonly displayName?: string;
  private readonly now: () => number;
  private readonly caps: GattCapabilities;

  private readonly links = new Map<string, Wired>();
  private readonly listeners = new Set<Partial<GattTransportEvents>>();

  /** Every transport that can be discovered by this one. Set up by `pair`. */
  private readonly reachable = new Map<string, InMemoryGattTransport>();

  private peripheralUp = false;
  private scanning = false;
  private stopped = false;

  constructor(options: InMemoryGattOptions) {
    this.deviceId = options.deviceId;
    this.mtu = options.mtu ?? ATT_DEFAULT_MTU;
    this.displayName = options.displayName;
    this.now = options.now ?? (() => 0);
    this.caps = {
      supportsCentral: true,
      supportsPeripheral: true,
      ...options.capabilities,
    };
  }

  /**
   * Put two transports within range of each other.
   *
   * Reachability is symmetric, exactly as radio range is: if A can see B then B
   * can see A. Getting that wrong in a fake is how a test ends up proving
   * something the radio would never do.
   */
  static pair(a: InMemoryGattTransport, b: InMemoryGattTransport): void {
    a.reachable.set(b.deviceId, b);
    b.reachable.set(a.deviceId, a);
  }

  static unpair(a: InMemoryGattTransport, b: InMemoryGattTransport): void {
    a.reachable.delete(b.deviceId);
    b.reachable.delete(a.deviceId);
  }

  async getCapabilities(): Promise<GattCapabilities> {
    return this.caps;
  }

  /* ---------------------------------------------------------------- *
   * Roles
   * ---------------------------------------------------------------- */

  async startPeripheral(): Promise<void> {
    if (!this.caps.supportsPeripheral) {
      throw new GattTransportError(
        'unavailable',
        this.caps.unavailableReason ?? 'this device cannot act as a GATT peripheral',
        { recoverable: false },
      );
    }
    this.peripheralUp = true;
  }

  async stopPeripheral(): Promise<void> {
    this.peripheralUp = false;
  }

  get isPeripheralUp(): boolean {
    return this.peripheralUp;
  }

  async startScan(): Promise<void> {
    this.scanning = true;
    for (const other of this.reachable.values()) {
      if (!other.peripheralUp) continue;
      this.emit('onDiscovery', {
        deviceId: other.deviceId,
        displayName: other.displayName,
        discoveredAt: this.now(),
      } satisfies GattDiscovery);
    }
  }

  async stopScan(): Promise<void> {
    this.scanning = false;
  }

  get isScanning(): boolean {
    return this.scanning;
  }

  /* ---------------------------------------------------------------- *
   * Links
   * ---------------------------------------------------------------- */

  async connect(deviceId: string, options: { timeoutMs?: number } = {}): Promise<GattPeer> {
    this.assertRunning();

    const existing = this.links.get(deviceId);
    if (existing?.link.isUsable) return existing.peer;
    if (existing?.link.isBusy) {
      // A second attempt while one is in flight is a bug in the caller, not a
      // reason to open a second native connection.
      throw new GattTransportError(
        'connect_failed',
        `a connection to ${deviceId} is already in progress`,
      );
    }

    const link = new GattLink(deviceId, this.now());
    link.event({ kind: 'connect' }, this.now(), options.timeoutMs ?? CONNECT_TIMEOUT_MS);

    const wired: Wired = {
      peer: {
        deviceId,
        role: 'central',
        mtu: this.mtu,
        connectedAt: this.now(),
      },
      link,
      reassembler: new GattReassembler(undefined, this.now),
      groupIds: new GroupIdSource(),
      remote: null,
    };
    this.links.set(deviceId, wired);

    if (this.faults.failConnect) {
      const code = this.faults.failConnect;
      link.event({ kind: 'fail', reason: code === 'connect_timeout' ? 'timeout' : 'error' }, this.now());
      throw new GattTransportError(code, `connect to ${deviceId} failed`);
    }

    if (this.faults.stallConnect) {
      // Leave the link in `connecting` for ever. The caller's own timeout is
      // what has to save it, which is exactly the behaviour worth testing.
      return new Promise<GattPeer>(() => undefined);
    }

    const remote = this.reachable.get(deviceId);
    if (!remote || !remote.peripheralUp) {
      link.event({ kind: 'fail', reason: 'error' }, this.now());
      throw new GattTransportError('connect_failed', `${deviceId} is not advertising`);
    }

    wired.remote = remote;
    // The far side accepts an inbound link, in the peripheral role.
    remote.acceptInbound(this);

    link.event({ kind: 'ready' }, this.now());
    this.emit('onPeerConnected', wired.peer);
    this.emit('onMtuChanged', deviceId, this.mtu);
    return wired.peer;
  }

  /** Called on the far side when someone connects in. */
  private acceptInbound(from: InMemoryGattTransport): void {
    const link = new GattLink(from.deviceId, this.now());
    link.event({ kind: 'connect' }, this.now());
    link.event({ kind: 'ready' }, this.now());

    const wired: Wired = {
      peer: {
        deviceId: from.deviceId,
        role: 'peripheral',
        mtu: this.mtu,
        displayName: from.displayName,
        connectedAt: this.now(),
      },
      link,
      reassembler: new GattReassembler(undefined, this.now),
      groupIds: new GroupIdSource(),
      remote: from,
    };
    this.links.set(from.deviceId, wired);
    this.emit('onPeerConnected', wired.peer);
  }

  async disconnect(deviceId: string): Promise<void> {
    const wired = this.links.get(deviceId);
    if (!wired) return;

    wired.link.event({ kind: 'disconnect' }, this.now());
    const remote = wired.remote;
    this.teardown(deviceId, 'local');
    remote?.teardown(this.deviceId, 'remote');
  }

  /** Both sides of a drop, so a test can pull the plug from either end. */
  teardown(deviceId: string, reason: GattDisconnectReason): void {
    const wired = this.links.get(deviceId);
    if (!wired) return;
    wired.link.event({ kind: 'drop', reason }, this.now());
    wired.reassembler.reset();
    this.links.delete(deviceId);
    this.emit('onPeerDisconnected', deviceId, reason);
  }

  /* ---------------------------------------------------------------- *
   * Traffic
   * ---------------------------------------------------------------- */

  async send(deviceId: string, payload: Uint8Array): Promise<void> {
    this.assertRunning();
    const wired = this.links.get(deviceId);
    if (!wired || !wired.link.isUsable) {
      throw new GattTransportError('not_connected', `no live link to ${deviceId}`);
    }

    const frames = fragmentMessage(payload, payloadBytesForMtu(wired.peer.mtu), wired.groupIds);
    const ordered = this.faults.reverseFragments ? [...frames].reverse() : frames;

    for (let i = 0; i < ordered.length; i++) {
      if (this.faults.dropFragmentIndex === i) continue;
      const frame = ordered[i];
      wired.remote?.deliver(this.deviceId, frame);
      if (this.faults.duplicateFrames) wired.remote?.deliver(this.deviceId, frame);
    }
  }

  /** One wire frame arriving from the far side. */
  private deliver(fromDeviceId: string, frame: Uint8Array): void {
    const wired = this.links.get(fromDeviceId);
    if (!wired || !wired.link.isUsable) return;

    let message: Uint8Array | null;
    try {
      message = wired.reassembler.push(frame);
    } catch (error) {
      // A malformed frame is dropped and reported. It must never take the link
      // down: one corrupt packet from a broken peer would otherwise end the
      // conversation.
      this.emit(
        'onError',
        new GattTransportError('internal', `discarded a malformed frame from ${fromDeviceId}`, {
          cause: error,
        }),
      );
      return;
    }

    if (message) this.emit('onMessage', fromDeviceId, message);
  }

  /* ---------------------------------------------------------------- *
   * Introspection
   * ---------------------------------------------------------------- */

  getPeers(): GattPeer[] {
    return [...this.links.values()].filter((w) => w.link.isUsable).map((w) => w.peer);
  }

  getPeer(deviceId: string): GattPeer | undefined {
    const wired = this.links.get(deviceId);
    return wired?.link.isUsable ? wired.peer : undefined;
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
    for (const deviceId of [...this.links.keys()]) {
      const remote = this.links.get(deviceId)?.remote;
      this.teardown(deviceId, 'local');
      remote?.teardown(this.deviceId, 'remote');
    }
    this.peripheralUp = false;
    this.scanning = false;
    this.stopped = true;
    this.listeners.clear();
  }

  private assertRunning(): void {
    if (this.stopped) {
      throw new GattTransportError('unavailable', 'transport has been shut down', {
        recoverable: false,
      });
    }
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
