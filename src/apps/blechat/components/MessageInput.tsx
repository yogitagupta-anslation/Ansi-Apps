import React, {useState} from 'react';
import {ScrollView, TextInput, TouchableOpacity, View} from 'react-native';
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
   * The link is down, but the message will still be kept and sent later.
   *
   * Separate from `enabled` because they are different facts: this one does not stop you
   * typing, it changes what the send button is promising.
   */
  queueing?: boolean;
  queueingReason?: string;
  onSend: (text: string) => void;
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
  queueing = false,
  queueingReason,
  onSend,
  tone,
  placeholder,
}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const [text, setText] = useState('');

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

      {/* Reassurance, not a warning. The message is going to be delivered — just not
          this second — so this says what will happen rather than what has failed. */}
      {enabled && queueing && queueingReason ? (
        <View style={styles.queueing}>
          <Icon name="clock" color={theme.warn} size={14} strokeWidth={2.2} />
          <DenseText style={styles.queueingText}>{queueingReason}</DenseText>
        </View>
      ) : null}

      <View style={styles.row}>
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
          disabled={!enabled || !text.trim()}
          accessibilityLabel="Send message">
          {enabled && text.trim() ? (
            // Outlined amber rather than filled accent while the link is down: the tap
            // still works and the message is still kept, but a filled "send" would be
            // promising something that is not going to happen for a while.
            <View
              style={[
                styles.send,
                queueing
                  ? {borderWidth: 1.5, borderColor: theme.warn}
                  : {backgroundColor: theme.accent},
              ]}>
              <Icon
                name={queueing ? 'clock' : 'arrowUp'}
                color={queueing ? theme.warn : theme.onAccent}
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
