/**
 * NavigationService — "Find Me".
 *
 * The honest problem: BLE gives distance-ish, not direction. A naive
 * implementation draws an arrow anyway and sends people the wrong way. This
 * one earns its arrow, and says so when it hasn't.
 *
 * Two estimators run in parallel:
 *
 * **Rotation fit.** A phone's own body attenuates 2.4 GHz noticeably. As the
 * user turns, the signal from a fixed transmitter rises and falls roughly
 * sinusoidally with heading. Fitting `rssi ≈ A + B·cos(h) + C·sin(h)` by least
 * squares gives a peak direction `atan2(C, B)` — a real, if coarse, bearing.
 * It needs the user to sweep across a decent range of headings, which is why
 * the UI asks them to "turn slowly" while it acquires.
 *
 * **Walk gradient.** While walking, if heading `h` coincides with the distance
 * estimate falling, the target lies roughly along `h`. Displacement samples are
 * accumulated as vectors weighted by how much the distance dropped.
 *
 * The two are blended by confidence. Until combined confidence clears a
 * threshold the UI shows *no arrow at all* — just distance band and trend,
 * which are things we genuinely measure. That is the difference between a tool
 * and a toy.
 */

import type { PeerId, ProximityBand, SignalTrend } from '../types';
import { bandLabel, bandRangeLabel, trendLabel } from '../bluetooth/RssiProcessor';
import { angleDelta, normaliseDegrees } from '../positioning/HeadingService';
import { relativeDirectionLabel } from '../positioning/ProximityEngine';

export type NavigationPhase = 'acquiring' | 'guiding' | 'arrived' | 'lost';

export interface NavigationSample {
  /** Device heading in degrees from north at the moment of the reading. */
  heading: number;
  /** Smoothed RSSI for the target. */
  rssi: number;
  /** Smoothed distance estimate in metres. */
  distance: number;
  timestamp: number;
  /** True when the user was moving (step detector / accelerometer energy). */
  moving: boolean;
}

export interface NavigationState {
  targetPeerId: PeerId;
  phase: NavigationPhase;
  band: ProximityBand;
  bandLabel: string;
  rangeLabel: string;
  trend: SignalTrend;
  trendLabel: string;
  /** Bearing to the target relative to the user's facing, or null when unknown. */
  relativeBearing: number | null;
  bearingConfidence: number;
  /** "ahead and to your right" — only set when we have a bearing. */
  directionLabel: string | null;
  /** The single line of guidance shown under the arrow. */
  guidance: string;
  updatedAt: number;
}

export interface NavigationOptions {
  /** Bearing confidence needed before an arrow is shown at all. */
  minBearingConfidence?: number;
  /** Distance below which we declare arrival. */
  arrivalMeters?: number;
  /** No fresh sample for this long -> `lost`. */
  lostAfterMs?: number;
  /** Samples older than this stop contributing to the fit. */
  sampleWindowMs?: number;
  maxSamples?: number;
}

const DEFAULTS: Required<NavigationOptions> = {
  minBearingConfidence: 0.45,
  arrivalMeters: 2.5,
  lostAfterMs: 12_000,
  sampleWindowMs: 45_000,
  maxSamples: 240,
};

interface WalkVector {
  x: number;
  y: number;
  weight: number;
}

export class NavigationService {
  private readonly opts: Required<NavigationOptions>;
  private samples: NavigationSample[] = [];
  private walk: WalkVector = { x: 0, y: 0, weight: 0 };
  private previous: NavigationSample | null = null;
  private targetPeerId: PeerId | null = null;
  private startedAt = 0;
  private lastSampleAt = 0;
  private arrivedAt: number | null = null;

  constructor(options: NavigationOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  start(peerId: PeerId, now: number): void {
    this.targetPeerId = peerId;
    this.samples = [];
    this.walk = { x: 0, y: 0, weight: 0 };
    this.previous = null;
    this.startedAt = now;
    this.lastSampleAt = now;
    this.arrivedAt = null;
  }

  stop(): void {
    this.targetPeerId = null;
    this.samples = [];
    this.walk = { x: 0, y: 0, weight: 0 };
    this.previous = null;
    this.arrivedAt = null;
  }

  get isActive(): boolean {
    return this.targetPeerId !== null;
  }

  get target(): PeerId | null {
    return this.targetPeerId;
  }

  push(sample: NavigationSample): void {
    if (!this.targetPeerId) return;
    this.lastSampleAt = sample.timestamp;

    this.samples.push(sample);
    const cutoff = sample.timestamp - this.opts.sampleWindowMs;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) this.samples.shift();
    while (this.samples.length > this.opts.maxSamples) this.samples.shift();

    if (this.previous && sample.moving) {
      const deltaDistance = this.previous.distance - sample.distance;
      const dt = (sample.timestamp - this.previous.timestamp) / 1000;
      // Only trust a step that is big enough to be a step and short enough that
      // the user did not wander off in another direction meanwhile.
      if (dt > 0.2 && dt < 4 && Math.abs(deltaDistance) > 0.4) {
        const rad = (sample.heading * Math.PI) / 180;
        const weight = Math.min(Math.abs(deltaDistance), 3);
        const sign = deltaDistance > 0 ? 1 : -1;
        this.walk.x += Math.sin(rad) * weight * sign;
        this.walk.y += Math.cos(rad) * weight * sign;
        this.walk.weight += weight;
      }
    }
    this.previous = sample;
  }

  /* ---------------------------------------------------------------- *
   * Estimators
   * ---------------------------------------------------------------- */

  /**
   * Least-squares fit of `rssi = A + B·cos(h) + C·sin(h)`.
   * Returns an absolute bearing (degrees from north) plus a confidence.
   */
  private rotationFit(): { bearing: number; confidence: number } | null {
    if (this.samples.length < 12) return null;

    let n = 0;
    let sumR = 0;
    let sumC = 0;
    let sumS = 0;
    let sumCC = 0;
    let sumSS = 0;
    let sumCS = 0;
    let sumRC = 0;
    let sumRS = 0;

    for (const sample of this.samples) {
      const rad = (sample.heading * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      n++;
      sumR += sample.rssi;
      sumC += c;
      sumS += s;
      sumCC += c * c;
      sumSS += s * s;
      sumCS += c * s;
      sumRC += sample.rssi * c;
      sumRS += sample.rssi * s;
    }

    // Solve the 3x3 normal equations for [A, B, C] by Cramer's rule.
    const m = [
      [n, sumC, sumS],
      [sumC, sumCC, sumCS],
      [sumS, sumCS, sumSS],
    ];
    const rhs = [sumR, sumRC, sumRS];
    const det = determinant3(m);
    if (Math.abs(det) < 1e-6) return null;

    const B = determinant3(replaceColumn(m, 1, rhs)) / det;
    const C = determinant3(replaceColumn(m, 2, rhs)) / det;
    const A = determinant3(replaceColumn(m, 0, rhs)) / det;

    const amplitude = Math.hypot(B, C);
    if (amplitude < 0.8) return null; // no directional structure worth reporting

    // Residual noise tells us whether the fit means anything.
    let residualSq = 0;
    for (const sample of this.samples) {
      const rad = (sample.heading * Math.PI) / 180;
      const predicted = A + B * Math.cos(rad) + C * Math.sin(rad);
      residualSq += (sample.rssi - predicted) ** 2;
    }
    const rms = Math.sqrt(residualSq / n);
    const snr = amplitude / Math.max(rms, 0.5);

    const coverage = headingCoverage(this.samples.map((s) => s.heading));
    const confidence = clamp01(
      Math.min(snr / 2.5, 1) * coverage * Math.min(n / 40, 1),
    );

    return { bearing: normaliseDegrees((Math.atan2(C, B) * 180) / Math.PI), confidence };
  }

  private walkEstimate(): { bearing: number; confidence: number } | null {
    if (this.walk.weight < 2) return null;
    const magnitude = Math.hypot(this.walk.x, this.walk.y);
    if (magnitude < 0.5) return null;
    // Coherence: a consistent direction has magnitude close to total weight;
    // random wandering cancels out.
    const coherence = clamp01(magnitude / this.walk.weight);
    return {
      bearing: normaliseDegrees((Math.atan2(this.walk.x, this.walk.y) * 180) / Math.PI),
      confidence: clamp01(coherence * Math.min(this.walk.weight / 6, 1)),
    };
  }

  /* ---------------------------------------------------------------- *
   * State
   * ---------------------------------------------------------------- */

  getState(
    current: {
      band: ProximityBand;
      distance: number;
      trend: SignalTrend;
      heading: number;
      present: boolean;
    },
    now: number,
  ): NavigationState | null {
    if (!this.targetPeerId) return null;

    const rotation = this.rotationFit();
    const walk = this.walkEstimate();
    const fused = fuseBearings(rotation, walk);

    const hasBearing = fused !== null && fused.confidence >= this.opts.minBearingConfidence;
    const relativeBearing = hasBearing ? angleDelta(current.heading, fused!.bearing) : null;

    let phase: NavigationPhase;
    if (!current.present && now - this.lastSampleAt > this.opts.lostAfterMs) {
      phase = 'lost';
    } else if (current.distance <= this.opts.arrivalMeters && current.band === 'very_close') {
      phase = 'arrived';
      if (this.arrivedAt === null) this.arrivedAt = now;
    } else if (hasBearing) {
      phase = 'guiding';
    } else {
      phase = 'acquiring';
    }

    return {
      targetPeerId: this.targetPeerId,
      phase,
      band: current.band,
      bandLabel: bandLabel(current.band),
      rangeLabel: bandRangeLabel(current.band),
      trend: current.trend,
      trendLabel: trendLabel(current.trend),
      relativeBearing,
      bearingConfidence: fused?.confidence ?? 0,
      directionLabel:
        relativeBearing === null ? null : relativeDirectionLabel(normaliseDegrees(relativeBearing)),
      guidance: guidanceFor(phase, current.trend, relativeBearing, now - this.startedAt),
      updatedAt: now,
    };
  }
}

function guidanceFor(
  phase: NavigationPhase,
  trend: SignalTrend,
  relativeBearing: number | null,
  elapsedMs: number,
): string {
  switch (phase) {
    case 'arrived':
      return 'You should be able to see them from here';
    case 'lost':
      return 'Signal lost — they may have moved out of range';
    case 'acquiring':
      return elapsedMs < 6_000
        ? 'Turn slowly so EventPulse can work out the direction'
        : 'Keep moving — the direction sharpens as you walk';
    case 'guiding':
    default:
      if (trend === 'approaching') return 'Getting closer';
      if (trend === 'receding') return 'Moving away — try turning around';
      return relativeBearing !== null && Math.abs(relativeBearing) < 30
        ? 'Head straight on'
        : 'Holding steady';
  }
}

/** Inverse-variance style blend: the more confident estimate dominates. */
export function fuseBearings(
  a: { bearing: number; confidence: number } | null,
  b: { bearing: number; confidence: number } | null,
): { bearing: number; confidence: number } | null {
  if (!a) return b;
  if (!b) return a;

  const wa = a.confidence;
  const wb = b.confidence;
  const total = wa + wb;
  if (total <= 0) return null;

  const radA = (a.bearing * Math.PI) / 180;
  const radB = (b.bearing * Math.PI) / 180;
  const x = (Math.sin(radA) * wa + Math.sin(radB) * wb) / total;
  const y = (Math.cos(radA) * wa + Math.cos(radB) * wb) / total;

  // Agreement bonus: two independent estimators pointing the same way is a
  // much stronger claim than either one alone.
  const agreement = 1 - Math.abs(angleDelta(a.bearing, b.bearing)) / 180;
  const confidence = clamp01(Math.max(wa, wb) + agreement * Math.min(wa, wb) * 0.5);

  return { bearing: normaliseDegrees((Math.atan2(x, y) * 180) / Math.PI), confidence };
}

/**
 * How much of the compass the samples cover, 0..1. A fit from headings spanning
 * 20° is meaningless; one spanning 270° is well constrained.
 */
export function headingCoverage(headings: readonly number[]): number {
  if (headings.length < 4) return 0;
  const buckets = new Set<number>();
  for (const heading of headings) buckets.add(Math.floor(normaliseDegrees(heading) / 30));
  return clamp01(buckets.size / 8);
}

function determinant3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

function replaceColumn(m: number[][], column: number, values: number[]): number[][] {
  return m.map((row, i) => row.map((cell, j) => (j === column ? values[i] : cell)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
