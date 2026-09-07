/**
 * App Hub — one shell, five apps.
 *
 * The navigation shape is the design. Two tabs, Apps and Settings, sit at the bottom of
 * the *root* stack rather than above it, which is what makes a running app full screen:
 * search, an app's detail page and the session itself are pushed over the tabs, so the
 * launcher's chrome disappears the moment you are inside something.
 *
 * React Navigation allows exactly one NavigationContainer per tree, so the hub owns it and
 * each hosted app contributes its own *nested* navigator underneath (BLE Chat a stack over
 * tabs, Higher or Lower a stack, EventPulse its own pane switcher). That is also what makes
 * Android's back button do the obvious thing for free: the innermost navigator handles it
 * until it has nothing left to pop, and then the root stack returns to the launcher.
 *
 * Routes for the apps are generated from the registry rather than written out, so adding a
 * sixth app never involves editing this file.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useFocusEffect,
  useNavigation,
  type CompositeNavigationProp,
  type Theme,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {
  createBottomTabNavigator,
  type BottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppDetailScreen } from './src/hub/AppDetailScreen';
import { HubScreen } from './src/hub/HubScreen';
import { SearchScreen } from './src/hub/SearchScreen';
import { SettingsScreen } from './src/hub/SettingsScreen';
import { Icon } from './src/hub/components/Icon';
import { useHubFonts } from './src/hub/fonts';
import { recordLaunch } from './src/hub/recents';
import { APPS, appById, type AppId, type HubApp } from './src/hub/registry';
import { font } from './src/hub/theme';
import { useHubTheme } from './src/hub/useHubTheme';
import { AppFrame } from './src/shell/AppFrame';

type RootStackParamList = Record<AppId, undefined> & {
  Main: undefined;
  Search: undefined;
  Detail: { appId: AppId };
};

type TabParamList = { Apps: undefined; Settings: undefined };

/**
 * Home reaches in two directions — sideways to the Settings tab, and up into the root
 * stack for search, a detail page and a session. Composing both is what lets the compiler
 * check either kind of destination instead of waving them through.
 */
type HubNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Apps'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

export default function App(): React.ReactElement {
  const theme = useHubTheme();
  const fontsReady = useHubFonts();

  // The navigator paints the gap behind screens during a transition. Left at its
  // default that gap is white, which flashes on every push in dark mode.
  const navTheme = useMemo<Theme>(() => {
    const base = theme.isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.isDark,
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

  /**
   * Held back until the families resolve. It is a few hundred milliseconds, and the
   * alternative is every label on the first screen visibly reflowing as Manrope replaces
   * the system face. `useHubFonts` reports a load *failure* as ready too, so a missing
   * font asset degrades to the system face rather than to a hub that never appears.
   */
  if (!fontsReady) {
    return (
      <SafeAreaProvider>
        <StatusBar style={theme.isDark ? 'light' : 'dark'} />
        <View style={[styles.splash, { backgroundColor: theme.bg }]} />
      </SafeAreaProvider>
    );
  }

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
          <Stack.Screen name="Main" component={MainTabs} />

          <Stack.Screen
            name="Search"
            // Up from the bottom, because search is a mode you enter and leave rather
            // than a place further along the browse path.
            options={{ animation: 'slide_from_bottom' }}
          >
            {({ navigation }) => (
              <SearchScreen
                onSelect={(app) => navigation.navigate('Detail', { appId: app.id })}
                onClose={() => navigation.goBack()}
              />
            )}
          </Stack.Screen>

          <Stack.Screen name="Detail">
            {({ navigation, route }) => {
              const app = appById(route.params.appId);
              // Only reachable if a route param outlived the app it names — go back
              // rather than render a page about nothing.
              if (!app) {
                navigation.goBack();
                return <View style={{ backgroundColor: theme.bg, flex: 1 }} />;
              }
              return (
                <AppDetailScreen
                  app={app}
                  onBack={() => navigation.goBack()}
                  onLaunch={() => {
                    void recordLaunch(app.id);
                    navigation.navigate(app.id);
                  }}
                />
              );
            }}
          </Stack.Screen>

          {APPS.map((app) => (
            <Stack.Screen key={app.id} name={app.id}>
              {({ navigation }) => (
                // goBack rather than navigate('Main'): it lands wherever you launched
                // from — the detail page, or Home if you came through "Jump back in" —
                // and it is what Android's hardware back does, so the two agree.
                <AppFrame app={app} onExit={() => navigation.goBack()}>
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

/** Apps and Settings. Hub violet owns the active tab — no app accent reaches this far. */
function MainTabs(): React.ReactElement {
  const theme = useHubTheme();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textFaint,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 60,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: font.bodySemi, fontSize: 11 },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen
        name="Apps"
        component={AppsTab}
        options={{
          tabBarIcon: ({ color }) => <Icon name="layout-grid" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color }) => <Icon name="settings" size={20} color={color} />,
        }}
      />
    </Tabs.Navigator>
  );
}

/**
 * Home, plus the one bit of state it cannot work out for itself.
 *
 * "Jump back in" is written when an app launches and read when the hub comes back, so the
 * list has to be re-read on focus — otherwise the app you just closed is missing from the
 * row that exists to offer it.
 */
function AppsTab(): React.ReactElement {
  // Taken from the hook rather than the tab's own props: every destination this screen
  // offers except Settings lives in the root stack, and typing it as the stack's
  // navigation is what makes those pushes checked rather than assumed.
  const navigation = useNavigation<HubNavigation>();
  const [refreshKey, setRefreshKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setRefreshKey((key) => key + 1);
    }, []),
  );

  const open = useCallback(
    (app: HubApp) => {
      void recordLaunch(app.id);
      navigation.navigate(app.id);
    },
    [navigation],
  );

  return (
    <HubScreen
      refreshKey={refreshKey}
      onSelect={(app) => navigation.navigate('Detail', { appId: app.id })}
      onOpen={open}
      onSearch={() => navigation.navigate('Search')}
      onSettings={() => navigation.navigate('Settings')}
    />
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1 },
});
