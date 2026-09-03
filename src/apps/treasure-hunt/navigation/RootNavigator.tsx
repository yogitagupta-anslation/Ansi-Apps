import React from 'react';
import {ThemeProvider as NavigationThemeProvider, type Theme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {
  CreateGameScreen,
  GameScreen,
  HomeScreen,
  HowToPlayScreen,
  InventoryScreen,
  JoinScreen,
  LeaderboardScreen,
  LoadingScreen,
  LobbyScreen,
  ResultsScreen,
  SettingsScreen,
  TreasureRadarScreen,
} from '../screens';
import {colors} from '../theme';
import type {RootStackParamList} from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Dark navigation theme, so there is never a white flash between screens. */
const navigationTheme: Theme = {
  dark: true,
  colors: {
    primary: colors.gold,
    background: colors.screen,
    card: colors.header,
    text: colors.text,
    border: colors.hairline,
    notification: colors.ember,
  },
  fonts: {
    regular: {fontFamily: 'System', fontWeight: '400'},
    medium: {fontFamily: 'System', fontWeight: '500'},
    bold: {fontFamily: 'System', fontWeight: '700'},
    heavy: {fontFamily: 'System', fontWeight: '900'},
  },
};

export function RootNavigator() {
  return (
    <NavigationThemeProvider value={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: {backgroundColor: colors.screen},
        }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="CreateGame" component={CreateGameScreen} />
        <Stack.Screen name="Lobby" component={LobbyScreen} />
        <Stack.Screen name="Join" component={JoinScreen} />
        <Stack.Screen
          name="Loading"
          component={LoadingScreen}
          options={{gestureEnabled: false, animation: 'fade'}}
        />
        <Stack.Screen
          name="Game"
          component={GameScreen}
          options={{gestureEnabled: false, animation: 'fade'}}
        />
        <Stack.Screen
          name="Inventory"
          component={InventoryScreen}
          options={{animation: 'slide_from_bottom'}}
        />
        <Stack.Screen
          name="TreasureRadar"
          component={TreasureRadarScreen}
          options={{animation: 'slide_from_bottom'}}
        />
        <Stack.Screen
          name="Leaderboard"
          component={LeaderboardScreen}
          options={{animation: 'slide_from_bottom'}}
        />
        <Stack.Screen
          name="Results"
          component={ResultsScreen}
          options={{gestureEnabled: false, animation: 'fade'}}
        />
        <Stack.Screen name="HowToPlay" component={HowToPlayScreen} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{animation: 'slide_from_bottom'}}
        />
      </Stack.Navigator>
    </NavigationThemeProvider>
  );
}
