import { Platform } from 'react-native';
import type { BleManager, Characteristic, Device, Subscription } from 'react-native-ble-plx';
import { decode, encode, Msg } from './protocol';
import { BleState, BleTransport, DiscoveredRoom, RoomInfo, Unsubscribe } from './transport';
import { Reassembler, toFrames } from './framing';
import { Peripheral } from './peripheral';
import { ensureBlePermissions } from './permissions';
import { encodeAdvertMask, encodeAdvertPrefix, parseAdvert } from './advertisement';
import { HostRoom, trimName } from './hostRoom';
import {
  CONNECT_TIMEOUT_MS,
  DEFAULT_ATT_MTU,
  HL_RX_CHAR_UUID,
  HL_SERVICE_UUID,
  HL_TX_CHAR_UUID,
  REQUESTED_MTU,
  ROOM_STALE_MS,
} from './constants';

/**
 * The real radio.
 *
 * The topology is a star, because that is the only shape BLE offers: the host
 * is a GATT peripheral advertising the room, every joiner is a central that
 * connects to it, and joiners cannot see each other at all. So the host relays
 * -- every message it receives from one phone is forwarded to the others, which
 * is what turns three point-to-point links into one room where everybody
 * watches everybody else close in.
 *
 * Three things follow from that shape and are worth knowing before editing:
 *
 *   1. The host is the only device holding the roster. A joiner learns who else
 *      is in the room from the 'hello' replay the host sends it on arrival.
 *   2. A joiner's message reaches its peers one hop late. Nothing in the game
 *      depends on the two orderings agreeing: each device judges its own
 *      player's guesses locally, and the host has the last word on who won.
 *   3. Only the host can turn anybody away, so capacity is enforced there.
 */

type PlxModule = typeof import('react-native-ble-plx');

function plx(): PlxModule {
  // Required lazily. Importing it in Expo Go, where the native half is absent,
  // throws at module scope -- which would take the whole game down on launch
  // rather than just the multiplayer screen.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-ble-plx') as PlxModule;
}

/** Whether this build has the central half of the link linked in. */
export function centralAvailable(): boolean {
  try {
    return typeof plx().BleManager === 'function';
  } catch {
    return false;
  }
}

interface ClientLink {
  device: Device;
  rx: Characteristic;
  tx: Characteristic;
  monitor: Subscription | null;
  disconnectSub: Subscription | null;
  mtu: number;
}

export class NativeBleTransport implements BleTransport {
  /** Identity on the wire. Fresh per session -- a room is not worth remembering. */
  readonly deviceId = `p-${Math.random().toString(36).slice(2, 8)}`;
  readonly label = 'Bluetooth';
  readonly simulated = false;

  private state: BleState = 'off';
  private stateSubs = new Set<(s: BleState) => void>();
  private msgSubs = new Set<(m: Msg, from: string) => void>();
  private errorSubs = new Set<(message: string) => void>();

  private role: 'host' | 'client' | null = null;

  // ---- host side
  private peripheral: Peripheral | null = null;
  /** The room's rules and roster. Null unless we are the one hosting. */
  private hostRoom: HostRoom | null = null;
  private hostInbound = new Map<string, Reassembler>();

  // ---- client side
  private manager: BleManager | null = null;
  private link: ClientLink | null = null;
  private clientInbound = new Reassembler();
  private hostPlayerId: string | null = null;
  private scanning = false;
  private seen = new Map<string, { room: DiscoveredRoom; at: number }>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  /** Watches the adapter while the join screen is open. */
  private radioSub: Subscription | null = null;

  /** One write at a time per link, so fragments cannot interleave. */
  private queues = new Map<string, Promise<unknown>>();

  constructor() {
    this.setState('idle');
  }

  // ------------------------------------------------------------- plumbing

  private setState(next: BleState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateSubs.forEach((cb) => cb(next));
  }

  private fail(message: string): void {
    this.errorSubs.forEach((cb) => cb(message));
  }

  private deliver(msg: Msg, fromId: string): void {
    this.msgSubs.forEach((cb) => cb(msg, fromId));
  }

  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const chained = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    this.queues.set(key, chained);
    return chained;
  }

  getState(): BleState {
    return this.state;
  }

  onStateChange(cb: (s: BleState) => void): Unsubscribe {
    this.stateSubs.add(cb);
    cb(this.state);
    return () => {
      this.stateSubs.delete(cb);
    };
  }

  onMessage(cb: (m: Msg, from: string) => void): Unsubscribe {
    this.msgSubs.add(cb);
    return () => {
      this.msgSubs.delete(cb);
    };
  }

  /** Radio trouble a player can act on: permissions, range, an absent radio. */
  onError(cb: (message: string) => void): Unsubscribe {
    this.errorSubs.add(cb);
    return () => {
      this.errorSubs.delete(cb);
    };
  }

  // ----------------------------------------------------------------- host

  private advertPrefix(): string {
    const room = this.hostRoom;
    if (!room) return encodeAdvertPrefix({ code: 'XXXX', capacity: 2, players: 1, playing: false, rangeMax: 100 });
    return encodeAdvertPrefix({
      code: room.room.code,
      capacity: room.room.capacity,
      players: room.playerCount,
      playing: room.isPlaying,
      rangeMax: room.room.range.max,
    });
  }

  private refreshAdvert(): void {
    const room = this.hostRoom;
    if (!this.peripheral || !room) return;
    void this.peripheral.updateAdvertisement(
      this.advertPrefix(),
      trimName(room.room.hostName),
      encodeAdvertMask(room.room.range),
    );
  }

  async startHosting(room: RoomInfo): Promise<void> {
    await ensureBlePermissions();

    this.role = 'host';
    this.hostInbound.clear();
    this.hostRoom = new HostRoom(
      this.deviceId,
      { code: room.code, hostName: room.hostName, capacity: room.capacity, range: room.range },
      {
        toPeer: (centralId, msg) => void this.sendTo(centralId, msg),
        local: (msg, from) => {
          this.deliver(msg, from);
          this.setState(this.hostRoom && this.hostRoom.playerCount > 1 ? 'connected' : 'advertising');
        },
        advertChanged: () => this.refreshAdvert(),
      },
    );

    const peripheral = new Peripheral({
      onCentralConnected: () => undefined,
      onCentralDisconnected: (centralId) => this.onCentralGone(centralId),
      onData: (centralId, base64) => this.onCentralData(centralId, base64),
      onSubscription: () => undefined,
      onMtu: () => undefined,
      onError: (message) => this.fail(message),
    });
    this.peripheral = peripheral;

    const capabilities = await peripheral.getCapabilities();
    if (capabilities && capabilities.bluetoothEnabled && !capabilities.hasAdvertiser) {
      // Peripheral mode is hardware, not software: plenty of handsets support
      // BLE and still cannot advertise. Better to say so than to open a room
      // nobody will ever find.
      this.peripheral = null;
      this.hostRoom = null;
      this.role = null;
      throw new Error(
        'This phone cannot advertise over Bluetooth, so it cannot host a room. ' +
          'Let someone else host and join theirs instead.',
      );
    }

    try {
      await peripheral.start(
        HL_SERVICE_UUID,
        HL_RX_CHAR_UUID,
        HL_TX_CHAR_UUID,
        this.advertPrefix(),
        trimName(room.hostName),
        encodeAdvertMask(room.range),
      );
    } catch (err) {
      // Bluetooth off, permission refused, advertiser busy. The caller shows
      // the reason; what matters here is not being left half-hosting, which
      // would have the next attempt tear down a server that never opened.
      await peripheral.stop();
      this.peripheral = null;
      this.hostRoom = null;
      this.role = null;
      this.setState('idle');
      throw err;
    }
    this.setState('advertising');
  }

  async setCapacity(capacity: number): Promise<void> {
    this.hostRoom?.setCapacity(capacity);
  }

  /** Once the round is under way the door closes; latecomers are told so. */
  setPlaying(playing: boolean): void {
    this.hostRoom?.setPlaying(playing);
  }

  private onCentralData(centralId: string, base64: string): void {
    let inbound = this.hostInbound.get(centralId);
    if (!inbound) {
      inbound = new Reassembler();
      this.hostInbound.set(centralId, inbound);
    }
    const text = inbound.accept(base64);
    if (text === null) return;
    const msg = decode(text);
    if (msg) this.hostRoom?.receive(centralId, msg);
  }

  private onCentralGone(centralId: string): void {
    this.hostInbound.delete(centralId);
    this.queues.delete(centralId);
    // The room reports the departure, which is what moves the state back.
    this.hostRoom?.disconnect(centralId);
  }

  private async sendTo(centralId: string, msg: Msg): Promise<void> {
    const peripheral = this.peripheral;
    if (!peripheral) return;

    let frames: string[];
    try {
      frames = toFrames(encode(msg), peripheral.mtu(centralId) ?? DEFAULT_ATT_MTU);
    } catch (err) {
      // An oversized message is a bug in the caller, not a radio fault. Every
      // relay reaches this through a fire-and-forget send, so throwing here
      // would surface as an unhandled rejection with no idea what caused it.
      this.fail(describe(err));
      return;
    }
    await this.enqueue(centralId, async () => {
      for (const frame of frames) {
        try {
          await peripheral.send(centralId, frame);
        } catch {
          // The central went away mid-message. Its disconnect event does the
          // bookkeeping; there is nothing useful to say about a dropped frame.
          return;
        }
      }
    });
  }

  // --------------------------------------------------------------- client

  private ensureManager(): BleManager {
    if (!this.manager) {
      const { BleManager: Manager } = plx();
      // On iOS this instantiation is what raises the system Bluetooth prompt.
      this.manager = new Manager();
    }
    return this.manager;
  }

  startScan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe {
    let cancelled = false;
    this.seen.clear();
    this.scanning = true;
    this.setState('scanning');

    const emit = () => {
      if (cancelled) return;
      cb(
        Array.from(this.seen.values())
          .map((s) => s.room)
          .sort((a, b) => b.rssi - a.rssi),
      );
    };

    const begin = async () => {
      try {
        await ensureBlePermissions();
      } catch (err) {
        this.scanning = false;
        this.setState('idle');
        this.fail(describe(err));
        return;
      }
      if (cancelled) return;

      const manager = this.ensureManager();
      const { State, ScanMode } = plx();

      const sweep = () => {
        try {
          manager.stopDeviceScan();
        } catch {
          // Nothing was running; the radio just came up.
        }
        this.setState('scanning');
        manager.startDeviceScan(
          null,
          { allowDuplicates: true, scanMode: ScanMode.LowLatency },
          (error, device) => {
            if (error) {
              this.setState('idle');
              this.fail(error.message);
              return;
            }
            if (!device) return;
            const room = this.toRoom(device);
            if (!room) return;
            this.seen.set(room.id, { room, at: Date.now() });
            emit();
          },
        );
      };

      // Everything hangs off the adapter's own state, rather than a one-shot
      // check: a scan started on a radio that is still coming up returns
      // nothing and never recovers, and a player who switches Bluetooth on
      // after opening this screen should simply see the list fill in.
      this.radioSub = manager.onStateChange((next) => {
        if (cancelled) return;
        if (next === State.PoweredOn) {
          sweep();
          return;
        }
        try {
          manager.stopDeviceScan();
        } catch {
          // It was not running.
        }
        this.setState('idle');
        if (next === State.PoweredOff) {
          this.fail('Bluetooth is switched off. Turn it on to find nearby games.');
        } else if (next === State.Unsupported) {
          this.fail('This phone has no Bluetooth LE radio, so it cannot join a game.');
        } else if (next === State.Unauthorized) {
          this.fail('Higher or Lower is not allowed to use Bluetooth. Enable it in Settings.');
        }
        // Unknown and Resetting are transient: say nothing and wait.
      }, true);
    };

    void begin();

    // Rooms do not announce that they have left; they just stop being heard.
    this.pruneTimer = setInterval(() => {
      const cutoff = Date.now() - ROOM_STALE_MS;
      let dropped = false;
      this.seen.forEach((entry, id) => {
        if (entry.at < cutoff) {
          this.seen.delete(id);
          dropped = true;
        }
      });
      if (dropped) emit();
    }, 2000);

    return () => {
      cancelled = true;
      this.stopScan();
    };
  }

  private stopScan(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.radioSub?.remove();
    this.radioSub = null;
    if (!this.scanning) return;
    this.scanning = false;
    try {
      this.manager?.stopDeviceScan();
    } catch {
      // Nothing to stop.
    }
    if (this.state === 'scanning') this.setState('idle');
  }

  /**
   * A scan result, if it is one of our rooms rather than a stray BLE device.
   *
   * The service UUID is checked first and is not optional. Other apps in this
   * same binary advertise through the same native peripheral, which means the
   * same 0xFFFF company id and the same "BC-" name prefix; the UUID is the only
   * field that actually distinguishes a game room from a chat peer, and without
   * it a rare-but-possible byte pattern would show somebody's chat as a room
   * that cannot be joined.
   */
  private toRoom(device: Device): DiscoveredRoom | null {
    const advertises = (device.serviceUUIDs ?? []).some(
      (u) => u.toLowerCase() === HL_SERVICE_UUID.toLowerCase(),
    );
    if (!advertises) return null;

    const parsed = parseAdvert({
      manufacturerData: device.manufacturerData,
      localName: device.localName,
    });
    if (!parsed) return null;

    const { advert, hostName } = parsed;
    return {
      id: device.id,
      code: advert.code,
      hostName,
      players: advert.players,
      capacity: advert.capacity,
      full: advert.players >= advert.capacity,
      playing: advert.playing,
      rssi: device.rssi ?? -90,
      // A preview only: the host sends the range it is really using on connect.
      range: { min: 1, max: advert.rangeMax },
    };
  }

  async join(roomId: string, playerName: string): Promise<void> {
    await ensureBlePermissions();
    this.stopScan();
    // Joining a second room means leaving the first. Skipping this leaks a live
    // link whose notifications would keep arriving into the new room's state.
    if (this.link) await this.leave();

    this.role = 'client';
    this.clientInbound.reset();
    this.hostPlayerId = null;

    const manager = this.ensureManager();
    let device: Device;
    try {
      device = await manager.connectToDevice(roomId, {
        // Android negotiates the MTU as part of connecting; iOS reports its own.
        requestMTU: Platform.OS === 'android' ? REQUESTED_MTU : undefined,
        timeout: CONNECT_TIMEOUT_MS,
      });
      device = await device.discoverAllServicesAndCharacteristics();
    } catch (err) {
      // Android leaves a half-open connection behind a failed connect, and the
      // next attempt then fails with "already connected" -- which reads to a
      // player as a room that has permanently stopped working.
      await this.dropLink(roomId);
      this.role = null;
      throw err;
    }

    const services = await device.services();
    const service = services.find((s) => s.uuid.toLowerCase() === HL_SERVICE_UUID.toLowerCase());
    if (!service) {
      await this.dropLink(device.id);
      throw new Error('That phone is no longer hosting a Higher or Lower room.');
    }

    const characteristics = await service.characteristics();
    const rx = characteristics.find((c) => c.uuid.toLowerCase() === HL_RX_CHAR_UUID.toLowerCase());
    const tx = characteristics.find((c) => c.uuid.toLowerCase() === HL_TX_CHAR_UUID.toLowerCase());
    if (!rx || !tx) {
      await this.dropLink(device.id);
      throw new Error('That room is running a different version of the game.');
    }

    const link: ClientLink = {
      device,
      rx,
      tx,
      monitor: null,
      disconnectSub: null,
      mtu: device.mtu ?? DEFAULT_ATT_MTU,
    };

    // Subscribing writes the descriptor that lets the host push to us. It has to
    // land before we say hello, or the host's reply is notified into the void.
    link.monitor = tx.monitor((error, characteristic) => {
      if (error || !characteristic?.value) return;
      const text = this.clientInbound.accept(characteristic.value);
      if (text === null) return;
      const msg = decode(text);
      if (msg) this.onHostMessage(msg);
    });

    link.disconnectSub = device.onDisconnected(() => this.onHostGone());

    this.link = link;
    this.setState('connected');

    await this.send({ t: 'hello', id: this.deviceId, nm: trimName(playerName) });
  }

  private onHostMessage(msg: Msg): void {
    if (msg.t === 'hello' && msg.h) this.hostPlayerId = msg.id;
    if (msg.t === 'full') {
      this.fail('That room is full.');
      void this.leave();
      return;
    }
    this.deliver(msg, this.hostPlayerId ?? 'host');
  }

  private onHostGone(): void {
    if (this.role !== 'client' || !this.link) return;
    const hostId = this.hostPlayerId;
    this.link.monitor?.remove();
    this.link.disconnectSub?.remove();
    this.link = null;
    this.setState('idle');
    this.fail('The link to the host dropped. Move closer and join again.');
    if (hostId) this.deliver({ t: 'bye', id: hostId }, hostId);
  }

  private async dropLink(deviceId: string): Promise<void> {
    try {
      await this.manager?.cancelDeviceConnection(deviceId);
    } catch {
      // Already gone.
    }
  }

  // ------------------------------------------------------------------- io

  async send(msg: Msg, to?: string): Promise<void> {
    const room = this.hostRoom;
    if (this.role === 'host' && room) {
      if (to) {
        const centralId = room.linkFor(to);
        if (centralId) await this.sendTo(centralId, msg);
        return;
      }
      room.broadcast(msg);
      return;
    }

    const link = this.link;
    if (!link) return;
    const frames = toFrames(encode(msg), link.mtu);
    const withResponse = link.rx.isWritableWithResponse;
    await this.enqueue(link.device.id, async () => {
      for (const frame of frames) {
        try {
          // Write-with-response gives per-frame flow control, which is what
          // keeps a fragmented message in order. The faster mode is used only
          // when the host's characteristic will not accept the safer one.
          if (withResponse) await link.rx.writeWithResponse(frame);
          else await link.rx.writeWithoutResponse(frame);
        } catch {
          return; // the disconnect handler owns the fallout
        }
      }
    });
  }

  async leave(): Promise<void> {
    this.stopScan();

    if (this.peripheral) {
      await this.peripheral.stop();
      this.peripheral = null;
    }

    if (this.link) {
      const { device, monitor, disconnectSub } = this.link;
      monitor?.remove();
      disconnectSub?.remove();
      this.link = null;
      await this.dropLink(device.id);
    }

    this.role = null;
    this.hostRoom = null;
    this.hostInbound.clear();
    this.queues.clear();
    this.clientInbound.reset();
    this.hostPlayerId = null;
    this.setState('idle');
  }

  destroy(): void {
    // The manager is released only once leave() has finished with it: tearing
    // it down mid-teardown turns an orderly disconnect into a thrown error.
    void this.leave().finally(() => {
      try {
        this.manager?.destroy();
      } catch {
        // Nothing left to release.
      }
      this.manager = null;
    });
    this.stateSubs.clear();
    this.msgSubs.clear();
    this.errorSubs.clear();
    this.state = 'off';
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Bluetooth is unavailable right now.';
}
