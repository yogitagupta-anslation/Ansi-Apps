import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Palette, palettes } from './tokens';

/** What the player asked for. 'system' follows the OS setting. */
export type Appearance = 'system' | 'light' | 'dark';
/** What that resolves to right now. */
export type Scheme = 'light' | 'dark';

interface ThemeContextValue {
  colors: Palette;
  scheme: Scheme;
  appearance: Appearance;
  setAppearance(next: Appearance): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Resolves the active palette and hands it to the tree.
 *
 * `useColorScheme` re-renders on OS theme changes, so flipping the system
 * setting restyles the app live -- the Android activity already declares
 * `uiMode` in configChanges and uses a DayNight theme, so it is not restarted.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [appearance, setAppearance] = useState<Appearance>('system');

  const value = useMemo<ThemeContextValue>(() => {
    // `system` is null when the OS will not say; dark is the app's home key.
    const resolved: Scheme = appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance;
    return {
      colors: palettes[resolved],
      scheme: resolved,
      appearance,
      setAppearance,
    };
  }, [appearance, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Builds a component's stylesheet from the active palette.
 *
 * Pass a module-level factory -- its identity is stable, so the styles are
 * rebuilt only when the palette actually changes:
 *
 *   const styles = useThemedStyles(makeStyles);
 *   ...
 *   const makeStyles = (colors: Palette) => StyleSheet.create({ ... });
 */
export function useThemedStyles<T>(factory: (colors: Palette) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
