import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {LeaderboardRow} from '../game/ScoreManager';
import {TreasureChest} from './TreasureChest';
import {alpha, colors, radius, spacing} from '../theme';

const MEDAL_COLOR = [colors.medalGold, colors.medalSilver, colors.medalBronze];

/** Two-up segmented control, e.g. SCORE / TREASURE. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{label: string; value: T}>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {tabs.map(tab => {
        const active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{selected: active}}
            onPress={() => onChange(tab.value)}
            style={[styles.tab, active && styles.tabActive]}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A ranked standings row with a medal badge for the top three. */
export function StandingRow({
  row,
  showTreasure = true,
}: {
  row: LeaderboardRow;
  showTreasure?: boolean;
}) {
  const medal = MEDAL_COLOR[row.rank - 1];

  return (
    <View style={[styles.row, row.isLocal && styles.rowLocal]}>
      <View
        style={[
          styles.rankBadge,
          medal
            ? {backgroundColor: alpha(medal, 0.25), borderColor: medal}
            : styles.rankBadgePlain,
        ]}>
        <Text style={[styles.rankText, medal ? {color: medal} : null]}>{row.rank}</Text>
      </View>

      <Text style={styles.avatar}>{row.avatar}</Text>

      <Text style={styles.name} numberOfLines={1}>
        {row.name}
        {row.isLocal ? <Text style={styles.you}> (You)</Text> : null}
      </Text>

      <Text style={styles.score}>{row.score}</Text>

      {showTreasure ? (
        <TreasureChest size={22} dimmed={!row.foundTreasure} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.gold,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.goldInk,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    // Translucent, so the forest behind the panel still reads through.
    backgroundColor: alpha(colors.night, 0.7),
    borderWidth: 1,
    borderColor: alpha(colors.stoneLight, 0.3),
    marginBottom: spacing.sm,
  },
  rowLocal: {
    backgroundColor: alpha(colors.blueDeep, 0.24),
    borderColor: alpha(colors.cyan, 0.7),
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  rankBadgePlain: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.hairline,
  },
  rankText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.textDim,
  },
  avatar: {
    fontSize: 20,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  you: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.cyan,
  },
  score: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
  },
});
