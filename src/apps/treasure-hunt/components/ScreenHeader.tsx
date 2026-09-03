import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {HIT_SLOP, alpha, colors, radius, spacing, typography} from '../theme';
import {BackButton} from './BackButton';

interface Props {
  title: string;
  onBack?: () => void;
  /** Glyph shown on the right, e.g. a crown for the host. */
  rightGlyph?: string;
  onRightPress?: () => void;
}

/** The dark top bar: back button, centred title, optional right affordance. */
export function ScreenHeader({title, onBack, rightGlyph, onRightPress}: Props) {
  return (
    <View style={styles.bar}>
      {onBack ? (
        <BackButton onPress={onBack} />
      ) : (
        <View style={styles.spacer} />
      )}

      <Text style={[typography.screenTitle, styles.title]} numberOfLines={1}>
        {title}
      </Text>

      {rightGlyph ? (
        <Pressable
          accessibilityRole={onRightPress ? 'button' : 'text'}
          accessibilityLabel={onRightPress ? 'More' : title}
          hitSlop={HIT_SLOP}
          disabled={!onRightPress}
          onPress={onRightPress}
          style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
          <Text style={styles.rightGlyph}>{rightGlyph}</Text>
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: alpha(colors.night, 0.72),
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(colors.night, 0.85),
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  spacer: {
    width: 38,
    height: 38,
  },
  pressed: {
    opacity: 0.6,
  },
  rightGlyph: {
    fontSize: 18,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
});
