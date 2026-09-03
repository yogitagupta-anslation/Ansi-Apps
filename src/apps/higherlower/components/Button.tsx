import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

type Variant = 'primary' | 'secondary' | 'ghost' | 'success';

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
        : variant === 'ghost'
          ? colors.textSecondary
          : colors.textPrimary;

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
        pressed && !inert && styles.pressed,
        inert && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : null}
        {!busy && icon ? <Ionicons name={icon} size={18} color={tint} /> : null}
        <Text style={[styles.label, compact && styles.labelCompact, { color: tint }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    ...fonts.label,
    fontSize: 15,
  },
  labelCompact: {
    fontSize: 13,
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
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.4,
  },
});
