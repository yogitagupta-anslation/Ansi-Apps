/**
 * Home: the shelf.
 *
 * The flow this screen starts is browse → detail → "Use it!" → the app runs, so tapping a
 * card here does *not* launch anything. It opens the app's page. That is a real decision
 * and worth stating: a launcher that opens apps on the first tap is faster, but it leaves
 * nowhere to say what an app needs before it needs it, which is the whole reason the
 * detail page exists in a hub full of apps that want your radio.
 *
 * The one exception is "Jump back in", where you have already made that decision.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppRow } from './components/AppRow';
import { CategoryChips } from './components/CategoryChips';
import { FeaturedCard } from './components/FeaturedCard';
import { Press } from './components/Press';
import { SearchButton } from './components/SearchField';
import { Section } from './components/Section';
import { loadRecents } from './recents';
import { ALL_CATEGORY, APPS, CATEGORIES, appById, type HubApp } from './registry';
import { initialsOf, useHubSettings } from './settings';
import { radius, space, typeScale as t } from './theme';
import { useHubTheme } from './useHubTheme';

interface HubScreenProps {
  /** Opens an app's detail page. */
  onSelect(app: HubApp): void;
  /** Launches straight into an app — used only where the choice was already made. */
  onOpen(app: HubApp): void;
  onSearch(): void;
  onSettings(): void;
  /** Bumped by the navigator on focus, so recents re-read after a session ends. */
  refreshKey?: number;
}

export function HubScreen({
  onSelect,
  onOpen,
  onSearch,
  onSettings,
  refreshKey = 0,
}: HubScreenProps): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { displayName } = useHubSettings();

  const [category, setCategory] = useState(ALL_CATEGORY);
  const [recents, setRecents] = useState<HubApp[]>([]);

  useEffect(() => {
    let alive = true;
    void loadRecents().then((ids) => {
      if (!alive) return;
      setRecents(ids.map(appById).filter((app): app is HubApp => app !== undefined));
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const featured = useMemo(() => APPS.find((app) => app.featured) ?? APPS[0], []);
  const listed = useMemo(
    () => (category === ALL_CATEGORY ? APPS : APPS.filter((app) => app.tags.includes(category))),
    [category],
  );

  const greeting = displayName.trim() ? `Hey, ${displayName.trim().split(/\s+/)[0]}` : 'Your apps';

  return (
    <ScrollView
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: space.xxl * 2 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={[t.eyebrow, { color: theme.accent }]}>App Hub</Text>
          <Text style={[t.title, { color: theme.text }]} numberOfLines={1}>
            {greeting}
          </Text>
        </View>

        <Press
          onPress={onSettings}
          scaleTo={0.9}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={[styles.avatar, { backgroundColor: theme.accentSoft, borderColor: theme.border }]}
        >
          <Text style={[t.metaStrong, { color: theme.accent }]}>
            {displayName.trim() ? initialsOf(displayName) : '·'}
          </Text>
        </Press>
      </View>

      <SearchButton onPress={onSearch} />

      <View>
        <Section title="Featured this week" />
        <FeaturedCard app={featured} onPress={() => onSelect(featured)} />
      </View>

      {recents.length > 0 && (
        <View>
          <Section title="Jump back in" />
          <View style={styles.list}>
            {recents.map((app) => (
              // Straight in, no detail page: this row exists because you have already
              // been here, and making you approve the same app twice is friction with
              // nothing on the other side of it.
              <AppRow key={app.id} app={app} onPress={() => onOpen(app)} note="Open again" />
            ))}
          </View>
        </View>
      )}

      <View>
        <Section title="All apps" />
        <CategoryChips categories={CATEGORIES} selected={category} onSelect={setCategory} />
        <View style={[styles.list, { marginTop: space.md }]}>
          {listed.map((app) => (
            <AppRow key={app.id} app={app} onPress={() => onSelect(app)} />
          ))}
        </View>
      </View>

      <Text style={[t.meta, styles.footer, { color: theme.textFaint }]}>
        {APPS.length} apps · nothing to install
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.lg, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerText: { flex: 1, gap: 2 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: space.sm },
  footer: { textAlign: 'center', marginTop: space.sm },
});
