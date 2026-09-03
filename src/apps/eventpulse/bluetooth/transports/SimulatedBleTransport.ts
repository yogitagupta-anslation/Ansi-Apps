/**
 * SimulatedBleTransport — a believable crowd, without hardware.
 *
 * Why this exists: BLE advertising cannot be exercised on a simulator or
 * emulator, and reviewing map behaviour in a room of 200 people is not a thing
 * you can do on demand. This transport drives the *real* pipeline (encode ->
 * radio -> registry -> filter -> map) with synthetic packets, so everything
 * above the transport seam is exercised exactly as it is on device.
 *
 * The motion model mimics how people actually behave in a hall: they stand in
 * knots near something — a stage, a coffee table, a booth — for a minute or two,
 * then walk purposefully somewhere else and settle again. They do not perform a
 * random walk, and that distinction is the whole point.
 *
 * An earlier version re-randomised each person's heading every couple of
 * seconds. It looked plausible frame by frame and was badly wrong in aggregate:
 * distances swung constantly, people crossed proximity bands every few seconds,
 * clusters formed and dissolved under the user's finger, and individuals
 * appeared to vanish and reappear. Real crowds are far more boring than that,
 * and a demo jumpier than reality teaches you the wrong things about your own UI.
 *
 * So each peer alternates between *dwelling* (small drift around where they are
 * standing, 15-75 s) and *travelling* (a sustained walk to another hub at
 * roughly walking pace). Headings persist for a whole journey instead of being
 * redrawn every step.
 *
 * RSSI is derived from true distance through the same log-distance model the app
 * uses to invert it, plus Gaussian noise and occasional body-blocking dropouts
 — so the smoothing pipeline sees the kind of mess it sees in real life.
 *
 * This is a development tool. It is never bundled into a release build; see
 * `src/dev/index.ts`.
 */

import { encodeAdvertisement } from '../BleProtocol';
import type { BleScanResult, PeerCapabilities, PresenceStatus } from '../../types';
import type {
  AdvertiseOptions,
  BleAdapterState,
  BleCapabilityReport,
  BlePermissionState,
  BleTransport,
  BleTransportEvents,
  ScanOptions,
} from '../BleTransport';
import { DEFAULT_DISTANCE_MODEL, DistanceModel } from '../RssiProcessor';

export interface SimulatedPeerSpec {
  peerId: string;
  avatarId: string;
  displayTag: string;
  profileVersion: number;
  status: PresenceStatus;
  capabilities?: PeerCapabilities;
  /** Starting position in metres, relative to the user at the origin. */
  x: number;
  y: number;
  /** Metres per second; 0 means stationary. */
  speed?: number;
  /** Set for peers that should wander out of range and back. */
  roams?: boolean;
}

export interface SimulatedBleTransportOptions {
  eventCode: number;
  peers: SimulatedPeerSpec[];
  /** Advertisement interval per peer, in ms. */
  advertiseIntervalMs?: number;
  /** Physics step, in ms. */
  stepMs?: number;
  distanceModel?: DistanceModel;
  /** Deterministic seed so demos and tests reproduce exactly. */
  seed?: number;
  /** Simulate a phone that cannot advertise (common on older Android). */
  supportsPeripheral?: boolean;
  adapterState?: BleAdapterState;
  permission?: BlePermissionState;
}

interface SimPeer extends SimulatedPeerSpec {
  vx: number;
  vy: number;
  /** 'dwell' — standing around; 'travel' — walking to `targetX`/`targetY`. */
  phase: 'dwell' | 'travel';
  /** Steps left in the current phase. Also caps a walk that cannot arrive. */
  phaseFor: number;
  targetX: number;
  targetY: number;
  /** >0 while the peer is temporarily occluded (a body in the way). */
  blockedFor: number;
  nextAdvertAt: number;
}

/**
 * Where people congregate, in metres relative to the user.
 *
 * A hall is not a uniform scatter — it is a handful of busy places with quiet
 * gaps between them. Explicit hubs are what produce knots worth rendering, and
 * what give the clustering code something realistic to chew on.
 */
const HUBS: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0, y: 15 },
  { x: -13, y: -5 },
  { x: 14, y: -7 },
  { x: 3, y: -17 },
  { x: -9, y: 12 },
  { x: 18, y: 8 },
];

/** Mulberry32 — small, fast, seedable. Determinism matters more than quality here. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  // Box-Muller. RSSI noise is close enough to normal for our purposes.
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class SimulatedBleTransport implements BleTransport {
  readonly name = 'simulated';

  private readonly opts: Required<
    Omit<SimulatedBleTransportOptions, 'peers' | 'distanceModel' | 'adapterState' | 'permission'>
  > & {
    distanceModel: DistanceModel;
  };
  private readonly peers: SimPeer[];
  private readonly random: () => number;
  private readonly listeners = new Set<Partial<BleTransportEvents>>();

  private adapterState: BleAdapterState;
  private permission: BlePermissionState;
  private scanning = false;
  private advertising: AdvertiseOptions | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private clock = 0;

  constructor(options: SimulatedBleTransportOptions) {
    this.opts = {
      eventCode: options.eventCode,
      advertiseIntervalMs: options.advertiseIntervalMs ?? 500,
      stepMs: options.stepMs ?? 250,
      seed: options.seed ?? 1337,
      supportsPeripheral: options.supportsPeripheral ?? true,
      distanceModel: options.distanceModel ?? DEFAULT_DISTANCE_MODEL,
    };
    this.random = makeRandom(this.opts.seed);
    this.adapterState = options.adapterState ?? 'powered_on';
    this.permission = options.permission ?? 'granted';

    this.peers = options.peers.map((spec) => ({
      ...spec,
      vx: 0,
      vy: 0,
      // Everyone starts standing still, with dwell timers spread out so the
      // whole room does not set off walking on the same step.
      phase: 'dwell' as const,
      phaseFor: this.dwellSteps(),
      targetX: spec.x,
      targetY: spec.y,
      blockedFor: 0,
      nextAdvertAt: this.random() * this.opts.advertiseIntervalMs,
    }));
  }

  /* ---------------- transport surface ---------------- */

  async getCapabilities(): Promise<BleCapabilityReport> {
    return {
      supportsCentral: true,
      supportsPeripheral: this.opts.supportsPeripheral,
      supportsExtendedAdvertising: false,
      maxAdvertisementBytes: 24,
    };
  }

  async getAdapterState(): Promise<BleAdapterState> {
    return this.adapterState;
  }

  async requestPermissions(): Promise<BlePermissionState> {
    return this.permission;
  }

  async getPermissionState(): Promise<BlePermissionState> {
    return this.permission;
  }

  async requestEnable(): Promise<boolean> {
    if (this.adapterState === 'powered_on') return true;
    this.setAdapterState('powered_on');
    return true;
  }

  async startScan(_options: ScanOptions): Promise<void> {
    this.scanning = true;
    if (this.timer === null) {
      this.timer = setInterval(() => this.step(), this.opts.stepMs);
      // Node keeps the process alive for pending timers; a simulator should not.
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  async stopScan(): Promise<void> {
    this.scanning = false;
  }

  async startAdvertising(options: AdvertiseOptions): Promise<void> {
    this.advertising = options;
  }

  async updateAdvertising(options: AdvertiseOptions): Promise<void> {
    this.advertising = options;
  }

  async stopAdvertising(): Promise<void> {
    this.advertising = null;
  }

  subscribe(events: Partial<BleTransportEvents>): () => void {
    this.listeners.add(events);
    return () => this.listeners.delete(events);
  }

  async destroy(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /* ---------------- simulation controls ---------------- */

  setAdapterState(state: BleAdapterState): void {
    this.adapterState = state;
    for (const listener of this.listeners) listener.onAdapterStateChange?.(state);
  }

  setPermission(permission: BlePermissionState): void {
    this.permission = permission;
  }

  get currentAdvertisement(): AdvertiseOptions | null {
    return this.advertising;
  }

  /**
   * True positions of every simulated peer, in metres relative to the user.
   *
   * Test-only, and named to say so: nothing above the transport seam may read
   * this. The app's whole positioning model exists because these coordinates do
   * not exist on a real device — a caller that reached for them would be
   * inventing exactly the certainty the rest of the codebase refuses to claim.
   */
  debugPeers(): { peerId: string; x: number; y: number }[] {
    return this.peers.map((peer) => ({ peerId: peer.peerId, x: peer.x, y: peer.y }));
  }

  /** Advance the simulation manually — used by tests instead of wall-clock timers. */
  advance(ms: number): void {
    const steps = Math.max(1, Math.round(ms / this.opts.stepMs));
    for (let i = 0; i < steps; i++) this.step();
  }

  /* ---------------- physics + radio ---------------- */

  private step(): void {
    this.clock += this.opts.stepMs;
    if (!this.scanning || this.adapterState !== 'powered_on') return;

    const dt = this.opts.stepMs / 1000;

    for (const peer of this.peers) {
      this.movePeer(peer, dt);

      if (this.clock < peer.nextAdvertAt) continue;
      // Real radios jitter their advertising interval; so do we.
      peer.nextAdvertAt =
        this.clock + this.opts.advertiseIntervalMs * (0.75 + this.random() * 0.5);

      if (peer.blockedFor > 0) {
        peer.blockedFor--;
        // A body between two phones costs 10-20 dB and can drop packets entirely.
        if (this.random() < 0.5) continue;
      } else if (this.random() < 0.02) {
        peer.blockedFor = 2 + Math.floor(this.random() * 6);
      }

      const distance = Math.hypot(peer.x, peer.y);
      if (distance > 45) continue; // genuinely out of radio range

      const rssi = this.rssiFor(distance, peer.blockedFor > 0);
      const advertisement = encodeAdvertisement({
        eventCode: this.opts.eventCode,
        peerId: peer.peerId,
        avatarId: peer.avatarId,
        displayTag: peer.displayTag,
        profileVersion: peer.profileVersion,
        status: peer.status,
        capabilities:
          peer.capabilities ?? {
            acceptsConnections: true,
            supportsNavigation: true,
            isAnchor: false,
          },
      });

      const result: BleScanResult = {
        data: advertisement,
        rssi,
        timestamp: Date.now(),
        deviceKey: `sim:${peer.peerId}`,
      };
      for (const listener of this.listeners) listener.onScanResult?.(result);
    }
  }

  /** 15-75 seconds of standing around, expressed in physics steps. */
  private dwellSteps(): number {
    return Math.floor((15 + this.random() * 60) * (1000 / this.opts.stepMs));
  }

  /** Upper bound on a single walk, so a peer that cannot converge still settles. */
  private travelSteps(): number {
    return Math.floor(45 * (1000 / this.opts.stepMs));
  }

  private movePeer(peer: SimPeer, dt: number): void {
    const speed = peer.speed ?? 0;
    if (speed === 0) return;

    if (--peer.phaseFor <= 0) {
      if (peer.phase === 'dwell') {
        // Set off for another hub. Roamers range wider; everyone else stays in
        // roughly the part of the hall they were seeded into.
        const hub = HUBS[Math.floor(this.random() * HUBS.length)];
        const spread = peer.roams ? 6 : 3.5;
        peer.targetX = hub.x + (this.random() - 0.5) * spread * 2;
        peer.targetY = hub.y + (this.random() - 0.5) * spread * 2;
        peer.phase = 'travel';
        peer.phaseFor = this.travelSteps();
      } else {
        peer.phase = 'dwell';
        peer.phaseFor = this.dwellSteps();
      }
    }

    if (peer.phase === 'travel') {
      const dx = peer.targetX - peer.x;
      const dy = peer.targetY - peer.y;
      const remaining = Math.hypot(dx, dy);

      if (remaining < 0.6) {
        peer.phase = 'dwell';
        peer.phaseFor = this.dwellSteps();
        peer.vx = 0;
        peer.vy = 0;
        return;
      }

      // Walking pace, held for the whole journey. This is the line that stops
      // people jittering across proximity bands.
      const walk = Math.max(speed, 0.9);
      peer.vx = (dx / remaining) * walk;
      peer.vy = (dy / remaining) * walk;
    } else {
      // Standing in a conversation is not standing perfectly still. A slow
      // drift keeps the RSSI pipeline from seeing an unnaturally clean signal,
      // while staying far too small to move anyone between bands.
      peer.vx += (this.random() - 0.5) * 0.08;
      peer.vy += (this.random() - 0.5) * 0.08;
      const drift = Math.hypot(peer.vx, peer.vy);
      const maxDrift = 0.18;
      if (drift > maxDrift) {
        peer.vx *= maxDrift / drift;
        peer.vy *= maxDrift / drift;
      }
    }

    peer.x += peer.vx * dt;
    peer.y += peer.vy * dt;

    // Nobody leaves the building. The previous model let fast peers wander past
    // the 45 m radio horizon and go silent, which is a second reason attendees
    // seemed to vanish: they had genuinely walked out of the event.
    const limit = peer.roams ? 32 : 24;
    const distance = Math.hypot(peer.x, peer.y);
    if (distance > limit) {
      peer.x *= limit / distance;
      peer.y *= limit / distance;
      // Turn them around by re-targeting rather than mirroring the velocity, so
      // the next move is a purposeful walk back in rather than a bounce.
      peer.phase = 'travel';
      peer.phaseFor = this.travelSteps();
      peer.targetX = HUBS[0].x;
      peer.targetY = HUBS[0].y;
    }
  }

  private rssiFor(distance: number, blocked: boolean): number {
    const { txPower, pathLossExponent } = this.opts.distanceModel;
    const clamped = Math.max(distance, 0.3);
    const ideal = txPower - 10 * pathLossExponent * Math.log10(clamped);
    const noise = gaussian(this.random) * 3.5;
    const occlusion = blocked ? -12 - this.random() * 8 : 0;
    return Math.round(Math.max(Math.min(ideal + noise + occlusion, -20), -110));
  }
}
