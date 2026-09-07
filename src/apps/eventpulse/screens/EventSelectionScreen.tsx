/**
 * EventSelectionScreen — choose an event, and understand what joining means.
 *
 * The join sheet is where the product makes its privacy promise, so it is
 * plain-spoken and it comes *before* anything is broadcast: you pick your
 * visibility, you read one sentence about what attendees will see, and only
 * then does the radio start.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VISIBILITY_OPTIONS } from '../security/PrivacyService';
import type { EventSummary, Visibility } from '../types';
import { actions, isMockBackend } from '../runtime/services';
import { sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { bannerColor, elevation, radius, space } from '../theme/tokens';
import { AppText, Button, Card, Chip, EmptyState, Loading } from '../components/primitives';

export function EventSelectionScreen(): React.ReactElement {
  const { colors } = useTheme();
  const events = useStore(sessionStore, (state) => state.events);
  const fromCache = useStore(sessionStore, (state) => state.eventsFromCache);
  const boot = useStore(sessionStore, (state) => state.boot);

  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<EventSummary | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await actions.refreshEvents();
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (boot === 'no_event' && events.length === 0) void refresh();
  }, [boot, events.length, refresh]);

  const join = useCallback(
    async (event: EventSummary, visibility: Visibility) => {
      setJoining(true);
      setError(null);
      try {
        await actions.joinEvent(event.id, visibility);
        setPending(null);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        setJoining(false);
      }
    },
    [],
  );

  if (boot === 'loading') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <Loading label="Getting things ready" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        <View style={styles.intro}>
          <AppText variant="display">Events near you</AppText>
          <AppText variant="body" tone="secondary">
            Join an event to see who is around you, live.
          </AppText>
          {fromCache ? (
            <AppText variant="caption" tone="tertiary">
              Showing your cached list — you appear to be offline.
            </AppText>
          ) : null}
          {/* Said plainly, and on the screen the events are chosen from. These are a
              sample crowd from the in-memory backend, shown because no server was
              configured — the alternative was an empty list that explained nothing.
              The radio is still real: anyone genuinely nearby is genuinely nearby. */}
          {isMockBackend() ? (
            <AppText variant="caption" tone="tertiary">
              Sample events — no backend is configured, so these are demo data. Bluetooth
              is still live, so people near you are real.
            </AppText>
          ) : null}
        </View>

        {events.length === 0 ? (
          <EmptyState
            emoji="🎪"
            title="No events yet"
            body="When you are at a conference, hackathon or job fair using EventPulse, it will show up here."
            actionLabel="Check again"
            onAction={refresh}
          />
        ) : (
          events.map((event) => (
            <EventRow key={event.id} event={event} onJoin={() => setPending(event)} />
          ))
        )}
      </ScrollView>

      <JoinSheet
        event={pending}
        busy={joining}
        error={error}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
        onJoin={(visibility) => pending && void join(pending, visibility)}
      />
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ *
 * Event row
 * ------------------------------------------------------------------ */

function Stat({ value, label }: { value: string; label: string }): React.ReactElement {
  return (
    <View style={styles.stat}>
      <AppText variant="bodyStrong" numberOfLines={1}>
        {value}
      </AppText>
      <AppText variant="eyebrow" tone="tertiary">
        {label}
      </AppText>
    </View>
  );
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function EventRow({
  event,
  onJoin,
}: {
  event: EventSummary;
  onJoin: () => void;
}): React.ReactElement {
  const { colors, name } = useTheme();
  const live = Date.now() >= event.startTime && Date.now() <= event.endTime;

  return (
    <Card style={styles.card} raised>
      <View
        style={[
          styles.banner,
          // Deep band in dark, pale band in light — the hue is the event's
          // identity, the lightness belongs to the theme.
          { backgroundColor: bannerColor(event.bannerHue, name, live) },
        ]}
      >
        <AppText variant="eyebrow" tone="secondary">
          {live
            ? `LIVE NOW · ENDS ${formatClock(event.endTime)}`
            : formatDate(event.startTime).toUpperCase()}
        </AppText>
      </View>

      <View style={styles.cardBody}>
        <AppText variant="title">{event.name}</AppText>
        {event.tagline ? (
          <AppText variant="body" tone="secondary">
            {event.tagline}
          </AppText>
        ) : null}

        <AppText variant="caption" tone="tertiary">
          {`📍 ${event.venue.name}${event.venue.address ? `, ${event.venue.address}` : ''}`}
        </AppText>

        {/* The design's stat row.
            Only figures that are true before joining appear here. "In range"
            and "matches" need the radio running and the directory downloaded,
            neither of which has happened yet — printing a plausible number for
            them would be the first thing the app ever lied about. */}
        <View style={[styles.stats, { borderColor: colors.border }]}>
          <Stat value={event.attendeeCount.toLocaleString()} label="GOING" />
          <Stat
            value={formatDuration(event.endTime - event.startTime)}
            label={live ? 'LEFT TODAY' : 'RUNS FOR'}
          />
          <Stat value={String(event.tags.length ? event.tags[0] : '—')} label="TRACK" />
        </View>

        <View style={styles.tagRow}>
          {event.tags.map((tag) => (
            <Chip key={tag} label={tag} compact />
          ))}
        </View>

        <Button label="Join event" onPress={onJoin} />
      </View>

      {live ? <View style={[styles.liveDot, { backgroundColor: colors.available }]} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Join sheet
 * ------------------------------------------------------------------ */

function JoinSheet({
  event,
  busy,
  error,
  onCancel,
  onJoin,
}: {
  event: EventSummary | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onJoin: (visibility: Visibility) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const [visibility, setVisibility] = useState<Visibility>('visible');

  if (!event) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={onCancel} />

      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.surface, borderColor: colors.border },
          elevation.high,
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />

        <View style={styles.sheetContent}>
          <AppText variant="title">{event.name}</AppText>
          <AppText variant="body" tone="secondary">
            {event.description ?? event.tagline ?? ''}
          </AppText>

          <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
            WHO CAN SEE YOU
          </AppText>

          {VISIBILITY_OPTIONS.map((option) => {
            const selected = visibility === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setVisibility(option.value)}
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
                <View style={styles.optionHeader}>
                  <View
                    style={[
                      styles.radio,
                      { borderColor: selected ? colors.accent : colors.borderStrong },
                    ]}
                  >
                    {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
                  </View>
                  <AppText variant="bodyStrong">{option.label}</AppText>
                </View>
                <AppText variant="caption" tone="secondary" style={styles.optionBody}>
                  {option.description}
                </AppText>
              </Pressable>
            );
          })}

          {error ? (
            <AppText variant="caption" tone="danger">
              {error}
            </AppText>
          ) : null}

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} full />
            <Button label="Join event" onPress={() => onJoin(visibility)} loading={busy} full />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingBottom: space.xxl, gap: space.lg },
  intro: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.xs },
  card: { marginHorizontal: space.lg, padding: 0, overflow: 'hidden' },
  banner: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  cardBody: { padding: space.lg, gap: space.sm },
  stats: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: space.md,
    marginTop: space.xs,
  },
  stat: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.xs },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingBottom: space.sm },
  liveDot: { position: 'absolute', top: space.md, right: space.md, width: 8, height: 8, borderRadius: 4 },

  scrim: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    paddingTop: space.sm,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.sm },
  sheetContent: { padding: space.xl, gap: space.md },
  sectionTitle: { letterSpacing: 0.8, paddingTop: space.sm },
  option: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
  optionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  optionBody: { paddingLeft: 28 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  sheetActions: { flexDirection: 'row', gap: space.md, paddingTop: space.md },
});
