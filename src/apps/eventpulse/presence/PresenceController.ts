/**
 * PresenceController — the pipeline that turns radio packets into map nodes.
 *
 *   BleScanner ──snapshot──▶ resolve against AttendeeDirectory
 *                         ├▶ RelativePositionEngine (layout)
 *                         ├▶ NavigationService (when finding someone)
 *                         └▶ one aggregated render model
 *
 * Everything above the transport is here, and none of it touches React. The UI
 * subscribes to the model this produces; it never sees a `PeerRecord`, never
 * sees an RSSI value, and never has to know that a person is really a rotating
 * identifier resolved through a cache.
 *
 * Two invariants worth stating:
 *
 *  - **A packet never causes a render.** The scanner aggregates; this class
 *    rebuilds the model once per aggregated snapshot.
 *  - **An unresolved peer is still a person.** If the directory has not caught
 *    up, we render them with their advertised first name and a placeholder
 *    avatar rather than hiding them. Someone standing next to you exists
 *    whether or not the sync finished.
 */

import { BleAdvertiser, type AdvertiserStatus } from '../bluetooth/BleAdvertiser';
import { BleScanner, type ScannerSnapshot, type ScannerStatus, type Scheduler } from '../bluetooth/BleScanner';
import { systemScheduler } from '../bluetooth/BleScanner';
import { PeerRegistry } from '../bluetooth/PeerRegistry';
import type { AdvertisePresence, BleTransport } from '../bluetooth/BleTransport';
import type { EventService } from '../event/EventService';
import { HeadingService, type HeadingState } from '../positioning/HeadingService';
import {
  describeProximity,
  proximityInputFrom,
  type ProximityDescriptor,
} from '../positioning/ProximityEngine';
import { RelativePositionEngine } from '../positioning/RelativePositionEngine';
import { NavigationService, type NavigationState } from '../navigation/NavigationService';
import type { ProfileService } from '../profile/ProfileService';
import { displayTagFor, presenceStatusFor, shouldAdvertise } from '../security/PrivacyService';
import type {
  Attendee,
  EventDetail,
  PeerId,
  PeerRecord,
  PersonCategory,
  PlacedPerson,
  ProfileId,
} from '../types';

export interface NearbyPerson {
  peerId: PeerId;
  /** Resolved from the local directory. Null while the cache catches up. */
  attendee: Attendee | null;
  profileId: ProfileId | null;
  /** Directory name, else the advertised first name, else a neutral placeholder. */
  displayName: string;
  subtitle: string | null;
  category: PersonCategory | null;
  availability: string;
  placement: PlacedPerson;
  proximity: ProximityDescriptor;
  /** True while the peer has gone quiet but is still inside the grace period. */
  fading: boolean;
  isConnection: boolean;
  /** Present so the map can show a resolving state honestly. */
  resolved: boolean;
}

export interface PresenceModel {
  people: NearbyPerson[];
  /** profileId -> metres, for Discover and recommendations. */
  distances: Map<ProfileId, number>;
  scanner: ScannerStatus | null;
  advertiser: AdvertiserStatus | null;
  heading: HeadingState;
  navigation: NavigationState | null;
  updatedAt: number;
}

export interface PresenceControllerOptions {
  transport: BleTransport;
  eventService: EventService;
  profileService: ProfileService;
  scheduler?: Scheduler;
  onModel: (model: PresenceModel) => void;
}

export class PresenceController {
  private transport: BleTransport;
  private readonly eventService: EventService;
  private readonly profileService: ProfileService;
  private readonly scheduler: Scheduler;
  private readonly onModel: (model: PresenceModel) => void;

  private readonly heading = new HeadingService();
  private readonly positions = new RelativePositionEngine();
  private readonly navigation = new NavigationService();

  private registry: PeerRegistry | null = null;
  private scanner: BleScanner | null = null;
  private advertiser: BleAdvertiser | null = null;
  private event: EventDetail | null = null;

  private scannerStatus: ScannerStatus | null = null;
  private advertiserStatus: AdvertiserStatus | null = null;
  private lastSnapshot: ScannerSnapshot | null = null;
  private navigationState: NavigationState | null = null;
  private moving = false;

  constructor(options: PresenceControllerOptions) {
    this.transport = options.transport;
    this.eventService = options.eventService;
    this.profileService = options.profileService;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.onModel = options.onModel;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  /**
   * Swap the radio. The transport is per-event (the simulated crowd is built
   * from the event's attendee set), so this is called on every join. Refuses
   * while a scan is live rather than leaking a running radio.
   */
  setTransport(transport: BleTransport): void {
    if (this.scanner !== null) {
      throw new Error('PresenceController.setTransport called while scanning; stop() first');
    }
    this.transport = transport;
  }

  async start(event: EventDetail): Promise<ScannerStatus> {
    await this.stop();
    this.event = event;

    this.registry = new PeerRegistry({ eventCode: event.bleEventCode });
    this.applyBlocklist();

    this.scanner = new BleScanner({
      transport: this.transport,
      registry: this.registry,
      scheduler: this.scheduler,
      onSnapshot: (snapshot) => this.handleSnapshot(snapshot),
      onStatus: (status) => {
        this.scannerStatus = status;
        this.emit();
      },
    });

    this.advertiser = new BleAdvertiser({
      transport: this.transport,
      scheduler: this.scheduler,
      getPresence: () => this.buildPresence(),
      getNextRotationAt: () => this.eventService.nextRotationAt(),
      onStatus: (status) => {
        this.advertiserStatus = status;
        this.emit();
      },
    });

    const status = await this.scanner.start();
    await this.advertiser.start();
    return status;
  }

  async stop(): Promise<void> {
    await this.scanner?.stop();
    await this.advertiser?.stop();
    this.scanner = null;
    this.advertiser = null;
    this.registry?.clear();
    this.registry = null;
    this.positions.clear();
    this.navigation.stop();
    this.navigationState = null;
    this.lastSnapshot = null;
  }

  /* ---------------------------------------------------------------- *
   * Inputs from the UI layer
   * ---------------------------------------------------------------- */

  setPhase(phase: Parameters<BleScanner['setPhase']>[0]): void {
    this.scanner?.setPhase(phase);
  }

  setBattery(level: number | null, charging: boolean): void {
    this.scanner?.setBattery(level, charging);
  }

  /** Fed by the device sensors; see `useHeadingSensors`. */
  pushMagnetometer(sample: Parameters<HeadingService['pushMagnetometer']>[0]): void {
    this.heading.pushMagnetometer(sample);
  }

  pushGyroscope(sample: Parameters<HeadingService['pushGyroscope']>[0]): void {
    this.heading.pushGyroscope(sample);
  }

  pushPlatformHeading(sample: Parameters<HeadingService['pushPlatformHeading']>[0]): void {
    this.heading.pushPlatformHeading(sample);
  }

  /** Step detection / accelerometer energy; gates the walk-gradient estimator. */
  setMoving(moving: boolean): void {
    this.moving = moving;
  }

  headingState(): HeadingState {
    return this.heading.getState();
  }

  /** Re-read privacy and availability, and push a fresh advertisement. */
  async refreshAdvertisement(): Promise<void> {
    await this.advertiser?.refresh();
  }

  /** Called after a block, an unblock, or a directory sync. */
  applyBlocklist(): void {
    const directory = this.eventService.directory;
    if (!directory || !this.registry) return;
    this.registry.setSuppressed(directory.blockedPeerIds());
  }

  /** Rebuild the model against a freshly-synced directory. */
  refreshFromDirectory(): void {
    this.applyBlocklist();
    if (this.lastSnapshot) this.handleSnapshot(this.lastSnapshot);
  }

  /* ---------------------------------------------------------------- *
   * Navigation
   * ---------------------------------------------------------------- */

  startNavigation(peerId: PeerId): void {
    this.navigation.start(peerId, this.scheduler.now());
    this.scanner?.setNavigating(true);
    if (this.lastSnapshot) this.handleSnapshot(this.lastSnapshot);
  }

  stopNavigation(): void {
    this.navigation.stop();
    this.navigationState = null;
    this.scanner?.setNavigating(false);
    this.emit();
  }

  get navigationTarget(): PeerId | null {
    return this.navigation.target;
  }

  /* ---------------------------------------------------------------- *
   * The model
   * ---------------------------------------------------------------- */

  private handleSnapshot(snapshot: ScannerSnapshot): void {
    this.lastSnapshot = snapshot;
    const directory = this.eventService.directory;
    const now = snapshot.at;

    // Opportunistically note anyone advertising a newer profile than we hold.
    for (const change of snapshot.changes) {
      if (change.kind === 'profile_version_changed' && change.record) {
        this.eventService.noteProfileVersion(
          change.peerId,
          change.record.advertisement.profileVersion,
        );
      }
    }

    const placements = this.positions.update(
      snapshot.peers.map((record) => proximityInputFrom(record, undefined, now)),
      now,
    );
    const placementById = new Map(placements.map((placement) => [placement.peerId, placement]));

    const people: NearbyPerson[] = [];
    const distances = new Map<ProfileId, number>();

    for (const record of snapshot.peers) {
      const placement = placementById.get(record.peerId);
      if (!placement) continue;

      const attendee = directory?.resolvePeer(record.peerId) ?? null;
      // Belt and braces: the registry already drops blocked peers, but a race
      // between a block and the next snapshot must never render them.
      if (attendee?.isBlocked) continue;
      if (attendee?.visibility === 'invisible') continue;

      people.push(this.buildPerson(record, placement, attendee, now));
      if (attendee) distances.set(attendee.profile.id, record.estimatedDistance);
    }

    this.updateNavigation(snapshot, now);
    this.emit(people, distances, now);
  }

  private buildPerson(
    record: PeerRecord,
    placement: PlacedPerson,
    attendee: Attendee | null,
    now: number,
  ): NearbyPerson {
    const proximity = describeProximity(record, now);
    const advertised = record.advertisement.displayTag.trim();

    return {
      peerId: record.peerId,
      attendee,
      profileId: attendee?.profile.id ?? null,
      displayName: attendee?.profile.name ?? (advertised || 'Someone nearby'),
      subtitle: attendee ? subtitleFor(attendee) : null,
      category: attendee?.profile.category ?? null,
      availability: attendee?.eventProfile.availability ?? record.advertisement.status,
      placement,
      proximity,
      fading: record.state === 'out_of_range',
      isConnection: attendee?.isConnection ?? false,
      resolved: attendee !== null,
    };
  }

  private updateNavigation(snapshot: ScannerSnapshot, now: number): void {
    const target = this.navigation.target;
    if (!target) {
      this.navigationState = null;
      return;
    }

    const record = snapshot.peers.find((peer) => peer.peerId === target);
    const headingState = this.heading.getState();

    if (record) {
      this.navigation.push({
        heading: headingState.heading,
        rssi: record.rssi,
        distance: record.estimatedDistance,
        timestamp: now,
        moving: this.moving,
      });
    }

    this.navigationState = this.navigation.getState(
      {
        band: record?.band ?? 'far',
        distance: record?.estimatedDistance ?? Number.POSITIVE_INFINITY,
        trend: record?.trend ?? 'steady',
        heading: headingState.heading,
        present: Boolean(record),
      },
      now,
    );
  }

  /** Assemble our own advertisement, or null when we must stay silent. */
  private buildPresence(): AdvertisePresence | null {
    const event = this.event;
    const profile = this.profileService.current;
    const privacy = this.profileService.privacySettings;
    if (!event || !profile || !privacy) return null;

    const eventProfile = this.profileService.eventProfile(event.id);
    const availability = eventProfile?.availability ?? 'available';
    if (!shouldAdvertise(privacy, availability)) return null;

    const peerId = this.eventService.currentPeerId();
    const avatarId = this.eventService.avatarId();
    if (!peerId || !avatarId) return null;

    return {
      eventCode: event.bleEventCode,
      peerId,
      avatarId,
      displayTag: displayTagFor(profile, privacy),
      profileVersion: profile.version & 0xff,
      status: presenceStatusFor(availability),
      capabilities: {
        acceptsConnections: privacy.allowConnectionRequests,
        supportsNavigation: true,
        isAnchor: false,
      },
    };
  }

  private lastPeople: NearbyPerson[] = [];
  private lastDistances = new Map<ProfileId, number>();

  private emit(
    people: NearbyPerson[] = this.lastPeople,
    distances: Map<ProfileId, number> = this.lastDistances,
    now: number = this.scheduler.now(),
  ): void {
    this.lastPeople = people;
    this.lastDistances = distances;
    this.onModel({
      people,
      distances,
      scanner: this.scannerStatus,
      advertiser: this.advertiserStatus,
      heading: this.heading.getState(),
      navigation: this.navigationState,
      updatedAt: now,
    });
  }
}

function subtitleFor(attendee: Attendee): string | null {
  const { role, company } = attendee.profile;
  if (role && company) return `${role} · ${company}`;
  return role ?? company ?? null;
}
