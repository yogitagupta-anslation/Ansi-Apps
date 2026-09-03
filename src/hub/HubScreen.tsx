/**
 * The launcher.
 *
 * Search and category are two filters over one list, applied in that order and
 * held in this component rather than in the registry — the registry describes the
 * apps, this screen describes what is currently on screen.
 *
 * Featured and Recents only appear on the unfiltered view. Once someone is
 * searching or has picked a category they have told you what they want, and
 * leaving a promotional slot above the results is the launcher arguing with them.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppCard } from './components/AppCard';
import { CategoryChips } from './components/CategoryChips';
import { FeaturedCard } from './components/FeaturedCard';
import { RecentRow } from './components/RecentRow';
import { SearchField } from './components/SearchField';
import { loadRecents } from './recents';
import { ALL_CATEGORY, APPS, CATEGORIES, appById, searchApps, type HubApp } from './registry';
import { radius, space, useHubTheme } from './theme';

const GUTTER = space.xl;
const GAP = space.md;

interface HubScreenProps {
  onOpen(app: HubApp): void;
}

export function HubScreen({ onOpen }: HubScreenProps): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Recents change while this screen is mounted but not visible — the launch that
  // changed them happened on the way out. Re-reading on focus is what makes the
  // row correct when you come back, without the hub having to own the list.
  const focused = useIsFocused();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void loadRecents().then((ids) => {
      if (live) setRecentIds(ids);
    });
    return () => {
      live = false;
    };
  }, [focused]);

  const results = useMemo(() => {
    const byCategory =
      category === ALL_CATEGORY ? APPS : APPS.filter((app) => app.tags.includes(category));
    return searchApps(byCategory, query);
  }, [category, query]);

  const unfiltered = query.trim().length === 0 && category === ALL_CATEGORY;
  const featured = useMemo(() => APPS.find((app) => app.featured), []);
  const recents = useMemo(
    () => recentIds.map(appById).filter((app): app is HubApp => app !== undefined),
    [recentIds],
  );

  // Two columns, sized from the real viewport rather than a percentage, so the
  // gap between the tiles is exactly the gap to the screen edge.
  const cardWidth = (width - GUTTER * 2 - GAP) / 2;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={[styles.mark, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.markGlyph, { color: theme.accent }]}>✦</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>My App Hub</Text>
          <Text style={[styles.subtitle, { color: theme.textDim }]}>Everything in one place</Text>
        </View>
      </View>

      <SearchField value={query} onChange={setQuery} theme={theme} />

      <CategoryChips
        categories={CATEGORIES}
        selected={category}
        onSelect={setCategory}
        theme={theme}
      />

      {unfiltered && recents.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.textFaint }]}>RECENTLY OPENED</Text>
          <RecentRow apps={recents} theme={theme} onOpen={onOpen} />
        </View>
      ) : null}

      {unfiltered && featured ? (
        <View style={styles.section}>
          <FeaturedCard app={featured} theme={theme} onPress={() => onOpen(featured)} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.textFaint }]}>
          {unfiltered ? 'ALL APPS' : `${results.length} ${results.length === 1 ? 'APP' : 'APPS'}`}
        </Text>

        {results.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>Nothing here</Text>
            <Text style={[styles.emptyBody, { color: theme.textDim }]}>
              No app matches “{query.trim() || category}”.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {results.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                theme={theme}
                width={cardWidth}
                onPress={() => onOpen(app)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: GUTTER, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xs },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: { fontSize: 22, fontWeight: '700' },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, marginTop: 1 },
  section: { gap: space.md },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  empty: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
    gap: space.xs,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptyBody: { fontSize: 13, lineHeight: 18 },
});
