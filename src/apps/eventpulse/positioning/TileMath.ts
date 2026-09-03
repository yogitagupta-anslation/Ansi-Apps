/**
 * TileMath — Web Mercator arithmetic for the satellite ground layer.
 *
 * Pure functions, no React and no React Native, so the whole thing is testable
 * under `node:test` like the rest of the domain layer. The component that draws
 * tiles does nothing but turn this output into `<Image>` elements.
 *
 * A warning that belongs at the top of this file rather than buried in a
 * comment: **none of this places people.** It places *imagery of the venue*.
 * BLE measures distance, not position, so attendee nodes stay on the radar
 * rings above this layer. The tiles give the room a floor you recognise; they
 * do not give anybody a pin.
 */

/** Standard slippy-map tile edge, in image pixels. */
export const TILE_SIZE = 256;

/**
 * Ground resolution at the equator for a 256 px tile at zoom 0, in metres per
 * pixel: the Earth's Mercator circumference (2πa) divided by 256.
 */
const EQUATOR_METERS_PER_PIXEL = 156_543.033_928_040_97;

/**
 * Deepest zoom worth requesting.
 *
 * z19 (~30 cm/px) is where world-wide satellite coverage actually ends. Some
 * cities go deeper, but a venue could be anywhere, and past the edge the
 * provider does not return a blank — it returns a grey "map data not yet
 * available" placeholder, which looks like a bug and is worse than honest
 * upscaling. So we stop at the level that exists everywhere and let the
 * component enlarge those pixels for the close-in zooms.
 *
 * This is a real limit, not a tuning choice: at Nearby zoom the screen shows
 * roughly 8 cm per pixel and the sharpest public imagery is 30 cm. Close-up
 * satellite views are soft because the photographs are, and no setting here
 * changes that.
 */
export const MAX_TILE_ZOOM = 19;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Metres of ground covered by one image pixel at this latitude and zoom. */
export function metersPerPixel(latitude: number, zoom: number): number {
  return (EQUATOR_METERS_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Fractional tile coordinates for a point. The integer part identifies the
 * tile, the fraction says where inside it the point falls — which is what lets
 * us align imagery to a specific centre rather than to a tile boundary.
 */
export function projectToTile(point: LatLng, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latitudeRadians = (point.latitude * Math.PI) / 180;
  return {
    x: n * ((point.longitude + 180) / 360),
    y:
      (n *
        (1 -
          Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI)) /
      2,
  };
}

/**
 * The integer zoom whose native resolution is at least as fine as the screen
 * needs, so tiles are downscaled (sharp) rather than upscaled (soft) wherever
 * imagery that deep exists.
 *
 * `pxPerMeter` comes from the map's own zoom definition, so the ground layer
 * follows Overview/Venue/Hall/Nearby without a second scale to keep in sync.
 */
export function tileZoomFor(latitude: number, pxPerMeter: number): number {
  if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return MAX_TILE_ZOOM;
  const targetMetersPerPixel = 1 / pxPerMeter;
  const ideal = Math.log2(
    (EQUATOR_METERS_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) / targetMetersPerPixel,
  );
  return Math.max(0, Math.min(MAX_TILE_ZOOM, Math.ceil(ideal)));
}

export interface TilePlacement {
  /** Stable key for React — a tile's identity is its coordinate. */
  key: string;
  z: number;
  x: number;
  y: number;
  /** Screen position of the tile's top-left corner, in dp. */
  left: number;
  top: number;
  /** Edge length on screen, in dp. Equal for both axes; tiles stay square. */
  size: number;
}

export interface TileGridOptions {
  centre: LatLng;
  /** Screen point the venue centre is drawn at — the map's "you" marker. */
  centreX: number;
  centreY: number;
  width: number;
  height: number;
  pxPerMeter: number;
  /** Hard ceiling on tiles requested at once, to bound memory and requests. */
  maxTiles?: number;
}

export interface TileGrid {
  zoom: number;
  /** Displayed size ÷ native size. Above 1 the imagery is being upscaled. */
  scale: number;
  tiles: TilePlacement[];
}

/**
 * Tiles covering the visible canvas, positioned so `centre` lands exactly on
 * (`centreX`, `centreY`).
 *
 * Coverage is a square around that centre rather than the viewport rectangle,
 * with a radius reaching the furthest corner. In heading-up mode the layer is
 * rotated about the centre, and a rectangle's corners swing outside their own
 * bounding box as it turns — covering the circumscribing square means a turn
 * never exposes a bare edge.
 */
export function tileGrid(options: TileGridOptions): TileGrid {
  const { centre, centreX, centreY, width, height, pxPerMeter, maxTiles = 64 } = options;

  if (width <= 0 || height <= 0 || pxPerMeter <= 0) {
    return { zoom: MAX_TILE_ZOOM, scale: 1, tiles: [] };
  }

  const zoom = tileZoomFor(centre.latitude, pxPerMeter);
  const native = metersPerPixel(centre.latitude, zoom);
  const scale = native * pxPerMeter;
  const displayed = TILE_SIZE * scale;

  const origin = projectToTile(centre, zoom);
  const n = 2 ** zoom;

  // Distance from the anchor point to the furthest viewport corner.
  const reach = Math.max(
    Math.hypot(centreX, centreY),
    Math.hypot(width - centreX, centreY),
    Math.hypot(centreX, height - centreY),
    Math.hypot(width - centreX, height - centreY),
  );

  const minX = Math.floor(origin.x - reach / displayed);
  const maxX = Math.ceil(origin.x + reach / displayed);
  const minY = Math.floor(origin.y - reach / displayed);
  const maxY = Math.ceil(origin.y + reach / displayed);

  const tiles: TilePlacement[] = [];
  for (let y = minY; y <= maxY; y++) {
    // Off the top or bottom of the world there is nothing to fetch. Longitude
    // wraps, latitude does not.
    if (y < 0 || y >= n) continue;
    for (let x = minX; x <= maxX; x++) {
      const wrapped = ((x % n) + n) % n;
      tiles.push({
        key: `${zoom}/${wrapped}/${y}@${x}`,
        z: zoom,
        x: wrapped,
        y,
        left: centreX - (origin.x - x) * displayed,
        top: centreY - (origin.y - y) * displayed,
        size: displayed,
      });
      if (tiles.length >= maxTiles) return { zoom, scale, tiles };
    }
  }

  return { zoom, scale, tiles };
}
