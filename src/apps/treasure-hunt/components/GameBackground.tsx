import React, {useEffect, useMemo, useRef} from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type DimensionValue,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {alpha, colors} from '../theme';

export type BackgroundVariant =
  | 'gameplay'
  | 'lobby'
  | 'popup'
  | 'inventory'
  | 'loading'
  | 'results'
  | 'map';

interface Props {
  variant?: BackgroundVariant;
  /**
   * Draw only the atmosphere — fog, fireflies and vignette — with a
   * transparent ground, so it can sit *above* the live world without hiding
   * it. Never blocks touches.
   */
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

interface Recipe {
  /** Sky gradient bands, top to bottom. */
  sky: readonly string[];
  /** Show the moon and its halo. */
  moon: boolean;
  /** Layered tree silhouettes along the bottom. */
  canopy: boolean;
  /** Stone arches down each side, for the results chamber. */
  arches: boolean;
  /** Warm lantern pools. */
  lanterns: number;
  /** Cold crystal glows. */
  crystals: number;
  /** Drifting fireflies. */
  fireflies: number;
  /** Strength of the outer vignette. */
  vignette: number;
}

/**
 * Every variant is the same world under different light. Keeping one recipe
 * table means a change to the palette moves all seven together, and no screen
 * can drift into looking like a different app.
 */
const RECIPES: Record<BackgroundVariant, Recipe> = {
  gameplay: {
    sky: ['#0A1420', '#0C1A26', '#0A1C1A'],
    moon: false,
    canopy: true,
    arches: false,
    lanterns: 2,
    crystals: 2,
    fireflies: 7,
    vignette: 0.55,
  },
  lobby: {
    sky: ['#0A1024', '#141B3C', '#0E1730'],
    moon: true,
    canopy: true,
    arches: false,
    lanterns: 2,
    crystals: 3,
    fireflies: 9,
    vignette: 0.6,
  },
  loading: {
    sky: ['#080D1C', '#101838', '#0B1226'],
    moon: true,
    canopy: true,
    arches: false,
    lanterns: 3,
    crystals: 2,
    fireflies: 11,
    vignette: 0.65,
  },
  results: {
    sky: ['#0B0A14', '#171021', '#0D0B16'],
    moon: false,
    canopy: false,
    arches: true,
    lanterns: 4,
    crystals: 1,
    fireflies: 5,
    vignette: 0.72,
  },
  inventory: {
    sky: ['#080D1A', '#0F1730', '#0A1122'],
    moon: false,
    canopy: true,
    arches: false,
    lanterns: 1,
    crystals: 3,
    fireflies: 6,
    vignette: 0.68,
  },
  popup: {
    sky: ['#05080F', '#080D1A', '#05080F'],
    moon: false,
    canopy: false,
    arches: false,
    lanterns: 0,
    crystals: 1,
    fireflies: 4,
    vignette: 0.8,
  },
  map: {
    sky: ['#081426', '#0D2036', '#091A2A'],
    moon: true,
    canopy: false,
    arches: false,
    lanterns: 1,
    crystals: 4,
    fireflies: 8,
    vignette: 0.55,
  },
};

/** Fixed placements, so the scene never reshuffles between renders. */
const LANTERN_SPOTS = [
  {left: '6%', bottom: '14%', size: 150},
  {left: '86%', bottom: '20%', size: 130},
  {left: '30%', bottom: '6%', size: 110},
  {left: '64%', bottom: '10%', size: 120},
] as const;

const CRYSTAL_SPOTS = [
  {left: '18%', bottom: '26%', size: 120},
  {left: '74%', bottom: '34%', size: 100},
  {left: '46%', bottom: '18%', size: 90},
  {left: '90%', bottom: '48%', size: 80},
] as const;

const FIREFLY_SPOTS = [
  {left: '12%', top: '28%', delay: 0},
  {left: '28%', top: '52%', delay: 700},
  {left: '41%', top: '20%', delay: 1400},
  {left: '55%', top: '62%', delay: 400},
  {left: '68%', top: '34%', delay: 1100},
  {left: '79%', top: '58%', delay: 1800},
  {left: '88%', top: '26%', delay: 300},
  {left: '22%', top: '70%', delay: 1600},
  {left: '60%', top: '14%', delay: 900},
  {left: '35%', top: '80%', delay: 2100},
  {left: '92%', top: '70%', delay: 500},
] as const;

/** A single drifting, breathing mote of light. */
function Firefly({
  left,
  top,
  delay,
}: {
  left: string;
  top: string;
  delay: number;
}) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(drift, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, delay]);

  const translateY = drift.interpolate({inputRange: [0, 1], outputRange: [0, -22]});
  const translateX = drift.interpolate({inputRange: [0, 1], outputRange: [0, 14]});
  const opacity = drift.interpolate({
    inputRange: [0, 0.4, 0.6, 1],
    outputRange: [0.15, 0.9, 0.9, 0.15],
  });

  return (
    <Animated.View
      style={[
        styles.firefly,
        {left, top, opacity, transform: [{translateX}, {translateY}]} as never,
      ]}
    />
  );
}

/** A warm light pool, as from a hanging lantern just out of frame. */

/**
 * A soft radial glow, stacked from concentric circles.
 *
 * A single translucent disc reads as a flat coin. Nesting rings lets the alpha
 * accumulate toward the middle, which is close enough to a real radial falloff
 * that the eye reads it as light rather than a shape.
 */
export function RadialGlow({
  color,
  size,
  rings = 7,
  /** Alpha contributed by each ring; the centre accumulates them. */
  step = 0.035,
  style,
}: {
  color: string;
  size: number;
  rings?: number;
  step?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={[styles.glowHost, {width: size, height: size}, style]}>
      {Array.from({length: rings}, (_, i) => {
        // Largest ring first, each one tighter than the last.
        const t = rings > 1 ? i / (rings - 1) : 1;
        const scale = 1 - t * 0.82;
        const d = size * scale;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: d,
              height: d,
              borderRadius: d / 2,
              backgroundColor: color,
              // Taper the outermost rings, or the widest circle leaves a
              // visible hard edge against a dark ground.
              opacity: step * (0.2 + 0.8 * t),
            }}
          />
        );
      })}
    </View>
  );
}

function LanternGlow({
  left,
  bottom,
  size,
  index,
}: {
  left: string;
  bottom: string;
  size: number;
  index: number;
}) {
  const flicker = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 260),
        Animated.timing(flicker, {
          toValue: 1,
          duration: 1500 + index * 180,
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0,
          duration: 1500 + index * 180,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flicker, index]);

  const opacity = flicker.interpolate({inputRange: [0, 1], outputRange: [0.16, 0.34]});
  const scale = flicker.interpolate({inputRange: [0, 1], outputRange: [0.94, 1.06]});

  return (
    <Animated.View
      style={[styles.glow, {left, bottom, opacity, transform: [{scale}]} as never]}>
      <RadialGlow color={colors.amber} size={size} step={0.05} />
    </Animated.View>
  );
}

/** A cold arcane glow, as from a crystal outcrop. */
function CrystalGlow({
  left,
  bottom,
  size,
  index,
}: {
  left: string;
  bottom: string;
  size: number;
  index: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 400),
        Animated.timing(pulse, {toValue: 1, duration: 2200, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0, duration: 2200, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, index]);

  const opacity = pulse.interpolate({inputRange: [0, 1], outputRange: [0.55, 1]});

  return (
    <Animated.View style={[styles.glow, {left, bottom, opacity} as never]}>
      <RadialGlow color={colors.cyan} size={size} step={0.035} />
    </Animated.View>
  );
}


/**
 * A soft edge fade, built from stacked bands.
 *
 * React Native has no gradient primitive without a native dependency, and a
 * single translucent rectangle reads as a hard band. Eight steps with eased
 * opacity is indistinguishable from a real gradient at this scale.
 */
function EdgeFade({
  edge,
  extent,
  strength,
  color = colors.abyss,
  steps = 8,
}: {
  edge: 'top' | 'bottom' | 'left' | 'right';
  /** Percentage of the axis the fade covers. */
  extent: number;
  strength: number;
  color?: string;
  steps?: number;
}) {
  const vertical = edge === 'top' || edge === 'bottom';
  return (
    <View pointerEvents="none" style={[styles.fadeHost, edgeAnchor[edge]]}>
      {Array.from({length: steps}, (_, i) => {
        // Densest at the screen edge, clear by the inner end.
        const t = i / (steps - 1);
        const opacity = strength * Math.pow(1 - t, 1.7);
        const size = `${extent / steps}%` as DimensionValue;
        return (
          <View
            key={i}
            style={[
              {backgroundColor: color, opacity},
              vertical ? {height: size, width: '100%'} : {width: size, height: '100%'},
            ]}
          />
        );
      })}
    </View>
  );
}

const edgeAnchor = {
  top: {top: 0, left: 0, right: 0, flexDirection: 'column'},
  bottom: {bottom: 0, left: 0, right: 0, flexDirection: 'column-reverse'},
  left: {top: 0, bottom: 0, left: 0, flexDirection: 'row'},
  right: {top: 0, bottom: 0, right: 0, flexDirection: 'row-reverse'},
} as const;



/**
 * Painted backdrops from the project's theme sheet.
 *
 * Where a variant has art it is the backdrop; the procedural sky, moon and
 * treeline below only run for variants without one (and for `overlay`, which
 * must stay transparent). Fog, glows and fireflies still draw on top of the
 * art, so every variant keeps the same living atmosphere.
 */
const SCENE: Partial<Record<BackgroundVariant, ImageSourcePropType>> = {
  lobby: require('../assets/bg-lobby.png'),
  popup: require('../assets/bg-lobby.png'),
  inventory: require('../assets/bg-lobby.png'),
  loading: require('../assets/bg-loading.png'),
  map: require('../assets/bg-map.png'),
  results: require('../assets/bg-results.png'),
};

/** Blend two hex colours. Used to smooth the sky between its stops. */
function mix(from: string, to: string, t: number): string {
  const parse = (hex: string) => {
    const c = hex.replace('#', '');
    return [
      parseInt(c.slice(0, 2), 16),
      parseInt(c.slice(2, 4), 16),
      parseInt(c.slice(4, 6), 16),
    ] as const;
  };
  const a = parse(from);
  const b = parse(to);
  const channel = (i: number) =>
    Math.round(a[i]! + (b[i]! - a[i]!) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Expand a handful of sky stops into enough bands that no seam is visible. */
function skyBands(stops: readonly string[], count = 28): string[] {
  if (stops.length < 2) {
    return Array.from({length: count}, () => stops[0] ?? '#000000');
  }
  const spans = stops.length - 1;
  return Array.from({length: count}, (_, i) => {
    const pos = (i / (count - 1)) * spans;
    const idx = Math.min(spans - 1, Math.floor(pos));
    return mix(stops[idx]!, stops[idx + 1]!, pos - idx);
  });
}


/**
 * A conifer silhouette: three stacked triangles over a trunk.
 *
 * Triangles come from the classic transparent-border trick — React Native has
 * no polygon primitive, and pulling in react-native-svg for six background
 * trees is not worth the native dependency.
 */
function Conifer({
  left,
  width,
  height,
  tint,
  bottom,
}: {
  left: string;
  width: number;
  height: number;
  tint: string;
  bottom: number;
}) {
  const tiers = [0.52, 0.68, 0.86];
  return (
    <View
      pointerEvents="none"
      style={[styles.tree, {left, width, height, bottom} as never]}>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          alignSelf: 'center',
          width: Math.max(4, width * 0.11),
          height: height * 0.24,
          backgroundColor: tint,
        }}
      />
      {tiers.map((spread, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            bottom: height * (0.16 + i * 0.2),
            alignSelf: 'center',
            width: 0,
            height: 0,
            borderLeftWidth: (width * spread) / 2,
            borderRightWidth: (width * spread) / 2,
            borderBottomWidth: height * 0.42,
            borderLeftColor: colors.transparent,
            borderRightColor: colors.transparent,
            borderBottomColor: tint,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The shared dark-fantasy backdrop.
 *
 * Built from layered views rather than a bitmap so it scales to any screen
 * without stretching, costs nothing to ship, and stays readable behind text.
 * When the painted background plates are available they can be dropped in as an
 * <Image> beneath these layers -- the glow, fog and firefly passes on top are
 * what give it depth either way.
 */
export function GameBackground({
  variant = 'lobby',
  overlay = false,
  style,
  children,
}: Props) {
  const recipe = RECIPES[variant];
  const sky = useMemo(() => skyBands(recipe.sky), [recipe.sky]);
  const scene = overlay ? undefined : SCENE[variant];

  const canopy = useMemo(
    () =>
      [
        // Bases sit on the floor; the bottom vignette swallows their feet,
        // which is exactly how a treeline reads at night.
        {left: '-5%', width: 170, height: 215, tint: '#0A1710', bottom: -18},
        {left: '9%', width: 130, height: 165, tint: '#10241A', bottom: -10},
        {left: '23%', width: 108, height: 135, tint: '#0C1C14', bottom: -8},
        {left: '61%', width: 122, height: 155, tint: '#10241A', bottom: -10},
        {left: '77%', width: 158, height: 200, tint: '#0A1710', bottom: -16},
        {left: '91%', width: 136, height: 172, tint: '#0C1C14', bottom: -12},
      ] as const,
    [],
  );

  return (
    <View
      style={[styles.root, overlay && styles.overlayRoot, style]}
      pointerEvents={overlay ? 'none' : 'auto'}>
      {/* Sky bands, painted darkest at the edges. */}
      {scene ? (
        <Image
          source={scene}
          style={styles.scene}
          resizeMode="cover"
          fadeDuration={0}
        />
      ) : null}

      {!overlay &&
        !scene &&
        sky.map((tone, index) => (
        <View
          key={tone + index}
          style={[
            styles.band,
            {
              backgroundColor: tone,
              top: `${(index * 100) / sky.length}%`,
              height: `${100 / sky.length + 0.6}%`,
            } as never,
          ]}
        />
        ))}

      {recipe.moon && !overlay && !scene ? (
        <View pointerEvents="none" style={styles.moonHost}>
          <RadialGlow color={colors.moon} size={190} rings={9} step={0.028} />
          <View style={styles.moon} />
        </View>
      ) : null}

      {/* Stone arches, for the treasure chamber. */}
      {recipe.arches && !overlay && !scene ? (
        <>
          <View style={[styles.arch, styles.archLeft]} />
          <View style={[styles.arch, styles.archRight]} />
          <View style={styles.chamberFloor} />
        </>
      ) : null}

      {/* Distant tree line. */}
      {recipe.canopy && !overlay && !scene
        ? canopy.map((tree, index) => <Conifer key={index} {...tree} />)
        : null}

      {/* Light sources. */}
      {LANTERN_SPOTS.slice(0, recipe.lanterns).map((spot, index) => (
        <LanternGlow key={`l${index}`} {...spot} index={index} />
      ))}
      {CRYSTAL_SPOTS.slice(0, recipe.crystals).map((spot, index) => (
        <CrystalGlow key={`c${index}`} {...spot} index={index} />
      ))}

      {/* Low fog, then fireflies above it. */}
      <EdgeFade edge="bottom" extent={34} strength={0.16} color={colors.moon} steps={7} />
      {FIREFLY_SPOTS.slice(0, recipe.fireflies).map((spot, index) => (
        <Firefly key={`f${index}`} {...spot} />
      ))}

      {/* Vignette: graded on all four edges so the frame darkens smoothly. */}
      <EdgeFade edge="top" extent={26} strength={recipe.vignette} />
      <EdgeFade edge="bottom" extent={30} strength={recipe.vignette} />
      <EdgeFade edge="left" extent={22} strength={recipe.vignette * 0.85} />
      <EdgeFade edge="right" extent={22} strength={recipe.vignette * 0.85} />

      {children}
    </View>
  );
}

const fill = {position: 'absolute', left: 0, right: 0} as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.abyss,
    overflow: 'hidden',
  },
  band: {
    ...fill,
  },
  scene: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: undefined,
    height: undefined,
  },
  moonHost: {
    position: 'absolute',
    // High and tight into the corner, so panels do not sit on top of it.
    top: '2%',
    right: '5%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moon: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.moon,
    opacity: 0.6,
  },
  tree: {
    position: 'absolute',
  },
  arch: {
    position: 'absolute',
    top: '-6%',
    width: '20%',
    height: '112%',
    backgroundColor: '#120E1B',
    borderColor: alpha(colors.stoneDark, 0.9),
  },
  archLeft: {
    left: 0,
    borderRightWidth: 3,
    borderTopRightRadius: 90,
  },
  archRight: {
    right: 0,
    borderLeftWidth: 3,
    borderTopLeftRadius: 90,
  },
  chamberFloor: {
    ...fill,
    bottom: 0,
    height: '22%',
    backgroundColor: alpha('#1A1426', 0.85),
  },
  glow: {
    position: 'absolute',
  },
  glowHost: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayRoot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.transparent,
  },
  fadeHost: {
    position: 'absolute',
  },
  firefly: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.goldBright,
  },
});
