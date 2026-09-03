import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {BottomTabScreenProps} from '@react-navigation/bottom-tabs';
import type {CompositeScreenProps} from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: undefined;
  /**
   * A conversation is either a peer (peerId) or a group (groupId). Exactly one is set;
   * the screen branches on which.
   */
  Chat: {peerId?: string; groupId?: string; displayName: string};
  NewGroup: undefined;
  /**
   * A drill-in screen, not a tab — reached from Home's profile menu, same as Chat and
   * NewGroup. Which category to land on and scroll to; omitted just opens at the top.
   */
  Settings: {section?: 'profile' | 'app' | 'system'} | undefined;
};

export type TabParamList = {
  Home: undefined;
  Chats: undefined;
  Nearby: undefined;
  Debug: undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

/**
 * Tab screens need to navigate to Chat, which lives in the parent stack, so their props
 * are the composite of both navigators.
 */
export type RootTabScreenProps<T extends keyof TabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<TabParamList, T>,
    NativeStackScreenProps<RootStackParamList>
  >;
