/**
 * App Hub — one shell, three apps.
 *
 * The single root stack is the whole architecture. React Navigation allows
 * exactly one NavigationContainer per tree, so the hub owns it and each hosted
 * app contributes its own *nested* navigator underneath (BLE Chat a stack over
 * tabs, Higher or Lower a stack, EventPulse its own hand-rolled pane switcher).
 * That is also what makes Android's back button do the obvious thing for free:
 * the innermost navigator handles it until it has nothing left to pop, and then
 * the root stack takes over and returns to the launcher.
 *
 * Routes are generated from the registry rather than written out, so adding a
 * fourth app never involves editing this file.
 */

import React, { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HubScreen } from './src/hub/HubScreen';
import { APPS, type AppId } from './src/hub/registry';
import { useHubTheme } from './src/hub/theme';
import { AppFrame } from './src/shell/AppFrame';

type RootStackParamList = Record<AppId, undefined> & { Hub: undefined };

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App(): React.ReactElement {
  const theme = useHubTheme();

  // The navigator paints the gap behind screens during a transition. Left at its
  // default that gap is white, which flashes on every push in dark mode.
  const navTheme = useMemo<Theme>(() => {
    const base = theme.isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme.bg,
        card: theme.surface,
        text: theme.text,
        border: theme.border,
        primary: theme.accent,
        notification: theme.accent,
      },
    };
  }, [theme]);

  return (
    <SafeAreaProvider>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: theme.bg },
          }}
        >
          <Stack.Screen name="Hub">
            {({ navigation }) => (
              // The launch is recorded inside the store, which owns the usage
              // history and re-renders from it. Recording it here as well would
              // count every open twice.
              <HubScreen onOpen={(app) => navigation.navigate(app.id)} />
            )}
          </Stack.Screen>

          {APPS.map((app) => (
            <Stack.Screen key={app.id} name={app.id}>
              {({ navigation }) => (
                // popToTop, NOT navigate('Hub'): navigate pushes a SECOND Hub on top
                // of the app instead of popping back to the first, so the app's subtree
                // is never unmounted. Every effect cleanup the hub relies on to make
                // leaving cheap -- Treasure Hunt's orientation unlock and GameManager
                // dispose, BLE Chat's saver duty cycle, EventPulse's background phase,
                // Higher or Lower's audio release, Attendance's record flush -- rides
                // on that unmount, and the stack grows Hub/app/Hub/app without bound.
                <AppFrame app={app} onExit={() => navigation.popToTop()}>
                  <app.screen />
                </AppFrame>
              )}
            </Stack.Screen>
          ))}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
