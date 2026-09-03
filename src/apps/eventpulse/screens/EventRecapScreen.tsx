/**
 * EventRecapScreen — screen 5.4, "the reason to return".
 *
 * The flow document ends here on purpose. Every networking app is good at the
 * moment of meeting and useless the morning after, when a list of names means
 * nothing and the promises made in the room have evaporated. This screen exists
 * to convert an evening into follow-ups while the user still remembers who
 * everyone was.
 *
 * Three things it does, in order of importance:
 *
 *  1. **Says what stopped.** Broadcasting is off and the attendee list is gone
 *     from the device. Notes stay. Users deserve to be told when a thing that
 *     was transmitting has stopped transmitting, and told it plainly.
 *  2. **Turns notes into errands.** A note that says "she'll introduce me to
 *     the PM on their agents team" is a task; the recap is the only place the
 *     app can see that and say so.
 *  3. **Points at the next event.** Not a growth trick — the honest reason to
 *     open the app again is that there is another room worth walking into.
 *
 * On the numbers: every one is derived from something the device already holds.
 * There is no engagement score, and nothing here is uploaded.
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SavedPerson } from '../connections/SavedPeopleService';
import type { Attendee, EventSummary } from '../types';
import { Avatar } from '../components/Avatar';
import { AppText, Button, Card } from '../components/primitives';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';

export interface RecapErrand {
  saved: SavedPerson;
  attendee: Attendee | null;
  /** The note, which is the errand. */
  note: string;
}

export function EventRecapScreen({
  event,
  saved,
  errands,
  cardsOpened,
  nextEvent,
  onOpenPerson,
  onExport,
  onDone,
  onDismiss,
}: {
  event: EventSummary;
  saved: SavedPerson[];
  errands: RecapErrand[];
  cardsOpened: number;
  nextEvent?: EventSummary | null;
  onOpenPerson: (profileId: string) => void;
  onExport: () => void;
  /** Confirms the end: stops broadcasting and clears the attendee list. */
  onDone: () => void;
  /**
   * Backs out without ending anything.
   *
   * Ending an event is destructive — it stops the radio and deletes the
   * directory — and it is reached from a button one tap away from the theme
   * switcher. A screen with no exit but the destructive one turns a mis-tap
   * into a loss.
   */
  onDismiss: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  // Read the inset directly rather than relying on SafeAreaView's `bottom`
  // edge: the edge prop was not lifting the footer clear of the gesture bar
  // here, and a Done button you cannot press is worse than a little extra code.
  const insets = useSafeAreaInsets();

  const followUps = useMemo(
    () =>
      saved.filter((person) =>
        (person.tags ?? []).some((tag) => tag === 'follow_up' || tag === 'intro_promised'),
      ).length,
    [saved],
  );

  const metCount = useMemo(() => saved.filter((person) => person.met).length, [saved]);

  return (
    // Bottom edge included: this screen owns the full window — there is no tab
    // bar underneath it to absorb the gesture inset, so without it the footer
    // button sits under the navigation bar.
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      {/* `flex: 1` on the ScrollView itself, not just its content: without it the
          list grows to fit its children and pushes the footer button off the
          bottom of the window once there are a few errands. */}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: space.xxl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button">
          <AppText variant="caption" tone="secondary">
            ← Not yet
          </AppText>
        </Pressable>
        <AppText variant="eyebrow" tone="tertiary">
          {`${event.name.toUpperCase()} · ENDED`}
        </AppText>
        <AppText variant="display" style={styles.headline}>
          {metCount > 0
            ? `You met ${spell(metCount)} ${metCount === 1 ? 'person' : 'people'}`
            : 'That was the event'}
        </AppText>
        <AppText variant="body" tone="secondary">
          Broadcasting has stopped and the attendee list has been removed from your phone. Your
          notes stay.
        </AppText>

        <View style={[styles.stats, { borderColor: colors.border }]}>
          <Stat value={saved.length} label="SAVED" />
          <Stat value={followUps} label="FOLLOW UPS" tone={followUps > 0 ? 'accent' : undefined} />
          <Stat value={cardsOpened} label="CARDS OPENED" />
        </View>

        {errands.length > 0 ? (
          <>
            <AppText variant="eyebrow" tone="tertiary" style={styles.sectionLabel}>
              DO THIS BEFORE YOU FORGET
            </AppText>
            {errands.map((errand) => (
              <Card
                key={errand.saved.profileId}
                style={styles.errand}
                onPress={() => onOpenPerson(errand.saved.profileId)}
              >
                <Avatar
                  avatar={errand.attendee?.profile.avatar}
                  name={errand.attendee?.profile.name ?? 'Someone'}
                  size="list"
                />
                <View style={styles.errandText}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {errand.attendee?.profile.name ?? 'Someone you met'}
                  </AppText>
                  <AppText variant="caption" tone="secondary" numberOfLines={3}>
                    {errand.note}
                  </AppText>
                  {errand.saved.metAtZone ? (
                    <AppText variant="eyebrow" tone="tertiary">
                      {errand.saved.metAtZone.toUpperCase()}
                    </AppText>
                  ) : null}
                </View>
              </Card>
            ))}
          </>
        ) : saved.length > 0 ? (
          <AppText variant="caption" tone="tertiary" style={styles.sectionLabel}>
            You saved {saved.length} {saved.length === 1 ? 'person' : 'people'} but wrote no notes.
            Names fade fast — a line each is worth more tomorrow than it costs now.
          </AppText>
        ) : null}

        {saved.length > 0 ? (
          <Button label="Export contacts" variant="secondary" onPress={onExport} />
        ) : null}

        {nextEvent ? (
          <Card style={styles.next}>
            <AppText variant="eyebrow" tone="tertiary">
              NEXT
            </AppText>
            <AppText variant="bodyStrong">{nextEvent.name}</AppText>
            <AppText variant="caption" tone="secondary">
              {`${nextEvent.venue.name} · ${nextEvent.attendeeCount.toLocaleString()} going`}
            </AppText>
          </Card>
        ) : null}
        {/* Done scrolls with the content rather than being pinned. This screen
            is short and terminal, so a fixed footer bought nothing and cost a
            layout fight with the gesture bar. */}
        <View style={styles.done}>
          <Button label="Done" onPress={onDone} full />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'accent';
}): React.ReactElement {
  return (
    <View style={styles.stat}>
      <AppText variant="mono" tone={tone}>
        {String(value)}
      </AppText>
      <AppText variant="eyebrow" tone="tertiary">
        {label}
      </AppText>
    </View>
  );
}

/**
 * "You met five people" reads better than "You met 5 people" in a headline, and
 * worse than a numeral once the count stops being conversational.
 */
function spell(count: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return count < words.length ? words[count] : String(count);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  done: { paddingTop: space.lg },
  headline: { marginTop: 2 },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: space.md,
    marginTop: space.sm,
  },
  stat: { flex: 1, gap: 2 },
  sectionLabel: { paddingTop: space.md },
  errand: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md },
  errandText: { flex: 1, gap: 3 },
  next: { gap: 3, padding: space.md, borderRadius: radius.lg },
});
