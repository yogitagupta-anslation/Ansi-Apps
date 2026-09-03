/**
 * ConnectionsScreen — the people you actually met.
 *
 * The value of this screen arrives *after* the event, on the train home, when
 * "who was the ML engineer from the coffee queue" is a real question. So it
 * keeps: when you connected, what they do, and a private note you can add on
 * the spot. Notes never leave the device.
 *
 * Anything still queued for delivery is shown as queued rather than silently
 * pretended-sent, because a request the venue Wi-Fi ate is worth knowing about.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PersonRow } from '../components/PersonRow';
import { AppText, Button, Card, EmptyState, SectionHeader } from '../components/primitives';
import type { Attendee, Connection } from '../types';
import { actions, connectionService, queries } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, typography } from '../theme/tokens';

interface Row {
  connection: Connection;
  attendee: Attendee | null;
}

export function ConnectionsScreen({ onOpenDiscover }: { onOpenDiscover: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const connections = useStore(sessionStore, (state) => state.connections);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const rows = useMemo<Row[]>(
    () =>
      connections.map((connection) => ({
        connection,
        attendee: queries.attendee(connection.profileId),
      })),
    [connections],
  );

  const incoming = rows.filter((row) => row.connection.state === 'incoming_pending');
  const accepted = rows.filter((row) => row.connection.state === 'connected');
  const outgoing = rows.filter((row) => row.connection.state === 'outgoing_pending');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accepted;
    return accepted.filter((row) => {
      const profile = row.attendee?.profile;
      return (
        profile?.name.toLowerCase().includes(needle) ||
        profile?.company?.toLowerCase().includes(needle) ||
        profile?.role?.toLowerCase().includes(needle) ||
        row.connection.note?.toLowerCase().includes(needle)
      );
    });
  }, [accepted, query]);

  const saveNote = useCallback(
    (connectionId: string) => {
      void actions.setConnectionNote(connectionId, noteDraft.trim());
      setEditingNote(null);
      setNoteDraft('');
    },
    [noteDraft],
  );

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      const { connection, attendee } = item;

      if (!attendee) {
        return (
          <Card style={styles.unknown}>
            <AppText variant="bodyStrong">Connection pending sync</AppText>
            <AppText variant="caption" tone="secondary">
              Their profile has not downloaded yet. It will appear once the attendee list finishes
              syncing.
            </AppText>
          </Card>
        );
      }

      const isEditing = editingNote === connection.id;

      return (
        <View style={styles.rowGroup}>
          <PersonRow
            attendee={attendee}
            nearby={queries.nearbyFor(attendee.profile.id)}
            connectionState={connection.state}
            // A settled connection is a record, not a decision — see `flat`.
            // The requests above keep their cards precisely so that the two
            // read differently at a glance.
            flat
            subtitle={`Connected ${relativeTime(connection.updatedAt)}${
              connection.pendingSync ? ' · queued' : ''
            }`}
            onPress={() => {
              setEditingNote(connection.id);
              setNoteDraft(connection.note ?? '');
            }}
          />

          {isEditing ? (
            <Card style={styles.noteCard}>
              <AppText variant="micro" tone="tertiary">
                PRIVATE NOTE — ONLY YOU CAN SEE THIS
              </AppText>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="Where you met, what to follow up on…"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={[
                  styles.noteInput,
                  typography.body,
                  {
                    backgroundColor: colors.surfaceSunken,
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
              />
              <View style={styles.noteActions}>
                <Button label="Cancel" variant="ghost" onPress={() => setEditingNote(null)} />
                <Button label="Save note" onPress={() => saveNote(connection.id)} />
              </View>
            </Card>
          ) : connection.note ? (
            <View style={styles.notePreview}>
              <AppText variant="caption" tone="tertiary">
                {`📝  ${connection.note}`}
              </AppText>
            </View>
          ) : null}
        </View>
      );
    },
    [colors, editingNote, noteDraft, saveNote],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.connection.id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            onRefresh={() => {
              setRefreshing(true);
              haptics.select();
              void actions.refreshConnections().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <AppText variant="display">Connections</AppText>
              {connectionService.queuedCount > 0 ? (
                <AppText variant="caption" tone="tertiary">
                  {`${connectionService.queuedCount} waiting to send — they will go out when you are back online`}
                </AppText>
              ) : null}
            </View>

            {accepted.length > 3 ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your connections"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.search,
                  typography.body,
                  {
                    backgroundColor: colors.surfaceSunken,
                    borderColor: colors.border,
                    color: colors.textPrimary,
                  },
                ]}
              />
            ) : null}

            {incoming.length > 0 ? (
              <>
                <SectionHeader title={`Requests · ${incoming.length}`} />
                {incoming.map((row) =>
                  row.attendee ? (
                    <View key={row.connection.id} style={styles.requestRow}>
                      <PersonRow
                        attendee={row.attendee}
                        nearby={queries.nearbyFor(row.attendee.profile.id)}
                        connectionState="incoming_pending"
                        onPress={() => undefined}
                        onConnect={() => void actions.respondToConnection(row.connection.id, true)}
                      />
                      <Button
                        label="Decline"
                        variant="ghost"
                        onPress={() => void actions.respondToConnection(row.connection.id, false)}
                      />
                    </View>
                  ) : null,
                )}
              </>
            ) : null}

            {outgoing.length > 0 ? (
              <>
                <SectionHeader title={`Awaiting reply · ${outgoing.length}`} />
                {outgoing.map((row) =>
                  row.attendee ? (
                    <PersonRow
                      key={row.connection.id}
                      attendee={row.attendee}
                      nearby={queries.nearbyFor(row.attendee.profile.id)}
                      connectionState="outgoing_pending"
                      subtitle={row.connection.pendingSync ? 'Queued — waiting for a connection' : undefined}
                      onPress={() => undefined}
                    />
                  ) : null,
                )}
              </>
            ) : null}

            {accepted.length > 0 ? <SectionHeader title={`Connected · ${accepted.length}`} /> : null}
          </View>
        }
        ListEmptyComponent={
          incoming.length + outgoing.length === 0 ? (
            <EmptyState
              emoji="🤝"
              title="No connections yet"
              body="Tap someone on the map, open their profile, and connect. They will show up here."
              actionLabel="Find people to meet"
              onAction={onOpenDiscover}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm },
  header: { paddingTop: space.lg, paddingBottom: space.sm, gap: space.xs },
  search: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    height: 44,
    marginBottom: space.sm,
  },
  rowGroup: { gap: space.sm },
  requestRow: { gap: space.xs, paddingBottom: space.sm },
  unknown: { gap: space.xs },
  noteCard: { gap: space.sm },
  noteInput: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    minHeight: 78,
    textAlignVertical: 'top',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  notePreview: { paddingHorizontal: space.md, paddingBottom: space.sm },
});
