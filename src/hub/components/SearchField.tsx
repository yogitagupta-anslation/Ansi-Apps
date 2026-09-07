/**
 * The search field, in two forms.
 *
 * `SearchButton` is what Home shows — it looks like a field but is a button that opens the
 * search screen. That is deliberate rather than lazy: a real input on Home would raise the
 * keyboard over the content someone came to browse, and every store worth copying does it
 * this way.
 *
 * `SearchInput` is the real one, on the screen built for it.
 */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from './Icon';
import { Press } from './Press';
import { radius, space, typeScale as t, font } from '../theme';
import { useHubTheme } from '../useHubTheme';

export function SearchButton({ onPress }: { onPress(): void }): React.ReactElement {
  const theme = useHubTheme();
  return (
    <Press
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="search"
      accessibilityLabel="Search apps"
      style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Icon name="search" size={18} color={theme.textFaint} />
      <Text style={[t.body, { color: theme.textFaint }]}>Search apps</Text>
    </Press>
  );
}

export function SearchInput({
  value,
  onChange,
  onCancel,
  autoFocus = true,
}: {
  value: string;
  onChange(next: string): void;
  onCancel(): void;
  autoFocus?: boolean;
}): React.ReactElement {
  const theme = useHubTheme();

  return (
    <View style={styles.inputRow}>
      <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Icon name="search" size={18} color={theme.textFaint} />
        <TextInput
          value={value}
          onChangeText={onChange}
          autoFocus={autoFocus}
          placeholder="Search apps"
          placeholderTextColor={theme.textFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text }]}
          // The one control that must never disappear behind a large font setting: it is
          // how you get back out of search.
          maxFontSizeMultiplier={1.6}
        />
        {value.length > 0 && (
          <Press
            onPress={() => onChange('')}
            scaleTo={0.85}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Icon name="x" size={16} color={theme.textFaint} />
          </Press>
        )}
      </View>

      <Press
        onPress={onCancel}
        scaleTo={0.94}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cancel search"
      >
        <Text style={[t.bodyStrong, { color: theme.accent }]}>Cancel</Text>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    flex: 1,
    fontFamily: font.body,
    fontSize: 14,
    // Android gives a TextInput generous default padding that makes it taller than the
    // 46pt row it sits in and pushes the text off-centre.
    padding: 0,
    includeFontPadding: false,
  },
});
