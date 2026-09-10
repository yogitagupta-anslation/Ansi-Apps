import React from 'react';
import {Image, TouchableOpacity, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../config/theme';
import type {ChatMessage} from '../types/Message';
import {AppText} from './AppText';
import {LandIn} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {describeSchedule} from '../utils/time';
import {stickerFor} from '../config/stickers';

interface Props {
  message: ChatMessage;
  onRetry: (message: ChatMessage) => void;
  /** Copy / Retry / Delete — offered on any bubble, not just a failed one. */
  onLongPress?: (message: ChatMessage) => void;
  /**
   * Change when a held message goes out.
   *
   * Its own prop rather than a route through the long-press menu: "Edit" sits beside the
   * time in the header, so it should do the thing the time is about. Everything else you
   * might want to do with a held message is still a press and hold away.
   */
  onEditSchedule?: (message: ChatMessage) => void;
  /**
   * Who wrote this, for group conversations.
   *
   * Only supplied in a group, where it is the difference between a usable conversation
   * and an anonymous wall of text: with three or more people talking, an incoming bubble
   * with no author cannot be attributed to anyone. A one-to-one chat needs nothing, since
   * every incoming message is from the person named in the header.
   */
  senderName?: string;
  /**
   * True only for the newest outgoing message in the thread.
   *
   * The receipt belongs under that one and nowhere else. Repeating "Delivered" beside
   * every bubble turns a status into wallpaper — you stop reading it, which is the
   * opposite of what a receipt is for — and it puts a word next to the message you are
   * trying to read. One line, at the bottom, where the eye already is after sending.
   */
  showReceipt?: boolean;
  /** Stable per-peer colour, so the eye can follow one speaker down the thread. */
  senderTint?: string;
  /**
   * Colours forced by this conversation's wallpaper, or null for the theme's own.
   *
   * Passed in rather than read from a context because the wallpaper belongs to the
   * conversation, not to the app: two threads open in the same session can be drawn in
   * different palettes, and a bubble should take its colours from the thread it is in.
   * Every value here was derived from the image and checked for contrast — see
   * config/wallpapers.ts.
   */
  palette?: {ink: string; meta: string; bubbleIn: string; bubbleOut: string} | null;
}

/**
 * Status text is a direct rendering of the delivery state machine.
 * "Sent" means a BLE write completed. "Delivered" means the peer returned an ACK.
 */
const STATUS_TEXT: Record<ChatMessage['status'], string> = {
  scheduled: 'Scheduled',
  pending: 'Waiting to send',
  sending: 'Sending',
  sent: 'Sent',
  received: 'Delivered',
  failed: 'Failed',
};

/**
 * An icon per state, so the receipt reads without being read.
 *
 * A clock for something not yet on its way, an upward arrow while it is going, a tick
 * once it has left, a double tick once the other phone confirmed it, and a warning when
 * it did not arrive. The word stays beside it — the difference between "sent" and
 * "delivered" is exactly the thing a glyph alone cannot express.
 */
const STATUS_ICON: Record<ChatMessage['status'], IconName> = {
  scheduled: 'clock',
  pending: 'clock',
  sending: 'arrowUp',
  sent: 'check',
  received: 'checkDouble',
  failed: 'alert',
};

/**
 * The mark beside a delivery state.
 *
 * One tick means it left this phone; two mean the other phone confirmed it. That is the
 * distinction the whole receipt exists for, and it is expressed as one tick versus two
 * rather than in the words — "sent" and "delivered" are what a reader needs, and the
 * protocol's own vocabulary for the confirmation is not.
 */
const STATUS_TICK: Record<ChatMessage['status'], string> = {
  scheduled: '···',
  pending: '···',
  sending: '···',
  sent: '✓',
  received: '✓✓',
  failed: '!',
};

/** Written but not yet on the radio — the state the dashed bubble draws. */
function isWaiting(status: ChatMessage['status']): boolean {
  return status === 'pending';
}

/**
 * The colour of the receipt, decided by what is BEHIND it.
 *
 * A filled bubble is not a page. `ok` is #0F7B54 and `error` is #B42318 — greens and
 * reds chosen to carry meaning against the app's near-white ground — and both were being
 * painted onto a #4C3FE0 bubble, where they read as mud. The delivered state was the
 * worst of it: dark green on violet, on the message you most want to check.
 *
 * So on the filled bubble everything is white, and the state is carried by the mark
 * itself — one tick sent, two delivered. Semantic colour is kept for the bubbles that
 * are NOT filled: a waiting or failed message is drawn as an outline on the page, where
 * amber and red are legible and mean what they always mean.
 */
function statusColor(status: ChatMessage['status'], t: Theme): string {
  if (status === 'failed') {
    // Failed messages render as an outlined bubble on the page, not a filled one.
    return t.error;
  }
  if (isWaiting(status)) {
    // Also an outline — dashed — so amber reads here as it does everywhere else.
    return t.warn;
  }
  /**
   * `bubbleOutMeta`, not `onAccentDim`. The outgoing bubble holds #4C3FE0 in BOTH
   * themes while the accent itself lifts to a pale violet in dark mode — so the
   * on-accent token is near-black there, and using it would put dark ink on a dark
   * violet bubble the moment the theme flipped. The theme carries a separate token for
   * this bubble precisely because of that.
   */
  return t.bubbleOutMeta;
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
  onEditSchedule,
  senderName,
  senderTint,
  showReceipt = false,
  palette,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const outgoing = message.direction === 'outgoing';

  /**
   * A message that is exactly one known emoji is drawn as the sticker it is.
   *
   * No bubble, no fill, no timestamp inside it — a sticker with chrome around it is just
   * a small picture in a box. The receipt still appears under the last one, because
   * "did that arrive" is as real a question for a sticker as for a sentence.
   */
  const sticker = outgoing || message.direction === 'incoming' ? stickerFor(message.text) : null;

  const stickerBody = sticker ? (
    <View style={outgoing ? styles.stickerWrapOut : styles.stickerWrapIn}>
      {!outgoing && senderName ? (
        <AppText
          style={[styles.sender, senderTint ? {color: senderTint} : null]}
          numberOfLines={1}>
          {senderName}
        </AppText>
      ) : null}
      <Image
        source={sticker.source}
        style={styles.sticker}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={sticker.label}
      />
      <AppText
        style={[styles.stickerTime, palette ? {color: palette.meta} : null]}
        numberOfLines={1}>
        {clock(message.receivedAt)}
      </AppText>
    </View>
  ) : null;

  const body = stickerBody ?? (
    <View
      style={[
        styles.bubble,
        outgoing ? styles.out : styles.in,
        palette
          ? {backgroundColor: outgoing ? palette.bubbleOut : palette.bubbleIn}
          : null,
        // Nothing has gone out yet, so the bubble is not filled in yet either. A dashed
        // outline says "written, not sent" at a glance — where a solid accent bubble
        // with a small grey word under it says "sent" first and corrects itself second.
        outgoing && isWaiting(message.status) && styles.queued,
        // Held on purpose, so it is drawn as an intention rather than as a problem: the
        // same "not sent yet" dashed outline as a queued message, but in the accent
        // instead of the warning grey. Nothing has gone wrong with this one.
        message.status === 'scheduled' && styles.scheduled,
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

      <AppText
        style={[
          styles.text,
          outgoing ? styles.textOut : styles.textIn,
          // On a wallpaper, incoming text takes the derived ink; outgoing stays white,
          // which every derived bubble colour was checked against at 4.5:1.
          palette && !outgoing ? {color: palette.ink} : null,
          outgoing && isWaiting(message.status) && {color: theme.textDim},
          message.status === 'scheduled' && {color: theme.accentQuiet},
        ]}>
        {message.text}
      </AppText>

      <View style={styles.footer}>
        <AppText
          style={[
            styles.time,
            outgoing ? styles.metaOut : styles.metaIn,
            palette && !outgoing ? {color: palette.meta} : null,
          ]}
          numberOfLines={1}>
          {clock(message.receivedAt)}
        </AppText>
        {outgoing && message.groupId ? (
          // Group delivery is per recipient, so a single tick would be a lie: show how
          // many members have actually acknowledged.
          <LandIn token={`${message.status}:${message.deliveredTo?.length ?? 0}`}>
            <AppText
              style={[styles.tick, {color: statusColor(message.status, theme)}]}
              numberOfLines={1}>
              {message.deliveredTo?.length ?? 0} of {message.recipientCount ?? 0}{' '}
              delivered
            </AppText>
          </LandIn>
        ) : outgoing && message.status === 'sending' && message.fragmentProgress ? (
          // A bar, not "3/7" in the same grey as the timestamp. A long message split
          // across seven writes takes visibly longer than a short one, and a filling
          // track is the only form of this that reads at a glance — which is the whole
          // point of showing fragment progress rather than a spinner.
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(
                      (message.fragmentProgress.sent /
                        Math.max(1, message.fragmentProgress.total)) *
                        100,
                    )}%`,
                  },
                ]}
              />
            </View>
            {/* The bar says how far; the count of frames underneath it is a fact about
                the transport, not about the message, and belongs in Diagnostics. */}
            <AppText style={styles.progressLabel} numberOfLines={1}>
              Sending
            </AppText>
          </View>
        ) : outgoing ? (
          // The tick AND the word. A tick alone is a guess on the reader's part, and the
          // difference between "sent" (it left this phone) and "delivered" (the other
          // phone has it) is exactly the thing a tick cannot express. Keying the landing
          // animation on the status means each mark appears at the moment its own event
          // arrived — no timer ever advances it.
          <LandIn token={message.status}>
            <View style={styles.receipt}>
              <Icon
                name={STATUS_ICON[message.status]}
                size={11}
                strokeWidth={2.4}
                color={statusColor(message.status, theme)}
              />
              {/*
                The word only where it is doing work. A message that is waiting or has
                failed needs explaining, and it sits on an outlined bubble with room for
                it. Sent and delivered are carried by the mark — one tick or two — with
                the receipt line under the last message saying it in full.
              */}
              {isWaiting(message.status) || message.status === 'failed' ? (
                <AppText
                  style={[styles.tick, {color: statusColor(message.status, theme)}]}
                  numberOfLines={1}>
                  {STATUS_TEXT[message.status]}
                </AppText>
              ) : null}
            </View>
          </LandIn>
        ) : null}
        {outgoing && message.status === 'failed' && (
          <AppText style={styles.failedHint} numberOfLines={1}>
            tap to retry
          </AppText>
        )}
      </View>
    </View>
  );

  // Only for states that have actually settled: a message still on its way is already
  // saying so inside its own bubble, and two live labels for one message is noise.
  const receipt =
    showReceipt &&
    outgoing &&
    (message.status === 'sending' ||
      message.status === 'sent' ||
      message.status === 'received')
      ? STATUS_TEXT[message.status]
      : null;

  return (
    <View style={[styles.row, outgoing ? styles.rowOut : styles.rowIn]}>
      {/*
        The header a held message needs, above the bubble rather than inside it.

        A scheduled message is the one thing in a thread that has not happened yet, and
        the time it will happen is more important than anything in the bubble — so it goes
        where a day divider goes, and "Edit" sits beside it because changing your mind is
        the most likely next action on something that has not been sent.
      */}
      {message.status === 'scheduled' && message.scheduledFor ? (
        <View style={styles.scheduleHead}>
          <AppText style={styles.scheduleTitle}>Send Later</AppText>
          <View style={styles.scheduleWhenRow}>
            <AppText style={styles.scheduleWhen}>
              {describeSchedule(message.scheduledFor)}
            </AppText>
            {onEditSchedule ? (
              <TouchableOpacity
                onPress={() => onEditSchedule(message)}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                accessibilityRole="button"
                accessibilityLabel="Edit scheduled message">
                <AppText style={styles.scheduleEdit}>Edit</AppText>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
      <TouchableOpacity
        activeOpacity={onLongPress || (outgoing && message.status === 'failed') ? 0.7 : 1}
        onPress={
          outgoing && message.status === 'failed' ? () => onRetry(message) : undefined
        }
        onLongPress={onLongPress ? () => onLongPress(message) : undefined}>
        {body}
      </TouchableOpacity>
      {receipt ? (
        <LandIn token={receipt}>
          <AppText
            style={[styles.receiptLine, palette ? {color: palette.meta} : null]}
            numberOfLines={1}>
            {receipt}
          </AppText>
        </LandIn>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(t => ({
  row: {paddingHorizontal: spacing.lg, marginVertical: spacing.xs},
  rowOut: {alignItems: 'flex-end'},
  // Small, quiet, and outside the bubble — a note about the message rather than part of
  // it. Sits under the last one only.
  receiptLine: {
    ...typography.caption,
    fontSize: 11,
    color: t.textFaint,
    marginTop: 3,
    marginRight: 2,
  },
  rowIn: {alignItems: 'flex-start'},

  // A sticker sits on the page, not in a bubble. 96pt is large enough to read the
  // drawing and small enough that three in a row do not become the conversation.
  stickerWrapOut: {alignItems: 'flex-end'},
  stickerWrapIn: {alignItems: 'flex-start'},
  sticker: {width: 96, height: 96},
  stickerTime: {...typography.caption, fontSize: 10.5, color: t.textFaint, marginTop: 1},

  // Centred over the bubble, like a day divider — because that is what it is: a marker
  // for a moment in the thread, except the moment has not arrived yet.
  scheduleHead: {alignItems: 'center', alignSelf: 'stretch', marginBottom: 6, gap: 1},
  scheduleTitle: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: t.textDim,
  },
  scheduleWhenRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  scheduleWhen: {...typography.caption, fontSize: 11, color: t.textFaint},
  scheduleEdit: {...typography.caption, fontSize: 11, fontWeight: '600', color: t.accent},
  bubble: {
    maxWidth: '78%',
    // Guarantees room for the timestamp row even behind a very short message, so the
    // bubble is never sized narrower than its own metadata.
    minWidth: 96,
    // A larger radius with one corner tucked in: the tucked corner is what makes a
    // bubble read as coming FROM a side rather than floating.
    borderRadius: radius.xl,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  out: {backgroundColor: t.bubbleOut, borderBottomRightRadius: radius.sm},
  queued: {backgroundColor: 'transparent', borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.dash},
  // The same "not on the radio yet" outline as queued, in the accent: this one is waiting
  // because you asked it to, not because anything went wrong.
  scheduled: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: t.accent,
  },
  // A fill, never a border. The incoming bubble used to be white with a hairline and a
  // shadow because it shared a colour with the thread behind it; giving it the sunk grey
  // instead separates it with no outline at all — and on dark, a hairline round a bubble
  // is louder than the bubble.
  in: {backgroundColor: t.bubbleIn, borderBottomLeftRadius: radius.sm},
  failed: {borderWidth: 1, borderColor: t.error},
  sender: {...typography.caption, fontWeight: '500', marginBottom: 3},
  text: {...typography.body},
  // An incoming bubble is light in light mode, so white text would be invisible.
  textOut: {color: t.bubbleOutText},
  textIn: {color: t.bubbleInText},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 3,
    // Wraps instead of clipping when "failed - tap to retry" cannot fit on one line.
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  // Mono, like every other measured value in the app: a clock time is one.
  time: {...typography.monoTiny},
  metaOut: {color: t.bubbleOutMeta},
  metaIn: {color: t.bubbleMeta},
  tick: {...typography.caption, fontSize: 11, fontWeight: '500'},
  receipt: {flexDirection: 'row', alignItems: 'center', gap: 4},
  progressRow: {flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginTop: 2},
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {height: 3, borderRadius: 2, backgroundColor: '#ffffff'},
  progressLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.86)',
  },
  failedHint: {...typography.caption, fontSize: 10, color: t.error},
}));
