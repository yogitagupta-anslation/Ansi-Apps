import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {describeSchedule} from '../utils/time';
import type {ChatMessage} from '../types/Message';

/**
 * What you can do with one message.
 *
 * The message itself is lifted above the menu rather than named in a title, because in a
 * thread of similar-looking lines "Message" at the top of an alert does not tell you
 * which one you long-pressed. Seeing it float there does.
 *
 * Every label here promises only what this app can actually do:
 *
 * "Delete for me" says exactly that. There is no server copy to remove and the other
 * phone already has the bytes — a plain "Delete" would claim a reach this app has not
 * got.
 *
 * "Edit" is offered only while a message is still on this phone. There is no edit packet
 * in the protocol, so editing something already delivered would change your copy and
 * leave theirs as it was — two people reading different words and no way to tell. On a
 * message that has not gone yet, editing is simply true: it takes the text back to the
 * composer to be sent as you meant it.
 *
 * The delivery detail sits in the sheet rather than behind another tap, because the
 * question it answers — did this actually reach them, and when — is the reason people
 * press and hold in the first place.
 */
export function MessageActionsSheet({
  message,
  onClose,
  onCopy,
  onRetry,
  onDelete,
  onEdit,
  onSendNow,
  onEditSchedule,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onDelete: () => void;
  /** Takes an unsent message back to the composer. Absent when nothing can be edited. */
  onEdit?: () => void;
  /** Release a held message immediately. Only meaningful while it is still held. */
  onSendNow?: () => void;
  /** Reopen the picker on a held message's time. */
  onEditSchedule?: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!message) {
    return null;
  }

  const outgoing = message.direction === 'outgoing';
  const isScheduled = message.status === 'scheduled';
  const canRetry = outgoing && message.status === 'failed';
  /**
   * Still ours to change.
   *
   * Pending means it never left; failed means it left and did not arrive, and the peer
   * has nothing to disagree with. Anything sent or delivered is on another phone, where
   * this app cannot reach it.
   */
  const canEdit =
    outgoing &&
    (message.status === 'pending' ||
      message.status === 'failed' ||
      // A held message is the clearest case of all: it demonstrably has not left.
      isScheduled) &&
    !!onEdit;

  // Nothing has happened to a held message yet, so there is no journey to draw. The
  // header above the bubble already says when it will start.
  const steps = outgoing && !isScheduled ? deliverySteps(message) : null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Close" />

        <View style={[styles.stack, {paddingBottom: insets.bottom + spacing.xl}]}>
          {/* The message, as it appears in the thread — same fill, same tucked corner. */}
          <View style={outgoing ? styles.bubbleRowOut : styles.bubbleRowIn}>
            <View style={[styles.bubble, outgoing ? styles.bubbleOut : styles.bubbleIn]}>
              <AppText
                style={[styles.bubbleText, outgoing ? styles.textOut : styles.textIn]}
                numberOfLines={6}>
                {message.text}
              </AppText>
            </View>
          </View>

          {/* What happened to it, in the order it happened, with the times. The
              question people press and hold to answer. */}
          {steps && steps.length > 0 ? (
            <View style={styles.timeline}>
              {steps.map(step => (
                <View key={step.label} style={styles.step}>
                  <Icon
                    name={step.done ? 'check' : 'clock'}
                    size={13}
                    strokeWidth={2.4}
                    color={step.done ? theme.ok : theme.textFaint}
                  />
                  <AppText
                    style={[styles.stepLabel, !step.done && {color: theme.textFaint}]}
                    numberOfLines={1}>
                    {step.label}
                  </AppText>
                  <DenseText style={styles.stepTime}>{step.at}</DenseText>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.menu}>
            {/*
              A held message has two questions of its own, and they come first because
              they are the reason you pressed and held it: is it still going out when I
              said, and can I stop waiting. Everything below applies to any message.
            */}
            {isScheduled && onSendNow ? (
              <Row icon="arrowUp" label="Send now" onPress={onSendNow} first />
            ) : null}
            {isScheduled && onEditSchedule ? (
              <Row
                icon="clock"
                label="Change the time"
                hint={
                  message.scheduledFor
                    ? `Currently ${describeSchedule(message.scheduledFor)}`
                    : undefined
                }
                onPress={onEditSchedule}
              />
            ) : null}
            <Row icon="copy" label="Copy text" onPress={onCopy} first={!isScheduled} />
            {canEdit ? (
              <Row
                icon="pencil"
                label="Edit"
                hint="Brings it back to the composer"
                onPress={onEdit!}
              />
            ) : null}
            {canRetry ? <Row icon="arrowUp" label="Try sending again" onPress={onRetry} /> : null}
            <Row
              icon="trash"
              label="Delete for me"
              hint="Their copy stays"
              tone={theme.error}
              onPress={onDelete}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The message's journey, from what is actually recorded about it.
 *
 * Only steps that genuinely happened get a time. A step still ahead of the message is
 * listed without one rather than hidden, so the gap is visible: "left this phone" with
 * nothing after it is the clearest way to say the other phone has not confirmed yet.
 */
function deliverySteps(
  message: ChatMessage,
): Array<{label: string; at: string; done: boolean}> {
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const left = message.status !== 'pending';
  const arrived = message.status === 'received';
  return [
    {label: 'Written', at: at(message.receivedAt), done: true},
    {
      label: message.status === 'failed' ? 'Could not leave this phone' : 'Left this phone',
      at: left ? at(message.receivedAt) : '',
      done: left && message.status !== 'failed',
    },
    {label: 'Their phone confirmed it', at: arrived ? at(message.receivedAt) : '', done: arrived},
  ];
}

function Row({
  icon,
  label,
  hint,
  tone,
  onPress,
  first,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  tone?: string;
  onPress: () => void;
  first?: boolean;
}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Touchable
      scale={false}
      onPress={onPress}
      style={first ? styles.row : [styles.row, styles.rowDivided]}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}>
      <Icon name={icon} size={17} color={tone ?? theme.textDim} strokeWidth={1.9} />
      <View style={styles.rowText}>
        <AppText style={[styles.rowLabel, tone ? {color: tone} : null]}>{label}</AppText>
        {hint ? <DenseText style={styles.rowHint}>{hint}</DenseText> : null}
      </View>
    </Touchable>
  );
}

const useStyles = makeStyles(t => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: t.isDark ? 'rgba(4,4,6,0.62)' : 'rgba(23,23,26,0.42)',
  },
  stack: {paddingHorizontal: 14},
  timeline: {
    backgroundColor: t.surface,
    borderRadius: radius.lg,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  step: {flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7},
  stepLabel: {flex: 1, fontSize: 13.5, color: t.text},
  stepTime: {...typography.caption, color: t.textDim, fontVariant: ['tabular-nums']},
  bubbleRowOut: {alignItems: 'flex-end'},
  bubbleRowIn: {alignItems: 'flex-start'},
  bubble: {maxWidth: '80%', borderRadius: 18, paddingVertical: 9, paddingHorizontal: 13},
  bubbleOut: {backgroundColor: t.bubbleOut, borderBottomRightRadius: radius.sm},
  bubbleIn: {backgroundColor: t.bubbleIn, borderBottomLeftRadius: radius.sm},
  bubbleText: {fontSize: 14.5, lineHeight: 21},
  textOut: {color: t.bubbleOutText},
  textIn: {color: t.bubbleInText},

  menu: {
    backgroundColor: t.isDark ? t.surface : '#FFFFFF',
    borderRadius: 16,
    marginTop: 11,
    overflow: 'hidden',
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14},
  rowDivided: {borderTopWidth: 1, borderTopColor: t.divider},
  rowText: {flex: 1},
  rowLabel: {fontSize: 14, color: t.text},
  rowHint: {...typography.caption, color: t.textDim, marginTop: 1},
}));
