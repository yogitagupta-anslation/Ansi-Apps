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
import { recordLaunch } from './src/hub/recents';
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
              <HubScreen
                onOpen={(app) => {
                  // Recorded before the push, not after: the launch is the event,
                  // and the hub re-reads the list when it regains focus anyway.
                  void recordLaunch(app.id);
                  navigation.navigate(app.id);
                }}
              />
            )}
          </Stack.Screen>

          {APPS.map((app) => (
            <Stack.Screen key={app.id} name={app.id}>
              {({ navigation }) => (
                <AppFrame app={app} onExit={() => navigation.navigate('Hub')}>
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
