/**
 * proximityConfig — the tunables that turn a BLE advertisement into an attendance state
 * change, and the qualitative bands the UI shows instead of a distance.
 *
 * Two kinds of assertion carry the weight here.
 *
 * The first is ABSENCE OF EVIDENCE. `signalBandLabel(null)` means "this phone has no
 * reading", and it must stay distinguishable from "this phone has a reading and it is
 * weak". The inverse matters just as much: 0 dBm is a real, exceptionally strong
 * observation, and a refactor that swapped `rssi === null` for a falsy check would
 * silently report the strongest reading a radio can give as no signal at all.
 *
 * The second is the BOUNDARIES. Every threshold here is inclusive at its lower edge — a
 * reading sitting exactly on -60 is Strong, not Medium — and the Settings steppers can
 * only produce values on their own grid, so every seeded default has to be a value the
 * user could have dialled in by hand.
 *
 * Nothing below depends on the clock or on Math.random: the module is pure, and every
 * reading is written out explicitly.
 */

import { DEFAULT_RSSI_THRESHOLD, RSSI_MEDIUM, RSSI_STRONG } from '../constants/bluetoothConfig';
import {
  CONFIG_BOUNDS,
  DEFAULT_PROXIMITY_CONFIG,
  SIGNAL_BAND_THRESHOLDS,
  signalBand,
  signalBandLabel,
  type SignalBand,
} from '../constants/proximityConfig';

/** A stepper bound, as the Settings screen consumes it. */
interface Bound {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

const BOUND_ENTRIES: ReadonlyArray<readonly [string, Bound]> = Object.entries(CONFIG_BOUNDS);

/**
 * Each user-editable default paired with the bound it must satisfy, in that bound's own
 * unit. Two of the four are stored in milliseconds but offered to the user in seconds,
 * and that conversion is exactly where an unreachable default would hide.
 */
const DEFAULTS_AGAINST_BOUNDS: ReadonlyArray<{
  readonly what: string;
  readonly value: number;
  readonly bound: Bound;
}> = [
  {
    what: 'minimumRssi, in dBm',
    value: DEFAULT_PROXIMITY_CONFIG.minimumRssi,
    bound: CONFIG_BOUNDS.minimumRssi,
  },
  {
    what: 'requiredConsecutiveDetections, in readings',
    value: DEFAULT_PROXIMITY_CONFIG.requiredConsecutiveDetections,
    bound: CONFIG_BOUNDS.requiredConsecutiveDetections,
  },
  {
    what: 'detectionWindowMs, converted to seconds',
    value: DEFAULT_PROXIMITY_CONFIG.detectionWindowMs / 1000,
    bound: CONFIG_BOUNDS.detectionWindowSeconds,
  },
  {
    what: 'missingGracePeriodMs, converted to seconds',
    value: DEFAULT_PROXIMITY_CONFIG.missingGracePeriodMs / 1000,
    bound: CONFIG_BOUNDS.missingGracePeriodSeconds,
  },
];

/** Strength ordering, so a sweep can assert the bands never run backwards. */
const BAND_RANK: Record<SignalBand, number> = { WEAK: 1, MEDIUM: 2, STRONG: 3 };

/** Every half dBm from the weakest settable threshold up to 0, strongest last. */
function sweepOfSettableReadings(): number[] {
  const readings: number[] = [];
  for (let dbm = CONFIG_BOUNDS.minimumRssi.min; dbm <= 0; dbm += 0.5) {
    readings.push(dbm);
  }
  return readings;
}

describe('signalBand', () => {
  it('calls a reading sitting exactly on the strong threshold (-60 dBm) STRONG, not MEDIUM', () => {
    expect(signalBand(-60)).toBe('STRONG');
  });

  it('calls a reading one whole dBm below the strong threshold (-61 dBm) MEDIUM', () => {
    expect(signalBand(-61)).toBe('MEDIUM');
  });

  it('calls a smoothed reading a fraction below the strong threshold (-60.5 dBm) MEDIUM', () => {
    // Smoothed RSSI is a mean of several samples, so it arrives fractional. A boundary
    // that only held for integers would misclassify most of the real inputs.
    expect(signalBand(-60.5)).toBe('MEDIUM');
  });

  it('calls a reading sitting exactly on the medium threshold (-75 dBm) MEDIUM, not WEAK', () => {
    expect(signalBand(-75)).toBe('MEDIUM');
  });

  it('calls a smoothed reading a fraction below the medium threshold (-75.5 dBm) WEAK', () => {
    expect(signalBand(-75.5)).toBe('WEAK');
  });

  it('calls readings well above the strong threshold STRONG', () => {
    expect(signalBand(-30)).toBe('STRONG');
    expect(signalBand(-1)).toBe('STRONG');
  });

  it('calls the weakest settable reading (-100 dBm) WEAK', () => {
    expect(signalBand(-100)).toBe('WEAK');
  });

  it('puts its boundaries exactly where SIGNAL_BAND_THRESHOLDS says, so retuning moves the bands', () => {
    const { strongAtOrAbove, mediumAtOrAbove } = SIGNAL_BAND_THRESHOLDS;

    expect(signalBand(strongAtOrAbove)).toBe('STRONG');
    expect(signalBand(strongAtOrAbove - 0.5)).toBe('MEDIUM');
    expect(signalBand(mediumAtOrAbove)).toBe('MEDIUM');
    expect(signalBand(mediumAtOrAbove - 0.5)).toBe('WEAK');
  });

  it('returns only the three declared bands, and never weakens as the signal strengthens', () => {
    const readings = sweepOfSettableReadings();
    const ranks = readings.map(dbm => BAND_RANK[signalBand(dbm)]);

    const unknownBands = readings.filter((_dbm, i) => !(ranks[i] >= 1 && ranks[i] <= 3));
    expect(unknownBands).toEqual([]);

    const wentBackwardsAt = readings.filter((_dbm, i) => i > 0 && ranks[i] < ranks[i - 1]);
    expect(wentBackwardsAt).toEqual([]);
  });
});

describe('signalBandLabel', () => {
  it('says "No signal" for a null reading instead of naming a band it has not observed', () => {
    const label = signalBandLabel(null);

    expect(label).toBe('No signal');
    expect(['Strong', 'Medium', 'Weak']).not.toContain(label);
  });

  it('reads 0 dBm as a real, very strong observation rather than a missing one', () => {
    // 0 is falsy. If this guard ever becomes `if (!rssi)`, the single strongest reading
    // the radio can report starts rendering as "we have no reading at all".
    expect(signalBandLabel(0)).toBe('Strong');
  });

  it('never says "No signal" for a reading it actually has, anywhere in the settable range', () => {
    const fabricatedGaps = sweepOfSettableReadings().filter(
      dbm => signalBandLabel(dbm) === 'No signal',
    );

    expect(fabricatedGaps).toEqual([]);
  });

  it('title-cases each band for display', () => {
    expect(signalBandLabel(-45)).toBe('Strong');
    expect(signalBandLabel(-70)).toBe('Medium');
    expect(signalBandLabel(-90)).toBe('Weak');
  });

  it('labels the exact threshold readings the same way signalBand classifies them', () => {
    expect(signalBandLabel(-60)).toBe('Strong');
    expect(signalBandLabel(-75)).toBe('Medium');
    expect(signalBandLabel(-76)).toBe('Weak');
  });

  // REGRESSION GUARD. `signalBandLabel` used to guard only `rssi === null`, but RSSI is
  // modelled as `number | null | undefined` elsewhere in this codebase (attendanceTypes.ts
  // and Orbit.tsx both declare `rssi?: number | null`). Handed an absent reading as
  // `undefined`, the guard missed and `undefined >= -75` is false, so the one function
  // whose job is to say "we don't know" answered "Weak" — a signal-strength claim about a
  // device nobody heard from. The honest answer is "No signal".
  //
  // The signature keeps TypeScript from letting undefined in through a typed call, so
  // this is hardening rather than a fault anything reaches today; `== null` now catches
  // both. It is the cheapest possible insurance on the one function that must be able
  // to admit ignorance.
  it('says "No signal" for an undefined reading rather than inventing Weak', () => {
    expect(signalBandLabel(undefined as unknown as number | null)).toBe('No signal');
  });
});

describe('CONFIG_BOUNDS', () => {
  for (const [name, bound] of BOUND_ENTRIES) {
    it(`${name}: min sits below max, and the step divides the range exactly`, () => {
      expect(bound.min).toBeLessThan(bound.max);
      expect(bound.step).toBeGreaterThan(0);
      // A range the step cannot land on leaves the top of the stepper unreachable.
      expect((bound.max - bound.min) % bound.step).toBe(0);
    });
  }

  it('never offers a signal threshold at or above 0 dBm, which no radio reports', () => {
    expect(CONFIG_BOUNDS.minimumRssi.max).toBeLessThan(0);
    expect(CONFIG_BOUNDS.minimumRssi.min).toBeLessThan(CONFIG_BOUNDS.minimumRssi.max);
  });
});

describe('DEFAULT_PROXIMITY_CONFIG against CONFIG_BOUNDS', () => {
  for (const { what, value, bound } of DEFAULTS_AGAINST_BOUNDS) {
    it(`${what}: the seeded default sits inside the range the stepper allows`, () => {
      expect(value).toBeGreaterThanOrEqual(bound.min);
      expect(value).toBeLessThanOrEqual(bound.max);
    });
  }

  for (const { what, value, bound } of DEFAULTS_AGAINST_BOUNDS) {
    it(`${what}: the seeded default lands on a step the user could dial back to`, () => {
      // An off-grid default is a one-way door: nudge the stepper once and the original
      // value can never be reached again.
      expect((value - bound.min) % bound.step).toBe(0);
    });
  }

  it('checks a default against every bound the settings screen exposes', () => {
    expect(DEFAULTS_AGAINST_BOUNDS).toHaveLength(BOUND_ENTRIES.length);
  });
});

describe('DEFAULT_PROXIMITY_CONFIG behaviour', () => {
  it('requires more than one reading, so a single reflection cannot check someone in', () => {
    expect(DEFAULT_PROXIMITY_CONFIG.requiredConsecutiveDetections).toBeGreaterThan(1);
  });

  it('waits minutes, not seconds, before concluding someone has left', () => {
    // BLE advertisements are missed routinely. A grace period measured in seconds would
    // report a departure that never happened.
    expect(DEFAULT_PROXIMITY_CONFIG.missingGracePeriodMs).toBeGreaterThanOrEqual(60_000);
  });

  it('re-evaluates LEFT far more often than the grace period it is testing', () => {
    // The verdict is `now - lastSeen > grace`, so the interval only governs how promptly
    // a departure surfaces. An interval at or above the grace period doubles that delay.
    expect(DEFAULT_PROXIMITY_CONFIG.leftEvaluationIntervalMs).toBeLessThan(
      DEFAULT_PROXIMITY_CONFIG.missingGracePeriodMs,
    );
  });

  it('expires the live "detected now" list long before attendance concludes someone left', () => {
    expect(DEFAULT_PROXIMITY_CONFIG.detectionWindowMs).toBeLessThan(
      DEFAULT_PROXIMITY_CONFIG.missingGracePeriodMs,
    );
  });

  it('accepts check-ins only at a signal the UI would not call Weak', () => {
    // Checking someone in at a strength the meter renders as Weak would contradict the
    // app's own on-screen account of what just happened.
    expect(signalBand(DEFAULT_PROXIMITY_CONFIG.minimumRssi)).not.toBe('WEAK');
    expect(signalBandLabel(DEFAULT_PROXIMITY_CONFIG.minimumRssi)).toBe('Medium');
  });

  it('holds finite positive durations, an integer reading count and a negative dBm threshold', () => {
    const { minimumRssi, requiredConsecutiveDetections, ...durationsMs } =
      DEFAULT_PROXIMITY_CONFIG;

    expect(Number.isFinite(minimumRssi)).toBe(true);
    expect(minimumRssi).toBeLessThan(0);
    expect(Number.isInteger(requiredConsecutiveDetections)).toBe(true);

    const badDurations = Object.entries(durationsMs).filter(
      ([, ms]) => !Number.isFinite(ms) || ms <= 0,
    );
    expect(badDurations).toEqual([]);
  });
});

describe('band thresholds shared with the rest of the app', () => {
  it('bands on the same numbers the signal meter renders from', () => {
    // ProximityIndicator classifies with RSSI_STRONG / RSSI_MEDIUM from bluetoothConfig
    // while the words come from here. If the two drift, one row of the UI shows the bars
    // filled for Strong next to the label "Medium".
    expect(SIGNAL_BAND_THRESHOLDS.strongAtOrAbove).toBe(RSSI_STRONG);
    expect(SIGNAL_BAND_THRESHOLDS.mediumAtOrAbove).toBe(RSSI_MEDIUM);
  });

  it('seeds the same signal threshold bluetoothConfig publishes as the default', () => {
    expect(DEFAULT_PROXIMITY_CONFIG.minimumRssi).toBe(DEFAULT_RSSI_THRESHOLD);
  });
});
