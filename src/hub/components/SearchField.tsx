/**
 * Search across the registry.
 *
 * Filters as you type — with three apps a submit button would be pure ceremony —
 * and shows a clear button only once there is something to clear, so the row does
 * not carry a permanently dead control.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { radius, space, type HubPalette } from '../theme';

interface SearchFieldProps {
  value: string;
  onChange(next: string): void;
  theme: HubPalette;
}

export function SearchField({ value, onChange, theme }: SearchFieldProps): React.ReactElement {
  return (
    <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.glyph, { color: theme.textFaint }]}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search apps..."
        placeholderTextColor={theme.textFaint}
        style={[styles.input, { color: theme.text }]}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search apps"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Text style={[styles.clear, { color: theme.textDim }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    height: 44,
  },
  glyph: { fontSize: 18, marginTop: -2 },
  // `padding: 0` because Android gives TextInput its own vertical padding, which
  // pushes the text off-centre inside a fixed-height row.
  input: { flex: 1, fontSize: 15, padding: 0 },
  clear: { fontSize: 14, fontWeight: '600' },
});
