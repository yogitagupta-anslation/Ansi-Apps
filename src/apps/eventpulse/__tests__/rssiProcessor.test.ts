/**
 * Unit tests for the RSSI conditioning pipeline.
 *
 * Every expected number here was computed by hand from the constants declared in
 * `bluetooth/RssiProcessor.ts` (emaAlpha 0.25, medianWindow 5, fastAlpha 0.4,
 * slowAlpha 0.08, trendThresholdDb 1.5, warmupSamples 3, txPower -59,
 * pathLossExponent 2.4, band ceilings 3/7/12 m, hysteresis 0.75 m). Nothing in
 * this file is mocked: the real class and the real pure functions are exercised.
 */

import {
  BANDS,
  DEFAULT_DISTANCE_MODEL,
  RssiFilter,
  bandIndex,
  bandLabel,
  bandRangeLabel,
  classifyBand,
  distanceRangeLabel,
  estimateDistance,
  medianOf,
  trendLabel,
} from '../bluetooth/RssiProcessor';
import type { ProximityBand, SignalTrend } from '../types';

/**
 * Exhaustive member lists. The `Record` forces a compile error the day a new
 * member joins either union, so the "no undefined for any member" tests below
 * cannot silently stop covering the whole enum.
 */
const BAND_MEMBERS: Record<ProximityBand, true> = {
  very_close: true,
  close: true,
  nearby: true,
  far: true,
};
const TREND_MEMBERS: Record<SignalTrend, true> = {
  approaching: true,
  steady: true,
  receding: true,
};
const ALL_BANDS = Object.keys(BAND_MEMBERS) as ProximityBand[];
const ALL_TRENDS = Object.keys(TREND_MEMBERS) as SignalTrend[];

/** Feed a whole stream and collect what `push` returned for each sample. */
function feed(filter: RssiFilter, samples: readonly number[]): number[] {
  return samples.map((s) => filter.push(s));
}

describe('medianOf', () => {
  it('returns 0 for an empty window rather than NaN', () => {
    expect(medianOf([])).toBe(0);
  });

  it('returns the middle element of an odd-length window regardless of input order', () => {
    expect(medianOf([-73])).toBe(-73);
    expect(medianOf([-40, -90, -50, -45, -70])).toBe(-50);
    expect(medianOf([-90, -70, -50, -45, -40])).toBe(-50);
  });

  it('averages the two middle elements of an even-length window', () => {
    expect(medianOf([-40, -90, -50, -45])).toBe(-47.5);
    expect(medianOf([-50, -70])).toBe(-60);
  });

  it('does not reorder or otherwise mutate the caller of the window it is given', () => {
    const window = [-40, -90, -50];
    medianOf(window);
    expect(window).toEqual([-40, -90, -50]);
  });
});

describe('RssiFilter median pre-filter', () => {
  it('holds the output at exactly the steady value when one impulse outlier arrives', () => {
    const filter = new RssiFilter();
    // Five steady packets fill the window; the sixth is a 40 dB impulse.
    expect(feed(filter, [-60, -60, -60, -60, -60])).toEqual([-60, -60, -60, -60, -60]);
    expect(filter.push(-20)).toBe(-60);
    expect(filter.value).toBe(-60);
  });

  it('still ignores a second outlier but moves once outliers own the majority of the window', () => {
    const filter = new RssiFilter();
    feed(filter, [-60, -60, -60, -60, -60]);
    expect(filter.push(-20)).toBe(-60); // 1 of 5 outliers
    expect(filter.push(-20)).toBe(-60); // 2 of 5 outliers — still a minority
    // 3 of 5 flips the median to -20; the EMA then steps 25% of the -60 -> -20 gap.
    expect(filter.push(-20)).toBe(-50);
  });

  it('medians the partial window while it fills, at exactly full, and after it slides', () => {
    // emaAlpha 1 makes push() return the median itself, isolating this stage.
    const filter = new RssiFilter({ emaAlpha: 1, medianWindow: 5 });
    expect(filter.push(-40)).toBe(-40); // window [-40]
    expect(filter.push(-90)).toBe(-65); // window [-40,-90] -> even, averaged
    expect(filter.push(-50)).toBe(-50); // window of 3
    expect(filter.push(-45)).toBe(-47.5); // window of 4 -> even, averaged
    expect(filter.push(-70)).toBe(-50); // window exactly full at 5
    expect(filter.push(-41)).toBe(-50); // slides: -40 evicted
    expect(filter.push(-42)).toBe(-45); // slides: -90 evicted, median rises
  });

  it('rounds an even median window up to the next odd size', () => {
    // medianWindow 4 must behave as 5: with a window of 4 the last median would
    // be -35 (the average of -40 and -30); with 5 it is the true middle, -30.
    const bumped = new RssiFilter({ emaAlpha: 1, medianWindow: 4 });
    expect(feed(bumped, [-10, -20, -30, -40, -50]).at(-1)).toBe(-30);

    // medianWindow 2 must behave as 3: the fourth sample evicts -10, leaving
    // [-50,-30,-90] whose median is -50 (a window of 2 would give -60).
    const two = new RssiFilter({ emaAlpha: 1, medianWindow: 2 });
    expect(feed(two, [-10, -50, -30, -90])).toEqual([-10, -30, -30, -50]);
  });
});

describe('RssiFilter exponential moving average', () => {
  it('seeds on the first sample instead of averaging it toward zero', () => {
    const filter = new RssiFilter();
    // A quarter-weighted average against a zero seed would return -17.5.
    expect(filter.push(-70)).toBe(-70);
    expect(filter.value).toBe(-70);
  });

  it('produces the exact 0.25-alpha sequence for a known input stream', () => {
    // medianWindow 1 removes the median stage so this is pure EMA arithmetic:
    // -50, then -50 + .25*(-10) = -52.5, then -52.5 + .25*(-7.5) = -54.375,
    // then -54.375 + .25*(-5.625) = -55.78125.
    const filter = new RssiFilter({ medianWindow: 1 });
    expect(feed(filter, [-50, -60, -60, -60])).toEqual([-50, -52.5, -54.375, -55.78125]);
  });

  it('halves the remaining gap each sample at alpha 0.5 and never overshoots the target', () => {
    const filter = new RssiFilter({ medianWindow: 1, emaAlpha: 0.5 });
    expect(feed(filter, [-40, -80, -80, -80])).toEqual([-40, -60, -70, -75]);
    // Asymptotic: 30 more samples get very close but stay above the target.
    let last = -75;
    for (let i = 0; i < 30; i++) last = filter.push(-80);
    expect(last).toBeGreaterThan(-80);
    expect(last).toBeCloseTo(-80, 6);
  });

  it('reports 0 dBm before any packet, which the distance model reads as out of range', () => {
    const filter = new RssiFilter();
    expect(filter.value).toBe(0);
    expect(filter.samples).toBe(0);
    expect(estimateDistance(filter.value)).toBe(Number.POSITIVE_INFINITY);
    expect(distanceRangeLabel(estimateDistance(filter.value))).toBe('Out of range');
  });

  it('returns to its unseeded state after reset', () => {
    const filter = new RssiFilter({ medianWindow: 1 });
    feed(filter, [-50, -60, -60, -60]);
    expect(filter.value).toBe(-55.78125);

    filter.reset();
    expect(filter.value).toBe(0);
    expect(filter.samples).toBe(0);
    expect(filter.isWarm).toBe(false);
    expect(filter.trend).toBe('steady');

    // A post-reset stream must reproduce the original sequence exactly.
    expect(feed(filter, [-50, -60, -60, -60])).toEqual([-50, -52.5, -54.375, -55.78125]);
  });
});

describe('RssiFilter warm-up gate', () => {
  it('turns warm at exactly warmupSamples and not one packet earlier', () => {
    const filter = new RssiFilter(); // warmupSamples 3
    expect(filter.isWarm).toBe(false); // 0 samples
    filter.push(-60);
    expect(filter.isWarm).toBe(false); // 1
    filter.push(-60);
    expect(filter.isWarm).toBe(false); // 2 — one below the threshold
    filter.push(-60);
    expect(filter.isWarm).toBe(true); // 3 — exactly the threshold
    filter.push(-60);
    expect(filter.isWarm).toBe(true); // 4 — one above, stays warm
  });

  it('honours a custom warm-up count and stays steady before any sample seeds the EMAs', () => {
    const one = new RssiFilter({ warmupSamples: 1 });
    expect(one.isWarm).toBe(false);
    one.push(-60);
    expect(one.isWarm).toBe(true);

    // Warm on zero samples, but the EMAs are still unseeded, so no trend is claimed.
    const zero = new RssiFilter({ warmupSamples: 0 });
    expect(zero.isWarm).toBe(true);
    expect(zero.trend).toBe('steady');
  });
});

describe('RssiFilter trend detection', () => {
  it('withholds a trend during warm-up even when the fast/slow gap already exceeds 1.5 dB', () => {
    const filter = new RssiFilter({ medianWindow: 1 });
    filter.push(-80); // fast -80, slow -80
    filter.push(-75); // fast -78, slow -79.6 -> delta 1.6 dB, past the threshold
    expect(filter.isWarm).toBe(false);
    expect(filter.trend).toBe('steady');
    filter.push(-70); // fast -74.8, slow -78.832 -> delta 4.032 dB, and now warm
    expect(filter.isWarm).toBe(true);
    expect(filter.trend).toBe('approaching');
  });

  it('reports approaching while RSSI climbs toward zero', () => {
    const filter = new RssiFilter({ medianWindow: 1 });
    feed(filter, [-80, -75, -70, -65, -60]);
    expect(filter.trend).toBe('approaching');
    expect(filter.value).toBeCloseTo(-70.25390625, 10);
  });

  it('reports receding while RSSI falls away', () => {
    const filter = new RssiFilter({ medianWindow: 1 });
    feed(filter, [-60, -65, -70]);
    expect(filter.trend).toBe('receding');
  });

  it('reports steady for a perfectly flat signal however long it runs', () => {
    const filter = new RssiFilter();
    for (let i = 0; i < 40; i++) filter.push(-72);
    expect(filter.trend).toBe('steady');
    expect(filter.value).toBe(-72);
  });

  it('reports steady for a noisy signal with no underlying drift', () => {
    const filter = new RssiFilter();
    // ±4 dB jitter around -70, symmetric, no trend.
    feed(filter, [-70, -74, -66, -70, -74, -66, -70, -74, -66, -70]);
    expect(filter.trend).toBe('steady');
  });

  it('holds steady at exactly +1.5 dB and only calls approaching once past it', () => {
    // fastAlpha 1 / slowAlpha 0 pins the pair so the delta is exact.
    const filter = new RssiFilter({
      medianWindow: 1,
      fastAlpha: 1,
      slowAlpha: 0,
      warmupSamples: 1,
    });
    filter.push(-70); // both EMAs seeded at -70; slow is frozen there
    expect(filter.trend).toBe('steady');
    filter.push(-68.5); // delta exactly +1.5 — the comparison is strictly greater
    expect(filter.trend).toBe('steady');
    filter.push(-68); // delta +2.0
    expect(filter.trend).toBe('approaching');
  });

  it('holds steady at exactly -1.5 dB and only calls receding once past it', () => {
    const filter = new RssiFilter({
      medianWindow: 1,
      fastAlpha: 1,
      slowAlpha: 0,
      warmupSamples: 1,
    });
    filter.push(-70);
    filter.push(-71.5); // delta exactly -1.5
    expect(filter.trend).toBe('steady');
    filter.push(-72); // delta -2.0
    expect(filter.trend).toBe('receding');
  });

  it('honours a custom trend threshold', () => {
    const filter = new RssiFilter({
      medianWindow: 1,
      fastAlpha: 1,
      slowAlpha: 0,
      warmupSamples: 1,
      trendThresholdDb: 5,
    });
    filter.push(-70);
    filter.push(-68); // +2 dB would trip the default 1.5 but not a 5 dB threshold
    expect(filter.trend).toBe('steady');
    filter.push(-64); // +6 dB
    expect(filter.trend).toBe('approaching');
  });

  it('lets the median stage suppress a trend an impulse would otherwise fake', () => {
    const filter = new RssiFilter(); // default 5-wide median
    feed(filter, [-80, -80, -80, -80, -80]);
    expect(filter.trend).toBe('steady');
    filter.push(-30); // a single 50 dB spike must not read as "approaching"
    expect(filter.trend).toBe('steady');
    expect(filter.value).toBe(-80);
  });

  it('flips from receding back to approaching when the peer turns around', () => {
    const filter = new RssiFilter({ medianWindow: 1 });
    feed(filter, [-60, -65, -70, -75, -80]);
    expect(filter.trend).toBe('receding');
    feed(filter, [-70, -60, -50, -45, -40]);
    expect(filter.trend).toBe('approaching');
  });
});

describe('estimateDistance', () => {
  it('returns exactly 1 m at the calibrated tx power', () => {
    expect(estimateDistance(DEFAULT_DISTANCE_MODEL.txPower)).toBe(1);
    expect(estimateDistance(-59)).toBe(1);
  });

  it('returns exactly 10 m one decade of path loss below tx power', () => {
    // 10 * n = 24 dB per decade, so -59 - 24 = -83 dBm is 10 m.
    expect(estimateDistance(-83)).toBe(10);
  });

  it('decreases strictly as RSSI rises across the unclamped range', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let rssi = -97; rssi <= -47; rssi++) {
      const d = estimateDistance(rssi);
      expect(d).toBeLessThan(previous);
      expect(d).toBeGreaterThan(0.3);
      expect(d).toBeLessThan(40);
      previous = d;
    }
  });

  it('never increases as RSSI rises anywhere in the usable range, including the clamps', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let rssi = -110; rssi <= -30; rssi++) {
      const d = estimateDistance(rssi);
      expect(d).toBeLessThanOrEqual(previous);
      previous = d;
    }
    expect(previous).toBe(0.3);
  });

  it('clamps to 0.3 m at the near end, one dB either side of the clamp point', () => {
    // The model crosses 0.3 m at about -46.45 dBm.
    expect(estimateDistance(-47)).toBeCloseTo(0.31622776601683794, 12);
    expect(estimateDistance(-46)).toBe(0.3); // raw model would say 0.2873 m
    expect(estimateDistance(-30)).toBe(0.3);
    expect(estimateDistance(-1)).toBe(0.3);
  });

  it('clamps to 40 m at the far end, one dB either side of the clamp point', () => {
    // The model crosses 40 m at about -97.45 dBm.
    expect(estimateDistance(-97)).toBeCloseTo(38.311868495572874, 10);
    expect(estimateDistance(-98)).toBe(40); // raw model would say 42.17 m
    expect(estimateDistance(-120)).toBe(40);
  });

  it('treats an RSSI of exactly 0 as "no reading" rather than a very strong signal', () => {
    expect(estimateDistance(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('honours a per-venue path loss exponent', () => {
    const freeSpace = { txPower: -59, pathLossExponent: 2 };
    expect(estimateDistance(-79, freeSpace)).toBe(10); // 20 dB per decade
    expect(estimateDistance(-59, freeSpace)).toBe(1);
    // A denser venue reads the same RSSI as a shorter distance.
    const dense = { txPower: -59, pathLossExponent: 3 };
    expect(estimateDistance(-79, dense)).toBeLessThan(estimateDistance(-79, freeSpace));
  });
});

describe('classifyBand naive thresholds', () => {
  it('assigns each exact band ceiling outward and one step either side correctly', () => {
    // maxDistance is an exclusive upper bound, so the ceiling itself belongs outward.
    expect(classifyBand(2.999)).toBe('very_close');
    expect(classifyBand(3)).toBe('close');
    expect(classifyBand(3.001)).toBe('close');

    expect(classifyBand(6.999)).toBe('close');
    expect(classifyBand(7)).toBe('nearby');
    expect(classifyBand(7.001)).toBe('nearby');

    expect(classifyBand(11.999)).toBe('nearby');
    expect(classifyBand(12)).toBe('far');
    expect(classifyBand(12.001)).toBe('far');
  });

  it('covers both extremes of the estimator output range', () => {
    expect(classifyBand(0)).toBe('very_close');
    expect(classifyBand(0.3)).toBe('very_close'); // the near clamp of the model
    expect(classifyBand(40)).toBe('far'); // the far clamp of the model
    expect(classifyBand(1e6)).toBe('far');
    expect(classifyBand(Number.POSITIVE_INFINITY)).toBe('far');
  });

  it('ignores hysteresis when no previous band is known or the previous band agrees', () => {
    expect(classifyBand(7.1)).toBe('nearby');
    expect(classifyBand(6.9)).toBe('close');
    expect(classifyBand(2.9, undefined)).toBe('very_close');
    expect(classifyBand(5, 'close')).toBe('close');
    expect(classifyBand(20, 'far')).toBe('far');
  });
});

describe('classifyBand hysteresis (anti-flicker)', () => {
  it('does not leave "close" outward until 7 m is overshot by the full 0.75 m margin', () => {
    expect(classifyBand(6.9, 'close')).toBe('close');
    expect(classifyBand(7, 'close')).toBe('close'); // crossed the raw boundary
    expect(classifyBand(7.4, 'close')).toBe('close');
    expect(classifyBand(7.74, 'close')).toBe('close'); // one step below the margin
    expect(classifyBand(7.75, 'close')).toBe('nearby'); // exactly the margin
    expect(classifyBand(7.76, 'close')).toBe('nearby'); // one step above
  });

  it('does not leave "nearby" inward until 7 m is undershot by the full 0.75 m margin', () => {
    expect(classifyBand(7.5, 'nearby')).toBe('nearby');
    expect(classifyBand(7, 'nearby')).toBe('nearby');
    expect(classifyBand(6.9, 'nearby')).toBe('nearby'); // crossed the raw boundary
    expect(classifyBand(6.3, 'nearby')).toBe('nearby');
    expect(classifyBand(6.26, 'nearby')).toBe('nearby'); // one step above the margin
    expect(classifyBand(6.25, 'nearby')).toBe('close'); // exactly the margin
    expect(classifyBand(6.24, 'nearby')).toBe('close'); // one step below
  });

  it('applies the same margin in both directions at the 3 m boundary', () => {
    expect(classifyBand(3, 'very_close')).toBe('very_close');
    expect(classifyBand(3.74, 'very_close')).toBe('very_close');
    expect(classifyBand(3.75, 'very_close')).toBe('close');

    expect(classifyBand(2.9, 'close')).toBe('close');
    expect(classifyBand(2.26, 'close')).toBe('close');
    expect(classifyBand(2.25, 'close')).toBe('very_close');
  });

  it('applies the same margin in both directions at the 12 m boundary', () => {
    expect(classifyBand(12, 'nearby')).toBe('nearby');
    expect(classifyBand(12.74, 'nearby')).toBe('nearby');
    expect(classifyBand(12.75, 'nearby')).toBe('far');

    expect(classifyBand(11.9, 'far')).toBe('far');
    expect(classifyBand(11.26, 'far')).toBe('far');
    expect(classifyBand(11.25, 'far')).toBe('nearby');
  });

  it('never flips band while a peer hovers on the 7 m boundary with normal jitter', () => {
    // The reason hysteresis exists: ±0.6 m of estimate jitter astride 7 m.
    const jitter = [6.8, 7.1, 6.6, 7.3, 6.9, 7.2, 6.4, 7.05, 6.95, 7.4];
    let band: ProximityBand = 'close';
    for (const d of jitter) {
      band = classifyBand(d, band);
      expect(band).toBe('close');
    }
  });

  it('completes a full outward-then-inward crossing with the margin honoured each way', () => {
    let band: ProximityBand = 'close';
    const outward = [7.0, 7.3, 7.6, 7.74, 7.75, 8.2];
    const outwardBands = outward.map((d) => (band = classifyBand(d, band)));
    expect(outwardBands).toEqual(['close', 'close', 'close', 'close', 'nearby', 'nearby']);

    const inward = [7.0, 6.6, 6.3, 6.26, 6.25, 5.8];
    const inwardBands = inward.map((d) => (band = classifyBand(d, band)));
    expect(inwardBands).toEqual(['nearby', 'nearby', 'nearby', 'nearby', 'close', 'close']);
  });

  it('scales the sticky zone with the supplied margin, vanishing entirely at zero', () => {
    // Zero margin reduces to naive classification in both directions.
    expect(classifyBand(3, 'very_close', 0)).toBe('close');
    expect(classifyBand(2.999, 'close', 0)).toBe('very_close');
    expect(classifyBand(7, 'close', 0)).toBe('nearby');
    expect(classifyBand(6.999, 'nearby', 0)).toBe('close');

    // A 3 m margin needs 10 m to release outward and 4 m to release inward.
    expect(classifyBand(9, 'close', 3)).toBe('close');
    expect(classifyBand(10, 'close', 3)).toBe('nearby');
    expect(classifyBand(4.5, 'nearby', 3)).toBe('nearby');
    expect(classifyBand(4, 'nearby', 3)).toBe('close');
  });

  it('allows an outward jump of several bands without extra stickiness', () => {
    expect(classifyBand(13, 'very_close')).toBe('far');
    expect(classifyBand(8, 'very_close')).toBe('nearby');
  });

  // BUG: the inward branch measures the margin against the *new* band's ceiling
  // (BANDS[nextIndex].maxDistance) instead of the boundary the peer is leaving.
  // A peer last seen "far" (>12 m) that is now measured at 2.5 m is 8.75 m past
  // the 11.25 m overshoot required to leave "far", yet it stays labelled "far"
  // because 2.5 > 3 - 0.75. src/apps/eventpulse/bluetooth/RssiProcessor.ts:206-207
  it('releases a "far" peer that has jumped several bands inward', () => {
    expect(classifyBand(11, 'far')).toBe('nearby'); // single-band step: correct today
    expect(classifyBand(6.5, 'far')).toBe('close'); // returns 'far' today
    expect(classifyBand(2.5, 'far')).toBe('very_close'); // returns 'far' today
    expect(classifyBand(2.5, 'nearby')).toBe('very_close'); // returns 'nearby' today
  });

  // BUG: same defect seen as a monotonicity violation. Holding `previous` fixed
  // at 'far' and walking the distance downward, the reported band gets *farther*
  // at 6.95 m and again at 2.95 m — a peer at 2.95 m reads "12 m+" while the same
  // peer at 11 m reads "7-12 m". src/apps/eventpulse/bluetooth/RssiProcessor.ts:206-207
  it('never reports a farther band for a smaller distance from the same previous band', () => {
    for (const previous of ALL_BANDS) {
      let last = bandIndex(classifyBand(20, previous));
      for (let cm = 2000; cm >= 0; cm -= 5) {
        const current = bandIndex(classifyBand(cm / 100, previous));
        expect(current).toBeLessThanOrEqual(last);
        last = current;
      }
    }
  });
});

describe('band and trend vocabulary helpers', () => {
  it('indexes every band member to its position in the ordered band table', () => {
    expect(ALL_BANDS).toHaveLength(BANDS.length);
    for (const band of ALL_BANDS) {
      const index = bandIndex(band);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(BANDS[index].band).toBe(band);
    }
    expect(bandIndex('very_close')).toBe(0);
    expect(bandIndex('close')).toBe(1);
    expect(bandIndex('nearby')).toBe(2);
    expect(bandIndex('far')).toBe(3);
  });

  it('gives every band member a non-empty label', () => {
    for (const band of ALL_BANDS) {
      const label = bandLabel(band);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
    expect(bandLabel('very_close')).toBe('Very close');
    expect(bandLabel('close')).toBe('Close');
    expect(bandLabel('nearby')).toBe('Nearby');
    expect(bandLabel('far')).toBe('Farther');
  });

  it('gives every band member a non-empty range label', () => {
    for (const band of ALL_BANDS) {
      const range = bandRangeLabel(band);
      expect(typeof range).toBe('string');
      expect(range.length).toBeGreaterThan(0);
    }
    expect(bandRangeLabel('very_close')).toBe('under 3 m');
    expect(bandRangeLabel('close')).toBe('3-7 m');
    expect(bandRangeLabel('nearby')).toBe('7-12 m');
    expect(bandRangeLabel('far')).toBe('12 m+');
  });

  it('gives every trend member a distinct non-empty phrase', () => {
    const phrases = ALL_TRENDS.map(trendLabel);
    for (const phrase of phrases) {
      expect(typeof phrase).toBe('string');
      expect(phrase.length).toBeGreaterThan(0);
    }
    expect(new Set(phrases).size).toBe(ALL_TRENDS.length);
    expect(trendLabel('approaching')).toBe('Getting closer');
    expect(trendLabel('receding')).toBe('Moving away');
    expect(trendLabel('steady')).toBe('Holding steady');
  });

  it('never renders a decimal figure for a distance, only a range', () => {
    for (const d of [0.3, 1, 2.999, 3, 6.999, 7, 11.999, 12, 39.9, 40]) {
      expect(distanceRangeLabel(d)).toBe(bandRangeLabel(classifyBand(d)));
      expect(distanceRangeLabel(d)).not.toMatch(/\d+\.\d/);
    }
  });

  it('labels a non-finite distance as out of range instead of guessing', () => {
    expect(distanceRangeLabel(Number.POSITIVE_INFINITY)).toBe('Out of range');
    expect(distanceRangeLabel(Number.NaN)).toBe('Out of range');
  });
});

describe('end-to-end conditioning', () => {
  it('turns a noisy approach into a stable, monotonically closing band sequence', () => {
    const filter = new RssiFilter();
    // A peer walking in: an underlying ramp from -85 to -55 with ±5 dB noise.
    const stream = [
      -85, -80, -88, -83, -86, -81, -84, -78, -82, -76, -79, -73, -77, -70, -74, -66, -71,
      -62, -68, -58, -64, -55,
    ];
    const bands: ProximityBand[] = [];
    let band: ProximityBand | undefined;
    for (const rssi of stream) {
      filter.push(rssi);
      band = classifyBand(estimateDistance(filter.value), band);
      bands.push(band);
    }

    // Never steps outward, and ends closer than it started.
    for (let i = 1; i < bands.length; i++) {
      expect(bandIndex(bands[i])).toBeLessThanOrEqual(bandIndex(bands[i - 1]));
    }
    expect(bands[0]).toBe('far');
    expect(bands.at(-1)).toBe('very_close');
    expect(filter.trend).toBe('approaching');
    expect(filter.isWarm).toBe(true);
  });

  it('holds one band for a stationary peer despite raw RSSI swinging 12 dB', () => {
    const filter = new RssiFilter();
    const stream = [-72, -66, -78, -70, -74, -68, -76, -71, -73, -69, -75, -72];
    const bands = new Set<ProximityBand>();
    let band: ProximityBand | undefined;
    for (const rssi of stream) {
      filter.push(rssi);
      band = classifyBand(estimateDistance(filter.value), band);
      bands.add(band);
    }
    expect([...bands]).toEqual(['close']);
    expect(filter.trend).toBe('steady');
  });
});
