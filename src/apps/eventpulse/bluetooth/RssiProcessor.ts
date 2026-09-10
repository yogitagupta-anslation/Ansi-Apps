/**
 * RSSI conditioning.
 *
 * Raw BLE RSSI is *noisy*: ±6 dB swings between consecutive packets are normal
 * even when nobody moves, and a body between two phones costs 10-20 dB. We
 * therefore never show a raw value and never move a person node from a single
 * packet.
 *
 * Pipeline: median window (kills impulse outliers, e.g. one packet caught
 * mid-stride) -> exponential moving average (smooths the remainder) ->
 * hysteresis on the band boundary (stops a person flickering between "Close"
 * and "Nearby"). A fast/slow EMA pair gives the approach/recede trend used by
 * navigation mode.
 *
 * The distance number this produces is an *estimate*. The UI must present it
 * as a range — never as "6.372 m".
 */

import type { ProximityBand, SignalTrend } from '../types';

export interface RssiFilterOptions {
  /** Weight of each new sample in the primary EMA. */
  emaAlpha?: number;
  /** Odd window size for the median pre-filter. */
  medianWindow?: number;
  /** Fast EMA weight, used only for trend detection. */
  fastAlpha?: number;
  /** Slow EMA weight, used only for trend detection. */
  slowAlpha?: number;
  /** dB difference between fast and slow EMA before we call a trend. */
  trendThresholdDb?: number;
  /** Samples required before the filter reports a stable value. */
  warmupSamples?: number;
}

const DEFAULTS: Required<RssiFilterOptions> = {
  emaAlpha: 0.25,
  medianWindow: 5,
  fastAlpha: 0.4,
  slowAlpha: 0.08,
  trendThresholdDb: 1.5,
  warmupSamples: 3,
};

export class RssiFilter {
  private readonly opts: Required<RssiFilterOptions>;
  private readonly window: number[] = [];
  private ema: number | null = null;
  private fast: number | null = null;
  private slow: number | null = null;
  private count = 0;

  constructor(options: RssiFilterOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    if (this.opts.medianWindow % 2 === 0) this.opts.medianWindow += 1;
  }

  /** Fold in one raw sample; returns the smoothed value. */
  push(rssi: number): number {
    this.count++;

    this.window.push(rssi);
    if (this.window.length > this.opts.medianWindow) this.window.shift();
    const median = medianOf(this.window);

    this.ema = this.ema === null ? median : this.ema + this.opts.emaAlpha * (median - this.ema);
    this.fast = this.fast === null ? median : this.fast + this.opts.fastAlpha * (median - this.fast);
    this.slow = this.slow === null ? median : this.slow + this.opts.slowAlpha * (median - this.slow);

    return this.ema;
  }

  get value(): number {
    return this.ema ?? 0;
  }

  get samples(): number {
    return this.count;
  }

  /** False until enough packets have arrived to trust the value. */
  get isWarm(): boolean {
    return this.count >= this.opts.warmupSamples;
  }

  /**
   * Signal trend. Rising RSSI (less negative) means the peer is getting closer.
   * Returns `steady` until warm, so navigation mode never opens with a guess.
   */
  get trend(): SignalTrend {
    if (!this.isWarm || this.fast === null || this.slow === null) return 'steady';
    const delta = this.fast - this.slow;
    if (delta > this.opts.trendThresholdDb) return 'approaching';
    if (delta < -this.opts.trendThresholdDb) return 'receding';
    return 'steady';
  }

  reset(): void {
    this.window.length = 0;
    this.ema = null;
    this.fast = null;
    this.slow = null;
    this.count = 0;
  }
}

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ------------------------------------------------------------------ *
 * Distance estimation
 * ------------------------------------------------------------------ */

export interface DistanceModel {
  /** Expected RSSI at 1 m for a typical phone-in-pocket transmitter. */
  txPower: number;
  /**
   * Path-loss exponent. 2.0 = free space; indoor halls full of bodies behave
   * closer to 2.2-3.0. Tune per venue if anchors are available.
   */
  pathLossExponent: number;
}

export const DEFAULT_DISTANCE_MODEL: DistanceModel = {
  txPower: -59,
  pathLossExponent: 2.4,
};

/**
 * Log-distance path loss. The output is a coarse estimate used to pick a band
 * and to scale the map; it is never rendered as a precise figure.
 */
export function estimateDistance(
  rssi: number,
  model: DistanceModel = DEFAULT_DISTANCE_MODEL,
): number {
  if (rssi === 0) return Number.POSITIVE_INFINITY;
  const ratio = (model.txPower - rssi) / (10 * model.pathLossExponent);
  const metres = Math.pow(10, ratio);
  // Clamp: below 0.3 m the model is meaningless, above 40 m BLE rarely carries.
  return Math.min(Math.max(metres, 0.3), 40);
}

/* ------------------------------------------------------------------ *
 * Proximity bands
 * ------------------------------------------------------------------ */

export interface BandDefinition {
  band: ProximityBand;
  /** Upper bound in metres, exclusive. */
  maxDistance: number;
  label: string;
  rangeLabel: string;
}

export const BANDS: readonly BandDefinition[] = [
  { band: 'very_close', maxDistance: 3, label: 'Very close', rangeLabel: 'under 3 m' },
  { band: 'close', maxDistance: 7, label: 'Close', rangeLabel: '3-7 m' },
  { band: 'nearby', maxDistance: 12, label: 'Nearby', rangeLabel: '7-12 m' },
  { band: 'far', maxDistance: Number.POSITIVE_INFINITY, label: 'Farther', rangeLabel: '12 m+' },
];

const BAND_ORDER: ProximityBand[] = ['very_close', 'close', 'nearby', 'far'];

export function bandIndex(band: ProximityBand): number {
  return BAND_ORDER.indexOf(band);
}

export function bandLabel(band: ProximityBand): string {
  return BANDS[bandIndex(band)]?.label ?? 'Nearby';
}

export function bandRangeLabel(band: ProximityBand): string {
  return BANDS[bandIndex(band)]?.rangeLabel ?? '';
}

/**
 * Classify a distance into a band, with hysteresis around the boundary.
 *
 * `hysteresisMeters` is applied *against* the direction of change: leaving a
 * band requires overshooting its boundary, so a person hovering at exactly 7 m
 * does not oscillate between "Close" and "Nearby" every packet.
 */
export function classifyBand(
  distance: number,
  previous?: ProximityBand,
  hysteresisMeters = 0.75,
): ProximityBand {
  const naive = BANDS.find((b) => distance < b.maxDistance)?.band ?? 'far';
  if (!previous || previous === naive) return naive;

  const prevIndex = bandIndex(previous);
  const nextIndex = bandIndex(naive);

  if (nextIndex > prevIndex) {
    // Moving outward: require crossing the previous band's ceiling by the margin.
    const ceiling = BANDS[prevIndex].maxDistance;
    return distance >= ceiling + hysteresisMeters ? naive : previous;
  }

  // Moving inward: require dropping below the boundary we are *leaving* by the
  // margin — that is, the ceiling of the band one step inside the previous one.
  //
  // Reading it off `BANDS[nextIndex]` instead was correct only for a single-band
  // step, where the two are the same value. Across a multi-band jump they
  // diverge and the margin stops being a 0.75 m anti-flicker guard and becomes a
  // lock: leaving "far" would demand <= 2.25 m rather than <= 11.25 m, so a peer
  // measured at 2.5 m kept reporting "Farther / 12 m+" while the same peer at
  // 11 m reported "Nearby". That made the band non-monotonic in distance.
  const ceiling = BANDS[prevIndex - 1].maxDistance;
  return distance <= ceiling - hysteresisMeters ? naive : previous;
}

/** Human phrasing for navigation mode. Intentionally vague — the data is vague. */
export function trendLabel(trend: SignalTrend): string {
  switch (trend) {
    case 'approaching':
      return 'Getting closer';
    case 'receding':
      return 'Moving away';
    default:
      return 'Holding steady';
  }
}

/** "3-7 m" style range text for a distance estimate. Never a decimal figure. */
export function distanceRangeLabel(distance: number): string {
  if (!Number.isFinite(distance)) return 'Out of range';
  const band = BANDS.find((b) => distance < b.maxDistance) ?? BANDS[BANDS.length - 1];
  return band.rangeLabel;
}
