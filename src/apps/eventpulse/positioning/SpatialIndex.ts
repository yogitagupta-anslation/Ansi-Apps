/**
 * SpatialIndex — a uniform grid over event-local metres.
 *
 * At 500 attendees the map does a handful of spatial queries per frame
 * (what is in view, what overlaps this label, what is within 5 m). Doing those
 * by scanning the whole set is fine at 20 people and painful at 500, so we pay
 * for a grid rebuild once per snapshot and get near-constant-time lookups.
 *
 * A grid beats a quadtree here: the point set is small, bounded, and rebuilt
 * wholesale a few times a second, so rebuild cost dominates query cost.
 */

import type { RelativePoint } from '../types';

export interface SpatialEntry<T> {
  id: string;
  point: RelativePoint;
  value: T;
}

export class SpatialIndex<T> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, SpatialEntry<T>[]>();
  private readonly byId = new Map<string, SpatialEntry<T>>();

  constructor(cellSize = 4) {
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.byId.size;
  }

  /** Replace the entire contents. Cheaper than incremental updates at our sizes. */
  rebuild(entries: readonly SpatialEntry<T>[]): void {
    this.cells.clear();
    this.byId.clear();
    for (const entry of entries) this.insert(entry);
  }

  insert(entry: SpatialEntry<T>): void {
    const key = this.cellKey(entry.point.x, entry.point.y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(entry);
    else this.cells.set(key, [entry]);
    this.byId.set(entry.id, entry);
  }

  get(id: string): SpatialEntry<T> | undefined {
    return this.byId.get(id);
  }

  /** Everything within `radius` metres of a point. */
  queryRadius(centre: RelativePoint, radius: number): SpatialEntry<T>[] {
    const out: SpatialEntry<T>[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(centre.x / this.cellSize);
    const cy = Math.floor(centre.y / this.cellSize);
    const radiusSq = radius * radius;

    for (let gx = cx - cellRadius; gx <= cx + cellRadius; gx++) {
      for (let gy = cy - cellRadius; gy <= cy + cellRadius; gy++) {
        const bucket = this.cells.get(hashCell(gx, gy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.point.x - centre.x;
          const dy = entry.point.y - centre.y;
          if (dx * dx + dy * dy <= radiusSq) out.push(entry);
        }
      }
    }
    return out;
  }

  /** Everything inside an axis-aligned rectangle — used for viewport culling. */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): SpatialEntry<T>[] {
    const out: SpatialEntry<T>[] = [];
    const gx0 = Math.floor(minX / this.cellSize);
    const gx1 = Math.floor(maxX / this.cellSize);
    const gy0 = Math.floor(minY / this.cellSize);
    const gy1 = Math.floor(maxY / this.cellSize);

    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const bucket = this.cells.get(hashCell(gx, gy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const { x, y } = entry.point;
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(entry);
        }
      }
    }
    return out;
  }

  /** The `k` nearest entries to a point, nearest first. */
  nearest(centre: RelativePoint, k: number, maxRadius = 40): SpatialEntry<T>[] {
    // Expand the search ring until we have enough candidates or run out of room.
    let radius = this.cellSize;
    let found: SpatialEntry<T>[] = [];
    while (radius <= maxRadius) {
      found = this.queryRadius(centre, radius);
      if (found.length >= k) break;
      radius *= 2;
    }
    return found
      .map((entry) => ({
        entry,
        distanceSq:
          (entry.point.x - centre.x) ** 2 + (entry.point.y - centre.y) ** 2,
      }))
      .sort((a, b) => a.distanceSq - b.distanceSq)
      .slice(0, k)
      .map((item) => item.entry);
  }

  clear(): void {
    this.cells.clear();
    this.byId.clear();
  }

  private cellKey(x: number, y: number): number {
    return hashCell(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize));
  }
}

/**
 * Pack two signed cell coordinates into one number key.
 * Cell indices stay well inside ±32k for any real venue.
 */
function hashCell(gx: number, gy: number): number {
  return ((gx + 32768) << 16) | ((gy + 32768) & 0xffff);
}
