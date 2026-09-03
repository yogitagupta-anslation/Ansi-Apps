import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

export interface GridOption<T extends string> {
  value: T;
  title: string;
  subtitle?: string;
  meta?: string;
}

/**
 * Two-up selector for choices that need a line of explanation -- ranges with
 * their par, opponents with their temperament. SegmentedControl handles the
 * cases where a bare word is enough.
 */
export default function OptionGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: GridOption<T>[];
  value: T;
  onChange(next: T): void;
}) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.grid}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.title}${option.subtitle ? `. ${option.subtitle}` : ''}`}
            style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.pressed]}
          >
            <View style={styles.head}>
              <Text style={[styles.title, selected && styles.titleOn]}>{option.title}</Text>
              {option.meta ? <Text style={[styles.meta, selected && styles.metaOn]}>{option.meta}</Text> : null}
            </View>
            {option.subtitle ? (
              <Text style={styles.subtitle} numberOfLines={2}>
                {option.subtitle}
              </Text>
            ) : null}
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
  cell: {
    width: '48.5%',
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 3,
  },
  cellOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
  },
  title: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  titleOn: {
    color: colors.textPrimary,
  },
  meta: {
    ...fonts.numeric,
    color: colors.textMuted,
    fontSize: 10,
  },
  metaOn: {
    color: colors.accent,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
});
