/**
 * HeadingService — which way is the phone pointing?
 *
 * Indoors this is genuinely hard. Steel structure, speaker magnets, laptop
 * chargers and the venue's own wiring routinely push a magnetometer 30-40°
 * off, and it wanders as the user walks. A compass alone makes the map lurch.
 *
 * So we fuse:
 *   - the gyroscope, which is accurate over seconds but drifts over minutes, and
 *   - the magnetometer, which is stable over minutes but noisy and biased.
 *
 * A complementary filter integrates gyro rate for the fast path and nudges the
 * result toward the magnetometer slowly. When the magnetometer looks disturbed
 * (its field magnitude departs from Earth-normal, or its variance spikes) we
 * cut its weight, so the map keeps turning smoothly on gyro alone rather than
 * snapping to a lie.
 *
 * All angles are degrees clockwise from magnetic north, normalised to [0, 360).
 */

import type { HeadingSample, MapOrientation } from '../types';

export interface MagnetometerSample {
  /** Micro-tesla, device frame. */
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

export interface GyroscopeSample {
  /** Rotation rate about the device's Z axis, radians per second. */
  z: number;
  timestamp: number;
}

export interface HeadingServiceOptions {
  /**
   * Magnetometer pull per second. Low values = smooth but slow to correct
   * gyro drift; 0.35 settles a 40° error in roughly 3 s.
   */
  magnetometerGain?: number;
  /** Ignore gyro rates below this (rad/s) as sensor noise rather than rotation. */
  gyroDeadband?: number;
  /** Expected Earth field magnitude in µT; deviation implies local interference. */
  nominalFieldMagnitude?: number;
  /** µT of deviation at which magnetometer trust reaches zero. */
  fieldToleranceMagnitude?: number;
  /** Never rotate the map faster than this, in degrees per second. */
  maxSlewDegPerSec?: number;
}

const DEFAULTS: Required<HeadingServiceOptions> = {
  magnetometerGain: 0.35,
  gyroDeadband: 0.02,
  nominalFieldMagnitude: 48,
  fieldToleranceMagnitude: 35,
  maxSlewDegPerSec: 220,
};

export type HeadingQuality = 'good' | 'fair' | 'interference' | 'unavailable';

export interface HeadingState {
  /** Fused heading in degrees from magnetic north. */
  heading: number;
  quality: HeadingQuality;
  /** 0..1 — how much of the fused value currently comes from the magnetometer. */
  magnetometerTrust: number;
  updatedAt: number;
}

export function normaliseDegrees(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Shortest signed angular difference from `a` to `b`, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Circular mean of a set of bearings; plain averaging breaks across 0°/360°. */
export function circularMean(degrees: readonly number[]): number {
  if (degrees.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const deg of degrees) {
    const rad = (deg * Math.PI) / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  return normaliseDegrees((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
}

export class HeadingService {
  private readonly opts: Required<HeadingServiceOptions>;

  private heading = 0;
  private initialised = false;
  private lastGyroAt: number | null = null;
  private lastMagAt: number | null = null;
  private magnetometerTrust = 0;
  private quality: HeadingQuality = 'unavailable';
  private updatedAt = 0;
  private readonly recentMagHeadings: number[] = [];

  constructor(options: HeadingServiceOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Fast path. Integrates rotation rate; runs at sensor rate (~50 Hz) and never
   * allocates.
   */
  pushGyroscope(sample: GyroscopeSample): void {
    if (this.lastGyroAt === null) {
      this.lastGyroAt = sample.timestamp;
      return;
    }
    const dt = (sample.timestamp - this.lastGyroAt) / 1000;
    this.lastGyroAt = sample.timestamp;
    if (dt <= 0 || dt > 0.5) return; // dropped frames: don't integrate a stale gap

    const rate = Math.abs(sample.z) < this.opts.gyroDeadband ? 0 : sample.z;
    if (rate === 0) return;

    // Device Z is counter-clockwise positive; compass bearing is clockwise.
    const deltaDeg = (-rate * dt * 180) / Math.PI;
    this.heading = normaliseDegrees(this.heading + deltaDeg);
    this.updatedAt = sample.timestamp;
    this.initialised = true;
  }

  /** Slow path. Corrects drift, weighted by how trustworthy the field looks. */
  pushMagnetometer(sample: MagnetometerSample): void {
    const magnitude = Math.hypot(sample.x, sample.y, sample.z);
    const deviation = Math.abs(magnitude - this.opts.nominalFieldMagnitude);
    const magnitudeTrust = clamp01(1 - deviation / this.opts.fieldToleranceMagnitude);

    // atan2(y, x) with the sign flipped gives a clockwise-from-north bearing
    // for a device held flat. A production build should feed this through the
    // platform's tilt-compensated heading (Android ROTATION_VECTOR /
    // CLLocationHeading) and use this path only as the fallback.
    const rawHeading = normaliseDegrees((Math.atan2(-sample.y, sample.x) * 180) / Math.PI);

    this.recentMagHeadings.push(rawHeading);
    if (this.recentMagHeadings.length > 12) this.recentMagHeadings.shift();
    const spread = angularSpread(this.recentMagHeadings);
    const stabilityTrust = clamp01(1 - spread / 90);

    this.magnetometerTrust = magnitudeTrust * stabilityTrust;

    if (!this.initialised) {
      this.heading = rawHeading;
      this.initialised = true;
      this.lastMagAt = sample.timestamp;
      this.updatedAt = sample.timestamp;
      this.quality = this.qualityFor(this.magnetometerTrust);
      return;
    }

    const dt = this.lastMagAt === null ? 0.05 : (sample.timestamp - this.lastMagAt) / 1000;
    this.lastMagAt = sample.timestamp;

    const gain = clamp01(this.opts.magnetometerGain * this.magnetometerTrust * Math.min(dt, 0.2) * 20);
    const correction = angleDelta(this.heading, rawHeading) * gain;
    const maxStep = this.opts.maxSlewDegPerSec * Math.max(dt, 0.001);
    this.heading = normaliseDegrees(
      this.heading + Math.max(Math.min(correction, maxStep), -maxStep),
    );

    this.updatedAt = sample.timestamp;
    this.quality = this.qualityFor(this.magnetometerTrust);
  }

  /**
   * Direct platform heading (Android ROTATION_VECTOR, iOS CLLocationHeading).
   * Preferred when available: the OS already did the tilt compensation.
   */
  pushPlatformHeading(sample: HeadingSample): void {
    const accuracyTrust =
      sample.accuracy < 0 ? 0.5 : clamp01(1 - sample.accuracy / 45);
    this.magnetometerTrust = accuracyTrust;

    if (!this.initialised) {
      this.heading = normaliseDegrees(sample.heading);
      this.initialised = true;
    } else {
      const gain = clamp01(0.25 + 0.5 * accuracyTrust);
      this.heading = normaliseDegrees(
        this.heading + angleDelta(this.heading, normaliseDegrees(sample.heading)) * gain,
      );
    }
    this.updatedAt = sample.timestamp;
    this.quality = this.qualityFor(accuracyTrust);
  }

  private qualityFor(trust: number): HeadingQuality {
    if (!this.initialised) return 'unavailable';
    if (trust > 0.7) return 'good';
    if (trust > 0.35) return 'fair';
    return 'interference';
  }

  getState(): HeadingState {
    return {
      heading: this.heading,
      quality: this.quality,
      magnetometerTrust: this.magnetometerTrust,
      updatedAt: this.updatedAt,
    };
  }

  reset(): void {
    this.heading = 0;
    this.initialised = false;
    this.lastGyroAt = null;
    this.lastMagAt = null;
    this.magnetometerTrust = 0;
    this.quality = 'unavailable';
    this.recentMagHeadings.length = 0;
  }
}

/**
 * How much the map should be rotated, given the orientation mode.
 * In heading-up mode the world spins under a fixed "you"; in north-up it doesn't.
 */
export function mapRotationFor(orientation: MapOrientation, heading: number): number {
  return orientation === 'heading_up' ? -normaliseDegrees(heading) : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function angularSpread(degrees: readonly number[]): number {
  if (degrees.length < 2) return 0;
  const mean = circularMean(degrees);
  let maxDeviation = 0;
  for (const deg of degrees) {
    maxDeviation = Math.max(maxDeviation, Math.abs(angleDelta(mean, deg)));
  }
  return maxDeviation;
}
