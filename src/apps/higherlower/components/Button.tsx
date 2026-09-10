import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MIN_TOUCH, Palette, elevation, radius, spacing, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  busy?: boolean;
  /** Smaller padding for inline/secondary rows. */
  compact?: boolean;
  style?: ViewStyle;
}

/**
 * The one button.
 *
 * Filled variants carry elevation, outlined ones do not — which is the whole
 * hierarchy: on any screen exactly one control is lifted off the page, and it is
 * the one the player came to press.
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  busy = false,
  compact = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const inert = disabled || busy;
  // Filled variants carry their own ink so the label stays readable against
  // the fill in either scheme; the flat ones inherit the page's text colors.
  const tint =
    variant === 'primary'
      ? colors.onAccent
      : variant === 'success'
        ? colors.onSuccess
        : variant === 'danger'
          ? colors.danger
          : variant === 'ghost'
            ? colors.textSecondary
            : colors.textPrimary;

  const filled = variant === 'primary' || variant === 'success';

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        styles[variant],
        // A disabled button that still floats looks pressable. Drop the shadow
        // with the opacity so "unavailable" reads at a glance, not on tapping.
        filled && !inert && elevation('raised', colors),
        pressed && !inert && styles.pressed,
        inert && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : null}
        {!busy && icon ? <Ionicons name={icon} size={compact ? 16 : 18} color={tint} /> : null}
        <Text
          numberOfLines={1}
          style={[styles.label, compact && styles.labelCompact, { color: tint }]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH + 4,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    minHeight: MIN_TOUCH,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...type.body,
  },
  labelCompact: {
    ...type.caption,
    fontFamily: type.body.fontFamily,
  },
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  success: {
    backgroundColor: colors.correct,
    borderColor: colors.correct,
  },
  secondary: {
    backgroundColor: colors.buttonSecondary,
    borderColor: colors.buttonSecondaryBorder,
  },
  danger: {
    backgroundColor: colors.dangerTint,
    borderColor: colors.dangerBorder,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.42,
  },
});
