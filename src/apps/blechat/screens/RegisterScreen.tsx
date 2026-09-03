import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {radius, spacing, typography} from '../config/theme';
import {makeStyles, useTheme} from '../theme/ThemeProvider';
import {AppText, DenseText} from '../components/AppText';
import {Screen} from '../components/ui/Screen';
import {Icon} from '../components/ui/Icon';
import {Mascot} from '../components/ui/Mascot';
import {GradientSurface, brandGradient} from '../components/ui/Gradient';
import {FadeIn, Touchable} from '../components/Motion';
import {bleChat} from '../services/BleChatService';
import {openAppSettings} from '../ble/BLEPermissions';
import {useAppStore} from '../state/appStore';
import {
  INTEREST_CATALOGUE,
  MAX_INTERESTS,
  MAX_INTEREST_LENGTH,
  isValidDisplayName,
  MAX_DISPLAY_NAME_LENGTH,
  MIN_DISPLAY_NAME_LENGTH,
  sanitiseDisplayName,
  sanitiseInterests,
} from '../config/interests';

type Step = 0 | 1 | 2;

const STEP_LABEL = ['NAME', 'INTERESTS', 'BLUETOOTH'] as const;

/**
 * First launch: who you are, before you meet anybody.
 *
 * The app is for talking to strangers who happen to be nearby, and a stranger will not
 * start a conversation with "Phone-143". A name they can read and a couple of interests
 * are the whole difference between a list of devices and a list of people.
 *
 * Three steps rather than one scroll. The old screen asked for a name, twenty-four
 * interest chips and a custom field in a single column, which meant the first thing a
 * new user saw was a wall — and the promise "this is what they will see" sat above a
 * form that showed them nothing of the sort. Each step now asks one thing, and step two
 * carries a literal preview card that fills in as you pick.
 *
 * Step three is the Bluetooth grant. Asking for the radio inside the flow that needs it
 * is the difference between a permission dialog with a reason and one that ambushes the
 * dashboard afterwards.
 *
 * Deliberately still a gate rather than a skippable prompt: the profile travels in the
 * handshake, so a peer met before it exists remembers us by the placeholder for as long
 * as they keep us in their known-peers list.
 */
export function RegisterScreen() {
  const styles = useStyles();
  const theme = useTheme();

  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);

  const permission = useAppStore(s => s.permission);

  const nameOk = isValidDisplayName(name);
  const cleanName = sanitiseDisplayName(name) || 'You';

  const toggle = useCallback(
    (interest: string) => {
      setInterests(current => {
        const already = current.some(
          i => i.toLowerCase() === interest.toLowerCase(),
        );
        if (already) {
          return current.filter(i => i.toLowerCase() !== interest.toLowerCase());
        }
        if (current.length >= MAX_INTERESTS) {
          return current;
        }
        return sanitiseInterests([...current, interest]);
      });
    },
    [],
  );

  /** Anything typed that is not in the catalogue, so it can still be seen and removed. */
  const customPicks = useMemo(() => {
    const catalogue = new Set(
      INTEREST_CATALOGUE.flatMap(c => c.interests).map(i => i.toLowerCase()),
    );
    return interests.filter(i => !catalogue.has(i.toLowerCase()));
  }, [interests]);

  const finish = useCallback(async () => {
    if (!isValidDisplayName(sanitiseDisplayName(name))) {
      return;
    }
    setSaving(true);
    try {
      await bleChat.updateSettings({
        displayName: sanitiseDisplayName(name),
        interests: sanitiseInterests(interests),
        profileComplete: true,
      });
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [name, interests]);

  const requestPermission = useCallback(() => {
    bleChat
      .requestPermissions()
      .catch(err => Alert.alert('Permissions', String(err)));
  }, []);

  const canAdvance = step === 0 ? nameOk : true;

  const advance = useCallback(() => {
    if (step < 2) {
      setStep((step + 1) as Step);
      return;
    }
    void finish();
  }, [step, finish]);

  return (
    <Screen edges={['top', 'bottom']}>
      {/* 'height' rather than leaving Android to windowSoftInputMode's adjustResize alone
          — that resize is not reliable on every OEM skin/Android version (see the same
          reasoning in ChatScreen's own keyboard handling), and this is the very first
          screen a new user sees, with autoFocus firing the keyboard immediately. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        <View style={styles.head}>
          {/* A rule, not a "2/3" label. Three filling segments say how much is left
              without asking anyone to do arithmetic. */}
          <View style={styles.progress}>
            {[0, 1, 2].map(i => (
              <View
                key={i}
                style={[
                  styles.progressSegment,
                  {backgroundColor: i <= step ? theme.accent : theme.border},
                ]}
              />
            ))}
          </View>
          <DenseText style={styles.eyebrow}>
            STEP {step + 1} OF 3 · {STEP_LABEL[step]}
          </DenseText>
          <AppText style={styles.title}>
            {step === 0
              ? 'What should people call you?'
              : step === 1
              ? 'What should people know you for?'
              : 'One permission, then you are in'}
          </AppText>
          <DenseText style={styles.lede}>
            {step === 0
              ? 'BLE Chat finds people in Bluetooth range and lets you talk to them directly — no server, no internet, no accounts.'
              : step === 1
              ? 'Shared interests are what turn a list of devices into someone worth talking to. Pick a few — they are visible before anyone connects.'
              : 'Bluetooth is the whole transport. Without it there is nobody to find and nothing to send.'}
          </DenseText>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {step === 0 ? (
            <FadeIn>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="What should people call you?"
                placeholderTextColor={theme.textFaint}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => nameOk && setStep(1)}
                maxFontSizeMultiplier={1.3}
              />
              <DenseText style={styles.helper}>
                {name.trim().length > 0 && !nameOk
                  ? `At least ${MIN_DISPLAY_NAME_LENGTH} characters.`
                  : 'A nickname is fine. You can change it later in Settings.'}
              </DenseText>
            </FadeIn>
          ) : null}

          {step === 1 ? (
            <FadeIn>
              {/* The promise, made literal. "This is what they will see" above a form is
                  a claim; a card that fills in as you tap is the thing itself. */}
              <GradientSurface
                gradient={brandGradient(theme)}
                radius={20}
                style={styles.preview}>
                <Mascot size={54} />
                <View style={styles.previewBody}>
                  <DenseText style={styles.previewEyebrow}>
                    HOW YOU&apos;LL APPEAR NEARBY
                  </DenseText>
                  <AppText style={styles.previewName} numberOfLines={1}>
                    {cleanName}
                  </AppText>
                  {interests.length > 0 ? (
                    <View style={styles.previewChips}>
                      {interests.slice(0, 3).map(interest => (
                        <View key={interest} style={styles.previewChip}>
                          <DenseText
                            style={styles.previewChipText}
                            maxFontSizeMultiplier={1}>
                            {interest}
                          </DenseText>
                        </View>
                      ))}
                      {interests.length > 3 ? (
                        <DenseText style={styles.previewMore}>
                          +{interests.length - 3}
                        </DenseText>
                      ) : null}
                    </View>
                  ) : (
                    <DenseText style={styles.previewEmpty}>
                      No interests yet — you will just be a name
                    </DenseText>
                  )}
                </View>
              </GradientSurface>

              <View style={styles.counterRow}>
                <DenseText style={styles.counter}>
                  {interests.length} OF {MAX_INTERESTS} CHOSEN
                </DenseText>
                <View style={styles.grow} />
                <DenseText style={styles.counterHint}>
                  {interests.length >= MAX_INTERESTS
                    ? 'remove one to add another'
                    : 'tap to add'}
                </DenseText>
              </View>

              {INTEREST_CATALOGUE.map(category => (
                <View key={category.title} style={styles.category}>
                  <DenseText style={styles.categoryTitle}>
                    {category.title.toUpperCase()}
                  </DenseText>
                  <View style={styles.chipWrap}>
                    {category.interests.map(interest => {
                      const on = interests.some(
                        i => i.toLowerCase() === interest.toLowerCase(),
                      );
                      return (
                        <TouchableOpacity
                          key={interest}
                          onPress={() => toggle(interest)}
                          activeOpacity={0.75}
                          accessibilityRole="button"
                          accessibilityState={{selected: on}}
                          style={on ? [styles.chip, styles.chipOn] : styles.chip}>
                          <DenseText
                            style={on ? styles.chipTextOn : styles.chipText}
                            maxFontSizeMultiplier={1}>
                            {interest}
                          </DenseText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              {/* Kept from the old picker: the catalogue guarantees two people who tapped
                  the same chip match exactly, but it cannot cover everything. */}
              <View style={styles.category}>
                <DenseText style={styles.categoryTitle}>SOMETHING ELSE</DenseText>
                <View style={styles.chipWrap}>
                  {customPicks.map(interest => (
                    <TouchableOpacity
                      key={interest}
                      onPress={() => toggle(interest)}
                      activeOpacity={0.75}
                      style={[styles.chip, styles.chipOn]}>
                      <DenseText style={styles.chipTextOn} maxFontSizeMultiplier={1}>
                        {interest} ×
                      </DenseText>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.customRow}>
                  <TextInput
                    style={styles.customInput}
                    value={custom}
                    onChangeText={setCustom}
                    placeholder="Add your own"
                    placeholderTextColor={theme.textFaint}
                    maxLength={MAX_INTEREST_LENGTH}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      setInterests(sanitiseInterests([...interests, custom]));
                      setCustom('');
                    }}
                    maxFontSizeMultiplier={1.2}
                  />
                </View>
              </View>
            </FadeIn>
          ) : null}

          {step === 2 ? (
            <FadeIn>
              <View style={styles.permissionCard}>
                <View style={[styles.permissionTile, {backgroundColor: theme.accentSoft}]}>
                  <Icon name="bluetooth" color={theme.accent} size={26} />
                </View>
                <AppText style={styles.permissionTitle}>
                  {permission.state === 'granted'
                    ? 'Bluetooth is ready'
                    : 'Allow Bluetooth'}
                </AppText>
                <DenseText style={styles.permissionBody}>
                  {permission.state === 'granted'
                    ? 'Scanning and advertising are both permitted. You can start meeting people.'
                    : permission.state === 'blocked'
                    ? 'Permission was permanently refused, so only a trip to system settings can restore it.'
                    : 'BLE Chat scans for nearby phones and advertises so they can find you. It never asks for your location.'}
                </DenseText>

                {permission.state === 'granted' ? (
                  <View style={styles.permissionGranted}>
                    <Icon name="check" color={theme.ok} size={15} strokeWidth={2.4} />
                    <DenseText style={[styles.permissionGrantedText, {color: theme.ok}]}>
                      Granted
                    </DenseText>
                  </View>
                ) : (
                  <Touchable
                    scale={false}
                    onPress={
                      permission.state === 'blocked' ? openAppSettings : requestPermission
                    }
                    style={styles.permissionButton}>
                    <DenseText style={styles.permissionButtonText}>
                      {permission.state === 'blocked'
                        ? 'Open system settings'
                        : 'Allow Bluetooth'}
                    </DenseText>
                  </Touchable>
                )}
              </View>

              <DenseText style={styles.permissionSkip}>
                You can finish without it — the app will simply have nobody to talk to
                until Bluetooth is allowed.
              </DenseText>
            </FadeIn>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.privacyRow}>
            <Icon name="shield" color={theme.textFaint} size={13} />
            <DenseText style={styles.privacy}>
              Stays on your phone, sent only to phones you connect to — and not yet
              encrypted.
            </DenseText>
          </View>

          <View style={styles.footerButtons}>
            {step > 0 ? (
              <Touchable
                scale={false}
                onPress={() => setStep((step - 1) as Step)}
                style={styles.backButton}
                accessibilityLabel="Back">
                <Icon name="chevronLeft" color={theme.text} size={18} />
              </Touchable>
            ) : null}
            <Touchable
              scale={false}
              onPress={advance}
              disabled={!canAdvance || saving}
              style={styles.nextWrap}>
              <GradientSurface
                gradient={
                  canAdvance && !saving
                    ? brandGradient(theme)
                    : [theme.surfaceAlt, theme.surfaceAlt, theme.surfaceAlt]
                }
                radius={radius.pill}
                style={styles.nextButton}>
                <AppText
                  style={[
                    styles.nextText,
                    {color: canAdvance && !saving ? theme.onAccent : theme.textFaint},
                  ]}>
                  {saving ? 'Saving…' : step === 2 ? 'Start chatting' : 'Continue'}
                </AppText>
                {!saving ? (
                  <Icon
                    name="chevronRight"
                    color={canAdvance ? theme.onAccent : theme.textFaint}
                    size={18}
                  />
                ) : null}
              </GradientSurface>
            </Touchable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles(t => ({
  flex: {flex: 1},
  grow: {flex: 1},

  head: {paddingHorizontal: spacing.lg + 4, paddingTop: spacing.sm},
  progress: {flexDirection: 'row', gap: 6},
  progressSegment: {flex: 1, height: 4, borderRadius: 2},
  eyebrow: {...typography.overline, color: t.textFaint, marginTop: spacing.md},
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    color: t.text,
    marginTop: 6,
  },
  lede: {...typography.callout, color: t.textDim, lineHeight: 19, marginTop: 6},

  content: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  input: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    color: t.text,
    fontSize: 16,
  },
  helper: {...typography.caption, color: t.textDim, marginTop: 8, lineHeight: 16},

  // ---- live preview ------------------------------------------------------
  preview: {flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14},
  previewBody: {flex: 1, minWidth: 0},
  previewEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.72)',
  },
  previewName: {fontSize: 17, fontWeight: '700', color: '#ffffff', marginTop: 3},
  previewChips: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 6},
  previewChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  previewChipText: {fontSize: 11, fontWeight: '600', color: '#ffffff'},
  previewMore: {fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.8)'},
  previewEmpty: {fontSize: 11, color: 'rgba(255,255,255,0.72)', marginTop: 6},

  counterRow: {flexDirection: 'row', alignItems: 'center', marginTop: 18},
  counter: {...typography.overline, color: t.textDim},
  counterHint: {...typography.caption, color: t.textFaint, fontSize: 11},

  category: {marginTop: 14},
  categoryTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    color: t.textFaint,
    marginBottom: 7,
  },
  chipWrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  // flexShrink: 0 — in a wrapping row a flex layout may squeeze a chip narrower than its
  // text needs before wrapping it, which clips the last character with no ellipsis.
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
    flexShrink: 0,
  },
  chipOn: {borderColor: t.accent, backgroundColor: t.accent},
  chipText: {...typography.callout, color: t.text, fontWeight: '500'},
  chipTextOn: {...typography.callout, color: t.onAccent, fontWeight: '700'},
  customRow: {marginTop: 8},
  customInput: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.textFaint + '77',
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
    color: t.text,
    ...typography.callout,
  },

  // ---- permission --------------------------------------------------------
  permissionCard: {
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 22,
    padding: spacing.xl,
    alignItems: 'center',
  },
  permissionTile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {...typography.title, color: t.text, marginTop: spacing.md},
  permissionBody: {
    ...typography.callout,
    color: t.textDim,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
  },
  permissionButton: {
    marginTop: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
  },
  permissionButtonText: {...typography.callout, color: t.accent, fontWeight: '700'},
  permissionGranted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.lg,
  },
  permissionGrantedText: {...typography.callout, fontWeight: '700'},
  permissionSkip: {
    ...typography.caption,
    color: t.textFaint,
    lineHeight: 16,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  // ---- footer ------------------------------------------------------------
  footer: {
    paddingHorizontal: spacing.lg + 4,
    paddingTop: 14,
    paddingBottom: spacing.lg + 4,
    backgroundColor: t.bg,
  },
  privacyRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginBottom: 12},
  privacy: {...typography.caption, color: t.textFaint, fontSize: 11, lineHeight: 15, flex: 1},
  footerButtons: {flexDirection: 'row', gap: spacing.sm},
  backButton: {
    width: 52,
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextWrap: {flex: 1},
  nextButton: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  nextText: {fontSize: 16, fontWeight: '700'},
}));
