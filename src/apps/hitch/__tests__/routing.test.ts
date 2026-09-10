/**
 * The routing seam.
 *
 * These tests are written against the CONTRACT rather than against the current
 * implementation, because the implementation is explicitly temporary: a shape generator
 * standing in until offline map data and a real routing engine land. Every assertion
 * below should still pass afterwards — if one of them stops passing when the real engine
 * arrives, the engine is returning something the UI cannot draw, which is exactly what
 * this file exists to catch.
 */
import {CURRENT_LOCATION, PLACES} from '../config/catalogue';
import {estimateFare, getRoute} from '../services/routing';

const office = PLACES.find(p => p.id === 'work')!;
const home = PLACES.find(p => p.id === 'home')!;

describe('getRoute', () => {
  it('starts at the pickup and ends at the destination', async () => {
    const route = await getRoute(CURRENT_LOCATION, office);
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    // A route that misses its own endpoints draws a line that starts beside the pin
    // rather than on it, which reads as a bug long before anyone questions the geometry.
    expect(first).toEqual({x: CURRENT_LOCATION.x, y: CURRENT_LOCATION.y});
    expect(last).toEqual({x: office.x, y: office.y});
  });

  it('stays inside the map, so nothing is drawn off the canvas', async () => {
    const route = await getRoute(home, office);
    for (const p of route.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('is stable: the same pair always draws the same line', async () => {
    // The route must not wobble between renders. A path derived from Math.random would
    // redraw itself on every state change in the screen holding it.
    const a = await getRoute(home, office);
    const b = await getRoute(home, office);
    expect(a.points).toEqual(b.points);
    expect(a.distanceKm).toBe(b.distanceKm);
  });

  it('gives a longer journey a bigger distance and duration', async () => {
    const near = await getRoute(CURRENT_LOCATION, PLACES.find(p => p.id === 'pg')!);
    const far = await getRoute(CURRENT_LOCATION, PLACES.find(p => p.id === 'airport')!);
    expect(far.distanceKm).toBeGreaterThan(near.distanceKm);
    expect(far.durationMin).toBeGreaterThan(near.durationMin);
  });

  it('never returns a zero or negative estimate', async () => {
    // Two places at almost the same point still take some time to travel between.
    const route = await getRoute(CURRENT_LOCATION, {...CURRENT_LOCATION, id: 'twin'});
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.durationMin).toBeGreaterThan(0);
  });
});

describe('fare estimates', () => {
  it('ranks the vehicle kinds the way their real fares rank', () => {
    const km = 6;
    expect(estimateFare('bike', km)).toBeLessThan(estimateFare('auto', km));
    expect(estimateFare('auto', km)).toBeLessThan(estimateFare('cab', km));
  });

  it('rises with distance', () => {
    expect(estimateFare('auto', 12)).toBeGreaterThan(estimateFare('auto', 3));
  });

  it('is rounded, because a straight-line guess cannot be precise to the rupee', () => {
    for (const km of [1.3, 4.8, 9.2, 15.7]) {
      expect(estimateFare('auto', km) % 5).toBe(0);
    }
  });

  it('falls back rather than returning NaN for a kind it does not know', () => {
    expect(Number.isFinite(estimateFare('hovercraft', 5))).toBe(true);
  });
});
