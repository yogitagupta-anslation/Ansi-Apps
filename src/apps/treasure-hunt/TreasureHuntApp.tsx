/**
 * Treasure Hunt, as the hub hosts it.
 *
 * This is the game's original App.tsx with the two process-wide pieces removed —
 * the SafeAreaProvider (the hub owns one, and nesting a second re-measures the
 * whole tree for nothing) and the StatusBar (the hub's frame paints the band
 * above its back strip, so an app-level override would fight it).
 *
 * Everything below this file is the game exactly as it was.
 *
 * ORIENTATION — the one thing the hub could not simply inherit
 * ---------------------------------------------------------------------------
 * As a standalone app this was `android:screenOrientation="sensorLandscape"` in
 * its manifest, and every screen is laid out for a wide, short viewport: the
 * world viewport, the two-column forms, the HUD. The hub and the other four apps
 * are portrait, and one Activity cannot hold two static orientations.
 *
 * So the lock moves from the manifest to runtime, scoped to exactly the time
 * this app is on screen. `setRequestedOrientation` at runtime overrides the
 * manifest value, so app.json stays `portrait` and every other app is untouched.
 *
 * The unlock on the way out is not optional: leaving the device pinned to
 * landscape would hand the user a sideways hub.
 */

import React, { useEffect } from 'react';
import { View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { RootNavigator } from './navigation';
import { GameProvider } from './state/GameContext';
import { colors } from './theme';
import { createLogger } from './utils/logger';

const log = createLogger('TreasureHuntApp');

export default function TreasureHuntApp(): React.ReactElement {
  useEffect(() => {
    // Failure here is cosmetic, never fatal: a device that refuses the lock
    // still plays the game, just in whatever orientation it was already in.
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch((err) =>
      log.warn('could not lock to landscape', err),
    );

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch((err) =>
        log.warn('could not restore portrait', err),
      );
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.abyss }}>
      <GameProvider>
        <RootNavigator />
      </GameProvider>
    </View>
  );
}
