/**
 * Library — what is already yours.
 *
 * No advertising appears here, and the note at the bottom says so. A store that
 * sells placement between a person's own apps has stopped being their library.
 *
 * TWO HONEST SUBSTITUTIONS. The approved design puts a per-app storage breakdown
 * at the top and a "Pinned" rail under it. Neither can be truthful here: nothing
 * reports a per-app footprint inside a single bundled binary, and there is no
 * pinning feature to read. The card keeps its exact shape — a total, a stacked
 * bar, a legend — and is driven by the figure this device really has: how the
 * opens divide between the apps. The rail becomes "Jump back in", which is the
 * recency data that already exists.
 */

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { APPS, appById, type HubApp } from '../registry';
import { orderByRecency, type UsageRecord } from '../recents';
import { layout, radius, space, type, useHubTheme } from '../theme';
import { AdPolicyNote } from '../store/AdSlot';
import { LibraryRow, RecentCard } from '../store/AppCards';
import { AppRail } from '../store/AppRail';
import { Mono } from '../store/primitives';
import { useStore } from '../store/StoreContext';

export function LibraryScreen(): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { usage, usageFor, launch, showDetail } = useStore();

  const recents = useMemo(
    () => orderByRecency(usage).map(appById).filter((a): a is HubApp => a !== undefined),
    [usage],
  );

  const opens = useMemo(() => {
    const records = Object.values(usage) as UsageRecord[];
    const total = records.reduce((n, r) => n + r.count, 0);
    const byApp = APPS.map((app) => ({ app, count: usage[app.id]?.count ?? 0 })).filter((e) => e.count > 0);
    return { total, byApp: byApp.sort((a, b) => b.count - a.count) };
  }, [usage]);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.md }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Library</Text>
        <Text style={[styles.subtitle, { color: theme.textDim }]}>
          {`All ${APPS.length} apps are already installed — they ship inside Ansi-Apps.`}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={[styles.usageCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.usageHead}>
            <Text style={[styles.usageLabel, { color: theme.textDim }]}>TIMES OPENED</Text>
            <Mono theme={theme} size={13} weight="600" color={theme.text} underline>
              {String(opens.total)}
            </Mono>
          </View>

          {opens.total > 0 ? (
            <>
              <View style={[styles.bar, { backgroundColor: theme.surfaceRaised }]}>
                {opens.byApp.map(({ app, count }) => (
                  <View
                    key={app.id}
                    style={{ flex: count, backgroundColor: app.accent }}
                    accessibilityLabel={`${app.name}, ${count} opens`}
                  />
                ))}
              </View>

              <View style={styles.legend}>
                {opens.byApp.map(({ app, count }) => (
                  <View key={app.id} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: app.accent }]} />
                    <Text style={[styles.legendName, { color: theme.textDim }]} numberOfLines={1}>
                      {app.name}
                    </Text>
                    <Mono theme={theme} size={10.5} weight="500">
                      {`${count}×`}
                    </Mono>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={[styles.usageEmpty, { color: theme.textDim }]}>
              Nothing opened yet. Open an app and this fills in.
            </Text>
          )}
        </View>
      </View>

      {recents.length > 0 ? (
        <AppRail title="Jump back in" theme={theme} gap={space.x10}>
          {recents.slice(0, 4).map((app) => (
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

      <View style={styles.section}>
        <Text style={[type.sectionTitle, { color: theme.text }]}>All on this device</Text>
        <View style={[styles.rows, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {APPS.map((app, index) => (
            <LibraryRow
              key={app.id}
              app={app}
              theme={theme}
              usage={usageFor(app.id)}
              last={index === APPS.length - 1}
              onPress={() => showDetail(app)}
              onOpen={() => launch(app)}
            />
          ))}
        </View>
      </View>

      <AdPolicyNote theme={theme} />

      <View style={{ height: layout.navSpacer }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xl, gap: space.x26 },
  header: { paddingHorizontal: layout.gutter },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, fontWeight: '500', lineHeight: 19, marginTop: space.x6 },

  section: { paddingHorizontal: layout.gutter, gap: space.x14 },

  usageCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  usageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  usageLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  bar: { height: 10, borderRadius: 5, flexDirection: 'row', overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.x10, columnGap: space.x14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.x6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { fontSize: 11.5, fontWeight: '600' },
  usageEmpty: { fontSize: 12.5, fontWeight: '500', lineHeight: 18 },

  rows: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
});
