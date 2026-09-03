/**
 * ProximityEngine — the vocabulary layer between raw signal and the UI.
 *
 * It answers "how near is this person, how sure are we, and what words should
 * we put on screen". Every string it produces is a range or a qualitative
 * phrase; nothing here ever yields a precise figure, because the underlying
 * measurement cannot support one.
 */

import type { PeerRecord, PlacedPerson, ProximityBand, SignalTrend } from '../types';
import {
  bandIndex,
  bandLabel,
  bandRangeLabel,
  trendLabel,
} from '../bluetooth/RssiProcessor';
import type { PositionInput } from './RelativePositionEngine';

export interface ProximityDescriptor {
  band: ProximityBand;
  /** "Very close", "Close", "Nearby", "Farther". */
  label: string;
  /** "under 3 m", "3-7 m", ... */
  rangeLabel: string;
  /** The raw estimate. For layout maths only — do not render this number. */
  estimatedDistance: number;
  trend: SignalTrend;
  trendLabel: string;
  /** 0..1 */
  confidence: number;
  /** True while we have too little signal to say anything useful. */
  provisional: boolean;
}

/**
 * How much to trust a distance estimate.
 *
 * Three things move it: how many packets we have folded in, how recently we
 * heard from them, and how strong the signal is (weak signals sit on the flat
 * part of the path-loss curve where a dB is worth many metres).
 */
export function distanceConfidence(record: PeerRecord, now: number = record.lastSeen): number {
  const packetTerm = Math.min(record.packets / 12, 1);

  const age = Math.max(0, now - record.lastSeen);
  const freshnessTerm = age < 3_000 ? 1 : age < 10_000 ? 0.6 : 0.25;

  // -50 dBm is a strong, close signal; -95 dBm is barely there.
  const strengthTerm = clamp01((record.rssi + 95) / 45);

  return clamp01(0.15 + 0.85 * packetTerm * freshnessTerm * (0.4 + 0.6 * strengthTerm));
}

export function describeProximity(
  record: PeerRecord,
  now: number = record.lastSeen,
): ProximityDescriptor {
  const confidence = distanceConfidence(record, now);
  return {
    band: record.band,
    label: bandLabel(record.band),
    rangeLabel: bandRangeLabel(record.band),
    estimatedDistance: record.estimatedDistance,
    trend: record.trend,
    trendLabel: trendLabel(record.trend),
    confidence,
    provisional: record.state === 'discovered' || record.packets < 4,
  };
}

export function proximityInputFrom(
  record: PeerRecord,
  bearingHint?: { bearing: number; confidence: number },
  now: number = record.lastSeen,
): PositionInput {
  return {
    peerId: record.peerId,
    distance: record.estimatedDistance,
    band: record.band,
    distanceConfidence: distanceConfidence(record, now),
    bearingHint,
  };
}

/**
 * Render priority (§37): the person the user is acting on wins, then the
 * person they are walking to, then whoever is physically closest.
 */
export interface PriorityContext {
  selectedPeerId?: string;
  navigatingPeerId?: string;
  availablePeerIds?: ReadonlySet<string>;
}

export function renderPriority(
  peerId: string,
  band: ProximityBand,
  context: PriorityContext,
): number {
  if (context.selectedPeerId === peerId) return 1000;
  if (context.navigatingPeerId === peerId) return 900;
  let score = 100 - bandIndex(band) * 20;
  if (context.availablePeerIds?.has(peerId)) score += 10;
  return score;
}

export function sortByPriority<T extends { peerId: string; band: ProximityBand }>(
  items: readonly T[],
  context: PriorityContext,
): T[] {
  return [...items].sort(
    (a, b) => renderPriority(b.peerId, b.band, context) - renderPriority(a.peerId, a.band, context),
  );
}

/** Coarse "which way, roughly" phrasing used by navigation mode. */
export function relativeDirectionLabel(bearingFromUser: number): string {
  const bearing = ((bearingFromUser % 360) + 360) % 360;
  if (bearing < 22.5 || bearing >= 337.5) return 'straight ahead';
  if (bearing < 67.5) return 'ahead and to your right';
  if (bearing < 112.5) return 'to your right';
  if (bearing < 157.5) return 'behind you, to the right';
  if (bearing < 202.5) return 'behind you';
  if (bearing < 247.5) return 'behind you, to the left';
  if (bearing < 292.5) return 'to your left';
  return 'ahead and to your left';
}

export function closestPerson(people: readonly PlacedPerson[]): PlacedPerson | null {
  let best: PlacedPerson | null = null;
  for (const person of people) {
    if (!best || person.estimatedDistance < best.estimatedDistance) best = person;
  }
  return best;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
