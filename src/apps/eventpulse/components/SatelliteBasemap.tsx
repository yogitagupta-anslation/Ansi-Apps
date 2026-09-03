/**
 * SatelliteBasemap — real overhead imagery of the venue, under the radar.
 *
 * The honest contract of this layer, because it is easy to get wrong:
 *
 *   - The **imagery** is real. It is the building you are standing in, seen
 *     from above, at the coordinates the organiser published for the event.
 *   - **Your marker sits at the venue**, not at a satellite-derived position.
 *     That is a venue-level claim ("you are at this address"), which is true,
 *     and not a metre-level one, which we cannot make.
 *   - **Nobody else gets a pin.** Attendees stay on the distance rings drawn on
 *     top of this layer, exactly as they do without it. BLE measures how far
 *     away someone is, never which way — putting 40 people on a photograph of a
 *     roof would be inventing the one number the whole app refuses to invent.
 *
 * It also asks for no new permissions. The app declares `neverForLocation` on
 * its Bluetooth scan, and the privacy screen promises location is never
 * requested; a decorative ground layer is not a reason to break that. The
 * centre comes from the event record, not from the device's GPS.
 *
 * Tiles are plain `<Image>` elements. React Native's Android image pipeline
 * caches them on disk, so panning back over ground you have already seen costs
 * nothing, and there is no native map SDK, no API key and no prebuild.
 *
 * Known edge: the tile grid is computed once per layout, not per pan frame, so
 * dragging far enough eventually runs off the imagery and the ground fades to
 * the app's own canvas. That is deliberate — recomputing the grid mid-gesture
 * would put React work on the drag path, which is the one thing the map's
 * animation model refuses to do — and it fails honestly: the map ends rather
 * than showing the wrong ground. Recentre brings it back in one tap.
 */

import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { tileGrid, type LatLng } from '../positioning/TileMath';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { AppText } from './primitives';

/**
 * Esri World Imagery. Chosen because it needs no key, which keeps this a pure
 * JS layer — but its terms require the attribution rendered below, so that line
 * is not optional decoration. A deployment with its own imagery contract should
 * swap the template and the credit together.
 */
export const IMAGERY_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const IMAGERY_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';

function tileUrl(z: number, x: number, y: number): string {
  return IMAGERY_TILE_URL.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

export interface SatelliteBasemapProps {
  centre: LatLng;
  width: number;
  height: number;
  /** Screen point the venue centre is drawn at. */
  centreX: number;
  centreY: number;
  pxPerMeter: number;
  /** Map rotation in degrees; the imagery counter-rotates to keep north true. */
  rotation: number;
}

/**
 * How much of the imagery survives. The tiles are dimmed individually rather
 * than covered by a scrim, because the layer lives inside the map's panned and
 * rotated container: a scrim sized to the screen would slide off its own
 * imagery the moment you dragged, leaving a bright unmuted band at the trailing
 * edge. Dimming the images themselves cannot come apart from them.
 *
 * Satellite photography is high-contrast and full of colours that collide with
 * avatars and category dots, so most of it has to go — this is a floor for
 * people to stand on, not the subject of the screen.
 */
const IMAGERY_OPACITY: Record<string, number> = { dark: 0.3, light: 0.5 };

function SatelliteBasemapComponent({
  centre,
  width,
  height,
  centreX,
  centreY,
  pxPerMeter,
  rotation,
}: SatelliteBasemapProps): React.ReactElement | null {
  const { name } = useTheme();

  const grid = useMemo(
    () => tileGrid({ centre, centreX, centreY, width, height, pxPerMeter }),
    [centre, centreX, centreY, width, height, pxPerMeter],
  );

  if (grid.tiles.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Rotated about the venue anchor, not the view centre, so the ground
          turns under a fixed "you" — the same frame the people layer uses.
          Unlike the people layer this one may rotate wholesale: it contains no
          text, and imagery that stays north-up under a heading-up map would be
          worse than useless. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              { translateX: centreX },
              { translateY: centreY },
              { rotate: `${-rotation}deg` },
              { translateX: -centreX },
              { translateY: -centreY },
            ],
          },
        ]}
      >
        {grid.tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(tile.z, tile.x, tile.y) }}
            style={{
              position: 'absolute',
              left: tile.left,
              top: tile.top,
              // A hairline of overlap. Fractional dp positions leave sub-pixel
              // seams between neighbours, which read as a grid drawn over the
              // roof; bleeding each tile by half a pixel hides them.
              width: tile.size + 0.5,
              height: tile.size + 0.5,
              opacity: IMAGERY_OPACITY[name] ?? 0.3,
            }}
            fadeDuration={160}
            resizeMode="cover"
          />
        ))}
      </View>
    </View>
  );
}

/**
 * The provider's credit line. Rendered separately from the tiles because it
 * must stay put: attribution that slides off screen when the user pans is not
 * attribution. The map places it outside its panned container.
 */
export function ImageryCredit(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={[styles.credit, { backgroundColor: colors.mapLabel }]} pointerEvents="none">
      <AppText variant="micro" style={{ color: colors.mapZoneText }}>
        {IMAGERY_CREDIT}
      </AppText>
    </View>
  );
}

/**
 * Re-render only when the ground actually moves. Without this the layer would
 * rebuild its tile list on every presence snapshot — several times a second,
 * for imagery that has not changed since the venue was photographed.
 */
export const SatelliteBasemap = memo(SatelliteBasemapComponent, (previous, next) => {
  return (
    previous.centre.latitude === next.centre.latitude &&
    previous.centre.longitude === next.centre.longitude &&
    previous.width === next.width &&
    previous.height === next.height &&
    previous.centreX === next.centreX &&
    previous.centreY === next.centreY &&
    Math.abs(previous.pxPerMeter - next.pxPerMeter) < 0.01 &&
    // A degree of drift is below the threshold of noticing and costs a full
    // re-render of every tile if we honour it.
    Math.abs(previous.rotation - next.rotation) < 1
  );
});

const styles = StyleSheet.create({
  credit: {
    position: 'absolute',
    left: space.sm,
    // Clear of the "N people nearby" pill that sits along the bottom edge.
    bottom: 78,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
});
