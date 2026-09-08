/**
 * AppNavigator.tsx
 * -----------------------------------------------------------------------------
 * Role decides the whole navigation tree.
 *
 *   no role yet  ->  RoleSelect gate
 *   HOST         ->  Home · Attendance (+History) · Employees · Settings (+Debug)
 *   EMPLOYEE     ->  Home · Attendance · Settings (+Debug)
 *
 * Debug is reached from Settings rather than being a primary tab, so ordinary
 * users are not one tap from developer tooling.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ThemeProvider as NavigationThemeProvider, type Theme as NavTheme } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Icon, type IconName } from '../components/Icon';
import { TAB_BAR_HEIGHT } from '../components/ui';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { DayDetailScreen } from '../screens/DayDetailScreen';
import { DebugScreen } from '../screens/DebugScreen';
import { AddEmployeeScreen } from '../screens/AddEmployeeScreen';
import { EmployeeDetailScreen } from '../screens/EmployeeDetailScreen';
import { EmployeeHomeScreen } from '../screens/EmployeeHomeScreen';
import { EmployeeInfoScreen } from '../screens/EmployeeInfoScreen';
import { EmployeesScreen } from '../screens/EmployeesScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { HostHomeScreen } from '../screens/HostHomeScreen';
import { EditProfileScreen } from '../screens/EditProfileScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { RoleSelectScreen } from '../screens/RoleSelectScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EmployeeOnly, HostOnly } from './RoleGuard';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Shared native-stack options so every header matches the theme. */
function useStackOptions() {
  const t = useTheme();
  return {
    headerStyle: { backgroundColor: t.colors.background },
    headerTitleStyle: { color: t.colors.textPrimary, fontSize: 17, fontWeight: '700' as const },
    headerTintColor: t.colors.primary,
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.colors.background },
  };
}

/* ------------------------------------------------------------------ stacks -- */

function AttendanceStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      <Stack.Screen
        name="AttendanceMain"
        component={AttendanceScreen}
        options={{ headerShown: false }}
      />
      {/* headerShown:false — HistoryScreen draws its own PageHeader (with a
          back arrow when it can go back). Leaving the native header on would
          render the title twice, one above the other. */}
      <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
      {/* The day drill-down History pushes, from a calendar cell or a record
          row. Registered in every stack that can show History, so the push
          always lands in the stack the user is already in. */}
      <Stack.Screen name="DayDetail" component={DayDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EmployeeDetail" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <EmployeeDetailScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      {/* The detail screen's Edit button pushes this, so it must exist in every
          stack that can show a detail — not just the Employees tab. */}
      <Stack.Screen name="AddEmployee" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <AddEmployeeScreen />
          </HostOnly>
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

/** HOST only: Settings is still a tab root, so it has no back affordance. */
function SettingsStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      <Stack.Screen name="SettingsMain" options={{ headerShown: false }}>
        {({ navigation }) => (
          <SettingsScreen onOpenDebug={() => navigation.navigate('Debug')} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Debug" component={DebugScreen} options={{ title: 'Debug & Logs' }} />
      {/* Reports live here on the Host: its tab bar has no History tab, and the
          roster header is bare in v3, so Settings > Data is the way in. */}
      <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DayDetail" component={DayDetailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

/**
 * EMPLOYEE tab 4. Profile owns personal info, the attendance overview, the
 * streak, and the way into Settings — which is why Settings is pushed here
 * rather than being a tab of its own, and why it draws a back chevron.
 */
function ProfileStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      <Stack.Screen name="ProfileMain" options={{ headerShown: false }}>
        {() => (
          <EmployeeOnly>
            <ProfileScreen />
          </EmployeeOnly>
        )}
      </Stack.Screen>
      {/* The editor the Profile tab pushes; it keeps its own back chevron. */}
      <Stack.Screen name="EditProfile" options={{ headerShown: false }}>
        {() => (
          <EmployeeOnly>
            <EditProfileScreen />
          </EmployeeOnly>
        )}
      </Stack.Screen>
      <Stack.Screen name="Settings" options={{ headerShown: false }}>
        {({ navigation }) => (
          <SettingsScreen onOpenDebug={() => navigation.navigate('Debug')} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Debug" component={DebugScreen} options={{ title: 'Debug & Logs' }} />
    </Stack.Navigator>
  );
}

function HostHomeStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      {/* Guarded: renders only on a HOST device, whatever route reached it. */}
      <Stack.Screen name="HostHome" options={{ headerShown: false }}>
        {({ navigation }) => (
          <HostOnly>
            <HostHomeScreen
              onSeeAll={() => navigation.getParent()?.navigate('Attendance')}
            />
          </HostOnly>
        )}
      </Stack.Screen>
      <Stack.Screen name="Scanner" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <ScannerScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      <Stack.Screen name="EmployeeDetail" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <EmployeeDetailScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      {/* The detail screen's Edit button pushes this, so it must exist in every
          stack that can show a detail — not just the Employees tab. */}
      <Stack.Screen name="AddEmployee" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <AddEmployeeScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      {/* headerShown:false — HistoryScreen draws its own PageHeader (with a
          back arrow when it can go back). Leaving the native header on would
          render the title twice, one above the other. */}
      <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
      {/* The day drill-down History pushes, from a calendar cell or a record
          row. Registered in every stack that can show History, so the push
          always lands in the stack the user is already in. */}
      <Stack.Screen name="DayDetail" component={DayDetailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

/**
 * EMPLOYEE tab 3. History needs a stack of its own now that a day row drills
 * into the day screen — as a bare tab component it had nowhere to push to.
 */
function EmployeeHistoryStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      <Stack.Screen name="HistoryMain" component={HistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DayDetail" component={DayDetailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function EmployeeHomeStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      <Stack.Screen name="EmployeeHome" options={{ headerShown: false }}>
        {() => (
          <EmployeeOnly>
            <EmployeeHomeScreen />
          </EmployeeOnly>
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function EmployeesStack() {
  const options = useStackOptions();
  return (
    <Stack.Navigator screenOptions={options}>
      {/* Employee registry is Host-only administration. */}
      <Stack.Screen name="EmployeesMain" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <EmployeesScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      <Stack.Screen name="AddEmployee" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <AddEmployeeScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      <Stack.Screen name="EmployeeDetail" options={{ headerShown: false }}>
        {() => (
          <HostOnly>
            <EmployeeDetailScreen />
          </HostOnly>
        )}
      </Stack.Screen>
      {/* EmployeeDetail's Full history and Export buttons push these. Every
          stack that can show the detail screen has to carry everywhere the
          detail screen can go, or the button throws instead of navigating. */}
      <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DayDetail" component={DayDetailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

/* -------------------------------------------------------------------- tabs -- */

/** The approved bar draws its glyphs at 22, not the navigator's default 24. */
const TAB_ICON_SIZE = 22;

function tabIcon(name: IconName) {
  const TabIcon = ({ color }: { color: string; size: number }) => (
    <Icon name={name} size={TAB_ICON_SIZE} color={color} />
  );
  return TabIcon;
}

function useTabScreenOptions() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  /**
   * The bar must sit ABOVE the gesture-navigation area.
   *
   * With a hardcoded height the home-indicator pill draws straight through the
   * tab labels on gesture-nav devices. Both the height and the bottom padding
   * have to grow by the inset — padding alone would just squash the labels
   * upward inside a bar that is still too short.
   *
   * Devices with 3-button navigation report bottom: 0, so this collapses back
   * to the original 62dp there.
   */
  // The design pads 22 below the items; that band IS the gesture area, so a
  // device reporting a deeper inset gets the device's value instead.
  const bottomInset = Math.max(insets.bottom, t.spacing.x22);

  return {
    headerShown: false,
    tabBarActiveTintColor: t.colors.tabActive,
    tabBarInactiveTintColor: t.colors.tabInactive,
    tabBarStyle: {
      backgroundColor: t.colors.tabBar,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.colors.tabBarBorder,
      height: TAB_BAR_HEIGHT + bottomInset,
      paddingTop: t.spacing.sm,
      paddingBottom: bottomInset,
    },
    tabBarLabelStyle: t.typography.tabLabel,
  };
}

function HostTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen
        name="Home"
        component={HostHomeStack}
        options={{ tabBarIcon: tabIcon('radio') }}
      />
      <Tab.Screen
        name="Attendance"
        component={AttendanceStack}
        options={{ tabBarIcon: tabIcon('user-check') }}
      />
      <Tab.Screen
        name="Employees"
        component={EmployeesStack}
        options={{ tabBarIcon: tabIcon('users') }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStack}
        options={{ tabBarIcon: tabIcon('settings') }}
      />
    </Tab.Navigator>
  );
}

function EmployeeTabs() {
  const screenOptions = useTabScreenOptions();
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen
        name="Home"
        component={EmployeeHomeStack}
        options={{ tabBarIcon: tabIcon('radio-tower') }}
      />
      <Tab.Screen
        name="Attendance"
        component={EmployeeInfoScreen}
        options={{ tabBarIcon: tabIcon('user-check') }}
      />
      <Tab.Screen
        name="History"
        component={EmployeeHistoryStack}
        options={{ tabBarIcon: tabIcon('chart-column') }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{ tabBarIcon: tabIcon('user') }}
      />
    </Tab.Navigator>
  );
}

/* --------------------------------------------------------------------- app -- */

export function AppNavigator() {
  const t = useTheme();
  const store = useAppStore();

  // Navigation's own theme must follow ours, or the screen background flashes
  // white between transitions in dark mode.
  const navTheme: NavTheme = {
    dark: t.mode === 'dark',
    colors: {
      primary: t.colors.primary,
      background: t.colors.background,
      card: t.colors.surface,
      text: t.colors.textPrimary,
      border: t.colors.border,
      notification: t.colors.error,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '900' },
    },
  };

  if (!store.ready) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: t.colors.background,
          flex: 1,
          justifyContent: 'center',
        }}>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </View>
    );
  }

  // Role gate - shown before any navigator so no Bluetooth work starts until
  // the device knows which side of the exchange it is on.
  if (!store.settings.role) {
    return (
      // Routed through setInitialRole, NOT updateSettings: it also updates
      // RoleService's synchronous cache, which the BLE guards read. Writing the
      // setting alone would leave those guards seeing a stale null role.
      <RoleSelectScreen
        onSelect={role => {
          void store.setInitialRole(role);
        }}
      />
    );
  }

  return (
    <NavigationThemeProvider value={navTheme}>
      {store.settings.role === 'HOST' ? <HostTabs /> : <EmployeeTabs />}
    </NavigationThemeProvider>
  );
}
