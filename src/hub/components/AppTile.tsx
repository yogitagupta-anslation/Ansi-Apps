/**
 * An app's icon, in a tinted rounded square.
 *
 * This is where an app's own accent is allowed to appear. Hub violet owns the chrome and
 * the active tab; the tile, the card it sits on, the app's detail page and its running
 * session are the only places another colour gets to speak. Keeping that boundary in one
 * component is what stops the rule from being something everyone has to remember.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { HubApp } from '../registry';
import { radius } from '../theme';

const SIZES = {
  sm: { box: 40, glyph: 19, r: radius.md },
  md: { box: 52, glyph: 25, r: radius.lg },
  lg: { box: 64, glyph: 31, r: radius.xl },
  xl: { box: 76, glyph: 37, r: radius.xxl },
} as const;

export function AppTile({
  app,
  size = 'md',
  style,
}: {
  app: HubApp;
  size?: keyof typeof SIZES;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const s = SIZES[size];
  return (
    <View
      style={[
        styles.tile,
        { width: s.box, height: s.box, borderRadius: s.r, backgroundColor: app.accentSoft },
        style,
      ]}
    >
      {/* Capped at 1: an emoji is a picture here, and letting the system font scale
          blow it past its own tile is worse for everyone than leaving it alone. */}
      <Text style={{ fontSize: s.glyph }} maxFontSizeMultiplier={1} allowFontScaling={false}>
        {app.icon}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
