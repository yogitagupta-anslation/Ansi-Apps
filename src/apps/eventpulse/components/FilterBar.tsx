/**
 * FilterBar — narrowing the map without emptying it.
 *
 * One decision worth explaining: filtering does **not** remove people from the
 * map. Non-matching nodes fade back rather than disappearing, because the map
 * is a picture of the room and people do not stop existing when you filter for
 * recruiters. It also keeps the spatial layout stable, so turning a filter on
 * and off does not rearrange the world.
 *
 * Discover, which is a list rather than a picture, does filter destructively.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { PeopleFilter, PersonCategory } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { categoryColor, space } from '../theme/tokens';
import { AppText, Chip } from './primitives';

export interface CategoryOption {
  value: PersonCategory;
  label: string;
}

export const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { value: 'engineer', label: 'Engineers' },
  { value: 'data', label: 'ML & Data' },
  { value: 'product', label: 'Product' },
  { value: 'design', label: 'Design' },
  { value: 'founder', label: 'Founders' },
  { value: 'investor', label: 'Investors' },
  { value: 'recruiter', label: 'Recruiters' },
  { value: 'student', label: 'Students' },
  { value: 'speaker', label: 'Speakers' },
  { value: 'mentor', label: 'Mentors' },
];

export function FilterBar({
  filter,
  onChange,
  matchCount,
  totalCount,
  availableCount,
  matchesNearbyCount,
  onShowMatches,
  matchesOnly,
  onOpenAdvanced,
}: {
  filter: PeopleFilter;
  onChange: (filter: PeopleFilter) => void;
  matchCount: number;
  totalCount: number;
  /**
   * How many people are currently open to being approached, and how many the
   * matcher vouched for.
   *
   * The design puts a number on every chip — "All 7 / Matches 4 / Free now 5" —
   * and it changes what the row is for. Without counts a chip is a gamble: you
   * tap it to find out whether it leads anywhere. With them the row is a
   * summary of the room you can read without tapping anything at all.
   */
  availableCount?: number;
  matchesNearbyCount?: number;
  /** Selects only the people the matcher ranked. */
  onShowMatches?: () => void;
  matchesOnly?: boolean;
  onOpenAdvanced?: () => void;
}): React.ReactElement {
  const { name } = useTheme();
  const selected = new Set(filter.categories ?? []);
  const everyone =
    selected.size === 0 &&
    !filter.availableOnly &&
    !filter.companies?.length &&
    !filter.skills?.length &&
    filter.minExperience === undefined;

  // Filters that the chip row cannot express, surfaced as a count on the gear.
  const advancedCount =
    (filter.companies?.length ?? 0) +
    (filter.skills?.length ?? 0) +
    (filter.minExperience !== undefined ? 1 : 0);

  const toggleCategory = (category: PersonCategory): void => {
    const next = new Set(selected);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    onChange({ ...filter, categories: next.size ? [...next] : undefined });
  };

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <Chip
          label={totalCount > 0 ? `All  ${totalCount}` : 'All'}
          selected={everyone && !matchesOnly}
          onPress={() => onChange({})}
        />
        {onShowMatches ? (
          <Chip
            label={
              matchesNearbyCount !== undefined ? `Matches  ${matchesNearbyCount}` : 'Matches'
            }
            selected={Boolean(matchesOnly)}
            onPress={onShowMatches}
          />
        ) : null}
        <Chip
          label={availableCount !== undefined ? `Free now  ${availableCount}` : 'Free now'}
          selected={Boolean(filter.availableOnly)}
          onPress={() => onChange({ ...filter, availableOnly: filter.availableOnly ? undefined : true })}
        />
        {CATEGORY_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={selected.has(option.value)}
            color={categoryColor(option.value, name)}
            onPress={() => toggleCategory(option.value)}
          />
        ))}
        {onOpenAdvanced ? (
          <Chip
            label={advancedCount > 0 ? `⚙ ${advancedCount}` : '⚙ More'}
            selected={advancedCount > 0}
            onPress={onOpenAdvanced}
          />
        ) : null}
      </ScrollView>

      {!everyone ? (
        <View style={styles.summary}>
          <AppText variant="caption" tone="secondary">
            {matchCount === 0
              ? `Nobody nearby matches — showing all ${totalCount}`
              : `${matchCount} of ${totalCount} nearby match`}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Does this person survive the filter? Mirrors `AttendeeDirectory.search`. */
export function matchesPersonFilter(
  filter: PeopleFilter,
  person: { category: string | null; availability: string; attendee: { profile: { company?: string; skills: string[]; interests: string[]; experienceYears?: number } } | null },
): boolean {
  if (filter.categories?.length) {
    if (!person.category || !filter.categories.includes(person.category as PersonCategory)) {
      return false;
    }
  }
  if (filter.availableOnly && person.availability !== 'available') return false;

  const profile = person.attendee?.profile;
  if (filter.companies?.length) {
    const company = profile?.company?.toLowerCase() ?? '';
    if (!filter.companies.some((value) => company === value.toLowerCase())) return false;
  }
  if (filter.skills?.length) {
    const skills = (profile?.skills ?? []).map((value) => value.toLowerCase());
    if (!filter.skills.some((value) => skills.includes(value.toLowerCase()))) return false;
  }
  if (filter.interests?.length) {
    const interests = (profile?.interests ?? []).map((value) => value.toLowerCase());
    if (!filter.interests.some((value) => interests.includes(value.toLowerCase()))) return false;
  }
  if (filter.minExperience !== undefined) {
    if ((profile?.experienceYears ?? 0) < filter.minExperience) return false;
  }
  return true;
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  summary: { paddingHorizontal: space.lg, paddingBottom: space.sm },
});
