/**
 * WorthWalkingOver — the ranked queue that sits under the radar.
 *
 * From the flow document: *"The map earns its place by ranking, not by drawing
 * dots."* A radar answers "who is here". On its own that is a novelty — forty
 * initials arranged in a circle, and no way to choose. This strip answers the
 * question the user actually has, which is **who should I walk over to**, and it
 * does it in the same glance as the map behind it.
 *
 * Each row carries exactly the four things that make that decision:
 *
 *   - who they are,
 *   - a score, and the single strongest *reason* for it — a number with no
 *     reason attached is a horoscope,
 *   - how far, as a band,
 *   - and how to act.
 *
 * On direction
 * ------------
 * The design prints "AHEAD LEFT" beside the distance. This component will show
 * that only when navigation has actually solved a bearing for that person, and
 * shows nothing otherwise. Bearing on this map is a *hashed layout* — stable so
 * nobody swings around you, and meaningless as a heading. Printing it as a
 * direction would send people the wrong way while looking authoritative, which
 * is the one failure the rest of this codebase is built to avoid.
 */

import React, { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { NearbyPerson } from '../presence/PresenceController';
import type { MatchBreakdown } from '../recommendations/MatchEngine';
import { Avatar } from './Avatar';
import { AppText } from './primitives';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export interface WalkCandidate {
  person: NearbyPerson;
  match: MatchBreakdown | null;
  /** Coarse heading, only when the navigator has earned it. */
  direction?: string | null;
}

export interface WorthWalkingOverProps {
  candidates: WalkCandidate[];
  /** Total people in range, for the "All N" affordance. */
  totalNearby: number;
  onOpen: (peerId: string) => void;
  onSeeAll: () => void;
}

/** More than this and it stops being a shortlist and becomes another list. */
const MAX_ROWS = 3;

function WorthWalkingOverComponent({
  candidates,
  totalNearby,
  onOpen,
  onSeeAll,
}: WorthWalkingOverProps): React.ReactElement | null {
  const { colors } = useTheme();

  // Only people the matcher actually vouched for. A "ranked queue" padded out
  // with strangers is just the nearby list wearing a better title, and it
  // teaches the user to stop trusting the ranking.
  const ranked = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.match !== null)
        .sort((a, b) => (b.match?.percent ?? 0) - (a.match?.percent ?? 0))
        .slice(0, MAX_ROWS),
    [candidates],
  );

  if (ranked.length === 0) return null;

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.header}>
        <AppText variant="eyebrow" tone="tertiary">
          WORTH WALKING OVER
        </AppText>
        <Pressable onPress={onSeeAll} hitSlop={8} accessibilityRole="button">
          <AppText variant="caption" tone="accent">
            {`All ${totalNearby} →`}
          </AppText>
        </Pressable>
      </View>

      <ScrollView
        horizontal={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.rows}
      >
        {ranked.map(({ person, match, direction }) => {
          // Deliberately not the category colour. Scoring these rows by role hue
          // makes a three-row shortlist look like three unrelated things and
          // implies the colour means something about the rank, which it does
          // not. One accent for "this is the ranking", category colour stays on
          // the map where it distinguishes people spatially.
          const accent = colors.accent;
          // The top reason only. The full list lives on the profile card; here
          // it has to be readable while walking.
          const reason = match?.factors[0]?.label;

          return (
            <Pressable
              key={person.peerId}
              onPress={() => onOpen(person.peerId)}
              accessibilityRole="button"
              accessibilityLabel={`${person.displayName}${
                match ? `, ${match.label}` : ''
              }. ${reason ?? ''}`}
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Avatar
                avatar={person.attendee?.profile.avatar}
                name={person.displayName}
                size="list"
                availability={person.availability}
              />

              <View style={styles.body}>
                <View style={styles.nameRow}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={styles.name}>
                    {person.displayName}
                  </AppText>
                  {match?.showPercent ? (
                    <View style={styles.score}>
                      <AppText variant="bodyStrong" style={{ color: accent }}>
                        {match.percent}
                      </AppText>
                      <AppText variant="eyebrow" tone="tertiary">
                        MATCH
                      </AppText>
                    </View>
                  ) : null}
                </View>

                {person.subtitle ? (
                  <AppText variant="caption" tone="secondary" numberOfLines={1}>
                    {person.subtitle}
                  </AppText>
                ) : null}

                {reason ? (
                  <AppText variant="caption" tone="secondary" numberOfLines={2}>
                    {reason}
                  </AppText>
                ) : null}

                <View style={styles.metaRow}>
                  <AppText variant="eyebrow" tone="tertiary">
                    {person.proximity.provisional
                      ? 'LOCATING'
                      : person.proximity.rangeLabel.toUpperCase()}
                  </AppText>
                  {/* Present only when the navigator solved it — see the note
                      at the top of this file. */}
                  {direction ? (
                    <AppText variant="eyebrow" tone="tertiary">
                      {`· ${direction.toUpperCase()}`}
                    </AppText>
                  ) : null}
                </View>
              </View>

              <View style={[styles.open, { borderColor: colors.border }]}>
                <AppText variant="caption" tone="accent">
                  Open
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export const WorthWalkingOver = memo(WorthWalkingOverComponent);

const styles = StyleSheet.create({
  root: {
    borderTopWidth: 1,
    borderRadius: radius.xl,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  rows: { paddingHorizontal: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  body: { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1 },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginLeft: 'auto' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  open: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
});
