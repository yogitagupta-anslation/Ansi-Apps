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
import {Icon, type IconName} from '../components/ui/Icon';
import {RippleStage} from '../components/ui/RippleStage';
import {MascotAvatar} from '../components/ui/Mascot';
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

/**
 * Three tour steps, then identity.
 *
 * The old flow asked for a name before saying what the app was. The design's order is
 * the other way round — tell somebody what this does and what Android is about to ask,
 * and only then ask them to type — which is also why the tour steps carry a Skip and the
 * identity screen does not.
 */
type Step = 0 | 1 | 2 | 3;

const TOUR_STEPS = 3;

/** The colours a face can take, from the design's own swatch row. */
const FACE_TINTS = ['#4C3FE0', '#8B7CF6', '#2563EB', '#0E9F9F', '#0F7B54', '#A8620E', '#B42318', '#BE3F8F'];

interface TourCopy {
  title: string;
  body: string;
}

const TOUR: TourCopy[] = [
  {
    title: 'Talk to the people around you',
    body: 'Your phone finds theirs directly. No account, no phone number, and it works with the network down.',
  },
  {
    title: 'About ten metres, and no further',
    body: 'Roughly a room, a carriage, a queue. Walk closer and someone appears on their own. Walk away and they drop off.',
  },
  {
    title: 'Two things Android will ask',
    body: "Here's what each one is for, before the system dialog shows up.",
  },
];

/** The two permissions, named the way Android names them. */
const PERMISSION_REASONS: Array<{icon: IconName; title: string; body: string}> = [
  {
    icon: 'radar',
    title: 'Find nearby devices',
    body: "So you can see who's around, and they can see you.",
  },
  {
    icon: 'link',
    title: 'Connect to devices',
    body: 'So a message has something to travel over once you have found someone.',
  },
];

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
  /**
   * The face is drawn from the identity key, so it cannot truly be re-rolled without a
   * new identity. Shuffle nudges the tint instead, which is the part the design lets you
   * pick — the geometry stays derived, so both phones still draw the same face.
   */
  const [faceSeed, setFaceSeed] = useState(0);
  const shuffleFace = useCallback(() => setFaceSeed(n => n + 1), []);
  const [name, setName] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);

  const permission = useAppStore(s => s.permission);

  const nameOk = isValidDisplayName(name);

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

  // Only the identity step can be blocked, and only on an empty name.
  const canAdvance = step === 3 ? nameOk : true;

  const advance = useCallback(() => {
    if (step < 3) {
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
          {step < TOUR_STEPS ? (
            <>
              {/* Mono, because it is a position: "01 / 03" is a measurement of where you
                  are, not a heading. */}
              <View style={styles.tourTop}>
                <DenseText style={styles.tourCounter}>
                  {String(step + 1).padStart(2, '0')} / {String(TOUR_STEPS).padStart(2, '0')}
                </DenseText>
                <View style={styles.grow} />
                {step < TOUR_STEPS - 1 ? (
                  <Touchable
                    scale={false}
                    onPress={() => setStep(TOUR_STEPS as Step)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Skip the tour">
                    <DenseText style={styles.skip}>Skip</DenseText>
                  </Touchable>
                ) : null}
              </View>

              {/* A rule, not a "2/3" label. Three filling segments say how much is left
                  without asking anyone to do arithmetic. */}
              <View style={styles.progress}>
                {[0, 1, 2].map(i => (
                  <View
                    key={i}
                    style={[
                      styles.progressSegment,
                      {backgroundColor: i <= step ? theme.text : theme.border},
                    ]}
                  />
                ))}
              </View>
            </>
          ) : (
            <AppText style={styles.identityTitle}>How you&apos;ll show up</AppText>
          )}
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            // The tour is three short blocks and reads as a poster; the identity step is
            // a form that has to start at the top and grow downwards.
            step < TOUR_STEPS ? styles.contentCentred : null,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {step < TOUR_STEPS ? (
            <FadeIn key={step}>
              {/* The ripple stage, on the two steps that are about being found. Step
                  three is about permissions and gets the reasons instead. */}
              {step < 2 ? (
                <View style={styles.stage}>
                  <RippleStage size={168} />
                </View>
              ) : null}

              <AppText style={styles.tourTitle}>{TOUR[step].title}</AppText>
              <DenseText style={styles.tourBody}>{TOUR[step].body}</DenseText>

              {step === 2
                ? PERMISSION_REASONS.map((reason, i) => (
                    <View
                      key={reason.title}
                      style={[styles.reason, i === 0 ? styles.reasonFirst : null]}>
                      <Icon
                        name={reason.icon}
                        size={19}
                        color={theme.accent}
                        strokeWidth={1.9}
                      />
                      <View style={styles.grow}>
                        <AppText style={styles.reasonTitle}>{reason.title}</AppText>
                        <DenseText style={styles.reasonBody}>{reason.body}</DenseText>
                      </View>
                    </View>
                  ))
                : null}
            </FadeIn>
          ) : null}

          {step === 3 ? (
            <FadeIn>
              {/* The face first, then the name, then what you are into — the order the
                  design uses, and the order somebody reads a row on Nearby. */}
              <View style={styles.identityHead}>
                <MascotAvatar size={64} tint={FACE_TINTS[faceSeed % FACE_TINTS.length]} />
                <View style={styles.identityHeadSide}>
                  <Touchable
                    scale={false}
                    onPress={shuffleFace}
                    style={styles.shufflePill}
                    accessibilityRole="button"
                    accessibilityLabel="Shuffle your face">
                    <Icon name="radar" size={12} color={theme.text} strokeWidth={2} />
                    <DenseText style={styles.shuffleText}>Shuffle</DenseText>
                  </Touchable>
                  <DenseText style={styles.customiseLater}>Customise later</DenseText>
                </View>
              </View>

              <DenseText style={styles.fieldLabel}>NAME</DenseText>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="What should people call you?"
                placeholderTextColor={theme.textFaint}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => nameOk && advance()}
                maxFontSizeMultiplier={1.3}
              />
              <DenseText style={styles.helper}>
                {name.trim().length > 0 && !nameOk
                  ? `At least ${MIN_DISPLAY_NAME_LENGTH} characters.`
                  : 'The only name a stranger sees.'}
              </DenseText>

              <DenseText style={[styles.fieldLabel, styles.fieldLabelSpaced]}>
                INTERESTS
              </DenseText>
              <DenseText style={styles.fieldHint}>
                Optional. This is what makes someone nearby worth talking to.
              </DenseText>

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

          {false ? (
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
          {step === 3 ? (
          <View style={styles.privacyRow}>
            <Icon name="shield" color={theme.textFaint} size={13} />
            <DenseText style={styles.privacy}>
              Stays on your phone, sent only to phones you connect to — and not yet
              encrypted.
            </DenseText>
          </View>
          ) : null}

          <View style={styles.footerButtons}>
            {step > 0 ? (
              <Touchable
                scale={false}
                onPress={() => setStep((step - 1) as Step)}
                style={styles.backButton}
                accessibilityLabel="Back">
                <AppText style={[styles.nextText, {color: theme.textDim}]}>Back</AppText>
              </Touchable>
            ) : null}
            <Touchable
              scale={false}
              onPress={advance}
              disabled={!canAdvance || saving}
              style={styles.nextWrap}>
              {/* One flat accent, no chevron. The gradient was on every hero and every
                  button in the old design, which is exactly why nothing stood out; this
                  is the single action on the screen, so the fill alone is enough to say
                  so. */}
              <View
                style={[
                  styles.nextButton,
                  {
                    borderRadius: radius.pill,
                    backgroundColor:
                      canAdvance && !saving ? theme.accent : theme.surfaceAlt,
                  },
                ]}>
                <AppText
                  style={[
                    styles.nextText,
                    {color: canAdvance && !saving ? theme.onAccent : theme.textFaint},
                  ]}>
                  {saving
                    ? 'Saving…'
                    : step === 3
                    ? 'Start chatting'
                    : step === 2
                    ? 'Got it'
                    : 'Continue'}
                </AppText>
              </View>
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

  head: {paddingHorizontal: 18, paddingTop: 12},
  tourTop: {flexDirection: 'row', alignItems: 'center'},
  tourCounter: {...typography.monoTiny, color: t.textDim, letterSpacing: 0.5},
  skip: {fontSize: 13, color: t.textDim},
  identityTitle: {
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -1,
    lineHeight: 32,
    color: t.text,
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  // 2px rails, square. A 4px rounded bar reads as a control you could drag; this is a
  // position indicator and nothing else.
  progress: {flexDirection: 'row', gap: 4, marginTop: 12},
  progressSegment: {flex: 1, height: 2},
  // Mono, because it is a position — "02 / 05" is a measurement of where you are.
  eyebrow: {...typography.monoTiny, color: t.textDim, letterSpacing: 0.5, marginTop: spacing.lg},
  title: {
    fontSize: 29,
    fontWeight: '600',
    letterSpacing: -1,
    lineHeight: 33,
    color: t.text,
    marginTop: 10,
  },
  lede: {...typography.body, color: t.textDim, lineHeight: 23, marginTop: 12},

  content: {
    paddingHorizontal: 22,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  contentCentred: {flexGrow: 1, justifyContent: 'center'},

  // A rule, not a rounded box. One text field on an otherwise empty screen does not need
  // an outline to be found.
  input: {
    borderBottomWidth: 1,
    borderBottomColor: t.border,
    paddingVertical: spacing.md,
    color: t.text,
    fontSize: 21,
    fontWeight: '500',
  },
  helper: {...typography.caption, color: t.textDim, marginTop: 7, lineHeight: 19},

  // ---- identity ------------------------------------------------------------
  identityHead: {flexDirection: 'row', alignItems: 'center', gap: 15, paddingTop: 24, paddingBottom: 4},
  identityHeadSide: {gap: 8, alignItems: 'flex-start'},
  shufflePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  shuffleText: {fontSize: 12.5, fontWeight: '500', color: t.text},
  customiseLater: {fontSize: 12.5, color: t.textDim},
  fieldLabel: {fontSize: 10.5, fontWeight: '500', letterSpacing: 1, color: t.textDim, marginTop: 28},
  fieldLabelSpaced: {marginTop: 24},
  fieldHint: {fontSize: 12.5, lineHeight: 19, color: t.textDim, marginTop: 6},

  // ---- tour ----------------------------------------------------------------
  stage: {alignItems: 'center', marginBottom: 44},
  tourTitle: {fontSize: 29, fontWeight: '600', letterSpacing: -1.05, lineHeight: 33, color: t.text},
  tourBody: {fontSize: 14.5, lineHeight: 22, color: t.textDim, marginTop: 13},
  reason: {flexDirection: 'row', alignItems: 'flex-start', gap: 13, paddingVertical: 18},
  reasonFirst: {
    marginTop: 22,
    paddingTop: 22,
    borderBottomWidth: 1,
    borderBottomColor: t.divider,
  },
  reasonTitle: {fontSize: 15.5, fontWeight: '500', color: t.text},
  reasonBody: {fontSize: 13.5, lineHeight: 20, color: t.textDim, marginTop: 3},

  // ---- live preview ------------------------------------------------------
  // Words, matching the Nearby row they are previewing.

  counterRow: {flexDirection: 'row', alignItems: 'center', marginTop: 18},
  counter: {...typography.overline, color: t.textDim},
  counterHint: {...typography.caption, color: t.textFaint, fontSize: 11},

  category: {marginTop: 14},
  categoryTitle: {...typography.overline, color: t.textDim, marginBottom: 9},
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
  chipTextOn: {...typography.callout, color: t.onAccent, fontWeight: '500'},
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
  // No card, no icon tile. This step is one sentence and one button; wrapping it in a
  // bordered panel with a tinted glyph tile was three containers for that.
  permissionCard: {alignItems: 'center', paddingTop: spacing.xl},
  permissionTile: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionTitle: {...typography.title, color: t.text, marginTop: spacing.md},
  permissionBody: {
    ...typography.body,
    color: t.textDim,
    textAlign: 'center',
    marginTop: 8,
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
  // Back is a word, not an outlined circle. Only one thing on the screen is a button.
  backButton: {
    height: 46,
    paddingRight: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextWrap: {flex: 1},
  nextButton: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  nextText: {...typography.body, fontWeight: '500'},
}));
