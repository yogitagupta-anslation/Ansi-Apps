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
 * THEME BOOTSTRAP — why this file still loads a setting itself
 * ---------------------------------------------------------------------------
 * ThemeProvider seeds its state once, at mount. If it mounted with a default and
 * the real preference arrived later from storage, the saved theme would never be
 * applied — and putting ThemeProvider inside AppStoreProvider would still flash
 * the wrong colours for a frame while settings loaded.
 *
 * So the theme preference — and ONLY that one key — is read before the subtree
 * mounts. It is a single AsyncStorage read, typically a few milliseconds, and it
 * renders nothing until it resolves. That is what makes the choice survive a
 * restart with no flash of the wrong theme, and it is equally what makes
 * re-opening the app from the hub not flash either.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppNavigator } from './navigation/AppNavigator';
import { AppStoreProvider } from './state/appStore';
import { SETTINGS_KEYS } from './constants/appConfig';
import { SettingsStorage } from './storage/SettingsStorage';
import { ThemeProvider, type ThemePreference } from './theme/ThemeContext';

export default function AttendanceApp(): React.ReactElement {
  const [themePreference, setThemePreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = (await SettingsStorage.get(SETTINGS_KEYS.theme)) as ThemePreference | null;
      if (!cancelled) {
        setThemePreference(stored ?? 'dark');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Persist the choice whenever the user changes it in Settings. */
  const handlePreferenceChange = useCallback((preference: ThemePreference) => {
    void SettingsStorage.set(SETTINGS_KEYS.theme, preference);
  }, []);

  // Render nothing (not a themed screen) until the preference is known —
  // painting a default theme first is exactly the flash we are avoiding.
  if (themePreference === null) {
    return <View style={{ flex: 1, backgroundColor: '#0B0F14' }} />;
  }

  return (
    <ThemeProvider initialPreference={themePreference} onPreferenceChange={handlePreferenceChange}>
      <AppStoreProvider>
        <AppNavigator />
      </AppStoreProvider>
    </ThemeProvider>
  );
}
