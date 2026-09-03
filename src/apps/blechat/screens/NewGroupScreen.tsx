import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from '../components/AppText';
import {PeerAvatar} from '../components/ui/Primitives';
import {Button, EmptyState} from '../components/ui/Surface';
import {Touchable} from '../components/Motion';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';
import type {RootStackScreenProps} from '../navigation/types';

/**
 * Create a group from peers we have actually handshaken with.
 *
 * Only identified peers can be members: a group is a set of application identities, and
 * a device we have not handshaken with has no peerId to put in the list. Members that
 * are currently out of range can still be selected — they are invited when they return.
 */
export function NewGroupScreen({navigation}: RootStackScreenProps<'NewGroup'>) {
  const styles = useStyles();
  const theme = useTheme();

  const peers = useAppStore(s => s.peers);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const candidates = useMemo(
    () => peers.filter(p => p.peerId !== null),
    [peers],
  );

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <AppText style={styles.title}>New Group</AppText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <DenseText style={styles.label}>Group name</DenseText>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Team"
          placeholderTextColor={theme.textDim}
          maxLength={24}
          returnKeyType="done"
          maxFontSizeMultiplier={1.3}
        />

        <DenseText style={[styles.label, styles.spaced]}>
          Members ({selected.length} selected)
        </DenseText>
        <DenseText style={styles.hint}>
          Only peers you have completed a handshake with can be added. Members that are
          out of range are invited when they come back.
        </DenseText>

        {candidates.length === 0 && (
          <EmptyState
            glyph="◎"
            title="No known peers yet"
            detail="Connect to somebody from Nearby, then come back to build a group."
          />
        )}

        {candidates.map(peer => {
          const isSelected = selected.includes(peer.peerId!);
          const online = peer.state === 'connected';
          return (
            <Touchable
              key={peer.peerId!}
              scale={false}
              style={
                isSelected
                  ? [styles.memberRow, styles.memberRowActive]
                  : [styles.memberRow]
              }
              onPress={() => toggle(peer.peerId!)}>
              <PeerAvatar size={38} muted={!online} />
              <View style={styles.memberText}>
                <AppText style={styles.memberName} numberOfLines={1}>
                  {peer.displayName ?? 'Unnamed peer'}
                </AppText>
                <DenseText style={styles.memberMeta} numberOfLines={1}>
                  {online ? 'Connected' : 'Not in range'}
                </DenseText>
              </View>
              <View style={[styles.check, isSelected && styles.checkOn]}>
                {isSelected && <Text style={styles.checkGlyph}>✓</Text>}
              </View>
            </Touchable>
          );
        })}

        {unreachable > 0 && (
          <DenseText style={styles.warn}>
            {unreachable} selected member
            {unreachable === 1 ? ' is' : 's are'} not in range. They will be invited, and
            messages queued, until they reconnect.
          </DenseText>
        )}
      </ScrollView>

      <View style={styles.createWrap}>
        <Button
          label={creating ? 'Creating...' : 'Create group'}
          onPress={create}
          disabled={selected.length === 0 || creating}
        />
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {color: t.text, fontSize: 22},
  title: {...typography.title, color: t.text},
  content: {paddingHorizontal: spacing.lg, paddingBottom: spacing.xl},

  label: {...typography.callout, color: t.text, fontWeight: '700'},
  spaced: {marginTop: spacing.xl},
  hint: {...typography.caption, color: t.textDim, marginTop: 3, lineHeight: 16},
  input: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: t.text,
    ...typography.body,
    marginTop: spacing.sm,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  memberRowActive: {borderColor: t.accent},
  memberText: {flex: 1},
  memberName: {...typography.headline, color: t.text},
  memberMeta: {...typography.caption, color: t.textDim, marginTop: 1},
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {backgroundColor: t.accent, borderColor: t.accent},
  checkGlyph: {color: t.onAccent, fontSize: 13, fontWeight: '700'},

  warn: {...typography.caption, color: t.warn, marginTop: spacing.lg, lineHeight: 16},
  createWrap: {padding: spacing.lg},
}));
