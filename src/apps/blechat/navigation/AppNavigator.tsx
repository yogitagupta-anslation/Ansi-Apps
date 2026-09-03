import React from 'react';
import {StyleSheet, View} from 'react-native';
import {DenseText} from '../components/AppText';
import {
  ThemeProvider as NavigationThemeProvider,
  DarkTheme,
  DefaultTheme,
} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {Icon, type IconName} from '../components/ui/Icon';
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
 * Only the focused tab carries colour — every inactive icon sits in the same neutral
 * grey. That is what makes the row read as "here is where you are" rather than four
 * permanently lit destinations; a bar where nothing is grey has nothing left to
 * highlight. The active icon sits in a soft filled lozenge rather than a circle:
 * wider than it is tall, it reads as a selected segment instead of a button.
 */
function TabIcon({
  icon,
  focused,
  activeColor,
}: {
  icon: IconName;
  focused: boolean;
  activeColor: string;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={[styles.tabIconWrap, focused && {backgroundColor: theme.accentSoft}]}>
      <Icon name={icon} color={focused ? activeColor : theme.textFaint} size={19} />
    </View>
  );
}

function NearbyTabIcon({focused, activeColor}: {focused: boolean; activeColor: string}) {
  const styles = useStyles();
  const theme = useTheme();
  const count = useAppStore(s => s.peers.filter(p => p.state === 'connected').length);
  return (
    <View>
      <TabIcon icon="target" focused={focused} activeColor={activeColor} />
      {count > 0 && (
        <View style={[styles.badge, {backgroundColor: theme.ok}]}>
          {/* Fixed 16x16 circle — a scaled-up count would spill out of it, so this one
              stays at native size rather than following the dense cap. */}
          <DenseText style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
            {count}
          </DenseText>
        </View>
      )}
    </View>
  );
}

function ChatsTabIcon({focused, activeColor}: {focused: boolean; activeColor: string}) {
  const styles = useStyles();
  const theme = useTheme();
  const unreadTotal = useAppStore(s =>
    Object.values(s.unread).reduce((sum, n) => sum + n, 0),
  );
  return (
    <View>
      <TabIcon icon="chatBubble" focused={focused} activeColor={activeColor} />
      {unreadTotal > 0 && (
        <View style={[styles.badge, {backgroundColor: theme.accent}]}>
          <DenseText style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </DenseText>
        </View>
      )}
    </View>
  );
}

/** Weight, not decoration, marks the focused label — the lozenge above it does the rest. */
function TabLabel({
  title,
  focused,
  color,
}: {
  title: string;
  focused: boolean;
  color: string;
}) {
  const styles = useStyles();
  return (
    <DenseText
      style={[styles.tabLabel, {color, fontWeight: focused ? '700' : '600'}]}
      numberOfLines={1}>
      {title}
    </DenseText>
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
const TAB_CONTENT_HEIGHT = 70;

function Tabs() {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // One accent for every focused tab, not a colour per destination — only a single hue
  // is ever lit at a time, on whichever tab is actually current.
  const renderHomeIcon = ({focused}: {focused: boolean}) => (
    <TabIcon icon="house" focused={focused} activeColor={theme.accent} />
  );
  const renderChatsIcon = ({focused}: {focused: boolean}) => (
    <ChatsTabIcon focused={focused} activeColor={theme.accent} />
  );
  const renderNearbyIcon = ({focused}: {focused: boolean}) => (
    <NearbyTabIcon focused={focused} activeColor={theme.accent} />
  );
  const renderDebugIcon = ({focused}: {focused: boolean}) => (
    <TabIcon icon="code" focused={focused} activeColor={theme.accent} />
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {height: TAB_CONTENT_HEIGHT + insets.bottom, paddingBottom: insets.bottom},
        ],
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textFaint,
      }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: renderHomeIcon,
          tabBarLabel: ({focused, color}) => (
            <TabLabel title="Home" focused={focused} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Chats"
        component={ChatsScreen}
        options={{
          tabBarIcon: renderChatsIcon,
          tabBarLabel: ({focused, color}) => (
            <TabLabel title="Chats" focused={focused} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Nearby"
        component={NearbyScreen}
        options={{
          tabBarIcon: renderNearbyIcon,
          tabBarLabel: ({focused, color}) => (
            <TabLabel title="Nearby" focused={focused} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Debug"
        component={DebugScreen}
        options={{
          tabBarIcon: renderDebugIcon,
          tabBarLabel: ({focused, color}) => (
            <TabLabel title="Debug" focused={focused} color={color} />
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
    backgroundColor: t.surface,
    // Hairline, not 1px: at the top of the bar a full pixel reads as a drawn line
    // rather than the edge of a surface.
    borderTopColor: t.divider,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabIconWrap: {
    width: 44,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {fontSize: 11, marginTop: 3},
  badge: {
    position: 'absolute',
    right: 4,
    top: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {color: '#ffffff', fontSize: 10, fontWeight: '700'},
}));
