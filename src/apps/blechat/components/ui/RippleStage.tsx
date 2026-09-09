import React, {useEffect, useRef} from 'react';
import {Animated, Easing, View} from 'react-native';

import {Mascot} from './Mascot';
import {useReduceMotion} from '../Motion';
import {makeStyles, useTheme} from '../../theme/ThemeProvider';

/**
 * The mascot inside two travelling rings.
 *
 * Two rather than one, offset by half the cycle, because a single ripple reads as a pulse
 * — something throbbing in place — where two read as something leaving. That is the whole
 * idea being illustrated: a radio reaching outwards.
 *
 * Shared between the opening screen and the tour, which show the same thing for the same
 * reason. Under reduce-motion the rings hold still at their resting size rather than
 * disappearing, so the composition does not collapse.
 */
export function RippleStage({
  size = 168,
  /** The still ring inside the travelling ones, at this inset. */
  innerInset,
}: {
  size?: number;
  innerInset?: number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const reduced = useReduceMotion();

  const first = useRef(new Animated.Value(0)).current;
  const second = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      return;
    }
    const ring = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: 2800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {toValue: 0, duration: 0, useNativeDriver: true}),
        ]),
      );
    const a = ring(first, 0);
    const b = ring(second, 1400);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [first, second, reduced]);

  const ripple = (value: Animated.Value) => ({
    transform: [
      {scale: value.interpolate({inputRange: [0, 1], outputRange: [0.72, 1.5]})},
    ],
    opacity: value.interpolate({inputRange: [0, 1], outputRange: [0.38, 0]}),
  });

  const inset = innerInset ?? Math.round(size * 0.25);

  return (
    <View style={[styles.stage, {width: size, height: size}]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2, borderColor: theme.accent},
          ripple(first),
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2, borderColor: theme.accent},
          ripple(second),
        ]}
      />
      {/* The still ring: a fixed reference the travelling ones pass through, without
          which they have nothing to be measured against. */}
      <View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            top: inset,
            left: inset,
            width: size - inset * 2,
            height: size - inset * 2,
            borderRadius: (size - inset * 2) / 2,
            borderColor: theme.divider,
          },
        ]}
      />
      <Mascot size={Math.round(size * 0.51)} tint={theme.accent} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  stage: {alignItems: 'center', justifyContent: 'center'},
  ring: {position: 'absolute', borderWidth: 1},
}));
