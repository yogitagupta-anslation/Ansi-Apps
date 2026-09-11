/**
 * Connection Space — the conversation with someone you actually met.
 *
 * Written against EventPulse's own theme and primitives rather than lifted from
 * BleChat's `ChatScreen`, which is bound to BleChat's store, navigation and
 * theme. What is borrowed is the shape every messaging app shares — a header
 * that says who and whether you can reach them, bubbles that lean left and
 * right, a composer pinned to the keyboard — not the code.
 *
 * The screen knows nothing about Bluetooth. It calls `actions.sendChatMessage`
 * and subscribes to `conversations`; whether that turns into a GATT write, over
 * which link, fragmented into how many frames, is none of its business.
 *
 * Two honesty rules it does keep:
 *  - A message shows as sending until the transport says otherwise, and shows
 *    as failed when it says so. It never claims a delivery it did not observe.
 *  - History stays on screen when the link drops. The composer says it cannot
 *    send; the conversation does not vanish, because it did happen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { AppText, Button } from '../components/primitives';
import type { ConversationMessage } from '../connections/ConversationService';
import { MAX_CHAT_TEXT_BYTES } from '../connections/ChatProtocol';
import { actions, conversations, queries } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, typography } from '../theme/tokens';
import type { ProfileId } from '../types';

/**
 * Lifts the composer above the software keyboard.
 *
 * Ported from BleChat's `ChatScreen` (`blechat/screens/ChatScreen.tsx:56-121`),
 * because it encodes something that is not obvious and is expensive to
 * rediscover: `KeyboardAvoidingView` with `behavior=undefined` relies on the
 * window being resized by `android:windowSoftInputMode="adjustResize"`, and
 * Android 15 ignores that for apps targeting SDK 35+ — edge-to-edge is enforced
 * regardless. The manifest here does set `adjustResize`, and on a modern phone
 * it is simply not honoured, so the composer ends up underneath the keyboard.
 *
 * Rather than guess which era the phone belongs to, this measures whether the
 * container actually shrank when the keyboard appeared. If it did, the OS
 * handled it and nothing is added; if it did not, the padding is added here.
 * That is correct on both, without double-compensating on either.
 */
function useKeyboardPadding(): { padding: number; onLayout: (e: LayoutChangeEvent) => void } {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [padding, setPadding] = useState(0);
  const heightBeforeKeyboard = useRef<number | null>(null);
  const currentHeight = useRef(0);
  const insets = useSafeAreaInsets();

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    currentHeight.current = event.nativeEvent.layout.height;
    if (heightBeforeKeyboard.current === null) {
      heightBeforeKeyboard.current = currentHeight.current;
    }
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
      heightBeforeKeyboard.current = currentHeight.current;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardHeight === 0) {
      setPadding(0);
      return;
    }
    // Give the window a frame to resize itself, then decide.
    const id = setTimeout(() => {
      const before = heightBeforeKeyboard.current ?? currentHeight.current;
      const shrankBy = Math.max(0, before - currentHeight.current);
      // Anything the OS already absorbed does not need padding from us.
      setPadding(Math.max(0, keyboardHeight - shrankBy - insets.bottom));
    }, 50);
    return () => clearTimeout(id);
  }, [keyboardHeight, insets.bottom]);

  return { padding, onLayout };
}

export function ConnectionSpaceScreen({
  profileId,
  name,
  subtitle,
  onBack,
}: {
  profileId: ProfileId;
  /** Their name, already resolved by the caller from the directory or their card. */
  name: string;
  subtitle?: string;
  onBack: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [messages, setMessages] = useState<ConversationMessage[]>(() =>
    queries.conversation(profileId),
  );
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ConversationMessage>>(null);
  const keyboard = useKeyboardPadding();

  const reachable = queries.canChat(profileId);

  useEffect(() => {
    void actions.openConversation(profileId).then(setMessages);

    // Incoming messages arrive on the radio, not from a refresh. Subscribing is
    // what makes them appear while the screen is open.
    return conversations.subscribe((changed, next) => {
      if (changed === profileId) setMessages(next);
    });
  }, [profileId]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;

    setSending(true);
    setDraft('');
    haptics.select();
    await actions.sendChatMessage(profileId, text);
    setSending(false);
  }, [draft, profileId, sending]);

  const renderMessage = useCallback(
    ({ item }: { item: ConversationMessage }) => (
      <MessageBubble
        message={item}
        onRetry={() => void actions.retryChatMessage(profileId, item.id)}
      />
    ),
    [profileId],
  );

  const empty = useMemo(
    () => (
      <View style={styles.empty}>
        <AppText variant="body" tone="secondary" style={styles.centred}>
          {`This is the start of your conversation with ${name}.`}
        </AppText>
        <AppText variant="caption" tone="tertiary" style={styles.centred}>
          Messages travel directly between your two phones over Bluetooth. Nothing is uploaded
          anywhere.
        </AppText>
      </View>
    ),
    [name],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* ------------------------------------------------ header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to connections"
          onPress={onBack}
          style={styles.back}
        >
          <AppText variant="heading" tone="secondary">
            ‹
          </AppText>
        </Pressable>

        <Avatar name={name} size="list" />

        <View style={styles.identity}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="caption" tone={reachable ? 'secondary' : 'tertiary'} numberOfLines={1}>
            {reachable ? 'Connected · nearby' : 'Not in range'}
          </AppText>
          {subtitle ? (
            <AppText variant="micro" tone="tertiary" numberOfLines={1}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      <View style={styles.body} onLayout={keyboard.onLayout}>
        {/* ---------------------------------------------- messages */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={
            messages.length === 0 ? styles.emptyList : styles.list
          }
          ListEmptyComponent={empty}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />

        {/* ---------------------------------------------- composer */}
        {!reachable ? (
          <View style={[styles.notice, { borderTopColor: colors.border }]}>
            <AppText variant="caption" tone="tertiary">
              Out of range. Your conversation is still here — you can send again when you are back
              near each other.
            </AppText>
          </View>
        ) : null}

        <View style={[styles.composer, { borderTopColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={MAX_CHAT_TEXT_BYTES}
            editable={reachable}
            style={[
              styles.input,
              typography.body,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
                color: colors.textPrimary,
              },
            ]}
          />
          <Button
            label="Send"
            onPress={() => void send()}
            disabled={!reachable || draft.trim().length === 0 || sending}
          />
        </View>

        {/* Only ever non-zero when the OS did not resize the window itself. */}
        <View style={{ height: keyboard.padding }} />
      </View>
    </SafeAreaView>
  );
}

/**
 * The time on the bubble, not how long ago it was.
 *
 * A conversation is read as a sequence, so "14:32" places a message against the
 * ones around it in a way "3 minutes ago" cannot — and it does not go stale
 * while the screen is open.
 */
function clockTime(at: number): string {
  const date = new Date(at);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function MessageBubble({
  message,
  onRetry,
}: {
  message: ConversationMessage;
  onRetry: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const mine = message.mine;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        style={[
          styles.bubble,
          mine
            ? { backgroundColor: colors.accent, borderBottomRightRadius: radius.sm }
            : {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderWidth: 1,
                borderBottomLeftRadius: radius.sm,
              },
        ]}
      >
        <AppText variant="body" style={mine ? { color: colors.accentText } : undefined}>
          {message.text}
        </AppText>
      </View>

      <View style={styles.meta}>
        <AppText variant="micro" tone="tertiary">
          {clockTime(message.at)}
        </AppText>
        {message.status === 'sending' ? (
          <AppText variant="micro" tone="tertiary">
            {' · sending'}
          </AppText>
        ) : null}
        {message.status === 'failed' ? (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <AppText variant="micro" style={{ color: colors.danger }}>
              {' · not sent — tap to retry'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: space.sm,
    paddingBottom: space.sm,
    paddingHorizontal: space.md,
  },
  back: { paddingHorizontal: space.xs, paddingVertical: space.xs },
  identity: { flex: 1, gap: 2 },
  body: { flex: 1 },
  list: { gap: space.sm, padding: space.md },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  empty: { gap: space.sm },
  centred: { textAlign: 'center' },
  row: { maxWidth: '82%' },
  rowMine: { alignItems: 'flex-end', alignSelf: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start', alignSelf: 'flex-start' },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  meta: { flexDirection: 'row', paddingHorizontal: space.xs, paddingTop: 2 },
  notice: { borderTopWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm },
  composer: {
    alignItems: 'flex-end',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: space.sm,
    padding: space.md,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});
