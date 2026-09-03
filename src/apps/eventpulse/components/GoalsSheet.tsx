/**
 * GoalsSheet — "what brings you here?"
 *
 * Asked once, on the way into an event, and editable afterwards from your own
 * profile. It is the shortest question in the app and the one that changes the
 * most: without it every recommendation is a guess assembled from tags, and
 * with it the app can answer "who should I talk to" instead of "who is nearby".
 *
 * Two deliberate choices:
 *
 *  - **Skippable, always.** A wall between someone and the room they are
 *    standing in is a bad trade for better matching. Skipping costs them
 *    personalisation, not access.
 *  - **A closed list, not free text.** See `NetworkingGoals` — free text reads
 *    better and matches worse, and this field exists to be matched on.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { NetworkingGoal } from '../types';
import { GOAL_OPTIONS } from '../recommendations/NetworkingGoals';
import { haptics } from '../runtime/haptics';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Sheet } from './Sheet';
import { AppText, Button } from './primitives';

/** More than this and the goals stop discriminating between people. */
const MAX_GOALS = 3;

export function GoalsSheet({
  visible,
  goals,
  onClose,
  onSave,
}: {
  visible: boolean;
  goals: readonly NetworkingGoal[];
  onClose: () => void;
  onSave: (goals: NetworkingGoal[]) => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<NetworkingGoal[]>([...goals]);

  useEffect(() => {
    if (visible) setDraft([...goals]);
  }, [visible, goals]);

  const toggle = (goal: NetworkingGoal): void => {
    haptics.select();
    setDraft((current) => {
      if (current.includes(goal)) return current.filter((value) => value !== goal);
      // "Just explore" is a statement that you do not want to be filtered, so it
      // cannot coexist with a specific goal without contradicting itself.
      if (goal === 'just_explore') return ['just_explore'];
      const without = current.filter((value) => value !== 'just_explore');
      if (without.length >= MAX_GOALS) return without;
      return [...without, goal];
    });
  };

  const full = draft.length >= MAX_GOALS && !draft.includes('just_explore');

  return (
    <Sheet
      visible={visible}
      title="What brings you here?"
      subtitle={`Pick up to ${MAX_GOALS} — this is what the app matches people against`}
      onClose={onClose}
      maxHeightPercent={88}
      footer={
        <>
          <Button label="Skip" variant="secondary" onPress={onClose} full />
          <Button
            label={draft.length ? 'Save goals' : 'Save'}
            onPress={() => {
              haptics.success();
              onSave(draft);
              onClose();
            }}
            full
          />
        </>
      }
    >
      {GOAL_OPTIONS.map((option) => {
        const selected = draft.includes(option.value);
        // Greyed rather than hidden once the cap is reached: a disappearing
        // option reads as a bug, a dimmed one reads as a limit.
        const reachable = selected || !full || option.value === 'just_explore';

        return (
          <Pressable
            key={option.value}
            onPress={() => (reachable ? toggle(option.value) : undefined)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled: !reachable }}
            accessibilityLabel={`${option.label}. ${option.detail}`}
            style={[
              styles.row,
              {
                borderColor: selected ? colors.accent : colors.border,
                backgroundColor: selected ? colors.accentSoft : 'transparent',
                opacity: reachable ? 1 : 0.4,
              },
            ]}
          >
            <AppText variant="title">{option.emoji}</AppText>
            <View style={styles.rowText}>
              <AppText variant="bodyStrong" tone={selected ? 'accent' : 'primary'}>
                {option.label}
              </AppText>
              <AppText variant="caption" tone="tertiary">
                {option.detail}
              </AppText>
            </View>
            <View
              style={[
                styles.check,
                {
                  borderColor: selected ? colors.accent : colors.borderStrong,
                  backgroundColor: selected ? colors.accent : 'transparent',
                },
              ]}
            >
              {selected ? (
                <AppText variant="micro" tone="inverse">
                  ✓
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      <AppText variant="caption" tone="tertiary" style={styles.footnote}>
        Your goals are used on this device to rank who to show you. They are not shown to other
        attendees.
      </AppText>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  rowText: { flex: 1, gap: 2 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { paddingTop: space.sm },
});
