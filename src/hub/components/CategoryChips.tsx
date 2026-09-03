/**
 * The category row.
 *
 * Only the selected chip is filled; the rest sit flat on the background. A row
 * where every chip looks tappable-and-lit has nothing left to say about which one
 * is actually active.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Press } from './Press';
import { radius, space, type HubPalette } from '../theme';

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
      // The row is inside a vertical ScrollView; without this the chips clip
      // against the parent's padding instead of running to the screen edge.
      style={styles.scroller}
    >
      {categories.map((category) => {
        const active = category === selected;
        return (
          <Press
            key={category}
            scaleTo={0.93}
            onPress={() => onSelect(category)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? theme.accent : theme.surface,
                borderColor: active ? theme.accent : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                { color: active ? '#FFFFFF' : theme.textDim },
              ]}
            >
              {category}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, marginHorizontal: -space.xl },
  row: { gap: space.sm, paddingHorizontal: space.xl },
  chip: {
    height: 34,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm + 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '600' },
});
