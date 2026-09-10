/**
 * DiscoverScreen — the attendee directory, independent of who is in range.
 *
 * The map answers "who is near me". This answers "who is *here*" — all 2,400 of
 * them, searchable, filterable, and fully functional with the network off
 * because the directory is already on the device.
 *
 * Two things earn their place at the top: the recommendations strip (§23), and
 * a nearby-first sort, because at an event the useful answer to "find me an ML
 * engineer" is usually the one you can walk to.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORY_OPTIONS } from '../components/FilterBar';
import { PersonRow } from '../components/PersonRow';
import { ProfileCard } from '../components/ProfileCard';
import { AppText, Chip, EmptyState, SectionHeader } from '../components/primitives';
import type { Attendee, PeopleFilter, PersonCategory } from '../types';
import { actions, queries } from '../runtime/services';
import { haptics } from '../runtime/haptics';
import { presenceStore, sessionStore } from '../state/stores';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, radius, space, typography } from '../theme/tokens';

export function DiscoverScreen({ onOpenMap }: { onOpenMap: () => void }): React.ReactElement {
  const { colors, name } = useTheme();

  // Re-run the search whenever the directory syncs or the crowd changes.
  const presenceUpdatedAt = useStore(presenceStore, (state) => state.updatedAt);
  const syncPhase = useStore(sessionStore, (state) => state.sync?.phase ?? 'idle');
  const filter = useStore(sessionStore, (state) => state.discoverFilter);
  const connections = useStore(sessionStore, (state) => state.connections);
  const saved = useStore(sessionStore, (state) => state.saved);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Attendee | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    haptics.select();
    try {
      await actions.refreshDirectory();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const effectiveFilter = useMemo<PeopleFilter>(
    () => ({ ...filter, query: query.trim() || undefined }),
    [filter, query],
  );

  const results = useMemo(
    () => queries.searchAttendees(effectiveFilter),
    // `presenceUpdatedAt` and `syncPhase` are the invalidation signals: the
    // directory and the live distances both live outside React.
    [effectiveFilter, presenceUpdatedAt, syncPhase],
  );

  const recommendations = useMemo(
    () => queries.recommendations({ limit: 5 }),
    [presenceUpdatedAt, syncPhase, connections],
  );

  const companies = useMemo(() => queries.facet('company', 8), [syncPhase]);

  const selectedCategories = useMemo(
    () => new Set(filter.categories ?? []),
    [filter.categories],
  );

  /** Bookmarks are private and device-local; see `SavedPeopleService`. */
  const savedIds = useMemo(() => new Set(saved.map((person) => person.profileId)), [saved]);

  const toggleCategory = useCallback(
    (category: PersonCategory) => {
      const next = new Set(filter.categories ?? []);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      actions.setDiscoverFilter({ ...filter, categories: next.size ? [...next] : undefined });
    },
    [filter],
  );

  const toggleCompany = useCallback(
    (company: string) => {
      const current = new Set(filter.companies ?? []);
      if (current.has(company)) current.delete(company);
      else current.add(company);
      actions.setDiscoverFilter({ ...filter, companies: current.size ? [...current] : undefined });
    },
    [filter],
  );

  const openPerson = useCallback((attendee: Attendee) => setSelected(attendee), []);

  const renderItem = useCallback(
    ({ item }: { item: Attendee }) => (
      <PersonRow
        attendee={item}
        nearby={queries.nearbyFor(item.profile.id)}
        connectionState={queries.connectionStateFor(item.profile.id)}
        saved={savedIds.has(item.profile.id)}
        onToggleSaved={() => {
          haptics.select();
          void actions.toggleSaved(item.profile.id);
        }}
        onPress={() => openPerson(item)}
        onConnect={() => void actions.connect(item.profile.id)}
      />
    ),
    [openPerson, savedIds],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people, companies, skills"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.search,
            typography.body,
            {
              backgroundColor: colors.surfaceSunken,
              borderColor: colors.border,
              color: colors.textPrimary,
            },
          ]}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search attendees"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.profile.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
        }
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        ListHeaderComponent={
          <View>
            {/* Two rows, split by what the chips mean rather than by where
                they happened to wrap: who is reachable right now, then what
                they do. Each row scrolls instead of wrapping, so adding a
                category never silently pushes the list further down the
                screen. */}
            <ChipRow>
              <Chip
                label="Everyone"
                selected={selectedCategories.size === 0 && !filter.availableOnly && !filter.nearbyOnly}
                onPress={() => actions.setDiscoverFilter({})}
              />
              <Chip
                label="Nearby now"
                selected={Boolean(filter.nearbyOnly)}
                onPress={() =>
                  actions.setDiscoverFilter({ ...filter, nearbyOnly: filter.nearbyOnly ? undefined : true })
                }
              />
              <Chip
                label="Available"
                selected={Boolean(filter.availableOnly)}
                onPress={() =>
                  actions.setDiscoverFilter({
                    ...filter,
                    availableOnly: filter.availableOnly ? undefined : true,
                  })
                }
              />
            </ChipRow>

            <ChipRow>
              {CATEGORY_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  color={categoryColor(option.value, name)}
                  selected={selectedCategories.has(option.value)}
                  onPress={() => toggleCategory(option.value)}
                />
              ))}
            </ChipRow>

            {companies.length > 0 ? (
              <ChipRow>
                {companies.map((company) => (
                  <Chip
                    key={company}
                    label={company}
                    compact
                    selected={filter.companies?.includes(company)}
                    onPress={() => toggleCompany(company)}
                  />
                ))}
              </ChipRow>
            ) : null}

            {recommendations.length > 0 && !query ? (
              <>
                <SectionHeader title="✨ People you may want to meet" />
                {recommendations.map((match) => (
                  <View key={match.profileId} style={styles.recommendation}>
                    <PersonRow
                      attendee={match.attendee}
                      nearby={queries.nearbyFor(match.profileId)}
                      connectionState={queries.connectionStateFor(match.profileId)}
                      reasons={match.reasons}
                      saved={savedIds.has(match.profileId)}
                      onToggleSaved={() => {
                        haptics.select();
                        void actions.toggleSaved(match.profileId);
                      }}
                      onPress={() => openPerson(match.attendee)}
                      onConnect={() => void actions.connect(match.profileId)}
                      onNavigate={() => {
                        const nearby = queries.nearbyFor(match.profileId);
                        if (!nearby) return;
                        actions.startNavigation(nearby.peerId);
                        onOpenMap();
                      }}
                    />
                  </View>
                ))}
              </>
            ) : null}

            <SectionHeader
              title={query ? `${results.length} results` : `All attendees · ${results.length}`}
            />
          </View>
        }
        ListFooterComponent={
          savedIds.size > 0 ? (
            <View style={styles.nudgeNote}>
              <AppText variant="caption" tone="tertiary">
                {'\u{1F514}  Saved people get a nudge the moment they come into range. That is the only notification EventPulse sends.'}
              </AppText>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            emoji="🔎"
            title="Nobody matches that"
            body={
              syncPhase === 'syncing'
                ? 'The attendee list is still downloading — try again in a moment.'
                : 'Try a different search, or clear some filters.'
            }
            actionLabel="Clear filters"
            onAction={() => {
              setQuery('');
              actions.setDiscoverFilter({});
            }}
          />
        }
      />

      <DiscoverProfileSheet attendee={selected} onClose={() => setSelected(null)} onOpenMap={onOpenMap} />
    </SafeAreaView>
  );
}

/** One horizontally scrolling line of filter chips. */
function ChipRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipRowBleed}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * Discover shows the same profile sheet as the map. When the person happens to
 * be in range we hand it the live presence entry so the proximity readout and
 * "Find me" work; otherwise we synthesise a placeholder that says plainly that
 * they are not in range, rather than showing a stale distance.
 */
function DiscoverProfileSheet({
  attendee,
  onClose,
  onOpenMap,
}: {
  attendee: Attendee | null;
  onClose: () => void;
  onOpenMap: () => void;
}): React.ReactElement | null {
  const people = useStore(presenceStore, (state) => state.people);
  if (!attendee) return null;

  const live = people.find((person) => person.profileId === attendee.profile.id) ?? null;

  const person = live ?? {
    peerId: `offline:${attendee.profile.id}`,
    attendee,
    profileId: attendee.profile.id,
    displayName: attendee.profile.name,
    subtitle:
      [attendee.profile.role, attendee.profile.company].filter(Boolean).join(' · ') || null,
    category: attendee.profile.category,
    availability: attendee.eventProfile.availability,
    placement: {
      peerId: `offline:${attendee.profile.id}`,
      position: { x: 0, y: 0 },
      bearing: 0,
      band: 'far' as const,
      estimatedDistance: Number.POSITIVE_INFINITY,
      confidence: 0,
    },
    proximity: {
      band: 'far' as const,
      label: 'Not in range',
      rangeLabel: '',
      estimatedDistance: Number.POSITIVE_INFINITY,
      trend: 'steady' as const,
      trendLabel: '',
      confidence: 0,
      provisional: false,
    },
    fading: false,
    isConnection: attendee.isConnection,
    resolved: true,
  };

  return (
    <ProfileCard
      person={person}
      visible
      connectionState={queries.connectionStateFor(attendee.profile.id)}
      match={queries.matchDetailFor(attendee.profile.id)}
      starter={queries.starterFor(attendee.profile.id)}
      onClose={onClose}
      onConnect={() => void actions.connect(attendee.profile.id)}
      onCancelRequest={() => void actions.cancelConnectionRequest(attendee.profile.id)}
      onDeclineRequest={() => void actions.rejectConnectionRequest(attendee.profile.id)}
      onNavigate={() => {
        if (!live) return;
        actions.startNavigation(live.peerId);
        onClose();
        onOpenMap();
      }}
      onBlock={() => {
        void actions.block(attendee.profile.id);
        onClose();
      }}
      onReport={(input) => {
        void actions.report(input);
        onClose();
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  searchRow: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  search: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    height: 44,
  },
  list: { paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.sm },
  nudgeNote: { paddingTop: space.lg, paddingBottom: space.md },
  // The list insets its content; a chip row has to escape that inset so chips
  // run to the screen edge and read as scrollable. The negative margin cancels
  // the list's padding, and the content padding puts the first chip back in
  // line with the rows below it.
  chipRowBleed: { marginHorizontal: -space.lg },
  // No wrapping: the row scrolls.
  chipRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  recommendation: { paddingBottom: space.sm },
});
