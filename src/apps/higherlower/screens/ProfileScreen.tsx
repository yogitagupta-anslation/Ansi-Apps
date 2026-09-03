import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import Button from '../components/Button';
import { ACHIEVEMENTS, averageGuesses, winRate } from '../game/progress';
import { useStats } from '../store/StatsProvider';
import { useSettings } from '../settings/SettingsProvider';
import { formatDuration } from '../util/format';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

/** Career page: the numbers you have racked up and the badges you have earned. */
export default function ProfileScreen({ onBack }: { onBack: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { stats, persistent, reset } = useStats();
  const { playerName } = useSettings();

  const dailyDays = Object.keys(stats.daily).length;

  return (
    <Screen title={playerName} subtitle="Profile" onBack={onBack} scroll>
      <View style={styles.grid}>
        <Stat label="Games played" value={String(stats.played)} />
        <Stat label="Wins" value={String(stats.wins)} />
        <Stat label="Win rate" value={`${winRate(stats)}%`} />
        <Stat label="Best time" value={stats.bestTimeMs === null ? '—' : formatDuration(stats.bestTimeMs)} />
        <Stat label="Best streak" value={String(stats.bestStreak)} />
        <Stat label="Average guesses" value={stats.played === 0 ? '—' : String(averageGuesses(stats))} />
        <Stat label="Rounds at par" value={String(stats.perfectRounds)} />
        <Stat label="Best score" value={String(stats.bestScore)} />
        <Stat label="Multiplayer wins" value={String(stats.multiplayerWins)} />
        <Stat label="Dailies played" value={String(dailyDays)} />
      </View>

      {stats.streak > 0 ? <Text style={styles.streak}>🔥 {stats.streak} in a row right now</Text> : null}

      <Text style={styles.sectionLabel}>ACHIEVEMENTS ({stats.unlocked.length}/{ACHIEVEMENTS.length})</Text>
      <View style={styles.badges}>
        {ACHIEVEMENTS.map((achievement) => {
          const earned = stats.unlocked.includes(achievement.id);
          return (
            <View key={achievement.id} style={[styles.badge, earned && styles.badgeOn]}>
              <Text style={[styles.badgeIcon, !earned && styles.badgeIconLocked]}>{achievement.icon}</Text>
              <View style={styles.badgeBody}>
                <Text style={[styles.badgeName, earned && styles.badgeNameOn]}>{achievement.name}</Text>
                <Text style={styles.badgeBlurb}>{achievement.blurb}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {!persistent ? (
        <Text style={styles.warning}>
          Storage is unavailable in this build, so these numbers last until the app closes. Rebuild the app to keep
          them.
        </Text>
      ) : null}

      <Button label="Reset profile" variant="secondary" icon="trash-outline" compact onPress={reset} style={styles.reset} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    width: '31.5%',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statValue: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 19,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 2,
  },
  streak: {
    ...fonts.label,
    color: colors.higher,
    fontSize: 12,
    marginTop: spacing.md,
  },
  sectionLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  badges: {
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    opacity: 0.55,
  },
  badgeOn: {
    opacity: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldTint,
  },
  badgeIcon: {
    fontSize: 20,
  },
  badgeIconLocked: {
    opacity: 0.5,
  },
  badgeBody: {
    flex: 1,
  },
  badgeName: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 12,
  },
  badgeNameOn: {
    color: colors.gold,
  },
  badgeBlurb: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  warning: {
    color: colors.higher,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.lg,
  },
  reset: {
    marginTop: spacing.lg,
    alignSelf: 'center',
  },
});
