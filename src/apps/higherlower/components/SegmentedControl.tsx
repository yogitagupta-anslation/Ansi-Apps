import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TOUCH, Palette, radius, spacing, type } from '../theme/tokens';
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
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  // Two channels, not one: the chosen segment changes fill AND border weight,
  // so the selection survives a screenshot in greyscale.
  itemSelected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    ...type.body,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.textPrimary,
  },
  hint: {
    ...type.micro,
    fontFamily: type.caption.fontFamily,
    letterSpacing: 0,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  hintSelected: {
    color: colors.accent,
  },
});
