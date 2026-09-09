import React from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing} from '../config/theme';

/**
 * A confirmation you can read before you answer it.
 *
 * The platform alert would do for a yes/no, but not for a decision whose consequences
 * are the whole question. Deleting a conversation here is not like deleting one in an
 * app with a server: there is no copy to restore from and no copy to remove from the
 * other phone. Both of those facts change the answer, and both need room to be said.
 *
 * So: the destructive verb on the button, the consequence spelled out above it, and
 * Cancel given equal weight rather than styled as an afterthought — the safe choice
 * should never be the harder one to hit.
 */
export function ConfirmSheet({
  visible,
  icon,
  title,
  body,
  /** The word on the button. "Delete", not "OK" — a button should name what it does. */
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  icon?: IconName;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        {/* Tapping away cancels. The safe outcome is the one that happens by accident. */}
        <Pressable onPress={onCancel} style={StyleSheet.absoluteFill} accessibilityLabel="Cancel" />

        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.xl}]}>
          <View style={styles.grip} />

          <View style={styles.head}>
            {icon ? <Icon name={icon} size={19} color={theme.error} strokeWidth={2} /> : null}
            <AppText style={styles.title}>{title}</AppText>
          </View>

          <DenseText style={styles.body}>{body}</DenseText>

          <Touchable
            scale={false}
            onPress={onCancel}
            style={styles.cancel}
            accessibilityRole="button">
            <DenseText style={styles.cancelText}>Cancel</DenseText>
          </Touchable>
          <Touchable
            scale={false}
            onPress={onConfirm}
            style={styles.confirm}
            accessibilityRole="button">
            <DenseText style={styles.confirmText}>{confirmLabel}</DenseText>
          </Touchable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(t => ({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: t.isDark ? 'rgba(4,4,6,0.66)' : 'rgba(23,23,26,0.42)',
  },
  sheet: {
    backgroundColor: t.isDark ? t.surface : t.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  grip: {
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: t.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  head: {flexDirection: 'row', alignItems: 'center', gap: 10},
  title: {fontSize: 19, fontWeight: '500', letterSpacing: -0.3, color: t.text, flex: 1},
  body: {fontSize: 13.5, lineHeight: 20, color: t.textDim, marginTop: 10},
  cancel: {
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  cancelText: {fontSize: 14.5, fontWeight: '500', color: t.text},
  confirm: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: t.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  confirmText: {fontSize: 14.5, fontWeight: '500', color: '#ffffff'},
}));
