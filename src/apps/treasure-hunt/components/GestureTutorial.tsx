import React, {useEffect, useRef} from 'react';
import {Animated, Image, Pressable, StyleSheet, View} from 'react-native';

/**
 * The one-time "drag to move" coach mark, painted from the kit's tutorial card.
 *
 * The card's own text — "MOVE TO EXPLORE / Drag anywhere to move your
 * character!" — already describes how this game controls, so it is used as
 * drawn. Only the close button needs wiring: its artwork is baked into the
 * top-right corner, so a hit area sits over it.
 */

/** Native art size, and where the painted close button sits inside it. */
const CARD_RATIO = 467 / 232;
const CLOSE_CX = 440 / 467;
const CLOSE_CY = 26 / 232;
const CLOSE_SIZE = 46 / 467;

interface Props {
  visible: boolean;
  /** Width of the card in points. */
  width?: number;
  onDismiss?: () => void;
}

export function GestureTutorial({visible, width = 224, onDismiss}: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: visible ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [fade, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    // A gentle lift, so the card reads as a prompt rather than furniture.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {toValue: 1, duration: 1100, useNativeDriver: true}),
        Animated.timing(bob, {toValue: 0, duration: 1100, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, visible]);

  if (!visible) {
    return null;
  }

  const height = width / CARD_RATIO;
  const translateY = bob.interpolate({inputRange: [0, 1], outputRange: [0, -5]});
  const closeSize = width * CLOSE_SIZE;

  return (
    <Animated.View
      style={[styles.wrap, {opacity: fade, transform: [{translateY}]}]}
      pointerEvents="box-none">
      <View style={{width, height}}>
        <Image
          source={require('../assets/card-tutorial.png')}
          style={{width, height}}
          resizeMode="contain"
          fadeDuration={0}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss the movement tip"
          onPress={onDismiss}
          hitSlop={10}
          style={{
            position: 'absolute',
            left: width * CLOSE_CX - closeSize / 2,
            top: height * CLOSE_CY - closeSize / 2,
            width: closeSize,
            height: closeSize,
            borderRadius: closeSize / 2,
          }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Bottom-left: the player is pinned to the centre of the stage, so a
    // centred card would sit right on top of them.
    position: 'absolute',
    left: 12,
    bottom: 10,
  },
});
