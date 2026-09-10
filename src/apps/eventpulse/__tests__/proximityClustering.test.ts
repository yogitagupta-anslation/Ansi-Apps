/**
 * Unit tests for the two pure modules that feed the map:
 * `positioning/ProximityEngine.ts` (signal -> words) and
 * `positioning/Clustering.ts` (screen geometry -> readable map).
 *
 * Every expected number here was hand-computed from the constants declared in
 * those two files:
 *
 *   ProximityEngine — confidence floor 0.15 over a 0.85 span, packet ceiling 12,
 *   freshness steps at 3 s (1.0) and 10 s (0.6) then 0.25, RSSI ramp -95..-50 dBm
 *   folded in as (0.4 + 0.6 * strength); provisional below 4 packets; band scores
 *   100/80/60/40 with a +10 "available" bonus, 900 navigating, 1000 selected;
 *   direction sectors 45 degrees wide centred on 0.
 *
 *   Clustering — grid buckets of `radiusPx`, inclusive merge at exactly
 *   `radiusPx`, default `minClusterSize` 2; label solver defaults maxShift 34,
 *   shiftStep 6, padding 2; zoom radii 60/30/15/7 m.
 *
 * Nothing is mocked. Both modules are pure functions over plain data, so these
 * tests exercise the real implementations end to end.
 */

import type {
  BleAdvertisement,
  PeerRecord,
  PeerState,
  PlacedPerson,
  ProximityBand,
  SignalTrend,
} from '../types';
import {
  closestPerson,
  describeProximity,
  distanceConfidence,
  proximityInputFrom,
  relativeDirectionLabel,
  renderPriority,
  sortByPriority,
} from '../positioning/ProximityEngine';
import type { PriorityContext } from '../positioning/ProximityEngine';
import {
  ZOOM_LEVELS,
  autoZoomFor,
  clusterPoints,
  layoutLabels,
  zoomDefinition,
  zoomIn,
  zoomOut,
} from '../positioning/Clustering';
import type {
  Cluster,
  ClusterCandidate,
  LabelBox,
  LabelPlacement,
  ZoomLevel,
} from '../positioning/Clustering';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * Exhaustive member lists. The `Record` forces a compile error the day a member
 * joins either union, so the "every band gets words" tests below cannot quietly
 * stop covering the whole enum.
 */
const BAND_MEMBERS: Record<ProximityBand, true> = {
  very_close: true,
  close: true,
  nearby: true,
  far: true,
};
const ALL_BANDS = Object.keys(BAND_MEMBERS) as ProximityBand[];

const ZOOM_MEMBERS: Record<ZoomLevel, true> = {
  overview: true,
  venue: true,
  hall: true,
  nearby: true,
};
const ALL_ZOOMS = Object.keys(ZOOM_MEMBERS) as ZoomLevel[];

const BASE_TIME = 1_700_000_000_000;

function advertisement(peerId: string): BleAdvertisement {
  return {
    protocolVersion: 1,
    eventCode: 0x1234,
    peerId,
    profileVersion: 3,
    avatarId: 'av1',
    displayTag: 'Sam',
    status: 'available',
    capabilities: { acceptsConnections: true, supportsNavigation: true, isAnchor: false },
  };
}

/**
 * A complete, healthy record: 12 packets (packet term saturated), -50 dBm
 * (strength term saturated), seen right now. `distanceConfidence` of this
 * record is exactly 1.
 */
function record(overrides: Partial<PeerRecord> = {}): PeerRecord {
  const peerId = overrides.peerId ?? 'peer-a';
  return {
    peerId,
    eventCode: 0x1234,
    state: 'active' as PeerState,
    advertisement: advertisement(peerId),
    rssi: -50,
    rawRssi: -50,
    band: 'close',
    estimatedDistance: 4.2,
    trend: 'steady' as SignalTrend,
    firstSeen: BASE_TIME - 20_000,
    lastSeen: BASE_TIME,
    packets: 12,
    ...overrides,
  };
}

function person(peerId: string, estimatedDistance: number): PlacedPerson {
  return {
    peerId,
    position: { x: 0, y: estimatedDistance },
    bearing: 0,
    band: 'close',
    estimatedDistance,
    confidence: 0.5,
  };
}

function candidate(id: string, x: number, y: number, priority = 0): ClusterCandidate {
  return { id, x, y, priority };
}

const LABEL_WIDTH = 80;
const LABEL_HEIGHT = 20;
const PREFERRED_OFFSET = -10;
/** The solver's default padding; a gap of at least this much reads as clear. */
const DEFAULT_PADDING = 2;
/** Minimum vertical separation two default boxes need: height + padding. */
const CLEAR_GAP = LABEL_HEIGHT + DEFAULT_PADDING;

function labelBox(id: string, anchorX: number, anchorY: number, priority: number): LabelBox {
  return {
    id,
    anchorX,
    anchorY,
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    preferredOffset: PREFERRED_OFFSET,
    priority,
  };
}

function placementFor(placements: readonly LabelPlacement[], id: string): LabelPlacement {
  const found = placements.find((placement) => placement.id === id);
  if (!found) throw new Error(`no placement returned for "${id}"`);
  return found;
}

function onlyCluster(clusters: readonly Cluster[]): Cluster {
  if (clusters.length !== 1) throw new Error(`expected exactly one cluster, got ${clusters.length}`);
  return clusters[0];
}

function sortedIds(items: readonly { id: string }[]): string[] {
  return items.map((item) => item.id).sort();
}

/* ================================================================== *
 * ProximityEngine
 * ================================================================== */

describe('ProximityEngine', () => {
  describe('distanceConfidence', () => {
    it('returns the hand-computed value 0.575 for 6 packets at -50 dBm seen now', () => {
      // packetTerm 6/12 = 0.5, freshnessTerm 1, strengthTerm (−50+95)/45 = 1,
      // so 0.15 + 0.85 * 0.5 * 1 * (0.4 + 0.6) = 0.575 exactly.
      expect(distanceConfidence(record({ packets: 6, rssi: -50 }), BASE_TIME)).toBe(0.575);
    });

    it('reaches exactly 1 when packets, freshness and signal strength are all maxed', () => {
      expect(distanceConfidence(record({ packets: 12, rssi: -50 }), BASE_TIME)).toBe(1);
    });

    it('never exceeds 1 however many packets arrive or however strong the signal', () => {
      expect(distanceConfidence(record({ packets: 5_000, rssi: 0 }), BASE_TIME)).toBe(1);
      expect(distanceConfidence(record({ packets: 13, rssi: -49 }), BASE_TIME)).toBe(1);
    });

    it('bottoms out at the 0.15 floor when no packets have been folded in', () => {
      expect(distanceConfidence(record({ packets: 0, rssi: -50 }), BASE_TIME)).toBe(0.15);
    });

    it('rises strictly with packet count up to the ceiling of 12', () => {
      const values = [1, 2, 4, 8, 11, 12].map((packets) =>
        distanceConfidence(record({ packets }), BASE_TIME),
      );
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
      expect(values[values.length - 1]).toBe(1);
    });

    it('stops rewarding packets above 12 — 11 is below the ceiling, 12 and 13 are equal', () => {
      const eleven = distanceConfidence(record({ packets: 11 }), BASE_TIME);
      const twelve = distanceConfidence(record({ packets: 12 }), BASE_TIME);
      const thirteen = distanceConfidence(record({ packets: 13 }), BASE_TIME);
      expect(eleven).toBeLessThan(twelve);
      expect(twelve).toBe(thirteen);
      expect(eleven).toBeCloseTo(0.15 + 0.85 * (11 / 12), 12);
    });

    it('holds full freshness up to 2999 ms and drops at exactly 3000 ms', () => {
      const peer = record();
      expect(distanceConfidence(peer, BASE_TIME + 2_999)).toBe(1);
      // freshnessTerm 0.6 -> 0.15 + 0.85 * 0.6 = 0.66
      expect(distanceConfidence(peer, BASE_TIME + 3_000)).toBe(0.66);
    });

    it('holds the mid freshness step up to 9999 ms and drops again at exactly 10000 ms', () => {
      const peer = record();
      expect(distanceConfidence(peer, BASE_TIME + 9_999)).toBe(0.66);
      // freshnessTerm 0.25 -> 0.15 + 0.85 * 0.25 = 0.3625
      expect(distanceConfidence(peer, BASE_TIME + 10_000)).toBe(0.3625);
      expect(distanceConfidence(peer, BASE_TIME + 600_000)).toBe(0.3625);
    });

    it('treats a clock that runs behind lastSeen as zero age rather than negative age', () => {
      const peer = record();
      expect(distanceConfidence(peer, BASE_TIME - 60_000)).toBe(1);
    });

    it('falls as the signal weakens and floors the strength term at -95 dBm', () => {
      const strong = distanceConfidence(record({ rssi: -50 }), BASE_TIME);
      const middling = distanceConfidence(record({ rssi: -70 }), BASE_TIME);
      const weak = distanceConfidence(record({ rssi: -95 }), BASE_TIME);
      const weaker = distanceConfidence(record({ rssi: -120 }), BASE_TIME);
      expect(strong).toBe(1);
      expect(middling).toBeCloseTo(0.15 + 0.85 * (0.4 + 0.6 * (25 / 45)), 12);
      expect(middling).toBeLessThan(strong);
      // strengthTerm 0 -> 0.15 + 0.85 * 0.4 = 0.49
      expect(weak).toBe(0.49);
      expect(weaker).toBe(0.49);
    });

    it('stays inside 0..1 across every extreme combination of its three inputs', () => {
      const packetOptions = [0, 1, 12, 1_000_000];
      const rssiOptions = [0, -50, -95, -200];
      const ageOptions = [-5_000, 0, 2_999, 3_000, 10_000, 1_000_000_000];
      for (const packets of packetOptions) {
        for (const rssi of rssiOptions) {
          for (const age of ageOptions) {
            const value = distanceConfidence(record({ packets, rssi }), BASE_TIME + age);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
          }
        }
      }
    });

    it('defaults the clock to lastSeen, so an un-clocked call is never penalised for age', () => {
      const peer = record({ lastSeen: BASE_TIME - 500_000 });
      expect(distanceConfidence(peer)).toBe(1);
      expect(distanceConfidence(peer, BASE_TIME)).toBe(0.3625);
    });
  });

  describe('describeProximity', () => {
    it('marks a freshly discovered peer provisional however many packets it has', () => {
      expect(describeProximity(record({ state: 'discovered', packets: 400 })).provisional).toBe(true);
    });

    it('marks a peer provisional while it has fewer than 4 packets', () => {
      expect(describeProximity(record({ state: 'active', packets: 0 })).provisional).toBe(true);
      expect(describeProximity(record({ state: 'active', packets: 3 })).provisional).toBe(true);
    });

    it('stops being provisional at exactly the fourth packet', () => {
      expect(describeProximity(record({ state: 'active', packets: 4 })).provisional).toBe(false);
      expect(describeProximity(record({ state: 'active', packets: 5 })).provisional).toBe(false);
    });

    it('never returns an empty label or rangeLabel for any band', () => {
      for (const band of ALL_BANDS) {
        const descriptor = describeProximity(record({ band, packets: 8 }));
        expect(descriptor.band).toBe(band);
        expect(descriptor.label.length).toBeGreaterThan(0);
        expect(descriptor.rangeLabel.length).toBeGreaterThan(0);
      }
    });

    it('uses the documented words for each band', () => {
      const words = ALL_BANDS.map((band) => {
        const descriptor = describeProximity(record({ band }));
        return [descriptor.label, descriptor.rangeLabel];
      });
      expect(words).toEqual([
        ['Very close', 'under 3 m'],
        ['Close', '3-7 m'],
        ['Nearby', '7-12 m'],
        ['Farther', '12 m+'],
      ]);
    });

    it('never returns an empty trendLabel for any trend', () => {
      expect(describeProximity(record({ trend: 'approaching' })).trendLabel).toBe('Getting closer');
      expect(describeProximity(record({ trend: 'steady' })).trendLabel).toBe('Holding steady');
      expect(describeProximity(record({ trend: 'receding' })).trendLabel).toBe('Moving away');
    });

    it('threads the supplied clock into the confidence it reports', () => {
      const peer = record();
      expect(describeProximity(peer, BASE_TIME + 10_000).confidence).toBe(
        distanceConfidence(peer, BASE_TIME + 10_000),
      );
      expect(describeProximity(peer, BASE_TIME + 10_000).confidence).toBe(0.3625);
    });

    it('carries the raw distance estimate through untouched for layout maths', () => {
      expect(describeProximity(record({ estimatedDistance: 9.37 })).estimatedDistance).toBe(9.37);
    });
  });

  describe('proximityInputFrom', () => {
    it('builds a position input whose distanceConfidence uses the supplied clock', () => {
      const peer = record({ peerId: 'peer-z', estimatedDistance: 6.5, band: 'nearby' });
      expect(proximityInputFrom(peer, undefined, BASE_TIME + 3_000)).toEqual({
        peerId: 'peer-z',
        distance: 6.5,
        band: 'nearby',
        distanceConfidence: 0.66,
        bearingHint: undefined,
      });
    });

    it('forwards a bearing hint unchanged when the anchor solver supplies one', () => {
      const hint = { bearing: 137.5, confidence: 0.42 };
      expect(proximityInputFrom(record(), hint, BASE_TIME).bearingHint).toEqual(hint);
    });
  });

  describe('renderPriority', () => {
    const context: PriorityContext = {
      selectedPeerId: 'sel',
      navigatingPeerId: 'nav',
      availablePeerIds: new Set(['sel', 'nav', 'avail', 'far-avail']),
    };

    it('ranks the selected peer above the navigating peer above everyone else', () => {
      expect(renderPriority('sel', 'far', context)).toBe(1000);
      expect(renderPriority('nav', 'far', context)).toBe(900);
      // The best a plain peer can do is very_close + available.
      expect(renderPriority('avail', 'very_close', context)).toBe(110);
      expect(renderPriority('nav', 'far', context)).toBeGreaterThan(
        renderPriority('avail', 'very_close', context),
      );
    });

    it('keeps the selected peer on top when it is also the navigation target', () => {
      const both: PriorityContext = { selectedPeerId: 'x', navigatingPeerId: 'x' };
      expect(renderPriority('x', 'far', both)).toBe(1000);
    });

    it('scores closer bands above farther ones, 20 points per band', () => {
      const plain: PriorityContext = {};
      const scores = ALL_BANDS.map((band) => renderPriority('anyone', band, plain));
      expect(scores).toEqual([100, 80, 60, 40]);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThan(scores[i - 1]);
      }
    });

    it('adds exactly 10 for an available peer without letting it jump a band', () => {
      expect(renderPriority('avail', 'close', context)).toBe(90);
      expect(renderPriority('other', 'close', context)).toBe(80);
      // A far-but-available peer still ranks below a nearby unavailable one.
      expect(renderPriority('far-avail', 'far', context)).toBe(50);
      expect(renderPriority('other', 'nearby', context)).toBe(60);
      expect(renderPriority('far-avail', 'far', context)).toBeLessThan(
        renderPriority('other', 'nearby', context),
      );
    });

    it('does not add the available bonus on top of the selected or navigating score', () => {
      expect(renderPriority('sel', 'very_close', context)).toBe(1000);
      expect(renderPriority('nav', 'very_close', context)).toBe(900);
    });

    it('falls back to the plain band score when the context is empty', () => {
      expect(renderPriority('anyone', 'very_close', {})).toBe(100);
      expect(renderPriority('anyone', 'far', {})).toBe(40);
    });
  });

  describe('sortByPriority', () => {
    // NOTE: `sortByPriority` has no production caller — EventMap.tsx imports
    // `renderPriority` directly and lets clusterPoints/layoutLabels do the
    // ordering. These tests pin the contract so the helper stays trustworthy if
    // a screen ever picks it up.
    type Item = { peerId: string; band: ProximityBand; tag: string };
    const items: Item[] = [
      { peerId: 'far-guy', band: 'far', tag: 'd' },
      { peerId: 'sel', band: 'far', tag: 'a' },
      { peerId: 'close-guy', band: 'very_close', tag: 'c' },
      { peerId: 'nav', band: 'far', tag: 'b' },
    ];
    const context: PriorityContext = { selectedPeerId: 'sel', navigatingPeerId: 'nav' };

    it('orders selected first, navigating second, then by band from close to far', () => {
      expect(sortByPriority(items, context).map((item) => item.tag)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('keeps the input order among peers of equal priority', () => {
      const tied: Item[] = [
        { peerId: 'one', band: 'close', tag: '1' },
        { peerId: 'two', band: 'close', tag: '2' },
        { peerId: 'three', band: 'close', tag: '3' },
      ];
      expect(sortByPriority(tied, {}).map((item) => item.tag)).toEqual(['1', '2', '3']);
    });

    it('returns a new array and leaves the caller\'s list untouched', () => {
      const original = [...items];
      const sorted = sortByPriority(items, context);
      expect(sorted).not.toBe(items);
      expect(items).toEqual(original);
    });

    it('returns an empty array for an empty list', () => {
      expect(sortByPriority([], context)).toEqual([]);
    });
  });

  describe('relativeDirectionLabel', () => {
    it('names the right direction at each of the eight sector centres', () => {
      expect(relativeDirectionLabel(0)).toBe('straight ahead');
      expect(relativeDirectionLabel(45)).toBe('ahead and to your right');
      expect(relativeDirectionLabel(90)).toBe('to your right');
      expect(relativeDirectionLabel(135)).toBe('behind you, to the right');
      expect(relativeDirectionLabel(180)).toBe('behind you');
      expect(relativeDirectionLabel(225)).toBe('behind you, to the left');
      expect(relativeDirectionLabel(270)).toBe('to your left');
      expect(relativeDirectionLabel(315)).toBe('ahead and to your left');
    });

    it('assigns each sector boundary to the clockwise sector', () => {
      expect(relativeDirectionLabel(22.5)).toBe('ahead and to your right');
      expect(relativeDirectionLabel(67.5)).toBe('to your right');
      expect(relativeDirectionLabel(112.5)).toBe('behind you, to the right');
      expect(relativeDirectionLabel(157.5)).toBe('behind you');
      expect(relativeDirectionLabel(202.5)).toBe('behind you, to the left');
      expect(relativeDirectionLabel(247.5)).toBe('to your left');
      expect(relativeDirectionLabel(292.5)).toBe('ahead and to your left');
      expect(relativeDirectionLabel(337.5)).toBe('straight ahead');
    });

    it('keeps the bearing just below a boundary in the anticlockwise sector', () => {
      expect(relativeDirectionLabel(22.4999)).toBe('straight ahead');
      expect(relativeDirectionLabel(67.4999)).toBe('ahead and to your right');
      expect(relativeDirectionLabel(112.4999)).toBe('to your right');
      expect(relativeDirectionLabel(157.4999)).toBe('behind you, to the right');
      expect(relativeDirectionLabel(202.4999)).toBe('behind you');
      expect(relativeDirectionLabel(247.4999)).toBe('behind you, to the left');
      expect(relativeDirectionLabel(292.4999)).toBe('to your left');
      expect(relativeDirectionLabel(337.4999)).toBe('ahead and to your left');
    });

    it('normalises negative bearings into the same eight sectors', () => {
      expect(relativeDirectionLabel(-1)).toBe('straight ahead');
      expect(relativeDirectionLabel(-45)).toBe('ahead and to your left');
      expect(relativeDirectionLabel(-90)).toBe('to your left');
      expect(relativeDirectionLabel(-180)).toBe('behind you');
      expect(relativeDirectionLabel(-720)).toBe('straight ahead');
    });

    it('normalises bearings at or beyond a full turn', () => {
      expect(relativeDirectionLabel(360)).toBe('straight ahead');
      expect(relativeDirectionLabel(450)).toBe('to your right');
      expect(relativeDirectionLabel(810)).toBe('to your right');
      expect(relativeDirectionLabel(765)).toBe('ahead and to your right');
      expect(relativeDirectionLabel(1_080)).toBe('straight ahead');
    });
  });

  describe('closestPerson', () => {
    it('returns null when nobody is on the map', () => {
      expect(closestPerson([])).toBeNull();
    });

    it('returns the nearest person regardless of where they sit in the list', () => {
      const nearest = person('near', 1.4);
      expect(closestPerson([person('far', 22), nearest, person('mid', 6)])).toBe(nearest);
      expect(closestPerson([nearest, person('far', 22), person('mid', 6)])).toBe(nearest);
      expect(closestPerson([person('far', 22), person('mid', 6), nearest])).toBe(nearest);
    });

    it('keeps the first of two people at exactly the same distance', () => {
      const first = person('first', 5);
      const second = person('second', 5);
      expect(closestPerson([first, second])).toBe(first);
    });

    it('returns the only person in a one-element list', () => {
      const solo = person('solo', 40);
      expect(closestPerson([solo])).toBe(solo);
    });
  });
});

/* ================================================================== *
 * Clustering
 * ================================================================== */

describe('Clustering', () => {
  describe('clusterPoints', () => {
    it('collapses points inside the radius into one cluster with the right count and centroid', () => {
      const result = clusterPoints(
        [candidate('a', 100, 100, 1), candidate('b', 112, 100, 5), candidate('c', 106, 112, 3)],
        { radiusPx: 40 },
      );
      const cluster = onlyCluster(result.clusters);
      expect(cluster.count).toBe(3);
      expect([...cluster.memberIds].sort()).toEqual(['a', 'b', 'c']);
      // Centroid of (100,100) (112,100) (106,112).
      expect(cluster.x).toBe(106);
      expect(cluster.y).toBe(104);
      expect(result.singles).toEqual([]);
    });

    it('leaves points farther apart than the radius as separate singles', () => {
      const result = clusterPoints(
        [candidate('a', 0, 0), candidate('b', 300, 0), candidate('c', 0, 300)],
        { radiusPx: 40 },
      );
      expect(result.clusters).toEqual([]);
      expect(sortedIds(result.singles)).toEqual(['a', 'b', 'c']);
    });

    it('merges a pair sitting at exactly the cluster radius', () => {
      const result = clusterPoints([candidate('a', 0, 0), candidate('b', 70, 0)], { radiusPx: 70 });
      const cluster = onlyCluster(result.clusters);
      expect(cluster.count).toBe(2);
      expect(cluster.x).toBe(35);
      expect(result.singles).toEqual([]);
    });

    it('keeps a pair one pixel beyond the cluster radius apart', () => {
      const result = clusterPoints([candidate('a', 0, 0), candidate('b', 71, 0)], { radiusPx: 70 });
      expect(result.clusters).toEqual([]);
      expect(sortedIds(result.singles)).toEqual(['a', 'b']);
    });

    it('merges a visually adjacent pair that straddles a grid bucket boundary', () => {
      // floor(49/50) = 0 and floor(51/50) = 1: different buckets, 2 px apart.
      const result = clusterPoints([candidate('a', 49, 0), candidate('b', 51, 0)], { radiusPx: 50 });
      const cluster = onlyCluster(result.clusters);
      expect(cluster.count).toBe(2);
      expect(cluster.x).toBe(50);
    });

    it('names the cluster after its highest-priority member and shows that member', () => {
      const result = clusterPoints(
        [candidate('low', 10, 10, 1), candidate('top', 20, 10, 99), candidate('mid', 15, 20, 40)],
        { radiusPx: 60 },
      );
      const cluster = onlyCluster(result.clusters);
      expect(cluster.representativeId).toBe('top');
      expect(cluster.id).toBe('cluster:top');
    });

    it('reports the same cluster id on repeated calls with the same input', () => {
      const candidates = [
        candidate('a', 100, 100, 1),
        candidate('b', 112, 100, 5),
        candidate('c', 106, 112, 3),
        candidate('d', 600, 600, 2),
      ];
      const first = clusterPoints(candidates, { radiusPx: 40 });
      const second = clusterPoints(candidates, { radiusPx: 40 });
      const third = clusterPoints(candidates, { radiusPx: 40 });
      expect(first.clusters.map((cluster) => cluster.id)).toEqual(['cluster:b']);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it('disables clustering entirely at a radius of 0', () => {
      const candidates = [candidate('a', 0, 0), candidate('b', 1, 1)];
      const result = clusterPoints(candidates, { radiusPx: 0 });
      expect(result.clusters).toEqual([]);
      expect(result.singles).toEqual(candidates);
    });

    it('disables clustering for a negative radius rather than bucketing on it', () => {
      const candidates = [candidate('a', 0, 0), candidate('b', 1, 1)];
      const result = clusterPoints(candidates, { radiusPx: -10 });
      expect(result.clusters).toEqual([]);
      expect(result.singles).toEqual(candidates);
    });

    it('returns nothing at all for an empty candidate list', () => {
      expect(clusterPoints([], { radiusPx: 64 })).toEqual({ clusters: [], singles: [] });
    });

    it('leaves a lone point as a single rather than a cluster of one', () => {
      const result = clusterPoints([candidate('solo', 5, 5)], { radiusPx: 64 });
      expect(result.clusters).toEqual([]);
      expect(result.singles.map((single) => single.id)).toEqual(['solo']);
    });

    it('keeps a group below minClusterSize as individual nodes', () => {
      const result = clusterPoints([candidate('a', 0, 0), candidate('b', 5, 5)], {
        radiusPx: 40,
        minClusterSize: 3,
      });
      expect(result.clusters).toEqual([]);
      expect(sortedIds(result.singles)).toEqual(['a', 'b']);
    });

    it('clusters a group that reaches minClusterSize exactly', () => {
      const result = clusterPoints(
        [candidate('a', 0, 0), candidate('b', 5, 5), candidate('c', 10, 0)],
        { radiusPx: 40, minClusterSize: 3 },
      );
      expect(onlyCluster(result.clusters).count).toBe(3);
      expect(result.singles).toEqual([]);
    });

    it('never folds a pinned candidate into a cluster', () => {
      const result = clusterPoints(
        [candidate('a', 100, 100, 1), candidate('b', 112, 100, 5), candidate('c', 106, 112, 3)],
        { radiusPx: 40, pinned: new Set(['b']) },
      );
      expect(result.singles.map((single) => single.id)).toEqual(['b']);
      const cluster = onlyCluster(result.clusters);
      expect([...cluster.memberIds].sort()).toEqual(['a', 'c']);
      // Pinning the representative dissolves the id the cluster used to carry:
      // it is now named after the next-highest-priority member instead. See the
      // coverage note about EventMap's expand-on-tap wiring.
      expect(cluster.id).toBe('cluster:c');
    });

    it('places every candidate in exactly one cluster or single', () => {
      const candidates = [
        candidate('a', 0, 0, 1),
        candidate('b', 20, 10, 2),
        candidate('c', 300, 5, 3),
        candidate('d', 305, 40, 4),
        candidate('e', 900, 900, 5),
        candidate('f', -60, -60, 6),
        candidate('g', -70, -55, 7),
      ];
      const result = clusterPoints(candidates, { radiusPx: 64 });
      const seen = [
        ...result.clusters.flatMap((cluster) => cluster.memberIds),
        ...result.singles.map((single) => single.id),
      ];
      expect(seen.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
      expect(new Set(seen).size).toBe(seen.length);
      for (const cluster of result.clusters) {
        expect(cluster.count).toBe(cluster.memberIds.length);
        expect(cluster.memberIds).toContain(cluster.representativeId);
      }
    });

    it('handles negative screen coordinates without dropping anyone', () => {
      const result = clusterPoints([candidate('a', -100, -100), candidate('b', -110, -104)], {
        radiusPx: 64,
      });
      const cluster = onlyCluster(result.clusters);
      expect(cluster.count).toBe(2);
      expect(cluster.x).toBe(-105);
      expect(cluster.y).toBe(-102);
    });
  });

  describe('layoutLabels', () => {
    it('shifts a colliding label vertically and never horizontally', () => {
      const placements = layoutLabels([
        labelBox('top', 100, 100, 10),
        labelBox('second', 100, 100, 5),
      ]);
      const top = placementFor(placements, 'top');
      const second = placementFor(placements, 'second');
      // Both anchored at x=100 with an 80-wide box: x is anchorX - width/2.
      expect(top.x).toBe(60);
      expect(second.x).toBe(60);
      // The winner keeps its preferred slot; the loser is nudged up by 24 px,
      // the first multiple of shiftStep 6 that clears height + padding = 22.
      expect(top.y).toBe(90);
      expect(second.y).toBe(66);
      expect(second.visible).toBe(true);
    });

    it('tries the slot above before the slot below', () => {
      const placements = layoutLabels([
        labelBox('top', 100, 100, 10),
        labelBox('second', 100, 100, 5),
      ]);
      expect(placementFor(placements, 'second').y).toBeLessThan(
        placementFor(placements, 'top').y,
      );
    });

    it('leaves labels that do not collide at their preferred offset', () => {
      const placements = layoutLabels([labelBox('a', 0, 100, 1), labelBox('b', 400, 100, 2)]);
      expect(placementFor(placements, 'a')).toEqual({ id: 'a', x: -40, y: 90, visible: true });
      expect(placementFor(placements, 'b')).toEqual({ id: 'b', x: 360, y: 90, visible: true });
    });

    it('treats a vertical gap of exactly height + padding as clear', () => {
      const placements = layoutLabels([
        labelBox('top', 100, 100, 10),
        labelBox('below', 100, 100 + CLEAR_GAP, 5),
      ]);
      expect(placementFor(placements, 'top').y).toBe(90);
      expect(placementFor(placements, 'below').y).toBe(90 + CLEAR_GAP);
    });

    it('shifts when the vertical gap is one pixel short of height + padding', () => {
      const placements = layoutLabels([
        labelBox('top', 100, 100, 10),
        labelBox('below', 100, 100 + CLEAR_GAP - 1, 5),
      ]);
      expect(placementFor(placements, 'top').y).toBe(90);
      // Preferred 111 collides; 105 (up) still collides; 117 (down) clears.
      expect(placementFor(placements, 'below').y).toBe(117);
    });

    it('treats a horizontal gap of exactly the padding as clear', () => {
      const placements = layoutLabels([
        labelBox('left', 0, 100, 10),
        labelBox('right', LABEL_WIDTH + DEFAULT_PADDING, 100, 5),
      ]);
      expect(placementFor(placements, 'left').y).toBe(90);
      expect(placementFor(placements, 'right').y).toBe(90);
    });

    it('resolves a horizontal near-miss by moving vertically, leaving x alone', () => {
      const nearlyClear = LABEL_WIDTH + DEFAULT_PADDING - 1;
      const placements = layoutLabels([
        labelBox('left', 0, 100, 10),
        labelBox('right', nearlyClear, 100, 5),
      ]);
      const right = placementFor(placements, 'right');
      expect(right.x).toBe(nearlyClear - LABEL_WIDTH / 2);
      expect(right.y).toBe(66);
      expect(right.visible).toBe(true);
    });

    it('drops the lowest-priority label when the column is genuinely full', () => {
      const placements = layoutLabels([
        labelBox('p40', 100, 100, 40),
        labelBox('p30', 100, 100, 30),
        labelBox('p20', 100, 100, 20),
        labelBox('p10', 100, 100, 10),
      ]);
      expect(placementFor(placements, 'p40')).toEqual({ id: 'p40', x: 60, y: 90, visible: true });
      expect(placementFor(placements, 'p30').y).toBe(66);
      expect(placementFor(placements, 'p20').y).toBe(114);
      expect(placementFor(placements, 'p10').visible).toBe(false);
      expect(placements.filter((placement) => placement.visible)).toHaveLength(3);
    });

    it('reports a dropped label at its preferred position so nothing is left undefined', () => {
      const placements = layoutLabels(
        [labelBox('keep', 100, 100, 10), labelBox('drop', 100, 100, 1)],
        { maxShift: 0, shiftStep: 1 },
      );
      expect(placementFor(placements, 'drop')).toEqual({
        id: 'drop',
        x: 60,
        y: 90,
        visible: false,
      });
    });

    it('never moves any label horizontally, visible or hidden', () => {
      const boxes = [
        labelBox('a', 100, 100, 40),
        labelBox('b', 104, 100, 30),
        labelBox('c', 96, 100, 20),
        labelBox('d', 100, 100, 10),
      ];
      const placements = layoutLabels(boxes);
      for (const box of boxes) {
        expect(placementFor(placements, box.id).x).toBe(box.anchorX - box.width / 2);
      }
    });

    it('gives the preferred slot to the highest-priority label whatever the input order', () => {
      const lowFirst = layoutLabels([labelBox('low', 100, 100, 1), labelBox('high', 100, 100, 9)]);
      expect(placementFor(lowFirst, 'high').y).toBe(90);
      expect(placementFor(lowFirst, 'low').y).toBe(66);

      const highFirst = layoutLabels([labelBox('high', 100, 100, 9), labelBox('low', 100, 100, 1)]);
      expect(placementFor(highFirst, 'high').y).toBe(90);
      expect(placementFor(highFirst, 'low').y).toBe(66);
    });

    it('returns placements in priority order rather than input order', () => {
      const placements = layoutLabels([
        labelBox('c', 0, 0, 1),
        labelBox('a', 400, 0, 9),
        labelBox('b', 800, 0, 5),
      ]);
      expect(placements.map((placement) => placement.id)).toEqual(['a', 'b', 'c']);
    });

    it('explores up to maxShift and no further', () => {
      const fits = layoutLabels([labelBox('top', 100, 100, 2), labelBox('other', 100, 100, 1)], {
        maxShift: CLEAR_GAP,
        shiftStep: CLEAR_GAP,
      });
      expect(placementFor(fits, 'other')).toEqual({
        id: 'other',
        x: 60,
        y: 90 - CLEAR_GAP,
        visible: true,
      });

      const doesNotFit = layoutLabels(
        [labelBox('top', 100, 100, 2), labelBox('other', 100, 100, 1)],
        { maxShift: CLEAR_GAP - 1, shiftStep: CLEAR_GAP },
      );
      expect(placementFor(doesNotFit, 'other').visible).toBe(false);
    });

    it('hides rather than nudges when the caller passes maxShift 0, as production does', () => {
      // EventMap.tsx calls layoutLabels with { maxShift: 0, shiftStep: 1, padding: 4 }
      // so only the preferred slot is ever tested.
      const placements = layoutLabels(
        [labelBox('keep', 100, 100, 10), labelBox('drop', 100, 100, 1)],
        { maxShift: 0, shiftStep: 1, padding: 4 },
      );
      expect(placementFor(placements, 'keep')).toEqual({
        id: 'keep',
        x: 60,
        y: 90,
        visible: true,
      });
      expect(placementFor(placements, 'drop').visible).toBe(false);
    });

    it('keeps every label at maxShift 0 when none of them collide', () => {
      const placements = layoutLabels(
        [labelBox('a', 0, 100, 3), labelBox('b', 400, 100, 2), labelBox('c', 800, 100, 1)],
        { maxShift: 0, shiftStep: 1, padding: 4 },
      );
      expect(placements.every((placement) => placement.visible)).toBe(true);
      expect(placements.map((placement) => placement.y)).toEqual([90, 90, 90]);
    });

    it('returns an empty array when there are no labels to place', () => {
      expect(layoutLabels([])).toEqual([]);
    });

    it('places a single label at its preferred offset with a padding of zero', () => {
      const placements = layoutLabels([labelBox('solo', 50, 200, 1)], { padding: 0 });
      expect(placements).toEqual([{ id: 'solo', x: 10, y: 190, visible: true }]);
    });
  });

  describe('zoom definitions', () => {
    it('covers every zoom level exactly once, tightening from overview to nearby', () => {
      expect(ZOOM_LEVELS.map((zoom) => zoom.level)).toEqual([
        'overview',
        'venue',
        'hall',
        'nearby',
      ]);
      expect(ZOOM_LEVELS).toHaveLength(ALL_ZOOMS.length);
      for (let i = 1; i < ZOOM_LEVELS.length; i++) {
        expect(ZOOM_LEVELS[i].radiusMeters).toBeLessThan(ZOOM_LEVELS[i - 1].radiusMeters);
      }
    });

    it('gives every level a walkable radius, a usable cluster radius and a label', () => {
      for (const zoom of ZOOM_LEVELS) {
        expect(Number.isFinite(zoom.radiusMeters)).toBe(true);
        expect(zoom.radiusMeters).toBeGreaterThan(0);
        expect(zoom.radiusMeters).toBeLessThanOrEqual(100);
        // Tuned against the ~136 x 96 dp node footprint: big enough to actually
        // merge overlapping avatars, small enough not to swallow the map.
        expect(zoom.clusterRadiusPx).toBeGreaterThanOrEqual(48);
        expect(zoom.clusterRadiusPx).toBeLessThanOrEqual(96);
        expect(zoom.label.length).toBeGreaterThan(0);
      }
    });

    it('draws name bubbles only at the two tightest zooms', () => {
      expect(ZOOM_LEVELS.map((zoom) => zoom.showLabels)).toEqual([false, false, true, true]);
    });

    it('resolves each level to its own definition', () => {
      for (const level of ALL_ZOOMS) {
        expect(zoomDefinition(level).level).toBe(level);
      }
      expect(zoomDefinition('hall').radiusMeters).toBe(15);
      expect(zoomDefinition('nearby').clusterRadiusPx).toBe(56);
    });

    it('steps zoomIn towards nearby and clamps there', () => {
      expect(zoomIn('overview')).toBe('venue');
      expect(zoomIn('venue')).toBe('hall');
      expect(zoomIn('hall')).toBe('nearby');
      expect(zoomIn('nearby')).toBe('nearby');
    });

    it('steps zoomOut towards overview and clamps there', () => {
      expect(zoomOut('nearby')).toBe('hall');
      expect(zoomOut('hall')).toBe('venue');
      expect(zoomOut('venue')).toBe('overview');
      expect(zoomOut('overview')).toBe('overview');
    });

    it('makes zoomIn and zoomOut inverses away from the ends', () => {
      expect(zoomOut(zoomIn('venue'))).toBe('venue');
      expect(zoomIn(zoomOut('hall'))).toBe('hall');
    });

    it('picks the tightest zoom that still covers the farthest person', () => {
      // The threshold at each level is radiusMeters * 0.9: 6.3 / 13.5 / 27 / 54.
      expect(autoZoomFor(0)).toBe('nearby');
      expect(autoZoomFor(6.3)).toBe('nearby');
      expect(autoZoomFor(6.31)).toBe('hall');
      expect(autoZoomFor(13.5)).toBe('hall');
      expect(autoZoomFor(13.51)).toBe('venue');
      expect(autoZoomFor(27)).toBe('venue');
      expect(autoZoomFor(27.01)).toBe('overview');
      expect(autoZoomFor(54)).toBe('overview');
    });

    it('falls back to overview when everyone is beyond the widest ring', () => {
      expect(autoZoomFor(54.01)).toBe('overview');
      expect(autoZoomFor(5_000)).toBe('overview');
      expect(autoZoomFor(Number.POSITIVE_INFINITY)).toBe('overview');
    });
  });
});
