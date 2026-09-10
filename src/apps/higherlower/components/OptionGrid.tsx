import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Palette, radius, spacing, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

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
  const { colors } = useTheme();

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
              <View style={styles.titleRow}>
                {/* A tint and a border alone leave "chosen" as a colour
                    judgement. The tick makes it a fact. */}
                {selected ? <Ionicons name="checkmark-circle" size={14} color={colors.accent} /> : null}
                <Text style={[styles.title, selected && styles.titleOn]} numberOfLines={1}>
                  {option.title}
                </Text>
              </View>
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
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: spacing.xs,
  },
  cellOn: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
    borderWidth: 2,
    // Keeps the 2px border from nudging the content and reflowing the grid.
    padding: spacing.md - 1,
  },
  pressed: {
    opacity: 0.7,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  title: {
    ...type.body,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  titleOn: {
    color: colors.textPrimary,
  },
  meta: {
    ...type.numCaption,
    color: colors.textMuted,
  },
  metaOn: {
    color: colors.accent,
  },
  subtitle: {
    ...type.caption,
    color: colors.textMuted,
  },
});
