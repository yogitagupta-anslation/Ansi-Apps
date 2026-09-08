import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface StepperProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange(next: number): void;
  disabled?: boolean;
  /** Rendered instead of the bare number — "3 / 4", say. */
  display?: string;
}

/**
 * A number picked by nudging rather than typing. Used for the room size, where
 * the whole range is seven values and a keypad would be absurd.
 */
export default function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
  disabled = false,
  display,
}: StepperProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };

  const button = (delta: -1 | 1, icon: 'remove' | 'add') => {
    const inert = disabled || (delta < 0 ? value <= min : value >= max);
    return (
      <Pressable
        onPress={() => step(delta)}
        disabled={inert}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={delta < 0 ? `Fewer ${label}` : `More ${label}`}
        style={({ pressed }) => [styles.button, pressed && !inert && styles.pressed, inert && styles.inert]}
      >
        <Ionicons name={icon} size={16} color={inert ? colors.textMuted : colors.accent} />
      </Pressable>
    );
  };

  return (
    <View style={styles.row}>
      <View style={styles.labelBlock}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.control}>
        {button(-1, 'remove')}
        <Text style={styles.value} accessibilityLabel={`${label}: ${display ?? value}`}>
          {display ?? value}
        </Text>
        {button(1, 'add')}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
  },
  labelBlock: {
    flex: 1,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
  },
  pressed: {
    opacity: 0.6,
  },
  inert: {
    backgroundColor: colors.wash,
    borderColor: colors.divider,
  },
  value: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 17,
    minWidth: 44,
    textAlign: 'center',
  },
});
