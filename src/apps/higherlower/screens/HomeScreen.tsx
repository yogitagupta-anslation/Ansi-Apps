import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import { RANGE_PRESETS, formatRange, useSettings } from '../settings/SettingsProvider';
import { AI_PROFILES } from '../game/ai';
import { dailyChallenge, dailyKey } from '../game/daily';
import { modifierById } from '../game/modifiers';
import { useStats } from '../store/StatsProvider';
import { formatDuration, plural } from '../util/format';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface HomeScreenProps {
  onSolo: () => void;
  onMultiplayer: () => void;
  onDaily: () => void;
  onHowToPlay: () => void;
  onProfile: () => void;
  onSettings: () => void;
}

export default function HomeScreen({
  onSolo,
  onMultiplayer,
  onDaily,
  onHowToPlay,
  onProfile,
  onSettings,
}: HomeScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { rangeId, difficulty, modifiers } = useSettings();
  const { stats } = useStats();

  const preset = RANGE_PRESETS.find((p) => p.id === rangeId) ?? RANGE_PRESETS[1];
  const today = useMemo(() => dailyChallenge(dailyKey()), []);
  const todaysBest = stats.daily[today.key];

  return (
    <Screen scroll>
      <View style={styles.body}>
        <View style={styles.brand}>
          <View style={styles.wordRow}>
            <Text style={styles.arrow}>⬆️</Text>
            <Text style={styles.word}>HIGHER</Text>
          </View>
          <Text style={styles.or}>or</Text>
          <View style={styles.wordRow}>
            <Text style={styles.arrow}>⬇️</Text>
            <Text style={[styles.word, styles.wordLower]}>LOWER</Text>
          </View>
          <Text style={styles.tagline}>One hidden number. Fewest guesses wins.</Text>
        </View>

        <Pressable
          onPress={onDaily}
          accessibilityRole="button"
          accessibilityLabel={`Daily challenge. ${today.rangeLabel}, ${formatRange(today.range)}`}
          style={({ pressed }) => [styles.daily, pressed && styles.pressed]}
        >
          <View style={styles.dailyHead}>
            <Text style={styles.dailyTitle}>☀️ DAILY CHALLENGE</Text>
            <Text style={styles.dailyDate}>{today.key}</Text>
          </View>
          <Text style={styles.dailyRange}>
            {today.rangeLabel} · {formatRange(today.range)} · par {today.par}
          </Text>
          <View style={styles.dailyMods}>
            {today.modifiers.length === 0 ? (
              <Text style={styles.dailyMod}>No twists today</Text>
            ) : (
              today.modifiers.map((id) => (
                <Text key={id} style={styles.dailyMod}>
                  {modifierById(id).icon} {modifierById(id).name}
                </Text>
              ))
            )}
          </View>
          <Text style={styles.dailyFoot}>
            {todaysBest
              ? `Your best today: ${todaysBest.score} pts · ${plural(todaysBest.guesses, 'guess')} · ${formatDuration(todaysBest.ms)}`
              : 'Everyone gets the same number today.'}
          </Text>
        </Pressable>

        <View style={styles.modes}>
          <ModeCard
            icon="hardware-chip-outline"
            title="Solo"
            subtitle={`Race ${AI_PROFILES[difficulty].name} for the same number`}
            meta={`${preset.label}${modifiers.length ? ` · ${modifiers.length} mod` : ''}`}
            onPress={onSolo}
            accent={colors.accent}
          />
          <ModeCard
            icon="bluetooth-outline"
            title="Multiplayer"
            subtitle="Nearby phones race over Bluetooth"
            meta="2–4 players"
            onPress={onMultiplayer}
            accent={colors.correct}
          />
        </View>

        <View style={styles.links}>
          <LinkButton icon="help-circle-outline" label="How to play" onPress={onHowToPlay} />
          <LinkButton icon="person-circle-outline" label="Profile" onPress={onProfile} />
          <LinkButton icon="options-outline" label="Settings" onPress={onSettings} />
        </View>

        {stats.played > 0 ? (
          <Text style={styles.record}>
            {stats.played} played · {stats.wins} won
            {stats.streak > 1 ? ` · 🔥 ${stats.streak} streak` : ''}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function ModeCard({
  icon,
  title,
  subtitle,
  meta,
  accent,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  meta: string;
  accent: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.card, { borderColor: accent }, pressed && styles.pressed]}
    >
      <View style={[styles.cardIcon, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.cardMeta}>
        <Text style={[styles.cardMetaText, { color: accent }]}>{meta}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

function LinkButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.lg,
  },
  brand: {
    alignItems: 'center',
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  arrow: {
    fontSize: 22,
  },
  word: {
    ...fonts.title,
    color: colors.higher,
    fontSize: 40,
    letterSpacing: 2,
  },
  wordLower: {
    color: colors.lower,
  },
  or: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 13,
    marginVertical: 2,
  },
  tagline: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  daily: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.goldTint,
    borderWidth: 1,
    borderColor: colors.gold,
    gap: 4,
  },
  dailyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dailyTitle: {
    ...fonts.label,
    color: colors.gold,
    fontSize: 12,
  },
  dailyDate: {
    ...fonts.numeric,
    color: colors.textMuted,
    fontSize: 10,
  },
  dailyRange: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  dailyMods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  dailyMod: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  dailyFoot: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  modes: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    ...fonts.title,
    color: colors.textPrimary,
    fontSize: 18,
  },
  cardSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  cardMeta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  cardMetaText: {
    ...fonts.label,
    fontSize: 11,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.sm,
    paddingHorizontal: 6,
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  record: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
});
