/**
 * EventMap — the live spatial view of the room.
 *
 * What this is: a radar of an event space a few tens of metres across, drawn
 * around you. What it is deliberately *not*: a geographic map of *people*.
 *
 * There is an optional satellite ground layer (`SatelliteBasemap`) showing the
 * venue from above at the coordinates the organiser published — real imagery,
 * so the room has a floor you recognise. It changes nothing about the people
 * layer. No attendee is ever given a coordinate, because BLE measures how far
 * away someone is and never which way, and a pin drawn from that would send
 * people the wrong way with a photograph backing up the lie.
 *
 * The honest content of this view is:
 *   - **distance**, as bands, drawn as labelled rings we actually measured;
 *   - **presence**, who is here right now and whether they are still in range;
 *   - **your heading**, from the fused compass, when it is trustworthy.
 *
 * Bearing is a *layout*, not a measurement, unless anchors or navigation-mode
 * inference supply a real one — so the rings carry the distance meaning, and the
 * confidence of each placement is rendered rather than hidden.
 *
 * Projection notes
 * ----------------
 * Placements arrive as world-frame bearings. In heading-up mode we subtract the
 * device heading, so turning the phone spins the world under a fixed "you" —
 * the behaviour a spatial interface needs. Crucially the rotation is applied to
 * *coordinates*, not with a container transform, so names and avatars stay
 * upright at every heading. A map that rotates its own text is unreadable.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import type { NearbyPerson } from '../presence/PresenceController';
import {
  clusterPoints,
  layoutLabels,
  zoomDefinition,
  type ZoomLevel,
} from '../positioning/Clustering';
import { renderPriority } from '../positioning/ProximityEngine';
import type { EventZone, MapOrientation } from '../types';
import { normaliseDegrees } from '../positioning/HeadingService';
import { useTheme } from '../theme/ThemeProvider';
import { typography } from '../theme/tokens';
import { AppText } from './primitives';
import { PersonNode } from './PersonNode';
import { ImageryCredit, SatelliteBasemap } from './SatelliteBasemap';

export interface EventMapProps {
  people: NearbyPerson[];
  heading: number;
  headingTrusted: boolean;
  orientation: MapOrientation;
  zoom: ZoomLevel;
  selectedPeerId: string | null;
  navigatingPeerId: string | null;
  /** Peer ids that survive the active filter; others render muted. */
  matchedPeerIds: ReadonlySet<string> | null;
  expandedClusterId: string | null;
  /** Venue zones, drawn only when the user has told us where they are standing. */
  zones?: EventZone[];
  currentZone?: EventZone | null;
  /** Bearing of the venue plan's +Y axis, degrees from north. */
  venueNorthOffset?: number;
  /**
   * Venue coordinates from the event record. Supplying both switches the ground
   * layer from the plain radar canvas to satellite imagery of the venue.
   */
  venueLatitude?: number;
  venueLongitude?: number;
  /** User's choice of ground layer. Satellite falls back to plain if unlocated. */
  basemap?: 'plain' | 'satellite';
  /** Increment to animate the view back to centre. */
  recenterNonce?: number;
  onPanned?: (panned: boolean) => void;
  /**
   * Pinch handlers. The map's zoom is a small set of named levels rather than a
   * continuous scale (see `Clustering.ZOOM_LEVELS`), because every level means
   * something in metres. So a pinch does not scale the canvas — it steps
   * through those levels once the gesture passes a threshold.
   */
  onPinchIn?: () => void;
  onPinchOut?: () => void;
  /** Pulses the info button on every node, once, for first-time users. */
  hintInfo?: boolean;
  connectionFor?: (peerId: string) => 'connected' | 'requested' | null;
  onSelect: (peerId: string) => void;
  onLongPressPerson?: (peerId: string) => void;
  onOpenProfile: (peerId: string) => void;
  onExpandCluster: (clusterId: string | null) => void;
  onBackgroundPress: () => void;
}

interface Projected {
  person: NearbyPerson;
  x: number;
  y: number;
  priority: number;
}

/** Ring radii in metres, matching the proximity bands the app speaks in. */
const RING_METERS = [3, 7, 12];

/**
 * Footprint of a rendered person node, in dp. A node is a name bubble stacked
 * over an avatar over a role line, so it is much taller than the bubble alone.
 */
const NODE_COLLISION_WIDTH = 136;
const NODE_COLLISION_HEIGHT = 96;
/** Keep a node's full width on screen; a half-clipped name is unreadable. */
const EDGE_MARGIN = NODE_COLLISION_WIDTH / 2 + 4;
/** Width of a zone landmark label, used for the same edge clamping. */
const ZONE_LABEL_WIDTH = 150;

function EventMapComponent(props: EventMapProps): React.ReactElement {
  const {
    people,
    heading,
    headingTrusted,
    orientation,
    zoom,
    selectedPeerId,
    navigatingPeerId,
    matchedPeerIds,
    expandedClusterId,
    zones,
    currentZone,
    venueNorthOffset = 0,
    venueLatitude,
    venueLongitude,
    basemap = 'plain',
    recenterNonce = 0,
    onPanned,
    onPinchIn,
    onPinchOut,
    hintInfo,
    connectionFor,
    onSelect,
    onLongPressPerson,
    onOpenProfile,
    onExpandCluster,
    onBackgroundPress,
  } = props;

  const { colors } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height },
    );
  }, []);

  const zoomDef = zoomDefinition(zoom);
  const centreX = size.width / 2;
  // The user sits below centre: most of the canvas is then "ahead of you",
  // which is where you are about to walk and who you are about to meet.
  const centreY = size.height * 0.58;
  const usableRadius = Math.min(size.width / 2, centreY) - 28;
  const pxPerMeter = usableRadius > 0 ? usableRadius / zoomDef.radiusMeters : 0;

  const rotation = orientation === 'heading_up' ? heading : 0;

  /**
   * Satellite imagery needs a place to be imagery *of*. An event whose
   * organiser published no coordinates silently keeps the plain canvas rather
   * than guessing at a location — a map of the wrong building is worse than no
   * map at all.
   */
  const satelliteCentre = useMemo(
    () =>
      basemap === 'satellite' && venueLatitude !== undefined && venueLongitude !== undefined
        ? { latitude: venueLatitude, longitude: venueLongitude }
        : null,
    [basemap, venueLatitude, venueLongitude],
  );

  /* --------------------------- panning --------------------------- */

  /**
   * Pan moves the whole world — rings, zones, people and the "you" marker —
   * because "you" is a fixed point in that world, not a fixed point on the
   * screen. Recentre brings it back. The offset lives in an Animated value so
   * dragging never touches React state and never drops a frame.
   */
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panOrigin = useRef({ x: 0, y: 0 });
  const hasPanned = useRef(false);

  useEffect(() => {
    if (recenterNonce === 0) return;
    Animated.timing(pan, {
      toValue: { x: 0, y: 0 },
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    panOrigin.current = { x: 0, y: 0 };
    hasPanned.current = false;
    onPanned?.(false);
  }, [recenterNonce, pan, onPanned]);

  /**
   * Distance between the two fingers when the current pinch began, and the pan
   * offset to restore when it ends. A pinch and a drag arrive through the same
   * responder, so the second finger has to suspend panning: without this the
   * midpoint of a spreading pinch reads as a drag and the map slides away
   * underneath the gesture.
   */
  const pinchStart = useRef(0);
  const panAtPinchStart = useRef({ x: 0, y: 0 });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture on a clear drag, or the moment a second finger
        // lands — a pinch can begin without either finger moving far.
        onMoveShouldSetPanResponder: (event, gesture) =>
          event.nativeEvent.touches.length >= 2 ||
          Math.abs(gesture.dx) > 6 ||
          Math.abs(gesture.dy) > 6,
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;

          if (touches.length >= 2) {
            const spread = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );

            if (pinchStart.current === 0) {
              pinchStart.current = spread;
              panAtPinchStart.current = { x: panOrigin.current.x, y: panOrigin.current.y };
              return;
            }

            // Hold the map still for the duration of the pinch.
            pan.setValue(panAtPinchStart.current);

            const ratio = spread / pinchStart.current;
            // Roughly a third either way. Tight enough to feel responsive,
            // loose enough that a two-finger drag does not trip a zoom.
            if (ratio > 1.35) {
              onPinchIn?.();
              pinchStart.current = spread;
            } else if (ratio < 0.74) {
              onPinchOut?.();
              pinchStart.current = spread;
            }
            return;
          }

          // A single finger that is finishing a pinch must not snap the map to
          // wherever that finger happens to be.
          if (pinchStart.current !== 0) return;

          pan.setValue({
            x: panOrigin.current.x + gesture.dx,
            y: panOrigin.current.y + gesture.dy,
          });
          if (!hasPanned.current) {
            hasPanned.current = true;
            onPanned?.(true);
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          if (pinchStart.current !== 0) {
            pinchStart.current = 0;
            panOrigin.current = panAtPinchStart.current;
            pan.setValue(panOrigin.current);
            return;
          }
          panOrigin.current = {
            x: panOrigin.current.x + gesture.dx,
            y: panOrigin.current.y + gesture.dy,
          };
        },
        onPanResponderTerminate: () => {
          pinchStart.current = 0;
        },
      }),
    [pan, onPanned, onPinchIn, onPinchOut],
  );

  /* --------------------------- zones --------------------------- */

  /**
   * Venue zones, placed relative to the zone the user said they are standing in.
   *
   * Two rotations are involved: the venue plan's own orientation relative to
   * north (`venueNorthOffset`, supplied by the organiser) and the map's current
   * rotation. Getting either wrong points at the coffee table and means the fire
   * exit, which is why this layer stays hidden until the user anchors it.
   */
  const projectedZones = useMemo(() => {
    if (!zones || !currentZone || pxPerMeter === 0) return [];
    return zones
      .filter((zone) => zone.id !== currentZone.id)
      .map((zone) => {
        const dx = zone.x - currentZone.x;
        const dy = zone.y - currentZone.y;
        const metres = Math.hypot(dx, dy);
        const worldBearing = normaliseDegrees(
          (Math.atan2(dx, dy) * 180) / Math.PI + venueNorthOffset,
        );
        const screenAngle = ((worldBearing - rotation) * Math.PI) / 180;
        const shown = Math.min(metres, zoomDef.radiusMeters * 1.08);
        const rawX = centreX + Math.sin(screenAngle) * shown * pxPerMeter;
        const rawY = centreY - Math.cos(screenAngle) * shown * pxPerMeter;
        return {
          zone,
          // Same edge treatment as people: a landmark at the limit of the view
          // is pinned to the edge, not sliced in half.
          x: clamp(rawX, ZONE_LABEL_WIDTH / 2, Math.max(size.width - ZONE_LABEL_WIDTH / 2, 0)),
          y: clamp(rawY, 24, Math.max(size.height - 140, 24)),
          metres,
        };
      });
  }, [
    zones,
    currentZone,
    venueNorthOffset,
    rotation,
    pxPerMeter,
    centreX,
    centreY,
    size.width,
    size.height,
    zoomDef.radiusMeters,
  ]);

  /* --------------------------- projection --------------------------- */

  const projected = useMemo<Projected[]>(() => {
    if (pxPerMeter === 0) return [];
    const context = {
      selectedPeerId: selectedPeerId ?? undefined,
      navigatingPeerId: navigatingPeerId ?? undefined,
    };

    return people.map((person) => {
      const screenAngle = ((person.placement.bearing - rotation) * Math.PI) / 180;
      // Clamp to the visible ring so someone at the far end of the hall still
      // appears (pinned to the edge) instead of vanishing off-canvas.
      const metres = Math.min(person.placement.estimatedDistance, zoomDef.radiusMeters);
      const rawX = centreX + Math.sin(screenAngle) * metres * pxPerMeter;
      const rawY = centreY - Math.cos(screenAngle) * metres * pxPerMeter;
      return {
        person,
        // Clamp into the canvas. Someone at the edge of range should sit at the
        // edge of the map, not half off it with their name sliced in two.
        x: clamp(rawX, EDGE_MARGIN, Math.max(size.width - EDGE_MARGIN, EDGE_MARGIN)),
        y: clamp(rawY, NODE_COLLISION_HEIGHT / 2, Math.max(size.height - 120, 0)),
        priority: renderPriority(person.peerId, person.placement.band, context),
      };
    });
  }, [people, rotation, pxPerMeter, centreX, centreY, size.width, size.height, zoomDef.radiusMeters, selectedPeerId, navigatingPeerId]);

  /* --------------------------- clustering --------------------------- */

  const { clusters, singles } = useMemo(() => {
    const pinned = new Set<string>();
    if (selectedPeerId) pinned.add(selectedPeerId);
    if (navigatingPeerId) pinned.add(navigatingPeerId);
    if (expandedClusterId) {
      // An expanded cluster is temporarily exempt so its members separate out.
      for (const item of projected) {
        if (`cluster:${item.person.peerId}` === expandedClusterId) pinned.add(item.person.peerId);
      }
    }

    const result = clusterPoints(
      projected.map((item) => ({
        id: item.person.peerId,
        x: item.x,
        y: item.y,
        priority: item.priority,
      })),
      { radiusPx: zoomDef.clusterRadiusPx, pinned },
    );

    // An expanded cluster renders its members individually.
    const expanded = result.clusters.find((cluster) => cluster.id === expandedClusterId);
    if (!expanded) return result;

    const members = new Set(expanded.memberIds);
    return {
      clusters: result.clusters.filter((cluster) => cluster.id !== expandedClusterId),
      singles: [
        ...result.singles,
        ...projected
          .filter((item) => members.has(item.person.peerId))
          .map((item) => ({ id: item.person.peerId, x: item.x, y: item.y, priority: item.priority })),
      ],
    };
  }, [projected, zoomDef.clusterRadiusPx, selectedPeerId, navigatingPeerId, expandedClusterId]);

  /* --------------------------- labels --------------------------- */

  const byPeerId = useMemo(
    () => new Map(projected.map((item) => [item.person.peerId, item])),
    [projected],
  );

  /**
   * Decide which name bubbles are readable. Labels stay glued to their avatar —
   * a bubble that drifts away from its face is worse than no bubble — so the
   * solver's job here is purely to hide the ones that would collide.
   */
  const visibleLabels = useMemo(() => {
    if (!zoomDef.showLabels) return new Set<string>();
    const placements = layoutLabels(
      singles.map((single) => ({
        id: single.id,
        anchorX: single.x,
        anchorY: single.y,
        // The collision box is the *whole node* — bubble, avatar and role line —
        // not just the name bubble. Measured on device: a node stacks to roughly
        // 96 dp tall and 136 dp wide. Testing only the bubble (the first version
        // of this) let labels sit clear of each other while their avatars piled
        // up underneath, which is what the crowd actually looks like.
        width: NODE_COLLISION_WIDTH,
        height: NODE_COLLISION_HEIGHT,
        preferredOffset: -NODE_COLLISION_HEIGHT / 2,
        priority: single.priority,
      })),
      { maxShift: 0, shiftStep: 1, padding: 4 },
    );
    return new Set(placements.filter((placement) => placement.visible).map((p) => p.id));
  }, [singles, zoomDef.showLabels]);

  /* --------------------------- render --------------------------- */

  return (
    <Pressable
      style={styles.root}
      onPress={onBackgroundPress}
      onLayout={onLayout}
      {...panResponder.panHandlers}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.mapCanvas }]} />

      {/* Everything spatial lives inside the panned layer. Controls, the filter
          bar and the status strip stay outside it and never move. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: pan.getTranslateTransform() }]}
        pointerEvents="box-none"
      >
        {size.width > 0 && satelliteCentre ? (
          <SatelliteBasemap
            centre={satelliteCentre}
            width={size.width}
            height={size.height}
            centreX={centreX}
            centreY={centreY}
            pxPerMeter={pxPerMeter}
            rotation={rotation}
          />
        ) : null}

        {/* Over imagery the grid is noise on top of noise — the roof already
            gives the eye structure. The rings stay: they are the measured axis,
            and they matter more against a real floor, not less. */}
        {size.width > 0 ? (
          <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill}>
            <MapBackdrop
              width={size.width}
              height={size.height}
              centreX={centreX}
              centreY={centreY}
              pxPerMeter={pxPerMeter}
              zoomRadius={zoomDef.radiusMeters}
              colors={colors}
              showGrid={!satelliteCentre}
              overImagery={Boolean(satelliteCentre)}
            />
            <UserMarker
              centreX={centreX}
              centreY={centreY}
              heading={orientation === 'heading_up' ? 0 : heading}
              trusted={headingTrusted}
              colors={colors}
            />
          </Svg>
        ) : null}

        {/* Zone landmarks sit behind the people layer and stay deliberately
            quiet — people are the subject of this screen, not the furniture. */}
        {projectedZones.map(({ zone, x, y }) => (
          <View
            key={zone.id}
            pointerEvents="none"
            style={[styles.zoneLabel, { left: x - ZONE_LABEL_WIDTH / 2, top: y - 14 }]}
          >
            <AppText variant="micro" style={{ color: colors.mapZoneText }} numberOfLines={1}>
              {`${zone.icon ?? '•'}  ${zone.name.toUpperCase()}`}
            </AppText>
          </View>
        ))}

        {singles.map((single) => {
          const item = byPeerId.get(single.id);
          if (!item) return null;
          const isSelected = selectedPeerId === item.person.peerId;
          return (
            <PersonNode
              key={item.person.peerId}
              person={item.person}
              x={single.x}
              y={single.y}
              selected={isSelected}
              navigating={navigatingPeerId === item.person.peerId}
              showLabel={visibleLabels.has(item.person.peerId)}
              // Someone selected pushes everyone else back, so the person you
              // are acting on is unambiguous in a crowded map.
              muted={
                (matchedPeerIds !== null && !matchedPeerIds.has(item.person.peerId)) ||
                (selectedPeerId !== null && !isSelected)
              }
              hintInfo={hintInfo}
              connection={connectionFor?.(item.person.peerId) ?? null}
              onPress={onSelect}
              onLongPress={onLongPressPerson}
              onInfo={onOpenProfile}
            />
          );
        })}

        {clusters.map((cluster) => (
          <ClusterNode
            key={cluster.id}
            id={cluster.id}
            x={cluster.x}
            y={cluster.y}
            count={cluster.count}
            dimmed={selectedPeerId !== null}
            onPress={onExpandCluster}
          />
        ))}

        <View
          pointerEvents="none"
          style={[styles.youLabel, { top: centreY + 26, left: 0, right: 0 }]}
        >
          <AppText variant="micro" tone="tertiary" style={styles.centered}>
            YOU
          </AppText>
        </View>
      </Animated.View>

      {/* Outside the panned layer on purpose — the provider's credit has to
          stay legible wherever the user drags the ground to. */}
      {satelliteCentre ? <ImageryCredit /> : null}
    </Pressable>
  );
}

export const EventMap = memo(EventMapComponent);

/* ------------------------------------------------------------------ *
 * Backdrop
 * ------------------------------------------------------------------ */

function MapBackdrop({
  width,
  height,
  centreX,
  centreY,
  pxPerMeter,
  zoomRadius,
  colors,
  showGrid = true,
  overImagery = false,
}: {
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  pxPerMeter: number;
  zoomRadius: number;
  colors: ReturnType<typeof useTheme>['colors'];
  showGrid?: boolean;
  /** Rings need more weight against photography than against a flat canvas. */
  overImagery?: boolean;
}): React.ReactElement {
  const rings = RING_METERS.filter((metres) => metres <= zoomRadius);
  const gridSpacing = 44;
  // The rings are the only measured axis on this screen. A stroke tuned to be
  // a whisper over a plain canvas disappears entirely over a satellite photo,
  // taking the distance meaning with it — so it gets heavier, not dimmer.
  const ringStroke = overImagery ? colors.textSecondary : colors.mapRing;
  const ringWidth = overImagery ? 1.5 : 1;
  // Same reasoning for the metre labels: "12 m" is the ring's whole point, and
  // a tertiary grey vanishes into a photograph of a rooftop.
  const ringLabel = overImagery ? colors.textSecondary : colors.mapZoneText;

  return (
    <G>
      {/* A faint grid gives the canvas depth without competing with people. */}
      {showGrid
        ? Array.from({ length: Math.ceil(width / gridSpacing) + 1 }, (_, i) => (
            <Line
              key={`v${i}`}
              x1={i * gridSpacing}
              y1={0}
              x2={i * gridSpacing}
              y2={height}
              stroke={colors.mapGrid}
              strokeWidth={1}
            />
          ))
        : null}
      {showGrid
        ? Array.from({ length: Math.ceil(height / gridSpacing) + 1 }, (_, i) => (
            <Line
              key={`h${i}`}
              x1={0}
              y1={i * gridSpacing}
              x2={width}
              y2={i * gridSpacing}
              stroke={colors.mapGrid}
              strokeWidth={1}
            />
          ))
        : null}

      {/* Distance rings. These are the one genuinely measured axis, so they are
          labelled with the band they represent rather than a bare number. */}
      {rings.map((metres) => (
        <G key={metres}>
          <Circle
            cx={centreX}
            cy={centreY}
            r={metres * pxPerMeter}
            stroke={ringStroke}
            strokeWidth={ringWidth}
            fill="none"
          />
          <SvgText
            x={centreX + 6}
            y={centreY - metres * pxPerMeter - 6}
            fill={ringLabel}
            fontSize={typography.mapMeta.fontSize}
          >
            {`${metres} m`}
          </SvgText>
        </G>
      ))}

      {/* The outer edge marks where our confidence runs out entirely. */}
      <Circle
        cx={centreX}
        cy={centreY}
        r={zoomRadius * pxPerMeter}
        stroke={ringStroke}
        strokeWidth={ringWidth}
        strokeDasharray="3 6"
        fill="none"
      />
    </G>
  );
}

/* ------------------------------------------------------------------ *
 * You
 * ------------------------------------------------------------------ */

function UserMarker({
  centreX,
  centreY,
  heading,
  trusted,
  colors,
}: {
  centreX: number;
  centreY: number;
  heading: number;
  trusted: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
}): React.ReactElement {
  // The cone's width is the honest part: a wide, soft wedge says "roughly this
  // way", which is all an indoor compass can promise. When the magnetometer is
  // disturbed we widen it further and drop its opacity rather than hiding it.
  const spread = trusted ? 26 : 46;
  const length = trusted ? 78 : 58;

  const toPoint = (angleDeg: number, distance: number): [number, number] => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [centreX + Math.cos(rad) * distance, centreY + Math.sin(rad) * distance];
  };

  const [leftX, leftY] = toPoint(heading - spread, length);
  const [rightX, rightY] = toPoint(heading + spread, length);

  return (
    <G>
      <Path
        d={`M ${centreX} ${centreY} L ${leftX} ${leftY} A ${length} ${length} 0 0 1 ${rightX} ${rightY} Z`}
        fill={colors.mapGlow}
        opacity={trusted ? 0.9 : 0.5}
      />
      <Circle cx={centreX} cy={centreY} r={16} fill={colors.mapGlow} />
      <Circle cx={centreX} cy={centreY} r={8} fill={colors.accent} />
      <Circle cx={centreX} cy={centreY} r={8} stroke={colors.mapCanvas} strokeWidth={2} fill="none" />
    </G>
  );
}

/* ------------------------------------------------------------------ *
 * Cluster
 * ------------------------------------------------------------------ */

const ClusterNode = memo(function ClusterNode({
  id,
  x,
  y,
  count,
  dimmed,
  onPress,
}: {
  id: string;
  x: number;
  y: number;
  count: number;
  dimmed?: boolean;
  onPress: (id: string) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const size = Math.min(44 + Math.log2(count) * 7, 74);

  return (
    <Pressable
      onPress={() => onPress(id)}
      accessibilityRole="button"
      accessibilityLabel={`${count} people here. Tap to spread them out.`}
      style={({ pressed }) => [
        styles.cluster,
        pressed && styles.clusterPressed,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.accent,
          opacity: dimmed ? 0.4 : 1,
        },
      ]}
    >
      <AppText variant="bodyStrong">{count}</AppText>
      <AppText variant="micro" tone="tertiary">
        people
      </AppText>
    </Pressable>
  );
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  cluster: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  clusterPressed: { transform: [{ scale: 0.94 }] },
  youLabel: { position: 'absolute', alignItems: 'center' },
  zoneLabel: { position: 'absolute', width: ZONE_LABEL_WIDTH, alignItems: 'center' },
  centered: { textAlign: 'center', letterSpacing: 1.4 },
});
