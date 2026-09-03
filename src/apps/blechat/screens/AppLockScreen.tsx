import React, {useState} from 'react';
import {KeyboardAvoidingView, Platform, ScrollView, TextInput, View} from 'react-native';
import {AppText, DenseText} from '../components/AppText';
import {Screen} from '../components/ui/Screen';
import {Touchable} from '../components/Motion';
import {Icon} from '../components/ui/Icon';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {MIN_PIN_LENGTH} from '../security/AppLock';

interface Props {
  mode: 'unlock' | 'setup';
  /** Unlock mode only — return true if the PIN was actually correct. */
  onUnlock?: (pin: string) => boolean;
  /** Setup mode only — called once with a confirmed, matching PIN. */
  onSetupComplete?: (pin: string) => void;
  /** Setup mode only — lets Settings back out without setting anything. */
  onCancel?: () => void;
}

/**
 * One screen, two jobs: gate entry when a PIN is already set, or collect + confirm a new
 * one when setting it up. Kept as a single component because the visual shape — icon,
 * title, one numeric field, one button — is identical either way; only the copy and what
 * happens on submit differ.
 */
export function AppLockScreen({mode, onUnlock, onSetupComplete, onCancel}: Props) {
  const styles = useStyles();
  const theme = useTheme();
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [confirmStage, setConfirmStage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (pin.length < MIN_PIN_LENGTH) {
      setError(`At least ${MIN_PIN_LENGTH} digits.`);
      return;
    }
    if (mode === 'unlock') {
      const ok = onUnlock?.(pin) ?? false;
      if (!ok) {
        setError('Wrong PIN.');
        setPin('');
      }
      return;
    }
    if (!confirmStage) {
      setFirstPin(pin);
      setPin('');
      setConfirmStage(true);
      setError(null);
      return;
    }
    if (pin !== firstPin) {
      setError("Those didn't match. Start over.");
      setPin('');
      setFirstPin('');
      setConfirmStage(false);
      return;
    }
    onSetupComplete?.(pin);
  };

  return (
    // This screen gates every app open when PIN lock is on and grabs the numeric
    // keyboard immediately via autoFocus — the one input screen in the app that
    // previously had no keyboard-avoidance at all. On a shorter 720x1600 display the
    // keyboard can eat enough height to push "Unlock"/"Continue" off-screen with no
    // way to reach them; SafeAreaView + KeyboardAvoidingView + a scrollable fallback
    // fixes that the same way every other input screen in the app already handles it.
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Icon name="shield" color={theme.accent} size={26} />
            </View>
            <AppText style={styles.title}>
              {mode === 'unlock'
                ? 'Enter your PIN'
                : confirmStage
                ? 'Confirm your PIN'
                : 'Set an app PIN'}
            </AppText>
            <DenseText style={styles.subtitle}>
              {mode === 'unlock'
                ? 'BLE Chat is locked.'
                : confirmStage
                ? 'Type it again to make sure.'
                : "Keeps anyone who picks up this phone out of your conversations. It's " +
                  'a local screen lock, not encryption.'}
            </DenseText>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={t => {
                setPin(t.replace(/[^0-9]/g, '').slice(0, 8));
                setError(null);
              }}
              secureTextEntry
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
              placeholder="••••"
              placeholderTextColor={theme.textDim}
              onSubmitEditing={submit}
            />
            {error ? <DenseText style={styles.error}>{error}</DenseText> : null}
            <Touchable scale={false} onPress={submit} style={styles.button}>
              <DenseText style={styles.buttonText}>
                {mode === 'unlock' ? 'Unlock' : confirmStage ? 'Confirm' : 'Continue'}
              </DenseText>
            </Touchable>
            {onCancel && (
              <Touchable scale={false} onPress={onCancel} style={styles.cancelButton}>
                <DenseText style={styles.cancelText}>Cancel</DenseText>
              </Touchable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles(t => ({
  safe: {flex: 1, backgroundColor: t.bg},
  flex: {flex: 1},
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {width: '100%', maxWidth: 320, alignItems: 'center'},
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {...typography.title, color: t.text, textAlign: 'center'},
  subtitle: {
    ...typography.caption,
    color: t.textDim,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  input: {
    width: '100%',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    marginTop: spacing.xl,
    paddingVertical: spacing.md,
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 8,
    color: t.text,
  },
  error: {...typography.caption, color: t.error, marginTop: spacing.sm},
  button: {
    width: '100%',
    backgroundColor: t.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: {...typography.headline, color: t.onAccent, fontWeight: '700'},
  cancelButton: {marginTop: spacing.md, padding: spacing.sm},
  cancelText: {...typography.callout, color: t.textDim},
}));
