/**
 * SearchBar.tsx
 * -----------------------------------------------------------------------------
 * Search input with a clear affordance. Filters locally over already-loaded
 * data — there is no network, so results are instant and there is no spinner.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { Icon } from './Icon';

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const t = useTheme();

  return (
    <View
      style={[styles.wrap, t.neuIn(t.colors), { marginBottom: t.spacing.md }]}>
      <Icon name="search" size={t.iconSize.sm} color={t.colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={[
          t.typography.body,
          {
            color: t.colors.textPrimary,
            flex: 1,
            fontSize: 14,
            marginLeft: t.spacing.x9,
            paddingVertical: 0,
          },
        ]}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear search">
          <Icon name="x" size={t.iconSize.sm} color={t.colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderRadius: 15,
    flexDirection: 'row',
    height: 46,
    paddingHorizontal: 15,
  },
});
