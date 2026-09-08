/**
 * The store header and the strip of promises under it.
 *
 * The header is the product's name badge, so it stays identical on every tab: the
 * mark, the wordmark, the one line that says what the whole catalogue has in
 * common, and a profile affordance. The search control here is a BUTTON, not a
 * field — tapping it moves to Explore, where a real input and a real keyboard
 * live. A screen with two search fields on it is a screen that has to explain
 * which one is which.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Press } from '../components/Press';
import { layout, radius, space, touch, type, type HubPalette } from '../theme';
import { SearchIcon, ShieldCheckIcon, SmartphoneIcon, UserIcon, WifiOffIcon } from './icons';
import { Divider } from './primitives';

interface StoreHeaderProps {
  theme: HubPalette;
  /** Tapping the search control hands over to Explore. */
  onSearch(): void;
  onProfile?: () => void;
}

export function StoreHeader({ theme, onSearch, onProfile }: StoreHeaderProps): React.ReactElement {
  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <View style={[styles.mark, { backgroundColor: theme.accent }]}>
          <Text style={[styles.markGlyph, { color: theme.onAccent }]}>✦</Text>
        </View>

        <View style={styles.brandText}>
          <Text style={[type.wordmark, { color: theme.text }]}>Ansi-Apps</Text>
          <Text style={[type.tagline, { color: theme.textDim }]}>
            Apps that work without the internet
          </Text>
        </View>

        <Press
          onPress={onProfile}
          scaleTo={0.92}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          style={[styles.avatar, { backgroundColor: theme.surfaceRaised, borderColor: theme.border }]}
        >
          <UserIcon size={19} color={theme.textDim} />
        </Press>
      </View>

      <Press
        onPress={onSearch}
        scaleTo={0.98}
        accessibilityRole="search"
        accessibilityLabel="Search apps, tools, capabilities"
        style={[styles.searchEntry, { backgroundColor: theme.surfaceRaised }]}
      >
        <SearchIcon size={18} color={theme.textFaint} />
        <Text style={[styles.searchPlaceholder, { color: theme.textFaint }]} numberOfLines={1}>
          Search apps, tools, capabilities
        </Text>
      </Press>
    </View>
  );
}

/**
 * Three facts that are true of every app in the catalogue. Not a feature list —
 * it is here so the answer to "what is this store" is visible before any scrolling
 * happens.
 */
export function TrustStrip({ theme }: { theme: HubPalette }): React.ReactElement {
  return (
    <View style={[styles.trust, { backgroundColor: theme.surfaceRaised }]}>
      <View style={styles.trustItem}>
        <WifiOffIcon size={15} color={theme.textDim} />
        <Text style={[styles.trustLabel, { color: theme.textDim }]}>Works offline</Text>
      </View>
      <Divider theme={theme} />
      <View style={styles.trustItem}>
        <ShieldCheckIcon size={15} color={theme.textDim} />
        <Text style={[styles.trustLabel, { color: theme.textDim }]}>No account</Text>
      </View>
      <Divider theme={theme} />
      <View style={styles.trustItem}>
        <SmartphoneIcon size={15} color={theme.textDim} />
        <Text style={[styles.trustLabel, { color: theme.textDim }]}>On-device</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: layout.gutter, gap: space.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: {
    width: 38,
    height: 38,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markGlyph: { fontSize: 19, fontWeight: '800' },
  brandText: { flex: 1 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.x10,
    height: touch.field,
    borderRadius: radius.field,
    paddingHorizontal: space.x14,
  },
  searchPlaceholder: { fontSize: 14.5, fontWeight: '500', flex: 1 },

  trust: {
    marginHorizontal: layout.gutter,
    paddingVertical: space.md,
    paddingHorizontal: space.x14,
    borderRadius: radius.field,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: space.x7, minWidth: 0 },
  trustLabel: { fontSize: 11.5, fontWeight: '700' },
});
