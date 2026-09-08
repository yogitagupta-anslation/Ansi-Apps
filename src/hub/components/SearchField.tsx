/**
 * The real search input, used on Explore.
 *
 * Home shows a search-shaped button that hands over to this screen; this is the
 * one that actually takes a keyboard. It filters as you type — with five apps a
 * submit button would be pure ceremony — and shows a clear button only once there
 * is something to clear, so the row does not carry a permanently dead control.
 */

import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { radius, space, touch, type HubPalette } from '../theme';
import { CloseIcon, SearchIcon } from '../store/icons';

interface SearchFieldProps {
  value: string;
  onChange(next: string): void;
  theme: HubPalette;
  autoFocus?: boolean;
  placeholder?: string;
  /** Fired on the keyboard's search key — the point at which a term is worth remembering. */
  onSubmit?(): void;
}

export function SearchField({
  value,
  onChange,
  theme,
  autoFocus = false,
  placeholder = 'Search apps, tools, capabilities',
  onSubmit,
}: SearchFieldProps): React.ReactElement {
  return (
    <View style={[styles.field, { backgroundColor: theme.surfaceRaised }]}>
      <SearchIcon size={18} color={theme.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        style={[styles.input, { color: theme.text }]}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        accessibilityLabel="Search apps"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <CloseIcon size={16} color={theme.textDim} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x10,
    borderRadius: radius.field,
    paddingHorizontal: space.x14,
    height: touch.field,
  },
  // `padding: 0` because Android gives TextInput its own vertical padding, which
  // pushes the text off-centre inside a fixed-height row.
  input: { flex: 1, fontSize: 14.5, fontWeight: '500', padding: 0 },
});
