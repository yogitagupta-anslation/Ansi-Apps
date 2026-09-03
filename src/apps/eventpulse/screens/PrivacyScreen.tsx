/**
 * PrivacyScreen — the settings, and the plain truth about the radio.
 *
 * Most privacy screens are a list of switches. This one also explains what is
 * actually broadcast, because the honest answer is reassuring and the vague
 * answer is not: EventPulse puts a rotating identifier, an avatar id and (if
 * you allow it) your first name into a 21-byte Bluetooth packet. Your company,
 * your email, your links and your account id never touch the air.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Button, Card, Divider, SectionHeader } from '../components/primitives';
import {
  DEFAULT_PRIVACY,
  VISIBILITY_OPTIONS,
  describePrivacy,
} from '../security/PrivacyService';
import { DEFAULT_ROTATION_MS } from '../bluetooth/BleIdentity';
import type { FieldVisibility, ProfileField, Visibility } from '../types';
import { actions, queries } from '../runtime/services';
import { presenceStore, sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

const FIELD_ROWS: { field: ProfileField; label: string }[] = [
  { field: 'company', label: 'Company' },
  { field: 'role', label: 'Role' },
  { field: 'experienceYears', label: 'Years of experience' },
  { field: 'skills', label: 'Skills' },
  { field: 'interests', label: 'Interests' },
  { field: 'bio', label: 'About' },
  { field: 'links', label: 'Links' },
  { field: 'pronouns', label: 'Pronouns' },
];

const FIELD_CHOICES: { value: FieldVisibility; label: string }[] = [
  { value: 'public', label: 'Everyone' },
  { value: 'connections', label: 'Connections' },
  { value: 'private', label: 'Nobody' },
];

/**
 * Time until the next identity rotation, as mm:ss, ticking once a second.
 *
 * A second is the right granularity: this exists to be watched, and a countdown
 * that only moves every minute does not read as live.
 */
function useRotationCountdown(): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = DEFAULT_ROTATION_MS - (now % DEFAULT_ROTATION_MS);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** `62DF5E50` reads as noise; `62DF\u00b75E50` reads as an identifier. */
function formatPeerId(peerId: string): string {
  const upper = peerId.toUpperCase();
  return upper.length === 8 ? `${upper.slice(0, 4)}\u00b7${upper.slice(4)}` : upper;
}

function ByteRow({
  label,
  size,
  included,
}: {
  label: string;
  size?: string;
  included?: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View style={styles.byteRow}>
      <AppText variant="body" tone={included ? 'primary' : 'tertiary'}>
        {included ? '\u2713' : '\u2715'}
      </AppText>
      <AppText
        variant="caption"
        tone={included ? 'secondary' : 'tertiary'}
        style={styles.byteLabel}
      >
        {label}
      </AppText>
      {size ? (
        <AppText variant="eyebrow" tone="tertiary">
          {size}
        </AppText>
      ) : null}
    </View>
  );
}

export function PrivacyScreen({ onBack }: { onBack: () => void }): React.ReactElement {
  const { colors } = useTheme();
  const rotatesIn = useRotationCountdown();
  const privacy = useStore(sessionStore, (state) => state.privacy) ?? DEFAULT_PRIVACY;
  const availability = useStore(sessionStore, (state) => state.availability);
  const advertiser = useStore(presenceStore, (state) => state.advertiser);
  const blocked = queries.blockedAttendees();

  const setField = (field: ProfileField, value: FieldVisibility): void => {
    void actions.updatePrivacy({ fields: { ...privacy.fields, [field]: value } });
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12}>
            <AppText variant="bodyStrong" tone="secondary">
              ← Back
            </AppText>
          </Pressable>
          <AppText variant="title">Privacy</AppText>
          <AppText variant="body" tone="secondary">
            {describePrivacy(privacy, availability)}
          </AppText>
        </View>

        <SectionHeader title="Visibility at this event" />
        {VISIBILITY_OPTIONS.map((option) => {
          const selected = privacy.visibility === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => void actions.setVisibility(option.value as Visibility)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.accent : colors.border,
                  backgroundColor: selected ? colors.accentSoft : 'transparent',
                },
              ]}
            >
              <AppText variant="bodyStrong">{option.label}</AppText>
              <AppText variant="caption" tone="secondary">
                {option.description}
              </AppText>
            </Pressable>
          );
        })}

        <SectionHeader title="Who sees each field" />
        {FIELD_ROWS.map((row) => {
          const current = privacy.fields[row.field] ?? 'public';
          return (
            <View key={row.field} style={styles.fieldRow}>
              <AppText variant="body">{row.label}</AppText>
              <View style={styles.segmented}>
                {FIELD_CHOICES.map((choice) => {
                  const selected = current === choice.value;
                  return (
                    <Pressable
                      key={choice.value}
                      onPress={() => setField(row.field, choice.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: selected ? colors.accent : colors.surfaceElevated,
                          borderColor: selected ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <AppText variant="micro" tone={selected ? 'inverse' : 'secondary'}>
                        {choice.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}

        <SectionHeader title="Bluetooth" />
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <AppText variant="body">Broadcast my first name</AppText>
            <AppText variant="caption" tone="tertiary">
              Lets nearby phones show your name the instant they see you, before their copy of the
              attendee list resolves you. Turn it off and you appear as &ldquo;Someone nearby&rdquo;
              for a moment instead.
            </AppText>
          </View>
          <Switch
            value={privacy.broadcastDisplayName}
            onValueChange={(broadcastDisplayName) => void actions.updatePrivacy({ broadcastDisplayName })}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <AppText variant="body">Allow connection requests</AppText>
            <AppText variant="caption" tone="tertiary">
              When off, other attendees can still see you on the map but cannot send you a request.
            </AppText>
          </View>
          <Switch
            value={privacy.allowConnectionRequests}
            onValueChange={(allowConnectionRequests) =>
              void actions.updatePrivacy({ allowConnectionRequests })
            }
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
          />
        </View>

        <Card style={styles.explainer}>
          <AppText variant="bodyStrong">What actually goes over the air</AppText>
          <AppText variant="caption" tone="secondary">
            {`A ${21}-byte packet, a few times a second: a temporary identifier for this event, an avatar id, your availability, and your first name if you allow it. That is all.`}
          </AppText>
          <Divider />
          <AppText variant="caption" tone="secondary">
            {`Your identifier is generated for this event alone and changes every ${Math.round(
              DEFAULT_ROTATION_MS / 60_000,
            )} minutes, so nobody can follow one device across the day — or link you between two events.`}
          </AppText>
          <Divider />
          <AppText variant="caption" tone="secondary">
            Never broadcast: your email, your phone number, your account id, your links, or any
            field you marked private. Signal readings stay on your phone and are never uploaded.
          </AppText>
          {/* The design shows the live identifier and a countdown to the next
              rotation. Showing the actual bytes, ticking, is the difference
              between a privacy claim and a privacy demonstration — the user can
              sit here and watch the thing they were promised happen. */}
          {advertiser?.currentPeerId ? (
            <View style={[styles.idBlock, { borderColor: colors.border }]}>
              <View style={styles.idHeader}>
                <AppText variant="eyebrow" tone="tertiary">
                  YOUR BROADCAST ID
                </AppText>
                <AppText variant="eyebrow" tone="accent">
                  {`ROTATES IN ${rotatesIn}`}
                </AppText>
              </View>
              <AppText variant="mono">{formatPeerId(advertiser.currentPeerId)}</AppText>
            </View>
          ) : null}

          <View style={styles.byteTable}>
            <ByteRow included label="The rotating ID above" size="4 BYTES" />
            <ByteRow included label="Availability & category" size="1 BYTE" />
            <ByteRow label="Your name, photo or company" />
            <ByteRow label="Your location, ever" />
            <ByteRow label="Whose card you opened" />
          </View>
        </Card>

        <SectionHeader title={`Blocked · ${blocked.length}`} />
        {blocked.length === 0 ? (
          <AppText variant="caption" tone="tertiary" style={styles.paragraph}>
            You have not blocked anyone. Blocked people disappear from your map and from Discover,
            and cannot send you requests.
          </AppText>
        ) : (
          blocked.map((entry) => (
            <View key={entry.profileId} style={styles.blockedRow}>
              <AppText variant="body">{entry.name}</AppText>
              <Button
                label="Unblock"
                variant="ghost"
                onPress={() => void actions.unblock(entry.profileId)}
              />
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: space.xxl },
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.xs },
  option: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.md,
  },
  segmented: { flexDirection: 'row', gap: space.xs },
  segment: {
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  switchText: { flex: 1, gap: space.xs },
  explainer: { margin: space.lg, gap: space.sm },
  paragraph: { paddingHorizontal: space.lg },
  idBlock: {
    borderWidth: 1,
    borderRadius: 12,
    padding: space.md,
    gap: space.xs,
    marginTop: space.sm,
  },
  idHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  byteTable: { gap: space.sm, paddingTop: space.md },
  byteRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  byteLabel: { flex: 1 },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
});
