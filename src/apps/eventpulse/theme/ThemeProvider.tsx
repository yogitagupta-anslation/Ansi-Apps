import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { type Palette, type ThemeName, palettes } from './tokens';

/**
 * What the user chose, which is not the same as what is rendered.
 *
 * `system` is the default and the one most people should stay on — but an event
 * app gets used in a dim hall and on a bright concourse within the same hour,
 * and the OS switch is several taps away, so an explicit override earns its
 * place.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Theme {
  /** The theme actually being rendered. */
  name: ThemeName;
  colors: Palette;
  /** True when the surrounding chrome is dark, for status-bar styling. */
  isDark: boolean;
  /** What the user picked; `system` means "follow the OS". */
  preference: ThemePreference;
}

const ThemeContext = createContext<Theme>({
  name: 'dark',
  colors: palettes.dark,
  isDark: true,
  preference: 'system',
});

export function ThemeProvider({
  children,
  force,
}: {
  children: React.ReactNode;
  /** Test/preview override; bypasses both the preference and the OS. */
  force?: ThemeName;
}): React.ReactElement {
  const systemScheme = useColorScheme();
  const preference = useStore(sessionStore, (state) => state.themePreference);

  const name: ThemeName =
    force ??
    (preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference);

  const value = useMemo<Theme>(
    () => ({
      name,
      colors: palettes[name],
      isDark: name === 'dark',
      preference: force ? 'system' : preference,
    }),
    [name, preference, force],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
