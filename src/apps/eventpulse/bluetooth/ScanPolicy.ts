/**
 * Adaptive scan policy.
 *
 * Continuous low-latency scanning is the fastest way to drain a phone at a
 * day-long conference, and it is unnecessary: the map only needs sub-second
 * freshness while the user is actually looking at it. This module turns
 * "what is the app doing right now" into a concrete duty cycle.
 *
 * Nothing here talks to the radio; `BleScanner` applies the result.
 */

import type { ScanMode } from './BleTransport';

export type AppPhase =
  | 'map_foreground'
  | 'app_foreground'
  | 'background'
  | 'inactive';

export interface ScanPolicyInput {
  phase: AppPhase;
  /** Peers currently tracked. High density lets us back off without losing anyone. */
  peerCount: number;
  /** 0..1, or null when unknown. */
  batteryLevel: number | null;
  batteryCharging: boolean;
  /** Navigation mode needs the freshest possible signal. */
  navigating: boolean;
  /** Set while the user is being shown the empty state; we scan harder to fill it. */
  seekingFirstPeer: boolean;
}

export interface ScanPlan {
  mode: ScanMode;
  /** Radio on for this long... */
  onMs: number;
  /** ...then idle for this long. `0` means continuous. */
  offMs: number;
  /** How often the UI snapshot is recomputed from the registry. */
  flushIntervalMs: number;
  reason: string;
}

const CONTINUOUS = 0;

export function computeScanPlan(input: ScanPolicyInput): ScanPlan {
  const lowBattery = input.batteryLevel !== null && input.batteryLevel < 0.15 && !input.batteryCharging;

  if (input.phase === 'inactive') {
    return {
      mode: 'low_power',
      onMs: 0,
      offMs: 0,
      flushIntervalMs: 1000,
      reason: 'app inactive — radio idle',
    };
  }

  if (input.phase === 'background') {
    // iOS heavily restricts background scanning and Android throttles it to
    // roughly one result per 15 minutes on some OEM builds. We ask for little
    // and treat anything we get as a bonus.
    return {
      mode: 'low_power',
      onMs: 4_000,
      offMs: 26_000,
      flushIntervalMs: 5_000,
      reason: 'backgrounded — minimal presence upkeep',
    };
  }

  if (lowBattery) {
    return {
      mode: 'low_power',
      onMs: 3_000,
      offMs: 9_000,
      flushIntervalMs: 600,
      reason: 'battery below 15% — conserving',
    };
  }

  if (input.phase === 'map_foreground') {
    if (input.navigating) {
      return {
        mode: 'low_latency',
        onMs: CONTINUOUS,
        offMs: 0,
        flushIntervalMs: 120,
        reason: 'navigating to a person — maximum freshness',
      };
    }
    if (input.seekingFirstPeer) {
      return {
        mode: 'low_latency',
        onMs: CONTINUOUS,
        offMs: 0,
        flushIntervalMs: 200,
        reason: 'nobody found yet — scanning hard to fill the map',
      };
    }
    if (input.peerCount > 60) {
      // Dense hall: packets arrive constantly, so a balanced radio still keeps
      // every peer fresh while costing meaningfully less power.
      return {
        mode: 'balanced',
        onMs: CONTINUOUS,
        offMs: 0,
        flushIntervalMs: 300,
        reason: 'dense crowd — balanced radio is sufficient',
      };
    }
    return {
      mode: 'low_latency',
      onMs: CONTINUOUS,
      offMs: 0,
      flushIntervalMs: 200,
      reason: 'map visible — responsive scanning',
    };
  }

  // Foreground, but the user is on Discover / Connections / Profile.
  return {
    mode: 'balanced',
    onMs: 5_000,
    offMs: 5_000,
    flushIntervalMs: 800,
    reason: 'map not visible — duty-cycled upkeep',
  };
}

export function scanPlansEqual(a: ScanPlan, b: ScanPlan): boolean {
  return (
    a.mode === b.mode &&
    a.onMs === b.onMs &&
    a.offMs === b.offMs &&
    a.flushIntervalMs === b.flushIntervalMs
  );
}
