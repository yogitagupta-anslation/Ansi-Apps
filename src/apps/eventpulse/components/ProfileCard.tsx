/**
 * The payoff: see a person, know who they are, one tap.
 *
 * Two surfaces, deliberately different weights:
 *
 *  - `PersonPreviewBar` appears the instant you tap an avatar. It is a bar, not
 *    a sheet, so the map stays visible behind it — you are still looking at the
 *    room. It carries the minimum you need to decide: who, what they do, how
 *    near, and two actions.
 *  - `ProfileCard` is the full sheet from the ⓘ button. It opens *immediately*
 *    from the local cache: no spinner, no fetch, no BLE connection. If the
 *    directory has not resolved this peer yet we say so plainly rather than
 *    showing a skeleton that implies something is loading over the radio.
 */

import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { NearbyPerson } from '../presence/PresenceController';
import type { ConnectionState, ProfileLinks } from '../types';
import type { MatchBreakdown } from '../recommendations/MatchEngine';
import type { ConversationStarter } from '../recommendations/ConversationStarter';
import { connectionActionLabel } from '../connections/ConnectionService';
import { REPORT_REASONS, type ReportInput } from '../security/BlockService';
import { actions } from '../runtime/services';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, elevation, radius, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { PresencePill, ProximityLabel, SignalBars } from './StatusIndicator';
import { AppText, Button, Chip, Divider } from './primitives';

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

export function PersonPreviewBar({
  person,
  onOpenProfile,
  onNavigate,
  onDismiss,
}: {
  person: NearbyPerson;
  onOpenProfile: () => void;
  onNavigate: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const { colors, name } = useTheme();

  return (
    <View
      style={[
        styles.previewBar,
        { backgroundColor: colors.surface, borderColor: colors.border },
        elevation.medium,
      ]}
    >
      <Pressable onPress={onOpenProfile} style={styles.previewMain} accessibilityRole="button">
        <Avatar
          avatar={person.attendee?.profile.avatar}
          name={person.displayName}
          size="list"
          availability={person.availability}
        />
        <View style={styles.previewText}>
          <AppText variant="heading" numberOfLines={1}>
            {person.displayName}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {person.subtitle ?? (person.resolved ? 'Attendee' : 'Looking them up…')}
          </AppText>
          <View style={styles.previewMeta}>
            <SignalBars band={person.proximity.band} confidence={person.proximity.confidence} />
            <ProximityLabel
              label={person.proximity.label}
              rangeLabel={person.proximity.rangeLabel}
              provisional={person.proximity.provisional}
            />
          </View>
        </View>
      </Pressable>

      <View style={styles.previewActions}>
        <Button label="Find" icon="🧭" variant="secondary" onPress={onNavigate} />
        <Button label="Profile" onPress={onOpenProfile} />
      </View>

      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.previewClose}
      >
        <AppText variant="caption" tone="tertiary">
          ✕
        </AppText>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 * Full profile
 * ------------------------------------------------------------------ */

export function ProfileCard({
  person,
  visible,
  connectionState,
  onClose,
  onConnect,
  connectNotice,
  onCancelRequest,
  onDeclineRequest,
  onNavigate,
  onBlock,
  onReport,
  match,
  starter,
}: {
  person: NearbyPerson | null;
  visible: boolean;
  connectionState: ConnectionState;
  onClose: () => void;
  onConnect: () => void;
  /**
   * Why the last Connect attempt did not work.
   *
   * Failures only. This card is a `Modal`, and a toast mounted at the root
   * paints behind it, so a failure left to the toast is indistinguishable from
   * a button that does nothing. A success needs no notice here because the card
   * closes — the confirmation chip is on the radar, where it is visible.
   */
  connectNotice?: string | null;
  /** Withdraw a request already sent. Omitted where the screen offers no cancel. */
  onCancelRequest?: () => void;
  /** Decline a request from this person, when they have sent one. */
  onDeclineRequest?: () => void;
  onNavigate: () => void;
  onBlock: () => void;
  onReport: (input: ReportInput) => void;
  /** Match strength, from the rules engine. Null when it is not worth claiming. */
  /** The explained match: a percentage, a tier, and the factors behind both. */
  match?: MatchBreakdown | null;
  /** An opening line derived only from what both profiles already state. */
  starter?: ConversationStarter | null;
}): React.ReactElement | null {
  const { colors, name } = useTheme();
  const [reporting, setReporting] = useState(false);

  /**
   * The recap needs to know how much of the room you looked at, and this is
   * the one place every route into a profile converges — map, search, browse
   * and recommendations all end up here. Recording it anywhere else would
   * miss a door. Idempotent per person, so the repeat opens cost nothing.
   */
  const openedId = visible ? (person?.profileId ?? null) : null;
  useEffect(() => {
    if (openedId) actions.recordCardOpen(openedId);
  }, [openedId]);

  if (!person) return null;

  const attendee = person.attendee;
  const profile = attendee?.profile;
  const eventProfile = attendee?.eventProfile;
  const accent = person.category ? categoryColor(person.category, name) : colors.accent;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} />

      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation.high,
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close profile"
          style={styles.sheetClose}
        >
          <AppText variant="caption" tone="tertiary">
            ✕
          </AppText>
        </Pressable>

        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Avatar
              avatar={profile?.avatar}
              name={person.displayName}
              size="hero"
              availability={person.availability}
            />
            <AppText variant="title" style={styles.centered}>
              {person.displayName}
            </AppText>
            {profile?.pronouns ? (
              <AppText variant="caption" tone="tertiary">
                {profile.pronouns}
              </AppText>
            ) : null}
            {person.subtitle ? (
              <AppText variant="body" tone="secondary" style={styles.centered}>
                {person.subtitle}
              </AppText>
            ) : null}

            {match ? (
              <View style={[styles.matchPill, { borderColor: accent }]}>
                <AppText variant="caption" style={{ color: accent }}>
                  {/* The number rides along only when more than one thing
                      produced it — `showPercent` enforces that upstream, so a
                      thin match still gets a tier and no arithmetic. */}
                  {match.showPercent
                    ? `✦ ${match.label} · ${match.percent}%`
                    : `✦ ${match.label}`}
                </AppText>
              </View>
            ) : null}

            <View style={styles.heroMeta}>
              <PresencePill availability={person.availability} />
              <View style={[styles.proximityChip, { borderColor: colors.border }]}>
                <SignalBars band={person.proximity.band} confidence={person.proximity.confidence} />
                <AppText variant="caption" tone="secondary">
                  {person.proximity.provisional
                    ? 'Locating…'
                    : `${person.proximity.label} · about ${person.proximity.rangeLabel}`}
                </AppText>
              </View>
            </View>
          </View>

          {!attendee ? (
            <View style={[styles.notice, { borderColor: colors.border }]}>
              {/* Do not promise a sync that may never come. There is no
                  server in the offline case, so "it will fill in as the
                  attendee list finishes syncing" was a wait with no end —
                  and it hid the one thing that actually does exchange
                  details between two phones in a room. */}
              <AppText variant="body" tone="secondary">
                This person is broadcasting, but has not shared their profile with this device.
                Connecting exchanges cards directly between your two phones.
              </AppText>
            </View>
          ) : null}

          {/* The whole point of the screen: not "here is a person" but "here is
              why this person". A percentage with no reasons under it is a magic
              number, so the factors are not optional decoration — the block
              renders only when there is something to list. */}
          {match?.factors.length ? (
            <View style={[styles.whyBlock, { borderColor: accent, backgroundColor: colors.accentSoft }]}>
              <View style={styles.whyHeader}>
                <AppText variant="bodyStrong" style={{ color: accent }}>
                  {match.label}
                </AppText>
                {match.showPercent ? (
                  <AppText variant="bodyStrong" style={{ color: accent }}>
                    {`${match.percent}% match`}
                  </AppText>
                ) : null}
              </View>
              {match.factors.map((factor) => (
                <View key={`${factor.kind}:${factor.label}`} style={styles.whyRow}>
                  <View style={[styles.whyDot, { backgroundColor: accent }]} />
                  <AppText variant="caption" tone="secondary" style={styles.whyText}>
                    {factor.label}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {/* Knowing who to meet is not knowing how to open. This is the only
              place in the app that hands the user a sentence to say, and every
              one is derived from a fact both profiles already state — never
              invented, or it falls apart in one exchange. */}
          {starter ? (
            <View style={[styles.starterBlock, { borderColor: colors.border }]}>
              <AppText variant="micro" tone="tertiary">
                💡 CONVERSATION STARTER
              </AppText>
              <AppText variant="caption" tone="secondary">
                {starter.basis}
              </AppText>
              <AppText variant="body" style={{ color: colors.textPrimary }}>
                {starter.question}
              </AppText>
            </View>
          ) : null}

          {eventProfile?.askMeAbout?.length ? (
            <Section title="Ask me about">
              <View style={styles.chips}>
                {eventProfile.askMeAbout.map((topic) => (
                  <Chip key={topic} label={topic} compact color={accent} />
                ))}
              </View>
            </Section>
          ) : null}

          {profile?.experienceYears !== undefined ? (
            <Row label="Experience" value={`${profile.experienceYears} ${profile.experienceYears === 1 ? 'year' : 'years'}`} />
          ) : null}
          {profile?.industry ? <Row label="Industry" value={profile.industry} /> : null}

          {profile?.bio ? (
            <Section title="About">
              <AppText variant="body" tone="secondary">
                {profile.bio}
              </AppText>
            </Section>
          ) : null}

          {profile?.skills.length ? (
            <Section title="Skills">
              <View style={styles.chips}>
                {profile.skills.map((skill) => (
                  <Chip key={skill} label={skill} compact />
                ))}
              </View>
            </Section>
          ) : null}

          {profile?.interests.length ? (
            <Section title="Interests">
              <View style={styles.chips}>
                {profile.interests.map((interest) => (
                  <Chip key={interest} label={interest} compact color={accent} />
                ))}
              </View>
            </Section>
          ) : null}

          {eventProfile?.lookingToMeet?.length ? (
            <Section title="Looking to meet">
              <AppText variant="body" tone="secondary">
                {eventProfile.lookingToMeet.join(' · ')}
              </AppText>
            </Section>
          ) : null}

          {eventProfile?.whyAttending ? (
            <Section title="Why they're here">
              <AppText variant="body" tone="secondary">
                {eventProfile.whyAttending}
              </AppText>
            </Section>
          ) : null}

          {eventProfile?.currentProject ? (
            <Section title="Working on">
              <AppText variant="body" tone="secondary">
                {eventProfile.currentProject}
              </AppText>
            </Section>
          ) : null}

          {profile?.links ? <LinkRow links={profile.links} /> : null}

          <Divider />

          {reporting ? (
            <Section title="Report this profile">
              {REPORT_REASONS.map((reason) => (
                <Pressable
                  key={reason.value}
                  onPress={() => {
                    setReporting(false);
                    onReport({ profileId: profile?.id ?? '', reason: reason.value });
                  }}
                  style={styles.reportRow}
                  accessibilityRole="button"
                >
                  <AppText variant="body">{reason.label}</AppText>
                </Pressable>
              ))}
              <Button label="Cancel" variant="ghost" onPress={() => setReporting(false)} />
            </Section>
          ) : (
            <View style={styles.safetyRow}>
              <Button label="Block" variant="ghost" onPress={onBlock} />
              <Button label="Report" variant="ghost" onPress={() => setReporting(true)} />
            </View>
          )}
        </ScrollView>

        <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
          {connectNotice ? (
            /*
             * `surfaceSunken`, not `surfaceElevated`: in the light palette
             * `surfaceElevated` and `surface` are both #FFFFFF, so the box had
             * no fill at all and the border did the whole job. Sunken reads as a
             * recess against the sheet in both themes, and the words carry the
             * meaning — colour never does it alone.
             */
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.connectNotice,
                {
                  backgroundColor: colors.surfaceSunken,
                  borderColor: colors.danger,
                  borderWidth: 1,
                },
              ]}
            >
              <AppText variant="caption" tone="secondary">
                {connectNotice}
              </AppText>
            </View>
          ) : null}
          <View style={styles.sheetActions}>
            <Button label="Find me" icon="🧭" variant="secondary" onPress={onNavigate} full />
            <Button
              label={connectionActionLabel(connectionState)}
              onPress={onConnect}
              /*
               * Disabled while a request is in flight or already answered.
               * `outgoing_pending` reads "Request sent" and must not invite a
               * second tap: sending twice would open a second exchange the far
               * side has no way to tell from the first.
               */
              disabled={connectionState === 'connected' || connectionState === 'outgoing_pending'}
            />
            {connectionState === 'outgoing_pending' && onCancelRequest ? (
              <Button
                label="Cancel request"
                variant="ghost"
                onPress={onCancelRequest}
              />
            ) : null}
            {connectionState === 'incoming_pending' && onDeclineRequest ? (
              <Button label="Decline" variant="secondary" onPress={onDeclineRequest} />
            ) : null}
          </View>

          {/* "BLE uncertainty is communicated, never disguised" — the actions
              above look decisive, so the caption states plainly how good the
              underlying signal actually is. */}
          <AppText variant="micro" tone="tertiary" style={styles.centered}>
            {person.proximity.provisional
              ? 'Still working out how close they are'
              : `Approx. ${person.proximity.label.toLowerCase()} · signal ${
                  person.proximity.confidence > 0.66
                    ? 'strong'
                    : person.proximity.confidence > 0.33
                      ? 'fair'
                      : 'weak'
                }`}
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.section}>
      <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </AppText>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <AppText variant="body" tone="secondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function LinkRow({ links }: { links: ProfileLinks }): React.ReactElement | null {
  const entries = Object.entries(links).filter(([, url]) => Boolean(url)) as [string, string][];
  if (entries.length === 0) return null;

  return (
    <Section title="Links">
      <View style={styles.chips}>
        {entries.map(([key, url]) => (
          <Chip
            key={key}
            label={key}
            onPress={() => {
              // Never assume a URL opens; a dead link should fail quietly.
              void Linking.openURL(url).catch(() => undefined);
            }}
          />
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  previewBar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
    gap: space.md,
  },
  previewMain: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  previewText: { flex: 1, gap: 2 },
  previewMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  previewActions: { flexDirection: 'row', gap: space.sm },
  previewClose: { position: 'absolute', top: space.md, right: space.md, padding: 4 },

  scrim: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingTop: space.sm,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space.sm,
  },
  sheetClose: { position: 'absolute', top: space.lg, right: space.lg, zIndex: 2, padding: 6 },
  sheetContent: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.md },
  hero: { alignItems: 'center', gap: space.xs, paddingTop: space.sm },
  heroMeta: { flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' },
  proximityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm - 2,
  },
  notice: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    borderStyle: 'dashed',
  },
  section: { gap: space.sm, paddingTop: space.md },
  sectionTitle: { letterSpacing: 0.8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  centered: { textAlign: 'center' },
  safetyRow: { flexDirection: 'row', justifyContent: 'center', gap: space.lg },
  reportRow: { paddingVertical: space.md },
  sheetFooter: {
    padding: space.lg,
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  connectNotice: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  sheetActions: { flexDirection: 'row', gap: space.md },
  whyBlock: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    marginTop: space.md,
  },
  whyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  whyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  whyDot: { width: 4, height: 4, borderRadius: 2, marginTop: 7 },
  whyText: { flex: 1 },
  starterBlock: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
    marginTop: space.md,
  },
  matchPill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm - 2,
    marginTop: space.sm,
  },
});
