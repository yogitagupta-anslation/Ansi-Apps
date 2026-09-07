/**
 * One app as a list row: tile, name, tagline, and a way in.
 *
 * The same row does the work in three places — "Jump back in", "All apps" and the search
 * results — because they are the same thing seen from three angles, and giving each its
 * own card shape would make the list read as three unrelated inventories rather than one.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppTile } from './AppTile';
import { Icon } from './Icon';
import { Press } from './Press';
import type { HubApp } from '../registry';
import { lift, radius, space, typeScale as t } from '../theme';
import { useHubTheme } from '../useHubTheme';

export function AppRow({
  app,
  onPress,
  /** A line that replaces the tagline — "Opened just now", "3 permissions". */
  note,
}: {
  app: HubApp;
  onPress(): void;
  note?: string;
}): React.ReactElement {
  const theme = useHubTheme();

  return (
    <Press
      onPress={onPress}
      scaleTo={0.975}
      accessibilityRole="button"
      accessibilityLabel={`${app.name}. ${note ?? app.tagline}`}
      style={[
        styles.row,
        { backgroundColor: theme.surface, borderColor: theme.border },
        lift(theme, 1),
      ]}
    >
      <AppTile app={app} size="sm" />

      <View style={styles.text}>
        <Text style={[t.nameSmall, { color: theme.text }]} numberOfLines={1}>
          {app.name}
        </Text>
        <Text style={[t.meta, { color: theme.textDim }]} numberOfLines={1}>
          {note ?? app.tagline}
        </Text>
      </View>

      <Icon name="chevron-right" size={18} color={theme.textFaint} />
    </Press>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  text: { flex: 1, gap: 2 },
});
