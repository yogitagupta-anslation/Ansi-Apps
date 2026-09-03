import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet} from 'react-native';
import {colors} from '../theme';

export interface Floater {
  id: string;
  label: string;
  color: string;
}

/**
 * The little "+10" that lifts and fades when something is collected.
 *
 * Rises from just above the player and removes itself, so the feedback is
 * immediate without leaving anything on screen.
 */
export function PickupFloater({
  floater,
  onDone,
}: {
  floater: Floater;
  onDone: (id: string) => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished) {
        onDone(floater.id);
      }
    });
  }, [progress, floater.id, onDone]);

  const translateY = progress.interpolate({inputRange: [0, 1], outputRange: [0, -46]});
  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 0.7, 1],
    outputRange: [0, 1, 1, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.7, 1.15, 1],
  });

  return (
    <Animated.Text
      pointerEvents="none"
      style={[
        styles.text,
        {color: floater.color, opacity, transform: [{translateY}, {scale}]},
      ]}>
      {floater.label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0.5,
    color: colors.gold,
    textShadowColor: '#000',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 4,
  },
});
