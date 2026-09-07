import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import {DenseText} from '../components/AppText';
import {
  ThemeProvider as NavigationThemeProvider,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {radius, typography} from '../config/theme';
import {Icon, type IconName} from '../components/ui/Icon';
import {useReduceMotion} from '../components/Motion';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {useMemo} from 'react';
import {ChatScreen} from '../screens/ChatScreen';
import {ChatsScreen} from '../screens/ChatsScreen';
import {DebugScreen} from '../screens/DebugScreen';
import {NearbyScreen} from '../screens/NearbyScreen';
import {NewGroupScreen} from '../screens/NewGroupScreen';
import {RegisterScreen} from '../screens/RegisterScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import type {RootStackParamList, TabParamList} from './types';
import {useAppStore} from '../state/appStore';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/** React Navigation needs its own theme object; derive it from ours. */
function useNavTheme() {
  const t = useTheme();
  return useMemo(
    () => ({
      ...(t.isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(t.isDark ? DarkTheme : DefaultTheme).colors,
        background: t.bg,
        card: t.surface,
        text: t.text,
        border: t.border,
        primary: t.accent,
      },
    }),
    [t],
  );
}

/**
 * A count, on the tab it belongs to.
 *
 * The design puts the number on the badge rather than a bare dot, and it is right to: on
 * a tab bar you check while walking, "3 waiting" and "1 waiting" are different decisions.
 * Capped at 99+ so a runaway count cannot widen the pill past its own tab.
 */
function TabBadge({count}: {count: number}) {
  const styles = useStyles();
  if (count <= 0) {
    return null;
  }
  return (
    <View style={styles.tabBadge}>
      <DenseText style={styles.tabBadgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
        {count > 99 ? '99+' : count}
      </DenseText>
    </View>
  );
}

function useUnreadTotal(): number {
  return useAppStore(s => Object.values(s.unread).reduce((sum, n) => sum + n, 0));
}

function useConnectedCount(): number {
  return useAppStore(s => s.peers.filter(p => p.state === 'connected').length);
}

/**
 * One tab: a 19px icon over a 10.5px label, and a badge when something is waiting.
 *
 * Both the icon and the label take the accent when current — the design lights the whole
 * tab rather than only its word, which is what makes the active one findable without
 * reading. Focus still lifts the icon a couple of points and settles it.
 */
function TabItem({
  icon,
  title,
  focused,
  badge = 0,
}: {
  icon: IconName;
  title: string;
  focused: boolean;
  badge?: number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const reduced = useReduceMotion();
  const lift = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      lift.setValue(focused ? 1 : 0);
      return;
    }
    Animated.spring(lift, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 8,
    }).start();
  }, [focused, reduced, lift]);

  const translateY = lift.interpolate({inputRange: [0, 1], outputRange: [0, -2]});
  const tint = focused ? theme.accent : theme.textDim;

  return (
    <View style={styles.tabItem}>
      <Animated.View style={{transform: [{translateY}]}}>
        <Icon name={icon} size={19} color={tint} strokeWidth={1.9} />
      </Animated.View>
      <DenseText
        style={[styles.tabLabel, {color: tint, fontWeight: focused ? '500' : '400'}]}
        numberOfLines={1}>
        {title}
      </DenseText>
      <TabBadge count={badge} />
    </View>
  );
}

// Fixed content height for one tab: the 36px icon circle, the label line, and the small
// dot under a focused label (labelWrap's own marginTop + line height + dot + its
// marginTop). react-navigation is supposed to auto-measure a custom tabBarIcon/tabBarLabel
// pair and size the bar to fit, but that auto-measurement is exactly the kind of thing
// that can come out short on a real device — different DPI, a font-scale setting, first-
// mount timing — where an emulator never showed the gap. Setting an explicit height built
// from real safe-area insets removes the guess entirely instead of hoping the library's
// own measurement lines up with what actually got laid out.
const TAB_CONTENT_HEIGHT = 58;

function Tabs() {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useUnreadTotal();

  return (
    <Tab.Navigator
      // Nearby first, because it is the screen the app is for: everything else follows
      // from having found somebody. Home's contents moved onto it, and Debug moved under
      // You as "Advanced" — neither was dropped, they stopped being destinations.
      initialRouteName="Nearby"
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {height: TAB_CONTENT_HEIGHT + insets.bottom, paddingBottom: insets.bottom},
        ],
        // The icon and the label are drawn together by TabItem, so the separate icon
        // slot would only insert a gap between them.
        tabBarIcon: () => null,
      }}>
      <Tab.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{
          tabBarLabel: ({focused}) => (
            <TabItem icon="tabNearby" title="Nearby" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarAccessibilityLabel: unread > 0 ? `Chats, ${unread} unread` : 'Chats',
          tabBarLabel: ({focused}) => (
            <TabItem icon="tabChats" title="Chats" focused={focused} badge={unread} />
          ),
        }}
      />
      <Tab.Screen
        name="You"
        component={SettingsScreen}
        options={{
          tabBarLabel: ({focused}) => (
            <TabItem icon="tabYou" title="You" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const theme = useTheme();
  const navTheme = useNavTheme();
  const profileComplete = useAppStore(s => s.settings.profileComplete);

  // A gate, not a dismissible prompt. The profile travels in the handshake, so anybody
  // met before it exists remembers us by the placeholder name for as long as they keep
  // us in their known-peers list.
  if (!profileComplete) {
    return <RegisterScreen />;
  }

  return (
    <NavigationThemeProvider value={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {backgroundColor: theme.surface},
          headerTintColor: theme.text,
          contentStyle: {backgroundColor: theme.bg},
        }}>
        <Stack.Screen
          name="Tabs"
          component={Tabs}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Debug"
          component={DebugScreen}
          // Its own screen draws the title and the back affordance, same as every other
          // screen in this app; the platform header would be a second one on top.
          options={{headerShown: false, animation: 'slide_from_right'}}
        />
        <Stack.Screen
          name="NewGroup"
          component={NewGroupScreen}
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          // ChatScreen renders its own header (avatar, name, MTU/role), so the stack
          // header would just duplicate it.
          options={{headerShown: false}}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          // Same reason as Chat: SettingsScreen builds its own back button and title,
          // matching the rest of this stack rather than the native default header.
          options={{headerShown: false}}
        />
      </Stack.Navigator>
    </NavigationThemeProvider>
  );
}

const useStyles = makeStyles(t => ({
  tabBar: {
    // The page colour, not a raised surface. The hairline is the whole boundary.
    backgroundColor: t.bg,
    borderTopColor: t.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {alignItems: 'center', gap: 3},
  tabLabel: {fontSize: 10.5, lineHeight: 14},
  tabBadge: {
    position: 'absolute',
    top: -2,
    right: 26,
    minWidth: 15,
    height: 15,
    borderRadius: radius.pill,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {color: '#ffffff', fontSize: 9.5, lineHeight: 13},
}));
