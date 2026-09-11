/**
 * ConnectionsScreen — the people you actually met.
 *
 * The value of this screen arrives *after* the event, on the train home, when
 * "who was the ML engineer from the coffee queue" is a real question. So it
 * keeps: when you connected, what they do, and a private note you can add on
 * the spot. Notes never leave the device.
 *
 * Three lists, three different weights. A request is a decision and gets a card
 * with both answers inside it. A sent request is a wait and gets quiet copy and
 * a way out. An established connection is a record and gets a flat row, because
 * forty friends rendered as forty cards looks like forty outstanding tasks.
 *
 * What each row is allowed to *say* lives in `connectionPresentation`, not here
 * — chat gating, the nearby/away claim and whose card is safe to render are
 * correctness rules, and they are tested where a screen cannot be.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { PersonRow } from '../components/PersonRow';
import { AppText, Button, Card, EmptyState, SectionHeader } from '../components/primitives';
import {
  chatAllowed,
  chatEnabled,
  connectedStatus,
  rowIdentity,
  sectionFor,
} from '../connections/connectionPresentation';
import type { Attendee, Connection, ProfileId } from '../types';
import { actions, queries } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { presenceStore, sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, typography } from '../theme/tokens';

interface Row {
  connection: Connection;
  attendee: Attendee | null;
}

const selectConnections = (state: { connections: Connection[] }): Connection[] => state.connections;

/**
 * A cheap fingerprint of who is in range and how close, used only to decide
 * when this screen needs to re-render.
 *
 * The proximity readout used to be frozen: the only subscription here was to
 * `connections`, so a row could say "not in range" about someone standing next
 * to you until a connection happened to change. Subscribing to the presence
 * store directly would re-render the whole list several times a second, because
 * it is rewritten on every scanner flush. Reducing it to a string first means
 * `useStore` re-renders only when membership or a band actually changes.
 *
 * Sorted, so two flushes that merely reorder the same people compare equal.
 */
function presenceSignature(state: { people: readonly { profileId: ProfileId | null; proximity: { band: string } }[] }): string {
  const parts: string[] = [];
  for (const person of state.people) {
    if (person.profileId) parts.push(`${person.profileId}:${person.proximity.band}`);
  }
  return parts.sort().join('|');
}

export function ConnectionsScreen({
  onOpenDiscover,
  onOpenChat,
}: {
  onOpenDiscover: () => void;
  /**
   * Open the Connection Space for someone. Only ever called for an accepted
   * connection — every call site is behind `chatAllowed`, which is the same
   * gate the Connection Space itself uses.
   */
  onOpenChat?: (profileId: ProfileId, name: string, subtitle?: string) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const connections = useStore(sessionStore, selectConnections);
  /* Not read, deliberately: this is the re-render signal that keeps every
     proximity readout and every nearby/away claim on this screen live. */
  useStore(presenceStore, presenceSignature);

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

  const incoming = rows.filter((row) => sectionFor(row.connection.state) === 'requests');
  const outgoing = rows.filter((row) => sectionFor(row.connection.state) === 'awaiting');
  const accepted = rows.filter((row) => sectionFor(row.connection.state) === 'connected');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accepted;
    return accepted.filter((row) => {
      // The directory profile when there is one, otherwise the card they sent
      // over the radio. Searching only the former made everyone met offline
      // unfindable in their own connections list.
      const profile = row.attendee?.profile;
      const card = row.connection.card;
      const name = profile?.name ?? card?.name;
      const company = profile?.company ?? card?.company;
      const role = profile?.role ?? card?.role;
      return (
        name?.toLowerCase().includes(needle) ||
        company?.toLowerCase().includes(needle) ||
        role?.toLowerCase().includes(needle) ||
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

  /* ------------------------------------------------------------------ *
   * Requests — a decision, so both answers live inside one card
   * ------------------------------------------------------------------ */

  const respond = useCallback((connectionId: string, accept: boolean) => {
    haptics.select();
    void actions.respondToConnection(connectionId, accept);
  }, []);

  const renderRequest = useCallback(
    (row: Row) => {
      const { connection, attendee } = row;
      const accept = () => respond(connection.id, true);
      const reject = () => respond(connection.id, false);

      if (attendee) {
        return (
          <View key={connection.id} style={styles.requestRow}>
            <PersonRow
              attendee={attendee}
              nearby={queries.nearbyFor(attendee.profile.id)}
              connectionState="incoming_pending"
              header={<RequestEyebrow />}
              onPress={() => undefined}
              onConnect={accept}
              onDecline={reject}
              declineLabel="Reject"
            />
          </View>
        );
      }

      /*
       * No directory entry, which offline is the normal case. An INBOUND
       * request carries the sender's own card, so it is both safe and the only
       * thing this phone knows about them — see `rowIdentity`, which refuses
       * the same move on an outgoing request where the card is ours.
       */
      const identity = rowIdentity({ state: connection.state, card: connection.card });
      const nearby = queries.nearbyFor(connection.profileId);
      const name = identity.name ?? 'Someone nearby';

      return (
        <View key={connection.id} style={styles.requestRow}>
          <Card>
            <RequestEyebrow />
            <View style={styles.cardPerson}>
              <Avatar name={name} size="list" />
              <View style={styles.cardIdentity}>
                <AppText variant="heading" numberOfLines={1}>
                  {name}
                </AppText>
                {identity.detail ? (
                  <AppText variant="caption" tone="secondary" numberOfLines={1}>
                    {identity.detail}
                  </AppText>
                ) : null}
                <AppText variant="micro" tone="tertiary">
                  {nearby
                    ? `${nearby.proximity.label.toLowerCase()} · ${nearby.proximity.rangeLabel}`
                    : 'Wants to connect'}
                </AppText>
              </View>
            </View>

            <View style={styles.cardActions}>
              <Button
                label="Reject"
                variant="secondary"
                onPress={reject}
                accessibilityLabel={`Reject request from ${name}`}
              />
              <Button
                label="Accept"
                onPress={accept}
                full
                accessibilityLabel={`Accept request from ${name}`}
              />
            </View>
          </Card>
        </View>
      );
    },
    [respond],
  );

  /* ------------------------------------------------------------------ *
   * Awaiting reply — a wait, so quiet copy and a way out
   * ------------------------------------------------------------------ */

  const renderAwaiting = useCallback((row: Row) => {
    const { connection, attendee } = row;
    const cancel = () => {
      haptics.select();
      void actions.cancelConnectionRequest(connection.profileId);
    };

    const cancelButton = (label: string) => (
      <View style={styles.cardActions}>
        <Button
          label="Cancel request"
          variant="secondary"
          onPress={cancel}
          full
          accessibilityLabel={`Cancel your request to ${label}`}
        />
      </View>
    );

    if (attendee) {
      return (
        <View key={connection.id} style={styles.requestRow}>
          <PersonRow
            attendee={attendee}
            nearby={queries.nearbyFor(attendee.profile.id)}
            connectionState="outgoing_pending"
            subtitle="Waiting for response"
            onPress={() => undefined}
            footer={cancelButton(attendee.profile.name)}
          />
        </View>
      );
    }

    /*
     * Deliberately unnamed. An outgoing request stores OUR card — `myCard()` is
     * stamped on when the request goes out and only their accept replaces it —
     * so rendering it here would show the user their own name, waiting for a
     * reply from themselves.
     */
    return (
      <View key={connection.id} style={styles.requestRow}>
        <Card>
          <View style={styles.cardPerson}>
            <Avatar name="?" size="list" />
            <View style={styles.cardIdentity}>
              <AppText variant="heading">Waiting for response</AppText>
              <AppText variant="caption" tone="secondary">
                They have not answered yet. Their name appears here once they do.
              </AppText>
            </View>
          </View>
          {cancelButton('this person')}
        </Card>
      </View>
    );
  }, []);

  /* ------------------------------------------------------------------ *
   * Connected — a record, so a flat row
   * ------------------------------------------------------------------ */

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      const { connection, attendee } = item;
      const isEditing = editingNote === connection.id;

      /*
       * "Nearby" is a live Bluetooth link, never the radar. Someone can be three
       * metres away on the map and completely unreachable, because the radar is
       * a beacon and the connection is a separate connectable service.
       */
      const status = connectedStatus(queries.canChat(connection.profileId));
      const openNote = () => {
        setEditingNote(connection.id);
        setNoteDraft(connection.note ?? '');
      };

      const noteEditor = isEditing ? (
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
      ) : null;

      const identity = rowIdentity({
        state: connection.state,
        card: connection.card,
        directoryName: attendee?.profile.name,
        directoryRole: attendee?.profile.role,
        directoryCompany: attendee?.profile.company,
      });

      /*
       * Two gates, and they do different jobs. `chatAllowed` decides whether the
       * button exists at all — a live link is open during a pending exchange
       * too, and that must never open a conversation nobody agreed to.
       * `chatEnabled` decides whether it can be pressed right now, which is
       * purely about the radio. So an accepted person who walks out of range
       * keeps their button and their history; it greys out, and comes back by
       * itself when the link does. No second request, ever.
       */
      const canChatNow = chatEnabled(connection.state, status.live);
      const chatFooter =
        onOpenChat && chatAllowed(connection.state) && identity.name ? (
          <View style={styles.footerActions}>
            {/* Full width to match "Cancel request" on the pending cards above:
                one action per row, one shape for all of them, and a target that
                does not shrink to the width of a four-letter word. */}
            <Button
              label="Chat"
              variant="secondary"
              full
              disabled={!canChatNow}
              onPress={() =>
                onOpenChat(connection.profileId, identity.name as string, identity.detail ?? undefined)
              }
              accessibilityLabel={
                canChatNow
                  ? `Chat with ${identity.name}`
                  : `Chat with ${identity.name}, unavailable while they are out of Bluetooth range`
              }
            />
          </View>
        ) : undefined;

      if (!attendee) {
        /*
         * Nobody to look up does not mean nobody to show. Meeting someone over
         * BLE hands us the card they chose to send, and it is kept on the
         * connection precisely so this screen does not depend on a directory.
         * What is rendered is exactly what they sent and nothing more: no
         * avatar image, no availability. This phone was never told any of that.
         */
        if (!identity.name) {
          return (
            <Card style={styles.unknown}>
              <AppText variant="bodyStrong">Details not shared</AppText>
              <AppText variant="caption" tone="secondary">
                This connection was made without a card, so there is nothing to show beyond the
                fact that you connected.
              </AppText>
            </Card>
          );
        }

        return (
          <View style={styles.rowGroup}>
            <Card>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add a private note about ${identity.name}`}
                onPress={openNote}
                style={styles.cardPerson}
              >
                <Avatar name={identity.name} size="list" />
                <View style={styles.cardIdentity}>
                  <AppText variant="heading" numberOfLines={1}>
                    {identity.name}
                  </AppText>
                  {identity.detail ? (
                    <AppText variant="caption" tone="secondary" numberOfLines={1}>
                      {identity.detail}
                    </AppText>
                  ) : null}
                  <AppText variant="micro" tone="tertiary">
                    {`${status.label} · met ${relativeTime(connection.updatedAt)}`}
                  </AppText>
                </View>
              </Pressable>
              {chatFooter}
            </Card>
            {noteEditor}
          </View>
        );
      }

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
            subtitle={`${status.label} · met ${relativeTime(connection.updatedAt)}`}
            onPress={openNote}
            footer={chatFooter}
          />
          {noteEditor}
        </View>
      );
    },
    [colors, editingNote, noteDraft, onOpenChat, saveNote],
  );

  const searching = query.trim().length > 0;
  const nothingAtAll = incoming.length + outgoing.length + accepted.length === 0;

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
              <AppText variant="caption" tone="tertiary">
                Requests and messages travel directly between nearby phones over Bluetooth.
              </AppText>
            </View>

            {accepted.length > 3 ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your connections"
                placeholderTextColor={colors.textTertiary}
                accessibilityLabel="Search your connections"
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

            {/* Every counted row below renders, including the ones with no
                directory entry. A heading that counts rows the list then drops
                is how "Awaiting reply · 1" ended up above empty space. */}
            {incoming.length > 0 ? (
              <>
                <SectionHeader title={`Requests · ${incoming.length}`} />
                {incoming.map(renderRequest)}
              </>
            ) : null}

            {outgoing.length > 0 ? (
              <>
                <SectionHeader title={`Awaiting reply · ${outgoing.length}`} />
                {outgoing.map(renderAwaiting)}
              </>
            ) : null}

            {filtered.length > 0 ? <SectionHeader title={`Connected · ${filtered.length}`} /> : null}
          </View>
        }
        ListEmptyComponent={
          nothingAtAll ? (
            <EmptyState
              emoji="🤝"
              title="No connections yet"
              body="Tap someone on the map, open their profile, and connect. They will show up here."
              actionLabel="Find people to meet"
              onAction={onOpenDiscover}
            />
          ) : searching && accepted.length > 0 ? (
            <EmptyState
              emoji="🔍"
              title="No matches"
              body={`Nobody in your connections matches "${query.trim()}".`}
              actionLabel="Clear search"
              onAction={() => setQuery('')}
            />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

/**
 * What kind of card this is, before the reader has parsed a name.
 *
 * A request is the one row on this screen that asks for something, so it says
 * so in words rather than relying on the presence of two buttons — which is
 * also what makes it work for a screen reader arriving at the card cold.
 */
function RequestEyebrow(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={styles.eyebrow}>
      <View style={[styles.eyebrowDot, { backgroundColor: colors.accent }]} />
      <AppText variant="micro" tone="accent" style={styles.eyebrowText}>
        CONNECTION REQUEST
      </AppText>
    </View>
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
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.xs },
  eyebrowDot: { width: 6, height: 6, borderRadius: 3 },
  eyebrowText: { letterSpacing: 0.8 },
  /** Both answers to one question, inside the card that asked it. */
  cardActions: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm },
  /** Inside the row's own bounds, above a flat row's divider. */
  footerActions: { flexDirection: 'row', paddingTop: space.sm },
  requestRow: { paddingBottom: space.sm },
  unknown: { gap: space.xs },
  cardPerson: { alignItems: 'center', flexDirection: 'row', gap: space.md },
  cardIdentity: { flex: 1, gap: 2 },
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
