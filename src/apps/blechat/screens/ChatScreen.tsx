import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Clipboard,
  Keyboard,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Vibration,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  ConnectionIndicator,
  dotColor,
  LABELS as LINK_STATE_LABELS,
} from '../components/ConnectionIndicator';
import {GroupAvatar, SignalBars} from '../components/ui/Primitives';
import {MascotAvatar} from '../components/ui/Mascot';
import {MessageBubble} from '../components/MessageBubble';
import {MessageInput} from '../components/MessageInput';
import {MessageActionsSheet} from '../components/MessageActionsSheet';
import {Screen} from '../components/ui/Screen';
import {PeerProfileSheet} from '../components/PeerProfileSheet';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, SendIn, Touchable} from '../components/Motion';
import {Icon} from '../components/ui/Icon';
import {classifyBleError, describeFailure} from '../ble/LinkErrors';
import {qualityLabel} from '../peers/LinkMetrics';
import {avatarHue, elevation, radius, spacing, speakerTint, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {bleChat} from '../services/BleChatService';
import {useAppStore, useMessages} from '../state/appStore';
import type {ChatMessage} from '../types/Message';
import type {Peer} from '../types/Peer';
import type {Group} from '../messaging/Groups';
import type {RootStackParamList, RootStackScreenProps} from '../navigation/types';

/**
 * A short confirmation tick, not a buzz — kept to the few moments an action genuinely
 * completed (sent, connected, blocked). RN's built-in Vibration API needs no extra native
 * dependency, but on a phone without a real vibration motor (every emulator used this
 * session included) there is no way to feel whether this reads as a crisp tap or a dull
 * rumble — that part is genuinely unverified.
 */
function tick(): void {
  Vibration.vibrate(12);
}

/**
 * Lifts content above the software keyboard.
 *
 * KeyboardAvoidingView with behavior=undefined relies on the window being resized by
 * android:windowSoftInputMode="adjustResize". Android 15 ignores that for apps targeting
 * SDK 35+, because edge-to-edge is enforced regardless of edgeToEdgeEnabled — so on a
 * modern phone the composer simply ends up underneath the keyboard.
 *
 * This measures whether the container actually shrank when the keyboard appeared. If it
 * did, the OS handled it and no padding is added; if it did not, we add the padding
 * ourselves. That is correct on both old and new Android without double-compensating.
 */
function useKeyboardPadding(): {
  padding: number;
  onLayout: (e: LayoutChangeEvent) => void;
} {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [padding, setPadding] = useState(0);
  const heightBeforeKeyboard = useRef<number | null>(null);
  const currentHeight = useRef(0);
  const insets = useSafeAreaInsets();

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    currentHeight.current = e.nativeEvent.layout.height;
    if (heightBeforeKeyboard.current === null) {
      heightBeforeKeyboard.current = currentHeight.current;
    }
  }, []);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, e => {
      setKeyboardHeight(e.endCoordinates.height);
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
      const remaining = keyboardHeight - shrankBy - insets.bottom;
      setPadding(Math.max(0, remaining));
    }, 50);
    return () => clearTimeout(id);
  }, [keyboardHeight, insets.bottom]);

  return {padding, onLayout};
}

function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  if (dayKey(timestamp) === dayKey(today.getTime())) {
    return 'Today';
  }
  if (dayKey(timestamp) === dayKey(yesterday.getTime())) {
    return 'Yesterday';
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function ChatScreen({route, navigation}: RootStackScreenProps<'Chat'>) {
  const styles = useStyles();
  const theme = useTheme();
  /**
   * Read defensively, because this screen is opened from a list that can go stale.
   *
   * A peer can drop out of range, be forgotten, or lose its identity between the tap
   * that opened this screen and the moment it mounts. None of that is a reason to fail:
   * the thread is stored locally and is worth showing on its own, with the composer
   * reporting that there is nobody to send to. Destructuring `route.params` directly
   * threw when a route arrived without them at all.
   */
  const params = route.params ?? ({displayName: 'Chat'} as RootStackParamList['Chat']);
  const {peerId, groupId} = params;
  const displayName = params.displayName ?? 'Chat';

  // Exactly one of the two is set; everything below branches on which.
  const conversationId = groupId ?? peerId ?? null;
  const isGroup = groupId !== undefined;

  const messages = useMessages(conversationId);
  const peer = useAppStore(s =>
    peerId ? s.peers.find(p => p.peerId === peerId) ?? null : null,
  );
  const group = useAppStore(s => s.groups.find(g => g.id === groupId) ?? null);
  const peers = useAppStore(s => s.peers);

  const identity = useAppStore(st => st.identity);
  const myInterests = useAppStore(st => st.settings.interests);

  /**
   * peerId -> display name, for attributing group messages.
   *
   * Built from the peer list rather than the group's member ids, because the member list
   * is only ids — the names come from whoever we have handshaken with. A member we have
   * never met falls back to a short id, which is still better than nothing: it is stable,
   * and two different people never collapse into the same label.
   */
  const nameFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of peers) {
      if (p.peerId && p.displayName) {
        map.set(p.peerId, p.displayName);
      }
    }
    if (identity) {
      map.set(identity.peerId, identity.displayName);
    }
    return map;
  }, [peers, identity]);

  /** For a group, "connected" means at least one member is reachable right now. */
  const reachableMembers = useMemo(() => {
    if (!group) {
      return 0;
    }
    return peers.filter(
      p =>
        p.state === 'connected' &&
        p.peerId !== null &&
        group.members.includes(p.peerId),
    ).length;
  }, [group, peers]);
  // Captured once, on the very first render — before the markRead effect below has any
  // chance to run and advance the mark to "now". This is what "new since I last looked"
  // has to be measured against; reading it any later would always see 0 unread.
  const [openedReadMark] = useState(() =>
    conversationId ? bleChat.messages.readMarkFor(conversationId) : 0,
  );

  /**
   * Opening a conversation is what marks it read.
   *
   * Re-run when messages change so anything arriving while the screen is open does not
   * leave a badge behind the moment the user backs out.
   */
  useEffect(() => {
    if (conversationId) {
      bleChat.messages.markRead(conversationId);
    }
  }, [conversationId, messages]);

  /**
   * The first message that arrived after this conversation was last read — where the
   * "New messages" divider goes. Null on a conversation that was never read before
   * (openedReadMark === 0): every message in a brand-new conversation is technically
   * "unread", and a divider above the very first message ever exchanged would separate
   * nothing from nothing.
   */
  const firstUnreadId = useMemo(() => {
    if (openedReadMark === 0) {
      return null;
    }
    return (
      messages.find(m => m.direction === 'incoming' && m.receivedAt > openedReadMark)
        ?.id ?? null
    );
  }, [messages, openedReadMark]);

  /** Messages held in the outbox for this conversation, waiting for the peer to return. */
  const queuedCount = useAppStore(st =>
    st.peers
      .filter(p =>
        isGroup
          ? p.peerId !== null && (group?.members.includes(p.peerId) ?? false)
          : p.peerId === peerId,
      )
      .reduce((total, p) => total + p.queuedCount, 0),
  );

  const listRef = useRef<SectionList<ChatMessage>>(null);
  const {padding, onLayout} = useKeyboardPadding();

  const connected = isGroup ? reachableMembers > 0 : peer?.state === 'connected';

  /**
   * Grouped by calendar day. Without this, a conversation from last night reads as if it
   * happened moments ago — the screenshots showed 17:41 messages sitting under a 10:08
   * status bar with nothing to distinguish them.
   */
  const sections = useMemo(() => {
    const out: Array<{title: string; data: ChatMessage[]}> = [];
    for (const message of messages) {
      // Grouped by when WE received it, not by the sender's clock. A peer whose clock is
      // days out would otherwise drop its messages under a heading that never matches
      // when the conversation actually happened.
      const title = dayLabel(message.receivedAt);
      const last = out[out.length - 1];
      if (last && last.title === title) {
        last.data.push(message);
      } else {
        out.push({title, data: [message]});
      }
    }
    return out;
  }, [messages]);

  const scrollToEnd = useCallback(() => {
    const lastSection = sections.length - 1;
    if (lastSection < 0) {
      return;
    }
    listRef.current?.scrollToLocation({
      sectionIndex: lastSection,
      itemIndex: Math.max(0, sections[lastSection].data.length - 1),
      viewPosition: 1,
      animated: false,
    });
  }, [sections]);

  const [showJumpButton, setShowJumpButton] = useState(false);
  const NEAR_BOTTOM_PX = 120;
  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, contentSize, layoutMeasurement} = e.nativeEvent;
    const distanceFromBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height;
    setShowJumpButton(distanceFromBottom > NEAR_BOTTOM_PX);
  }, []);

  const onSend = useCallback(
    (text: string) => {
      tick();
      const send = groupId
        ? bleChat.messages.sendToGroup(groupId, text)
        : peerId
        ? bleChat.messages.send(peerId, text)
        : Promise.reject(new Error('This conversation has no peer to send to'));
      send.catch(err => {
        Alert.alert(
          'Send failed',
          err instanceof Error ? err.message : String(err),
        );
      });
    },
    [peerId, groupId],
  );

  const onRetry = useCallback(
    (message: ChatMessage) => {
      if (!conversationId) {
        return;
      }
      bleChat.messages.retry(conversationId, message.id).catch(() => undefined);
    },
    [conversationId],
  );

  /**
   * Long-press on a message.
   *
   * A sheet rather than an Alert: the design lifts the message itself above the menu,
   * which is what makes it obvious WHICH message is about to be acted on — an alert
   * titled "Message" over a thread of them is a guess.
   *
   * Reactions are deliberately not here. The frame shows a row of five, but nothing in
   * the protocol carries one — a reaction has to reach the other phone to mean anything,
   * and a row of buttons that changed only this screen would be a feature that quietly
   * does not work.
   */
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const onMessageActions = useCallback((message: ChatMessage) => {
    setActionsFor(message);
  }, []);

  const onBlockPeer = useCallback(() => {
    if (!peer?.peerId) {
      return;
    }
    const name = peer.displayName ?? displayName ?? 'this person';
    Alert.alert(
      `Block ${name}?`,
      "You won't connect to them again, and this link is closed now. " +
        'Undo this any time from Settings > Blocked.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            if (peer?.peerId) {
              bleChat.peerManager.blockPeer(peer.peerId);
            }
            navigation.goBack();
          },
        },
      ],
    );
  }, [peer, displayName, navigation]);

  const [membersVisible, setMembersVisible] = useState(false);

  const onLeaveGroup = useCallback(() => {
    if (!group) {
      return;
    }
    Alert.alert(
      `Leave ${group.name}?`,
      'Leaving is local to this phone. There is no server to remove you from anyone ' +
        "else's member list, so the others will keep sending — those messages will be " +
        'ignored, and the conversation is deleted here.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Leave group',
          style: 'destructive',
          onPress: () => {
            bleChat.messages
              .leaveGroup(group.id)
              .then(() => {
                setMembersVisible(false);
                navigation.goBack();
              })
              .catch(err =>
                Alert.alert(
                  'Could not leave',
                  err instanceof Error ? err.message : String(err),
                ),
              );
          },
        },
      ],
    );
  }, [group, navigation]);

  /**
   * Messages that already existed when this thread was opened.
   *
   * Only an outgoing message written *here* should be seen leaving the composer;
   * replaying that on every bubble in the history would animate a scroll, not a send.
   */
  const openedWith = useRef<Set<string> | null>(null);
  if (openedWith.current === null) {
    openedWith.current = new Set(messages.map(m => m.id));
  }

  const [profileVisible, setProfileVisible] = useState(false);
  const blockedPeerIds = useAppStore(st => st.blockedPeerIds);

  const onRetryConnect = useCallback(() => {
    if (!peer?.linkId) {
      return;
    }
    bleChat.peerManager.connect(peer.linkId).catch(err => {
      // Cancelling is not something to report back as a failure; see NearbyScreen.
      const failure = classifyBleError(err, 'connecting');
      if (failure.reason === 'Cancelled') {
        return;
      }
      Alert.alert('Could not connect', describeFailure(failure.toFailure()));
    });
  }, [peer]);

  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.flex} onLayout={onLayout}>
      {/*
        One header, not four strips.

        The name, who it is, whether the link is up, how good it is and what MTU it
        negotiated are all facts about the same conversation, so they belong in the same
        block. They used to be a header, a pill bar, a retry banner and a queued banner
        stacked above the first message — four chrome layers between opening a chat and
        reading it.
      */}
      <View style={styles.header}>
        <Touchable
          scale={false}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.headerIconButton}
          accessibilityLabel="Back">
          <Icon name="chevronLeft" color={theme.text} size={22} />
        </Touchable>

        <Touchable
          scale={false}
          disabled={isGroup ? false : !peer?.peerId}
          onPress={() => (isGroup ? setMembersVisible(true) : setProfileVisible(true))}
          style={styles.headerIdentity}
          accessibilityLabel={isGroup ? 'Group members' : 'View profile'}>
          {isGroup ? (
            <GroupAvatar size={40} online={reachableMembers > 0} />
          ) : (
            <MascotAvatar
              size={34}
              tint={avatarHue(theme, peer?.peerId ?? displayName).fg}
              status={connected ? theme.ok : null}
            />
          )}
          <View style={styles.headerText}>
            <View style={styles.headerNameRow}>
              <AppText style={styles.headerName} numberOfLines={1}>
                {group?.name ?? peer?.displayName ?? displayName}
              </AppText>
              {/* Every handshake is authenticated or the link never reaches
                  "connected" — this makes that proof visible rather than a silent
                  precondition. */}
              {!isGroup && peer?.authenticated ? (
                <Icon name="shield" color={theme.ok} size={14} strokeWidth={2} />
              ) : null}
            </View>

            {/* Line two carries everything the status pill bar used to: state first and
                in its own colour, then the quality word, then the negotiated MTU, then
                the bars. Nothing was dropped — it stopped being a separate strip. */}
            <View style={styles.headerMetaRow}>
              {isGroup ? (
                <DenseText style={styles.headerMeta} numberOfLines={1}>
                  <DenseText
                    style={[
                      styles.headerState,
                      {color: reachableMembers > 0 ? theme.ok : theme.textDim},
                    ]}>
                    {reachableMembers}/{group?.members.length ?? 1} reachable
                  </DenseText>
                  {' \u00b7 ' + (group?.members.length ?? 0) + ' members'}
                </DenseText>
              ) : (
                <>
                  <DenseText style={styles.headerMeta} numberOfLines={1}>
                    <DenseText
                      style={[
                        styles.headerState,
                        {
                          color: connected
                            ? theme.ok
                            : dotColor(peer?.state ?? 'disconnected', theme),
                        },
                      ]}>
                      {peer ? LINK_STATE_LABELS[peer.state] : 'Disconnected'}
                    </DenseText>
                    {connected && qualityLabel(peer?.metrics?.quality ?? null)
                      ? ' \u00b7 ' + qualityLabel(peer?.metrics?.quality ?? null)
                      : ''}
                    {peer?.gatt ? ' \u00b7 MTU ' + peer.gatt.mtu : ''}
                  </DenseText>
                  <SignalBars rssi={peer?.rssi ?? null} size="sm" />
                </>
              )}
            </View>
          </View>
        </Touchable>

        {/* The encryption warning keeps its own affordance rather than folding into the
            overflow menu: "anyone in range can read this" is not a setting. */}
        {!isGroup ? (
          <Touchable
            scale={false}
            onPress={() =>
              Alert.alert(
                'Not encrypted',
                'Messages travel as plaintext over the Bluetooth link. Anyone ' +
                  'intercepting the radio signal within range could read them. ' +
                  'End-to-end encryption is planned for a future phase — until then, ' +
                  "treat this the way you'd treat a conversation someone nearby " +
                  'could overhear.',
              )
            }
            style={styles.headerWarn}
            accessibilityLabel="About encryption">
            <Icon name="unlock" color={theme.tileAmberFg} size={15} />
          </Touchable>
        ) : null}

        {isGroup ? (
          <Touchable
            scale={false}
            onPress={() => setMembersVisible(true)}
            hitSlop={12}
            style={styles.headerIconButton}
            accessibilityLabel="Group options">
            <Icon name="more" color={theme.textFaint} size={20} />
          </Touchable>
        ) : (
          peer?.peerId && (
            <Touchable
              scale={false}
              onPress={onBlockPeer}
              hitSlop={12}
              style={styles.headerIconButton}
              accessibilityLabel="Block this person">
              <Icon name="more" color={theme.textFaint} size={20} />
            </Touchable>
          )
        )}
      </View>

      {/*
        Only for a genuinely stuck link — one with a recorded failure and a known
        address to redial. Auto-reconnect already handles a link that merely dropped;
        this is for the case it gave up, or was off, and nothing else is offering a
        way back in.
      */}
      {!isGroup && peer?.failure && peer.linkId && (
        <View style={styles.reconnectBanner}>
          <AppText style={styles.reconnectText} numberOfLines={2}>
            {describeFailure(peer.failure)}
          </AppText>
          <Touchable
            scale={false}
            onPress={onRetryConnect}
            style={styles.reconnectButton}>
            <Icon name="link" color={theme.tileAmberFg} size={13} />
            <DenseText style={styles.reconnectButtonText}>Retry</DenseText>
          </Touchable>
        </View>
      )}

      <View style={[styles.flex, {paddingBottom: padding}]}>
        <SectionList
          ref={listRef}
          style={styles.flex}
          sections={sections}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({section}) => (
            <View style={styles.dayHeader}>
              <AppText style={styles.dayLabel}>{section.title}</AppText>
            </View>
          )}
          onScroll={onListScroll}
          scrollEventThrottle={100}
          renderItem={({item}) => (
            <>
              {item.id === firstUnreadId && (
                <View style={styles.unreadSeparator}>
                  <View style={styles.unreadLine} />
                  <DenseText style={styles.unreadLabel}>NEW MESSAGES</DenseText>
                  <View style={styles.unreadLine} />
                </View>
              )}
              {/*
                Loss is marked, not hidden. The author numbers each message within the
                conversation, so a jump in that number is proof something never arrived —
                and a chat that silently reads as complete when it is not is worse than
                one that admits the hole.
              */}
              {item.missedBefore ? (
                <View style={styles.gap}>
                  <AppText style={styles.gapLabel}>
                    {item.missedBefore === 1
                      ? '1 message never arrived'
                      : `${item.missedBefore} messages never arrived`}
                  </AppText>
                </View>
              ) : null}
              <Entrance
                sent={
                  item.direction === 'outgoing' && !openedWith.current!.has(item.id)
                }>
                <MessageBubble
                  message={item}
                  onRetry={onRetry}
                  onLongPress={onMessageActions}
                  // Only in a group: in a one-to-one chat the header already names the
                  // only person who can be sending.
                  senderName={
                    // A name if we have one. Never a hex id — it tells the reader nothing
                    // and is the thing this screen is supposed to spare them.
                    isGroup
                      ? nameFor.get(item.originId) ?? 'Unknown member'
                      : undefined
                  }
                  senderTint={
                    isGroup ? speakerTint(theme, item.originId) : undefined
                  }
                />
              </Entrance>
            </>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <AppText style={styles.emptyText}>
                No messages yet.{'\n'}Anything you send travels directly over BLE to the
                other phone.
              </AppText>
            </View>
          }
          onContentSizeChange={scrollToEnd}
        />

        {showJumpButton && (
          <Touchable
            scale={false}
            onPress={() => {
              scrollToEnd();
              setShowJumpButton(false);
            }}
            style={styles.jumpButton}
            accessibilityLabel="Jump to latest message">
            <Icon name="arrowDown" color={theme.onAccent} size={16} />
          </Touchable>
        )}

        {/*
          Queued is not failed. Naming who it is waiting for is the difference between
          "something went wrong" and "this will send itself when Jaismeet is back".
        */}
        {queuedCount > 0 && (
          <View style={styles.queuedBanner}>
            <Icon name="clock" color={theme.tileAmberFg} size={13} />
            <DenseText style={styles.queuedText} numberOfLines={2}>
              {queuedCount} queued — they go out when{' '}
              {group?.name ?? peer?.displayName ?? displayName} is back in range
            </DenseText>
          </View>
        )}

        {/*
          You can keep typing while they are out of range.

          The composer used to be disabled whenever the link was down, which was gating a
          capability the transport already has: `MessageService.send` checks `canReach`
          and puts the message in the outbox as "pending", then delivers it for real when
          the link returns. Refusing the keystrokes made the app look less capable than it
          is, and — worse — turned a peer walking into the next room into a dead end.

          It stays disabled for a peer we have never completed a handshake with: there is
          no peerId to address, so there would be nothing to queue against.
        */}
        <MessageInput
          placeholder={`Message ${group?.name ?? peer?.displayName ?? displayName}`}
          enabled={isGroup || peer?.peerId != null}
          queueing={!connected}
          queueingReason={
            isGroup
              ? 'No member is in range. Messages wait here and send themselves when one is.'
              : `You can keep typing. Messages send themselves when ${
                  peer?.displayName ?? displayName
                } is back in range.`
          }
          disabledReason="Say hi on Nearby first — there is nobody to address this to yet."
          tone={!isGroup && peer ? dotColor(peer.state, theme) : undefined}
          onSend={onSend}
        />
      </View>

      <MessageActionsSheet
        message={actionsFor}
        onClose={() => setActionsFor(null)}
        onCopy={() => {
          if (actionsFor) {
            try {
              Clipboard.setString(actionsFor.text);
            } catch (err) {
              Alert.alert('Could not copy', 'This phone would not let the app use the clipboard.');
            }
          }
          setActionsFor(null);
        }}
        onRetry={() => {
          if (actionsFor) {
            onRetry(actionsFor);
          }
          setActionsFor(null);
        }}
        onDelete={() => {
          if (actionsFor && conversationId) {
            bleChat.messages.deleteLocal(conversationId, actionsFor.id);
          }
          setActionsFor(null);
        }}
      />

      {isGroup && group && (
        <GroupMembersSheet
          visible={membersVisible}
          group={group}
          peers={peers}
          nameFor={nameFor}
          onClose={() => setMembersVisible(false)}
          onLeave={onLeaveGroup}
        />
      )}
      {!isGroup && peer?.peerId && (
        <PeerProfileSheet
          visible={profileVisible}
          peer={peer}
          myInterests={myInterests}
          blocked={blockedPeerIds.includes(peer.peerId)}
          onClose={() => setProfileVisible(false)}
          onBlock={() => {
            setProfileVisible(false);
            onBlockPeer();
          }}
          onUnblock={() => {
            if (peer.peerId) {
              bleChat.peerManager.unblockPeer(peer.peerId);
            }
          }}
        />
      )}
      </View>
    </Screen>
  );
}

/**
 * A bubble arrives one of two ways.
 *
 * Something you just wrote travels up out of the composer; everything else settles in
 * the way the rest of the app's content does. Same component so the choice is made in
 * one place rather than duplicated at the call site.
 */
function Entrance({sent, children}: {sent: boolean; children: React.ReactNode}) {
  return sent ? <SendIn>{children}</SendIn> : <FadeIn>{children}</FadeIn>;
}

/**
 * Who is in the group and how reachable each of them is right now — a real list with a
 * live connection badge per member, not a wall of names in an Alert.
 */
function GroupMembersSheet({
  visible,
  group,
  peers,
  nameFor,
  onClose,
  onLeave,
}: {
  visible: boolean;
  group: Group;
  peers: Peer[];
  nameFor: Map<string, string>;
  onClose: () => void;
  onLeave: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.sheetBackdrop}>
        {/* Plain Pressable, not the animated Touchable: this is an invisible full-screen
            tap target with nothing to give press feedback on. */}
        <Pressable
          onPress={onClose}
          style={styles.sheetBackdropTouch}
          accessibilityLabel="Close"
        />
        {/* The Modal renders outside this screen's own SafeAreaView, so the sheet must
            reserve the bottom gesture-nav inset itself — otherwise the destructive "Leave
            group" button sits right under a phone's gesture strip. */}
        <View
          style={[
            styles.sheetCard,
            {paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md)},
          ]}>
          <View style={styles.sheetHeader}>
            <AppText style={styles.sheetTitle} numberOfLines={1}>
              {group.name}
            </AppText>
            <Touchable
              scale={false}
              onPress={onClose}
              hitSlop={12}
              style={styles.headerIconButton}
              accessibilityLabel="Close">
              <Icon name="close" color={theme.textDim} size={18} />
            </Touchable>
          </View>
          <DenseText style={styles.sheetSubtitle}>
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </DenseText>

          <View style={styles.sheetList}>
            {group.members.map(memberId => {
              const memberPeer = peers.find(p => p.peerId === memberId);
              return (
                <View key={memberId} style={styles.memberRow}>
                  <View
                    style={[
                      styles.memberDot,
                      {backgroundColor: speakerTint(theme, memberId)},
                    ]}
                  />
                  <AppText style={styles.memberName} numberOfLines={1}>
                    {nameFor.get(memberId) ?? 'Someone you have not met'}
                  </AppText>
                  <ConnectionIndicator state={memberPeer?.state ?? 'disconnected'} />
                </View>
              );
            })}
          </View>

          <Touchable
            scale={false}
            onPress={onLeave}
            style={styles.leaveButton}
            accessibilityLabel="Leave group">
            <Icon name="block" color={theme.error} size={14} />
            <DenseText style={styles.leaveButtonText}>Leave group</DenseText>
          </Touchable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  flex: {flex: 1},
  // On the page, with a hairline under it. It used to be a second plane in `surface`,
  // which made the top of every thread a slab of a different colour before a single
  // message; the hairline alone does the separating now.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: t.bg,
    borderBottomWidth: 1,
    borderBottomColor: t.divider,
  },
  headerIconButton: {padding: 4},
  headerIdentity: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11},
  headerText: {flex: 1, minWidth: 0},
  headerNameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  headerName: {...typography.headline, color: t.text, flexShrink: 1},
  headerMetaRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2},
  headerMeta: {...typography.caption, color: t.textDim, fontSize: 12, flexShrink: 1},
  headerState: {fontWeight: '400'},
  headerWarn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.tileAmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {paddingVertical: spacing.md, flexGrow: 1},
  dayHeader: {alignItems: 'center', marginVertical: spacing.md},
  dayLabel: {
    ...typography.caption,
    color: t.textFaint,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  // Sits with the composer, because that is what it is about: it explains what will
  // happen to what you type next, not something that happened in the thread.
  queuedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
  },
  queuedText: {
    ...typography.caption,
    color: t.tileAmberFg,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  gap: {alignItems: 'center', marginVertical: spacing.sm},
  gapLabel: {
    ...typography.caption,
    color: t.tileAmberFg,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: t.tileAmber,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  empty: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl},
  emptyText: {color: t.textDim, textAlign: 'center', fontSize: 14},

  unreadSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  unreadLine: {flex: 1, height: 1, backgroundColor: t.accent + '44'},
  unreadLabel: {
    ...typography.caption,
    color: t.accent,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  jumpButton: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation(t, 2),
  },

  reconnectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.tileAmber,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reconnectText: {...typography.caption, color: t.text, flex: 1},
  reconnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  reconnectButtonText: {...typography.caption, color: t.tileAmberFg, fontWeight: '700'},

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetBackdropTouch: {...StyleSheet.absoluteFill},
  sheetCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '75%',
  },
  sheetHeader: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  sheetTitle: {...typography.title, color: t.text, flex: 1},
  sheetSubtitle: {...typography.caption, color: t.textDim, marginTop: 2},
  sheetList: {marginTop: spacing.md},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  memberDot: {width: 8, height: 8, borderRadius: 4},
  memberName: {...typography.callout, color: t.text, flex: 1, fontWeight: '600'},
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: t.error,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + 2,
  },
  leaveButtonText: {...typography.callout, color: t.error, fontWeight: '700'},
}));
