/**
 * The store's three destinations.
 *
 * Home is what the store wants to show you, Explore is how you go looking, and
 * Library is what is already yours. Three is the whole navigation: a fourth tab
 * would have to be carved out of one of those three, and none of them is big
 * enough to split.
 *
 * The design blurs the bar over the content behind it. React Native has no
 * backdrop filter and the Android blur view is expensive, so this uses the flat
 * `nav` token instead — which the design already defines at 0.92/0.94 alpha for
 * exactly this fallback.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space, touch, type, type HubPalette } from '../theme';
import { CompassIcon, HomeIcon, LibraryIcon, type IconProps } from './icons';

export type StoreTab = 'home' | 'explore' | 'library';

const TABS: { key: StoreTab; label: string; Icon: (p: IconProps) => React.ReactElement; fills: boolean }[] = [
  { key: 'home', label: 'Home', Icon: HomeIcon, fills: true },
  { key: 'explore', label: 'Explore', Icon: CompassIcon, fills: true },
  // The library glyph is open line-work with no interior to fill, so it signals
  // active state through colour and weight alone.
  { key: 'library', label: 'Library', Icon: LibraryIcon, fills: false },
];

interface BottomNavProps {
  theme: HubPalette;
  active: StoreTab;
  onSelect(tab: StoreTab): void;
}

export function BottomNav({ theme, active, onSelect }: BottomNavProps): React.ReactElement {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.nav,
          borderTopColor: theme.border,
          // The design's 24px is the gesture area. On a device that reports a
          // deeper inset, honour the device.
          paddingBottom: Math.max(insets.bottom, layout.navBottomPad),
        },
      ]}
    >
      {TABS.map(({ key, label, Icon, fills }) => {
        const on = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={styles.item}
          >
            <Icon
              size={23}
              color={on ? theme.accent : theme.textDim}
              fill={on && fills ? theme.accentSoft : 'none'}
            />
            <Text
              style={[
                on ? type.navLabelActive : type.navLabelIdle,
                { color: on ? theme.accent : theme.textDim },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
  },
  item: {
    flex: 1,
    height: touch.navItem,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
});
