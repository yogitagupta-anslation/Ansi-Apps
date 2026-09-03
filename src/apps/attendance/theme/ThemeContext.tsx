/**
 * ThemeContext.tsx
 * -----------------------------------------------------------------------------
 * Provides the active theme and the light/dark toggle used by Settings.
 *
 * The chosen mode is persisted through the settings repository, so it survives
 * an app restart like every other setting.
 * -----------------------------------------------------------------------------
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { buildTheme, type Theme, type ThemeMode } from './theme';

/** 'system' follows the OS setting; the others pin the choice. */
export type ThemePreference = 'system' | 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  /** The mode actually in effect after resolving 'system'. */
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreference = 'dark',
  onPreferenceChange,
}: {
  children: React.ReactNode;
  initialPreference?: ThemePreference;
  /** Called so the caller can persist the choice. */
  onPreferenceChange?: (preference: ThemePreference) => void;
}) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);

  const mode: ThemeMode =
    preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      onPreferenceChange?.(next);
    },
    [onPreferenceChange],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: buildTheme(mode), preference, setPreference, mode }),
    [mode, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return ctx.theme;
}

export function useThemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemePreference must be used inside a ThemeProvider');
  }
  return {
    preference: ctx.preference,
    setPreference: ctx.setPreference,
    mode: ctx.mode,
  };
}
