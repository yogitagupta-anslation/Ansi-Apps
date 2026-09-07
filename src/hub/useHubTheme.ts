/**
 * The palette every hub screen reads.
 *
 * Kept out of `theme.ts` so the palette module stays a leaf: `settings.ts` needs the
 * `HubThemeMode` type from it, and having the palette reach back for the setting would
 * close a cycle between two modules that both run at import time.
 */

import { useMemo } from 'react';
import { useHubSettings } from './settings';
import { paletteFor, useSystemIsDark, type HubPalette } from './theme';

export function useHubTheme(): HubPalette {
  const { themeMode } = useHubSettings();
  const systemIsDark = useSystemIsDark();
  return useMemo(() => paletteFor(themeMode, systemIsDark), [themeMode, systemIsDark]);
}
