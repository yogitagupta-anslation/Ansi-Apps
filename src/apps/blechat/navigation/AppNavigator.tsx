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
import {typography} from '../config/theme';
import {Icon, type IconName} from '../components/ui/Icon';
import {useReduceMotion} from '../components/Motion';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {useMemo} from 'react';
import {ChatScreen} from '../screens/ChatScreen';
import {ChatsScreen} from '../screens/ChatsScreen';
import {DebugScreen} from '../screens/DebugScreen';
import {HomeScreen} from '../screens/HomeScreen';
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
 * A count, as a dot.
 *
 * The design's tab bar is words with a 5px dot beside the one that has something waiting.
 * The number itself moves into the accessibility label rather than disappearing: sighted
 * users get "something is waiting, go look", which is all a tab bar can usefully say, and
 * the exact figure is one tap away on the screen it belongs to.
 */
function TabDot({count, color}: {count: number; color: string}) {
  const styles = useStyles();
  if (count <= 0) {
    return null;
  }
  return <View style={[styles.tabDot, {backgroundColor: color}]} />;
}

function useUnreadTotal(): number {
  return useAppStore(s => Object.values(s.unread).reduce((sum, n) => sum + n, 0));
}

function useConnectedCount(): number {
  return useAppStore(s => s.peers.filter(p => p.state === 'connected').length);
}

/**
 * The tab itself: an icon, a word, and a dot when there is something behind it.
 *
 * The icon is a line glyph on the bar, not a glyph inside a filled lozenge. That keeps
 * what the lozenge was actually for — saying which tab is current — in the two things
 * already doing it, weight and colour, without putting four more boxes back on a bar
 * that just lost them.
 *
 * Focus lifts the icon by two points and settles it. It is a small movement on purpose:
 * a tab bar is tapped constantly, and anything larger becomes something you wait for.
 */
function TabItem({
  icon,
  title,
  focused,
  dot,
  dotColor,
}: {
  icon: IconName;
  title: string;
  focused: boolean;
  dot: number;
  dotColor: string;
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

  return (
    <View style={styles.tabItem}>
      <Animated.View style={{transform: [{translateY}]}}>
        <Icon
          name={icon}
          size={20}
          color={focused ? theme.accent : theme.textDim}
          strokeWidth={focused ? 2.1 : 1.7}
        />
      </Animated.View>
      <View style={styles.tabLabelRow}>
        <DenseText
          style={[
            styles.tabLabel,
            focused ? {color: theme.text, fontWeight: '500'} : {color: theme.textDim},
          ]}
          numberOfLines={1}>
          {title}
        </DenseText>
        <TabDot count={dot} color={dotColor} />
      </View>
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
const TAB_CONTENT_HEIGHT = 68;

function Tabs() {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useUnreadTotal();
  const connected = useConnectedCount();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {height: TAB_CONTENT_HEIGHT + insets.bottom, paddingBottom: insets.bottom},
        ],
        // One slot, not two: the icon and the word are drawn together by TabItem, so
        // React Navigation's separate icon slot would only add a gap between them.
        tabBarIcon: () => null,
      }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: ({focused}) => (
            <TabItem
              icon="house"
              title="Home"
              focused={focused}
              dot={0}
              dotColor={theme.accent}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarAccessibilityLabel:
            unread > 0 ? `Chats, ${unread} unread` : 'Chats',
          tabBarLabel: ({focused}) => (
            <TabItem
              icon="chatBubble"
              title="Chats"
              focused={focused}
              dot={unread}
              dotColor={theme.accent}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{
          tabBarAccessibilityLabel:
            connected > 0 ? `Nearby, ${connected} connected` : 'Nearby',
          tabBarLabel: ({focused}) => (
            <TabItem
              icon="target"
              title="Nearby"
              focused={focused}
              dot={connected}
              dotColor={theme.ok}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Debug"
        component={DebugScreen}
        options={{
          tabBarLabel: ({focused}) => (
            <TabItem
              icon="code"
              title="Debug"
              focused={focused}
              dot={0}
              dotColor={theme.accent}
            />
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
  tabItem: {alignItems: 'center', gap: 4},
  tabLabelRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  tabLabel: {...typography.caption},
  tabDot: {width: 5, height: 5, borderRadius: 2.5},
}));
