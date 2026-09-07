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
   * Also the "You" tab. Kept as a stack route as well, so a deep link can open it at a
   * particular category; omitted just opens at the top.
   */
  Settings: {section?: 'profile' | 'app' | 'system'} | undefined;
  /** Diagnostics, reached from You. A drill-in rather than a tab of its own. */
  Debug: undefined;
  /** The two profile pickers. Same screen, different catalogue. */
  InterestPicker: undefined;
  LanguagePicker: undefined;
};

/**
 * Three tabs, as the design draws them.
 *
 * Home's contents moved onto Nearby — it was a summary of a screen one tap away — and
 * Debug moved under You as "Advanced". Neither was removed; they stopped being
 * destinations of their own.
 */
export type TabParamList = {
  Nearby: undefined;
  Chats: undefined;
  You: undefined;
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
