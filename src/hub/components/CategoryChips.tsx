/**
 * The category filter.
 *
 * Horizontal and scrollable rather than wrapped: the row has a stable height whatever the
 * registry grows to, and a category that scrolls off is a category you can still reach.
 * Selection is hub violet, not an app accent — the chips filter every app, so none of them
 * owns the control.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Press } from './Press';
import { radius, space, typeScale as t } from '../theme';
import { useHubTheme } from '../useHubTheme';

export function CategoryChips({
  categories,
  selected,
  onSelect,
  /** Bleed into the screen's horizontal padding so the row scrolls edge to edge. */
  inset = space.lg,
}: {
  categories: string[];
  selected: string;
  onSelect(category: string): void;
  inset?: number;
}): React.ReactElement {
  const theme = useHubTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -inset }}
      contentContainerStyle={[styles.row, { paddingHorizontal: inset }]}
    >
      {categories.map((category) => {
        const on = category === selected;
        return (
          <Press
            key={category}
            onPress={() => onSelect(category)}
            scaleTo={0.94}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[
              styles.chip,
              {
                backgroundColor: on ? theme.chipOn : theme.surface,
                borderColor: on ? theme.chipOn : theme.border,
              },
            ]}
          >
            <Text style={[t.metaStrong, { color: on ? theme.chipOnText : theme.textDim }]}>
              {category}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});
