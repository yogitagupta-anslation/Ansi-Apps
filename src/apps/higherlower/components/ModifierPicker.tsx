import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MODIFIERS, ModifierId } from '../game/modifiers';
import { MIN_TOUCH, Palette, glyph, radius, spacing, type } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

interface ModifierPickerProps {
  active: ModifierId[];
  onToggle(id: ModifierId): void;
  /** Solo-only modifiers are shown greyed with a reason when false. */
  allowSoloOnly?: boolean;
}

/** Chips for the round's house rules. Picking any of them breaks binary search. */
export default function ModifierPicker({ active, onToggle, allowSoloOnly = true }: ModifierPickerProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.grid}>
      {MODIFIERS.map((modifier) => {
        const on = active.includes(modifier.id);
        const blocked = modifier.soloOnly && !allowSoloOnly;
        return (
          <Pressable
            key={modifier.id}
            onPress={() => !blocked && onToggle(modifier.id)}
            disabled={blocked}
            accessibilityRole="switch"
            accessibilityState={{ checked: on, disabled: blocked }}
            accessibilityLabel={`${modifier.name}. ${modifier.blurb}`}
            style={({ pressed }) => [
              styles.chip,
              on && styles.chipOn,
              blocked && styles.chipBlocked,
              pressed && !blocked && styles.pressed,
            ]}
          >
            <View style={styles.chipHead}>
              <Text style={styles.icon}>{modifier.icon}</Text>
              <Text style={[styles.name, on && styles.nameOn]}>{modifier.name}</Text>
            </View>
            <Text style={styles.blurb} numberOfLines={2}>
              {blocked ? 'Solo only — the number would differ on every phone.' : modifier.blurb}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    width: '48.5%',
    minHeight: MIN_TOUCH + spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: spacing.xs,
  },
  chipOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
    borderWidth: 2,
    padding: spacing.md - 1,
  },
  chipBlocked: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.7,
  },
  chipHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: glyph.md,
  },
  name: {
    ...type.body,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  nameOn: {
    color: colors.textPrimary,
  },
  blurb: {
    ...type.caption,
    color: colors.textMuted,
  },
});
