/**
 * AnchorSolver — infrastructure-assisted multilateration.
 *
 * The module is currently unimported, which is exactly why its behaviour is worth
 * pinning: whoever wires it up (or deletes it) should have to argue with a test rather
 * than guess at what it promised. The header promise under test is the conservative one —
 * "it refuses to produce a fix from poor geometry rather than emitting a confident-looking
 * wrong answer" — so most of these cases are about when it says null.
 *
 * Every expected position is a coordinate chosen up front; the ranges fed in are the
 * distances from that coordinate to each anchor, so a recovered position that is not the
 * chosen one is a real failure and not a tolerance artefact.
 */

import {
  AnchorSolver,
  geometryQuality,
  type AnchorDefinition,
  type AnchorRange,
  type PositionFix,
} from '../positioning/AnchorSolver';
import type { RelativePoint } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures and helpers
 * ------------------------------------------------------------------ */

const anchorAt = (peerId: string, x: number, y: number): AnchorDefinition => ({
  peerId,
  name: peerId.toUpperCase(),
  x,
  y,
});

const rangeOf = (anchorId: string, distance: number, confidence = 0.9): AnchorRange => ({
  anchorId,
  distance,
  confidence,
});

/** True distance from an anchor to a venue point — the input the RSSI pipeline would supply. */
const trueRange = (anchor: AnchorDefinition, point: RelativePoint): number =>
  Math.hypot(point.x - anchor.x, point.y - anchor.y);

/**
 * Narrows `PositionFix | null` while failing the test with a readable message. Throwing
 * (rather than asserting and using `!`) keeps `it.failing` cases honest: a null where a fix
 * was promised is itself the failure being recorded.
 */
const requireFix = (fix: PositionFix | null, what: string): PositionFix => {
  if (fix === null) throw new Error(`expected a position fix for ${what}, got null`);
  return fix;
};

const offsetFrom = (fix: PositionFix, truth: RelativePoint): number =>
  Math.hypot(fix.position.x - truth.x, fix.position.y - truth.y);

/**
 * The reference venue: a 10 m x 8 m triangle of anchors.
 *   a1 (0,0)   a2 (10,0)   a3 (5,8)   and, for the over-determined runs, a4 (0,8).
 * geometryQuality of a1/a2/a3 is 40 / (10^2 * 0.5) = 0.8.
 */
const A1 = anchorAt('a1', 0, 0);
const A2 = anchorAt('a2', 10, 0);
const A3 = anchorAt('a3', 5, 8);
const A4 = anchorAt('a4', 0, 8);

/** The position every "clean solve" test must recover. */
const TRUTH: RelativePoint = { x: 4, y: 3 };

// Distances from TRUTH, written out rather than computed, so the arithmetic is visible:
const D1 = 5; //                 |(4,3) - (0,0) | = sqrt(16 + 9)
const D2 = Math.sqrt(45); //     |(4,3) - (10,0)| = sqrt(36 + 9)
const D3 = Math.sqrt(26); //     |(4,3) - (5,8) | = sqrt(1 + 25)
const D4 = Math.sqrt(41); //     |(4,3) - (0,8) | = sqrt(16 + 25)

const CLEAN_TRIPLE: readonly AnchorRange[] = [
  rangeOf('a1', D1),
  rangeOf('a2', D2),
  rangeOf('a3', D3),
];

const solverFor = (
  anchors: readonly AnchorDefinition[],
  options?: ConstructorParameters<typeof AnchorSolver>[0],
): AnchorSolver => {
  const solver = new AnchorSolver(options);
  solver.setAnchors(anchors);
  return solver;
};

/* ------------------------------------------------------------------ *
 * Anchor registration
 * ------------------------------------------------------------------ */

describe('anchor registration', () => {
  it('counts distinct peer ids, collapsing a repeated anchor definition', () => {
    const solver = new AnchorSolver();
    solver.setAnchors([A1, A2, anchorAt('a1', 99, 99)]);

    expect(solver.anchorCount).toBe(2);
  });

  it('is not configured until a third anchor is registered', () => {
    const solver = new AnchorSolver();
    expect(solver.anchorCount).toBe(0);
    expect(solver.isConfigured).toBe(false);

    solver.setAnchors([A1]);
    expect(solver.isConfigured).toBe(false);

    solver.setAnchors([A1, A2]);
    expect(solver.anchorCount).toBe(2);
    expect(solver.isConfigured).toBe(false);

    solver.setAnchors([A1, A2, A3]);
    expect(solver.anchorCount).toBe(3);
    expect(solver.isConfigured).toBe(true);

    solver.setAnchors([A1, A2, A3, A4]);
    expect(solver.anchorCount).toBe(4);
    expect(solver.isConfigured).toBe(true);
  });

  it('forgets every previously registered anchor when the set is replaced', () => {
    const solver = solverFor([A1, A2, A3, A4]);
    expect(solver.solve(CLEAN_TRIPLE)).not.toBeNull();

    solver.setAnchors([anchorAt('b1', 0, 0), anchorAt('b2', 30, 0)]);

    expect(solver.anchorCount).toBe(2);
    expect(solver.isConfigured).toBe(false);
    // The old ids are gone, so all three ranges are discarded and nothing is usable.
    expect(solver.solve(CLEAN_TRIPLE)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Clean solves
 * ------------------------------------------------------------------ */

describe('solve — recovering a known position', () => {
  it('recovers a position inside the anchor triangle to within a centimetre', () => {
    const fix = requireFix(solverFor([A1, A2, A3]).solve(CLEAN_TRIPLE), 'three exact ranges');

    expect(fix.position.x).toBeCloseTo(4, 6);
    expect(fix.position.y).toBeCloseTo(3, 6);
    expect(offsetFrom(fix, TRUTH)).toBeLessThan(0.01);
  });

  it('reports a near-zero residual, near-total confidence and the range count it used', () => {
    const fix = requireFix(solverFor([A1, A2, A3]).solve(CLEAN_TRIPLE), 'three exact ranges');

    expect(fix.errorMeters).toBeLessThan(1e-6);
    expect(fix.errorMeters).toBeGreaterThanOrEqual(0);
    // An exact fit drives the residual term to ~1, but a fix may not out-confide
    // its inputs, so the reported figure is capped at the mean range confidence
    // (`rangeOf` defaults to 0.9). See "confidence reporting" below.
    expect(fix.confidence).toBeCloseTo(0.9, 6);
    expect(fix.confidence).toBeLessThanOrEqual(1);
    expect(fix.anchorsUsed).toBe(3);
  });

  it('is at least as accurate over-determined with four exact ranges as with three', () => {
    const three = requireFix(solverFor([A1, A2, A3]).solve(CLEAN_TRIPLE), 'three exact ranges');
    const four = requireFix(
      solverFor([A1, A2, A3, A4]).solve([...CLEAN_TRIPLE, rangeOf('a4', D4)]),
      'four exact ranges',
    );

    expect(four.anchorsUsed).toBe(4);
    expect(offsetFrom(four, TRUTH)).toBeLessThanOrEqual(offsetFrom(three, TRUTH));
    expect(offsetFrom(four, TRUTH)).toBeLessThan(1e-9);
  });

  it('lets a fourth noisy range pull the fix closer to the truth than three alone', () => {
    // The same three measurement errors in both runs (+0.40, -0.35, +0.25 m), plus a
    // fourth anchor reading 0.30 m short.
    const noisyTriple: readonly AnchorRange[] = [
      rangeOf('a1', D1 + 0.4, 0.7),
      rangeOf('a2', D2 - 0.35, 0.7),
      rangeOf('a3', D3 + 0.25, 0.7),
    ];
    const three = requireFix(solverFor([A1, A2, A3]).solve(noisyTriple), 'three noisy ranges');
    const four = requireFix(
      solverFor([A1, A2, A3, A4]).solve([...noisyTriple, rangeOf('a4', D4 - 0.3, 0.7)]),
      'four noisy ranges',
    );

    expect(three.position.x).toBeCloseTo(4.4357, 3);
    expect(three.position.y).toBeCloseTo(2.8157, 3);
    expect(four.position.x).toBeCloseTo(4.2201, 3);
    expect(four.position.y).toBeCloseTo(3.0511, 3);

    expect(offsetFrom(three, TRUTH)).toBeCloseTo(0.473, 3);
    expect(offsetFrom(four, TRUTH)).toBeCloseTo(0.226, 3);
    expect(offsetFrom(four, TRUTH)).toBeLessThan(offsetFrom(three, TRUTH));

    // Documented, and worth knowing before anyone treats errorMeters as an accuracy
    // estimate: three ranges are exactly determined, so their residual collapses to almost
    // nothing (0.134 m) even though the fix is twice as far from the truth as the
    // four-anchor one, whose honest residual is 0.293 m.
    expect(three.errorMeters).toBeCloseTo(0.1344, 3);
    expect(four.errorMeters).toBeCloseTo(0.2933, 3);
    expect(three.errorMeters).toBeLessThan(four.errorMeters);
  });

  it('solves for a position well outside the anchor hull', () => {
    const outside: RelativePoint = { x: 40, y: 40 };
    const fix = requireFix(
      solverFor([A1, A2, A3]).solve([
        rangeOf('a1', trueRange(A1, outside), 0.8),
        rangeOf('a2', trueRange(A2, outside), 0.8),
        rangeOf('a3', trueRange(A3, outside), 0.8),
      ]),
      'a point outside the hull',
    );

    expect(fix.position.x).toBeCloseTo(40, 6);
    expect(fix.position.y).toBeCloseTo(40, 6);
  });

  it('uses every matching range when six anchors are in view', () => {
    const grid = [
      anchorAt('m1', 0, 0),
      anchorAt('m2', 20, 0),
      anchorAt('m3', 20, 20),
      anchorAt('m4', 0, 20),
      anchorAt('m5', 10, 0),
      anchorAt('m6', 0, 10),
    ];
    const truth: RelativePoint = { x: 7, y: 12 };
    const fix = requireFix(
      solverFor(grid).solve(grid.map((a) => rangeOf(a.peerId, trueRange(a, truth), 0.75))),
      'six exact ranges',
    );

    expect(fix.anchorsUsed).toBe(6);
    expect(fix.position.x).toBeCloseTo(7, 6);
    expect(fix.position.y).toBeCloseTo(12, 6);
  });
});

/* ------------------------------------------------------------------ *
 * Usable-range counting
 * ------------------------------------------------------------------ */

describe('solve — how many ranges are usable', () => {
  it('returns null for an empty range list', () => {
    expect(solverFor([A1, A2, A3]).solve([])).toBeNull();
  });

  it('returns null before any anchor has been registered', () => {
    expect(new AnchorSolver().solve(CLEAN_TRIPLE)).toBeNull();
  });

  it('returns null with two usable ranges and a fix with three', () => {
    const solver = solverFor([A1, A2, A3]);

    expect(solver.solve([rangeOf('a1', D1)])).toBeNull();
    expect(solver.solve([rangeOf('a1', D1), rangeOf('a2', D2)])).toBeNull();
    expect(solver.solve(CLEAN_TRIPLE)).not.toBeNull();
  });

  it('ignores ranges naming anchors that were never registered', () => {
    const solver = solverFor([A1, A2, A3]);
    const withStrangers = requireFix(
      solver.solve([
        rangeOf('ghost-1', 3),
        rangeOf('a1', D1),
        rangeOf('a2', D2),
        rangeOf('ghost-2', 99),
        rangeOf('a3', D3),
      ]),
      'three known ranges among two unknown',
    );
    const withoutStrangers = requireFix(solver.solve(CLEAN_TRIPLE), 'three known ranges');

    expect(withStrangers.anchorsUsed).toBe(3);
    expect(withStrangers.position).toEqual(withoutStrangers.position);
    expect(withStrangers.errorMeters).toBe(withoutStrangers.errorMeters);
  });

  it('returns null when discarding unregistered anchors drops the count below three', () => {
    const solver = solverFor([A1, A2, A3]);

    // Four ranges in, only two survive the filter.
    expect(
      solver.solve([rangeOf('a1', D1), rangeOf('a2', D2), rangeOf('ghost', 5), rangeOf('spook', 6)]),
    ).toBeNull();
    // And nothing survives at all.
    expect(solver.solve([rangeOf('x', 1), rangeOf('y', 2), rangeOf('z', 3)])).toBeNull();
  });

  it('rejects a batch that only reaches three ranges by repeating one anchor', () => {
    // Two distinct anchors can never constrain a position; the repeated a1 must not buy
    // its way past the count gate. (The geometry gate is what catches this.)
    expect(
      solverFor([A1, A2, A3]).solve([rangeOf('a1', D1), rangeOf('a1', D1), rangeOf('a2', D2)]),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Geometry gate
 * ------------------------------------------------------------------ */

describe('solve — the geometry gate', () => {
  it('refuses a fix from collinear anchors, even when the ranges are exact', () => {
    // A diagonal run of beacons, and the likelier real case: three mounted along one wall.
    const diagonal = [anchorAt('c1', 0, 0), anchorAt('c2', 5, 5), anchorAt('c3', 12, 12)];
    const wall = [anchorAt('w1', 0, 0), anchorAt('w2', 8, 0), anchorAt('w3', 20, 0)];
    const truth: RelativePoint = { x: 6, y: 2 };

    for (const line of [diagonal, wall]) {
      expect(geometryQuality(line)).toBe(0);
      expect(
        solverFor(line).solve(line.map((a) => rangeOf(a.peerId, trueRange(a, truth)))),
      ).toBeNull();
    }
  });

  it('refuses a fix when every anchor sits at the same point', () => {
    const stacked = [anchorAt('s1', 4, 4), anchorAt('s2', 4, 4), anchorAt('s3', 4, 4)];

    expect(geometryQuality(stacked)).toBe(0);
    expect(solverFor(stacked).solve(stacked.map((a) => rangeOf(a.peerId, 3)))).toBeNull();
  });

  it('accepts geometry sitting exactly on minGeometryQuality', () => {
    // An isosceles triangle on a 10 m base scores apexHeight / base, so 1.2 m of apex
    // height is exactly the 0.12 default. The gate rejects on `< min`, so equality passes.
    const sliver = [anchorAt('g1', 0, 0), anchorAt('g2', 10, 0), anchorAt('g3', 5, 1.2)];
    const truth: RelativePoint = { x: 4, y: 0.5 };

    expect(geometryQuality(sliver)).toBeCloseTo(0.12, 12);
    const fix = requireFix(
      solverFor(sliver).solve(sliver.map((a) => rangeOf(a.peerId, trueRange(a, truth), 0.85))),
      'geometry exactly at the threshold',
    );
    expect(fix.position.x).toBeCloseTo(4, 4);
    expect(fix.position.y).toBeCloseTo(0.5, 4);
  });

  it('rejects geometry one notch below minGeometryQuality', () => {
    const flatter = [anchorAt('g1', 0, 0), anchorAt('g2', 10, 0), anchorAt('g3', 5, 1.1)];
    const truth: RelativePoint = { x: 4, y: 0.5 };

    expect(geometryQuality(flatter)).toBeCloseTo(0.11, 12);
    expect(
      solverFor(flatter).solve(flatter.map((a) => rangeOf(a.peerId, trueRange(a, truth), 0.85))),
    ).toBeNull();
  });

  it('honours a stricter minGeometryQuality than the default', () => {
    // The reference triangle scores 0.8; demand 0.9 and it is no longer good enough.
    expect(solverFor([A1, A2, A3], { minGeometryQuality: 0.9 }).solve(CLEAN_TRIPLE)).toBeNull();
    expect(solverFor([A1, A2, A3], { minGeometryQuality: 0.8 }).solve(CLEAN_TRIPLE)).not.toBeNull();
  });

  it('honours a looser minGeometryQuality than the default', () => {
    const flatter = [anchorAt('g1', 0, 0), anchorAt('g2', 10, 0), anchorAt('g3', 5, 1.1)];
    const truth: RelativePoint = { x: 4, y: 0.5 };
    const ranges = flatter.map((a) => rangeOf(a.peerId, trueRange(a, truth), 0.85));

    expect(solverFor(flatter).solve(ranges)).toBeNull();
    const fix = requireFix(
      solverFor(flatter, { minGeometryQuality: 0.05 }).solve(ranges),
      'a sliver with the gate lowered',
    );
    expect(fix.position.x).toBeCloseTo(4, 3);
    expect(fix.position.y).toBeCloseTo(0.5, 3);
  });

  // BUG (AnchorSolver.ts:197): geometryQuality divides the largest triangle's area by the
  // largest pairwise span squared, so a single distant anchor collapses the score for the
  // whole set. a1/a2/a3 score 0.80 and solve; adding a fourth anchor at (120,90) reporting
  // a correct 145 m range drops the score to 0.0591 — under the 0.12 default — and solve()
  // returns null. The same four ranges recover (4,3) to 3e-11 m the moment the gate is
  // lowered, so the geometry is not in fact poor. An extra correct measurement can only add
  // information to a least-squares fit; it must never turn a good fix into no fix at all.
  it('still fixes a position when a distant fourth anchor joins a good triangle', () => {
    const far = anchorAt('far', 120, 90);
    const fix = requireFix(
      solverFor([A1, A2, A3, far]).solve([...CLEAN_TRIPLE, rangeOf('far', trueRange(far, TRUTH))]),
      'a good triangle plus a distant anchor',
    );

    expect(fix.position.x).toBeCloseTo(4, 6);
    expect(fix.position.y).toBeCloseTo(3, 6);
  });

  it('confirms the distant fourth anchor is geometrically sound once the gate lets it through', () => {
    // The companion to the it.failing above: proof that the rejected set is a good one.
    const far = anchorAt('far', 120, 90);
    const ranges = [...CLEAN_TRIPLE, rangeOf('far', trueRange(far, TRUTH))];

    // Scored per-triangle, the distant anchor no longer drags the set down: the
    // best triple is still a1/a2/a3 at 0.80, comfortably over the 0.12 gate.
    expect(geometryQuality([A1, A2, A3, far])).toBeCloseTo(0.8, 4);
    const fix = requireFix(
      solverFor([A1, A2, A3, far], { minGeometryQuality: 0.03 }).solve(ranges),
      'a good triangle plus a distant anchor, gate lowered',
    );
    expect(offsetFrom(fix, TRUTH)).toBeLessThan(1e-6);
  });
});

/* ------------------------------------------------------------------ *
 * Residual gate
 * ------------------------------------------------------------------ */

describe('solve — the residual gate', () => {
  it('refuses ranges that no single point can satisfy', () => {
    // Anchors 40 m apart all claiming the user is 0.5 m away: the circles never meet, and
    // the best possible fit still misses by ~21.7 m.
    const wide = [anchorAt('w1', 0, 0), anchorAt('w2', 40, 0), anchorAt('w3', 20, 32)];
    const impossible = wide.map((a) => rangeOf(a.peerId, 0.5, 0.8));

    expect(solverFor(wide).solve(impossible)).toBeNull();

    const relaxed = requireFix(
      solverFor(wide, { maxResidualMeters: 1000 }).solve(impossible),
      'impossible ranges with no residual cap',
    );
    expect(relaxed.errorMeters).toBeCloseTo(21.7313, 3);
  });

  it('refuses a four-anchor set where one anchor reports a grossly wrong distance', () => {
    const liar = [...CLEAN_TRIPLE, rangeOf('a4', D4 + 18)];

    expect(solverFor([A1, A2, A3, A4]).solve(liar)).toBeNull();
  });

  it('would have placed that set eight metres from the truth had the cap allowed it', () => {
    // This is what the gate is buying: with the cap raised to 10 m the same contradictory
    // ranges yield (7.09, -4.70) — 8.3 m from the truth, outside the anchor triangle
    // entirely — and still advertise 0.35 confidence.
    const liar = [...CLEAN_TRIPLE, rangeOf('a4', D4 + 18)];
    const fix = requireFix(
      solverFor([A1, A2, A3, A4], { maxResidualMeters: 10 }).solve(liar),
      'a contradictory set with a 10 m cap',
    );

    expect(fix.position.x).toBeCloseTo(7.0885, 3);
    expect(fix.position.y).toBeCloseTo(-4.7022, 3);
    expect(offsetFrom(fix, TRUTH)).toBeCloseTo(8.2983, 3);
    expect(fix.errorMeters).toBeCloseTo(6.5435, 3);
    expect(fix.confidence).toBeCloseTo(0.3456, 3);
  });

  it('accepts a residual exactly equal to maxResidualMeters, at zero confidence', () => {
    // Four anchors on a 10 m square all reporting the same distance: the fit is forced to
    // the centre, where every anchor is sqrt(50) m away, so the residual is exactly
    // sqrt(50) - distance. Choose the distance to make that exactly the 6 m default cap.
    const centreDistance = Math.hypot(5, 5) - 6;
    const fix = requireFix(solveSquare(centreDistance), 'a residual exactly at the cap');

    expect(fix.position).toEqual({ x: 5, y: 5 });
    expect(fix.errorMeters).toBe(6);
    expect(fix.confidence).toBe(0);
  });

  it('rejects a residual a hair above maxResidualMeters', () => {
    expect(solveSquare(Math.hypot(5, 5) - 6.000001)).toBeNull();
  });

  it('keeps a small positive confidence for a residual just inside the cap', () => {
    const fix = requireFix(solveSquare(Math.hypot(5, 5) - 5.9), 'a residual just inside the cap');

    expect(fix.errorMeters).toBeCloseTo(5.9, 9);
    expect(fix.confidence).toBeCloseTo(1 - 5.9 / 6, 9);
    expect(fix.confidence).toBeGreaterThan(0);
  });

  it('scales confidence linearly against whatever residual cap is configured', () => {
    const distance = Math.hypot(5, 5) - 3; // a forced 3 m residual

    const strict = requireFix(solveSquare(distance, 4), 'a 3 m residual under a 4 m cap');
    const lax = requireFix(solveSquare(distance, 12), 'a 3 m residual under a 12 m cap');

    expect(strict.errorMeters).toBeCloseTo(3, 9);
    expect(lax.errorMeters).toBeCloseTo(3, 9);
    // 1 - 3/4 = 0.25 is below the 0.6 range confidence, so the residual still
    // governs. 1 - 3/12 = 0.75 is above it, so the input cap takes over at 0.6.
    expect(strict.confidence).toBeCloseTo(0.25, 9);
    expect(lax.confidence).toBeCloseTo(0.6, 9);
    expect(solveSquare(distance, 2)).toBeNull();
  });
});

/**
 * A symmetric 10 m square of anchors, every one reporting the same `distance`. The fit is
 * pinned to the centre by symmetry, so the residual is exactly |sqrt(50) - distance| and
 * the residual gate can be probed to the last decimal.
 */
function solveSquare(distance: number, maxResidualMeters?: number): PositionFix | null {
  const square = [
    anchorAt('q1', 0, 0),
    anchorAt('q2', 10, 0),
    anchorAt('q3', 10, 10),
    anchorAt('q4', 0, 10),
  ];
  const solver = solverFor(
    square,
    maxResidualMeters === undefined ? undefined : { maxResidualMeters },
  );
  return solver.solve(square.map((a) => rangeOf(a.peerId, distance, 0.6)));
}

/* ------------------------------------------------------------------ *
 * Confidence reporting
 * ------------------------------------------------------------------ */

describe('solve — confidence reporting', () => {
  it('still solves noisy but consistent ranges, with lower confidence than the clean set', () => {
    const clean = requireFix(solverFor([A1, A2, A3, A4]).solve(
      [...CLEAN_TRIPLE, rangeOf('a4', D4)],
    ), 'four exact ranges');
    const noisy = requireFix(
      solverFor([A1, A2, A3, A4]).solve([
        rangeOf('a1', D1 + 0.4, 0.7),
        rangeOf('a2', D2 - 0.35, 0.7),
        rangeOf('a3', D3 + 0.25, 0.7),
        rangeOf('a4', D4 - 0.3, 0.7),
      ]),
      'four noisy ranges',
    );

    expect(offsetFrom(noisy, TRUTH)).toBeLessThan(0.5);
    // Residual alone would say 0.9511; the four ranges declare 0.7, and the fix
    // is not permitted to claim more than they do.
    expect(noisy.confidence).toBeCloseTo(0.7, 3);
    expect(noisy.confidence).toBeLessThan(clean.confidence);
    expect(noisy.errorMeters).toBeGreaterThan(clean.errorMeters);
  });

  // BUG (AnchorSolver.ts:160): the reported confidence is 1 - rms/maxResidualMeters and
  // nothing else — AnchorRange.confidence is used to weight the fit but never reaches the
  // output. Three ranges that each declare confidence 0 (the RSSI pipeline saying "do not
  // trust this") still produce a PositionFix advertising confidence 0.9999999999. Worse,
  // three ranges are an exactly determined system, so the residual is ~0 for almost any
  // input at all: at the minimum supported anchor count this number is ~1 by construction.
  // The header calls the solver conservative about "emitting a confident-looking wrong
  // answer", and RelativePositionEngine.ts:116 sets the house rule for fusing confidences
  // (`Math.min(distanceConfidence, ...)`) — a fix must not out-confide its inputs.
  it('does not claim near-certainty for a fix built from zero-confidence ranges', () => {
    const fix = requireFix(
      solverFor([A1, A2, A3]).solve([
        rangeOf('a1', D1, 0),
        rangeOf('a2', D2, 0),
        rangeOf('a3', D3, 0),
      ]),
      'three zero-confidence ranges',
    );

    expect(fix.confidence).toBeLessThan(0.99);
  });

  // BUG (AnchorSolver.ts:161): `anchorsUsed: usable.length` counts usable *ranges*, not
  // anchors. A scan window that reports anchor a1 twice — two advertisements from one
  // beacon, which the RSSI pipeline can easily emit — yields anchorsUsed: 4 when only
  // three anchors contributed, overstating the evidence behind the fix to every consumer.
  // (The duplicate is also double-weighted in the least-squares fit, so one beacon counts
  // twice as much as its neighbours.)
  it.failing('reports the number of distinct anchors used, not the number of ranges', () => {
    const fix = requireFix(
      solverFor([A1, A2, A3]).solve([
        rangeOf('a1', D1),
        rangeOf('a1', D1),
        rangeOf('a2', D2),
        rangeOf('a3', D3),
      ]),
      'a batch with one anchor reported twice',
    );

    expect(fix.anchorsUsed).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * geometryQuality
 * ------------------------------------------------------------------ */

describe('geometryQuality', () => {
  it('scores zero for fewer than three anchors', () => {
    expect(geometryQuality([])).toBe(0);
    expect(geometryQuality([A1])).toBe(0);
    expect(geometryQuality([A1, A2])).toBe(0);
    expect(geometryQuality([A1, A2, A3])).toBeGreaterThan(0);
  });

  it('scores zero for collinear anchors however far apart they are', () => {
    expect(geometryQuality([anchorAt('l1', 0, 0), anchorAt('l2', 1, 1), anchorAt('l3', 2, 2)])).toBe(
      0,
    );
    expect(
      geometryQuality([anchorAt('l1', -50, 7), anchorAt('l2', 0, 7), anchorAt('l3', 400, 7)]),
    ).toBe(0);
    expect(
      geometryQuality([anchorAt('l1', 3, 0), anchorAt('l2', 3, 9), anchorAt('l3', 3, 90)]),
    ).toBe(0);
  });

  it('scores an equilateral triangle highest and a right isosceles one at a half', () => {
    const equilateral = [
      anchorAt('e1', 0, 0),
      anchorAt('e2', 10, 0),
      anchorAt('e3', 5, Math.sqrt(75)),
    ];
    const rightIsosceles = [anchorAt('r1', 0, 0), anchorAt('r2', 10, 0), anchorAt('r3', 0, 10)];

    // area sqrt(3)/4 * s^2 over 0.5 * s^2 = sqrt(3)/2; the maximum this metric can reach.
    expect(geometryQuality(equilateral)).toBeCloseTo(Math.sqrt(3) / 2, 12);
    // area 50 over 0.5 * (10*sqrt(2))^2 = 0.5.
    expect(geometryQuality(rightIsosceles)).toBeCloseTo(0.5, 12);
    expect(geometryQuality(equilateral)).toBeGreaterThan(geometryQuality(rightIsosceles));
  });

  it('equals apex height over base for an isosceles triangle', () => {
    for (const height of [0.25, 1.1, 1.2, 2, 4, 8]) {
      const triangle = [anchorAt('t1', 0, 0), anchorAt('t2', 10, 0), anchorAt('t3', 5, height)];
      expect(geometryQuality(triangle)).toBeCloseTo(height / 10, 12);
    }
  });

  it('scores a thin sliver low but above zero', () => {
    const sliver = [anchorAt('n1', 0, 0), anchorAt('n2', 20, 0), anchorAt('n3', 10, 0.5)];

    expect(geometryQuality(sliver)).toBeCloseTo(0.025, 12);
    expect(geometryQuality(sliver)).toBeGreaterThan(0);
  });

  it('takes the best triangle available, not the first or the worst', () => {
    // Three collinear anchors plus one off the line: the set must score on the good
    // triangle that exists, not on the degenerate triples that also exist.
    const mixed = [
      anchorAt('p1', 0, 0),
      anchorAt('p2', 5, 0),
      anchorAt('p3', 10, 0),
      anchorAt('p4', 5, 10),
    ];

    // Best triangle: p1/p3/p4, area 50. Widest span: p1-p4 or p3-p4 = sqrt(125).
    expect(geometryQuality(mixed)).toBeCloseTo(50 / (125 * 0.5), 12);
  });

  it('never leaves the 0..1 range for any arrangement', () => {
    const arrangements: readonly AnchorDefinition[][] = [
      [],
      [A1],
      [A1, A2],
      [A1, A2, A3],
      [A1, A2, A3, A4],
      [anchorAt('z1', 0, 0), anchorAt('z2', 0, 0), anchorAt('z3', 0, 0)],
      [anchorAt('z1', -1e4, -1e4), anchorAt('z2', 1e4, -1e4), anchorAt('z3', 0, 1e4)],
      [anchorAt('z1', 0, 0), anchorAt('z2', 1e-3, 0), anchorAt('z3', 0, 1e-3)],
      [anchorAt('z1', 0, 0), anchorAt('z2', 1000, 0), anchorAt('z3', 500, 0.001)],
      Array.from({ length: 8 }, (_unused, i) =>
        anchorAt(`c${i}`, 15 * Math.cos((i * Math.PI) / 4), 15 * Math.sin((i * Math.PI) / 4)),
      ),
    ];

    for (const arrangement of arrangements) {
      const quality = geometryQuality(arrangement);
      expect(Number.isFinite(quality)).toBe(true);
      expect(quality).toBeGreaterThanOrEqual(0);
      expect(quality).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * bearingBetween
 * ------------------------------------------------------------------ */

describe('bearingBetween', () => {
  const ORIGIN: RelativePoint = { x: 0, y: 0 };

  it('measures clockwise from the venue +y axis: north 0, east 90, south 180, west 270', () => {
    // atan2(dx, dy) — the venue's north axis is +y and bearings increase towards +x.
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: 0, y: 5 })).toBe(0);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: 5, y: 0 })).toBe(90);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: 0, y: -5 })).toBe(180);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: -5, y: 0 })).toBe(270);
  });

  it('measures the diagonals at 45, 135, 225 and 315', () => {
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: 5, y: 5 })).toBe(45);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: 5, y: -5 })).toBe(135);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: -5, y: -5 })).toBe(225);
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: -5, y: 5 })).toBe(315);
  });

  it('depends on direction alone, not on where the observer stands', () => {
    const from: RelativePoint = { x: 10, y: 10 };

    expect(AnchorSolver.bearingBetween(from, { x: 10, y: 20 })).toBe(0);
    expect(AnchorSolver.bearingBetween(from, { x: 20, y: 10 })).toBe(90);
    expect(AnchorSolver.bearingBetween(from, { x: 10, y: 0 })).toBe(180);
    expect(AnchorSolver.bearingBetween(from, { x: 0, y: 10 })).toBe(270);
    expect(AnchorSolver.bearingBetween(from, { x: 10.001, y: 10 })).toBe(90);
  });

  it('reverses to the opposite bearing when the endpoints swap', () => {
    const a: RelativePoint = { x: 2, y: 3 };
    const b: RelativePoint = { x: 9, y: 14 };
    const there = AnchorSolver.bearingBetween(a, b);
    const back = AnchorSolver.bearingBetween(b, a);

    expect(there).toBeCloseTo(32.4712, 4);
    expect((back - there + 360) % 360).toBeCloseTo(180, 9);
  });

  it('always lands inside 0..360, exclusive of 360', () => {
    for (let halfDegree = -720; halfDegree <= 720; halfDegree++) {
      const radians = (halfDegree * Math.PI) / 360;
      const bearing = AnchorSolver.bearingBetween(ORIGIN, {
        x: Math.sin(radians) * 7,
        y: Math.cos(radians) * 7,
      });
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
    }
  });

  it('folds a hair west of north back to just under 360, never to 360 itself', () => {
    const nearlyNorth = AnchorSolver.bearingBetween(ORIGIN, { x: -0.001, y: 5 });

    expect(nearlyNorth).toBeCloseTo(359.9885, 4);
    expect(nearlyNorth).toBeLessThan(360);
    // Small enough and it rounds all the way back to 0 rather than overflowing to 360.
    expect(AnchorSolver.bearingBetween(ORIGIN, { x: -1e-15, y: 5 })).toBe(0);
  });

  it('returns zero when the two points coincide', () => {
    expect(AnchorSolver.bearingBetween({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(0);
  });
});
