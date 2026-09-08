/**
 * The featured slot: one app given the width and the height the rails do not get.
 *
 * It is the only surface in the store that carries a shadow and the only one that
 * uses a gradient, and the gradient is built from the featured app's own accent —
 * that is the point of a featured slot. Styled like a rail card it would just be a
 * wider rail card.
 *
 * The Android caveat from the design review is honoured here: a single node cannot
 * both cast a shadow and clip its rounded children on Android, so the shadow lives
 * on an outer View and the clipping on an inner one.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Press } from '../components/Press';
import { primaryCategory, type HubApp } from '../registry';
import { elevation, layout, radius, space, type, type HubPalette } from '../theme';

interface FeaturedAppCardProps {
  app: HubApp;
  theme: HubPalette;
  /** Opens the detail page. */
  onPress(): void;
  /** Launches the app itself. */
  onOpen(): void;
  /** Position in the featured set, for the pager. */
  index?: number;
  count?: number;
}

export function FeaturedAppCard({
  app,
  theme,
  onPress,
  onOpen,
  index = 0,
  count = 1,
}: FeaturedAppCardProps): React.ReactElement {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[type.sectionTitle, { color: theme.text }]}>Featured</Text>
        {count > 1 ? (
          <Text style={[styles.pager, { color: theme.textDim }]}>{`${index + 1} of ${count}`}</Text>
        ) : null}
      </View>

      {/* Outer node carries the shadow, inner node does the clipping. */}
      <View style={[styles.shadow, elevation.card, { shadowColor: theme.isDark ? '#000' : '#131722' }]}>
        <Press
          onPress={onPress}
          scaleTo={0.98}
          accessibilityRole="button"
          accessibilityLabel={`Featured: ${app.name}. ${app.description}`}
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <LinearGradient
            colors={[fade(app.accent, 0.3), fade(app.accent, 0.1), fade(app.accent, 0.02)]}
            locations={[0, 0.55, 1]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.hero}
          >
            <View style={[styles.featuredBadge, { backgroundColor: theme.text }]}>
              <Text style={[styles.featuredBadgeText, { color: theme.bg }]}>FEATURED</Text>
            </View>

            <View
              style={[
                styles.heroTile,
                elevation.iconPlate,
                { backgroundColor: theme.isDark ? theme.surface : '#FFFFFF' },
              ]}
            >
              <Text style={styles.heroGlyph}>{app.icon}</Text>
            </View>
          </LinearGradient>

          <View style={styles.body}>
            <View>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {app.name}
              </Text>
              <Text style={[styles.description, { color: theme.textDim }]} numberOfLines={3}>
                {app.description}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <View style={[styles.categoryPill, { backgroundColor: theme.surfaceRaised }]}>
                <Text style={[styles.categoryLabel, { color: theme.textDim }]}>
                  {primaryCategory(app).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.modes, { color: theme.textDim }]} numberOfLines={1}>
                {app.badges.map((b) => BADGE_TEXT[b]).join(' · ')}
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <Press
                onPress={onOpen}
                scaleTo={0.97}
                accessibilityRole="button"
                accessibilityLabel={`Open ${app.name}`}
                containerStyle={styles.primaryFlex}
                style={[styles.primary, { backgroundColor: theme.accent }]}
              >
                <Text style={[styles.primaryLabel, { color: theme.onAccent }]}>Open</Text>
              </Press>
              <Press
                onPress={onPress}
                scaleTo={0.97}
                accessibilityRole="button"
                accessibilityLabel={`Details for ${app.name}`}
                style={[styles.secondary, { borderColor: theme.borderStrong }]}
              >
                <Text style={[styles.secondaryLabel, { color: theme.text }]}>Details</Text>
              </Press>
            </View>
          </View>
        </Press>
      </View>

      {count > 1 ? (
        <View style={styles.dots}>
          {Array.from({ length: count }, (_, i) => (
            <View
              key={i}
              style={[
                i === index ? styles.dotActive : styles.dot,
                { backgroundColor: i === index ? theme.accent : theme.borderStrong },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const BADGE_TEXT = {
  bluetooth: 'Bluetooth',
  offline: 'Offline',
  encrypted: 'Encrypted',
  multiplayer: 'Multiplayer',
} as const;

/**
 * The registry stores each accent as an opaque hex; the hero needs the same hue at
 * three alphas. Parsed here rather than adding three more fields to every entry.
 */
function fade(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  section: { gap: space.x14 },
  header: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  pager: { fontSize: 12, fontWeight: '700' },
  shadow: { marginHorizontal: layout.gutter, borderRadius: radius.featured },
  card: {
    borderRadius: radius.featured,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  hero: { height: 176, alignItems: 'center', justifyContent: 'center' },
  featuredBadge: {
    position: 'absolute',
    top: space.lg,
    left: space.lg,
    height: 22,
    paddingHorizontal: 9,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredBadgeText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.4 },
  heroTile: { width: 84, height: 84, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  heroGlyph: { fontSize: 42, lineHeight: 48 },

  body: { paddingHorizontal: layout.gutter, paddingTop: space.x18, paddingBottom: layout.gutter, gap: space.md },
  name: { fontSize: 21, fontWeight: '800', letterSpacing: -0.4, lineHeight: 25 },
  description: { fontSize: 13.5, fontWeight: '500', lineHeight: 19, marginTop: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.x10 },
  categoryPill: { height: 24, paddingHorizontal: 9, borderRadius: 7, justifyContent: 'center' },
  categoryLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  modes: { fontSize: 11.5, fontWeight: '600', flex: 1 },

  buttonRow: { flexDirection: 'row', gap: space.x10, marginTop: 2 },
  primaryFlex: { flex: 1 },
  primary: {
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { fontSize: 14.5, fontWeight: '800' },
  secondary: {
    height: 46,
    paddingHorizontal: layout.gutter,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: { fontSize: 14.5, fontWeight: '800' },

  dots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.x6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotActive: { width: 18, height: 5, borderRadius: 3 },
});
