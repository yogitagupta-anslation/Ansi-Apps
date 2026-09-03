import React from 'react';
import {TouchableOpacity, View} from 'react-native';
import {spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../config/theme';
import type {ChatMessage} from '../types/Message';
import {AppText} from './AppText';

interface Props {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  /** Copy / Retry / Delete — offered on any bubble, not just a failed one. */
  onLongPress?: (message: ChatMessage) => void;
  /**
   * Who wrote this, for group conversations.
   *
   * Only supplied in a group, where it is the difference between a usable conversation
   * and an anonymous wall of text: with three or more people talking, an incoming bubble
   * with no author cannot be attributed to anyone. A one-to-one chat needs nothing, since
   * every incoming message is from the person named in the header.
   */
  senderName?: string;
  /** Stable per-peer colour, so the eye can follow one speaker down the thread. */
  senderTint?: string;
}

/**
 * Status text is a direct rendering of the delivery state machine.
 * "Sent" means a BLE write completed. "Delivered" means the peer returned an ACK.
 */
const STATUS_TEXT: Record<ChatMessage['status'], string> = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  received: 'Delivered',
  failed: 'Failed',
};

/**
 * Delivery ticks, with the same meaning the rest of the stack uses:
 *   ...  queued, nothing on the radio yet
 *   ✓    the BLE write completed
 *   ✓✓   the peer returned an application-level ACK
 *   !    the write threw, or no ACK arrived
 * A single tick is never shown for an unacknowledged message, so the second tick always
 * means the other phone really has it.
 */
const STATUS_TICK: Record<ChatMessage['status'], string> = {
  pending: '···',
  sending: '···',
  sent: '✓',
  received: '✓✓',
  failed: '!',
};

function statusColor(status: ChatMessage['status'], t: Theme): string {
  if (status === 'failed') {
    return t.error;
  }
  if (status === 'received') {
    return t.ok;
  }
  // Ticks only ever render on the outgoing, accent-filled bubble.
  return t.onAccentDim;
}

function clock(timestamp: number): string {
  const t = new Date(timestamp);
  return (
    String(t.getHours()).padStart(2, '0') +
    ':' +
    String(t.getMinutes()).padStart(2, '0')
  );
}

export function MessageBubble({
  message,
  onRetry,
  onLongPress,
  senderName,
  senderTint,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const outgoing = message.direction === 'outgoing';

  const body = (
    <View
      style={[
        styles.bubble,
        outgoing ? styles.out : styles.in,
        message.status === 'failed' && styles.failed,
      ]}>
      {/*
        No fixed lineHeight: a hardcoded value does not scale with the user's font size
        setting, so at larger scales the glyphs outgrow their line box and wrapped lines
        get clipped. Letting the platform derive line height from the (scaled) font size
        is what keeps long messages fully visible.
      */}
      {!outgoing && senderName ? (
        <AppText
          style={[styles.sender, senderTint ? {color: senderTint} : null]}
          numberOfLines={1}>
          {senderName}
        </AppText>
      ) : null}

      <AppText style={[styles.text, outgoing ? styles.textOut : styles.textIn]}>
        {message.text}
      </AppText>

      <View style={styles.footer}>
        <AppText
          style={[styles.time, outgoing ? styles.metaOut : styles.metaIn]}
          numberOfLines={1}>
          {clock(message.receivedAt)}
        </AppText>
        {outgoing && message.groupId ? (
          // Group delivery is per recipient, so a single tick would be a lie: show how
          // many members have actually acknowledged.
          <AppText
            style={[styles.tick, {color: statusColor(message.status, theme)}]}
            numberOfLines={1}>
            {(message.deliveredTo?.length ?? 0)}/{message.recipientCount ?? 0}
            {' '}
            {STATUS_TICK[message.status]}
          </AppText>
        ) : outgoing ? (
          // The tick AND the word. A tick alone is a guess on the reader's part, and the
          // difference between "sent" (a BLE write completed) and "delivered" (the peer
          // acknowledged it) is exactly the thing a tick cannot express.
          <AppText
            style={[styles.tick, {color: statusColor(message.status, theme)}]}
            numberOfLines={1}>
            {STATUS_TICK[message.status]}{' '}
            {message.status === 'sending' && message.fragmentProgress
              ? `Sending ${message.fragmentProgress.sent}/${message.fragmentProgress.total}`
              : STATUS_TEXT[message.status]}
          </AppText>
        ) : null}
        {outgoing && message.status === 'failed' && (
          <AppText style={styles.failedHint} numberOfLines={1}>
            tap to retry
          </AppText>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.row, outgoing ? styles.rowOut : styles.rowIn]}>
      <TouchableOpacity
        activeOpacity={onLongPress || (outgoing && message.status === 'failed') ? 0.7 : 1}
        onPress={
          outgoing && message.status === 'failed' ? () => onRetry(message) : undefined
        }
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}>
        {body}
      </TouchableOpacity>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  row: {paddingHorizontal: spacing.lg, marginVertical: spacing.xs},
  rowOut: {alignItems: 'flex-end'},
  rowIn: {alignItems: 'flex-start'},
  bubble: {
    maxWidth: '80%',
    // Guarantees room for the timestamp row even behind a very short message, so the
    // bubble is never sized narrower than its own metadata.
    minWidth: 96,
    // A larger radius with one corner tucked in: the tucked corner is what makes a
    // bubble read as coming FROM a side rather than floating.
    borderRadius: 18,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  out: {backgroundColor: t.bubbleOut, borderBottomRightRadius: 5},
  in: {
    backgroundColor: t.bubbleIn,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: t.border,
  },
  failed: {borderWidth: 1, borderColor: t.error},
  sender: {...typography.caption, fontWeight: '700', marginBottom: 3},
  text: {...typography.body, lineHeight: 21},
  // An incoming bubble is light in light mode, so white text would be invisible.
  textOut: {color: t.bubbleOutText},
  textIn: {color: t.bubbleInText},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    // Wraps instead of clipping when "failed - tap to retry" cannot fit on one line.
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  time: {...typography.caption, fontSize: 11},
  metaOut: {color: t.onAccentDim},
  metaIn: {color: t.bubbleMeta},
  tick: {...typography.caption, fontSize: 11, fontWeight: '600'},
  failedHint: {...typography.caption, fontSize: 10, color: t.error},
}));
