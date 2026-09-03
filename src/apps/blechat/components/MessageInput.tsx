import React, {useState} from 'react';
import {TextInput, TouchableOpacity, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from './AppText';

interface Props {
  enabled: boolean;
  disabledReason: string;
  onSend: (text: string) => void;
  /**
   * Border tint reflecting the link, not just the input's own enabled/disabled boolean —
   * amber while a reconnect is under way reads differently from the flat grey of "never
   * tried", even though typing is equally blocked in both.
   */
  tone?: string;
}

export function MessageInput({enabled, disabledReason, onSend, tone}: Props) {
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
            placeholder={enabled ? 'Type a message...' : 'Not connected'}
            placeholderTextColor={theme.textDim}
            editable={enabled}
            multiline
            onSubmitEditing={submit}
            returnKeyType="send"
            maxFontSizeMultiplier={1.3}
          />
        </View>
        <TouchableOpacity
          style={[styles.send, (!enabled || !text.trim()) && styles.sendOff]}
          onPress={submit}
          disabled={!enabled || !text.trim()}
          accessibilityLabel="Send message">
          <AppText style={styles.sendGlyph} maxFontSizeMultiplier={1}>
            ➤
          </AppText>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  wrapper: {
    backgroundColor: t.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  disabled: {...typography.caption, color: t.warn, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm},
  inputWrap: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  input: {
    minHeight: 44,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    color: t.text,
    ...typography.body,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: {backgroundColor: t.surfaceAlt},
  sendGlyph: {color: t.onAccent, fontSize: 17, marginLeft: -2},
}));
