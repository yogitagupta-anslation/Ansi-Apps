/**
 * A category listing.
 *
 * Reached from the Explore tiles and from the chips on Home. The three sort orders
 * are all real ones the store can actually apply — alphabetical, most-opened and
 * most-recent — rather than a relevance score there is nothing to compute.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '../components/Press';
import { REAL_CATEGORIES, appsInCategory, type HubApp } from '../registry';
import { layout, radius, space, touch, type, useHubTheme } from '../theme';
import { AdBanner, placeholderAds } from '../store/AdSlot';
import { AppListRow } from '../store/AppCards';
import { ChevronLeftIcon, ChevronRightIcon } from '../store/icons';
import { useStore } from '../store/StoreContext';

type Sort = 'az' | 'opened' | 'recent';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'az', label: 'A–Z' },
  { key: 'opened', label: 'Most opened' },
  { key: 'recent', label: 'Recent' },
];

interface CategoryScreenProps {
  category: string;
  onBack(): void;
}

export function CategoryScreen({ category, onBack }: CategoryScreenProps): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { usage, usageFor, launch, showDetail, showCategory } = useStore();
  const [sort, setSort] = useState<Sort>('az');

  const apps = useMemo(() => {
    const list = [...appsInCategory(category)];
    if (sort === 'az') return list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'opened')
      return list.sort((a, b) => (usage[b.id]?.count ?? 0) - (usage[a.id]?.count ?? 0));
    return list.sort((a, b) => (usage[b.id]?.lastOpenedAt ?? 0) - (usage[a.id]?.lastOpenedAt ?? 0));
  }, [category, sort, usage]);

  const others = REAL_CATEGORIES.filter((c) => c !== category);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <Press
          onPress={onBack}
          scaleTo={0.9}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.navButton}
        >
          <ChevronLeftIcon size={21} color={theme.text} />
        </Press>
      </View>

      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: theme.text }]}>{category}</Text>
          <Text style={[styles.subtitle, { color: theme.textDim }]}>
            {`${apps.length} ${apps.length === 1 ? 'app' : 'apps'} in this category`}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: apps[0]?.accentSoft ?? theme.surfaceRaised }]}>
          <Text style={styles.badgeGlyph}>{apps[0]?.icon ?? '✦'}</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.sortRow}
      >
        {SORTS.map(({ key, label }) => {
          const active = key === sort;
          return (
            <Press
              key={key}
              scaleTo={0.94}
              onPress={() => setSort(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.sortChip,
                {
                  backgroundColor: active ? theme.accent : theme.surface,
                  borderColor: active ? theme.accent : theme.border,
                },
              ]}
            >
              <Text style={[type.chip, { color: active ? theme.onAccent : theme.textDim }]}>{label}</Text>
            </Press>
          );
        })}
      </ScrollView>

      <View style={styles.list}>
        {apps.map((app: HubApp) => (
          <AppListRow
            key={app.id}
            app={app}
            theme={theme}
            usage={usageFor(app.id)}
            onPress={() => showDetail(app)}
            onOpen={() => launch(app)}
          />
        ))}
      </View>

      <AdBanner theme={theme} creative={placeholderAds.category} />

      <View style={styles.otherSection}>
        <Text style={[type.sectionTitle, { color: theme.text }]}>Other categories</Text>
        <View style={[styles.otherList, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {others.map((name, index) => (
            <Press
              key={name}
              scaleTo={0.98}
              onPress={() => showCategory(name)}
              accessibilityRole="button"
              accessibilityLabel={name}
              style={[
                styles.otherRow,
                index < others.length - 1
                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
                  : null,
              ]}
            >
              <Text style={[styles.otherName, { color: theme.text }]}>{name}</Text>
              <Text style={[styles.otherCount, { color: theme.textDim }]}>
                {`${appsInCategory(name).length}`}
              </Text>
              <ChevronRightIcon size={16} color={theme.textDim} />
            </Press>
          ))}
        </View>
      </View>

      <View style={{ height: layout.navSpacer }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xl, gap: space.xl },
  topBar: { paddingHorizontal: layout.gutter - 11, flexDirection: 'row', alignItems: 'center' },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  header: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: -space.md,
  },
  headerText: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 12.5, fontWeight: '600', marginTop: space.xs },
  badge: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  badgeGlyph: { fontSize: 28, lineHeight: 33 },

  sortRow: { gap: space.sm, paddingHorizontal: layout.gutter },
  sortChip: {
    height: touch.chip,
    paddingHorizontal: space.lg,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  list: { paddingHorizontal: layout.gutter, gap: space.x10 },

  otherSection: { paddingHorizontal: layout.gutter, gap: space.md },
  otherList: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg },
  otherName: { flex: 1, fontSize: 14, fontWeight: '800' },
  otherCount: { fontSize: 12, fontWeight: '700' },
});
