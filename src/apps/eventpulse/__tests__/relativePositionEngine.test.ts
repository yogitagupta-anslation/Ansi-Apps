/**
 * RelativePositionEngine — the layout maths behind the proximity map.
 *
 * Everything under test here is pure: no timers, no I/O, no react-native. The
 * engine is fed real `PositionInput` values and asserted on the real
 * `PlacedPerson` values it returns, so nothing is mocked — not the hash, not the
 * angle helpers it borrows from HeadingService, not the polar conversion.
 *
 * The engine exposes no getter for a peer's smoothed radius, so every radius
 * assertion goes back through `cartesianToPolar(person.position)`. That is the
 * number the map actually draws.
 */

import { angleDelta } from '../positioning/HeadingService';
import {
  RelativePositionEngine,
  cartesianToPolar,
  polarToCartesian,
} from '../positioning/RelativePositionEngine';
import type { PositionInput } from '../positioning/RelativePositionEngine';
import type { PlacedPerson, ProximityBand } from '../types';

/* The engine's documented defaults — RelativePositionEngine.ts:55-63. */
const RADIUS_SMOOTHING = 0.18;
const BEARING_SMOOTHING = 0.22;
const MAX_RADIUS_STEP = 1.2;
const MAX_BEARING_STEP = 12;
const MIN_ANGULAR_SEPARATION = 14;
const RING_TOLERANCE_METERS = 2.5;
/** The undocumented-as-an-option radius floor — RelativePositionEngine.ts:159. */
const RADIUS_FLOOR = 0.4;
/** The layout-grade bearing confidence used when no hint arrives — line 104. */
const LAYOUT_CONFIDENCE = 0.15;

interface InputExtras {
  band?: ProximityBand;
  distanceConfidence?: number;
  bearingHint?: { bearing: number; confidence: number };
}

function at(peerId: string, distance: number, extras: InputExtras = {}): PositionInput {
  const input: PositionInput = { peerId, distance, band: extras.band ?? 'nearby' };
  if (extras.distanceConfidence !== undefined) {
    input.distanceConfidence = extras.distanceConfidence;
  }
  if (extras.bearingHint !== undefined) input.bearingHint = extras.bearingHint;
  return input;
}

/** A peer whose bearing we control, so bearing behaviour can be driven directly. */
function hinted(peerId: string, distance: number, bearing: number): PositionInput {
  return at(peerId, distance, {
    distanceConfidence: 0.9,
    bearingHint: { bearing, confidence: 0.6 },
  });
}

function placed(out: readonly PlacedPerson[], peerId: string): PlacedPerson {
  const found = out.find((person) => person.peerId === peerId);
  if (!found) throw new Error(`expected a placement for ${peerId}`);
  return found;
}

function only(out: readonly PlacedPerson[]): PlacedPerson {
  expect(out).toHaveLength(1);
  return placed(out, out[0].peerId);
}

function mustGet(engine: RelativePositionEngine, peerId: string): PlacedPerson {
  const person = engine.get(peerId);
  if (!person) throw new Error(`expected the engine to still hold ${peerId}`);
  return person;
}

function radiusOf(person: PlacedPerson): number {
  return cartesianToPolar(person.position).radius;
}

/** Circular gaps between sorted bearings, including the wrap from last to first. */
function circularGaps(bearings: readonly number[]): number[] {
  const sorted = [...bearings].sort((a, b) => a - b);
  return sorted.map((bearing, i) => (sorted[(i + 1) % sorted.length] - bearing + 360) % 360);
}

describe('stableBearing', () => {
  it('gives one peer id the same bearing on every call and in every engine', () => {
    const direct = RelativePositionEngine.stableBearing('peer-a');
    expect(RelativePositionEngine.stableBearing('peer-a')).toBe(direct);
    expect(direct).toBeCloseTo(123.8849136, 6);

    const first = new RelativePositionEngine();
    const second = new RelativePositionEngine();
    const fromFirst = only(first.update([at('peer-a', 6)])).bearing;
    const fromSecond = only(second.update([at('peer-a', 6)])).bearing;

    expect(fromFirst).toBe(direct);
    expect(fromSecond).toBe(direct);
  });

  it('keeps every bearing inside [0, 360) for hundreds of ids and for the empty id', () => {
    for (let i = 0; i < 500; i++) {
      const bearing = RelativePositionEngine.stableBearing(`peer-${i}`);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }

    const empty = RelativePositionEngine.stableBearing('');
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(empty).toBeLessThan(360);
    expect(empty).toBeCloseTo(310.2393168, 6);
  });

  it('spreads sixteen ids over every 45 degree sector rather than clustering', () => {
    const bearings = Array.from({ length: 16 }, (_, i) =>
      RelativePositionEngine.stableBearing(`peer-${i}`),
    );

    const sectors = new Set(bearings.map((bearing) => Math.floor(bearing / 45)));
    expect(sectors.size).toBe(8);

    // No quadrant-sized hole anywhere on the circle.
    expect(Math.max(...circularGaps(bearings))).toBeLessThan(90);
  });

  it('keeps a small crowd apart without leaning on the separation pass', () => {
    const bearings = Array.from({ length: 8 }, (_, i) =>
      RelativePositionEngine.stableBearing(`peer-${i}`),
    );

    expect(Math.min(...circularGaps(bearings))).toBeGreaterThan(15);
    expect(new Set(bearings).size).toBe(8);
  });
});

describe('first sight', () => {
  it('places a new peer at exactly its measured radius and hashed bearing, unsmoothed', () => {
    const engine = new RelativePositionEngine();
    const person = only(engine.update([at('peer-a', 8.3)]));

    expect(radiusOf(person)).toBeCloseTo(8.3, 10);
    expect(person.estimatedDistance).toBe(8.3);
    expect(person.bearing).toBe(RelativePositionEngine.stableBearing('peer-a'));

    const expected = polarToCartesian(8.3, person.bearing);
    expect(person.position.x).toBeCloseTo(expected.x, 12);
    expect(person.position.y).toBeCloseTo(expected.y, 12);
  });

  it('places a late joiner at its own radius while the first peer is still easing', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('peer-a', 3)]);

    // 'peer-a' is 27 m from its new target, so it may only move one capped step;
    // 'peer-c' has never been seen and lands where it was measured. The two sit
    // on rings 1 and 8, far too far apart for the separation pass to touch them.
    const out = engine.update([at('peer-a', 30), at('peer-c', 20)]);

    expect(radiusOf(placed(out, 'peer-a'))).toBeCloseTo(3 + MAX_RADIUS_STEP, 10);
    expect(radiusOf(placed(out, 'peer-c'))).toBeCloseTo(20, 10);
    expect(placed(out, 'peer-c').bearing).toBe(RelativePositionEngine.stableBearing('peer-c'));
  });
});

describe('radius smoothing', () => {
  it('caps a single update at maxRadiusStep when the distance estimate jumps', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('one', 3)]);

    const person = only(engine.update([at('one', 30)]));

    expect(radiusOf(person)).toBeCloseTo(3 + MAX_RADIUS_STEP, 10);
    // The raw measurement is reported honestly even while the dot is catching up.
    expect(person.estimatedDistance).toBe(30);
  });

  it('closes gap * radiusSmoothing when that lands under the cap', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('one', 3)]);

    const person = only(engine.update([at('one', 5)]));

    expect(radiusOf(person)).toBeCloseTo(3 + 2 * RADIUS_SMOOTHING, 10);
  });

  it('caps every update in both directions, however far the estimate swings', () => {
    const engine = new RelativePositionEngine();
    let previous = radiusOf(only(engine.update([at('one', 3)])));

    for (const target of [40, 40, 40, 40, 40, 0.5, 0.5, 0.5, 0.5, 0.5, 40, 0.5]) {
      const radius = radiusOf(only(engine.update([at('one', target)])));
      expect(Math.abs(radius - previous)).toBeLessThanOrEqual(MAX_RADIUS_STEP + 1e-9);
      previous = radius;
    }
  });

  it('converges on the measured distance and never overshoots it', () => {
    const engine = new RelativePositionEngine();
    let previous = radiusOf(only(engine.update([at('one', 3)])));

    for (let i = 0; i < 100; i++) {
      const radius = radiusOf(only(engine.update([at('one', 30)])));
      expect(radius).toBeGreaterThan(previous);
      expect(radius).toBeLessThanOrEqual(30);
      previous = radius;
    }

    expect(radiusOf(mustGet(engine, 'one'))).toBeCloseTo(30, 4);
  });

  it('honours a tighter maxRadiusStep than the default', () => {
    const engine = new RelativePositionEngine({ maxRadiusStep: 0.5 });
    engine.update([at('one', 3)]);

    expect(radiusOf(only(engine.update([at('one', 30)])))).toBeCloseTo(3.5, 10);
  });
});

describe('the radius floor', () => {
  it('never places a peer closer than the floor, even at a measured distance of zero', () => {
    const engine = new RelativePositionEngine();
    const person = only(engine.update([at('one', 0)]));

    expect(radiusOf(person)).toBeCloseTo(RADIUS_FLOOR, 10);
    // The floor is a drawing decision; the estimate itself is not rewritten.
    expect(person.estimatedDistance).toBe(0);
  });

  it('leaves a peer exactly on the floor where it is and lifts one just below it', () => {
    const onFloor = new RelativePositionEngine();
    expect(radiusOf(only(onFloor.update([at('one', RADIUS_FLOOR)])))).toBeCloseTo(RADIUS_FLOOR, 10);

    const below = new RelativePositionEngine();
    expect(radiusOf(only(below.update([at('one', 0.39)])))).toBeCloseTo(RADIUS_FLOOR, 10);
  });

  it('leaves a peer one centimetre above the floor unmoved', () => {
    const engine = new RelativePositionEngine();
    expect(radiusOf(only(engine.update([at('one', 0.41)])))).toBeCloseTo(0.41, 10);
  });

  it('holds the floor for as long as the estimate stays under it', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('one', 10)]);

    for (let i = 0; i < 40; i++) {
      const radius = radiusOf(only(engine.update([at('one', 0.1)])));
      // The engine holds exactly 0.4; recovering it through
      // polar -> cartesian -> polar costs up to ~1e-16, hence the epsilon.
      expect(radius).toBeGreaterThan(RADIUS_FLOOR - 1e-12);
    }

    expect(radiusOf(mustGet(engine, 'one'))).toBeCloseTo(RADIUS_FLOOR, 10);
  });
});

describe('bearing easing', () => {
  it('closes gap * bearingSmoothing when the change is under the cap', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 100)]);

    const person = only(engine.update([hinted('one', 5, 110)]));

    expect(person.bearing).toBeCloseTo(100 + 10 * BEARING_SMOOTHING, 10);
  });

  it('caps a half-turn change at maxBearingStep', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 0)]);

    expect(only(engine.update([hinted('one', 5, 180)])).bearing).toBeCloseTo(MAX_BEARING_STEP, 10);
  });

  it('caps an anticlockwise change at maxBearingStep too', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 0)]);

    // 181 is a degree the short way *backwards*, so the step is negative and wraps.
    expect(only(engine.update([hinted('one', 5, 181)])).bearing).toBeCloseTo(
      360 - MAX_BEARING_STEP,
      10,
    );
  });

  it('honours a tighter maxBearingStep than the default', () => {
    const engine = new RelativePositionEngine({ maxBearingStep: 3 });
    engine.update([hinted('one', 5, 0)]);

    expect(only(engine.update([hinted('one', 5, 180)])).bearing).toBeCloseTo(3, 10);
  });

  it('goes from 350 to 10 through zero, not backwards through 180', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 350)]);

    const first = only(engine.update([hinted('one', 5, 10)])).bearing;
    expect(first).toBeCloseTo(350 + 20 * BEARING_SMOOTHING, 10);

    for (let i = 0; i < 60; i++) {
      const bearing = only(engine.update([hinted('one', 5, 10)])).bearing;
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
      // The whole path stays inside the 20 degree arc that contains 0.
      expect(bearing >= 350 - 1e-9 || bearing <= 10 + 1e-9).toBe(true);
    }

    expect(mustGet(engine, 'one').bearing).toBeCloseTo(10, 4);
  });

  it('goes from 10 to 350 backwards through zero for the same reason', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 10)]);

    const first = only(engine.update([hinted('one', 5, 350)])).bearing;
    expect(first).toBeCloseTo(10 - 20 * BEARING_SMOOTHING, 10);

    for (let i = 0; i < 60; i++) {
      const bearing = only(engine.update([hinted('one', 5, 350)])).bearing;
      expect(bearing >= 350 - 1e-9 || bearing <= 10 + 1e-9).toBe(true);
    }

    expect(mustGet(engine, 'one').bearing).toBeCloseTo(350, 4);
  });
});

describe('angular separation', () => {
  it('pushes two peers on one ring apart to exactly minAngularSeparation', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('a', 5, 100), hinted('b', 5, 104)]);

    expect(placed(out, 'a').bearing).toBeCloseTo(97, 9);
    expect(placed(out, 'b').bearing).toBeCloseTo(111, 9);
    expect(Math.abs(angleDelta(placed(out, 'a').bearing, placed(out, 'b').bearing))).toBeCloseTo(
      MIN_ANGULAR_SEPARATION,
      9,
    );
  });

  it('leaves a pair already exactly minAngularSeparation apart untouched', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('a', 5, 100), hinted('b', 5, 114)]);

    expect(placed(out, 'a').bearing).toBe(100);
    expect(placed(out, 'b').bearing).toBe(114);
  });

  it('separates a pair a hundredth of a degree inside the threshold', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('a', 5, 100), hinted('b', 5, 113.99)]);

    expect(placed(out, 'a').bearing).toBeLessThan(100);
    expect(placed(out, 'b').bearing).toBeGreaterThan(113.99);
    expect(Math.abs(angleDelta(placed(out, 'a').bearing, placed(out, 'b').bearing))).toBeCloseTo(
      MIN_ANGULAR_SEPARATION,
      6,
    );
  });

  it('moves the nearer peer less than the farther one', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('near', 5, 100), hinted('far', 6, 104)]);

    // 3 degrees for the near peer against 7 for the far one — weights 0.3 / 0.7.
    expect(Math.abs(angleDelta(100, placed(out, 'near').bearing))).toBeCloseTo(3, 9);
    expect(Math.abs(angleDelta(104, placed(out, 'far').bearing))).toBeCloseTo(7, 9);
  });

  it('still favours the nearer peer when the far one sorts first by bearing', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('far', 6, 100), hinted('near', 5, 104)]);

    expect(Math.abs(angleDelta(104, placed(out, 'near').bearing))).toBeCloseTo(3, 9);
    expect(Math.abs(angleDelta(100, placed(out, 'far').bearing))).toBeCloseTo(7, 9);
  });

  it('leaves peers on clearly different rings stacked on the same bearing', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('inner', 2, 100), hinted('outer', 20, 100)]);

    expect(placed(out, 'inner').bearing).toBe(100);
    expect(placed(out, 'outer').bearing).toBe(100);
  });

  it('still separates peers exactly ringToleranceMeters apart in radius', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('a', 5, 100), hinted('b', 5 + RING_TOLERANCE_METERS, 104)]);

    expect(placed(out, 'a').bearing).toBeCloseTo(97, 9);
    expect(placed(out, 'b').bearing).toBeCloseTo(111, 9);
  });

  it('leaves peers a tenth of a metre beyond the ring tolerance alone', () => {
    const engine = new RelativePositionEngine();
    const out = engine.update([hinted('a', 5, 100), hinted('b', 7.6, 104)]);

    expect(placed(out, 'a').bearing).toBe(100);
    expect(placed(out, 'b').bearing).toBe(104);
  });

  it('holds the separation across repeated updates instead of oscillating', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('a', 5, 100), hinted('b', 5, 104)]);

    for (let i = 0; i < 25; i++) {
      const out = engine.update([hinted('a', 5, 100), hinted('b', 5, 104)]);
      expect(Math.abs(angleDelta(placed(out, 'a').bearing, placed(out, 'b').bearing))).toBeCloseTo(
        MIN_ANGULAR_SEPARATION,
        9,
      );
    }

    expect(mustGet(engine, 'a').bearing).toBeCloseTo(97, 9);
    expect(mustGet(engine, 'b').bearing).toBeCloseTo(111, 9);
  });

  it('settles a cluster of three onto distinct, near-minimum gaps', () => {
    const engine = new RelativePositionEngine();
    const feed = (): PlacedPerson[] =>
      engine.update([hinted('a', 5, 100), hinted('b', 5, 104), hinted('c', 5, 108)]);

    for (let i = 0; i < 40; i++) feed();
    const settled = feed().map((person) => person.bearing);
    const again = feed().map((person) => person.bearing);

    // Settled: a further update shifts nobody by even a thousandth of a degree.
    settled.forEach((bearing, i) => {
      expect(Math.abs(angleDelta(bearing, again[i]))).toBeLessThan(0.001);
    });

    // Three-way relaxation converges rather than solving in one pass, so the
    // guarantee is "within a hundredth of minAngularSeparation", not the exact
    // pairwise value two peers alone reach.
    expect(new Set(settled).size).toBe(3);
    const gaps = circularGaps(settled).filter((gap) => gap < 180);
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeGreaterThan(MIN_ANGULAR_SEPARATION - 0.01);
  });

  it('leaves a lone peer exactly on its bearing forever', () => {
    const engine = new RelativePositionEngine();
    engine.update([hinted('one', 5, 100)]);

    for (let i = 0; i < 10; i++) {
      expect(only(engine.update([hinted('one', 5, 100)])).bearing).toBe(100);
    }
  });

  // BUG: RelativePositionEngine.ts:46 documents maxBearingStep as a "Hard cap on
  // angular movement per update, in degrees", and step() honours it
  // (RelativePositionEngine.ts:161-166). separate() never consults it
  // (RelativePositionEngine.ts:209-213), so when several already-placed peers
  // arrive on one ring in a single update their bearings swing tens of degrees in
  // that one frame — exactly the teleport the cap exists to prevent. `it.failing`
  // passes while the defect stands and turns red the day the cap is applied there.
  it.failing('never moves an established peer further than maxBearingStep in one update', () => {
    // radiusSmoothing 1 with a huge radius cap lets the peers collapse onto one
    // ring in a single update, so the only thing moving bearings is separate().
    const engine = new RelativePositionEngine({ radiusSmoothing: 1, maxRadiusStep: 100 });
    const frame = (distances: readonly number[]): PlacedPerson[] =>
      engine.update(distances.map((distance, i) => hinted(`ring-${i}`, distance, 100)));

    const before = frame([3, 20, 40, 60, 80]);
    for (const person of before) expect(person.bearing).toBe(100);

    for (const person of frame([5, 5, 5, 5, 5])) {
      const moved = Math.abs(angleDelta(placed(before, person.peerId).bearing, person.bearing));
      expect(moved).toBeLessThanOrEqual(MAX_BEARING_STEP + 1e-9);
    }
  });
});

describe('peer lifecycle', () => {
  it('drops a peer that is missing from the next update', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('stays', 5), at('goes', 20)]);

    const out = engine.update([at('stays', 5)]);

    expect(out.map((person) => person.peerId)).toEqual(['stays']);
    expect(engine.get('goes')).toBeUndefined();
  });

  it('forgets a dropped peer, so a return visit is placed at its new measured radius', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('one', 3)]);
    for (let i = 0; i < 5; i++) engine.update([at('one', 3)]);

    engine.update([]);
    const returned = only(engine.update([at('one', 25)]));

    // No easing from 3 m: the engine kept no memory of the earlier visit.
    expect(radiusOf(returned)).toBeCloseTo(25, 10);
  });

  it('returns an empty array and holds nobody when the input is empty', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('a', 5), at('b', 9)]);

    expect(engine.update([])).toEqual([]);
    expect(engine.get('a')).toBeUndefined();
    expect(engine.get('b')).toBeUndefined();
  });

  it('drops everyone on clear()', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('a', 5), at('b', 9)]);

    engine.clear();

    expect(engine.get('a')).toBeUndefined();
    expect(radiusOf(only(engine.update([at('a', 5)])))).toBeCloseTo(5, 10);
  });
});

describe('bearingHint', () => {
  // Nothing in the app supplies one today: PresenceController.ts:274 calls
  // `proximityInputFrom(record, undefined, now)`, and that `undefined` is the
  // bearingHint argument, so every input the running app builds leaves it unset.
  // This whole block therefore covers a seam that only AnchorSolver /
  // NavigationService would reach (RelativePositionEngine.ts:14-18) — it is
  // unreachable in the shipped code path.
  it('uses the supplied bearing instead of the hashed one', () => {
    const engine = new RelativePositionEngine();
    const person = only(engine.update([hinted('peer-a', 5, 42)]));

    expect(person.bearing).toBe(42);
    expect(person.bearing).not.toBe(RelativePositionEngine.stableBearing('peer-a'));
  });

  it('normalises a hint that falls outside [0, 360)', () => {
    const engine = new RelativePositionEngine();
    expect(only(engine.update([hinted('a', 5, -30)])).bearing).toBe(330);

    const wrapped = new RelativePositionEngine();
    expect(only(wrapped.update([hinted('b', 5, 730)])).bearing).toBeCloseTo(10, 10);
  });

  it('raises confidence above the layout baseline a hashed bearing is capped at', () => {
    const engine = new RelativePositionEngine();
    const hashed = only(engine.update([at('one', 5, { distanceConfidence: 0.9 })]));
    expect(hashed.confidence).toBeCloseTo(LAYOUT_CONFIDENCE, 10);

    const measured = new RelativePositionEngine();
    const person = only(
      measured.update([
        at('one', 5, { distanceConfidence: 0.9, bearingHint: { bearing: 42, confidence: 0.8 } }),
      ]),
    );
    expect(person.confidence).toBeCloseTo(0.8, 10);
    expect(person.confidence).toBeGreaterThan(hashed.confidence);
  });
});

describe('confidence', () => {
  it('reports the weaker half when a measured bearing arrives', () => {
    const engine = new RelativePositionEngine();
    const weakBearing = only(
      engine.update([
        at('one', 5, { distanceConfidence: 0.9, bearingHint: { bearing: 10, confidence: 0.8 } }),
      ]),
    );
    expect(weakBearing.confidence).toBeCloseTo(0.8, 10);

    const weakDistance = new RelativePositionEngine();
    expect(
      only(
        weakDistance.update([
          at('two', 5, { distanceConfidence: 0.4, bearingHint: { bearing: 10, confidence: 0.9 } }),
        ]),
      ).confidence,
    ).toBeCloseTo(0.4, 10);
  });

  it('falls to the distance confidence when that is weaker than the layout baseline', () => {
    const engine = new RelativePositionEngine();
    expect(only(engine.update([at('one', 5, { distanceConfidence: 0.05 })])).confidence).toBeCloseTo(
      0.05,
      10,
    );
  });

  it('defaults the distance half to 0.5 when the caller omits it', () => {
    const engine = new RelativePositionEngine();
    const person = only(
      engine.update([at('one', 5, { bearingHint: { bearing: 10, confidence: 0.9 } })]),
    );

    expect(person.confidence).toBeCloseTo(0.5, 10);
  });

  it('floors the bearing half at the layout baseline rather than going lower', () => {
    // A hint worse than a hash is still treated as hash-grade: max(bc, 0.15) on
    // RelativePositionEngine.ts:116. So 0.02 does not drag the placement below
    // what a laid-out bearing is worth.
    const engine = new RelativePositionEngine();
    const person = only(
      engine.update([
        at('one', 5, { distanceConfidence: 0.9, bearingHint: { bearing: 10, confidence: 0.02 } }),
      ]),
    );

    expect(person.confidence).toBeCloseTo(LAYOUT_CONFIDENCE, 10);
  });

  it('stays inside 0..1 across the whole in-contract input range', () => {
    const engine = new RelativePositionEngine();

    for (const distanceConfidence of [0, 0.05, LAYOUT_CONFIDENCE, 0.5, 1]) {
      for (const bearingConfidence of [0, 0.1, LAYOUT_CONFIDENCE, 0.5, 1]) {
        const person = only(
          engine.update([
            at('one', 5, {
              distanceConfidence,
              bearingHint: { bearing: 10, confidence: bearingConfidence },
            }),
          ]),
        );

        expect(person.confidence).toBeGreaterThanOrEqual(0);
        expect(person.confidence).toBeLessThanOrEqual(1);
        expect(person.confidence).toBeCloseTo(
          Math.min(distanceConfidence, Math.max(bearingConfidence, LAYOUT_CONFIDENCE)),
          10,
        );
      }
    }
  });

  it('keeps confidence in step with the newest reading, not the first one', () => {
    const engine = new RelativePositionEngine();
    engine.update([at('one', 5, { distanceConfidence: 0.9 })]);

    expect(only(engine.update([at('one', 5, { distanceConfidence: 0.02 })])).confidence).toBeCloseTo(
      0.02,
      10,
    );
  });
});

describe('polar and cartesian conversion', () => {
  it('maps the four cardinal bearings onto the documented axes', () => {
    // +Y is ahead of the user and bearings run clockwise, so 90 is to the right.
    expect(polarToCartesian(5, 0).x).toBeCloseTo(0, 12);
    expect(polarToCartesian(5, 0).y).toBeCloseTo(5, 12);

    expect(polarToCartesian(5, 90).x).toBeCloseTo(5, 12);
    expect(polarToCartesian(5, 90).y).toBeCloseTo(0, 12);

    expect(polarToCartesian(5, 180).x).toBeCloseTo(0, 12);
    expect(polarToCartesian(5, 180).y).toBeCloseTo(-5, 12);

    expect(polarToCartesian(5, 270).x).toBeCloseTo(-5, 12);
    expect(polarToCartesian(5, 270).y).toBeCloseTo(0, 12);
  });

  it('round-trips radius and bearing through cartesian space', () => {
    for (const bearing of [0, 1, 45, 90, 137.5, 179, 180, 181, 270, 359.9]) {
      for (const radius of [RADIUS_FLOOR, 1, 7.25, 120]) {
        const roundTripped = cartesianToPolar(polarToCartesian(radius, bearing));
        expect(roundTripped.radius).toBeCloseTo(radius, 10);
        expect(roundTripped.bearing).toBeCloseTo(bearing, 10);
      }
    }
  });

  it('normalises a recovered bearing into [0, 360) and collapses the origin', () => {
    expect(cartesianToPolar(polarToCartesian(4, 450)).bearing).toBeCloseTo(90, 10);
    expect(cartesianToPolar(polarToCartesian(4, -90)).bearing).toBeCloseTo(270, 10);
    expect(cartesianToPolar({ x: 0, y: 0 })).toEqual({ radius: 0, bearing: 0 });
  });

  it('agrees with the engine: a placement round-trips back to its own bearing', () => {
    const engine = new RelativePositionEngine();
    const person = only(engine.update([at('peer-a', 12.5)]));

    const recovered = cartesianToPolar(person.position);
    expect(recovered.radius).toBeCloseTo(12.5, 10);
    expect(recovered.bearing).toBeCloseTo(person.bearing, 10);
  });
});
