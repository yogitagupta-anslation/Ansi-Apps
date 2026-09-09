/**
 * AnchorSolver — optional infrastructure-assisted positioning.
 *
 * Not required for the MVP, and the app must never depend on it. But a venue
 * that mounts four cheap BLE beacons at known positions can lift the map from
 * "a stable layout at roughly the right distance" to "an actual position", so
 * the seam is here from day one.
 *
 * How it plugs in: anchors advertise the same EventPulse frame with the
 * `isAnchor` capability bit set. Their venue coordinates come down with the
 * event configuration. Given three or more anchor ranges we can solve for the
 * user's venue position, and once that is known a peer's own anchor ranges
 * yield a real bearing — which `RelativePositionEngine` consumes as a
 * `bearingHint` with high confidence.
 *
 * The solver is deliberately conservative: it refuses to produce a fix from
 * poor geometry rather than emitting a confident-looking wrong answer.
 */

import type { RelativePoint } from '../types';

export interface AnchorDefinition {
  peerId: string;
  name: string;
  /** Anchor position in venue metres. */
  x: number;
  y: number;
  /** Calibrated RSSI at 1 m for this specific hardware. */
  txPower?: number;
}

export interface AnchorRange {
  anchorId: string;
  /** Distance estimate in metres, from the usual RSSI pipeline. */
  distance: number;
  /** 0..1 */
  confidence: number;
}

export interface PositionFix {
  position: RelativePoint;
  /** Estimated 1-sigma error in metres. */
  errorMeters: number;
  confidence: number;
  anchorsUsed: number;
}

export interface AnchorSolverOptions {
  /** Iterations of the Gauss-Newton refinement. */
  iterations?: number;
  /** Reject a fix whose residual exceeds this many metres. */
  maxResidualMeters?: number;
  /**
   * Reject near-collinear anchor geometry. This is the ratio of the smallest to
   * largest singular direction; below it, position is badly constrained.
   */
  minGeometryQuality?: number;
}

const DEFAULTS: Required<AnchorSolverOptions> = {
  iterations: 8,
  maxResidualMeters: 6,
  minGeometryQuality: 0.12,
};

export class AnchorSolver {
  private readonly opts: Required<AnchorSolverOptions>;
  private anchors = new Map<string, AnchorDefinition>();

  constructor(options: AnchorSolverOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  setAnchors(anchors: readonly AnchorDefinition[]): void {
    this.anchors = new Map(anchors.map((a) => [a.peerId, a]));
  }

  get anchorCount(): number {
    return this.anchors.size;
  }

  get isConfigured(): boolean {
    return this.anchors.size >= 3;
  }

  /**
   * Least-squares multilateration. Returns null when the geometry or the
   * residual says we should not pretend to know.
   */
  solve(ranges: readonly AnchorRange[]): PositionFix | null {
    const usable = ranges
      .map((range) => ({ range, anchor: this.anchors.get(range.anchorId) }))
      .filter((item): item is { range: AnchorRange; anchor: AnchorDefinition } =>
        Boolean(item.anchor),
      );

    if (usable.length < 3) return null;
    if (geometryQuality(usable.map((u) => u.anchor)) < this.opts.minGeometryQuality) return null;

    // Seed at the confidence-weighted centroid of the anchors.
    let x = 0;
    let y = 0;
    let weightSum = 0;
    for (const { anchor, range } of usable) {
      const weight = Math.max(range.confidence, 0.05);
      x += anchor.x * weight;
      y += anchor.y * weight;
      weightSum += weight;
    }
    x /= weightSum;
    y /= weightSum;

    for (let iteration = 0; iteration < this.opts.iterations; iteration++) {
      let jtjXX = 0;
      let jtjXY = 0;
      let jtjYY = 0;
      let jtrX = 0;
      let jtrY = 0;

      for (const { anchor, range } of usable) {
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const predicted = Math.hypot(dx, dy);
        if (predicted < 1e-6) continue;

        const weight = Math.max(range.confidence, 0.05);
        const residual = predicted - range.distance;
        const gx = dx / predicted;
        const gy = dy / predicted;

        jtjXX += weight * gx * gx;
        jtjXY += weight * gx * gy;
        jtjYY += weight * gy * gy;
        jtrX += weight * gx * residual;
        jtrY += weight * gy * residual;
      }

      const determinant = jtjXX * jtjYY - jtjXY * jtjXY;
      if (Math.abs(determinant) < 1e-9) return null;

      const stepX = (jtjYY * jtrX - jtjXY * jtrY) / determinant;
      const stepY = (jtjXX * jtrY - jtjXY * jtrX) / determinant;

      x -= stepX;
      y -= stepY;

      if (Math.hypot(stepX, stepY) < 0.01) break;
    }

    let residualSum = 0;
    for (const { anchor, range } of usable) {
      residualSum += (Math.hypot(x - anchor.x, y - anchor.y) - range.distance) ** 2;
    }
    const rms = Math.sqrt(residualSum / usable.length);
    if (!Number.isFinite(rms) || rms > this.opts.maxResidualMeters) return null;

    const residualConfidence = Math.max(0, Math.min(1, 1 - rms / this.opts.maxResidualMeters));

    /**
     * A fix may not out-confide the ranges it was built from.
     *
     * Residual alone is not evidence: three ranges are an exactly determined
     * system, so the residual is ~0 for almost any input and the reported
     * confidence was ~1 by construction at the minimum supported anchor count —
     * including when every contributing range declared confidence 0, which is
     * the RSSI pipeline saying "do not trust this". Folding the inputs in
     * follows the house rule already set by `RelativePositionEngine`, where a
     * placement is only as good as its weaker half.
     */
    const inputConfidence =
      usable.reduce((sum, { range }) => sum + Math.max(0, Math.min(1, range.confidence)), 0) /
      usable.length;

    return {
      position: { x, y },
      errorMeters: rms,
      confidence: Math.min(residualConfidence, inputConfidence),
      anchorsUsed: usable.length,
    };
  }

  /**
   * Bearing from one venue position to another, in degrees clockwise from the
   * venue's north axis. Convert to a user-relative bearing by subtracting the
   * user's heading.
   */
  static bearingBetween(from: RelativePoint, to: RelativePoint): number {
    const bearing = (Math.atan2(to.x - from.x, to.y - from.y) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }
}

/**
 * Crude geometric dilution check: the normalised area spanned by the anchor
 * set. Three anchors in a line score ~0 and are rejected.
 */
export function geometryQuality(anchors: readonly AnchorDefinition[]): number {
  if (anchors.length < 3) return 0;

  /**
   * Score each triangle against its OWN longest side and keep the best one.
   *
   * The area used to be normalised by the largest span in the whole set, which
   * made the metric non-monotonic in the number of anchors: a well-formed
   * triangle scoring 0.80 collapsed to 0.06 — below the rejection gate — as
   * soon as one distant beacon was also in range, and a fix that the same
   * ranges solve to within 1e-11 m was refused. An extra correct measurement
   * can only add information to a least-squares fit, so it must never turn a
   * good fix into no fix at all. Asking "is there a well-conditioned triangle
   * in here?" is the question the gate was always meant to ask.
   */
  let best = 0;
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      for (let k = j + 1; k < anchors.length; k++) {
        const a = anchors[i];
        const b = anchors[j];
        const c = anchors[k];
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        const span = Math.max(
          Math.hypot(a.x - b.x, a.y - b.y),
          Math.hypot(a.x - c.x, a.y - c.y),
          Math.hypot(b.x - c.x, b.y - c.y),
        );
        if (span === 0) continue;
        best = Math.max(best, area / (span * span * 0.5));
      }
    }
  }
  return Math.min(1, best);
}
