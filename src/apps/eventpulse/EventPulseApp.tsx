/**
 * EventPulse, as the hub hosts it.
 *
 * Boot order still matters and is still deliberate:
 *   1. paint immediately (dark canvas, no white flash at a dim venue),
 *   2. open the local store and load the profile — all on-device, all instant,
 *   3. resume the last event from cache if there is one, so reopening the app
 *      inside a hall puts you straight back on the map,
 *   4. only then reach for the network.
 *
 * What changed from the standalone App.tsx: the SafeAreaProvider and StatusBar
 * belong to the hub now, and `bootstrap()` runs once per process rather than once
 * per mount. Bootstrap subscribes to the block service, so calling it again on
 * every return from the hub would stack duplicate subscribers on the same store.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { RootNavigator } from './runtime/RootNavigator';
import { actions, attachAppStateHandling, presence } from './runtime/services';
import { assertReleaseSafe } from './runtime/config';
import { AppText, Button, Loading } from './components/primitives';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import { space } from './theme/tokens';

/**
 * Process-wide, not component-wide. 'idle' and 'failed' both mean "a bootstrap
 * may start"; 'running' and 'done' both mean "do not start another one".
 */
type BootPhase = 'idle' | 'running' | 'done' | 'failed';
let bootPhase: BootPhase = 'idle';

export default function EventPulseApp(): React.ReactElement {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}

function Shell(): React.ReactElement {
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(bootPhase === 'done');

  /**
   * The native root view sits behind React's tree. Without this it keeps the
   * static colour from app.json, which shows as a wrong-theme flash during
   * navigation and behind the keyboard.
   */
  useEffect(() => {
    // Guarded: on a JS reload against an older native build the module is not
    // linked yet, and expo-modules-core throws synchronously rather than
    // rejecting. A missing root colour is cosmetic; a crash on boot is not.
    try {
      void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
    } catch {
      /* native module not present in this build */
    }
  }, [colors.background]);

  const boot = (): void => {
    if (bootPhase === 'running' || bootPhase === 'done') return;
    bootPhase = 'running';
    actions
      .bootstrap()
      .then(() => {
        bootPhase = 'done';
        setReady(true);
      })
      .catch((caught: Error) => {
        bootPhase = 'failed';
        setError(caught.message);
        setReady(true);
      });
  };

  useEffect(() => {
    assertReleaseSafe();
    const detach = attachAppStateHandling();
    boot();

    /**
     * Leaving for the hub is not the same as backgrounding the phone, but for the
     * radio it may as well be: nobody is looking at the map, so there is no reason
     * to keep scanning at foreground pace. The scanner comes back up to speed on
     * the next mount.
     */
    presence.setPhase('app_foreground');
    return () => {
      detach();
      presence.setPhase('background');
    };
  }, []);

  if (!ready) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centre}>
          <AppText variant="title">EventPulse</AppText>
          <Loading label="Loading your events" />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={styles.centre}>
          <AppText variant="heading">Something went wrong starting up</AppText>
          <AppText variant="body" tone="secondary" style={styles.errorText}>
            {error}
          </AppText>
          <Button
            label="Try again"
            onPress={() => {
              setError(null);
              setReady(false);
              boot();
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <RootNavigator />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.xl,
  },
  errorText: { textAlign: 'center' },
});
