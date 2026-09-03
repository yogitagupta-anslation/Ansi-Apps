/**
 * One press behaviour for every tappable surface in the hub.
 *
 * A launcher lives or dies on how its tiles feel, and the default Pressable gives
 * you nothing: the card either navigates or it doesn't. Scaling down slightly on
 * press-in and springing back is the whole trick — it makes the tap land somewhere
 * before the screen transition takes over.
 *
 * `useNativeDriver` matters here: the transform runs on the UI thread, so the
 * animation stays smooth through the moment JS is busy mounting a whole app.
 */

import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type ViewStyle, type StyleProp } from 'react-native';

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

  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        animate(scaleTo);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        rest.onPressOut?.(event);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
