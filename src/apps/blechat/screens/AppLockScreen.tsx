import React, {useState} from 'react';
import {KeyboardAvoidingView, Platform, ScrollView, View} from 'react-native';
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

  /**
   * A key press, with submit folded in.
   *
   * The pad has no Enter: reaching the length IS the submission, which is how every
   * other PIN screen on the phone behaves. Anything shorter than the minimum simply
   * cannot be submitted, so there is no failure state to report for a half-typed one.
   */
  const press = (key: string) => {
    setError(null);
    if (key === 'del') {
      setPin(p => p.slice(0, -1));
      return;
    }
    setPin(p => {
      const next = (p + key).slice(0, 8);
      if (next.length >= MIN_PIN_LENGTH) {
        // Deferred so the last dot paints before the screen changes under it.
        setTimeout(() => submitWith(next), 60);
      }
      return next;
    });
  };

  /**
   * Takes the PIN as an argument rather than reading state.
   *
   * The keypad submits in the same tick it appends the last digit, and `pin` would still
   * hold the previous value at that point — a check against stale state would reject a
   * correct PIN on its final keystroke.
   */
  const submitWith = (value: string) => {
    if (value.length < MIN_PIN_LENGTH) {
      setError(`At least ${MIN_PIN_LENGTH} digits.`);
      return;
    }
    if (mode === 'unlock') {
      const ok = onUnlock?.(value) ?? false;
      if (!ok) {
        setError('Wrong PIN.');
        setPin('');
      }
      return;
    }
    if (!confirmStage) {
      setFirstPin(value);
      setPin('');
      setConfirmStage(true);
      setError(null);
      return;
    }
    if (value !== firstPin) {
      setError("Those didn't match. Start over.");
      setPin('');
      setFirstPin('');
      setConfirmStage(false);
      return;
    }
    onSetupComplete?.(value);
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
              <Icon name="key" color={theme.textDim} size={26} strokeWidth={1.8} />
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
                ? 'BLE Chat is locked'
                : confirmStage
                ? 'Type it again to make sure'
                : 'A local screen lock, not encryption'}
            </DenseText>

            {/*
              Dots, not a text field.

              A PIN pad has one job and the OS keyboard is not shaped for it: it offers
              autocorrect, a paste target and a layout that changes between phones. Fixed
              dots also make the length visible without showing the digits, which is the
              only thing a shoulder-surfer could read off a masked field anyway.
            */}
            <View style={styles.dots}>
              {Array.from({length: Math.max(MIN_PIN_LENGTH, pin.length)}).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i < pin.length
                      ? {backgroundColor: theme.accent}
                      : {borderWidth: 1.5, borderColor: theme.border},
                  ]}
                />
              ))}
            </View>

            {error ? <DenseText style={styles.error}>{error}</DenseText> : null}
          </View>

          <View style={styles.keypad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, i) =>
              key === '' ? (
                <View key={`gap-${i}`} style={styles.key} />
              ) : (
                <Touchable
                  key={key}
                  scale={false}
                  onPress={() => press(key)}
                  style={styles.key}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'del' ? 'Delete' : key}>
                  {key === 'del' ? (
                    <Icon name="chevronLeft" color={theme.text} size={20} />
                  ) : (
                    <AppText style={styles.keyLabel}>{key}</AppText>
                  )}
                </Touchable>
              ),
            )}
          </View>

          {onCancel ? (
            <Touchable scale={false} onPress={onCancel} style={styles.cancelButton}>
              <DenseText style={styles.cancelText}>Cancel</DenseText>
            </Touchable>
          ) : null}
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
  dots: {flexDirection: 'row', gap: 13, marginTop: 28},
  dot: {width: 12, height: 12, borderRadius: 6},
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: '100%',
    maxWidth: 340,
    paddingHorizontal: 4,
    marginTop: spacing.xl,
  },
  // Three to a row, sized off the container so the pad fits any width without a
  // hardcoded key size.
  key: {
    width: '31.5%',
    height: 52,
    borderRadius: 14,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLabel: {fontSize: 20, color: t.text},
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
