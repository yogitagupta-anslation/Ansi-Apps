import React from 'react';
import {View} from 'react-native';
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
 * Only the focused tab carries colour — every inactive icon sits in the same neutral grey.
 * That is what makes the row read as "here is where you are" rather than four permanently
 * lit destinations; a bar where nothing is grey has nothing left to highlight. The active
 * icon also sits inside a soft filled circle, with a small dot under the label — both
 * reserved for the one tab that is actually current.
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
    <View
      style={[
        styles.tabIconWrap,
        focused && {backgroundColor: theme.glow},
      ]}>
      <Icon name={icon} color={focused ? activeColor : theme.textDim} size={20} />
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
        <View style={[styles.badge, {backgroundColor: theme.tileGreenFg}]}>
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
        <View style={[styles.badge, {backgroundColor: theme.tilePurpleFg}]}>
          <DenseText style={styles.badgeText} numberOfLines={1} maxFontSizeMultiplier={1}>
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </DenseText>
        </View>
      )}
    </View>
  );
}

/** Label plus a small dot underneath, shown only for the focused tab. */
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
    <View style={styles.labelWrap}>
      <DenseText style={[styles.tabLabel, {color}]} numberOfLines={1}>
        {title}
      </DenseText>
      {focused ? <View style={[styles.tabDot, {backgroundColor: color}]} /> : null}
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
const TAB_CONTENT_HEIGHT = 62;

function Tabs() {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // One accent for every focused tab, not a colour per destination — the reference only
  // ever shows a single hue (purple) lit up at a time, on whichever tab is active.
  const renderHomeIcon = ({focused}: {focused: boolean}) => (
    <TabIcon icon="house" focused={focused} activeColor={theme.tilePurpleFg} />
  );
  const renderChatsIcon = ({focused}: {focused: boolean}) => (
    <ChatsTabIcon focused={focused} activeColor={theme.tilePurpleFg} />
  );
  const renderNearbyIcon = ({focused}: {focused: boolean}) => (
    <NearbyTabIcon focused={focused} activeColor={theme.tilePurpleFg} />
  );
  const renderDebugIcon = ({focused}: {focused: boolean}) => (
    <TabIcon icon="code" focused={focused} activeColor={theme.tilePurpleFg} />
  );

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          {height: TAB_CONTENT_HEIGHT + insets.bottom, paddingBottom: insets.bottom},
        ],
        tabBarActiveTintColor: theme.tilePurpleFg,
        tabBarInactiveTintColor: theme.textDim,
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
    borderTopColor: t.border,
    borderTopWidth: 1,
    // No fixed height or bottom padding: React Navigation derives those from the
    // bottom safe-area inset, and overriding them puts the labels underneath the
    // gesture bar on devices with navigation gestures.
    paddingTop: 6,
  },
  tabIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: {alignItems: 'center', marginTop: 2},
  tabLabel: {fontSize: 11, fontWeight: '700'},
  tabDot: {width: 4, height: 4, borderRadius: 2, marginTop: 3},
  badge: {
    position: 'absolute',
    right: -8,
    top: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {color: '#ffffff', fontSize: 10, fontWeight: '700'},
}));
