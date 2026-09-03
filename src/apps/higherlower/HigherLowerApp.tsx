/**
 * Higher or Lower, as the hub hosts it.
 *
 * This is the game's original App.tsx with two things removed: the
 * SafeAreaProvider (the hub owns one, and nesting a second re-measures the whole
 * tree for nothing) and the StatusBar (the hub's frame paints the band above the
 * strip, so an app-level override would fight it).
 *
 * Everything below this file is the game exactly as it was.
 */

import React, { useEffect } from 'react';

import { SettingsProvider, useSettings } from './settings/SettingsProvider';
import { BleProvider } from './ble/BleProvider';
import { StatsProvider } from './store/StatsProvider';
import { ThemeProvider } from './theme/ThemeProvider';
import { feedback } from './util/feedback';
import { soundManager } from './audio/SoundManager';
import RootNavigator from './navigation/RootNavigator';

export default function HigherLowerApp(): React.ReactElement {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <StatsProvider>
          <BleProvider>
            <Root />
          </BleProvider>
        </StatsProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}

/** Inside the providers so it can read the persisted haptics/sound preferences. */
function Root(): React.ReactElement {
  const { haptics, sound } = useSettings();

  useEffect(() => {
    feedback.configure({ haptics, sound });
  }, [haptics, sound]);

  /**
   * Freeing the audio players on the way out is what makes this app cheap to
   * leave: closing it back to the hub should not keep a bank of decoded effects
   * resident. `play()` recreates a player on demand, so re-opening the game costs
   * one lazy load and nothing else.
   */
  useEffect(() => () => soundManager.release(), []);

  return <RootNavigator />;
}
