/**
 * Pure 2D geometry for the VIRTUAL game world.
 *
 * IMPORTANT: every coordinate in this file is a virtual game-world unit.
 * It has no relationship whatsoever to GPS, latitude/longitude, metres, or any
 * physical position. The world is a plain Cartesian grid that exists only
 * inside the app.
 */

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Euclidean distance between two virtual positions. */
export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance -- avoids a sqrt when only comparing magnitudes. */
export function distanceSq(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Bearing from `from` to `to`, in degrees clockwise from "north" (negative Y).
 * This is a VIRTUAL world bearing used to orient the on-screen radar sweep.
 * It is not a compass heading and does not reference the physical world.
 */
export function bearingDeg(from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Quantise a bearing to one of 8 compass-style sectors (N, NE, E, ...). */
export const SECTOR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type SectorLabel = (typeof SECTOR_LABELS)[number];

export function bearingToSector(deg: number): SectorLabel {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return SECTOR_LABELS[idx] as SectorLabel;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clampPosition(p: Position, bounds: Size, margin = 0): Position {
  return {
    x: clamp(p.x, margin, bounds.width - margin),
    y: clamp(p.y, margin, bounds.height - margin),
  };
}

export function addPosition(a: Position, b: Position): Position {
  return {x: a.x + b.x, y: a.y + b.y};
}

/** Round a position to a fixed number of decimals -- keeps BLE payloads small. */
export function roundPosition(p: Position, decimals = 2): Position {
  const f = Math.pow(10, decimals);
  return {x: Math.round(p.x * f) / f, y: Math.round(p.y * f) / f};
}

export function positionsEqual(a: Position, b: Position, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

/** True when the circle at `p` with `radius` overlaps the axis-aligned `rect`. */
export function circleIntersectsRect(p: Position, radius: number, rect: Rect): boolean {
  const nearestX = clamp(p.x, rect.x, rect.x + rect.width);
  const nearestY = clamp(p.y, rect.y, rect.y + rect.height);
  const dx = p.x - nearestX;
  const dy = p.y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/** Linear interpolation, used to smooth remote player positions between updates. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function lerpPosition(a: Position, b: Position, t: number): Position {
  return {x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)};
}

/** Normalise a vector to unit length; returns {0,0} for a zero vector. */
export function normalize(v: Position): Position {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-9) {
    return {x: 0, y: 0};
  }
  return {x: v.x / len, y: v.y / len};
}
