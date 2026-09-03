/**
 * "Recently opened" — a horizontal row of small pills.
 *
 * Deliberately not tiles. Recents are a shortcut, not a second copy of the grid,
 * and making them look like the grid would double the visual weight of the same
 * three apps on a screen that only has three.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Press } from './Press';
import type { HubApp } from '../registry';
import { radius, space, type HubPalette } from '../theme';

interface RecentRowProps {
  apps: HubApp[];
  theme: HubPalette;
  onOpen(app: HubApp): void;
}

export function RecentRow({ apps, theme, onOpen }: RecentRowProps): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
      contentContainerStyle={styles.row}
    >
      {apps.map((app) => (
        <Press
          key={app.id}
          scaleTo={0.94}
          onPress={() => onOpen(app)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${app.name}`}
          style={[styles.pill, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <View style={[styles.iconTile, { backgroundColor: app.accentSoft }]}>
            <Text style={styles.icon}>{app.icon}</Text>
          </View>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {app.name}
          </Text>
        </Press>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, marginHorizontal: -space.xl },
  row: { gap: space.sm, paddingHorizontal: space.xl },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: space.sm,
    paddingRight: space.lg,
    height: 48,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 17 },
  name: { fontSize: 13, fontWeight: '600' },
});
