import React, {useMemo, useState} from 'react';
import {ScrollView, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppText, DenseText} from '../components/AppText';
import {FadeIn, Touchable} from '../components/Motion';
import {Card, EmptyState} from '../components/ui/Surface';
import {PeerAvatar} from '../components/ui/Primitives';
import {Icon} from '../components/ui/Icon';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {toggleFavoritePeer, useAppStore} from '../state/appStore';
import type {RootTabScreenProps} from '../navigation/types';

/**
 * Every conversation with history, one row each — split out from Home so it gets its own
 * screen's worth of room instead of competing with the dashboard for scroll space. Home
 * still owns "who am I / is Bluetooth working / start something new"; this is purely
 * "conversations I already have".
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
        return {
          conversationId,
          groupId: group?.id,
          name: nameOf(conversationId),
          preview: last
            ? (last.direction === 'outgoing' ? 'You: ' : '') + last.text
            : '',
          at: last?.receivedAt ?? 0,
          unread: unread[conversationId] ?? 0,
          online: group
            ? peers.some(
                p =>
                  p.state === 'connected' &&
                  p.peerId !== null &&
                  group.members.includes(p.peerId),
              )
            : peers.some(
                p => p.peerId === conversationId && p.state === 'connected',
              ),
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

  /** Name or last-message match, case-insensitive — the two things worth finding a chat by. */
  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return chats;
    }
    return chats.filter(
      c => c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q),
    );
  }, [chats, query]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FadeIn>
          <AppText style={styles.title}>Chats</AppText>
          <DenseText style={styles.subtitle}>
            {chats.length === 0
              ? 'Nothing here yet'
              : `${chats.length} conversation${chats.length === 1 ? '' : 's'}`}
          </DenseText>
        </FadeIn>

        {frequentPeers.length > 0 && (
          <FadeIn index={1}>
            <DenseText style={styles.frequentLabel}>FREQUENTLY CONTACTED</DenseText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.frequentRow}>
              {frequentPeers.map(peer => (
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
                  <PeerAvatar size={40} muted={peer.state !== 'connected'} />
                  <DenseText style={styles.frequentName} numberOfLines={1}>
                    {peer.displayName ?? 'Someone'}
                  </DenseText>
                </Touchable>
              ))}
            </ScrollView>
          </FadeIn>
        )}

        <FadeIn index={2}>
          {/* Only worth showing once there is more than a couple to look through — below
              that a search box is one more thing on screen for nothing. */}
          {chats.length > 2 && (
            <View style={styles.searchBar}>
              <Icon name="search" color={theme.textDim} size={15} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search chats"
                placeholderTextColor={theme.textDim}
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

          {chats.length === 0 ? (
            <EmptyState
              glyph="✉"
              title="No conversations yet"
              detail="Connect to someone on Nearby to start chatting, or create a group."
            />
          ) : (
            <Card padded={false}>
              {visibleChats.length === 0 ? (
                <View style={styles.searchEmpty}>
                  <DenseText style={styles.searchEmptyText}>
                    No chats match "{query}".
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
                    style={i > 0 ? styles.rowDivided : styles.row}>
                    <PeerAvatar size={38} muted={!chat.online} />
                    <View style={styles.grow}>
                      <View style={styles.rowTop}>
                        <AppText style={styles.rowName} numberOfLines={1}>
                          {chat.name}
                        </AppText>
                        {chat.unread > 0 ? (
                          <View
                            style={[
                              styles.unreadBadge,
                              {backgroundColor: theme.tilePurpleFg},
                            ]}>
                            <DenseText style={styles.unreadText}>
                              {chat.unread > 99 ? '99+' : chat.unread}
                            </DenseText>
                          </View>
                        ) : null}
                      </View>
                      {chat.preview ? (
                        <DenseText style={styles.rowMeta} numberOfLines={1}>
                          {chat.preview}
                        </DenseText>
                      ) : null}
                    </View>
                    {!chat.groupId && (
                      <Touchable
                        scale={false}
                        onPress={() => toggleFavoritePeer(chat.conversationId)}
                        hitSlop={8}
                        accessibilityLabel={
                          chat.favorite ? 'Remove from favorites' : 'Add to favorites'
                        }>
                        <Icon
                          name={chat.favorite ? 'starFilled' : 'star'}
                          color={chat.favorite ? theme.tileAmberFg : theme.textDim}
                          size={16}
                        />
                      </Touchable>
                    )}
                    <Icon name="chevronRight" color={theme.textDim} size={16} />
                  </Touchable>
                ))
              )}
            </Card>
          )}
        </FadeIn>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},
  title: {...typography.display, color: t.text},
  subtitle: {...typography.caption, color: t.textDim, marginTop: 2, marginBottom: spacing.lg},

  frequentLabel: {...typography.overline, color: t.textDim, marginBottom: spacing.sm},
  frequentRow: {gap: spacing.md, paddingBottom: spacing.lg, paddingRight: spacing.lg},
  frequentChip: {alignItems: 'center', width: 60},
  frequentName: {
    ...typography.caption,
    color: t.text,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    marginBottom: spacing.sm,
  },
  searchInput: {...typography.body, color: t.text, flex: 1, padding: 0},
  searchClear: {color: t.textDim, fontSize: 13},
  searchEmpty: {paddingHorizontal: spacing.lg, paddingVertical: spacing.lg},
  searchEmptyText: {...typography.caption, color: t.textDim, textAlign: 'center'},

  grow: {flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowDivided: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.border,
  },
  rowTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  rowName: {...typography.headline, color: t.text, flexShrink: 1},
  rowMeta: {...typography.caption, color: t.textDim, marginTop: 1},

  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {color: '#ffffff', fontSize: 11, fontWeight: '700'},
}));
