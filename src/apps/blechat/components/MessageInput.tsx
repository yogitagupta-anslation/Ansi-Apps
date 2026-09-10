import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, TextInput, TouchableOpacity, View} from 'react-native';
import {Touchable} from './Motion';
import {describeSchedule} from '../utils/time';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {DenseText} from './AppText';
import {Icon} from './ui/Icon';

interface Props {
  /** False only when there is no addressable peer at all — never merely "offline". */
  enabled: boolean;
  /**
   * One-tap replies for this moment, or empty for none.
   *
   * Shown above the row and only while the field is untouched: the instant someone
   * starts typing they have said what they want, and a row of guesses underneath it is
   * in the way.
   */
  suggestions?: readonly string[];
  /**
   * Text handed back to the field — an unsent message taken out of the thread to be
   * edited. Carries a token rather than being watched by value, so re-editing the same
   * text twice still lands.
   */
  draft?: {text: string; token: number} | null;
  /**
   * The link is down, but the message will still be kept and sent later.
   *
   * Separate from `enabled` because they are different facts: this one does not stop you
   * typing, it changes what the send button is promising.
   */
  queueing?: boolean;
  queueingReason?: string;
  onSend: (text: string) => void;
  /**
   * Hold the send button to pick a time. Absent where scheduling makes no sense.
   *
   * A long press rather than a button of its own: sending is the thing this bar is for,
   * and "send, but later" is a variation on it — not a second, equal action deserving its
   * own permanent target next to the first.
   */
  onSchedulePress?: () => void;
  /** Opens the sticker tray. Absent where there is no conversation to send one to. */
  onStickerPress?: () => void;
  /**
   * A time already chosen, shown above the field until it is sent or cleared.
   *
   * While this is set the send button commits to that time instead of to now, which is
   * why it is passed in rather than kept here: the screen owns the decision, the composer
   * only reports it.
   */
  scheduledFor?: number | null;
  onClearSchedule?: () => void;
  /** "Message Jaismeet" beats "Type a message...": it names where this is going. */
  placeholder?: string;
  /**
   * Border tint reflecting the link, not just the input's own enabled/disabled boolean —
   * amber while a reconnect is under way reads differently from the flat grey of "never
   * tried".
   */
  tone?: string;
}

export function MessageInput({
  enabled,
  suggestions,
  draft,
  queueing = false,
  queueingReason,
  onSend,
  onSchedulePress,
  onStickerPress,
  scheduledFor,
  onClearSchedule,
  tone,
  placeholder,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const [text, setText] = useState('');
  const lastDraft = useRef<number | null>(null);

  useEffect(() => {
    if (draft && draft.token !== lastDraft.current) {
      lastDraft.current = draft.token;
      setText(draft.text);
    }
  }, [draft]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || !enabled) {
      return;
    }
    onSend(trimmed);
    setText('');
  };

  const showSuggestions =
    enabled && !text.trim() && !!suggestions && suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      {showSuggestions ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.suggestions}>
          {suggestions.map(suggestion => (
            <TouchableOpacity
              key={suggestion}
              style={styles.chip}
              onPress={() => onSend(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={`Send "${suggestion}"`}>
              <DenseText style={styles.chipText} maxFontSizeMultiplier={1.2}>
                {suggestion}
              </DenseText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {/*
        The time you picked, sitting where you can see it and take it back.

        Between choosing a time and pressing send, the composer is in a mode — and an
        invisible mode is how somebody schedules a message they meant to send now. The
        chip is the mode made visible, and tapping it reopens the picker rather than
        making you clear it and start again.
      */}
      {scheduledFor ? (
        <View style={styles.scheduleChip}>
          <Icon name="clock" color={theme.accent} size={13} strokeWidth={2.2} />
          <Touchable
            scale={false}
            onPress={onSchedulePress}
            style={styles.scheduleChipMain}
            accessibilityRole="button"
            accessibilityLabel={`Sending ${describeSchedule(scheduledFor)}. Change the time`}>
            <DenseText style={styles.scheduleChipText} numberOfLines={1}>
              {describeSchedule(scheduledFor)}
            </DenseText>
            <Icon name="chevronRight" color={theme.accent} size={13} strokeWidth={2.2} />
          </Touchable>
          <Touchable
            scale={false}
            onPress={onClearSchedule}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Send now instead">
            <Icon name="close" color={theme.textDim} size={14} strokeWidth={2.2} />
          </Touchable>
        </View>
      ) : null}

      {/* Reassurance, not a warning. The message is going to be delivered — just not
          this second — so this says what will happen rather than what has failed. */}
      {enabled && queueing && queueingReason && !scheduledFor ? (
        <View style={styles.queueing}>
          <Icon name="clock" color={theme.warn} size={14} strokeWidth={2.2} />
          <DenseText style={styles.queueingText}>{queueingReason}</DenseText>
        </View>
      ) : null}

      <View style={styles.row}>
        {/* Left of the field, where an attachment button lives in every messenger the
            reader already uses. Hidden once there is text: at that point the message is
            words, and a sticker would replace them rather than join them. */}
        {onStickerPress && !text.trim() ? (
          <Touchable
            scale={false}
            onPress={onStickerPress}
            style={styles.stickerButton}
            accessibilityRole="button"
            accessibilityLabel="Stickers">
            <Icon name="sticker" color={theme.textDim} size={19} strokeWidth={1.9} />
          </Touchable>
        ) : null}
        <View
          style={[
            styles.inputWrap,
            tone ? {borderColor: tone} : null,
          ]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={
              enabled
                ? queueing
                  ? 'Message — will send when they are back'
                  : placeholder ?? 'Type a message...'
                : 'Not connected'
            }
            placeholderTextColor={theme.textFaint}
            editable={enabled}
            multiline
            onSubmitEditing={submit}
            returnKeyType="send"
            maxFontSizeMultiplier={1.3}
          />
        </View>
        {/* Flat accent, not a gradient. Send is the single most-used action in the app
            and the only thing on this bar that commits anything, so it is the only thing
            that gets a fill — and one flat colour is enough to say so. The arrow points
            up rather than right: the message travels up into the thread. */}
        <TouchableOpacity
          onPress={submit}
          onLongPress={
            // Only worth offering once there is something to schedule. A long press on an
            // empty composer that opens a time picker is a menu appearing out of nowhere.
            onSchedulePress && enabled && text.trim() ? onSchedulePress : undefined
          }
          delayLongPress={350}
          disabled={!enabled || !text.trim()}
          accessibilityLabel={
            scheduledFor
              ? `Schedule message for ${describeSchedule(scheduledFor)}`
              : 'Send message'
          }
          accessibilityHint={
            onSchedulePress && !scheduledFor ? 'Hold to send later' : undefined
          }>
          {enabled && text.trim() ? (
            // Outlined amber rather than filled accent while the link is down: the tap
            // still works and the message is still kept, but a filled "send" would be
            // promising something that is not going to happen for a while.
            <View
              style={[
                styles.send,
                queueing && !scheduledFor
                  ? {borderWidth: 1.5, borderColor: theme.warn}
                  : {backgroundColor: theme.accent},
              ]}>
              {/* A clock on the button while a time is armed: the same tap now commits to
                  a moment rather than to now, and the button should say which. */}
              <Icon
                name={scheduledFor ? 'clock' : queueing ? 'clock' : 'arrowUp'}
                color={
                  scheduledFor
                    ? theme.onAccent
                    : queueing
                    ? theme.warn
                    : theme.onAccent
                }
                size={16}
                strokeWidth={2.4}
              />
            </View>
          ) : (
            <View style={[styles.send, styles.sendOff]}>
              <Icon name="arrowUp" color={theme.textFaint} size={16} strokeWidth={2.4} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  // A hairline above the row, and the row itself sits on the page. The composer used to
  // be a bordered, shadowed capsule floating on a bordered bar — two containers for one
  // text field.
  wrapper: {
    backgroundColor: t.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: spacing.lg,
  },
  // A row of one-tap replies, in the accent so they read as something to press rather
  // than something to read. Outlined, not filled: the send button is the only filled
  // thing in this bar and it should stay that way.
  suggestions: {flexDirection: 'row', gap: 7, paddingBottom: 12, paddingRight: spacing.lg},
  chip: {
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipText: {fontSize: 13, fontWeight: '500', color: t.accentQuiet},
  // Reads as a control, not a warning: this is a choice you made, in the accent, with the
  // way out sitting inside it.
  scheduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radius.md,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 12,
  },
  scheduleChipMain: {flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1},
  scheduleChipText: {fontSize: 13, fontWeight: '500', color: t.accentQuiet},
  queueing: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingBottom: 12,
  },
  queueingText: {...typography.caption, color: t.warn, flex: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.divider,
    paddingTop: 14,
  },
  stickerButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {flex: 1, justifyContent: 'center'},
  input: {
    minHeight: 34,
    maxHeight: 120,
    paddingVertical: 6,
    color: t.text,
    ...typography.body,
  },
  // 34px, matching the design. The send button is the one filled thing in a thread's
  // chrome, so it does not also need a coloured shadow under it.
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {backgroundColor: t.surfaceAlt},
}));
