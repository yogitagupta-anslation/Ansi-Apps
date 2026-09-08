/**
 * The app detail page.
 *
 * This is where the store makes its case for one app, and then gets out of the
 * way: the Open button hands straight to the existing shell, which mounts the app
 * exactly as it has always been mounted. Nothing on this page changes how an app
 * behaves.
 *
 * WHAT THE STATS STRIP SHOWS. The design's four cells are rating, opened, version
 * and size. Two of those cannot be known here — nobody has rated these apps, and
 * a per-app footprint is not a measurable thing inside one bundled binary. The
 * strip keeps its four cells, its dividers and its type, and shows four figures
 * that are real instead.
 *
 * THE PREVIEW STRIP prefers each app's own artwork. Treasure Hunt and Attendance
 * ship real images and get them; the other three have none, so they get the
 * approved fallback panel rather than a mocked-up screenshot pretending to be one.
 */

import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '../components/Press';
import { formatLastOpened, formatOpenCount } from '../recents';
import { APP_VERSION, APPS, primaryCategory, type HubApp } from '../registry';
import { layout, radius, space, type, useHubTheme } from '../theme';
import { AdBanner, placeholderAds } from '../store/AdSlot';
import { RelatedCard } from '../store/AppCards';
import { ChevronLeftIcon } from '../store/icons';
import { IconTile, Mono } from '../store/primitives';
import { useStore } from '../store/StoreContext';

const PREVIEW = { width: 186, art: 270 };

interface AppDetailScreenProps {
  app: HubApp;
  onBack(): void;
}

export function AppDetailScreen({ app, onBack }: AppDetailScreenProps): React.ReactElement {
  const theme = useHubTheme();
  const insets = useSafeAreaInsets();
  const { usageFor, launch, showDetail } = useStore();

  const usage = usageFor(app.id);
  const related = useMemo(() => APPS.filter((a) => a.id !== app.id), [app.id]);
  const hasArt = app.previews.length > 0;

  const stats: { label: string; value: string; underline?: boolean }[] = [
    { label: 'OPENED', value: formatOpenCount(usage) ?? '—', underline: true },
    { label: 'LAST', value: formatLastOpened(usage) ?? '—', underline: true },
    { label: 'VERSION', value: APP_VERSION },
    { label: 'CATEGORY', value: primaryCategory(app) },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ---------------------------------------------------------- hero -- */}
        <LinearGradient
          colors={[fade(app.accent, 0.28), fade(app.accent, 0.08), fade(app.accent, 0)]}
          locations={[0, 0.5, 1]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + space.md }]}
        >
          <View style={styles.navRow}>
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

          <View style={styles.identity}>
            <View
              style={[
                styles.heroTile,
                { backgroundColor: theme.isDark ? theme.surface : '#FFFFFF' },
              ]}
            >
              <Text style={styles.heroGlyph}>{app.icon}</Text>
            </View>
            <View style={styles.identityText}>
              <Text style={[styles.heroName, { color: theme.text }]}>{app.name}</Text>
              <Text style={[styles.heroTagline, { color: theme.textDim }]}>{app.tagline}</Text>
              <View style={styles.heroMeta}>
                <View style={[styles.categoryPill, { backgroundColor: fade(app.accent, 0.18) }]}>
                  <Text style={[styles.categoryLabel, { color: theme.text }]}>
                    {primaryCategory(app).toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.hubNote, { color: theme.textDim }]}>In this hub</Text>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* ---------------------------------------------------------- body -- */}
        <View style={styles.body}>
          <View style={[styles.stats, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {stats.map((stat, i) => (
              <React.Fragment key={stat.label}>
                {i > 0 ? <View style={[styles.statDivider, { backgroundColor: theme.border }]} /> : null}
                <View style={styles.statCell}>
                  {stat.underline && stat.value !== '—' ? (
                    <Mono theme={theme} size={14} weight="600" color={theme.text} underline>
                      {stat.value}
                    </Mono>
                  ) : (
                    <Text style={[styles.statValue, { color: theme.text }]} numberOfLines={1}>
                      {stat.value}
                    </Text>
                  )}
                  <Text style={[styles.statLabel, { color: theme.textDim }]}>{stat.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          {/* ------------------------------------------------------ preview -- */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={[type.sectionTitle, { color: theme.text }]}>Preview</Text>
              <Text style={[styles.sectionSub, { color: theme.textDim }]}>
                {hasArt ? 'From the app' : 'No screenshots yet'}
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bleed}
              contentContainerStyle={styles.bleedContent}
            >
              {hasArt
                ? app.previews.map((source, i) => (
                    <View
                      key={i}
                      style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    >
                      <Image source={source} style={styles.previewArt} resizeMode="cover" />
                      <View style={[styles.previewCaption, { borderTopColor: theme.border }]}>
                        <Text style={[styles.previewLabel, { color: theme.text }]}>
                          {`Screen ${i + 1}`}
                        </Text>
                      </View>
                    </View>
                  ))
                : app.features.slice(0, 3).map((feature) => (
                    <View
                      key={feature.title}
                      style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    >
                      <LinearGradient
                        colors={[fade(app.accent, 0.2), fade(app.accent, 0.04)]}
                        start={{ x: 0.15, y: 0 }}
                        end={{ x: 0.85, y: 1 }}
                        style={styles.previewFallback}
                      >
                        <Text style={styles.previewGlyph}>{feature.glyph}</Text>
                        <Text style={[styles.previewBody, { color: theme.textDim }]} numberOfLines={4}>
                          {feature.body}
                        </Text>
                      </LinearGradient>
                      <View style={[styles.previewCaption, { borderTopColor: theme.border }]}>
                        <Text style={[styles.previewLabel, { color: theme.text }]} numberOfLines={1}>
                          {feature.title}
                        </Text>
                      </View>
                    </View>
                  ))}
            </ScrollView>
          </View>

          {/* -------------------------------------------------------- about -- */}
          <View style={styles.aboutSection}>
            <Text style={[type.sectionTitle, { color: theme.text }]}>About this app</Text>
            <Text style={[styles.about, { color: theme.textDim }]}>{app.about}</Text>
          </View>

          {/* ----------------------------------------------------- features -- */}
          <View style={styles.section}>
            <Text style={[type.sectionTitle, { color: theme.text }]}>Key features</Text>
            <View style={styles.featureList}>
              {app.features.map((feature) => (
                <View key={feature.title} style={styles.featureRow}>
                  <View style={[styles.featureTile, { backgroundColor: fade(app.accent, 0.16) }]}>
                    <Text style={styles.featureGlyph}>{feature.glyph}</Text>
                  </View>
                  <View style={styles.featureText}>
                    <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                    <Text style={[styles.featureBody, { color: theme.textDim }]}>{feature.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* -------------------------------------------------- permissions -- */}
          <View style={[styles.permissions, { backgroundColor: theme.surfaceRaised }]}>
            <Text style={[styles.permissionsTitle, { color: theme.text }]}>Data & permissions</Text>
            {app.permissions.map((permission) => (
              <View key={permission.name} style={styles.permissionRow}>
                <View style={[styles.bullet, { backgroundColor: theme.textDim }]} />
                <Text style={[styles.permissionName, { color: theme.text }]}>
                  {permission.name}
                  <Text style={[styles.permissionWhy, { color: theme.textDim }]}>
                    {` — ${permission.why}`}
                  </Text>
                </Text>
              </View>
            ))}
          </View>

          <AdBanner theme={theme} creative={placeholderAds.detail} gutter={false} />
        </View>

        {/* ------------------------------------------------------- related -- */}
        <View style={styles.relatedSection}>
          <Text style={[type.sectionTitle, { color: theme.text, paddingHorizontal: layout.gutter }]}>
            More from Ansi-Apps
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.bleedContent}
          >
            {related.map((other) => (
              <RelatedCard
                key={other.id}
                app={other}
                theme={theme}
                onPress={() => showDetail(other)}
              />
            ))}
          </ScrollView>
        </View>

        <View style={{ height: space.lg }} />
      </ScrollView>

      {/* --------------------------------------------------- action bar -- */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: theme.nav,
            borderTopColor: theme.border,
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
      >
        <IconTile glyph={app.icon} tint={app.accentSoft} size={44} />
        <Press
          onPress={() => launch(app)}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={`Open ${app.name}`}
          containerStyle={styles.openFlex}
          style={[styles.openButton, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.openLabel, { color: theme.onAccent }]}>Open</Text>
        </Press>
      </View>
    </View>
  );
}

function fade(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: space.xl },

  hero: { paddingHorizontal: layout.gutter, paddingBottom: space.xl },
  navRow: { flexDirection: 'row', alignItems: 'center', marginLeft: -11, marginBottom: layout.gutter },
  navButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  identity: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  heroTile: { width: 88, height: 88, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  heroGlyph: { fontSize: 44, lineHeight: 50 },
  identityText: { flex: 1 },
  heroName: { fontSize: 23, fontWeight: '800', letterSpacing: -0.6, lineHeight: 26 },
  heroTagline: { fontSize: 13, fontWeight: '600', marginTop: 5 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  categoryPill: { height: 22, paddingHorizontal: space.sm, borderRadius: 6, justifyContent: 'center' },
  categoryLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  hubNote: { fontSize: 11.5, fontWeight: '700' },

  body: { paddingHorizontal: layout.gutter, paddingTop: layout.gutter, gap: space.x26 },

  stats: {
    flexDirection: 'row',
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  statCell: { flex: 1, paddingVertical: space.x14, paddingHorizontal: space.sm, alignItems: 'center' },
  statDivider: { width: StyleSheet.hairlineWidth },
  statValue: { fontSize: 13, fontWeight: '800' },
  statLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, marginTop: 5 },

  section: { gap: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  sectionSub: { fontSize: 11, fontWeight: '600' },
  // The rails sit inside a padded column, so they bleed back out and re-pad.
  bleed: { flexGrow: 0, marginHorizontal: -layout.gutter },
  bleedContent: { paddingHorizontal: layout.gutter, gap: space.md },

  preview: {
    width: PREVIEW.width,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  previewArt: { width: '100%', height: PREVIEW.art },
  previewFallback: {
    height: PREVIEW.art,
    padding: space.x18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
  },
  previewGlyph: { fontSize: 40, lineHeight: 46 },
  previewBody: { fontSize: 12, fontWeight: '500', lineHeight: 17, textAlign: 'center' },
  previewCaption: {
    paddingVertical: space.md,
    paddingHorizontal: space.x14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewLabel: { fontSize: 12, fontWeight: '700' },

  aboutSection: { gap: space.x10 },
  about: { fontSize: 13.5, fontWeight: '500', lineHeight: 21 },

  featureList: { gap: space.x10 },
  featureRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  featureTile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  featureGlyph: { fontSize: 16, lineHeight: 20 },
  featureText: { flex: 1, paddingTop: 1 },
  featureTitle: { fontSize: 13.5, fontWeight: '800' },
  featureBody: { fontSize: 12, fontWeight: '500', lineHeight: 17, marginTop: 2 },

  permissions: { borderRadius: radius.card, padding: space.lg, gap: space.md },
  permissionsTitle: { fontSize: 12.5, fontWeight: '800' },
  permissionRow: { flexDirection: 'row', gap: space.x10, alignItems: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: space.x6 },
  permissionName: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  permissionWhy: { fontSize: 12, fontWeight: '500', lineHeight: 17 },

  relatedSection: { gap: space.md, paddingTop: space.x26 },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
    paddingHorizontal: layout.gutter,
  },
  openFlex: { flex: 1 },
  openButton: { height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  openLabel: { fontSize: 15, fontWeight: '800' },
});
