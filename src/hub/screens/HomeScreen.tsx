/**
 * Home — what the store wants to show you.
 *
 * Section order is the approved one: identity, then a way in, then the promise,
 * then one hero, then the things you already use, then discovery, then everything.
 * Advertising is interleaved at three densities — a banner, a native card and a
 * sponsored row — so the page proves it can carry inventory without the layout
 * being rebuilt later.
 *
 * ON "MOST OPENED". The design labels this rail "Popular this week". Popularity
 * across users is not something this store can know — there is no backend and no
 * telemetry — so the rail is ordered and titled by the figure that is real: how
 * often this device has opened each app.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryChips } from '../components/CategoryChips';
import {
  ALL_CATEGORY,
  APP_VERSION,
  APPS,
  CATEGORIES,
  appById,
  type HubApp,
} from '../registry';
import { orderByCount, orderByRecency } from '../recents';
import { layout, space, useHubTheme } from '../theme';
import { AdBanner, AdNativeCard, AdPromoBlock, AdSponsoredListing, placeholderAds } from '../store/AdSlot';
import { AppListRow, CARD_WIDTH, RailCard, RecentCard } from '../store/AppCards';
import { AppRail } from '../store/AppRail';
import { FeaturedAppCard } from '../store/FeaturedAppCard';
import { StoreHeader, TrustStrip } from '../store/StoreHeader';
import { useStore } from '../store/StoreContext';

export function HomeScreen(): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { usage, usageFor, launch, showDetail, showCategory, goTab } = useStore();

  const featured = useMemo(() => APPS.filter((a) => a.featured), []);
  const hero = featured[0] ?? APPS[0];

  const recents = useMemo(
    () => orderByRecency(usage).map(appById).filter((a): a is HubApp => a !== undefined),
    [usage],
  );

  /** Most-opened first, then anything never opened, in registry order. */
  const mostOpened = useMemo(() => {
    const ranked = orderByCount(usage);
    const seen = new Set(ranked);
    return [...ranked.map(appById).filter((a): a is HubApp => a !== undefined), ...APPS.filter((a) => !seen.has(a.id))];
  }, [usage]);

  // The rail carries two organic cards, then a native ad, then the rest.
  const railHead = mostOpened.slice(0, 2);
  const railTail = mostOpened.slice(2);

  // The list carries two organic rows, then a sponsored listing, then the rest.
  const listHead = APPS.slice(0, 2);
  const listTail = APPS.slice(2);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]}
      showsVerticalScrollIndicator={false}
    >
      <StoreHeader theme={theme} onSearch={() => goTab('explore')} />

      {/* The two pull-ups tighten these against the 28px section rhythm, exactly
          as the design does — they are optical, not structural. */}
      <View style={{ marginTop: -space.md }}>
        <CategoryChips
          categories={CATEGORIES}
          selected={ALL_CATEGORY}
          onSelect={(c) => (c === ALL_CATEGORY ? goTab('explore') : showCategory(c))}
          theme={theme}
        />
      </View>

      <View style={{ marginTop: -space.x14 }}>
        <TrustStrip theme={theme} />
      </View>

      <FeaturedAppCard
        app={hero}
        theme={theme}
        onPress={() => showDetail(hero)}
        onOpen={() => launch(hero)}
        index={0}
        count={featured.length}
      />

      <AdBanner theme={theme} creative={placeholderAds.home} />

      {recents.length > 0 ? (
        <AppRail
          title="Recently opened"
          theme={theme}
          gap={space.x10}
          actionLabel="Library ›"
          onAction={() => goTab('library')}
        >
          {recents.map((app) => (
            <RecentCard
              key={app.id}
              app={app}
              theme={theme}
              usage={usageFor(app.id)}
              onPress={() => showDetail(app)}
            />
          ))}
        </AppRail>
      ) : null}

      <AppRail title="Most opened" theme={theme} gap={space.md}>
        {railHead.map((app) => (
          <RailCard
            key={app.id}
            app={app}
            theme={theme}
            usage={usageFor(app.id)}
            onPress={() => showDetail(app)}
            onOpen={() => launch(app)}
          />
        ))}
        <AdNativeCard theme={theme} creative={placeholderAds.native} width={CARD_WIDTH.rail} />
        {railTail.map((app) => (
          <RailCard
            key={app.id}
            app={app}
            theme={theme}
            usage={usageFor(app.id)}
            onPress={() => showDetail(app)}
            onOpen={() => launch(app)}
          />
        ))}
      </AppRail>

      <View style={styles.listSection}>
        <View style={styles.listHeader}>
          <Text style={[styles.listTitle, { color: theme.text }]}>All apps</Text>
          <Text style={[styles.listCount, { color: theme.textDim }]}>{`${APPS.length} apps`}</Text>
        </View>

        <View style={styles.list}>
          {listHead.map((app) => (
            <AppListRow
              key={app.id}
              app={app}
              theme={theme}
              usage={usageFor(app.id)}
              onPress={() => showDetail(app)}
              onOpen={() => launch(app)}
            />
          ))}
          <AdSponsoredListing theme={theme} creative={placeholderAds.listing} />
          {listTail.map((app) => (
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
      </View>

      <AdPromoBlock theme={theme} />

      <Text style={[styles.footer, { color: theme.textDim }]}>
        {`${APPS.length} apps · v${APP_VERSION} · No servers, no accounts`}
      </Text>

      <View style={{ height: layout.navSpacer }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xl, gap: layout.sectionGap },
  listSection: { gap: space.md },
  listHeader: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  listCount: { fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: layout.gutter, gap: space.x10 },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
  },
});
