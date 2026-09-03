import React, {useMemo} from 'react';
import {SectionList, View} from 'react-native';
import {spacing} from '../config/theme';
import {makeStyles} from '../theme/ThemeProvider';
import type {Peer} from '../types/Peer';
import {PeerCard} from './PeerCard';
import {AppText, DenseText} from './AppText';

interface Props {
  peers: Peer[];
  emptyMessage: string;
  onConnect: (peer: Peer) => void;
  onDisconnect: (peer: Peer) => void;
  onOpenChat: (peer: Peer) => void;
  ListHeaderComponent?: React.ReactElement;
}

/**
 * Peers grouped by where they are in the connection lifecycle.
 *
 * A flat list forces you to read every card to find the one that matters. Sections make
 * "am I connected?", "is something in progress?" and "what went wrong?" answerable at a
 * glance — which is what you need while holding two phones.
 */
const SECTION_ORDER = [
  'Connected',
  'Connecting',
  'Available',
  'Previously connected',
  'Unavailable',
] as const;

type SectionTitle = (typeof SECTION_ORDER)[number];

const SECTION_HINT: Record<SectionTitle, string> = {
  Connected: 'Handshake complete — ready to chat',
  Connecting: 'Working through the connection sequence',
  Available: 'Advertising nearby, not connected yet',
  'Previously connected': 'Known peers not currently in range',
  Unavailable: 'Last attempt failed',
};

function sectionFor(peer: Peer): SectionTitle {
  switch (peer.state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
    case 'discoveringServices':
    case 'negotiatingMtu':
    case 'enablingNotifications':
    case 'handshaking':
    case 'reconnecting':
    case 'disconnecting':
      return 'Connecting';
    case 'failed':
      return 'Unavailable';
    case 'discovering':
      return 'Available';
    default:
      // Seen before, currently silent.
      return peer.connectCount > 0 ? 'Previously connected' : 'Available';
  }
}

export function PeerList({
  peers,
  emptyMessage,
  onConnect,
  onDisconnect,
  onOpenChat,
  ListHeaderComponent,
}: Props) {
  const styles = useStyles();
  const sections = useMemo(() => {
    const grouped = new Map<SectionTitle, Peer[]>();
    for (const peer of peers) {
      const title = sectionFor(peer);
      const list = grouped.get(title) ?? [];
      list.push(peer);
      grouped.set(title, list);
    }
    return SECTION_ORDER.filter(title => (grouped.get(title)?.length ?? 0) > 0).map(
      title => ({title, hint: SECTION_HINT[title], data: grouped.get(title)!}),
    );
  }, [peers]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={item => item.peerId ?? item.linkId ?? String(item.firstSeen)}
      contentContainerStyle={styles.content}
      ListHeaderComponent={ListHeaderComponent}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({section}) => (
        <View style={styles.sectionHeader}>
          <AppText style={styles.sectionTitle} numberOfLines={1}>
            {section.title} ({section.data.length})
          </AppText>
          <DenseText style={styles.sectionHint}>{section.hint}</DenseText>
        </View>
      )}
      renderItem={({item}) => (
        <PeerCard
          peer={item}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onOpenChat={onOpenChat}
        />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <DenseText style={styles.emptyText}>{emptyMessage}</DenseText>
        </View>
      }
    />
  );
}

const useStyles = makeStyles(t => ({
  content: {padding: spacing.lg, paddingBottom: spacing.xl},
  sectionHeader: {marginBottom: spacing.sm, marginTop: spacing.xs},
  sectionTitle: {
    color: t.text,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHint: {color: t.textDim, fontSize: 11, marginTop: 1},
  empty: {paddingVertical: spacing.xl, alignItems: 'center'},
  emptyText: {
    color: t.textDim,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
}));
