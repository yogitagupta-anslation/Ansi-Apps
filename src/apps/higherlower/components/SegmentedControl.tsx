import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

export interface Segment<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Pill selector used for range presets and AI difficulty. */
export default function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange(next: T): void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.track}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            style={({ pressed }) => [styles.item, selected && styles.itemSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{segment.label}</Text>
            {segment.hint ? (
              <Text style={[styles.hint, selected && styles.hintSelected]} numberOfLines={1}>
                {segment.hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  itemSelected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  labelSelected: {
    color: colors.textPrimary,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 3,
  },
  hintSelected: {
    color: colors.accent,
  },
});
