/**
 * PeerRegistry — the single source of truth for "who is physically near me".
 *
 * Responsibilities
 *  - Deduplicate: a phone advertising at 10 Hz on three channels produces a
 *    torrent of identical packets. One peer id is always exactly one record.
 *  - Filter by event: packets from other EventPulse events are dropped before
 *    any allocation.
 *  - Run the presence state machine (see docs/ARCHITECTURE.md).
 *  - Enforce TTLs so people who walk away fade out instead of lingering, and
 *    linger briefly instead of vanishing mid-conversation.
 *  - Stay synchronous and timer-free so it is trivially testable. Throttling
 *    and scheduling belong to `BleScanner`.
 *
 * This class does no React work and holds no UI state.
 */

import type {
  BleAdvertisement,
  BleScanResult,
  PeerId,
  PeerRecord,
  PeerState,
  ProximityBand,
} from '../types';
import { matchesEvent, tryDecodeAdvertisement } from './BleProtocol';
import {
  DEFAULT_DISTANCE_MODEL,
  DistanceModel,
  RssiFilter,
  RssiFilterOptions,
  classifyBand,
  estimateDistance,
} from './RssiProcessor';

export type PeerChangeKind =
  | 'added'
  | 'state_changed'
  | 'band_changed'
  | 'profile_version_changed'
  | 'removed';

export interface PeerChange {
  kind: PeerChangeKind;
  peerId: PeerId;
  record?: PeerRecord;
  previousState?: PeerState;
  previousBand?: ProximityBand;
}

export interface PeerRegistryOptions {
  eventCode: number;
  /** Packets must arrive within this window to keep a peer `active`. */
  activeAfterMs?: number;
  /** No packet for this long -> `out_of_range` (still rendered, faded). */
  staleAfterMs?: number;
  /** No packet for this long -> `expired` and removed. */
  expireAfterMs?: number;
  /** Identical (peer, rssi) inside this window is treated as a channel duplicate. */
  duplicateWindowMs?: number;
  /** Upper bound on tracked peers; the weakest signal is evicted past this. */
  maxPeers?: number;
  distanceModel?: DistanceModel;
  rssiOptions?: RssiFilterOptions;
}

const DEFAULTS = {
  activeAfterMs: 5_000,
  staleAfterMs: 12_000,
  expireAfterMs: 30_000,
  duplicateWindowMs: 25,
  maxPeers: 600,
};

interface PeerSlot {
  record: PeerRecord;
  filter: RssiFilter;
  lastRawRssi: number;
  lastRawAt: number;
}

export interface IngestResult {
  accepted: boolean;
  reason?: 'wrong_event' | 'undecodable' | 'suppressed' | 'duplicate' | 'capacity';
  peerId?: PeerId;
}

export class PeerRegistry {
  private readonly slots = new Map<PeerId, PeerSlot>();
  private readonly suppressed = new Set<PeerId>();
  private readonly opts: Required<Omit<PeerRegistryOptions, 'rssiOptions' | 'distanceModel'>> & {
    distanceModel: DistanceModel;
    rssiOptions: RssiFilterOptions;
  };

  /** Bumped on every observable change; lets the UI skip no-op re-renders. */
  private revision = 0;
  private pending: PeerChange[] = [];

  constructor(options: PeerRegistryOptions) {
    this.opts = {
      eventCode: options.eventCode,
      activeAfterMs: options.activeAfterMs ?? DEFAULTS.activeAfterMs,
      staleAfterMs: options.staleAfterMs ?? DEFAULTS.staleAfterMs,
      expireAfterMs: options.expireAfterMs ?? DEFAULTS.expireAfterMs,
      duplicateWindowMs: options.duplicateWindowMs ?? DEFAULTS.duplicateWindowMs,
      maxPeers: options.maxPeers ?? DEFAULTS.maxPeers,
      distanceModel: options.distanceModel ?? DEFAULT_DISTANCE_MODEL,
      rssiOptions: options.rssiOptions ?? {},
    };
  }

  get eventCode(): number {
    return this.opts.eventCode;
  }

  get version(): number {
    return this.revision;
  }

  get size(): number {
    return this.slots.size;
  }

  /* ---------------------------------------------------------------- *
   * Blocking
   * ---------------------------------------------------------------- */

  /**
   * Peers whose packets are dropped outright. Blocked people must not appear on
   * the map, must not be reachable, and must not reappear after a restart, so
   * we refuse them at the edge rather than filtering at render time.
   */
  setSuppressed(peerIds: Iterable<PeerId>): void {
    this.suppressed.clear();
    for (const id of peerIds) {
      this.suppressed.add(id);
      if (this.slots.has(id)) {
        this.slots.delete(id);
        this.pending.push({ kind: 'removed', peerId: id });
        this.revision++;
      }
    }
  }

  isSuppressed(peerId: PeerId): boolean {
    return this.suppressed.has(peerId);
  }

  /* ---------------------------------------------------------------- *
   * Ingest
   * ---------------------------------------------------------------- */

  ingest(result: BleScanResult): IngestResult {
    // Two-byte pre-filter first: in a dense hall most packets are not ours.
    if (!matchesEvent(result.data, this.opts.eventCode)) {
      return { accepted: false, reason: 'wrong_event' };
    }

    const advertisement = tryDecodeAdvertisement(result.data);
    if (!advertisement) return { accepted: false, reason: 'undecodable' };
    if (advertisement.eventCode !== this.opts.eventCode) {
      return { accepted: false, reason: 'wrong_event' };
    }
    if (this.suppressed.has(advertisement.peerId)) {
      return { accepted: false, reason: 'suppressed', peerId: advertisement.peerId };
    }

    const existing = this.slots.get(advertisement.peerId);
    if (existing) {
      return this.updateSlot(existing, advertisement, result);
    }

    if (this.slots.size >= this.opts.maxPeers && !this.evictWeakest(result.rssi)) {
      return { accepted: false, reason: 'capacity', peerId: advertisement.peerId };
    }
    return this.createSlot(advertisement, result);
  }

  private createSlot(advertisement: BleAdvertisement, result: BleScanResult): IngestResult {
    const filter = new RssiFilter(this.opts.rssiOptions);
    const smoothed = filter.push(result.rssi);
    const distance = estimateDistance(smoothed, this.opts.distanceModel);
    const band = classifyBand(distance);

    const record: PeerRecord = {
      peerId: advertisement.peerId,
      eventCode: advertisement.eventCode,
      state: 'discovered',
      advertisement,
      rssi: smoothed,
      rawRssi: result.rssi,
      band,
      estimatedDistance: distance,
      trend: 'steady',
      firstSeen: result.timestamp,
      lastSeen: result.timestamp,
      packets: 1,
    };

    this.slots.set(record.peerId, {
      record,
      filter,
      lastRawRssi: result.rssi,
      lastRawAt: result.timestamp,
    });
    this.pending.push({ kind: 'added', peerId: record.peerId, record });
    this.revision++;
    return { accepted: true, peerId: record.peerId };
  }

  private updateSlot(
    slot: PeerSlot,
    advertisement: BleAdvertisement,
    result: BleScanResult,
  ): IngestResult {
    // A true channel duplicate: same peer, same RSSI, within milliseconds.
    // Counting it would bias the average; ignoring it entirely is correct.
    if (
      result.rssi === slot.lastRawRssi &&
      result.timestamp - slot.lastRawAt < this.opts.duplicateWindowMs
    ) {
      slot.record.lastSeen = result.timestamp;
      return { accepted: false, reason: 'duplicate', peerId: advertisement.peerId };
    }

    const record = slot.record;
    const previousBand = record.band;
    const previousState = record.state;
    const previousProfileVersion = record.advertisement.profileVersion;

    slot.lastRawRssi = result.rssi;
    slot.lastRawAt = result.timestamp;

    const smoothed = slot.filter.push(result.rssi);
    record.rssi = smoothed;
    record.rawRssi = result.rssi;
    record.estimatedDistance = estimateDistance(smoothed, this.opts.distanceModel);
    record.band = classifyBand(record.estimatedDistance, previousBand);
    record.trend = slot.filter.trend;
    record.advertisement = advertisement;
    record.lastSeen = result.timestamp;
    record.packets++;

    const nextState = this.deriveState(record, slot, result.timestamp);
    if (nextState !== previousState) {
      record.state = nextState;
      this.pending.push({
        kind: 'state_changed',
        peerId: record.peerId,
        record,
        previousState,
      });
      this.revision++;
    }

    if (record.band !== previousBand) {
      this.pending.push({
        kind: 'band_changed',
        peerId: record.peerId,
        record,
        previousBand,
      });
      this.revision++;
    }

    if (advertisement.profileVersion !== previousProfileVersion) {
      // The peer edited their profile. We do NOT open a BLE connection to fetch
      // it — the directory sync will pick it up; this is only a hint.
      this.pending.push({
        kind: 'profile_version_changed',
        peerId: record.peerId,
        record,
      });
      this.revision++;
    }

    return { accepted: true, peerId: record.peerId };
  }

  private deriveState(record: PeerRecord, slot: PeerSlot, now: number): PeerState {
    const age = now - record.lastSeen;
    if (age >= this.opts.expireAfterMs) return 'expired';
    if (age >= this.opts.staleAfterMs) return 'out_of_range';
    if (!slot.filter.isWarm) return 'discovered';
    return age < this.opts.activeAfterMs ? 'active' : 'nearby';
  }

  /**
   * Drop the weakest tracked peer to make room for a stronger one. Returns
   * false when the incoming signal is not worth the eviction.
   */
  private evictWeakest(incomingRssi: number): boolean {
    let weakestId: PeerId | null = null;
    let weakestRssi = Number.POSITIVE_INFINITY;
    for (const [id, slot] of this.slots) {
      if (slot.record.rssi < weakestRssi) {
        weakestRssi = slot.record.rssi;
        weakestId = id;
      }
    }
    if (weakestId === null || weakestRssi >= incomingRssi) return false;
    this.slots.delete(weakestId);
    this.pending.push({ kind: 'removed', peerId: weakestId });
    this.revision++;
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Time advance
   * ---------------------------------------------------------------- */

  /**
   * Advance TTLs. Call on a fixed cadence (the scanner uses 1 Hz), never from
   * the packet path. Returns the changes produced by ageing alone.
   */
  tick(now: number): PeerChange[] {
    const changes: PeerChange[] = [];
    for (const [peerId, slot] of this.slots) {
      const record = slot.record;
      const previousState = record.state;
      const nextState = this.deriveState(record, slot, now);
      if (nextState === previousState) continue;

      if (nextState === 'expired') {
        this.slots.delete(peerId);
        changes.push({ kind: 'removed', peerId, previousState });
      } else {
        record.state = nextState;
        changes.push({ kind: 'state_changed', peerId, record, previousState });
      }
      this.revision++;
    }
    if (changes.length) this.pending.push(...changes);
    return changes;
  }

  /* ---------------------------------------------------------------- *
   * Read + drain
   * ---------------------------------------------------------------- */

  get(peerId: PeerId): PeerRecord | undefined {
    return this.slots.get(peerId)?.record;
  }

  /** All tracked peers, strongest signal first. */
  getAll(): PeerRecord[] {
    const out: PeerRecord[] = [];
    for (const slot of this.slots.values()) out.push(slot.record);
    out.sort((a, b) => b.rssi - a.rssi);
    return out;
  }

  /** Peers a user would consider "here": everything except expired. */
  getVisible(): PeerRecord[] {
    return this.getAll().filter((r) => r.state !== 'expired');
  }

  /** Take and clear the accumulated changes. Called by the throttled flush. */
  drainChanges(): PeerChange[] {
    if (this.pending.length === 0) return [];
    const out = this.pending;
    this.pending = [];
    return out;
  }

  clear(): void {
    if (this.slots.size === 0) return;
    for (const peerId of this.slots.keys()) this.pending.push({ kind: 'removed', peerId });
    this.slots.clear();
    this.revision++;
  }
}
