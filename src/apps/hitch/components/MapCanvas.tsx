import React, {useMemo} from 'react';
import {View, Text, type LayoutChangeEvent} from 'react-native';
import Svg, {Circle, G, Line, Path, Rect} from 'react-native-svg';

import {useT} from './ui/Kit';
import {vehicleSpec} from '../config/catalogue';
import type {NearbyRide, Place, Proximity, Route} from '../types';

/**
 * The map.
 *
 * It is a schematic, not a chart of anywhere, and that is a deliberate answer to what
 * this app can honestly know rather than a placeholder for a real one. Hitch finds
 * vehicles over Bluetooth: the radio reports signal strength, which says roughly how far
 * something is and nothing whatsoever about which direction it lies in. A satellite map
 * with vehicles pinned to streets would be inventing the most important part of itself.
 *
 * So the surface has two halves with different rules:
 *
 *  - The ROUTE half — ground, roads, pickup, destination, the line between them — is drawn
 *    from `Place` coordinates, which will become real positions once offline map data
 *    lands. Nothing about this component changes when that happens: it already consumes a
 *    normalised polyline from `getRoute`.
 *
 *  - The VEHICLE half is placed on rings by PROXIMITY BAND. A vehicle sitting on the inner
 *    ring means the radio hears it strongly; its angle is a stable seat on the dial, taken
 *    from its peer id, not a bearing. The legend says exactly this, because a dot on a map
 *    is such a strong claim of "it is there" that the disclaimer has to be on the surface
 *    rather than in a help page nobody opens.
 */

/** Radius of each proximity ring, as a fraction of the smaller side. */
const RING: Record<Proximity, number> = {
  veryClose: 0.16,
  near: 0.29,
  far: 0.42,
};

interface Props {
  /** Drawn when the passenger has picked a destination. */
  route?: Route | null;
  /** Where "you" are. Defaults to the middle when no route is shown. */
  origin?: Place | null;
  /** Vehicles to scatter on the proximity rings. */
  rides?: NearbyRide[];
  /** Dims everything but the route — used while a ride is being chosen. */
  focusRoute?: boolean;
  height?: number;
}

/** A deterministic road lattice, so the ground reads as a city rather than as paper. */
function roads(w: number, h: number): Array<{x1: number; y1: number; x2: number; y2: number; wide: boolean}> {
  const lines: Array<{x1: number; y1: number; x2: number; y2: number; wide: boolean}> = [];
  const cols = [0.14, 0.31, 0.49, 0.67, 0.85];
  const rows = [0.16, 0.34, 0.52, 0.7, 0.88];
  cols.forEach((c, i) => {
    lines.push({x1: c * w, y1: 0, x2: c * w + (i % 2 ? 14 : -10), y2: h, wide: i === 2});
  });
  rows.forEach((r, i) => {
    lines.push({x1: 0, y1: r * h, x2: w, y2: r * h + (i % 2 ? -8 : 12), wide: i === 3});
  });
  return lines;
}

export function MapCanvas({route, origin, rides = [], focusRoute = false, height}: Props) {
  const t = useT();
  const [size, setSize] = React.useState({w: 0, h: 0});

  const onLayout = (e: LayoutChangeEvent) => {
    const {width, height: h} = e.nativeEvent.layout;
    setSize({w: width, h});
  };

  const {w, h} = size;
  const centre = useMemo(() => {
    if (route) {
      return {x: route.from.x * w, y: route.from.y * h};
    }
    if (origin) {
      return {x: origin.x * w, y: origin.y * h};
    }
    return {x: w / 2, y: h / 2};
  }, [route, origin, w, h]);

  const routePath = useMemo(() => {
    if (!route || w === 0) {
      return null;
    }
    return route.points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`)
      .join(' ');
  }, [route, w, h]);

  const scatter = useMemo(() => {
    if (w === 0) {
      return [];
    }
    const unit = Math.min(w, h);
    return rides.map(ride => {
      const angle = (ride.bearing * Math.PI) / 180;
      const r = RING[ride.proximity] * unit;
      return {
        ride,
        x: centre.x + Math.cos(angle) * r,
        y: centre.y + Math.sin(angle) * r * 0.82,
      };
    });
  }, [rides, centre, w, h]);

  return (
    <View
      onLayout={onLayout}
      style={{flex: height ? undefined : 1, height, backgroundColor: t.mapGround}}
      accessibilityLabel={
        route
          ? `Map showing a route from ${route.from.label} to ${route.to.label}`
          : `Map showing ${rides.length} nearby vehicles by how close they are`
      }>
      {w > 0 ? (
        <Svg width={w} height={h}>
          {/* Ground features first: a park and some water so the plate is not empty. */}
          <Rect x={0} y={0} width={w} height={h} fill={t.mapGround} />
          <Rect
            x={w * 0.06}
            y={h * 0.62}
            width={w * 0.26}
            height={h * 0.2}
            rx={10}
            fill={t.mapPark}
          />
          <Path
            d={`M${w * 0.7},0 Q${w * 0.78},${h * 0.4} ${w * 0.62},${h}`}
            stroke={t.mapWater}
            strokeWidth={22}
            fill="none"
            opacity={0.9}
          />

          {roads(w, h).map((r, i) => (
            <Line
              key={i}
              x1={r.x1}
              y1={r.y1}
              x2={r.x2}
              y2={r.y2}
              stroke={t.mapRoad}
              strokeWidth={r.wide ? 9 : 5}
              strokeLinecap="round"
              opacity={focusRoute ? 0.4 : 1}
            />
          ))}

          {/* Proximity rings, only when vehicles are being shown. Faint: they are a
              reference for reading the scatter, not content in their own right. */}
          {!route && rides.length > 0
            ? (Object.keys(RING) as Proximity[]).map(band => (
                <Circle
                  key={band}
                  cx={centre.x}
                  cy={centre.y}
                  r={RING[band] * Math.min(w, h)}
                  stroke={t.border}
                  strokeWidth={1}
                  strokeDasharray="3 6"
                  fill="none"
                />
              ))
            : null}

          {routePath ? (
            <G>
              {/* Casing under the line: a 5px stroke on a busy plate disappears. */}
              <Path d={routePath} stroke={t.mapGround} strokeWidth={11} fill="none" strokeLinecap="round" />
              <Path
                d={routePath}
                stroke={t.mapRoute}
                strokeWidth={5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </G>
          ) : null}

          {/* Destination pin */}
          {route ? (
            <G>
              <Circle cx={route.to.x * w} cy={route.to.y * h} r={9} fill={t.mapRoute} />
              <Circle cx={route.to.x * w} cy={route.to.y * h} r={3.5} fill={t.surface} />
            </G>
          ) : null}

          {/* You. Drawn last of the fixed marks so nothing sits on top of it. */}
          <G>
            <Circle cx={centre.x} cy={centre.y} r={16} fill={t.accentSoft} />
            <Circle cx={centre.x} cy={centre.y} r={7} fill={t.accent} />
            <Circle cx={centre.x} cy={centre.y} r={7} stroke={t.surface} strokeWidth={2.5} fill="none" />
          </G>
        </Svg>
      ) : null}

      {/* Vehicles as text glyphs over the SVG rather than inside it: emoji do not render
          in react-native-svg on Android, and a vector auto-rickshaw is not worth drawing
          when the platform already has one. */}
      {scatter.map(({ride, x, y}) => (
        <View
          key={ride.peerId}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: x - 15,
            top: y - 15,
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: t.surface,
            borderWidth: 1.5,
            borderColor: ride.available ? t.accent : t.border,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: focusRoute ? 0.35 : ride.available ? 1 : 0.55,
          }}>
          <Text style={{fontSize: 15}}>{vehicleSpec(ride.vehicle.kind).glyph}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The sentence that keeps the map honest.
 *
 * Shown under any map that is scattering vehicles. It is one line, and it is the
 * difference between a map that is lying and a map that is being clear about what it
 * knows — which for a Bluetooth app is "how close", never "where".
 */
export function MapDisclaimer() {
  const t = useT();
  return (
    <Text style={{fontSize: 11, lineHeight: 15, color: t.textFaint, textAlign: 'center'}}>
      Vehicles are placed by how strong their signal is, not by where they are. Bluetooth
      knows near and far, not direction.
    </Text>
  );
}
