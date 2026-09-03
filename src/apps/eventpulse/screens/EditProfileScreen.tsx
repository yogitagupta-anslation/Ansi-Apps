/**
 * EditProfileScreen — with a live preview of what strangers actually see.
 *
 * The preview is not decoration. Field-level privacy is meaningless if you have
 * to guess at its effect, so the card at the top renders your profile through
 * the same redaction the rest of the app applies, from the point of view of
 * someone who is not your connection. Toggle "links: connections only" and the
 * links disappear from the preview immediately.
 */

import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { AvatarPicker } from '../components/AvatarPicker';
import { AppText, Button, Card, Chip, Field, SectionHeader } from '../components/primitives';
import { CATEGORY_OPTIONS } from '../components/FilterBar';
import { validateDraft, type ProfileDraft } from '../profile/ProfileService';
import { DEFAULT_PRIVACY, redactProfile } from '../security/PrivacyService';
import type { PersonCategory } from '../types';
import { actions } from '../runtime/services';
import { sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, space } from '../theme/tokens';

export function EditProfileScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const { colors, name } = useTheme();
  const profile = useStore(sessionStore, (state) => state.profile);
  const privacy = useStore(sessionStore, (state) => state.privacy) ?? DEFAULT_PRIVACY;

  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    name: profile?.name ?? '',
    pronouns: profile?.pronouns,
    role: profile?.role,
    company: profile?.company,
    category: profile?.category ?? 'engineer',
    experienceYears: profile?.experienceYears,
    industry: profile?.industry,
    skills: profile?.skills ?? [],
    interests: profile?.interests ?? [],
    bio: profile?.bio,
    links: profile?.links,
  }));
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [skillInput, setSkillInput] = useState('');
  const [interestInput, setInterestInput] = useState('');
  const [saving, setSaving] = useState(false);

  const validation = useMemo(() => validateDraft(draft), [draft]);

  const previewProfile = useMemo(() => {
    if (!profile) return null;
    return redactProfile(
      {
        ...profile,
        name: draft.name || profile.name,
        pronouns: draft.pronouns,
        role: draft.role,
        company: draft.company,
        category: draft.category,
        experienceYears: draft.experienceYears,
        industry: draft.industry,
        skills: draft.skills,
        interests: draft.interests,
        bio: draft.bio,
        links: draft.links,
        // Every other field is read from the draft; the avatar was not, so the
        // "what other attendees see" preview silently kept showing the saved
        // one and a newly-picked avatar looked like it had been ignored.
        avatar: { ...profile.avatar, ...draft.avatar },
      },
      privacy,
      'attendee',
    );
  }, [profile, draft, privacy]);

  const patch = (next: Partial<ProfileDraft>): void => setDraft((current) => ({ ...current, ...next }));

  const addTag = (kind: 'skills' | 'interests', value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (draft[kind].some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
    patch({ [kind]: [...draft[kind], trimmed] } as Partial<ProfileDraft>);
  };

  const removeTag = (kind: 'skills' | 'interests', value: string): void => {
    patch({ [kind]: draft[kind].filter((item) => item !== value) } as Partial<ProfileDraft>);
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <AppText variant="title">Edit profile</AppText>
            <AppText variant="caption" tone="secondary">
              Changes reach nearby phones through the event sync — no pairing needed.
            </AppText>
          </View>

          {previewProfile ? (
            <Card style={styles.preview} raised>
              <AppText variant="micro" tone="tertiary">
                WHAT OTHER ATTENDEES SEE
              </AppText>
              <View style={styles.previewBody}>
                <Pressable
                  onPress={() => setAvatarPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Change your avatar"
                  style={styles.avatarButton}
                >
                  <Avatar avatar={previewProfile.avatar} name={previewProfile.name} size="large" />
                  <AppText variant="micro" tone="accent">
                    CHANGE
                  </AppText>
                </Pressable>
                <View style={styles.previewText}>
                  <AppText variant="heading">{previewProfile.name || 'Your name'}</AppText>
                  <AppText variant="caption" tone="secondary">
                    {[previewProfile.role, previewProfile.company].filter(Boolean).join(' · ') ||
                      'Add a role so people know what you do'}
                  </AppText>
                  {previewProfile.skills.length ? (
                    <View style={styles.chips}>
                      {previewProfile.skills.slice(0, 4).map((skill) => (
                        <Chip key={skill} label={skill} compact />
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          ) : null}

          <SectionHeader title="Identity" />
          <Field
            label="Name"
            value={draft.name}
            onChangeText={(name) => patch({ name })}
            placeholder="Your name"
            error={validation.errors.name}
            autoCapitalize="words"
          />
          <Field
            label="Pronouns"
            value={draft.pronouns ?? ''}
            onChangeText={(pronouns) => patch({ pronouns })}
            placeholder="Optional"
            autoCapitalize="none"
          />

          <SectionHeader title="Work" />
          <Field
            label="Role"
            value={draft.role ?? ''}
            onChangeText={(role) => patch({ role })}
            placeholder="Software Engineer"
            autoCapitalize="words"
          />
          <Field
            label="Company or school"
            value={draft.company ?? ''}
            onChangeText={(company) => patch({ company })}
            placeholder="Where you work or study"
            autoCapitalize="words"
          />
          <Field
            label="Years of experience"
            value={draft.experienceYears?.toString() ?? ''}
            onChangeText={(value) => {
              const parsed = Number(value.replace(/[^0-9]/g, ''));
              patch({ experienceYears: value === '' ? undefined : parsed });
            }}
            placeholder="0"
            keyboardType="numeric"
            error={validation.errors.experienceYears}
          />

          <SectionHeader title="How people should find you" />
          <View style={styles.chips}>
            {CATEGORY_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                color={categoryColor(option.value, name)}
                selected={draft.category === option.value}
                onPress={() => patch({ category: option.value as PersonCategory })}
              />
            ))}
          </View>

          <SectionHeader title="Skills" />
          <Field
            label="Add a skill"
            value={skillInput}
            onChangeText={setSkillInput}
            placeholder="React, PyTorch, hiring…"
            hint={validation.errors.skills ?? 'Tap a skill to remove it'}
          />
          <View style={styles.chips}>
            <Chip label="+ Add" onPress={() => { addTag('skills', skillInput); setSkillInput(''); }} />
            {draft.skills.map((skill) => (
              <Chip key={skill} label={`${skill}  ✕`} selected onPress={() => removeTag('skills', skill)} />
            ))}
          </View>

          <SectionHeader title="Interests" />
          <Field
            label="Add an interest"
            value={interestInput}
            onChangeText={setInterestInput}
            placeholder="AI, climate, developer tools…"
            hint={validation.errors.interests}
          />
          <View style={styles.chips}>
            <Chip
              label="+ Add"
              onPress={() => { addTag('interests', interestInput); setInterestInput(''); }}
            />
            {draft.interests.map((interest) => (
              <Chip
                key={interest}
                label={`${interest}  ✕`}
                selected
                onPress={() => removeTag('interests', interest)}
              />
            ))}
          </View>

          <SectionHeader title="About" />
          <Field
            label="Bio"
            value={draft.bio ?? ''}
            onChangeText={(bio) => patch({ bio })}
            placeholder="One or two lines about what you are working on"
            multiline
            error={validation.errors.bio}
          />

          <SectionHeader title="Links" />
          <Field
            label="LinkedIn"
            value={draft.links?.linkedin ?? ''}
            onChangeText={(linkedin) => patch({ links: { ...draft.links, linkedin } })}
            placeholder="https://linkedin.com/in/…"
            autoCapitalize="none"
            keyboardType="url"
            error={validation.errors.links}
          />
          <Field
            label="GitHub"
            value={draft.links?.github ?? ''}
            onChangeText={(github) => patch({ links: { ...draft.links, github } })}
            placeholder="https://github.com/…"
            autoCapitalize="none"
            keyboardType="url"
          />
          <Field
            label="Website"
            value={draft.links?.website ?? ''}
            onChangeText={(website) => patch({ links: { ...draft.links, website } })}
            placeholder="https://…"
            autoCapitalize="none"
            keyboardType="url"
          />
        </ScrollView>

        <AvatarPicker
          visible={avatarPickerOpen}
          avatar={{
            kind: draft.avatar?.kind ?? profile?.avatar.kind ?? 'initials',
            avatarId: profile?.avatar.avatarId ?? 'ABCD',
            hue: draft.avatar?.hue ?? profile?.avatar.hue ?? 210,
            emoji: draft.avatar?.emoji ?? profile?.avatar.emoji,
            uri: draft.avatar?.uri ?? profile?.avatar.uri,
          }}
          name={draft.name || profile?.name || 'You'}
          onClose={() => setAvatarPickerOpen(false)}
          onChange={(avatar) => patch({ avatar })}
        />

        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <Pressable onPress={onDone} accessibilityRole="button" style={styles.cancel}>
            <AppText variant="bodyStrong" tone="secondary">
              Cancel
            </AppText>
          </Pressable>
          <Button
            label="Save"
            loading={saving}
            disabled={!validation.valid}
            onPress={() => {
              setSaving(true);
              void actions
                .updateProfile(draft)
                .then(onDone)
                .finally(() => setSaving(false));
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xxl },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.xs },
  preview: { margin: space.lg, gap: space.md },
  previewBody: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  previewText: { flex: 1, gap: space.xs },
  avatarButton: { alignItems: 'center', gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancel: { padding: space.sm },
});
