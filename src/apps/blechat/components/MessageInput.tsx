import React, {useState} from 'react';
import {TextInput, TouchableOpacity, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {DenseText} from './AppText';
import {Icon} from './ui/Icon';

interface Props {
  enabled: boolean;
  disabledReason: string;
  onSend: (text: string) => void;
  /** "Message Jaismeet" beats "Type a message...": it names where this is going. */
  placeholder?: string;
  /**
   * Border tint reflecting the link, not just the input's own enabled/disabled boolean —
   * amber while a reconnect is under way reads differently from the flat grey of "never
   * tried", even though typing is equally blocked in both.
   */
  tone?: string;
}

export function MessageInput({enabled, disabledReason, onSend, tone, placeholder}: Props) {
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

  return (
    <View style={styles.wrapper}>
      {!enabled && <DenseText style={styles.disabled}>{disabledReason}</DenseText>}
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
            placeholder={enabled ? placeholder ?? 'Type a message...' : 'Not connected'}
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
            <View style={[styles.send, {backgroundColor: theme.accent}]}>
              <Icon name="arrowUp" color={theme.onAccent} size={16} strokeWidth={2.4} />
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
  disabled: {...typography.caption, color: t.warn, marginBottom: spacing.sm},
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
