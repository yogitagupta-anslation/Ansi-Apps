/**
 * The category row.
 *
 * Only the selected chip is filled; the rest sit outlined on the page. A row where
 * every chip looks tappable-and-lit has nothing left to say about which one is
 * actually active.
 *
 * The row bleeds past the page gutter and re-applies it as content padding, so the
 * first chip lines up with the text above it while the row still scrolls off the
 * edge of the screen.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Press } from './Press';
import { layout, radius, space, touch, type, type HubPalette } from '../theme';

interface CategoryChipsProps {
  categories: string[];
  selected: string;
  onSelect(category: string): void;
  theme: HubPalette;
}

export function CategoryChips({
  categories,
  selected,
  onSelect,
  theme,
}: CategoryChipsProps): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroller}
    >
      {categories.map((category) => {
        const active = category === selected;
        return (
          <Press
            key={category}
            scaleTo={0.94}
            onPress={() => onSelect(category)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={category}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.surface,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}
          >
            <Text style={[type.chip, { color: active ? theme.onAccent : theme.textDim }]}>
              {category}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0 },
  row: { gap: space.sm, paddingHorizontal: layout.gutter },
  chip: {
    height: touch.chip,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
