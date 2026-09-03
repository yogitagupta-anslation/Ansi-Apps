import React from 'react';
import {Image, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {alpha, radius} from '../theme';

/**
 * The kit's players panel, rebuilt as a resizable frame.
 *
 * React Native has no nine-slice on Android — `capInsets` is iOS-only — so the
 * panel was cut by hand into four fixed corners and four thin edge strips that
 * stretch along one axis each. Corners never distort; edges only ever scale in
 * the direction their detail runs.
 *
 * The art's mocked interior was erased and no centre piece is shipped, so the
 * fill below is what shows through the middle.
 */

/** Corner size in the native art, which is authored at 3x. */
const CAP_NATIVE = 28;
const CAP = CAP_NATIVE / 3;

const ART = {
  tl: require('../assets/frame-tl.png'),
  tr: require('../assets/frame-tr.png'),
  bl: require('../assets/frame-bl.png'),
  br: require('../assets/frame-br.png'),
  t: require('../assets/frame-t.png'),
  b: require('../assets/frame-b.png'),
  l: require('../assets/frame-l.png'),
  r: require('../assets/frame-r.png'),
};

interface Props {
  children?: React.ReactNode;
  /** Inset applied to the content, on top of the frame's own thickness. */
  padding?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export function PlayersFrame({children, padding = 8, style, contentStyle}: Props) {
  return (
    <View style={[styles.root, style]}>
      {/* Interior fill: the art ships no centre piece, so this stands in for
          the ground the mocked rows used to sit on. */}
      <View style={styles.fill} pointerEvents="none" />

      <View style={styles.edges} pointerEvents="none">
        {/* Each edge is a positioned View with the strip filling it. An Image
            given only `left`/`right` falls back to its intrinsic width — a
            1.3dp sliver — so the box has to come from a View. */}
        <View style={styles.top}>
          <Image source={ART.t} style={styles.stretch} resizeMode="stretch" />
        </View>
        <View style={styles.bottom}>
          <Image source={ART.b} style={styles.stretch} resizeMode="stretch" />
        </View>
        <View style={styles.left}>
          <Image source={ART.l} style={styles.stretch} resizeMode="stretch" />
        </View>
        <View style={styles.right}>
          <Image source={ART.r} style={styles.stretch} resizeMode="stretch" />
        </View>

        <Image source={ART.tl} style={[styles.corner, styles.tl]} />
        <Image source={ART.tr} style={[styles.corner, styles.tr]} />
        <Image source={ART.bl} style={[styles.corner, styles.bl]} />
        <Image source={ART.br} style={[styles.corner, styles.br]} />
      </View>

      <View style={[{flex: 1, padding: CAP / 2 + padding}, contentStyle]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: radius.lg,
    // Matches the ground colour sampled from the panel's own interior.
    backgroundColor: alpha('#000E1E', 0.74),
  },
  edges: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  corner: {
    position: 'absolute',
    width: CAP,
    height: CAP,
  },
  stretch: {
    width: '100%',
    height: '100%',
  },
  tl: {top: 0, left: 0},
  tr: {top: 0, right: 0},
  bl: {bottom: 0, left: 0},
  br: {bottom: 0, right: 0},
  top: {
    position: 'absolute',
    top: 0,
    left: CAP,
    right: CAP,
    height: CAP,
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: CAP,
    right: CAP,
    height: CAP,
  },
  left: {
    position: 'absolute',
    left: 0,
    top: CAP,
    bottom: CAP,
    width: CAP,
  },
  right: {
    position: 'absolute',
    right: 0,
    top: CAP,
    bottom: CAP,
    width: CAP,
  },
});
