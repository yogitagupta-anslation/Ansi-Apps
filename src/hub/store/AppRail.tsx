/**
 * A horizontally scrolling row of cards under a titled header.
 *
 * The header keeps the page gutter; the rail deliberately does not. It bleeds to
 * both screen edges and re-applies the gutter as content padding instead, so the
 * first card lines up with the title while the row still runs off the screen the
 * way a scrollable row should.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Press } from '../components/Press';
import { layout, space, type, type HubPalette } from '../theme';

interface AppRailProps {
  title: string;
  theme: HubPalette;
  children: React.ReactNode;
  /** Gap between cards. Rails differ: recents sit closer than discovery cards. */
  gap?: number;
  /** Optional right-hand link, e.g. "Library ›". */
  actionLabel?: string;
  onAction?: () => void;
}

export function AppRail({
  title,
  theme,
  children,
  gap = space.md,
  actionLabel,
  onAction,
}: AppRailProps): React.ReactElement {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={[type.sectionTitle, { color: theme.text }]}>{title}</Text>
        {actionLabel ? (
          <Press
            onPress={onAction}
            scaleTo={0.94}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={[styles.action, { color: theme.accent }]}>{actionLabel}</Text>
          </Press>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
        contentContainerStyle={[styles.rail, { gap }]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.x14 },
  header: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  action: { fontSize: 12.5, fontWeight: '800' },
  // flexGrow:0 keeps the rail from claiming the vertical scroller's spare height.
  scroller: { flexGrow: 0 },
  rail: { paddingHorizontal: layout.gutter, alignItems: 'stretch' },
});
