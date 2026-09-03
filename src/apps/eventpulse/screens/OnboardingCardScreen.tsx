/**
 * OnboardingCardScreen — screen 1.1, "Make your card".
 *
 * The first thing the app asks for, before events, before permissions, before
 * anything is broadcast. That order is the point: you are about to be visible
 * to strangers four metres away, so the very first screen shows you exactly
 * what they will see and lets you edit it while you watch.
 *
 * Three things the design insists on, and why each earns its place:
 *
 *  - **The preview is live and it is the real thing.** Not an illustration of a
 *    card — the same component the map and the profile sheet render. If it can
 *    drift from what strangers see, the promise underneath it ("this is the
 *    whole of what a stranger can see") becomes a lie nobody notices.
 *  - **The hook is the headline field.** Name and role are table stakes; "ask
 *    me about X" is the line that turns a profile into a conversation, so it
 *    gets the label, the hint and the encouragement.
 *  - **Nothing here is required.** Continue is always live. A wall between
 *    someone and the room they are standing in is a bad trade for a tidier
 *    database.
 */

import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { AvatarPicker } from '../components/AvatarPicker';
import { AppText, Button, Field } from '../components/primitives';
import { GoalsSheet } from '../components/GoalsSheet';
import type { NetworkingGoal, Profile } from '../types';
import { GOAL_OPTIONS } from '../recommendations/NetworkingGoals';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export function OnboardingCardScreen({
  profile,
  onDone,
}: {
  profile: Profile;
  /** Commits the card and the goals, then hands over to the event list. */
  onDone: (input: {
    name: string;
    role?: string;
    company?: string;
    askMeAbout?: string[];
    avatar?: Profile['avatar'];
    goals: NetworkingGoal[];
  }) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState(profile.name ?? '');
  const [role, setRole] = useState(profile.role ?? '');
  const [company, setCompany] = useState(profile.company ?? '');
  const [hook, setHook] = useState('');
  const [avatar, setAvatar] = useState(profile.avatar);
  const [goals, setGoals] = useState<NetworkingGoal[]>([]);

  const [avatarOpen, setAvatarOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const roleLine = useMemo(
    () => [role.trim(), company.trim()].filter(Boolean).join(' · '),
    [role, company],
  );

  const commit = (): void =>
    onDone({
      name: name.trim() || profile.name,
      role: role.trim() || undefined,
      company: company.trim() || undefined,
      askMeAbout: hook.trim() ? [hook.trim()] : undefined,
      avatar,
      goals,
    });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: space.xxl + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AppText variant="eyebrow" tone="tertiary">
            {`STEP ${step} OF 2`}
          </AppText>
          <AppText variant="display">
            {step === 1 ? 'Make your card' : 'What brings you here?'}
          </AppText>
          <AppText variant="body" tone="secondary">
            {step === 1
              ? 'This is the whole of what a stranger four metres away can see. Nothing else is broadcast, ever.'
              : 'Used on this device to rank who to show you. It is never shared with other attendees.'}
          </AppText>

          {/* The live card. Rendered from the same pieces the map uses, so it
              cannot drift from what other people actually see. */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              onPress={() => setAvatarOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Change your avatar"
            >
              <Avatar avatar={avatar} name={name || 'You'} size="large" availability="available" />
            </Pressable>
            <View style={styles.cardText}>
              <AppText variant="heading" numberOfLines={1}>
                {name.trim() || 'Your name'}
              </AppText>
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {roleLine || 'Your role · your company'}
              </AppText>
              {hook.trim() ? (
                <AppText variant="caption" numberOfLines={2} style={{ color: colors.accent }}>
                  {`“${hook.trim()}”`}
                </AppText>
              ) : null}
            </View>
          </View>
          <AppText variant="eyebrow" tone="tertiary" style={styles.previewLabel}>
            LIVE PREVIEW · UPDATES AS YOU TYPE
          </AppText>

          {step === 1 ? (
            <>
              <Field label="Name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
              <Field
                label="Role"
                value={role}
                onChangeText={setRole}
                placeholder="Software Engineer"
                autoCapitalize="words"
              />
              <Field
                label="Company or school"
                value={company}
                onChangeText={setCompany}
                placeholder="Where you work or study"
                autoCapitalize="words"
              />
              <View style={styles.hookHeader}>
                <AppText variant="eyebrow" tone="tertiary">
                  YOUR HOOK
                </AppText>
                <AppText variant="caption" style={{ color: colors.warning }}>
                  doubles your profile opens
                </AppText>
              </View>
              <Field
                label=""
                value={hook}
                onChangeText={setHook}
                placeholder="Ask me about on-device BLE and offline-first apps."
                hint="One line on what you'd happily be interrupted about."
                multiline
              />
            </>
          ) : (
            <View style={styles.goalsBlock}>
              {goals.length === 0 ? (
                <AppText variant="body" tone="secondary">
                  Pick what you came for and the app can rank people by how useful they are to you,
                  instead of just how close they are.
                </AppText>
              ) : (
                <View style={styles.goalChips}>
                  {goals.map((goal) => {
                    const option = GOAL_OPTIONS.find((entry) => entry.value === goal);
                    return (
                      <View
                        key={goal}
                        style={[
                          styles.goalChip,
                          { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                        ]}
                      >
                        <AppText variant="caption" tone="accent">
                          {`${option?.emoji ?? '🎯'}  ${option?.label ?? goal}`}
                        </AppText>
                      </View>
                    );
                  })}
                </View>
              )}
              <Button
                label={goals.length ? 'Change goals' : 'Choose your goals'}
                variant="secondary"
                onPress={() => setGoalsOpen(true)}
              />
            </View>
          )}

          <View style={styles.actions}>
            {step === 2 ? (
              <Button label="Back" variant="secondary" onPress={() => setStep(1)} full />
            ) : null}
            <Button
              label={step === 1 ? 'Continue' : 'Find an event'}
              onPress={() => {
                haptics.select();
                if (step === 1) setStep(2);
                else commit();
              }}
              full
            />
          </View>

          {step === 2 ? (
            <Pressable onPress={commit} accessibilityRole="button" style={styles.skip}>
              <AppText variant="caption" tone="secondary">
                Skip for now
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <AvatarPicker
        visible={avatarOpen}
        avatar={avatar}
        name={name || 'You'}
        onClose={() => setAvatarOpen(false)}
        onChange={setAvatar}
      />

      <GoalsSheet
        visible={goalsOpen}
        goals={goals}
        onClose={() => setGoalsOpen(false)}
        onSave={setGoals}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.lg, gap: space.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: space.lg,
    marginTop: space.sm,
  },
  cardText: { flex: 1, gap: 3 },
  previewLabel: { textAlign: 'center' },
  hookHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  goalsBlock: { gap: space.md, paddingTop: space.sm },
  goalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  goalChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  actions: { flexDirection: 'row', gap: space.sm, paddingTop: space.lg },
  skip: { alignSelf: 'center', padding: space.sm },
});
