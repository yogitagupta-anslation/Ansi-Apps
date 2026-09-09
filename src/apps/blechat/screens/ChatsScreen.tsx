import React, {useMemo, useState} from 'react';
import {Alert, ScrollView, Text, TextInput, View} from 'react-native';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, Touchable} from '../components/Motion';
import {Card, EmptyState} from '../components/ui/Surface';
import {ConfirmSheet} from '../components/ConfirmSheet';
import {Screen} from '../components/ui/Screen';
import {GroupAvatar, InitialAvatar} from '../components/ui/Primitives';
import {Icon} from '../components/ui/Icon';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {toggleFavoritePeer, useAppStore} from '../state/appStore';
import {bleChat} from '../services/BleChatService';
import type {RootTabScreenProps} from '../navigation/types';

/**
 * Every conversation with history, one row each — split out from Home so it gets its own
 * screen's worth of room instead of competing with the dashboard for scroll space. Home
 * still owns "who am I / is Bluetooth working / start something new"; this is purely
 * "conversations I already have".
 *
 * A row's job is to answer "is this worth opening right now", and it does that with four
 * things: who, when, what was last said, and what state it is in. The when was missing
 * entirely before, which is the one thing a chat list is normally scanned by. The star
 * and the chevron that used to sit on the right have gone: the chevron said only that a
 * row is tappable (every row is), and the star moved into the row's long-press menu,
 * which frees the right edge for the timestamp and the unread count.
 */
export function ChatsScreen({navigation}: RootTabScreenProps<'Chats'>) {
  const styles = useStyles();
  const theme = useTheme();
  const conversations = useAppStore(s => s.conversations);
  const unread = useAppStore(s => s.unread);
  const groups = useAppStore(s => s.groups);
  const peers = useAppStore(s => s.peers);
  const favoritePeerIds = useAppStore(s => s.favoritePeerIds);
  const [query, setQuery] = useState('');

  const chats = useMemo(() => {
    const nameOf = (id: string) =>
      groups.find(g => g.id === id)?.name ??
      peers.find(p => p.peerId === id)?.displayName ??
      'Unknown';

    return Object.entries(conversations)
      .map(([conversationId, messages]) => {
        const last = messages.length ? messages[messages.length - 1] : null;
        const group = groups.find(g => g.id === conversationId);
        const members = group
          ? peers.filter(p => p.peerId !== null && group.members.includes(p.peerId))
          : [];
        const peer = peers.find(p => p.peerId === conversationId) ?? null;
        return {
          conversationId,
          groupId: group?.id,
          name: nameOf(conversationId),
          preview: last
            ? (last.direction === 'outgoing' ? 'You: ' : '') + last.text
            : '',
          at: last?.receivedAt ?? 0,
          unread: unread[conversationId] ?? 0,
          // Anything of yours still waiting to go out. It belongs on the preview line
          // because it is what will happen next in this conversation, and a row that
          // shows a chatty preview while two of your messages are stuck is misleading.
          queued: peer?.queuedCount ?? 0,
          online: group
            ? members.some(p => p.state === 'connected')
            : peers.some(
                p => p.peerId === conversationId && p.state === 'connected',
              ),
          reach: group
            ? `${members.filter(p => p.state === 'connected').length}/${
                group.members.length
              } reachable`
            : null,
          reachable: group
            ? members.filter(p => p.state === 'connected').length > 0
            : false,
          // Groups have no single identity to pin — favoriting is peer-specific.
          favorite: !group && favoritePeerIds.includes(conversationId),
        };
      })
      .filter(chat => chat.at > 0)
      .sort((a, b) => {
        if (a.favorite !== b.favorite) {
          return a.favorite ? -1 : 1;
        }
        return b.at - a.at;
      });
  }, [conversations, groups, peers, unread, favoritePeerIds]);

  /** Top few by how often you've actually connected — not recency, which the main list
   * already sorts by. This is "who do you talk to", surfaced as quick-tap chips. */
  const frequentPeers = useMemo(() => {
    return peers
      .filter(p => p.peerId && p.connectCount > 1)
      .sort((a, b) => b.connectCount - a.connectCount)
      .slice(0, 8);
  }, [peers]);

  /**
   * Name, or anything actually said in the conversation.
   *
   * This searched the preview line, which is only the most recent message — so the box
   * offering to search "names and messages" could not find a message unless it happened
   * to be the last one. Searching the stored thread is what the placeholder was already
   * promising, and it is the reason to have a search box at all: finding the address
   * somebody sent you an hour ago.
   */
  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return chats;
    }
    return chats.filter(c => {
      if (c.name.toLowerCase().includes(q)) {
        return true;
      }
      const thread = conversations[c.conversationId] ?? [];
      return thread.some(m => m.text.toLowerCase().includes(q));
    });
  }, [chats, query, conversations]);

  /**
   * The conversation waiting on a yes, with the count it will take with it.
   *
   * Held as state rather than confirmed inline because the number matters to the
   * decision: "delete 2 messages" and "delete 340 messages" are not the same question.
   */
  const [pendingDelete, setPendingDelete] = useState<{
    conversationId: string;
    name: string;
    count: number;
  } | null>(null);

  const reachableCount = peers.filter(p => p.state === 'connected').length;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <View style={styles.header}>
            <View style={styles.grow}>
              <AppText style={styles.title}>Chats</AppText>
              <DenseText style={styles.subtitle} numberOfLines={1}>
                {chats.length === 0
                  ? 'Nothing here yet'
                  : `${chats.length} conversation${chats.length === 1 ? '' : 's'} · ${
                      reachableCount
                    } peer${reachableCount === 1 ? '' : 's'} reachable`}
              </DenseText>
            </View>
            <Touchable
              scale={false}
              onPress={() => navigation.navigate('NewGroup')}
              style={styles.headerAction}
              accessibilityLabel="New group">
              <Icon name="plus" color={theme.accent} size={18} />
            </Touchable>
          </View>
        </FadeIn>

        <FadeIn index={1}>
          {/* Shown whenever there is anything to search. It used to wait for a third
              conversation, on the reasoning that a search box above two rows is clutter
              — true of the rows, but not of what is inside them: one conversation can
              hold a hundred messages, and a control people go looking for should not be
              hiding. */}
          {chats.length > 0 && (
            <View style={styles.searchBar}>
              <Icon name="search" color={theme.textFaint} size={15} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search names and messages"
                placeholderTextColor={theme.textFaint}
                returnKeyType="search"
                autoCorrect={false}
              />
              {query.length > 0 && (
                <Touchable
                  scale={false}
                  onPress={() => setQuery('')}
                  accessibilityLabel="Clear search"
                  hitSlop={8}>
                  <Text style={styles.searchClear}>✕</Text>
                </Touchable>
              )}
            </View>
          )}
        </FadeIn>

        {/* Presence rings rather than a muted avatar: "in range" now reads as something
            added to the row, not as the row being greyed out for an unstated reason. */}
        {frequentPeers.length > 0 && (
          <FadeIn index={2}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.frequentScroller}
              contentContainerStyle={styles.frequentRow}>
              {frequentPeers.map(peer => {
                const online = peer.state === 'connected';
                return (
                  <Touchable
                    key={peer.peerId}
                    scale={false}
                    onPress={() =>
                      navigation.navigate('Chat', {
                        peerId: peer.peerId!,
                        displayName: peer.displayName ?? 'Peer',
                      })
                    }
                    style={styles.frequentChip}>
                    <InitialAvatar
                      name={peer.displayName}
                      seed={peer.peerId ?? ''}
                      size={46}
                      online={online ? true : undefined}
                      ring={theme.bg}
                      bg={online ? undefined : theme.surfaceAlt}
                      fg={online ? undefined : theme.textFaint}
                    />
                    <DenseText
                      style={[
                        styles.frequentName,
                        {color: online ? theme.text : theme.textDim},
                      ]}
                      numberOfLines={1}>
                      {peer.displayName ?? 'Someone'}
                    </DenseText>
                  </Touchable>
                );
              })}
            </ScrollView>
          </FadeIn>
        )}

        <FadeIn index={3}>
          {chats.length === 0 ? (
            <EmptyState
              icon="chatBubble"
              title="No conversations yet"
              detail="Connect to someone on Nearby to start chatting, or create a group."
            />
          ) : (
            <Card padded={false} style={styles.listCard}>
              {visibleChats.length === 0 ? (
                <View style={styles.searchEmpty}>
                  <DenseText style={styles.searchEmptyText}>
                    No chats match &quot;{query}&quot;.
                  </DenseText>
                </View>
              ) : (
                visibleChats.map((chat, i) => (
                  <Touchable
                    key={chat.conversationId}
                    scale={false}
                    onPress={() =>
                      navigation.navigate('Chat', {
                        peerId: chat.groupId ? undefined : chat.conversationId,
                        groupId: chat.groupId,
                        displayName: chat.name,
                      })
                    }
                    onLongPress={() =>
                      Alert.alert(chat.name, undefined, [
                        ...(chat.groupId
                          ? []
                          : [
                              {
                                text: chat.favorite
                                  ? 'Remove from favourites'
                                  : 'Add to favourites',
                                onPress: () => toggleFavoritePeer(chat.conversationId),
                              },
                            ]),
                        {
                          text: 'Delete conversation',
                          style: 'destructive' as const,
                          // Not deleted here. The consequences are worth reading, and
                          // an OS alert has nowhere to put them.
                          onPress: () =>
                            setPendingDelete({
                              conversationId: chat.conversationId,
                              name: chat.name,
                              count: (conversations[chat.conversationId] ?? []).length,
                            }),
                        },
                        {text: 'Cancel', style: 'cancel' as const},
                      ])
                    }
                    style={i > 0 ? [styles.row, styles.rowDivided] : styles.row}>
                    {chat.groupId ? (
                      <GroupAvatar size={44} online={chat.reachable} />
                    ) : (
                      <InitialAvatar
                        name={chat.name}
                        seed={chat.conversationId}
                        size={44}
                        online={chat.online ? true : undefined}
                        bg={chat.online ? undefined : theme.surfaceAlt}
                        fg={chat.online ? undefined : theme.textFaint}
                      />
                    )}

                    <View style={styles.rowBody}>
                      <View style={styles.rowTop}>
                        <AppText style={styles.rowName} numberOfLines={1}>
                          {chat.name}
                        </AppText>
                        {chat.favorite ? (
                          <Icon name="starFilled" color={theme.tileAmberFg} size={13} />
                        ) : null}
                        {/* Reachability sits by the name, not in the preview: for a
                            group it is a property of who you are talking to, not of
                            what was last said. */}
                        {chat.reach ? (
                          <View
                            style={[
                              styles.reachPill,
                              {
                                backgroundColor: chat.reachable
                                  ? theme.tileGreen
                                  : theme.surfaceAlt,
                              },
                            ]}>
                            <DenseText
                              style={[
                                styles.reachText,
                                {
                                  color: chat.reachable
                                    ? theme.tileGreenFg
                                    : theme.textDim,
                                },
                              ]}
                              maxFontSizeMultiplier={1}>
                              {chat.reach}
                            </DenseText>
                          </View>
                        ) : null}
                        <View style={styles.grow} />
                        <DenseText
                          style={[
                            styles.rowTime,
                            chat.unread > 0 && {
                              color: theme.accent,
                              fontWeight: '700',
                            },
                          ]}
                          numberOfLines={1}>
                          {relativeStamp(chat.at)}
                        </DenseText>
                      </View>

                      <View style={styles.rowBottom}>
                        {chat.queued > 0 ? (
                          <>
                            <Icon name="clock" color={theme.tileAmberFg} size={12} />
                            <DenseText
                              style={[styles.rowQueued, {color: theme.tileAmberFg}]}
                              numberOfLines={1}>
                              {chat.queued} queued · {chat.preview}
                            </DenseText>
                          </>
                        ) : (
                          <DenseText
                            style={[
                              styles.rowPreview,
                              chat.unread > 0 && {
                                color: theme.text,
                                fontWeight: '600',
                              },
                            ]}
                            numberOfLines={1}>
                            {chat.preview}
                          </DenseText>
                        )}
                        {chat.unread > 0 ? (
                          <View style={styles.unreadBadge}>
                            <DenseText
                              style={styles.unreadText}
                              maxFontSizeMultiplier={1}>
                              {chat.unread > 99 ? '99+' : chat.unread}
                            </DenseText>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Touchable>
                ))
              )}
            </Card>
          )}
        </FadeIn>
      </ScrollView>
      <ConfirmSheet
        visible={pendingDelete !== null}
        icon="trash"
        title={`Delete this conversation?`}
        /**
         * Says what actually happens, including the part that surprises people: the
         * other phone keeps its copy. There is no server here, so "delete" reaches
         * exactly as far as this device and no further — and a person deciding whether
         * to delete a conversation with someone they just met deserves to know that
         * before they tap, not after.
         */
        body={
          pendingDelete
            ? `${pendingDelete.count} message${
                pendingDelete.count === 1 ? '' : 's'
              } with ${pendingDelete.name} will be removed from this phone. ${
                pendingDelete.name
              } keeps their copy — there is no server to delete it from, and this cannot be undone.`
            : ''
        }
        confirmLabel="Delete for me"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) {
            void bleChat.messages
              .clearConversation(target.conversationId)
              .catch(err =>
                Alert.alert(
                  'Could not delete',
                  err instanceof Error ? err.message : String(err),
                ),
              );
          }
        }}
      />
    </Screen>
  );
}

/**
 * Time today, weekday this week, date beyond that.
 *
 * A chat list is scanned, not read: "17:44" answers "did this just happen" instantly
 * where "2 hours ago" has to be worked out, and a bare clock on a three-week-old
 * conversation would be actively misleading.
 */
function relativeStamp(at: number): string {
  if (!at) {
    return '';
  }
  const then = new Date(at);
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) {
    return `${String(then.getHours()).padStart(2, '0')}:${String(
      then.getMinutes(),
    ).padStart(2, '0')}`;
  }
  const days = Math.floor((now.getTime() - at) / 86_400_000);
  if (days <= 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return then.toLocaleDateString(undefined, {weekday: 'short'});
  }
  return then.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
}

const useStyles = makeStyles(t => ({
  content: {padding: spacing.lg + 4, paddingBottom: spacing.xl, gap: spacing.lg},
  grow: {flex: 1},

  header: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  title: {fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: t.text},
  subtitle: {...typography.caption, color: t.textDim, marginTop: 2},
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  // `padding: 0` because Android gives TextInput its own vertical padding, which pushes
  // the text off-centre inside a fixed-height row.
  searchInput: {flex: 1, ...typography.body, fontSize: 14, color: t.text, padding: 0},
  searchClear: {color: t.textDim, fontSize: 14, fontWeight: '600'},

  frequentScroller: {flexGrow: 0, marginHorizontal: -(spacing.lg + 4)},
  frequentRow: {gap: 14, paddingHorizontal: spacing.lg + 4},
  frequentChip: {width: 56, alignItems: 'center', gap: 5},
  frequentName: {...typography.caption, fontSize: 11, fontWeight: '600'},

  listCard: {borderRadius: 20, overflow: 'hidden'},
  row: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 14},
  rowDivided: {borderTopWidth: 1, borderTopColor: t.divider},
  rowBody: {flex: 1, minWidth: 0},
  rowTop: {flexDirection: 'row', alignItems: 'center', gap: 6},
  rowName: {...typography.body, fontWeight: '700', color: t.text, flexShrink: 1},
  rowTime: {...typography.caption, color: t.textFaint, fontSize: 11},
  reachPill: {borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2},
  reachText: {fontSize: 10, fontWeight: '700'},
  rowBottom: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3},
  rowPreview: {...typography.caption, color: t.textDim, flex: 1},
  rowQueued: {...typography.caption, flex: 1},
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {...typography.caption, color: '#ffffff', fontSize: 11, fontWeight: '700'},

  searchEmpty: {padding: spacing.lg},
  searchEmptyText: {...typography.callout, color: t.textDim},
}));
