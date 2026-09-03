/**
 * The map's supporting sheets: legend, nearby list, and advanced filters.
 *
 * Grouped in one module because they share the same job — giving the spatial
 * view an escape hatch. A radar is a lovely way to see a room and a poor way to
 * answer "is anyone here from Google", and some people simply do not read
 * radars. Every one of these is a non-spatial route to the same data.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { NearbyPerson } from '../presence/PresenceController';
import type { PeopleFilter, PersonCategory } from '../types';
import { CATEGORY_OPTIONS } from './FilterBar';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { PresenceDot, SignalBars } from './StatusIndicator';
import { AppText, Button, Chip } from './primitives';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, radius, space } from '../theme/tokens';

/* ------------------------------------------------------------------ *
 * Legend — "how does this work?"
 * ------------------------------------------------------------------ */

const LEGEND_ROWS: { glyph: string; title: string; body: string }[] = [
  {
    glyph: '👤',
    title: 'People',
    body: 'Attendees your phone can currently hear over Bluetooth. They fade out when the signal stops.',
  },
  {
    glyph: '◎',
    title: 'Rings',
    body: 'Approximate distance — 3, 7 and 12 metres. This is the one thing actually measured, and it is a range, not a precise figure.',
  },
  {
    glyph: '👥',
    title: 'Numbered circles',
    body: 'A group standing close together. Tap one to spread its members out.',
  },
  {
    glyph: '🔦',
    title: 'The cone',
    body: 'Roughly which way you are facing, from the compass. It widens when the building interferes with the magnetometer.',
  },
  {
    glyph: '🧭',
    title: 'Direction to a person',
    body: 'Only shown in Find Me, and only once it has been worked out from how the signal changes as you turn and walk. If it does not know, it says so instead of guessing.',
  },
  {
    glyph: '🟢',
    title: 'Status ring',
    body: 'Green available · amber maybe · red busy. Invisible people do not appear at all.',
  },
  {
    glyph: '🛰',
    title: 'Satellite view',
    body:
      'Real overhead imagery of the venue, centred on the address the organiser published. It shows you the building — it does not place anyone on it. People stay on the distance rings, because Bluetooth measures how far away someone is and never which way.',
  },
  {
    glyph: '👆',
    title: 'Tap, or press and hold',
    body: 'Tap someone for a quick preview, tap ⓘ for their full profile, or press and hold to start walking to them.',
  },
];

export function MapLegendSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Sheet visible={visible} title="How this map works" onClose={onClose} maxHeightPercent={80}>
      <AppText variant="body" tone="secondary">
        This is a Bluetooth proximity radar, not a GPS map. It knows roughly how far away people
        are — not where they are standing.
      </AppText>

      {LEGEND_ROWS.map((row) => (
        <View key={row.title} style={styles.legendRow}>
          <AppText variant="title">{row.glyph}</AppText>
          <View style={styles.legendText}>
            <AppText variant="bodyStrong">{row.title}</AppText>
            <AppText variant="caption" tone="secondary">
              {row.body}
            </AppText>
          </View>
        </View>
      ))}

      <AppText variant="caption" tone="tertiary">
        Each person&apos;s position around the circle is a stable layout, not a measurement — it
        keeps them in the same place every time you open the app, but it does not mean they are in
        that direction. Distance is what the rings tell you.
      </AppText>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Nearby list — the non-spatial view of the same people
 * ------------------------------------------------------------------ */

export function NearbyListSheet({
  visible,
  people,
  onClose,
  onSelect,
  onNavigate,
}: {
  visible: boolean;
  people: NearbyPerson[];
  onClose: () => void;
  onSelect: (peerId: string) => void;
  onNavigate: (peerId: string) => void;
}): React.ReactElement {
  const { colors, name } = useTheme();

  // Nearest first: in a list, "who can I reach" is the only useful order.
  const sorted = useMemo(
    () => [...people].sort((a, b) => a.proximity.estimatedDistance - b.proximity.estimatedDistance),
    [people],
  );

  return (
    <Sheet
      visible={visible}
      title={`${people.length} ${people.length === 1 ? 'person' : 'people'} nearby`}
      subtitle="Closest first"
      onClose={onClose}
    >
      {sorted.length === 0 ? (
        <AppText variant="body" tone="secondary">
          Nobody in range yet. Move further into the event and people will appear.
        </AppText>
      ) : (
        sorted.map((person) => (
          <Pressable
            key={person.peerId}
            onPress={() => {
              onSelect(person.peerId);
              onClose();
            }}
            accessibilityRole="button"
            style={[styles.personRow, { borderBottomColor: colors.border }]}
          >
            <Avatar
              avatar={person.attendee?.profile.avatar}
              name={person.displayName}
              size="list"
              availability={person.availability}
              dimmed={person.fading}
            />
            <View style={styles.personText}>
              <View style={styles.personNameRow}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {person.displayName}
                </AppText>
                {person.isConnection ? (
                  <AppText variant="micro" tone="accent">
                    ✓
                  </AppText>
                ) : null}
              </View>
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                {person.subtitle ?? (person.resolved ? 'Attendee' : 'Looking them up…')}
              </AppText>
              <View style={styles.personMeta}>
                <SignalBars
                  band={person.proximity.band}
                  confidence={person.proximity.confidence}
                  size={10}
                />
                <AppText variant="micro" tone="tertiary">
                  {person.proximity.provisional
                    ? 'locating…'
                    : `${person.proximity.label} · ${person.proximity.rangeLabel}`}
                </AppText>
                <PresenceDot availability={person.availability} size={6} />
              </View>
            </View>
            <Pressable
              onPress={() => {
                onNavigate(person.peerId);
                onClose();
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Find ${person.displayName}`}
              style={[styles.findButton, { borderColor: colors.border }]}
            >
              <AppText variant="caption" tone="secondary">
                🧭
              </AppText>
            </Pressable>
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ *
 * Advanced filters
 * ------------------------------------------------------------------ */

interface ExperienceBand {
  label: string;
  min?: number;
  max?: number;
}

const EXPERIENCE_BANDS: ExperienceBand[] = [
  { label: '0–2 years', min: 0, max: 2 },
  { label: '3–5 years', min: 3, max: 5 },
  { label: '5+ years', min: 5 },
];

export function AdvancedFilterSheet({
  visible,
  filter,
  companies,
  skills,
  onClose,
  onApply,
}: {
  visible: boolean;
  filter: PeopleFilter;
  companies: string[];
  skills: string[];
  onClose: () => void;
  onApply: (filter: PeopleFilter) => void;
}): React.ReactElement {
  const { name } = useTheme();
  // Edited locally, committed on Apply — a filter sheet that mutates the map
  // under the user while they are still choosing is disorienting.
  const [draft, setDraft] = useState<PeopleFilter>(filter);

  React.useEffect(() => {
    if (visible) setDraft(filter);
  }, [visible, filter]);

  const toggle = <K extends 'categories' | 'companies' | 'skills'>(
    key: K,
    value: string,
  ): void => {
    const current = new Set((draft[key] as string[] | undefined) ?? []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    setDraft({ ...draft, [key]: current.size ? [...current] : undefined });
  };

  const selectedBand = EXPERIENCE_BANDS.find(
    (band) => band.min === draft.minExperience && band.max === draft.maxExperience,
  );

  const activeCount =
    (draft.categories?.length ?? 0) +
    (draft.companies?.length ?? 0) +
    (draft.skills?.length ?? 0) +
    (draft.availableOnly ? 1 : 0) +
    (draft.minExperience !== undefined ? 1 : 0);

  return (
    <Sheet
      visible={visible}
      title="Filter people"
      subtitle={activeCount === 0 ? 'No filters applied' : `${activeCount} active`}
      onClose={onClose}
      footer={
        <>
          <Button label="Clear all" variant="secondary" onPress={() => setDraft({})} full />
          <Button
            label="Apply"
            onPress={() => {
              onApply(draft);
              onClose();
            }}
            full
          />
        </>
      }
    >
      <Section title="Availability">
        <Chip
          label="Available now"
          selected={Boolean(draft.availableOnly)}
          onPress={() =>
            setDraft({ ...draft, availableOnly: draft.availableOnly ? undefined : true })
          }
        />
      </Section>

      <Section title="Role">
        {CATEGORY_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            color={categoryColor(option.value, name)}
            selected={draft.categories?.includes(option.value as PersonCategory)}
            onPress={() => toggle('categories', option.value)}
          />
        ))}
      </Section>

      <Section title="Experience">
        {EXPERIENCE_BANDS.map((band) => (
          <Chip
            key={band.label}
            label={band.label}
            selected={selectedBand?.label === band.label}
            onPress={() =>
              setDraft({
                ...draft,
                minExperience: selectedBand?.label === band.label ? undefined : band.min,
                maxExperience: selectedBand?.label === band.label ? undefined : band.max,
              })
            }
          />
        ))}
      </Section>

      {companies.length > 0 ? (
        <Section title="Company">
          {companies.map((company) => (
            <Chip
              key={company}
              label={company}
              selected={draft.companies?.includes(company)}
              onPress={() => toggle('companies', company)}
            />
          ))}
        </Section>
      ) : null}

      {skills.length > 0 ? (
        <Section title="Skills">
          {skills.map((skill) => (
            <Chip
              key={skill}
              label={skill}
              selected={draft.skills?.includes(skill)}
              onPress={() => toggle('skills', skill)}
            />
          ))}
        </Section>
      ) : null}

      <AppText variant="caption" tone="tertiary">
        Filters fade non-matching people rather than removing them — the map stays a picture of the
        room.
      </AppText>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.section}>
      <AppText variant="micro" tone="tertiary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </AppText>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  legendText: { flex: 1, gap: 2 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personText: { flex: 1, gap: 1 },
  personNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  personMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  findButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: space.sm, paddingTop: space.md },
  sectionTitle: { letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: { borderRadius: radius.pill },
});
