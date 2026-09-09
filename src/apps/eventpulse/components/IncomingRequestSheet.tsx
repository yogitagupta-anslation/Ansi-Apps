/**
 * "Jaismeet wants to connect."
 *
 * The receiving half of the connection handshake, and the first screen in
 * EventPulse whose entire contents arrived over the radio. There is no
 * directory to look this person up in — offline there never will be — so
 * everything shown here comes out of the `CONNECTION_REQUEST` payload the far
 * phone sent. That is why the card is small: it is exactly what they chose to
 * share, already redacted on their side before it was transmitted.
 *
 * Two decisions worth keeping:
 *
 *  - **Decline is not a destructive action.** It is the ordinary, expected
 *    answer to most requests at a conference, so it sits as a quiet secondary
 *    rather than in danger red. Nothing is deleted and nobody is told off.
 *  - **The person is never told which reason they got.** Decline, blocked and
 *    "not accepting requests" all leave this phone as the same plain decline —
 *    see `rejectReasonToSend`. This sheet only ever offers the honest one.
 *
 * Requests queue: if two arrive, the newest is shown and the rest wait, so the
 * user answers one question at a time rather than losing a request behind a
 * sheet they dismissed.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { PendingRequest } from '../connections/ConnectionRequestCoordinator';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { AppText, Button } from './primitives';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export function IncomingRequestSheet({
  request,
  waiting,
  onAccept,
  onDecline,
  onDismiss,
}: {
  /** The request being answered, or null when there is nothing to answer. */
  request: PendingRequest | null;
  /** How many more are queued behind this one. */
  waiting: number;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!request) return null;

  const { card, note } = request;
  const subtitle = [card.role, card.company].filter(Boolean).join(' · ');

  return (
    <Sheet
      visible
      title="Wants to connect"
      subtitle={waiting > 0 ? `${waiting} more waiting` : undefined}
      onClose={onDismiss}
      footer={
        <View style={styles.actions}>
          <Button label="Decline" variant="secondary" onPress={onDecline} style={styles.action} />
          <Button label="Accept" onPress={onAccept} style={styles.action} />
        </View>
      }
    >
      <View style={styles.body}>
        <View style={styles.person}>
          <Avatar name={card.name} size="large" />
          <View style={styles.identity}>
            <AppText variant="heading">{card.name}</AppText>
            {subtitle ? (
              <AppText variant="body" tone="secondary">
                {subtitle}
              </AppText>
            ) : null}
          </View>
        </View>

        {note ? (
          <View style={[styles.note, { backgroundColor: colors.surfaceElevated }]}>
            <AppText variant="body">{note}</AppText>
          </View>
        ) : null}

        {/*
          Said plainly because it is the question the user is actually asking.
          Accepting exchanges cards between two phones and nothing else: no
          message is sent, nothing is uploaded, and there is nowhere for it to
          go even if there were.
        */}
        <AppText variant="micro" tone="tertiary">
          Accepting adds them to your connections on this phone and sends them your card.
          Nothing leaves the two devices.
        </AppText>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identity: { flex: 1, gap: 2 },
  note: { padding: space.md, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
});
