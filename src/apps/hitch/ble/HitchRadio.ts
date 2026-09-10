import {NativeModules, Platform} from 'react-native';
import {BleManager, State, type Device} from 'react-native-ble-plx';

import {
  HITCH_RX_CHAR_UUID,
  HITCH_SERVICE_UUID,
  HITCH_TX_CHAR_UUID,
  bearingFor,
  encodeState,
  parseHitchAdvertisement,
  proximityFromRssi,
  type HitchState,
} from './advertisement';
import type {NearbyRide, Proximity} from '../types';

/**
 * The radio, for real.
 *
 * Phase 2. This replaces the simulated street behind `services/discovery.ts` and nothing
 * else — the Nearby screen, the Ride flow, the map and the vehicle sheet all consume the
 * same `NearbyRide[]` they did before and were not touched.
 *
 * NOTHING HERE IS NEW BLUETOOTH. Scanning is react-native-ble-plx, the same library BLE
 * Chat's central already uses. Advertising is the Kotlin peripheral module already in this
 * repo, called with Hitch's own service UUID and its state packed into the 24-bit field
 * that module already writes. No native code was added for this, and no radio logic was
 * reimplemented — the parts that were hard to get right in BLE Chat are being reused
 * rather than rewritten badly.
 *
 * Three things this file is genuinely responsible for:
 *
 *  1. Turning a stream of advertisements into a LIST. A scan reports the same phone many
 *     times a second with a jittering RSSI; a list that re-sorted on every callback would
 *     be unreadable. Peers are held in a table, their signal is smoothed, and they are
 *     dropped when they stop being heard.
 *  2. Deciding when a peer has GONE. There is no disconnect event for an advertiser that
 *     simply walked away, so absence is inferred from silence.
 *  3. Being honest about whether any of this is available at all. An emulator has no
 *     Bluetooth, and a phone can have it switched off — in both cases the caller is told,
 *     rather than shown an empty street that looks like a quiet one.
 */

const TAG = '[HitchRadio]';

/** Dropped from the list after this long without an advertisement. */
const STALE_MS = 12_000;
/** How often the list is re-emitted while scanning, so staleness is applied on a clock. */
const SWEEP_MS = 2_000;

/**
 * Smoothing factor for RSSI.
 *
 * Raw readings from a single phone swing by 10 dBm or more between consecutive packets,
 * which is enough to bounce a vehicle between two proximity bands several times a second.
 * A slow exponential average trades a second of lag for a list that holds still.
 */
const RSSI_ALPHA = 0.25;

interface Tracked {
  peerIdPrefix: string;
  /** The platform's handle for that radio. Needed to open a link, never shown. */
  address: string;
  name: string | null;
  state: HitchState;
  /** Smoothed, not raw. */
  rssi: number;
  lastSeen: number;
}

export type RadioStatus =
  | 'unsupported'
  | 'poweredOff'
  | 'unauthorized'
  | 'scanning'
  | 'idle';

interface PeripheralNative {
  start(
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
    peerIdPrefixHex: string,
    displayName: string,
    stateBits: number,
  ): Promise<boolean>;
  stop(): Promise<void>;
}

const peripheral: PeripheralNative | undefined = (
  NativeModules as {BlePeripheral?: PeripheralNative}
).BlePeripheral;

class HitchRadio {
  private manager: BleManager | null = null;
  private peers = new Map<string, Tracked>();
  private listeners = new Set<(rides: NearbyRide[]) => void>();
  private statusListeners = new Set<(status: RadioStatus) => void>();
  private sweep: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private status: RadioStatus = 'idle';
  private advertising = false;

  /**
   * Whether this build can use a radio at all.
   *
   * False on an emulator and on any device without the native module linked, which is the
   * case the simulated fallback exists for.
   */
  get supported(): boolean {
    return Platform.OS === 'android' || Platform.OS === 'ios';
  }

  getStatus(): RadioStatus {
    return this.status;
  }

  /**
   * The radio address behind a peer id, for opening a link.
   *
   * Kept here rather than on NearbyRide on purpose: a MAC address is a device identifier
   * that follows somebody around, and putting it in the model every screen renders is how
   * it ends up in a log, a report or a list row. The one caller that needs it asks.
   */
  addressFor(peerId: string): string | null {
    return this.peers.get(peerId)?.address ?? null;
  }

  onStatus(listener: (status: RadioStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: RadioStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const l of this.statusListeners) {
      l(status);
    }
  }

  /**
   * Created lazily and torn down with the last listener.
   *
   * A BleManager holds a native connection to the platform stack. Building one at module
   * load would start that on every app launch, including the launches that never open
   * Hitch — and several hub apps each holding their own manager at once is exactly the
   * kind of contention that makes a scan silently return nothing.
   */
  private ensureManager(): BleManager | null {
    if (!this.supported) {
      return null;
    }
    if (!this.manager) {
      try {
        this.manager = new BleManager();
      } catch (err) {
        console.warn(TAG, 'no BLE manager on this device:', String(err));
        this.setStatus('unsupported');
        return null;
      }
    }
    return this.manager;
  }

  subscribe(listener: (rides: NearbyRide[]) => void): () => void {
    this.listeners.add(listener);
    // Emit immediately: a screen that opens to nothing while a scan warms up reads as
    // broken, and whatever was heard a moment ago is still the best answer available.
    listener(this.snapshot());
    void this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        void this.stop();
      }
    };
  }

  private async start(): Promise<void> {
    if (this.scanning) {
      return;
    }
    const manager = this.ensureManager();
    if (!manager) {
      this.setStatus('unsupported');
      return;
    }

    try {
      const state =
        typeof manager.state === 'function' ? await manager.state() : State.Unsupported;
      if (state === State.PoweredOff) {
        this.setStatus('poweredOff');
        return;
      }
      if (state === State.Unauthorized) {
        this.setStatus('unauthorized');
        return;
      }
      if (state === State.Unsupported) {
        this.setStatus('unsupported');
        return;
      }
    } catch {
      this.setStatus('unsupported');
      return;
    }

    // Filtered on Hitch's own service UUID, so BLE Chat phones, headphones and every
    // other beacon in the street are rejected by the platform before they reach JS.
    //
    // Guarded rather than called straight: a library that is present but not functional
    // — an unlinked native module after a JS-only reload, a stripped build, a test
    // environment — throws here rather than returning an error to the callback. Treating
    // that as "no radio" is what lets the caller fall back and SAY it has, instead of
    // showing an empty street that looks like a quiet one.
    try {
      if (typeof manager.startDeviceScan !== 'function') {
        throw new Error('startDeviceScan unavailable');
      }
      manager.startDeviceScan(
        [HITCH_SERVICE_UUID],
        {allowDuplicates: true},
        (error, device) => {
          if (error) {
            console.warn(TAG, 'scan stopped:', error.message);
            this.scanning = false;
            this.setStatus('idle');
            return;
          }
          if (device) {
            this.absorb(device);
          }
        },
      );
    } catch (err) {
      console.warn(TAG, 'cannot scan on this device:', String(err));
      this.scanning = false;
      this.setStatus('unsupported');
      return;
    }

    this.scanning = true;
    this.setStatus('scanning');

    // Staleness has to be applied on a clock rather than on arrival: a peer that has gone
    // silent generates no callback to notice it by.
    this.sweep = setInterval(() => this.emit(), SWEEP_MS);
  }

  private async stop(): Promise<void> {
    if (this.sweep) {
      clearInterval(this.sweep);
      this.sweep = null;
    }
    if (this.manager && this.scanning) {
      try {
        this.manager.stopDeviceScan();
      } catch {
        // Already stopped, or the adapter went away underneath us.
      }
    }
    this.scanning = false;
    this.peers.clear();
    this.setStatus('idle');
  }

  /** One advertisement, folded into what is already known about that phone. */
  private absorb(device: Device): void {
    const parsed = parseHitchAdvertisement(device.manufacturerData, device.localName ?? device.name);
    if (!parsed) {
      return;
    }
    const rssi = typeof device.rssi === 'number' ? device.rssi : -100;
    const existing = this.peers.get(parsed.peerIdPrefix);
    this.peers.set(parsed.peerIdPrefix, {
      peerIdPrefix: parsed.peerIdPrefix,
      address: device.id,
      name: parsed.name ?? existing?.name ?? null,
      state: parsed.state,
      // First reading is taken as-is; after that the average moves slowly.
      rssi: existing ? existing.rssi + (rssi - existing.rssi) * RSSI_ALPHA : rssi,
      lastSeen: Date.now(),
    });
    this.emit();
  }

  /** Everything currently heard, as the shape every screen already consumes. */
  private snapshot(): NearbyRide[] {
    const now = Date.now();
    const out: NearbyRide[] = [];
    for (const [key, peer] of this.peers) {
      if (now - peer.lastSeen > STALE_MS) {
        this.peers.delete(key);
        continue;
      }
      // Only riders belong in a list of rides. A passenger's phone advertises too — that
      // is how a rider sees requests nearby — but it is not something to hail.
      if (peer.state.role !== 'rider') {
        continue;
      }
      out.push({
        peerId: peer.peerIdPrefix,
        riderName: peer.name ?? 'Rider nearby',
        vehicle: {
          kind: peer.state.vehicleKind,
          // Only what the advertisement carries. The plate, model and colour live in the
          // rider's profile and arrive on connection — a list built from broadcasts
          // cannot know them, and inventing placeholders would be worse than blanks.
          registration: '',
          model: '',
          colour: '',
          photos: [],
        },
        proximity: proximityFromRssi(peer.rssi) as Proximity,
        available: peer.state.available,
        bearing: bearingFor(peer.peerIdPrefix),
      });
    }
    return out;
  }

  private emit(): void {
    const rides = this.snapshot();
    for (const l of this.listeners) {
      l(rides);
    }
  }

  // ---------------------------------------------------------------- advertising

  /**
   * Tell the street what this phone is.
   *
   * Goes through the peripheral module that is already in this build. Only one
   * advertisement can be on air at a time per device, so a failure here is usually
   * another app in the hub holding the advertiser — reported rather than swallowed,
   * because a rider who thinks they are online and is not will sit waiting for a request
   * that can never arrive.
   */
  async advertise(
    peerIdPrefix: string,
    displayName: string,
    state: HitchState,
  ): Promise<{ok: boolean; reason?: string}> {
    if (!peripheral) {
      return {ok: false, reason: 'This build has no Bluetooth advertiser.'};
    }
    try {
      await peripheral.start(
        HITCH_SERVICE_UUID,
        HITCH_RX_CHAR_UUID,
        HITCH_TX_CHAR_UUID,
        peerIdPrefix.slice(0, 16),
        displayName.slice(0, 20),
        encodeState(state),
      );
      this.advertising = true;
      return {ok: true};
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(TAG, 'could not advertise:', reason);
      return {ok: false, reason};
    }
  }

  async stopAdvertising(): Promise<void> {
    if (!peripheral || !this.advertising) {
      return;
    }
    this.advertising = false;
    await peripheral.stop().catch(() => undefined);
  }

  get isAdvertising(): boolean {
    return this.advertising;
  }
}

export const hitchRadio = new HitchRadio();
