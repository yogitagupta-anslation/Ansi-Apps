import type {Place, Route} from '../types';

/**
 * The seam offline routing will arrive through.
 *
 * Everything the UI knows about routes is `getRoute(pickup, destination)` returning a
 * `Route`. That is the whole contract, and it is deliberately the contract an offline
 * routing engine already satisfies: give it two points, get back a polyline and two
 * estimates. When the real engine lands — map data on the device, a routing graph,
 * cached regions — it replaces the body of this function and not one screen changes.
 *
 * WHAT THIS IMPLEMENTATION ACTUALLY IS, said plainly: a shape generator. It draws a
 * plausible road-like path between two points on the schematic map and derives numbers
 * from its length. It is not a route. It does not know about roads, one-ways, or the
 * river in between. It exists so the ride flow can be built, used and judged before the
 * routing engine exists, which is the order the work has to happen in.
 *
 * Everything it returns is labelled as an estimate in the UI, because that is what it is
 * — and that labelling stays correct after the real engine lands, since a routing
 * estimate is still an estimate.
 */

/** Deterministic 0-1 noise from a string, so the same pair always draws the same path. */
function hashNoise(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Roads bend. A straight line between two pins reads as a compass bearing rather than as
 * a journey, so the path is built from a few dog-legs whose offsets are derived from the
 * two place ids — stable, so the route does not redraw itself on every render.
 */
function buildPolyline(from: Place, to: Place): Array<{x: number; y: number}> {
  const seed = `${from.id}->${to.id}`;
  const steps = 5;
  const points: Array<{x: number; y: number}> = [{x: from.x, y: from.y}];

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular to the straight line, which is the direction a detour actually goes.
  const nx = -dy;
  const ny = dx;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    // Largest deviation in the middle, tapering to zero at both pins — a road that missed
    // its own endpoints would be worse than a straight line.
    const taper = Math.sin(t * Math.PI);
    const wobble = (hashNoise(seed, i) - 0.5) * 0.22 * taper;
    points.push({
      x: clamp01(from.x + dx * t + nx * wobble),
      y: clamp01(from.y + dy * t + ny * wobble),
    });
  }
  points.push({x: to.x, y: to.y});
  return points;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Length of the polyline in normalised units. */
function polylineLength(points: Array<{x: number; y: number}>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * The schematic map is treated as roughly this many kilometres corner to corner, so a
 * normalised length becomes a plausible number of kilometres. A single constant, named,
 * so the one arbitrary decision in this file is visible rather than buried in a formula.
 */
const MAP_SPAN_KM = 14;

/** Average city speed for an auto in traffic. Used only to turn distance into minutes. */
const CITY_SPEED_KMH = 18;

export async function getRoute(from: Place, to: Place): Promise<Route> {
  const points = buildPolyline(from, to);
  const distanceKm = Math.max(0.4, polylineLength(points) * MAP_SPAN_KM);
  const durationMin = Math.max(3, Math.round((distanceKm / CITY_SPEED_KMH) * 60));
  return {
    from,
    to,
    points,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin,
  };
}

/**
 * Base fares per kilometre, in rupees.
 *
 * Estimates for display, not a price anybody is bound by — a Bluetooth ride is agreed
 * between two people standing next to each other, and this app is not in the middle of
 * that agreement. The UI says "estimate" everywhere it shows one.
 */
const FARE_PER_KM: Record<string, number> = {
  bike: 8,
  auto: 12,
  cab: 18,
  other: 12,
};

const FARE_BASE: Record<string, number> = {
  bike: 15,
  auto: 25,
  cab: 45,
  other: 25,
};

export function estimateFare(kind: string, distanceKm: number): number {
  const base = FARE_BASE[kind] ?? FARE_BASE.auto;
  const perKm = FARE_PER_KM[kind] ?? FARE_PER_KM.auto;
  // Rounded to the nearest five rupees: a fare estimate given to the rupee implies a
  // precision that a straight-line guess at a route does not have.
  return Math.round((base + perKm * distanceKm) / 5) * 5;
}
