/**
 * proximityConfig.ts
 * -----------------------------------------------------------------------------
 * Every tunable that governs how a BLE advertisement becomes an attendance
 * state change. Nothing in this file is hard-coded anywhere else in the app.
 *
 * The user-editable ones are seeded from here and then stored in settings, so
 * these are DEFAULTS - the live values come from the settings store at runtime.
 * -----------------------------------------------------------------------------
 */

export interface ProximityConfig {
  /**
   * Smoothed RSSI at or above this counts as "near enough" to be eligible for
   * check-in. Less negative = stronger = closer.
   *
   * RSSI is an approximate proximity indicator ONLY. It is never converted to
   * metres anywhere in this app, and must not be.
   */
  minimumRssi: number;

  /**
   * Consecutive nearby readings required before a check-in is recorded.
   * One strong reading can be a multipath reflection from across the room; a
   * run of them cannot.
   */
  requiredConsecutiveDetections: number;

  /**
   * How long an employee stays visible in the LIVE "detected now" list after
   * their last advertisement. This is a UI-freshness window - it never affects
   * attendance.
   */
  detectionWindowMs: number;

  /**
   * How long an employee may go undetected before being considered to have
   * LEFT the area.
   *
   * BLE advertisements are missed routinely - interference, the phone in a
   * pocket, the radio duty-cycling. A single missed advertisement must never
   * mark someone as gone, which is why this is minutes rather than seconds.
   */
  missingGracePeriodMs: number;

  /**
   * How often the app recomputes PRESENT -> LEFT.
   *
   * This is only a re-evaluation cadence, NOT a countdown. The decision is
   * always `now - lastSeenTime > grace`, so a missed tick, a backgrounded app
   * or a device sleeping cannot produce a wrong verdict - the arithmetic is
   * the same whenever it next runs.
   */
  leftEvaluationIntervalMs: number;
}

export const DEFAULT_PROXIMITY_CONFIG: ProximityConfig = {
  minimumRssi: -65,
  requiredConsecutiveDetections: 3,
  detectionWindowMs: 10_000,
  missingGracePeriodMs: 3 * 60_000,
  leftEvaluationIntervalMs: 15_000,
};

/* =============================================================================
 * QUALITATIVE SIGNAL BANDS
 * -----------------------------------------------------------------------------
 * The UI shows Strong / Medium / Weak, never a distance. "-60 dBm" may be shown
 * alongside as a raw diagnostic, but the human-readable label is always a band.
 * ========================================================================== */

export type SignalBand = 'STRONG' | 'MEDIUM' | 'WEAK';

export const SIGNAL_BAND_THRESHOLDS = {
  strongAtOrAbove: -60,
  mediumAtOrAbove: -75,
} as const;

export function signalBand(rssi: number): SignalBand {
  if (rssi >= SIGNAL_BAND_THRESHOLDS.strongAtOrAbove) {
    return 'STRONG';
  }
  if (rssi >= SIGNAL_BAND_THRESHOLDS.mediumAtOrAbove) {
    return 'MEDIUM';
  }
  return 'WEAK';
}

/** Title-case label for display, e.g. "Strong". */
export function signalBandLabel(rssi: number | null): string {
  if (rssi === null) {
    return 'No signal';
  }
  const band = signalBand(rssi);
  return band.charAt(0) + band.slice(1).toLowerCase();
}

/* =============================================================================
 * BOUNDS for the Settings steppers
 * ========================================================================== */

export const CONFIG_BOUNDS = {
  minimumRssi: { min: -100, max: -30, step: 1 },
  requiredConsecutiveDetections: { min: 1, max: 10, step: 1 },
  /** Seconds in the UI, milliseconds internally. */
  detectionWindowSeconds: { min: 3, max: 60, step: 1 },
  missingGracePeriodSeconds: { min: 30, max: 900, step: 30 },
} as const;
