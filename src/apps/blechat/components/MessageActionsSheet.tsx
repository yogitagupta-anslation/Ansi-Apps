import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import type {ChatMessage} from '../types/Message';

/**
 * What you can do with one message.
 *
 * The message itself is lifted above the menu rather than named in a title, because in a
 * thread of similar-looking lines "Message" at the top of an alert does not tell you
 * which one you long-pressed. Seeing it float there does.
 *
 * "Delete for me" says exactly that. There is no server copy to remove and the other
 * phone already has the bytes — a plain "Delete" would be claiming a reach this app does
 * not have.
 */
export function MessageActionsSheet({
  message,
  onClose,
  onCopy,
  onRetry,
  onDelete,
}: {
  message: ChatMessage | null;
  onClose: () => void;
  onCopy: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  if (!message) {
    return null;
  }

  const outgoing = message.direction === 'outgoing';
  const canRetry = outgoing && message.status === 'failed';

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

          <View style={styles.menu}>
            <Row icon="copy" label="Copy text" onPress={onCopy} first />
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
