/**
 * The store shell: three tabs, two overlay routes, one bottom bar.
 *
 * WHY THIS IS A SWITCHER AND NOT A NESTED NAVIGATOR. The root stack in App.tsx
 * still owns navigation — Hub plus one route per app — and that has not changed.
 * Inside the Hub route, the store's own tabs and its two pushed screens are held
 * in local state, the way EventPulse already holds its panes. A nested navigator
 * would have to publish its `navigation` object back up to the store context that
 * every screen reads, and the bridge for that is more machinery than the thing it
 * would be replacing.
 *
 * Android's hardware back is wired explicitly because of that choice: it pops a
 * detail or category overlay first, and only once there is nothing left to pop
 * does it fall through to the root stack, which exits the store. That is the same
 * behaviour a nested stack would have given, minus the bridge.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { AppDetailScreen } from './screens/AppDetailScreen';
import { CategoryScreen } from './screens/CategoryScreen';
import { ExploreScreen } from './screens/ExploreScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { appById, type HubApp } from './registry';
import { BottomNav, type StoreTab } from './store/BottomNav';
import { StoreProvider } from './store/StoreContext';
import { useHubTheme } from './theme';

/** What is stacked on top of the tabs, if anything. */
type Overlay = { kind: 'detail'; id: string } | { kind: 'category'; name: string } | null;

interface HubScreenProps {
  /** Hands an app to the root stack, which mounts it inside the AppFrame. */
  onOpen(app: HubApp): void;
}

export function HubScreen({ onOpen }: HubScreenProps): React.ReactElement {
  const theme = useHubTheme();
  const [tab, setTab] = useState<StoreTab>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);

  const showDetail = useCallback((app: HubApp) => setOverlay({ kind: 'detail', id: app.id }), []);
  const showCategory = useCallback((name: string) => setOverlay({ kind: 'category', name }), []);
  const goTab = useCallback((next: StoreTab) => {
    setOverlay(null);
    setTab(next);
  }, []);

  const launch = useCallback(
    (app: HubApp) => {
      // The overlay is dismissed on the way out so returning from an app lands on
      // the tab it was launched from, not on a detail page for something you have
      // already seen.
      setOverlay(null);
      onOpen(app);
    },
    [onOpen],
  );

  // Pop the overlay before the root stack gets a chance to leave the store.
  useEffect(() => {
    if (!overlay) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setOverlay(null);
      return true;
    });
    return () => subscription.remove();
  }, [overlay]);

  const detailApp = useMemo(
    () => (overlay?.kind === 'detail' ? appById(overlay.id) : undefined),
    [overlay],
  );

  return (
    <StoreProvider
      onLaunch={launch}
      onShowDetail={showDetail}
      onShowCategory={showCategory}
      onGoTab={goTab}
    >
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        {/* The tabs stay mounted under an overlay so scroll position and any typed
            search survive a trip into a detail page and back. */}
        <View style={styles.layer}>
          {tab === 'home' ? <HomeScreen /> : null}
          {tab === 'explore' ? <ExploreScreen /> : null}
          {tab === 'library' ? <LibraryScreen /> : null}
        </View>

        {overlay === null ? (
          <BottomNav theme={theme} active={tab} onSelect={goTab} />
        ) : null}

        {detailApp ? (
          <View style={[styles.overlay, { backgroundColor: theme.bg }]}>
            <AppDetailScreen app={detailApp} onBack={() => setOverlay(null)} />
          </View>
        ) : null}

        {overlay?.kind === 'category' ? (
          <View style={[styles.overlay, { backgroundColor: theme.bg }]}>
            <CategoryScreen category={overlay.name} onBack={() => setOverlay(null)} />
          </View>
        ) : null}
      </View>
    </StoreProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: { flex: 1 },
  // absoluteFill, not absoluteFillObject: the latter is gone in RN 0.86 and the
  // former is now the plain object it used to be.
  overlay: { ...StyleSheet.absoluteFill },
});
