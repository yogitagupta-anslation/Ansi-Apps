/**
 * ThemeContext.tsx
 * -----------------------------------------------------------------------------
 * Provides the active theme.
 *
 * THE APP STORES NO THEME. v3 follows the system appearance and nothing else —
 * there is no preference, no toggle and no persisted mode. `useColorScheme`
 * re-renders on a system appearance change by itself, so the whole app tracks
 * the device with no listener and no bootstrap read.
 *
 * The previous version read a saved preference before mounting the subtree so
 * the choice would survive a restart without a flash of the wrong colours. With
 * no choice to restore, that whole dance is gone: the system value is known
 * synchronously on the first render.
 * -----------------------------------------------------------------------------
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { buildTheme, type Theme, type ThemeMode } from './theme';

interface ThemeContextValue {
  theme: Theme;
  /** The mode actually in effect, resolved from the system. */
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const mode: ThemeMode = systemScheme === 'light' ? 'light' : 'dark';

  const value = useMemo<ThemeContextValue>(() => ({ theme: buildTheme(mode), mode }), [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return value.theme;
}

/** The resolved mode, for the few places that branch on light vs dark. */
export function useThemeMode(): ThemeMode {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useThemeMode must be used inside a ThemeProvider');
  }
  return value.mode;
}
