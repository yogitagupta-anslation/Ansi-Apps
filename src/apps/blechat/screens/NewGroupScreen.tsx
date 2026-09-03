import React, {useCallback, useMemo, useState} from 'react';
import {Alert, ScrollView, Text, TextInput, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from '../components/AppText';
import {InitialAvatar} from '../components/ui/Primitives';
import {EmptyState} from '../components/ui/Surface';
import {Screen} from '../components/ui/Screen';
import {Icon} from '../components/ui/Icon';
import {GradientSurface, brandGradient} from '../components/ui/Gradient';
import {Touchable} from '../components/Motion';
import {qualityLabel} from '../peers/LinkMetrics';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import {relativeTime} from '../utils/time';
import type {Peer} from '../types/Peer';
import type {RootStackScreenProps} from '../navigation/types';

/**
 * Create a group from peers we have actually handshaken with.
 *
 * Only identified peers can be members: a group is a set of application identities, and
 * a device we have not handshaken with has no peerId to put in the list. Members that
 * are currently out of range can still be selected — they are invited when they return.
 *
 * The selection used to be a tick four hundred pixels down a flat list of every peer
 * this phone had ever met, which meant the thing you were building was never on screen
 * at the same time as the thing you were building it from. Selected members are now
 * chips pinned under the name, the candidates are split by whether they are actually
 * here (the two cases behave completely differently — one joins now, the other is
 * invited later), and the button states the count it will act on.
 */
export function NewGroupScreen({navigation}: RootStackScreenProps<'NewGroup'>) {
  const styles = useStyles();
  const theme = useTheme();

  const peers = useAppStore(s => s.peers);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peers
      .filter(p => p.peerId !== null)
      .filter(p => !q || (p.displayName ?? '').toLowerCase().includes(q));
  }, [peers, query]);

  const inRange = candidates.filter(p => p.state !== 'disconnected' || p.linkId);
  const outOfRange = candidates.filter(p => !(p.state !== 'disconnected' || p.linkId));

  const toggle = useCallback((peerId: string) => {
    setSelected(current =>
      current.includes(peerId)
        ? current.filter(id => id !== peerId)
        : [...current, peerId],
    );
  }, []);

  const create = useCallback(async () => {
    if (selected.length === 0) {
      Alert.alert('Pick members', 'Choose at least one peer for the group.');
      return;
    }
    setCreating(true);
    try {
      const group = await bleChat.messages.createGroup(name, selected);
      navigation.replace('Chat', {groupId: group.id, displayName: group.name});
    } catch (err) {
      Alert.alert(
        'Could not create group',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCreating(false);
    }
  }, [name, selected, navigation]);

  const unreachable = selected.filter(
    id => peers.find(p => p.peerId === id)?.state !== 'connected',
  ).length;

  const selectedPeers = selected
    .map(id => peers.find(p => p.peerId === id))
    .filter((p): p is Peer => p !== undefined);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.head}>
        <View style={styles.headerRow}>
          <Touchable
            scale={false}
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityLabel="Back">
            <Icon name="chevronLeft" color={theme.text} size={22} />
          </Touchable>
          <AppText style={styles.title}>New group</AppText>
        </View>

        {/* The group, as a thing that exists — a tile and a name, not a labelled form
            field. Naming it is optional; the placeholder says what happens if you skip. */}
        <View style={styles.nameCard}>
          <View style={[styles.nameTile, {backgroundColor: theme.tilePurple}]}>
            <Icon name="people" color={theme.tilePurpleFg} size={20} />
          </View>
          <View style={styles.grow}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Untitled group"
              placeholderTextColor={theme.textFaint}
              maxLength={24}
              returnKeyType="done"
              maxFontSizeMultiplier={1.2}
            />
            <DenseText style={styles.nameHint}>Group name · tap to rename</DenseText>
          </View>
        </View>

        {/* Pinned under the name so what you have chosen never scrolls out of sight. */}
        {selectedPeers.length > 0 ? (
          <View style={styles.chipRow}>
            {selectedPeers.map(peer => (
              <Touchable
                key={peer.peerId!}
                scale={false}
                onPress={() => toggle(peer.peerId!)}
                style={styles.memberChip}
                accessibilityLabel={`Remove ${peer.displayName ?? 'peer'}`}>
                <InitialAvatar
                  name={peer.displayName}
                  seed={peer.peerId!}
                  size={22}
                  bg={peer.state === 'connected' ? undefined : theme.surfaceAlt}
                  fg={peer.state === 'connected' ? undefined : theme.textFaint}
                />
                <DenseText style={styles.memberChipText} numberOfLines={1}>
                  {peer.displayName ?? 'Unnamed'}
                </DenseText>
                <Text style={styles.memberChipX}>×</Text>
              </Touchable>
            ))}
            <DenseText style={styles.selectedCount}>
              {selectedPeers.length} selected
            </DenseText>
          </View>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {peers.filter(p => p.peerId !== null).length > 4 ? (
          <View style={styles.searchBar}>
            <Icon name="search" color={theme.textFaint} size={15} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search known peers"
              placeholderTextColor={theme.textFaint}
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
        ) : null}

        {candidates.length === 0 && (
          <EmptyState
            glyph="◎"
            title={query ? 'Nobody matches' : 'No known peers yet'}
            detail={
              query
                ? 'Try a different name.'
                : 'Connect to somebody from Nearby, then come back to build a group.'
            }
          />
        )}

        {inRange.length > 0 ? (
          <>
            <DenseText style={styles.sectionTitle}>IN RANGE NOW</DenseText>
            <View style={styles.listCard}>
              {inRange.map((peer, i) => (
                <MemberRow
                  key={peer.peerId!}
                  peer={peer}
                  selected={selected.includes(peer.peerId!)}
                  divided={i > 0}
                  onPress={() => toggle(peer.peerId!)}
                />
              ))}
            </View>
          </>
        ) : null}

        {outOfRange.length > 0 ? (
          <>
            <DenseText style={styles.sectionTitle}>KNOWN, OUT OF RANGE</DenseText>
            <View style={[styles.listCard, styles.listCardQuiet]}>
              {outOfRange.map((peer, i) => (
                <MemberRow
                  key={peer.peerId!}
                  peer={peer}
                  selected={selected.includes(peer.peerId!)}
                  divided={i > 0}
                  onPress={() => toggle(peer.peerId!)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {unreachable > 0 && (
          <DenseText style={styles.warn}>
            {unreachable} selected member
            {unreachable === 1 ? ' is' : 's are'} out of range — their invite and any
            messages are queued until they reconnect.
          </DenseText>
        )}
        <Touchable
          scale={false}
          onPress={create}
          disabled={selected.length === 0 || creating}>
          <GradientSurface
            gradient={
              selected.length > 0 && !creating
                ? brandGradient(theme)
                : [theme.surfaceAlt, theme.surfaceAlt, theme.surfaceAlt]
            }
            radius={radius.pill}
            style={styles.createButton}>
            <AppText
              style={[
                styles.createText,
                {
                  color:
                    selected.length > 0 && !creating ? theme.onAccent : theme.textFaint,
                },
              ]}>
              {creating
                ? 'Creating…'
                : selected.length === 0
                ? 'Pick at least one member'
                : `Create with ${selected.length} member${
                    selected.length === 1 ? '' : 's'
                  }`}
            </AppText>
          </GradientSurface>
        </Touchable>
      </View>
    </Screen>
  );
}

/**
 * One candidate.
 *
 * The second line says what selecting this person actually means, which differs by
 * state: somebody connected joins now, somebody merely in range has to be dialled
 * first, and somebody out of range gets an invite whenever they next appear.
 */
function MemberRow({
  peer,
  selected,
  divided,
  onPress,
}: {
  peer: Peer;
  selected: boolean;
  divided: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const connected = peer.state === 'connected';
  const present = connected || peer.linkId !== null;

  const meta = connected
    ? ['Connected', qualityLabel(peer.metrics?.quality ?? null)]
        .filter(Boolean)
        .join(' · ')
    : present
    ? 'Available · not connected yet'
    : `Invited when they return · seen ${relativeTime(peer.lastSeen)}`;

  return (
    <Touchable
      scale={false}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{checked: selected}}
      style={divided ? [styles.memberRow, styles.memberRowDivided] : styles.memberRow}>
      <InitialAvatar
        name={peer.displayName}
        seed={peer.peerId!}
        size={40}
        online={present ? connected : undefined}
        bg={present ? undefined : theme.surfaceAlt}
        fg={present ? undefined : theme.textFaint}
      />
      <View style={styles.grow}>
        <AppText style={styles.memberName} numberOfLines={1}>
          {peer.displayName ?? 'Unnamed peer'}
        </AppText>
        <DenseText
          style={[styles.memberMeta, connected && {color: theme.ok}]}
          numberOfLines={1}>
          {meta}
        </DenseText>
      </View>
      <View style={selected ? [styles.check, styles.checkOn] : styles.check}>
        {selected ? <Icon name="check" color={theme.onAccent} size={13} strokeWidth={3} /> : null}
      </View>
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  grow: {flex: 1},

  head: {paddingHorizontal: spacing.lg + 4, paddingTop: spacing.sm},
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  title: {fontSize: 26, fontWeight: '800', letterSpacing: -0.6, color: t.text},

  nameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    marginTop: 14,
  },
  nameTile: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `padding: 0` because Android gives TextInput its own vertical padding, which would
  // push the name off-centre against the tile beside it.
  nameInput: {fontSize: 16, fontWeight: '700', color: t.text, padding: 0},
  nameHint: {...typography.caption, color: t.textFaint, fontSize: 11, marginTop: 1},

  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: spacing.md,
  },
  // flexShrink: 0 — in a wrapping row a flex layout may squeeze a chip narrower than its
  // text needs before wrapping it, which clips the name with no ellipsis.
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.accentSoft,
    borderWidth: 1,
    borderColor: t.accent + '33',
    borderRadius: radius.pill,
    paddingLeft: 5,
    paddingRight: 6,
    paddingVertical: 5,
    flexShrink: 0,
  },
  memberChipText: {...typography.caption, color: t.accent, fontWeight: '700'},
  memberChipX: {color: t.accent, fontSize: 13, opacity: 0.7},
  selectedCount: {...typography.caption, color: t.textFaint, fontSize: 11},

  content: {paddingHorizontal: spacing.lg + 4, paddingTop: 18, paddingBottom: spacing.lg},

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
  searchInput: {flex: 1, ...typography.body, fontSize: 14, color: t.text, padding: 0},

  sectionTitle: {
    ...typography.overline,
    color: t.textDim,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  listCard: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 18,
    overflow: 'hidden',
  },
  // A quieter border for the out-of-range group: the card itself says these are the
  // people who are not here.
  listCardQuiet: {borderColor: t.divider},

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  memberRowDivided: {borderTopWidth: 1, borderTopColor: t.divider},
  memberName: {...typography.body, fontWeight: '700', color: t.text},
  memberMeta: {...typography.caption, color: t.textFaint, fontSize: 11, marginTop: 1},
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {backgroundColor: t.accent, borderColor: t.accent},

  footer: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: 14,
    paddingBottom: spacing.lg + 4,
    backgroundColor: t.bg,
  },
  warn: {
    ...typography.caption,
    color: t.tileAmberFg,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  createButton: {height: 50, alignItems: 'center', justifyContent: 'center'},
  createText: {fontSize: 16, fontWeight: '700'},
}));
