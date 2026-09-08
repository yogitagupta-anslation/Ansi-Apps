/**
 * BLE Attendance, as the hub hosts it.
 *
 * This is the app's original App.tsx with the two process-wide pieces removed —
 * the SafeAreaProvider (the hub owns one, and nesting a second re-measures the
 * whole tree for nothing) and the StatusBar (the hub's frame paints the band
 * above its back strip, so an app-level override would fight it).
 *
 * Everything below this file is the app exactly as it was: the same BLE
 * advertiser and scanner, the same role gate, the same storage.
 *
 * FONTS — why this file waits
 * ---------------------------------------------------------------------------
 * The design is set in Plus Jakarta Sans, with Space Grotesk for every figure
 * and IBM Plex Mono for identifiers. Android does not synthesise weights for a
 * custom family, so each weight is its own family and every style names one
 * explicitly. If the tree mounted before those faces were registered, RN would
 * fall back to the system font and then reflow when they arrived — every
 * measured line height in the design would shift under it.
 *
 * So the subtree waits, and paints the page ground meanwhile rather than a
 * spinner: the fonts come from the bundle, not the network, so the wait is a
 * frame or two and a spinner would flash for longer than it was useful.
 *
 * The theme no longer waits on anything — v3 follows the system appearance and
 * stores nothing, so there is no preference to read first.
 */

import React from 'react';
import { View } from 'react-native';
import { useFonts } from 'expo-font';

import { AppNavigator } from './navigation/AppNavigator';
import { AppStoreProvider } from './state/appStore';
import { FONT_ASSETS } from './theme/fonts';
import { ThemeProvider } from './theme/ThemeContext';

export default function AttendanceApp(): React.ReactElement {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);

  // A font that fails to load is a cosmetic problem, not a reason to withhold
  // an attendance app — fall through to the system face and carry on.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: '#0A0E14' }} />;
  }

  return (
    <ThemeProvider>
      <AppStoreProvider>
        <AppNavigator />
      </AppStoreProvider>
    </ThemeProvider>
  );
}
