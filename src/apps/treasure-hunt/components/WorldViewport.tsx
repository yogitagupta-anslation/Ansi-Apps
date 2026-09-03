import React, {useMemo, useRef} from 'react';
import {
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type ImageStyle,
} from 'react-native';
import type {Player} from '../models/player';
import {
  DECOR_GLYPH,
  ITEM_GLYPH,
  ObstacleKind,
  type GameWorld,
} from '../models/world';
import type {Position} from '../models/geometry';
import {RadialGlow} from './GameBackground';
import {TreasureChest} from './TreasureChest';
import {alpha, colors, playerColor} from '../theme';

interface VisibleTreasure {
  id: string;
  position: Position;
  foundBy?: string;
}

interface Props {
  world: GameWorld;
  players: Player[];
  localPlayerId: string;
  treasures: VisibleTreasure[];
  /** Viewport size in points. */
  width: number;
  height: number;
  showOtherPlayers: boolean;
  /** Points per world unit. Higher = more zoomed in. */
  zoom?: number;
  /** Continuous steering vector, or {0,0} on release. */
  onSteer?: (direction: Position) => void;
  /** Fired on the first real drag, used to dismiss the tutorial. */
  onFirstDrag?: () => void;
}

/**
 * Scenery tints, so a pond does not look like a rock.
 *
 * Everything is lit by moon rather than sun — desaturated and cool — except
 * the crystal and the lantern, which carry their own light.
 */
const SCENERY_STYLE: Record<ObstacleKind, {fill: string; edge: string; glow?: string}> = {
  [ObstacleKind.Tree]: {fill: '#1B3A24', edge: '#0E2415'},
  [ObstacleKind.Bush]: {fill: '#20452A', edge: '#122A19'},
  [ObstacleKind.Rock]: {fill: '#242B35', edge: '#161B22'},
  [ObstacleKind.Log]: {fill: '#43301F', edge: '#291D12'},
  [ObstacleKind.Pond]: {fill: '#153E5C', edge: '#0B2740'},
  [ObstacleKind.Ruin]: {fill: '#2E2E36', edge: '#1B1B21'},
  [ObstacleKind.Stump]: {fill: '#3A2A1B', edge: '#221810'},
  [ObstacleKind.Standing]: {fill: '#2B303A', edge: '#191D24'},
  [ObstacleKind.Barrel]: {fill: '#4A3421', edge: '#2B1E13'},
  [ObstacleKind.Crystal]: {fill: '#1D4E52', edge: '#0E2C30', glow: colors.crystal},
  [ObstacleKind.Lantern]: {fill: '#3B2E1A', edge: '#221A0F', glow: colors.amber},
};


/**
 * Painted art for the scenery, from the project's UI kit.
 *
 * Only these kinds were drawn; Tree, Bush, Pond and Ruin still fall back to the
 * tinted box and glyph below. `contain` keeps every sprite in proportion — the
 * boxes the generator produces are not the art's aspect ratio.
 */
/** Painted forest floor, stretched across the whole world. */
const GROUND: ImageSourcePropType = require('../assets/bg-world.png');

const OBSTACLE_ART_IMAGE: Partial<Record<ObstacleKind, ImageSourcePropType>> = {
  [ObstacleKind.Rock]: require('../assets/prop-rocks.png'),
  [ObstacleKind.Stump]: require('../assets/prop-stump.png'),
  [ObstacleKind.Barrel]: require('../assets/prop-barrel.png'),
  [ObstacleKind.Lantern]: require('../assets/prop-lantern.png'),
  [ObstacleKind.Crystal]: require('../assets/prop-crystal.png'),
  [ObstacleKind.Standing]: require('../assets/prop-standing.png'),
  [ObstacleKind.Log]: require('../assets/prop-mushrooms.png'),
};

/** Drag beyond this many points counts as full speed. */
const DRAG_FULL_SCALE = 70;
/** Below this the touch is treated as a tap, not a steer. */
const DRAG_DEAD_ZONE = 8;

/**
 * A camera onto the virtual world.
 *
 * Unlike a fit-the-whole-world view, this renders a window that follows the
 * player, so the world fills whatever aspect ratio it is given -- which is what
 * makes a landscape layout show MORE of the world rather than less.
 *
 * Movement is a hidden joystick: wherever the finger lands becomes the origin,
 * and the offset from it steers continuously until release. Nothing is drawn
 * for it, so no controls cover the world.
 */
export function WorldViewport({
  world,
  players,
  localPlayerId,
  treasures,
  width,
  height,
  showOtherPlayers,
  zoom = 9,
  onSteer,
  onFirstDrag,
}: Props) {
  const local = players.find(player => player.id === localPlayerId);

  // Camera centres on the player, clamped so it never shows past the edges.
  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const camX = local
    ? Math.min(Math.max(local.position.x, halfW), Math.max(halfW, world.size.width - halfW))
    : world.size.width / 2;
  const camY = local
    ? Math.min(Math.max(local.position.y, halfH), Math.max(halfH, world.size.height - halfH))
    : world.size.height / 2;

  /** World point -> screen point. */
  const sx = (x: number) => (x - camX) * zoom + width / 2;
  const sy = (y: number) => (y - camY) * zoom + height / 2;

  // Only draw what the camera can actually see.
  const pad = 4;
  const visible = useMemo(() => {
    const left = camX - halfW - pad;
    const right = camX + halfW + pad;
    const top = camY - halfH - pad;
    const bottom = camY + halfH + pad;
    const inView = (p: Position) =>
      p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;

    return {
      obstacles: world.obstacles.filter(
        o =>
          o.bounds.x + o.bounds.width >= left &&
          o.bounds.x <= right &&
          o.bounds.y + o.bounds.height >= top &&
          o.bounds.y <= bottom,
      ),
      decor: world.decor.filter(d => inView(d.position)),
      items: world.items.filter(i => !i.collectedBy && inView(i.position)),
    };
  }, [world, camX, camY, halfW, halfH]);

  // Steering handlers live in refs so the responder is created exactly once.
  const steerRef = useRef<(dx: number, dy: number) => void>(() => undefined);
  const draggedRef = useRef(false);
  steerRef.current = (dx, dy) => {
    if (!onSteer) {
      return;
    }
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < DRAG_DEAD_ZONE) {
      onSteer({x: 0, y: 0});
      return;
    }
    if (!draggedRef.current) {
      draggedRef.current = true;
      onFirstDrag?.();
    }
    // Distance from the touch origin scales speed, up to full tilt.
    const strength = Math.min(1, magnitude / DRAG_FULL_SCALE);
    onSteer({x: (dx / magnitude) * strength, y: (dy / magnitude) * strength});
  };

  const stopRef = useRef<() => void>(() => undefined);
  stopRef.current = () => onSteer?.({x: 0, y: 0});

  const enabledRef = useRef(Boolean(onSteer));
  enabledRef.current = Boolean(onSteer);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => enabledRef.current,
      onMoveShouldSetPanResponder: () => enabledRef.current,
      onPanResponderMove: (_e, g) => steerRef.current(g.dx, g.dy),
      onPanResponderRelease: () => stopRef.current(),
      onPanResponderTerminate: () => stopRef.current(),
    }),
  ).current;

  const others = showOtherPlayers
    ? players.filter(player => player.id !== localPlayerId)
    : [];

  // Grass tiles, drawn one world-unit grid step at a time.
  const tile = 10 * zoom;
  const startTileX = Math.floor((camX - halfW) / 10) * 10;
  const startTileY = Math.floor((camY - halfH) / 10) * 10;
  const tilesX = Math.ceil(width / tile) + 2;
  const tilesY = Math.ceil(height / tile) + 2;

  // Terrain is clipped to the world: beyond its edges is void, not more grass,
  // so the boundary of the playable area is always obvious.
  const tiles: React.ReactNode[] = [];
  for (let row = 0; row < tilesY; row++) {
    for (let col = 0; col < tilesX; col++) {
      const wx = startTileX + col * 10;
      const wy = startTileY + row * 10;
      if (wx >= world.size.width || wy >= world.size.height || wx < -10 || wy < -10) {
        continue;
      }
      const left = Math.max(wx, 0);
      const top = Math.max(wy, 0);
      const right = Math.min(wx + 10, world.size.width);
      const bottom = Math.min(wy + 10, world.size.height);
      if (right <= left || bottom <= top) {
        continue;
      }
      const shade = (Math.floor(wx / 10) + Math.floor(wy / 10)) % 2 === 0;
      tiles.push(
        <View
          key={`t${wx}-${wy}`}
          style={[
            styles.tile,
            {
              left: sx(left),
              top: sy(top),
              width: (right - left) * zoom + 0.5,
              height: (bottom - top) * zoom + 0.5,
              backgroundColor: shade ? colors.grass : colors.grassDark,
            },
          ]}
        />,
      );
    }
  }

  return (
    <View
      accessibilityLabel="Virtual world. Drag anywhere to move your hunter."
      style={[styles.viewport, {width, height}]}
      {...responder.panHandlers}>
      {tiles}

      {/*
        * Painted ground from the theme sheet, laid over the tint tiles and
        * clipped to the world. It is stretched once across the whole world
        * rather than tiled, so nothing repeats as the camera pans; the tiles
        * underneath still supply the colour where it is translucent.
        */}
      <Image
        source={GROUND}
        style={{
          position: 'absolute',
          left: sx(0),
          top: sy(0),
          width: world.size.width * zoom,
          height: world.size.height * zoom,
          opacity: 0.92,
          pointerEvents: 'none',
        } as ImageStyle}
        resizeMode="cover"
        fadeDuration={0}
      />

      {/* The edge of the playable world. */}
      <View
        pointerEvents="none"
        style={[
          styles.worldEdge,
          {
            left: sx(0),
            top: sy(0),
            width: world.size.width * zoom,
            height: world.size.height * zoom,
          },
        ]}
      />

      {/* Flowers, grass tufts and pebbles -- purely visual. */}
      {visible.decor.map(item => (
        <Text
          key={item.id}
          style={[
            styles.decor,
            {
              left: sx(item.position.x) - 8,
              top: sy(item.position.y) - 8,
              fontSize: 13 * item.scale,
            },
          ]}>
          {DECOR_GLYPH[item.kind]}
        </Text>
      ))}

      {/* Solid scenery. */}
      {visible.obstacles.map(obstacle => {
        const tint = SCENERY_STYLE[obstacle.kind];
        const w = obstacle.bounds.width * zoom;
        const h = obstacle.bounds.height * zoom;
        const left = sx(obstacle.bounds.x);
        const top = sy(obstacle.bounds.y);
        const art = OBSTACLE_ART_IMAGE[obstacle.kind];
        return (
          <React.Fragment key={obstacle.id}>
            {/* Crystals and lanterns cast light onto the ground around them. */}
            {tint.glow ? (
              <RadialGlow
                color={tint.glow}
                size={Math.max(w, h) * 3.2}
                rings={8}
                step={0.05}
                style={{
                  position: 'absolute',
                  left: left + w / 2 - Math.max(w, h) * 1.6,
                  top: top + h / 2 - Math.max(w, h) * 1.6,
                }}
              />
            ) : null}
          {art ? (
            // Painted prop: no plate behind it, so its transparency reads
            // straight onto the grass.
            <Image
              source={art}
              style={{
                position: 'absolute',
                left,
                // Props are drawn standing on their base, so lift the sprite to
                // let it overhang the top of its collision box.
                top: top - h * 0.45,
                width: w,
                height: h * 1.45,
              }}
              resizeMode="contain"
              fadeDuration={0}
            />
          ) : (
            <View
              style={[
                styles.obstacle,
                {
                  left,
                  top,
                  width: w,
                  height: h,
                },
                // A pond is water, so it keeps a filled body. The rest are
                // plants: a ground shadow and the glyph, with no plate, so
                // they sit beside the painted props rather than on cards.
                obstacle.kind === ObstacleKind.Pond
                  ? {
                      backgroundColor: tint.fill,
                      borderColor: tint.edge,
                      borderWidth: 2,
                      borderRadius: Math.min(w, h) / 2,
                    }
                  : null,
              ]}>
              {obstacle.kind !== ObstacleKind.Pond ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    bottom: h * 0.06,
                    width: w * 0.72,
                    height: h * 0.2,
                    borderRadius: w * 0.36,
                    backgroundColor: colors.abyss,
                    opacity: 0.35,
                  }}
                />
              ) : null}
              {w >= 20 && h >= 20 ? (
                <Text
                  style={{
                    fontSize: Math.min(w, h) * (
                      obstacle.kind === ObstacleKind.Pond ? 0.5 : 0.92
                    ),
                    opacity: obstacle.kind === ObstacleKind.Pond ? 0.62 : 0.9,
                  }}
                  allowFontScaling={false}>
                  {OBSTACLE_ART[obstacle.kind]}
                </Text>
              ) : null}
            </View>
          )}
          </React.Fragment>
        );
      })}

      {/* Collectibles. */}
      {visible.items.map(item => (
        <Text
          key={item.id}
          style={[
            styles.item,
            {left: sx(item.position.x) - 11, top: sy(item.position.y) - 11},
          ]}>
          {ITEM_GLYPH[item.kind]}
        </Text>
      ))}

      {/* Treasure -- only ever present once the engine has revealed it. */}
      {treasures.map(treasure => (
        <View
          key={treasure.id}
          pointerEvents="none"
          style={[
            styles.treasure,
            {left: sx(treasure.position.x) - 26, top: sy(treasure.position.y) - 26},
          ]}>
          <View style={styles.treasureHalo} />
          <TreasureChest size={56} grounded dimmed={Boolean(treasure.foundBy)} />
        </View>
      ))}

      {/* Rival hunters. */}
      {others.map((player, index) => {
        const ring = playerColor(index + 1);
        return (
          <View
            key={player.id}
            pointerEvents="none"
            style={[
              styles.rival,
              {left: sx(player.position.x) - 26, top: sy(player.position.y) - 26},
            ]}>
            <View style={[styles.rivalRing, {borderColor: ring}]}>
              <Text style={styles.rivalGlyph}>{player.avatar}</Text>
            </View>
            <Text style={[styles.rivalName, {color: ring}]} numberOfLines={1}>
              {player.name}
            </Text>
          </View>
        );
      })}

      {/* You. Always the most legible thing on screen. */}
      {local ? (
        <View
          pointerEvents="none"
          style={[
            styles.you,
            {left: sx(local.position.x) - 34, top: sy(local.position.y) - 34},
          ]}>
          <View style={styles.youGlow} />
          <View style={styles.youRing}>
            <Text style={styles.youGlyph}>{local.avatar}</Text>
          </View>
          <Text style={styles.youLabel}>YOU</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Slightly richer art than the plain model glyphs. */
const OBSTACLE_ART: Record<ObstacleKind, string> = {
  [ObstacleKind.Tree]: '🌲',
  [ObstacleKind.Bush]: '🌳',
  [ObstacleKind.Rock]: '🪨',
  [ObstacleKind.Log]: '🪵',
  [ObstacleKind.Pond]: '💧',
  [ObstacleKind.Ruin]: '🏛',
  [ObstacleKind.Stump]: '🪵',
  [ObstacleKind.Standing]: '🗿',
  [ObstacleKind.Barrel]: '🛢',
  [ObstacleKind.Crystal]: '💎',
  [ObstacleKind.Lantern]: '🏮',
};

const styles = StyleSheet.create({
  viewport: {
    overflow: 'hidden',
    // Beyond the world edge; deliberately not grass.
    backgroundColor: colors.outOfBounds,
    position: 'relative',
  },
  worldEdge: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: alpha('#0A2A16', 0.9),
    borderRadius: 4,
  },
  tile: {
    position: 'absolute',
  },
  decor: {
    position: 'absolute',
    opacity: 0.9,
  },
  obstacle: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    position: 'absolute',
    fontSize: 20,
    width: 22,
    height: 22,
    textAlign: 'center',
  },
  treasure: {
    position: 'absolute',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treasureHalo: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: alpha(colors.gold, 0.45),
  },
  rival: {
    position: 'absolute',
    width: 52,
    alignItems: 'center',
  },
  rivalRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha('#000000', 0.35),
  },
  rivalGlyph: {
    fontSize: 17,
  },
  rivalName: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 2,
  },
  you: {
    position: 'absolute',
    width: 68,
    alignItems: 'center',
  },
  youGlow: {
    position: 'absolute',
    top: 2,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: alpha(colors.cyan, 0.3),
  },
  youRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: colors.text,
    backgroundColor: alpha(colors.blue, 0.75),
    alignItems: 'center',
    justifyContent: 'center',
  },
  youGlyph: {
    fontSize: 21,
  },
  youLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: colors.text,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
});
