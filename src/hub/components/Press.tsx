/**
 * One press behaviour for every tappable surface in the hub.
 *
 * A launcher lives or dies on how its tiles feel, and the default Pressable gives
 * you nothing: the card either navigates or it doesn't. Scaling down slightly on
 * press-in and springing back is the whole trick — it makes the tap land somewhere
 * before the screen transition takes over.
 *
 * The touch target and the animated surface are ONE node, not a Pressable wrapping an
 * Animated.View. With two nodes the caller's style lands on the inner one, so anything
 * the parent's layout drives — `flex: 1` above all — is applied to a view whose width was
 * already decided by a Pressable that never saw it. That is not a subtle difference: it
 * silently collapsed the segmented control in Settings to three circles.
 *
 * `useNativeDriver` matters here: the transform runs on the UI thread, so the
 * animation stays smooth through the moment JS is busy mounting a whole app.
 */

import React, { useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** How far to shrink. Big surfaces need less than small ones to read the same. */
  scaleTo?: number;
  children: React.ReactNode;
}

export function Press({ style, scaleTo = 0.96, children, ...rest }: PressProps): React.ReactElement {
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (to: number): void => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  const composed = useMemo(
    () => [style, { transform: [{ scale }] }],
    [style, scale],
  );

  return (
    <AnimatedPressable
      {...rest}
      style={composed}
      onPressIn={(event) => {
        animate(scaleTo);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        rest.onPressOut?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
