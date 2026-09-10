import React, {useEffect} from 'react';
import {Text, View} from 'react-native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {ChatsScreen} from './screens/ChatsScreen';
import {NearbyScreen} from './screens/NearbyScreen';
import {OnboardingScreen} from './screens/OnboardingScreen';
import {ProfileScreen} from './screens/ProfileScreen';
import {RideScreen} from './screens/RideScreen';
import {useHitchTheme, type HitchTheme, type as typeScale} from './config/theme';
import {useHitch} from './state/store';

/**
 * Hitch — rides from the phones around you.
 *
 * Four tabs with Ride first, because Ride is what the app is for and everything else
 * follows from having found somebody. The hub owns the NavigationContainer, so this
 * contributes a bare tab navigator and nothing else.
 *
 * Onboarding is a GATE rather than a route: until a role is chosen and a profile exists
 * there is nothing for the tabs to show, and a tab bar over an empty account is furniture
 * with no room behind it. The gate reads from persisted state, so it appears exactly once.
 */

type TabParams = {
  Ride: undefined;
  Nearby: undefined;
  Chats: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParams>();

const TABS: Array<{name: keyof TabParams; glyph: string; label: string}> = [
  {name: 'Ride', glyph: '🛺', label: 'Ride'},
  {name: 'Nearby', glyph: '🗺️', label: 'Nearby'},
  {name: 'Chats', glyph: '💬', label: 'Chats'},
  {name: 'Profile', glyph: '👤', label: 'Profile'},
];

function TabItem({
  glyph,
  label,
  focused,
  theme,
}: {
  glyph: string;
  label: string;
  focused: boolean;
  theme: HitchTheme;
}) {
  return (
    <View style={{alignItems: 'center', gap: 2}}>
      <Text style={{fontSize: 18, opacity: focused ? 1 : 0.55}}>{glyph}</Text>
      <Text
        style={{
          ...typeScale.caption,
          fontSize: 10.5,
          fontWeight: focused ? '600' : '400',
          color: focused ? theme.accent : theme.textFaint,
        }}
        numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function HitchApp(): React.ReactElement | null {
  const theme = useHitchTheme();
  const insets = useSafeAreaInsets();
  const hydrated = useHitch(s => s.hydrated);
  const onboarded = useHitch(s => s.onboarded);
  const hydrate = useHitch(s => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Held rather than flashed. Reading the profile takes a few milliseconds, and rendering
  // onboarding for those milliseconds to somebody who finished it last week is worse than
  // a blank frame.
  if (!hydrated) {
    return <View style={{flex: 1, backgroundColor: theme.bg}} />;
  }

  if (!onboarded) {
    return <OnboardingScreen />;
  }

  return (
    <Tab.Navigator
      initialRouteName="Ride"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.bg,
          borderTopColor: theme.divider,
          height: 58 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarIcon: () => null,
      }}>
      {TABS.map(tab => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={
            tab.name === 'Ride'
              ? RideScreen
              : tab.name === 'Nearby'
              ? NearbyScreen
              : tab.name === 'Chats'
              ? ChatsScreen
              : ProfileScreen
          }
          options={{
            tabBarLabel: ({focused}) => (
              <TabItem glyph={tab.glyph} label={tab.label} focused={focused} theme={theme} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}
