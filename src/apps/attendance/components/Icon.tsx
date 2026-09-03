/**
 * Icon.tsx
 * -----------------------------------------------------------------------------
 * Thin wrapper over the Lucide icon font.
 *
 * Imported from the '/static' subpath deliberately: that is the bare-CLI entry
 * point where the font is bundled at Gradle build time, and it bypasses the
 * dynamic font-loading module entirely.
 *
 * WHY THE WRAPPER EXISTS
 * -----------------------------------------------------------------------------
 * Font-based icons render as <Text>, so on Android they inherit Text's extra
 * top and bottom line padding and sit visibly off-centre inside rows and
 * circular buttons. `includeFontPadding: false` is the fix, and applying it in
 * one place is the difference between icons that look deliberate and icons that
 * look slightly wrong everywhere.
 *
 * If icons render as empty boxes, the APK was not rebuilt - the font is copied
 * in by a Gradle task, so a Metro reload alone is never enough.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Lucide } from '@react-native-vector-icons/lucide/static';

/** Icon names used across the app, so typos are caught at compile time. */
export type IconName = React.ComponentProps<typeof Lucide>['name'];

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Lucide
      name={name}
      size={size}
      color={color}
      style={[styles.icon, style as object]}
    />
  );
}

/** Icon inside a soft tinted circle - used for section headers and list rows. */
export function IconBadge({
  name,
  size = 18,
  color,
  background,
  diameter = 36,
}: {
  name: IconName;
  size?: number;
  color: string;
  background: string;
  diameter?: number;
}) {
  return (
    <View
      style={[
        styles.badge,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: background,
        },
      ]}>
      <Icon name={name} size={size} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    // Removes Android's extra Text line padding so the glyph is truly centred.
    ...Platform.select({
      android: { includeFontPadding: false, textAlignVertical: 'center' },
      default: {},
    }),
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
