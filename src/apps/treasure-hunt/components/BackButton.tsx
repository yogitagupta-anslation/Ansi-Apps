import React from 'react';
import {Image, Pressable, StyleSheet, type StyleProp, type ViewStyle} from 'react-native';
import {HIT_SLOP} from '../theme';

/**
 * The kit's round back button.
 *
 * Every screen that can be left uses this, so the affordance is identical
 * wherever it appears. The artwork is 89x90, close enough to square that it is
 * rendered square.
 */
export function BackButton({
  onPress,
  size = 36,
  label = 'Go back',
  style,
}: {
  onPress: () => void;
  size?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={({pressed}) => [pressed && styles.pressed, style]}>
      <Image
        source={require('../assets/btn-back.png')}
        style={{width: size, height: size}}
        resizeMode="contain"
        fadeDuration={0}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.65,
    transform: [{scale: 0.94}],
  },
});
