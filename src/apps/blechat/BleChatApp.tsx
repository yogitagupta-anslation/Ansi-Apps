/**
 * BLE Chat, as the hub hosts it.
 *
 * The original App.tsx did three jobs: install a global error handler, own the
 * SafeAreaProvider and status bar, and gate the UI behind the app lock. The first
 * has moved to the hub's entry point (it must be installed once, at process
 * start, not once per app open), the second is the hub's, and the third is still
 * here — because the lock is BLE Chat's, not the hub's, and re-locking on every
 * return from the background is the whole point of it.
 *
 * The radio deliberately keeps running when you leave for the hub. BLE Chat has a
 * foreground service for exactly this: a message that arrives while both radios
 * are on exists only in that moment, so shutting the stack down on the way out
 * would silently drop messages. What does happen on the way out is a drop to the
 * saver scan duty cycle — the same one the app already uses when backgrounded.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import { AppNavigator } from './navigation/AppNavigator';
import { AppLockScreen } from './screens/AppLockScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DenseText } from './components/AppText';
import { ThemeProvider, makeStyles, useTheme } from './theme/ThemeProvider';
import { initApp, useAppStore } from './state/appStore';
import { storage } from './storage/LocalStorage';
import { pinMatches } from './security/AppLock';
import { bleChat } from './services/BleChatService';

export default function BleChatApp(): React.JSX.Element {
  // Persisted preference; 'system' follows the OS appearance live.
  const themeMode = useAppStore((s) => s.settings.themeMode);

  useEffect(() => {
    // `bleChat.init()` is idempotent, so re-opening the app from the hub re-syncs
    // the store off the live service rather than rebuilding the stack.
    void initApp();
  }, []);

  useEffect(() => {
    bleChat.setScanIntensity('balanced');
    return () => bleChat.setScanIntensity('saver');
  }, []);

  return (
    <ThemeProvider mode={themeMode}>
      <AppShell />
    </ThemeProvider>
  );
}

/** Split out so it sits inside ThemeProvider and can read the active palette. */
function AppShell(): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  const ready = useAppStore((s) => s.ready);
  const initError = useAppStore((s) => s.initError);

  // null = not determined yet, so the app never flashes unlocked content while this
  // loads. Re-locks on every background -> foreground transition, same as a real screen
  // lock — the whole point is that walking away and coming back asks again.
  const [lock, setLock] = useState<{ enabled: boolean; hash: string | null } | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    void storage.loadAppLock().then(({ enabled, pinHash }) => {
      setLock({ enabled, hash: pinHash });
      setLocked(enabled);
    });
  }, []);

  useEffect(() => {
    // Re-read storage on every foreground, not just once at launch — otherwise a PIN
    // set from Settings only starts being enforced after the app is fully restarted,
    // since this same background->foreground cycle is the only other moment this ever
    // re-checks.
    const sub = AppState.addEventListener('change', (state) => {
      // Scanning flat out while the app is not even on screen is the single biggest
      // avoidable battery cost in this app. Paced hard in the background, restored on
      // return. The user's scan on/off choice is untouched — only the pacing changes.
      bleChat.setScanIntensity(state === 'active' ? 'balanced' : 'saver');
      if (state !== 'active') {
        return;
      }
      void storage.loadAppLock().then(({ enabled, pinHash }) => {
        setLock({ enabled, hash: pinHash });
        if (enabled) {
          setLocked(true);
        }
      });
    });
    return () => sub.remove();
  }, []);

  const showLockScreen = lock?.enabled && locked;

  if (lock === null) {
    // Whether to lock at all is not known yet — never render real content in the
    // gap, or a locked app would flash its own contents before covering them.
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (showLockScreen) {
    return (
      <AppLockScreen
        mode="unlock"
        onUnlock={(pin) => {
          const ok = !!lock.hash && pinMatches(pin, lock.hash);
          if (ok) {
            setLocked(false);
          }
          return ok;
        }}
      />
    );
  }

  if (!ready && !initError) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={theme.accent} />
        <DenseText style={styles.loadingText}>Starting Bluetooth stack...</DenseText>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <AppNavigator />
    </ErrorBoundary>
  );
}

const useStyles = makeStyles((t) => ({
  loading: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { color: t.textDim, marginTop: 12, fontSize: 14 },
}));
