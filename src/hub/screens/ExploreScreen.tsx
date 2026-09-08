/**
 * Explore — how you go looking.
 *
 * The approved design draws browse, active-search and no-results as three
 * artboards. They are one screen here because they are one screen on a phone: the
 * OS keyboard decides when search is "active", and swapping to a different route
 * as the first character lands would throw the keyboard away. So the body switches
 * on whether there is a query, and the field above it never moves.
 *
 * The design's on-screen keyboard is a canvas mock. The real one is the platform's.
 *
 * Every number on this screen is counted from the registry: how many apps are in
 * a category, how many carry a capability. None of it is authored.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '../components/Press';
import { SearchField } from '../components/SearchField';
import {
  APPS,
  BADGE_LABEL,
  REAL_CATEGORIES,
  appsInCategory,
  matchReason,
  searchApps,
  type AppBadge,
  type HubApp,
} from '../registry';
import { layout, radius, space, touch, type, useHubTheme } from '../theme';
import { AdEmptySlot } from '../store/AdSlot';
import { AppListRow, CARD_WIDTH, RailCard } from '../store/AppCards';
import { AppRail } from '../store/AppRail';
import { ChevronRightIcon, ClockIcon, NoResultsIcon, TrendingIcon } from '../store/icons';
import { useStore } from '../store/StoreContext';

/** Ordered by how many apps carry each capability, so the list is a real ranking. */
const CAPABILITY_GLYPH: Record<AppBadge, string> = {
  bluetooth: '📡',
  offline: '✈️',
  multiplayer: '👥',
  encrypted: '🔒',
};

const CAPABILITY_BLURB: Record<AppBadge, string> = {
  bluetooth: 'Bluetooth Low Energy',
  offline: 'Works with no connection',
  multiplayer: 'Multiplayer over BLE',
  encrypted: 'End-to-end encrypted',
};

export function ExploreScreen(): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { usageFor, launch, showDetail, showCategory } = useStore();

  const [query, setQuery] = useState('');
  // Session-scoped: a search history is a convenience, not a record worth
  // persisting, and the brief asks for no storage that does not earn its keep.
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const results = useMemo(() => searchApps(APPS, query), [query]);
  const searching = query.trim().length > 0;

  const remember = useCallback((term: string) => {
    const clean = term.trim().toLowerCase();
    if (!clean) return;
    setRecentSearches((prev) => [clean, ...prev.filter((t) => t !== clean)].slice(0, 6));
  }, []);

  /** Two tiles per row, sized from the real viewport rather than the 412 mock. */
  const tileWidth = (width - layout.gutter * 2 - space.md) / 2;

  const capabilities = useMemo(() => {
    const counts = new Map<AppBadge, number>();
    for (const app of APPS) for (const b of app.badges) counts.set(b, (counts.get(b) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Explore</Text>
        <SearchField
          value={query}
          onChange={setQuery}
          theme={theme}
          onSubmit={() => remember(query)}
        />
      </View>

      {searching ? (
        results.length > 0 ? (
          <View style={styles.resultsSection}>
            <Text style={[styles.resultsCount, { color: theme.textDim }]}>
              {`${results.length} ${results.length === 1 ? 'app' : 'apps'}`}
            </Text>
            <View style={styles.results}>
              {results.map((app) => (
                <AppListRow
                  key={app.id}
                  app={app}
                  theme={theme}
                  usage={usageFor(app.id)}
                  note={matchReason(app, query)}
                  onPress={() => showDetail(app)}
                  onOpen={() => launch(app)}
                />
              ))}
            </View>
          </View>
        ) : (
          <EmptyResults
            query={query}
            theme={theme}
            onSuggest={(term) => {
              setQuery(term);
              remember(term);
            }}
            onBrowse={() => setQuery('')}
            onOpenDetail={showDetail}
            onLaunch={launch}
            usageFor={usageFor}
          />
        )
      ) : (
        <>
          {recentSearches.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeadRow}>
                <Text style={[styles.smallTitle, { color: theme.text }]}>Recent searches</Text>
                <Press onPress={() => setRecentSearches([])} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.clear, { color: theme.accent }]}>Clear</Text>
                </Press>
              </View>
              <View style={styles.chipWrap}>
                {recentSearches.map((term) => (
                  <Press
                    key={term}
                    scaleTo={0.94}
                    onPress={() => setQuery(term)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search ${term}`}
                    style={[styles.termChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
                  >
                    <ClockIcon size={13} color={theme.textDim} />
                    <Text style={[styles.termLabel, { color: theme.text }]}>{term}</Text>
                  </Press>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={[type.sectionTitle, { color: theme.text }]}>Browse by category</Text>
            <View style={styles.tileGrid}>
              {REAL_CATEGORIES.map((category) => {
                const apps = appsInCategory(category);
                return (
                  <Press
                    key={category}
                    scaleTo={0.97}
                    onPress={() => showCategory(category)}
                    accessibilityRole="button"
                    accessibilityLabel={`${category}, ${apps.length} apps`}
                    style={[
                      styles.tile,
                      { width: tileWidth, backgroundColor: theme.surface, borderColor: theme.border },
                    ]}
                  >
                    {/* The decorative blob is clipped by the tile's overflow. */}
                    <View style={[styles.blob, { backgroundColor: apps[0]?.accentSoft ?? theme.accentSoft }]} />
                    <View style={styles.tileText}>
                      <Text style={[styles.tileName, { color: theme.text }]}>{category}</Text>
                      <Text style={[styles.tileCount, { color: theme.textDim }]}>
                        {`${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`}
                      </Text>
                    </View>
                    <View style={styles.tileGlyphs}>
                      {apps.slice(0, 2).map((a) => (
                        <Text key={a.id} style={styles.tileGlyph}>
                          {a.icon}
                        </Text>
                      ))}
                    </View>
                  </Press>
                );
              })}
            </View>
          </View>

          <AdEmptySlot theme={theme} />

          <View style={styles.capabilitySection}>
            <View style={styles.capabilityHead}>
              <TrendingIcon size={17} color={theme.text} />
              <Text style={[type.sectionTitle, { color: theme.text }]}>Trending capabilities</Text>
            </View>
            <View style={styles.capabilityList}>
              {capabilities.map(([badge, count]) => (
                <Press
                  key={badge}
                  scaleTo={0.98}
                  onPress={() => setQuery(BADGE_LABEL[badge].toLowerCase())}
                  accessibilityRole="button"
                  accessibilityLabel={`${CAPABILITY_BLURB[badge]}, ${count} apps`}
                  style={[
                    styles.capabilityRow,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <View style={[styles.capabilityTile, { backgroundColor: theme.surfaceRaised }]}>
                    <Text style={styles.capabilityGlyph}>{CAPABILITY_GLYPH[badge]}</Text>
                  </View>
                  <View style={styles.capabilityText}>
                    <Text style={[styles.capabilityName, { color: theme.text }]} numberOfLines={1}>
                      {CAPABILITY_BLURB[badge]}
                    </Text>
                    <Text style={[styles.capabilityCount, { color: theme.textDim }]}>
                      {count === APPS.length ? `All ${count} apps` : `${count} apps`}
                    </Text>
                  </View>
                  <ChevronRightIcon size={17} color={theme.textDim} />
                </Press>
              ))}
            </View>
          </View>
        </>
      )}

      <View style={{ height: layout.navSpacer }} />
    </ScrollView>
  );
}

/* ------------------------------------------------------------ no results -- */

function EmptyResults({
  query,
  theme,
  onSuggest,
  onBrowse,
  onOpenDetail,
  onLaunch,
  usageFor,
}: {
  query: string;
  theme: ReturnType<typeof useHubTheme>;
  onSuggest(term: string): void;
  onBrowse(): void;
  onOpenDetail(app: HubApp): void;
  onLaunch(app: HubApp): void;
  usageFor(id: HubApp['id']): ReturnType<ReturnType<typeof useStore>['usageFor']>;
}): React.ReactElement {
  const suggestions = ['bluetooth', 'offline', 'games'];
  const fallback = APPS.slice(0, 2);

  return (
    <>
      <View style={styles.empty}>
        <View style={[styles.emptyPlate, { backgroundColor: theme.surfaceRaised }]}>
          <NoResultsIcon size={38} color={theme.textDim} />
        </View>
        <View style={styles.emptyText}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>{`No apps match “${query.trim()}”`}</Text>
          <Text style={[styles.emptyBody, { color: theme.textDim }]}>
            {`Ansi-Apps has ${APPS.length} apps. Search a capability instead — what the app does, not what it is called.`}
          </Text>
        </View>
        <View style={styles.suggestRow}>
          {suggestions.map((term) => (
            <Press
              key={term}
              scaleTo={0.94}
              onPress={() => onSuggest(term)}
              accessibilityRole="button"
              accessibilityLabel={`Search ${term}`}
              style={[styles.termChip, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <Text style={[styles.termLabel, { color: theme.text }]}>{term}</Text>
            </Press>
          ))}
        </View>
        <Press
          onPress={onBrowse}
          scaleTo={0.97}
          accessibilityRole="button"
          style={[styles.emptyCta, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.emptyCtaLabel, { color: theme.onAccent }]}>
            {`Browse all ${APPS.length} apps`}
          </Text>
        </Press>
      </View>

      <AppRail title="You might like" theme={theme} gap={space.md}>
        {fallback.map((app) => (
          <RailCard
            key={app.id}
            app={app}
            theme={theme}
            usage={usageFor(app.id)}
            onPress={() => onOpenDetail(app)}
            onOpen={() => onLaunch(app)}
          />
        ))}
      </AppRail>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xl, gap: layout.sectionGap },
  header: { paddingHorizontal: layout.gutter, gap: space.lg },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },

  section: { paddingHorizontal: layout.gutter, gap: space.md },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  smallTitle: { fontSize: 13, fontWeight: '800' },
  clear: { fontSize: 12, fontWeight: '800' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  termChip: {
    height: touch.chip,
    paddingHorizontal: space.x14,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x6,
  },
  termLabel: { fontSize: 13, fontWeight: '700' },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    height: 100,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  blob: { position: 'absolute', right: -18, top: -18, width: 74, height: 74, borderRadius: 37 },
  tileText: { zIndex: 1 },
  tileName: { fontSize: 15.5, fontWeight: '800' },
  tileCount: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  tileGlyphs: { position: 'absolute', left: space.lg, bottom: space.x14, flexDirection: 'row' },
  tileGlyph: { fontSize: 17 },

  capabilitySection: { gap: space.x14 },
  capabilityHead: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  capabilityList: { paddingHorizontal: layout.gutter, gap: space.x10 },
  capabilityRow: {
    borderRadius: radius.field,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.x14,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  capabilityTile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  capabilityGlyph: { fontSize: 16 },
  capabilityText: { flex: 1 },
  capabilityName: { fontSize: 14, fontWeight: '800' },
  capabilityCount: { fontSize: 11.5, fontWeight: '500', marginTop: 1 },

  resultsSection: { gap: space.md },
  resultsCount: { paddingHorizontal: layout.gutter, fontSize: 12, fontWeight: '700' },
  results: { paddingHorizontal: layout.gutter, gap: space.x10 },

  empty: { paddingHorizontal: layout.gutter, paddingTop: space.xxl, alignItems: 'center', gap: space.lg },
  emptyPlate: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  emptyText: { alignItems: 'center' },
  emptyTitle: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, textAlign: 'center' },
  emptyBody: {
    fontSize: 13.5,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: space.sm,
    maxWidth: 290,
    textAlign: 'center',
  },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' },
  emptyCta: {
    height: 46,
    paddingHorizontal: space.x22,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaLabel: { fontSize: 14, fontWeight: '800' },
});
