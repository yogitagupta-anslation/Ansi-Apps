/**
 * The featured slot: one app, given the width the grid tiles do not get.
 *
 * It is the only place in the hub that uses a gradient, and it uses the featured
 * app's own accent to build it. That is the point of a featured slot — if it were
 * styled like the tiles it would just be a fourth tile in a wider box.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Press } from './Press';
import type { HubApp } from '../registry';
import { radius, space, type HubPalette } from '../theme';

interface FeaturedCardProps {
  app: HubApp;
  theme: HubPalette;
  onPress(): void;
}

export function FeaturedCard({ app, theme, onPress }: FeaturedCardProps): React.ReactElement {
  return (
    <Press
      onPress={onPress}
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`Featured: ${app.name}. ${app.description}`}
      style={[styles.card, { borderColor: theme.border }]}
    >
      <LinearGradient
        // Accent at the top-left fading into the page ground at the bottom-right,
        // so the card reads as lit from the icon rather than uniformly tinted.
        colors={[app.accentSoft, theme.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fill}
      >
        <View style={styles.header}>
          <View style={[styles.iconTile, { backgroundColor: app.accentSoft }]}>
            <Text style={styles.icon}>{app.icon}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.eyebrow, { color: app.accent }]}>FEATURED</Text>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {app.name}
            </Text>
          </View>
        </View>

        <Text style={[styles.description, { color: theme.textDim }]} numberOfLines={3}>
          {app.description}
        </Text>

        <View style={[styles.cta, { backgroundColor: app.accent }]}>
          <Text style={styles.ctaLabel}>Open</Text>
        </View>
      </LinearGradient>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fill: { padding: space.xl, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1 },
  iconTile: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 27 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 2 },
  name: { fontSize: 20, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 19 },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.xl,
    height: 38,
    borderRadius: radius.sm + 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
