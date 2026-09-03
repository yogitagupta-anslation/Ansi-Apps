/**
 * MyProfileScreen — who you are here, and who can see it.
 *
 * Availability lives at the top because it is the control people reach for most
 * often and most urgently ("I am in a session, stop pinging me"). Changing it
 * takes effect on the radio immediately — before any network round trip — so
 * going Busy or Invisible is instant even in a dead spot.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { AppText, Button, Card, Chip, Divider, SectionHeader } from '../components/primitives';
import { AVAILABILITY_OPTIONS, describePrivacy } from '../security/PrivacyService';
import type { Availability, NetworkingGoal } from '../types';
import { GoalsSheet } from '../components/GoalsSheet';
import { goalOption } from '../recommendations/NetworkingGoals';
import { actions } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { presenceStore, sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { THEME_OPTIONS, useTheme } from '../theme/ThemeProvider';
import { availabilityColor, radius, space } from '../theme/tokens';

export function MyProfileScreen({
  onEdit,
  onOpenPrivacy,
  onEndEvent,
}: {
  onEdit: () => void;
  onOpenPrivacy: () => void;
  /** Opens the recap, which performs the leave once the user is done with it. */
  onEndEvent: () => void;
}): React.ReactElement {
  const { colors, preference } = useTheme();
  const profile = useStore(sessionStore, (state) => state.profile);
  const themePreference = useStore(sessionStore, (state) => state.themePreference);
  const privacy = useStore(sessionStore, (state) => state.privacy);
  const availability = useStore(sessionStore, (state) => state.availability);
  const goals = useStore(sessionStore, (state) => state.goals);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const event = useStore(sessionStore, (state) => state.event);
  const advertiser = useStore(presenceStore, (state) => state.advertiser);


  if (!profile) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} />;

  const broadcasting = advertiser?.state === 'advertising';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Avatar avatar={profile.avatar} name={profile.name} size="hero" availability={availability} />
          <AppText variant="title">{profile.name}</AppText>
          {profile.pronouns ? (
            <AppText variant="caption" tone="tertiary">
              {profile.pronouns}
            </AppText>
          ) : null}
          <AppText variant="body" tone="secondary">
            {[profile.role, profile.company].filter(Boolean).join(' · ')}
          </AppText>
          <Button label="Edit profile" variant="secondary" onPress={onEdit} />
        </View>

        <SectionHeader title="You are" />
        <View style={styles.availabilityRow}>
          {AVAILABILITY_OPTIONS.map((option) => {
            const selected = availability === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  haptics.select();
                  void actions.setAvailability(option.value as Availability);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.availability,
                  {
                    borderColor: selected ? availabilityColor(colors, option.value) : colors.border,
                    backgroundColor: selected ? colors.surfaceElevated : 'transparent',
                  },
                ]}
              >
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: availabilityColor(colors, option.value) },
                  ]}
                />
                <AppText variant="caption" tone={selected ? 'primary' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <SectionHeader title="What brings you here" />
        <Card style={styles.goalsCard} onPress={() => setGoalsOpen(true)}>
          {goals.length ? (
            <>
              <View style={styles.goalChips}>
                {goals.map((goal) => {
                  const option = goalOption(goal);
                  return (
                    <View
                      key={goal}
                      style={[styles.goalChip, { borderColor: colors.accent, backgroundColor: colors.accentSoft }]}
                    >
                      <AppText variant="caption" tone="accent">
                        {`${option?.emoji ?? '🎯'}  ${option?.label ?? goal}`}
                      </AppText>
                    </View>
                  );
                })}
              </View>
              <AppText variant="caption" tone="tertiary">
                Used on this device to rank who to show you. Never shared with other attendees.
              </AppText>
            </>
          ) : (
            <>
              <AppText variant="bodyStrong">Set your networking goals</AppText>
              <AppText variant="caption" tone="secondary">
                Tell the app what you came for and it can rank people by how useful they are to
                you, instead of just how close they are.
              </AppText>
            </>
          )}
        </Card>

        <SectionHeader title="Appearance" />
        <View style={styles.availabilityRow}>
          {THEME_OPTIONS.map((option) => {
            const selected = themePreference === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  haptics.select();
                  void actions.setThemePreference(option.value);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[
                  styles.availability,
                  {
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.accentSoft : 'transparent',
                  },
                ]}
              >
                <AppText variant="caption" tone={selected ? 'accent' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <Card style={styles.privacyCard} onPress={onOpenPrivacy}>
          <AppText variant="bodyStrong">
            {broadcasting ? 'You are visible nearby' : 'You are not broadcasting'}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {privacy ? describePrivacy(privacy, availability) : ''}
          </AppText>
          {advertiser?.state === 'unsupported' ? (
            <AppText variant="caption" tone="danger">
              This phone cannot advertise over Bluetooth, so others will not see you — you can still
              see them.
            </AppText>
          ) : null}
          <AppText variant="caption" tone="accent">
            Privacy settings →
          </AppText>
        </Card>

        {profile.experienceYears !== undefined ? (
          <>
            <SectionHeader title="Experience" />
            <AppText variant="body" tone="secondary" style={styles.paragraph}>
              {`${profile.experienceYears} ${profile.experienceYears === 1 ? 'year' : 'years'}${
                profile.industry ? ` · ${profile.industry}` : ''
              }`}
            </AppText>
          </>
        ) : null}

        {profile.skills.length > 0 ? (
          <>
            <SectionHeader title="Skills" />
            <View style={styles.chips}>
              {profile.skills.map((skill) => (
                <Chip key={skill} label={skill} compact />
              ))}
            </View>
          </>
        ) : null}

        {profile.interests.length > 0 ? (
          <>
            <SectionHeader title="Interests" />
            <View style={styles.chips}>
              {profile.interests.map((interest) => (
                <Chip key={interest} label={interest} compact />
              ))}
            </View>
          </>
        ) : null}

        {profile.bio ? (
          <>
            <SectionHeader title="About" />
            <AppText variant="body" tone="secondary" style={styles.paragraph}>
              {profile.bio}
            </AppText>
          </>
        ) : null}

        <Divider />

        {event ? (
          <View style={styles.eventFooter}>
            <AppText variant="caption" tone="tertiary">
              {`You are at ${event.name}`}
            </AppText>
            {/* Leaving no longer drops straight out. The event is the only
                thing that made these people findable, so its end is the last
                moment the app can turn tonight into follow-ups — the recap
                does that, and performs the actual leave on Done. */}
            <Button
              label="End event"
              variant="danger"
              onPress={onEndEvent}
            />
            <AppText variant="caption" tone="tertiary" style={styles.footnote}>
              Ending stops all broadcasting and removes this event&apos;s attendee list from your
              phone. Your saved people and notes stay.
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <GoalsSheet
        visible={goalsOpen}
        goals={goals}
        onClose={() => setGoalsOpen(false)}
        onSave={(next: NetworkingGoal[]) => void actions.setGoals(next)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xxxl },
  hero: { alignItems: 'center', gap: space.sm, paddingTop: space.xl, paddingHorizontal: space.lg },
  goalsCard: { marginHorizontal: space.lg, gap: space.sm },
  goalChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  goalChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  availabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  availability: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  privacyCard: { margin: space.lg, gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  paragraph: { paddingHorizontal: space.lg },
  eventFooter: { padding: space.lg, gap: space.sm },
  footnote: { textAlign: 'center' },
});
