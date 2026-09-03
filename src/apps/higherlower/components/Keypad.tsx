import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { feedback } from '../util/feedback';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface KeypadProps {
  value: string;
  onChange(next: string): void;
  onSubmit(): void;
  /** Longest number the current range allows, e.g. 3 for 1-100. */
  maxDigits: number;
  canSubmit: boolean;
  disabled?: boolean;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Purpose-built number pad. A plain TextInput would summon the system keyboard,
 * which covers the board mid-race -- and in a game about typing digits fast, the
 * keys should be big and always visible.
 */
export default function Keypad({ value, onChange, onSubmit, maxDigits, canSubmit, disabled = false }: KeypadProps) {
  const styles = useThemedStyles(makeStyles);
  const press = (digit: string) => {
    if (disabled) return;
    feedback.tap();
    // Leading zeros carry no meaning here, so the first 0 is dropped.
    const next = value === '' && digit === '0' ? '' : value + digit;
    if (next.length > maxDigits) return;
    onChange(next);
  };

  const backspace = () => {
    if (disabled) return;
    feedback.tap();
    onChange(value.slice(0, -1));
  };

  return (
    <View style={styles.pad}>
      {DIGITS.map((digit) => (
        <Key key={digit} label={digit} onPress={() => press(digit)} disabled={disabled} />
      ))}

      <Key
        label="⌫"
        onPress={backspace}
        onLongPress={() => onChange('')}
        disabled={disabled || value.length === 0}
        muted
        accessibilityLabel="Delete digit"
      />
      <Key label="0" onPress={() => press('0')} disabled={disabled} />
      <Key
        label="submit"
        onPress={onSubmit}
        disabled={disabled || !canSubmit}
        accent
        accessibilityLabel="Submit guess"
      />
    </View>
  );
}

function Key({
  label,
  onPress,
  onLongPress,
  disabled,
  accent,
  muted,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  accent?: boolean;
  muted?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.key,
        accent && styles.keyAccent,
        pressed && !disabled && styles.keyPressed,
        disabled && styles.keyDisabled,
      ]}
    >
      {label === 'submit' ? (
        <Ionicons name="arrow-forward" size={26} color={colors.onAccent} />
      ) : (
        <Text style={[styles.keyLabel, muted && styles.keyLabelMuted]}>{label}</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  key: {
    width: '31.5%',
    aspectRatio: 1.75,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  keyAccent: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  keyPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.97 }],
  },
  keyDisabled: {
    opacity: 0.35,
  },
  keyLabel: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 26,
  },
  keyLabelMuted: {
    color: colors.textSecondary,
    fontSize: 22,
  },
});
