/**
 * Unit tests for the adaptive scan policy.
 *
 * `computeScanPlan` is a pure function of a single input object with a small,
 * fully enumerable domain, so most invariants here are checked against a cross
 * product of every interesting value rather than a hand-picked sample.
 *
 * Reason strings in the implementation contain U+2014 (em dash). They are spelled
 * with the escape here so the expectations survive any encoding round-trip.
 */

import type { AppPhase, ScanPlan, ScanPolicyInput } from '../bluetooth/ScanPolicy';
import { computeScanPlan, scanPlansEqual } from '../bluetooth/ScanPolicy';

const BASE: ScanPolicyInput = {
  phase: 'app_foreground',
  peerCount: 0,
  batteryLevel: null,
  batteryCharging: false,
  navigating: false,
  seekingFirstPeer: false,
};

function input(overrides: Partial<ScanPolicyInput> = {}): ScanPolicyInput {
  return { ...BASE, ...overrides };
}

/* The eight plans the module can return, spelled out exactly. */

const IDLE_PLAN: ScanPlan = {
  mode: 'low_power',
  onMs: 0,
  offMs: 0,
  flushIntervalMs: 1000,
  reason: 'app inactive — radio idle',
};

const BACKGROUND_PLAN: ScanPlan = {
  mode: 'low_power',
  onMs: 4000,
  offMs: 26000,
  flushIntervalMs: 5000,
  reason: 'backgrounded — minimal presence upkeep',
};

const CONSERVING_PLAN: ScanPlan = {
  mode: 'low_power',
  onMs: 3000,
  offMs: 9000,
  flushIntervalMs: 600,
  reason: 'battery below 15% — conserving',
};

const NAVIGATING_PLAN: ScanPlan = {
  mode: 'low_latency',
  onMs: 0,
  offMs: 0,
  flushIntervalMs: 120,
  reason: 'navigating to a person — maximum freshness',
};

const SEEKING_PLAN: ScanPlan = {
  mode: 'low_latency',
  onMs: 0,
  offMs: 0,
  flushIntervalMs: 200,
  reason: 'nobody found yet — scanning hard to fill the map',
};

const DENSE_CROWD_PLAN: ScanPlan = {
  mode: 'balanced',
  onMs: 0,
  offMs: 0,
  flushIntervalMs: 300,
  reason: 'dense crowd — balanced radio is sufficient',
};

const MAP_STEADY_PLAN: ScanPlan = {
  mode: 'low_latency',
  onMs: 0,
  offMs: 0,
  flushIntervalMs: 200,
  reason: 'map visible — responsive scanning',
};

const OFF_MAP_PLAN: ScanPlan = {
  mode: 'balanced',
  onMs: 5000,
  offMs: 5000,
  flushIntervalMs: 800,
  reason: 'map not visible — duty-cycled upkeep',
};

/* Exhaustive input space used by the invariant tests. */

const ALL_PHASES: AppPhase[] = ['map_foreground', 'app_foreground', 'background', 'inactive'];
const BATTERY_LEVELS: Array<number | null> = [null, 0, 0.0001, 0.1499, 0.15, 0.1501, 0.5, 1];
const PEER_COUNTS: number[] = [0, 1, 59, 60, 61, 1000];
const BOOLEANS: boolean[] = [false, true];

function everyInput(): ScanPolicyInput[] {
  const all: ScanPolicyInput[] = [];
  for (const phase of ALL_PHASES) {
    for (const peerCount of PEER_COUNTS) {
      for (const batteryLevel of BATTERY_LEVELS) {
        for (const batteryCharging of BOOLEANS) {
          for (const navigating of BOOLEANS) {
            for (const seekingFirstPeer of BOOLEANS) {
              all.push({
                phase,
                peerCount,
                batteryLevel,
                batteryCharging,
                navigating,
                seekingFirstPeer,
              });
            }
          }
        }
      }
    }
  }
  return all;
}

interface Violation {
  problem: string;
  where: ScanPolicyInput;
  plan: ScanPlan;
}

function violationsAcrossEveryInput(
  check: (plan: ScanPlan, from: ScanPolicyInput) => string | null,
): Violation[] {
  const found: Violation[] = [];
  for (const candidate of everyInput()) {
    const plan = computeScanPlan(candidate);
    const problem = check(plan, candidate);
    if (problem !== null) found.push({ problem, where: candidate, plan });
  }
  return found;
}

describe('computeScanPlan / app phase', () => {
  it('parks the radio completely while the app is inactive', () => {
    expect(computeScanPlan(input({ phase: 'inactive' }))).toEqual(IDLE_PLAN);
  });

  it('stays parked while inactive no matter what every other signal says', () => {
    const plan = computeScanPlan(
      input({
        phase: 'inactive',
        navigating: true,
        seekingFirstPeer: true,
        peerCount: 1000,
        batteryLevel: 0.01,
      }),
    );
    expect(plan).toEqual(IDLE_PLAN);
  });

  it('duty-cycles 4s on / 26s off while backgrounded', () => {
    expect(computeScanPlan(input({ phase: 'background' }))).toEqual(BACKGROUND_PLAN);
  });

  it('keeps the background duty cycle even while navigating, seeking or in a dense crowd', () => {
    const plan = computeScanPlan(
      input({ phase: 'background', navigating: true, seekingFirstPeer: true, peerCount: 1000 }),
    );
    expect(plan).toEqual(BACKGROUND_PLAN);
  });

  it('duty-cycles 5s on / 5s off in the foreground when the map is not visible', () => {
    expect(computeScanPlan(input({ phase: 'app_foreground' }))).toEqual(OFF_MAP_PLAN);
  });

  it('scans continuously at low latency while the map is visible and settled', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', peerCount: 12 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });
});

describe('computeScanPlan / navigating to a person', () => {
  it('scans continuously at low latency with a 120ms flush while navigating on the map', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', navigating: true }));
    expect(plan).toEqual(NAVIGATING_PLAN);
  });

  it('prefers the navigation plan over the empty-state plan', () => {
    const plan = computeScanPlan(
      input({ phase: 'map_foreground', navigating: true, seekingFirstPeer: true }),
    );
    expect(plan).toEqual(NAVIGATING_PLAN);
  });

  it('prefers the navigation plan over the dense-crowd back-off', () => {
    const plan = computeScanPlan(
      input({ phase: 'map_foreground', navigating: true, peerCount: 1000 }),
    );
    expect(plan).toEqual(NAVIGATING_PLAN);
  });

  it('ignores the navigating flag entirely when the map is not on screen', () => {
    expect(computeScanPlan(input({ phase: 'app_foreground', navigating: true }))).toEqual(
      OFF_MAP_PLAN,
    );
  });
});

describe('computeScanPlan / seeking the first peer', () => {
  it('reports the empty-state reason while the map has found nobody yet', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', seekingFirstPeer: true }));
    expect(plan).toEqual(SEEKING_PLAN);
  });

  it('prefers the empty-state plan over the dense-crowd back-off', () => {
    const plan = computeScanPlan(
      input({ phase: 'map_foreground', seekingFirstPeer: true, peerCount: 1000 }),
    );
    expect(plan).toEqual(SEEKING_PLAN);
  });

  it('ignores the empty-state flag when the map is not on screen', () => {
    expect(computeScanPlan(input({ phase: 'app_foreground', seekingFirstPeer: true }))).toEqual(
      OFF_MAP_PLAN,
    );
  });

  // BUG (ScanPolicy.ts:92-100): the `seekingFirstPeer` branch returns a plan that is
  // field-for-field identical to the steady-state map plan at ScanPolicy.ts:112-118 --
  // low_latency, continuous, flushIntervalMs 200. Only the reason string differs, and
  // `scanPlansEqual` (ScanPolicy.ts:131) does not compare reasons, so `BleScanner`
  // (BleScanner.ts:209) short-circuits and nothing about the radio or the flush cadence
  // ever changes. The field is documented "we scan harder to fill it" (ScanPolicy.ts:29)
  // and the reason claims "scanning hard", but the empty state is filled no faster than
  // the populated one. The branch is dead code as written.
  it.failing('scans harder while seeking the first peer than in the settled steady state', () => {
    const seeking = computeScanPlan(input({ phase: 'map_foreground', seekingFirstPeer: true }));
    const settled = computeScanPlan(input({ phase: 'map_foreground', peerCount: 4 }));
    expect(scanPlansEqual(seeking, settled)).toBe(false);
  });
});

describe('computeScanPlan / crowd density', () => {
  it('keeps low latency one peer below the density threshold', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', peerCount: 59 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  it('keeps low latency at exactly 60 peers because the threshold is exclusive', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', peerCount: 60 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  it('backs off to a balanced radio from 61 peers upward', () => {
    expect(computeScanPlan(input({ phase: 'map_foreground', peerCount: 61 }))).toEqual(
      DENSE_CROWD_PLAN,
    );
    expect(computeScanPlan(input({ phase: 'map_foreground', peerCount: 1000 }))).toEqual(
      DENSE_CROWD_PLAN,
    );
  });

  it('uses the responsive map plan at zero peers when the empty state is not showing', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', peerCount: 0 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  it('ignores crowd density when the map is not on screen', () => {
    expect(computeScanPlan(input({ phase: 'app_foreground', peerCount: 1000 }))).toEqual(
      OFF_MAP_PLAN,
    );
  });
});

describe('computeScanPlan / battery', () => {
  it('conserves just below the 15% threshold', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 0.1499 }));
    expect(plan).toEqual(CONSERVING_PLAN);
  });

  it('does not conserve at exactly the 15% threshold', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 0.15 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  it('does not conserve one step above the threshold', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 0.1501 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  it('conserves at a fully drained battery', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 0 }));
    expect(plan).toEqual(CONSERVING_PLAN);
  });

  it('never conserves while charging, even at 1% and 0%', () => {
    expect(
      computeScanPlan(
        input({ phase: 'map_foreground', batteryLevel: 0.01, batteryCharging: true }),
      ),
    ).toEqual(MAP_STEADY_PLAN);
    expect(
      computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 0, batteryCharging: true })),
    ).toEqual(MAP_STEADY_PLAN);
  });

  it('never conserves when the battery level is unknown', () => {
    expect(
      computeScanPlan(
        input({ phase: 'map_foreground', batteryLevel: null, batteryCharging: false }),
      ),
    ).toEqual(MAP_STEADY_PLAN);
    expect(
      computeScanPlan(input({ phase: 'map_foreground', batteryLevel: null, batteryCharging: true })),
    ).toEqual(MAP_STEADY_PLAN);
  });

  it('does not conserve at a full battery', () => {
    const plan = computeScanPlan(input({ phase: 'map_foreground', batteryLevel: 1 }));
    expect(plan).toEqual(MAP_STEADY_PLAN);
  });

  // BUG (ScanPolicy.ts:72-80): the low-battery branch replaces the off-map foreground plan
  // (ScanPolicy.ts:122-128, flushIntervalMs 800) with flushIntervalMs 600, so crossing below
  // 15% while the user is on Discover / Connections / Profile makes the app recompute the UI
  // snapshot from the registry 33% MORE often than it did on a healthy battery. The radio
  // duty does drop (50% -> 25%), but the branch labelled "conserving" increases CPU work on
  // that path. The conserving plan should never be more expensive than the plan it displaces.
  it.failing('never flushes more often when conserving than the plan it replaces', () => {
    const healthy = computeScanPlan(input({ phase: 'app_foreground', batteryLevel: 0.5 }));
    const conserving = computeScanPlan(input({ phase: 'app_foreground', batteryLevel: 0.05 }));
    expect(conserving.flushIntervalMs).toBeGreaterThanOrEqual(healthy.flushIntervalMs);
  });
});

describe('computeScanPlan / precedence between competing signals', () => {
  // Observed precedence, top to bottom:
  //   inactive > background > low battery > navigating > seeking first peer > dense crowd
  //   > steady map > off-map foreground.
  // Phase is therefore checked before battery, and battery before every map-specific
  // signal -- including navigation, which the module header calls the freshest possible
  // signal. These tests pin the order as implemented.

  it('parks the radio while inactive even on a critically low battery', () => {
    const plan = computeScanPlan(
      input({ phase: 'inactive', batteryLevel: 0.01, batteryCharging: false }),
    );
    expect(plan).toEqual(IDLE_PLAN);
  });

  it('keeps the background plan rather than the conserving plan on a low battery', () => {
    const plan = computeScanPlan(input({ phase: 'background', batteryLevel: 0.01 }));
    expect(plan).toEqual(BACKGROUND_PLAN);
  });

  it('keeps the background plan rather than the navigation plan while navigating', () => {
    const plan = computeScanPlan(input({ phase: 'background', navigating: true }));
    expect(plan).toEqual(BACKGROUND_PLAN);
  });

  it('conserves rather than navigates when the battery is low mid-navigation', () => {
    const plan = computeScanPlan(
      input({ phase: 'map_foreground', navigating: true, batteryLevel: 0.05 }),
    );
    expect(plan).toEqual(CONSERVING_PLAN);
    expect(plan).not.toEqual(NAVIGATING_PLAN);
  });

  it('conserves rather than filling the empty map or backing off for a crowd', () => {
    expect(
      computeScanPlan(
        input({ phase: 'map_foreground', seekingFirstPeer: true, batteryLevel: 0.05 }),
      ),
    ).toEqual(CONSERVING_PLAN);
    expect(
      computeScanPlan(input({ phase: 'map_foreground', peerCount: 1000, batteryLevel: 0.05 })),
    ).toEqual(CONSERVING_PLAN);
  });
});

describe('computeScanPlan / reason strings', () => {
  it('returns a non-empty human-readable reason for every possible input', () => {
    const bad = violationsAcrossEveryInput((plan) =>
      typeof plan.reason === 'string' && plan.reason.trim().length > 0
        ? null
        : 'reason is missing or blank',
    );
    expect(bad).toEqual([]);
  });
});

describe('computeScanPlan / internal consistency across every input', () => {
  it('never pairs low_latency with a duty cycle -- low latency is always continuous', () => {
    const bad = violationsAcrossEveryInput((plan) =>
      plan.mode === 'low_latency' && (plan.onMs !== 0 || plan.offMs !== 0)
        ? 'low_latency plan carries a non-zero duty cycle'
        : null,
    );
    expect(bad).toEqual([]);
  });

  it('never asks for an off window without an on window to pair it with', () => {
    const bad = violationsAcrossEveryInput((plan) =>
      plan.offMs > 0 && plan.onMs <= 0 ? 'offMs > 0 with a non-positive onMs' : null,
    );
    expect(bad).toEqual([]);
  });

  it('returns finite non-negative timings with a strictly positive flush interval', () => {
    const bad = violationsAcrossEveryInput((plan) => {
      if (!Number.isInteger(plan.onMs) || plan.onMs < 0) {
        return 'onMs is not a non-negative integer';
      }
      if (!Number.isInteger(plan.offMs) || plan.offMs < 0) {
        return 'offMs is not a non-negative integer';
      }
      if (!Number.isInteger(plan.flushIntervalMs) || plan.flushIntervalMs <= 0) {
        return 'flushIntervalMs is not a positive integer';
      }
      return null;
    });
    expect(bad).toEqual([]);
  });

  it('emits the fully-idle low_power 0/0 shape only for the inactive phase', () => {
    // BleScanner.applyPlan keys "stop the radio" off exactly this shape, so any other
    // branch producing it would silently kill scanning.
    const bad = violationsAcrossEveryInput((plan, from) =>
      plan.mode === 'low_power' && plan.onMs === 0 && plan.offMs === 0 && from.phase !== 'inactive'
        ? 'idle sentinel returned for a phase other than inactive'
        : null,
    );
    expect(bad).toEqual([]);
  });

  it('always returns one of the three known scan modes', () => {
    const known: string[] = ['low_power', 'balanced', 'low_latency'];
    const bad = violationsAcrossEveryInput((plan) =>
      known.includes(plan.mode) ? null : 'unknown scan mode',
    );
    expect(bad).toEqual([]);
  });

  it('is deterministic and leaves the caller-supplied input untouched', () => {
    const supplied = Object.freeze(
      input({ phase: 'map_foreground', peerCount: 61, batteryLevel: 0.5, batteryCharging: true }),
    );
    const first = computeScanPlan(supplied);
    const second = computeScanPlan(supplied);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(supplied).toEqual(
      input({ phase: 'map_foreground', peerCount: 61, batteryLevel: 0.5, batteryCharging: true }),
    );
  });
});

describe('scanPlansEqual', () => {
  it('treats two plans with identical fields as equal', () => {
    expect(scanPlansEqual({ ...MAP_STEADY_PLAN }, { ...MAP_STEADY_PLAN })).toBe(true);
  });

  it('treats a differing mode as a change', () => {
    expect(scanPlansEqual(MAP_STEADY_PLAN, { ...MAP_STEADY_PLAN, mode: 'balanced' })).toBe(false);
  });

  it('treats a differing onMs as a change', () => {
    expect(scanPlansEqual(OFF_MAP_PLAN, { ...OFF_MAP_PLAN, onMs: 4999 })).toBe(false);
  });

  it('treats a differing offMs as a change', () => {
    expect(scanPlansEqual(OFF_MAP_PLAN, { ...OFF_MAP_PLAN, offMs: 5001 })).toBe(false);
  });

  it('treats a differing flushIntervalMs as a change', () => {
    expect(scanPlansEqual(MAP_STEADY_PLAN, { ...MAP_STEADY_PLAN, flushIntervalMs: 199 })).toBe(
      false,
    );
  });

  it('ignores the reason string: two plans differing only in reason compare equal', () => {
    // Deliberate and load-bearing -- the reason is UI copy, and BleScanner would otherwise
    // restart the radio for a cosmetic change. Asserted here as the actual behaviour.
    expect(
      scanPlansEqual(MAP_STEADY_PLAN, { ...MAP_STEADY_PLAN, reason: 'completely different copy' }),
    ).toBe(true);
  });

  it('cannot distinguish the empty-state map plan from the settled map plan', () => {
    // Consequence of the seekingFirstPeer defect recorded above: BleScanner sees no change
    // when the first peer appears or disappears while the map is open.
    const seeking = computeScanPlan(input({ phase: 'map_foreground', seekingFirstPeer: true }));
    const settled = computeScanPlan(input({ phase: 'map_foreground', peerCount: 4 }));
    expect(seeking.reason).not.toBe(settled.reason);
    expect(scanPlansEqual(seeking, settled)).toBe(true);
  });
});
