/**
 * Clustering and label placement — how the map stays readable in a crowd.
 *
 * Two separate problems, solved here because they share the same geometry:
 *
 *  1. **Node clustering.** Twenty people standing at the coffee table are
 *     twenty overlapping avatars. Below a zoom threshold they collapse into a
 *     single "● 20" puck that expands when tapped.
 *
 *  2. **Label collision.** Even when nodes are distinct, their name bubbles
 *     are much wider than the avatars and will overlap. We nudge labels
 *     vertically — never horizontally, which would break the visual link
 *     between a bubble and its avatar — and drop the lowest-priority labels
 *     when there is genuinely no room.
 *
 * Both run in *screen* space, after projection, because that is where overlap
 * actually happens.
 */

export interface ClusterCandidate {
  id: string;
  x: number;
  y: number;
  /** Higher wins when picking a cluster's representative. */
  priority: number;
}

export interface Cluster {
  id: string;
  x: number;
  y: number;
  memberIds: string[];
  count: number;
  /** The member shown when the cluster is rendered as a single avatar. */
  representativeId: string;
}

export interface ClusterResult {
  clusters: Cluster[];
  /** Candidates that stayed on their own. */
  singles: ClusterCandidate[];
}

export interface ClusterOptions {
  /** Points closer than this in screen pixels merge. */
  radiusPx: number;
  /** Never cluster these — the selected person and the navigation target. */
  pinned?: ReadonlySet<string>;
  /** Groups smaller than this stay as individual nodes. */
  minClusterSize?: number;
}

/**
 * Grid-bucketed agglomeration. O(n) for the pass that matters; the exact
 * hierarchical result is not worth the cost when the output is a puck with a
 * number on it.
 */
export function clusterPoints(
  candidates: readonly ClusterCandidate[],
  options: ClusterOptions,
): ClusterResult {
  const { radiusPx, pinned, minClusterSize = 2 } = options;
  const clusters: Cluster[] = [];
  const singles: ClusterCandidate[] = [];

  if (radiusPx <= 0) return { clusters, singles: [...candidates] };

  const buckets = new Map<string, ClusterCandidate[]>();
  for (const candidate of candidates) {
    if (pinned?.has(candidate.id)) {
      singles.push(candidate);
      continue;
    }
    const key = `${Math.floor(candidate.x / radiusPx)}:${Math.floor(candidate.y / radiusPx)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(candidate);
    else buckets.set(key, [candidate]);
  }

  const consumed = new Set<string>();

  for (const [key, bucket] of buckets) {
    for (const candidate of bucket) {
      if (consumed.has(candidate.id)) continue;

      // Gather from this bucket and its eight neighbours: a pair straddling a
      // bucket edge is visually adjacent even though the keys differ.
      const [gx, gy] = key.split(':').map(Number);
      const members: ClusterCandidate[] = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighbours = buckets.get(`${gx + dx}:${gy + dy}`);
          if (!neighbours) continue;
          for (const other of neighbours) {
            if (consumed.has(other.id)) continue;
            if (Math.hypot(other.x - candidate.x, other.y - candidate.y) <= radiusPx) {
              members.push(other);
            }
          }
        }
      }

      if (members.length < minClusterSize) {
        consumed.add(candidate.id);
        singles.push(candidate);
        continue;
      }

      for (const member of members) consumed.add(member.id);

      let sumX = 0;
      let sumY = 0;
      let representative = members[0];
      for (const member of members) {
        sumX += member.x;
        sumY += member.y;
        if (member.priority > representative.priority) representative = member;
      }

      clusters.push({
        id: `cluster:${representative.id}`,
        x: sumX / members.length,
        y: sumY / members.length,
        memberIds: members.map((m) => m.id),
        count: members.length,
        representativeId: representative.id,
      });
    }
  }

  return { clusters, singles };
}

/* ------------------------------------------------------------------ *
 * Label placement
 * ------------------------------------------------------------------ */

export interface LabelBox {
  id: string;
  /** Anchor point — the centre of the avatar the label belongs to. */
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  /** Preferred vertical offset from the anchor (negative = above). */
  preferredOffset: number;
  priority: number;
}

export interface LabelPlacement {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface LabelLayoutOptions {
  /** Vertical range the solver may explore, in pixels. */
  maxShift?: number;
  shiftStep?: number;
  /** Padding added around each box when testing overlap. */
  padding?: number;
}

/**
 * Place labels highest-priority first, each taking the nearest free slot to its
 * preferred position. Anything that cannot fit is hidden rather than drawn on
 * top of something else — an unreadable pile of overlapping names is worse
 * than a few missing ones, and tapping the avatar always reveals the name.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  options: LabelLayoutOptions = {},
): LabelPlacement[] {
  const { maxShift = 34, shiftStep = 6, padding = 2 } = options;
  const ordered = [...boxes].sort((a, b) => b.priority - a.priority);
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const out: LabelPlacement[] = [];

  for (const box of ordered) {
    const x = box.anchorX - box.width / 2;
    let chosenY: number | null = null;

    // Try the preferred offset, then alternate above/below in small steps.
    for (let shift = 0; shift <= maxShift; shift += shiftStep) {
      for (const direction of shift === 0 ? [0] : [-1, 1]) {
        const y = box.anchorY + box.preferredOffset + direction * shift;
        const rect = { x, y, width: box.width, height: box.height };
        if (!placed.some((other) => overlaps(rect, other, padding))) {
          chosenY = y;
          break;
        }
      }
      if (chosenY !== null) break;
    }

    if (chosenY === null) {
      out.push({ id: box.id, x, y: box.anchorY + box.preferredOffset, visible: false });
      continue;
    }

    placed.push({ x, y: chosenY, width: box.width, height: box.height });
    out.push({ id: box.id, x, y: chosenY, visible: true });
  }

  return out;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding: number,
): boolean {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

/* ------------------------------------------------------------------ *
 * Zoom
 * ------------------------------------------------------------------ */

export type ZoomLevel = 'overview' | 'venue' | 'hall' | 'nearby';

export interface ZoomDefinition {
  level: ZoomLevel;
  /** Radius of the visible area in metres. */
  radiusMeters: number;
  label: string;
  /** Screen-space clustering radius at this zoom. 0 disables clustering. */
  clusterRadiusPx: number;
  /** Below this zoom we stop drawing name bubbles and show avatars only. */
  showLabels: boolean;
}

/**
 * Event-relative zoom, not geographic zoom. "Overview" is the whole venue,
 * "Nearby" is conversation distance — the numbers are metres a person can
 * actually walk, which is the only scale that means anything here.
 */
export const ZOOM_LEVELS: readonly ZoomDefinition[] = [
  // Cluster radii are tuned against the rendered node footprint (~136 x 96 dp).
  // The first pass used values around 34 px, which is far smaller than a node
  // and so merged almost nothing — the map looked like a pile of overlapping
  // avatars at any realistic attendee count.
  { level: 'overview', radiusMeters: 60, label: 'Overview', clusterRadiusPx: 72, showLabels: false },
  { level: 'venue', radiusMeters: 30, label: 'Venue', clusterRadiusPx: 64, showLabels: false },
  { level: 'hall', radiusMeters: 15, label: 'Hall', clusterRadiusPx: 74, showLabels: true },
  { level: 'nearby', radiusMeters: 7, label: 'Nearby', clusterRadiusPx: 56, showLabels: true },
];

export function zoomDefinition(level: ZoomLevel): ZoomDefinition {
  return ZOOM_LEVELS.find((z) => z.level === level) ?? ZOOM_LEVELS[2];
}

export function zoomIn(level: ZoomLevel): ZoomLevel {
  const index = ZOOM_LEVELS.findIndex((z) => z.level === level);
  return ZOOM_LEVELS[Math.min(index + 1, ZOOM_LEVELS.length - 1)].level;
}

export function zoomOut(level: ZoomLevel): ZoomLevel {
  const index = ZOOM_LEVELS.findIndex((z) => z.level === level);
  return ZOOM_LEVELS[Math.max(index - 1, 0)].level;
}

/** Pick the tightest zoom that still shows everyone. */
export function autoZoomFor(maxDistanceMeters: number): ZoomLevel {
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i--) {
    if (maxDistanceMeters <= ZOOM_LEVELS[i].radiusMeters * 0.9) return ZOOM_LEVELS[i].level;
  }
  return 'overview';
}
