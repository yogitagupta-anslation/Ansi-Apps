/**
 * FilterChips.tsx
 * -----------------------------------------------------------------------------
 * Horizontal filter row. The active chip is filled, not merely tinted, so the
 * current filter is obvious at a glance rather than a subtle shade difference.
 *
 * Counts are shown inline because "Present 24" answers the question without
 * making the user apply the filter to find out.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export interface FilterOption<T extends string> {
  key: T;
  label: string;
  count?: number;
}

export function FilterChips<T extends string>({
  options,
  active,
  onChange,
}: {
  options: Array<FilterOption<T>>;
  active: T;
  onChange: (key: T) => void;
}) {
  const t = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Negative margin lets chips bleed to the screen edge while the content
      // keeps the standard gutter, so the row reads as scrollable.
      style={{ marginHorizontal: -t.screenPadding, marginBottom: t.spacing.md }}
      contentContainerStyle={{ paddingHorizontal: t.screenPadding, gap: t.spacing.sm }}>
      {options.map(option => {
        const isActive = option.key === active;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              option.label + (option.count !== undefined ? ', ' + option.count : '')
            }
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: isActive ? t.colors.primary : t.colors.surfaceRaised,
                borderColor: isActive ? t.colors.primary : t.colors.border,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.lg,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <Txt
              variant="captionMedium"
              color={isActive ? t.colors.textOnAccent : t.colors.textSecondary}>
              {option.label}
            </Txt>
            {option.count !== undefined ? (
              <View
                style={[
                  styles.count,
                  {
                    backgroundColor: isActive
                      ? 'rgba(255,255,255,0.22)'
                      : t.colors.surfaceMuted,
                    borderRadius: t.radius.pill,
                  },
                ]}>
                <Txt
                  variant="label"
                  color={isActive ? t.colors.textOnAccent : t.colors.textMuted}>
                  {option.count}
                </Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    // 38 keeps chips compact but still an easy target in a horizontal row.
    minHeight: 38,
  },
  count: { marginLeft: 6, minWidth: 22, paddingHorizontal: 6, paddingVertical: 1 },
});
