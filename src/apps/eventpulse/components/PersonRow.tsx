/**
 * PersonRow — one attendee in a list.
 *
 * Used by Discover, Connections and the recommendation carousel, so it has to
 * carry two different kinds of "how near": the live proximity band for people
 * the radio can see, and nothing at all for everyone else. A row that showed a
 * stale distance for someone who left an hour ago would be worse than a row
 * that stays quiet.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Attendee, ConnectionState } from '../types';
import type { NearbyPerson } from '../presence/PresenceController';
import { connectionActionLabel } from '../connections/ConnectionService';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, radius, space } from '../theme/tokens';
import { Avatar } from './Avatar';
import { PresenceDot, SignalBars } from './StatusIndicator';
import { AppText, Button, Card } from './primitives';

export interface PersonRowProps {
  attendee: Attendee;
  /** Present only while the person is actually in Bluetooth range. */
  nearby?: NearbyPerson | null;
  connectionState?: ConnectionState;
  subtitle?: string;
  reasons?: string[];
  /**
   * Drops the card chrome for a plain divided row.
   *
   * The design system reserves a bordered card for something that wants a
   * decision. A pending request is one; an established connection is a record,
   * and giving it the same weight makes a list of forty friends look like forty
   * outstanding tasks.
   */
  flat?: boolean;
  /** Bookmarked for later. Private — the other person is never told. */
  saved?: boolean;
  onToggleSaved?: () => void;
  onPress: () => void;
  onConnect?: () => void;
  /**
   * The other half of a decision, rendered beside `onConnect` inside the card.
   *
   * Accept and Decline are two answers to one question, so they have to be
   * siblings. Declining used to live outside the card entirely, which put the
   * two halves in different containers and left "Decline" floating against the
   * next person's row.
   */
  onDecline?: () => void;
  /** Label for the decline action. Defaults to the established wording. */
  declineLabel?: string;
  /**
   * Rendered inside the card, above the person.
   *
   * For the eyebrow that says what kind of row this is — "CONNECTION REQUEST" —
   * so the card announces itself before the reader has parsed a name.
   */
  header?: React.ReactNode;
  /**
   * Rendered inside the row's own bounds, below the actions.
   *
   * A `flat` row draws its divider on the container, so anything rendered after
   * the row reads as belonging to the person underneath. The Chat button is the
   * case that matters: it must sit above that hairline or it looks like it
   * opens the wrong conversation.
   */
  footer?: React.ReactNode;
  onNavigate?: () => void;
}

function PersonRowComponent({
  attendee,
  nearby,
  connectionState = 'none',
  subtitle,
  reasons,
  flat,
  saved,
  onToggleSaved,
  onPress,
  onConnect,
  onDecline,
  declineLabel = 'Decline',
  header,
  footer,
  onNavigate,
}: PersonRowProps): React.ReactElement {
  const { colors, name } = useTheme();
  const { profile, eventProfile } = attendee;
  const accent = categoryColor(profile.category, name);

  const role = [profile.role, profile.company].filter(Boolean).join(' · ');
  /** Connected, or waiting on them — either way there is nothing left to press. */
  const settled = connectionState === 'connected' || connectionState === 'outgoing_pending';

  const Container = flat ? FlatRow : Card;

  return (
    <Container onPress={onPress} style={flat ? styles.flat : styles.card}>
      {header}

      <View style={styles.main}>
        <Avatar
          avatar={profile.avatar}
          name={profile.name}
          size="list"
          availability={eventProfile.availability}
        />

        <View style={styles.text}>
          <View style={styles.nameRow}>
            <AppText variant="heading" numberOfLines={1} style={styles.name}>
              {profile.name}
            </AppText>
            {attendee.isConnection ? (
              <View style={[styles.badge, { borderColor: colors.border }]}>
                <AppText variant="micro" tone="tertiary">
                  CONNECTED
                </AppText>
              </View>
            ) : null}
            {/* Navigation lives up here rather than in the action row, so every
                card ends in exactly one full-width primary button whether or
                not this person happens to be in range. A row that is sometimes
                one button wide and sometimes two makes a list of otherwise
                identical cards look broken. */}
            {onNavigate && nearby ? (
              <Pressable
                onPress={onNavigate}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Find ${profile.name}`}
                style={[styles.findButton, { borderColor: colors.border }]}
              >
                <AppText variant="caption">🧭</AppText>
              </Pressable>
            ) : null}

            {/* Saving matters most for people you *cannot* reach right now —
                that is the whole point of the nudge — so it sits beside Find
                rather than replacing the row's primary action. */}
            {onToggleSaved ? (
              <Pressable
                onPress={onToggleSaved}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(saved) }}
                accessibilityLabel={
                  saved ? `Remove ${profile.name} from saved` : `Save ${profile.name} for later`
                }
                style={[
                  styles.findButton,
                  {
                    borderColor: saved ? colors.accent : colors.border,
                    backgroundColor: saved ? colors.accentSoft : 'transparent',
                    marginLeft: onNavigate && nearby ? 0 : 'auto',
                  },
                ]}
              >
                <AppText variant="caption" tone={saved ? 'accent' : 'secondary'}>
                  {saved ? '★' : '☆'}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {role ? (
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {role}
            </AppText>
          ) : null}

          <View style={styles.metaRow}>
            <View style={[styles.categoryDot, { backgroundColor: accent }]} />
            <AppText variant="micro" tone="tertiary">
              {profile.experienceYears !== undefined
                ? `${profile.experienceYears} ${profile.experienceYears === 1 ? 'yr' : 'yrs'}`
                : profile.category}
            </AppText>

            {nearby ? (
              <>
                <SignalBars
                  band={nearby.proximity.band}
                  confidence={nearby.proximity.confidence}
                  size={10}
                />
                <AppText variant="micro" tone="tertiary">
                  {nearby.proximity.provisional
                    ? 'locating…'
                    : `${nearby.proximity.label.toLowerCase()} · ${nearby.proximity.rangeLabel}`}
                </AppText>
              </>
            ) : (
              <>
                <PresenceDot availability={eventProfile.availability} size={6} />
                <AppText variant="micro" tone="tertiary">
                  not in range
                </AppText>
              </>
            )}
          </View>

          {subtitle ? (
            <AppText variant="caption" tone="tertiary" numberOfLines={2}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      {reasons?.length ? (
        <View style={[styles.reasons, { borderTopColor: colors.border }]}>
          {reasons.map((reason) => (
            <AppText key={reason} variant="caption" tone="secondary">
              {`✦  ${reason}`}
            </AppText>
          ))}
        </View>
      ) : null}

      {onConnect ? (
        <View style={styles.actions}>
          {/* Decline first in source order so it is first in the accessibility
              tree and first under a left-to-right reading — and, being the
              lighter control, it never steals the thumb's default target on the
              right. */}
          {onDecline ? (
            <Button
              label={declineLabel}
              onPress={onDecline}
              variant="secondary"
              accessibilityLabel={`${declineLabel} request from ${profile.name}`}
            />
          ) : null}

          {/* A finished action is not a disabled one. "Request sent" rendered as
              a dimmed primary button reads as "this control is broken" and, at
              45% opacity on a filled accent, barely reads at all. Settled states
              get the quiet outlined treatment instead: nothing to do here, and
              you can see what it says. */}
          <Button
            label={connectionActionLabel(connectionState)}
            onPress={onConnect}
            variant={settled ? 'secondary' : 'primary'}
            disabled={settled}
            full
            accessibilityLabel={`${connectionActionLabel(connectionState)} ${profile.name}`}
          />
        </View>
      ) : null}

      {footer}
    </Container>
  );
}

/** Card's signature, minus the surface and border. */
function FlatRow({
  children,
  onPress,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors } = useTheme();
  const content = <View style={[{ borderBottomColor: colors.border }, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

export const PersonRow = memo(PersonRowComponent);

const styles = StyleSheet.create({
  card: { padding: space.md, gap: space.sm },
  flat: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1 },
  findButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 3 },
  categoryDot: { width: 6, height: 6, borderRadius: 3 },
  reasons: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm },
});
