/**
 * One app, one tile.
 *
 * The icon sits in a tinted square using the app's own accent, which is the only
 * place that colour appears on the grid. That is what lets someone find BLE Chat
 * by colour before they have read a single word — and why the tile itself stays
 * on the neutral surface rather than being washed in the accent too.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Press } from './Press';
import type { HubApp } from '../registry';
import { radius, space, type HubPalette } from '../theme';

interface AppCardProps {
  app: HubApp;
  theme: HubPalette;
  width: number;
  onPress(): void;
}

export function AppCard({ app, theme, width, onPress }: AppCardProps): React.ReactElement {
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}. ${app.tagline}`}
      style={[
        styles.card,
        { width, backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={[styles.iconTile, { backgroundColor: app.accentSoft }]}>
        <Text style={styles.icon}>{app.icon}</Text>
      </View>
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
        {app.name}
      </Text>
      <Text style={[styles.tagline, { color: theme.textDim }]} numberOfLines={2}>
        {app.tagline}
      </Text>
      {/* A hairline in the app's accent along the bottom edge: enough colour to
          identify the tile at a glance, not enough to compete with the icon. */}
      <View style={[styles.accentBar, { backgroundColor: app.accent }]} />
    </Press>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    paddingBottom: space.lg + 3,
    overflow: 'hidden',
    minHeight: 148,
  },
  iconTile: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  icon: { fontSize: 24 },
  name: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  tagline: { fontSize: 12, lineHeight: 16 },
  accentBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
});
