/**
 * RelativePositionEngine — turns proximity into a spatial layout.
 *
 * Honesty first. A single RSSI reading gives you *one* number: roughly how far
 * away someone is. It tells you nothing about direction. So this engine does
 * not pretend to know where people are. What it produces is:
 *
 *   radius  = the smoothed distance estimate           (measured, low precision)
 *   bearing = a stable, deterministic angle per peer   (a layout, not a measurement)
 *
 * The bearing is derived from the peer id, so it is identical on every launch
 * and never jitters — a person does not swing around you as packets arrive.
 * Two things can replace it with something real:
 *
 *   1. `bearingHint` from the anchor solver, when the venue has BLE beacons
 *      (see AnchorSolver.ts). Then the layout becomes a genuine position.
 *   2. `bearingHint` from `NavigationService`, which infers direction from how
 *      the signal changes as the user turns and walks.
 *
 * `confidence` is carried all the way to the UI so the map can render a
 * measured position differently from a laid-out one. Never show a laid-out
 * bearing as though it were surveyed.
 */

import type { PlacedPerson, ProximityBand, RelativePoint } from '../types';
import { fnv1a32 } from '../utils/bytes';
import { angleDelta, normaliseDegrees } from './HeadingService';

export interface PositionInput {
  peerId: string;
  /** Smoothed distance estimate in metres. */
  distance: number;
  band: ProximityBand;
  /** 0..1 confidence in the distance estimate (filter warmth, packet rate). */
  distanceConfidence?: number;
  /** A real directional measurement, when one exists. */
  bearingHint?: { bearing: number; confidence: number };
}

export interface RelativePositionOptions {
  /** Fraction of the remaining gap closed per update. Lower = smoother. */
  radiusSmoothing?: number;
  bearingSmoothing?: number;
  /** Hard cap on movement per update, in metres, so nobody teleports. */
  maxRadiusStep?: number;
  /** Hard cap on angular movement per update, in degrees. */
  maxBearingStep?: number;
  /** Minimum angular gap between two peers at a similar radius, in degrees. */
  minAngularSeparation?: number;
  /** Radii within this many metres count as "the same ring" for separation. */
  ringToleranceMeters?: number;
  separationIterations?: number;
}

const DEFAULTS: Required<RelativePositionOptions> = {
  radiusSmoothing: 0.18,
  bearingSmoothing: 0.22,
  maxRadiusStep: 1.2,
  maxBearingStep: 12,
  minAngularSeparation: 14,
  ringToleranceMeters: 2.5,
  separationIterations: 3,
};

interface PeerLayout {
  peerId: string;
  radius: number;
  bearing: number;
  targetRadius: number;
  targetBearing: number;
  confidence: number;
  band: ProximityBand;
  distance: number;
}

export class RelativePositionEngine {
  private readonly opts: Required<RelativePositionOptions>;
  private readonly layouts = new Map<string, PeerLayout>();

  constructor(options: RelativePositionOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * A deterministic angle for a peer id.
   *
   * Uses the golden-angle sequence over the hash so ids that arrive together
   * spread out instead of clumping — a hash mapped straight to degrees clusters
   * badly at small crowd sizes.
   */
  static stableBearing(peerId: string): number {
    const hash = fnv1a32(peerId);
    return normaliseDegrees((hash % 100000) * 0.0036 * 137.508);
  }

  update(inputs: readonly PositionInput[], _now = 0): PlacedPerson[] {
    const seen = new Set<string>();

    for (const input of inputs) {
      seen.add(input.peerId);
      const targetBearing = input.bearingHint
        ? normaliseDegrees(input.bearingHint.bearing)
        : RelativePositionEngine.stableBearing(input.peerId);
      const bearingConfidence = input.bearingHint?.confidence ?? 0.15;
      const distanceConfidence = input.distanceConfidence ?? 0.5;

      const existing = this.layouts.get(input.peerId);
      if (!existing) {
        this.layouts.set(input.peerId, {
          peerId: input.peerId,
          radius: input.distance,
          bearing: targetBearing,
          targetRadius: input.distance,
          targetBearing,
          // A placement is only as good as its weaker half.
          confidence: Math.min(distanceConfidence, Math.max(bearingConfidence, 0.15)),
          band: input.band,
          distance: input.distance,
        });
        continue;
      }

      existing.targetRadius = input.distance;
      existing.targetBearing = targetBearing;
      existing.band = input.band;
      existing.distance = input.distance;
      existing.confidence = Math.min(distanceConfidence, Math.max(bearingConfidence, 0.15));
    }

    for (const peerId of [...this.layouts.keys()]) {
      if (!seen.has(peerId)) this.layouts.delete(peerId);
    }

    this.step();
    this.separate();

    const out: PlacedPerson[] = [];
    for (const layout of this.layouts.values()) {
      out.push({
        peerId: layout.peerId,
        position: polarToCartesian(layout.radius, layout.bearing),
        bearing: layout.bearing,
        band: layout.band,
        estimatedDistance: layout.distance,
        confidence: layout.confidence,
      });
    }
    return out;
  }

  /** Ease every peer toward its target, with a hard per-frame cap. */
  private step(): void {
    for (const layout of this.layouts.values()) {
      const radiusGap = layout.targetRadius - layout.radius;
      const radiusStep = clampMagnitude(
        radiusGap * this.opts.radiusSmoothing,
        this.opts.maxRadiusStep,
      );
      layout.radius = Math.max(0.4, layout.radius + radiusStep);

      const bearingGap = angleDelta(layout.bearing, layout.targetBearing);
      const bearingStep = clampMagnitude(
        bearingGap * this.opts.bearingSmoothing,
        this.opts.maxBearingStep,
      );
      layout.bearing = normaliseDegrees(layout.bearing + bearingStep);
    }
  }

  /**
   * Push apart peers that would render on top of each other.
   *
   * Only peers on the same "ring" (similar radius) can collide visually, so we
   * bucket by radius first — that keeps this near-linear instead of O(n²) in a
   * crowded hall.
   */
  private separate(): void {
    const layouts = [...this.layouts.values()];
    if (layouts.length < 2) return;

    const rings = new Map<number, PeerLayout[]>();
    for (const layout of layouts) {
      const ring = Math.floor(layout.radius / this.opts.ringToleranceMeters);
      // Peers near a bucket edge belong to both, or they slip past each other.
      for (const key of [ring, ring + 1]) {
        const bucket = rings.get(key);
        if (bucket) bucket.push(layout);
        else rings.set(key, [layout]);
      }
    }

    for (let iteration = 0; iteration < this.opts.separationIterations; iteration++) {
      for (const bucket of rings.values()) {
        if (bucket.length < 2) continue;
        bucket.sort((a, b) => a.bearing - b.bearing);

        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          const b = bucket[(i + 1) % bucket.length];
          if (a === b) continue;
          if (Math.abs(a.radius - b.radius) > this.opts.ringToleranceMeters) continue;

          const gap = angleDelta(a.bearing, b.bearing);
          const absGap = Math.abs(gap);
          if (absGap >= this.opts.minAngularSeparation) continue;

          // Closer peers hold their ground; distant ones give way, because the
          // near node is the one the user is most likely to be looking at.
          const push = (this.opts.minAngularSeparation - absGap) / 2;
          const direction = gap === 0 ? 1 : Math.sign(gap);
          const aWeight = a.radius <= b.radius ? 0.3 : 0.7;
          a.bearing = normaliseDegrees(a.bearing - direction * push * aWeight * 2);
          b.bearing = normaliseDegrees(b.bearing + direction * push * (1 - aWeight) * 2);
        }
      }
    }
  }

  get(peerId: string): PlacedPerson | undefined {
    const layout = this.layouts.get(peerId);
    if (!layout) return undefined;
    return {
      peerId: layout.peerId,
      position: polarToCartesian(layout.radius, layout.bearing),
      bearing: layout.bearing,
      band: layout.band,
      estimatedDistance: layout.distance,
      confidence: layout.confidence,
    };
  }

  clear(): void {
    this.layouts.clear();
  }
}

/**
 * Polar -> Cartesian in the app's convention: +Y is "ahead of the user",
 * bearings run clockwise, and the user sits at the origin.
 */
export function polarToCartesian(radius: number, bearingDeg: number): RelativePoint {
  const rad = (bearingDeg * Math.PI) / 180;
  return { x: radius * Math.sin(rad), y: radius * Math.cos(rad) };
}

export function cartesianToPolar(point: RelativePoint): { radius: number; bearing: number } {
  return {
    radius: Math.hypot(point.x, point.y),
    bearing: normaliseDegrees((Math.atan2(point.x, point.y) * 180) / Math.PI),
  };
}

function clampMagnitude(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
