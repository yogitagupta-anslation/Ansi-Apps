import React from 'react';
import {Alert, Modal, Pressable, StyleSheet, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {AppText, DenseText} from './AppText';
import {Touchable} from './Motion';
import {Icon, type IconName} from './ui/Icon';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {radius, spacing, typography} from '../config/theme';
import {bleChat} from '../services/BleChatService';
import {useAppStore} from '../state/appStore';

/**
 * Log out, with the consequences named.
 *
 * There is no account here, so "log out" cannot mean what it usually means. What it
 * actually does is delete the identity key this phone was using — and everything derived
 * from it. That is closer to deleting an account than to signing out of one, so the sheet
 * says so before the button rather than after.
 *
 * The three lines under WHAT GOES are counted from real state, not written as prose. A
 * warning that says "your conversations" when there are none is noise; one that says
 * "4 conversations" and "2 messages still waiting to send" is the reason somebody might
 * stop.
 */
export function LogOutSheet({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const styles = useStyles();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Threads that actually hold something. An empty conversation record is a peer you
  // opened and never wrote to, and warning about losing it would be warning about nothing.
  const conversations = useAppStore(
    s => Object.values(s.conversations).filter(m => m.length > 0).length,
  );
  const queued = useAppStore(s => s.queuedTotal);
  const verifiedCount = useAppStore(s => s.verifiedPeerIds.length);

  const confirm = () => {
    Alert.alert(
      'Erase this identity?',
      'This cannot be undone. Nothing is stored anywhere else, so there is nothing to restore from.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Erase',
          style: 'destructive',
          onPress: () => {
            bleChat
              .eraseIdentity()
              .then(onClose)
              .catch(err =>
                Alert.alert('Could not erase', err instanceof Error ? err.message : String(err)),
              );
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Close" />

        <View style={[styles.sheet, {paddingBottom: insets.bottom + spacing.xl}]}>
          <View style={styles.grip} />

          <View style={styles.head}>
            <Icon name="unlock" size={19} color={theme.error} strokeWidth={2} />
            <AppText style={styles.title}>Log out of BLE Chat?</AppText>
          </View>

          <DenseText style={styles.body}>
            There is no account behind BLE Chat — your identity lives only on this phone.
            Logging out deletes it.
          </DenseText>

          <DenseText style={styles.label}>WHAT GOES</DenseText>

          <Loss
            icon="key"
            title="Your identity key"
            body={
              verifiedCount > 0
                ? `You'll come back as a new person. ${verifiedCount} ${
                    verifiedCount === 1 ? 'person who' : 'people who'
                  } verified you will have to verify you again.`
                : "You'll come back as a new person to everyone who has met you."
            }
          />
          {conversations > 0 ? (
            <Loss
              icon="chatBubble"
              title={`${conversations} conversation${conversations === 1 ? '' : 's'}`}
              body="Deleted from this phone. The other side keeps their copy — there is no server to delete it from."
            />
          ) : null}
          {queued > 0 ? (
            <Loss
              icon="clock"
              title={`${queued} message${queued === 1 ? '' : 's'} still waiting to send`}
              body={queued === 1 ? "It'll never arrive." : "They'll never arrive."}
            />
          ) : null}

          <Touchable scale={false} onPress={onClose} style={styles.keep}>
            <DenseText style={styles.keepText}>Keep me logged in</DenseText>
          </Touchable>
          <Touchable scale={false} onPress={confirm} style={styles.erase}>
            <Icon name="trash" size={15} color="#ffffff" strokeWidth={2} />
            <DenseText style={styles.eraseText}>Log out and erase</DenseText>
          </Touchable>
        </View>
      </View>
    </Modal>
  );
}

function Loss({icon, title, body}: {icon: IconName; title: string; body: string}) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View style={styles.loss}>
      <Icon name={icon} size={15} color={theme.error} strokeWidth={1.9} />
      <View style={styles.lossText}>
        <AppText style={styles.lossTitle}>{title}</AppText>
        <DenseText style={styles.lossBody}>{body}</DenseText>
      </View>
    </View>
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
  body: {fontSize: 13.5, lineHeight: 20, color: t.textDim, marginTop: 12},
  label: {...typography.overline, color: t.textDim, marginTop: 22, marginBottom: 4},
  loss: {flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 9},
  lossText: {flex: 1},
  lossTitle: {fontSize: 13.5, fontWeight: '500', color: t.text},
  lossBody: {...typography.caption, color: t.textDim, marginTop: 2},
  keep: {
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  keepText: {fontSize: 14.5, fontWeight: '500', color: t.text},
  erase: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: t.error,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 9,
  },
  eraseText: {fontSize: 14.5, fontWeight: '500', color: '#ffffff'},
}));
