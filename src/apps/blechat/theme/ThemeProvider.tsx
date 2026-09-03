import React, {createContext, useContext, useMemo} from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {darkTheme, themeForMode, type Theme, type ThemeMode} from '../config/theme';

const ThemeContext = createContext<Theme>(darkTheme);

export function ThemeProvider({
  mode,
  children,
}: {
  mode: ThemeMode;
  children: React.ReactNode;
}) {
  // Follows the OS setting live when mode is "system".
  const systemScheme = useColorScheme();
  const theme = useMemo(
    () => themeForMode(mode, systemScheme !== 'light'),
    [mode, systemScheme],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = {
  [P in keyof T]: ViewStyle | TextStyle | ImageStyle;
};

/**
 * Builds a stylesheet from the active theme.
 *
 *   const useStyles = makeStyles(t => ({box: {backgroundColor: t.surface}}));
 *   const styles = useStyles();
 *
 * The sheet is memoised per theme object, so switching palettes rebuilds once rather
 * than allocating a new style object on every render. This keeps StyleSheet.create (and
 * therefore the lint rule against inline styles) usable in a themed app.
 */
export function makeStyles<T extends NamedStyles<T> | NamedStyles<Record<string, unknown>>>(
  factory: (theme: Theme) => T,
) {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    const cached = cache.get(theme);
    if (cached) {
      return cached;
    }
    const created = StyleSheet.create(factory(theme)) as T;
    cache.set(theme, created);
    return created;
  };
}

/** Convenience for the handful of places that need a one-off themed value. */
export function useThemedValue<T>(pick: (theme: Theme) => T): T {
  const theme = useTheme();
  return pick(theme);
}

export type ThemedStyle = StyleProp<object>;
