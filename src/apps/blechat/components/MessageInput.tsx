import React, {useState} from 'react';
import {TextInput, TouchableOpacity, View} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {DenseText} from './AppText';
import {Icon} from './ui/Icon';
import {GradientSurface, brandGradient} from './ui/Gradient';

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
        {/* The one gradient-filled control outside Home's hero. Send is the single
            most-used action in the app and the only thing on this bar that commits
            anything, so it is the only thing that gets the brand fill. */}
        <TouchableOpacity
          onPress={submit}
          disabled={!enabled || !text.trim()}
          accessibilityLabel="Send message">
          {enabled && text.trim() ? (
            <GradientSurface
              gradient={brandGradient(theme)}
              radius={23}
              style={styles.send}>
              <Icon name="chevronRight" color={theme.onAccent} size={20} />
            </GradientSurface>
          ) : (
            <View style={[styles.send, styles.sendOff]}>
              <Icon name="chevronRight" color={theme.textFaint} size={20} />
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = makeStyles(t => ({
  wrapper: {
    backgroundColor: t.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  disabled: {...typography.caption, color: t.warn, marginBottom: spacing.sm},
  row: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm},
  inputWrap: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: t.border,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: t.isDark ? 0 : 0.05,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 1},
  },
  input: {
    minHeight: 46,
    maxHeight: 120,
    paddingVertical: spacing.sm,
    color: t.text,
    ...typography.body,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: t.gradient[1],
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 4,
  },
  sendOff: {backgroundColor: t.surfaceAlt, shadowOpacity: 0, elevation: 0},
}));
