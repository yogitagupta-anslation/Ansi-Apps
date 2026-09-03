import React, {useCallback, useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from '../components/AppText';
import {InterestPicker} from '../components/InterestPicker';
import {Button} from '../components/ui/Surface';
import {FadeIn} from '../components/Motion';
import {bleChat} from '../services/BleChatService';
import {
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
  MIN_DISPLAY_NAME_LENGTH,
  sanitiseDisplayName,
  sanitiseInterests,
} from '../config/interests';

/**
 * First launch: who you are, before you meet anybody.
 *
 * The app is for talking to strangers who happen to be nearby, and a stranger will not
 * start a conversation with "Phone-143". A name they can read and a couple of interests
 * are the whole difference between a list of devices and a list of people.
 *
 * Deliberately a gate rather than a prompt that can be skipped: the profile is sent in
 * the handshake, so a peer met before the profile exists would be labelled with the
 * placeholder for as long as that peer remembers us.
 */
export function RegisterScreen() {
  const styles = useStyles();
  const theme = useTheme();

  const [name, setName] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const nameOk = isValidDisplayName(name);

  const submit = useCallback(async () => {
    const cleanName = sanitiseDisplayName(name);
    if (!isValidDisplayName(cleanName)) {
      return;
    }
    setSaving(true);
    try {
      await bleChat.updateSettings({
        displayName: cleanName,
        interests: sanitiseInterests(interests),
        profileComplete: true,
      });
    } catch (err) {
      Alert.alert(
        'Could not save',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setSaving(false);
    }
  }, [name, interests]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* 'height' rather than leaving Android to windowSoftInputMode's adjustResize alone
          — that resize is not reliable on every OEM skin/Android version (see the same
          reasoning in ChatScreen's own keyboard handling), and this is the very first
          screen a new user sees, with autoFocus firing the keyboard immediately. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <FadeIn>
            <AppText style={styles.heading}>Say hello</AppText>
          </FadeIn>
          <DenseText style={styles.subheading}>
            BLE Chat finds people in Bluetooth range and lets you talk to them directly —
            no server, no internet, no accounts. This is what they will see.
          </DenseText>

          <DenseText style={styles.label}>Your name</DenseText>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="What should people call you?"
            placeholderTextColor={theme.textDim}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            autoFocus
            returnKeyType="next"
            maxFontSizeMultiplier={1.3}
          />
          <DenseText style={styles.helper}>
            {name.trim().length > 0 && !nameOk
              ? `At least ${MIN_DISPLAY_NAME_LENGTH} characters.`
              : 'A nickname is fine. You can change it later in Settings.'}
          </DenseText>

          <DenseText style={[styles.label, styles.spaced]}>Interests</DenseText>
          <DenseText style={styles.helper}>
            Optional, but this is how you spot someone worth talking to — shared interests
            are highlighted on the Nearby screen.
          </DenseText>
          <View style={styles.picker}>
            <InterestPicker selected={interests} onChange={setInterests} />
          </View>

          <DenseText style={styles.privacy}>
            Everything here stays on your phone and is only sent to phones you connect to.
            Traffic is not yet encrypted, so treat anything you share as readable by
            someone in range.
          </DenseText>
        </ScrollView>

        <View style={styles.submitWrap}>
          <Button
            label={saving ? 'Saving...' : 'Start chatting'}
            onPress={submit}
            disabled={!nameOk || saving}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  flex: {flex: 1},
  content: {padding: spacing.lg, paddingBottom: spacing.xl},

  heading: {...typography.display, color: t.text},
  subheading: {
    ...typography.callout,
    color: t.textDim,
    lineHeight: 19,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  label: {...typography.callout, color: t.text, fontWeight: '700'},
  spaced: {marginTop: spacing.xl},
  helper: {...typography.caption, color: t.textDim, marginTop: 4, lineHeight: 16},
  input: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: t.text,
    fontSize: 16,
    marginTop: spacing.sm,
  },
  picker: {marginTop: spacing.md},

  privacy: {
    ...typography.caption,
    color: t.textDim,
    lineHeight: 16,
    marginTop: spacing.xl,
  },
  submitWrap: {padding: spacing.lg},
}));
