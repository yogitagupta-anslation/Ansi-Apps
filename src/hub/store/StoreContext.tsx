/**
 * What every store screen needs and none of them should fetch for itself:
 * the local usage history, and the four things a tap can do.
 *
 * Usage is loaded once here and refreshed when a launch is recorded, rather than
 * each screen reading AsyncStorage on focus. Three screens render the same
 * "opened 12×" figure; they should not disagree about it.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { loadUsage, recordLaunch, type UsageMap, type UsageRecord } from '../recents';
import type { AppId, HubApp } from '../registry';

interface StoreContextValue {
  usage: UsageMap;
  usageFor(id: AppId): UsageRecord | undefined;
  /** Launch the app itself, through the shell. Records the launch. */
  launch(app: HubApp): void;
  /** Open the store's detail page for an app. */
  showDetail(app: HubApp): void;
  /** Open a category listing. */
  showCategory(category: string): void;
  /** Jump to a top-level tab. */
  goTab(tab: 'home' | 'explore' | 'library'): void;
}

const StoreContext = createContext<StoreContextValue | null>(null);

interface StoreProviderProps {
  children: React.ReactNode;
  onLaunch(app: HubApp): void;
  onShowDetail(app: HubApp): void;
  onShowCategory(category: string): void;
  onGoTab(tab: 'home' | 'explore' | 'library'): void;
}

export function StoreProvider({
  children,
  onLaunch,
  onShowDetail,
  onShowCategory,
  onGoTab,
}: StoreProviderProps): React.ReactElement {
  const [usage, setUsage] = useState<UsageMap>({});

  useEffect(() => {
    let live = true;
    void loadUsage().then((next) => {
      if (live) setUsage(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const launch = useCallback(
    (app: HubApp) => {
      // Recorded before the navigation, not after: the launch is the event, and
      // the store re-renders from the returned map rather than re-reading storage.
      void recordLaunch(app.id).then(() => loadUsage()).then(setUsage);
      onLaunch(app);
    },
    [onLaunch],
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      usage,
      usageFor: (id) => usage[id],
      launch,
      showDetail: onShowDetail,
      showCategory: onShowCategory,
      goTab: onGoTab,
    }),
    [usage, launch, onShowDetail, onShowCategory, onGoTab],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside a StoreProvider');
  return value;
}
