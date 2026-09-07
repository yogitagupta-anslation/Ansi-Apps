/**
 * Search.
 *
 * A separate screen rather than a mode on Home, so the keyboard has somewhere to be and
 * the results are not competing with a featured card for the same space.
 *
 * The category chips stay, because the two filters compose: "games, offline" is a real
 * question and answering it should not mean choosing which half to ask.
 */

import React, { useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppRow } from './components/AppRow';
import { CategoryChips } from './components/CategoryChips';
import { SearchInput } from './components/SearchField';
import { ALL_CATEGORY, APPS, CATEGORIES, searchApps, type HubApp } from './registry';
import { space, typeScale as t } from './theme';
import { useHubTheme } from './useHubTheme';

export function SearchScreen({
  onSelect,
  onClose,
}: {
  onSelect(app: HubApp): void;
  onClose(): void;
}): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);

  const results = useMemo(() => {
    const inCategory =
      category === ALL_CATEGORY ? APPS : APPS.filter((app) => app.tags.includes(category));
    return searchApps(inCategory, query);
  }, [category, query]);

  const trimmed = query.trim();

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top + space.md }]}>
      <View style={styles.head}>
        <SearchInput value={query} onChange={setQuery} onCancel={onClose} />
        <CategoryChips categories={CATEGORIES} selected={category} onSelect={setCategory} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
        // Scrolling the results is a clear signal that you are done typing.
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[t.meta, { color: theme.textFaint }]}>
          {results.length === APPS.length
            ? `${APPS.length} apps`
            : `${results.length} of ${APPS.length}`}
        </Text>

        {results.map((app) => (
          <AppRow key={app.id} app={app} onPress={() => onSelect(app)} />
        ))}

        {results.length === 0 && (
          <View style={styles.empty}>
            <Text style={[t.name, { color: theme.text }]}>Nothing matched</Text>
            <Text style={[t.body, styles.emptyBody, { color: theme.textDim }]}>
              {trimmed
                ? `No app matches “${trimmed}”${
                    category === ALL_CATEGORY ? '' : ` in ${category}`
                  }.`
                : `No apps in ${category} yet.`}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.md },
  list: { paddingHorizontal: space.lg, gap: space.sm },
  empty: { alignItems: 'center', gap: space.xs, paddingTop: space.xxl },
  emptyBody: { textAlign: 'center' },
});
