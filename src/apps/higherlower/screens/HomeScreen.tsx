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
import { MAX_CAPACITY, MIN_CAPACITY } from '../ble/constants';
import { HIT_SLOP, MIN_TOUCH, Palette, elevation, radius, spacing, tabular, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface HomeScreenProps {
  onSolo: () => void;
  onMultiplayer: () => void;
  onDaily: () => void;
  onHowToPlay: () => void;
  onProfile: () => void;
  onSettings: () => void;
}

/**
 * The front door.
 *
 * The wordmark used to be two emoji arrows beside two words, which renders as a
 * different pair of pictures on every OS version and turns the app's identity
 * into a lottery. It is now drawn from the type and the palette the rest of the
 * app already uses: amber HIGHER above blue LOWER, with real chevrons.
 */
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
            <Ionicons name="chevron-up" size={26} color={colors.higher} />
            <Text style={styles.word}>HIGHER</Text>
          </View>
          <Text style={styles.or}>OR</Text>
          <View style={styles.wordRow}>
            <Ionicons name="chevron-down" size={26} color={colors.lower} />
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
            <View style={styles.dailyTitleRow}>
              <Ionicons name="sunny" size={14} color={colors.gold} />
              <Text style={styles.dailyTitle}>DAILY CHALLENGE</Text>
            </View>
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
            meta={`${MIN_CAPACITY}–${MAX_CAPACITY} players`}
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
          <View style={styles.record}>
            <Text style={styles.recordText}>
              {stats.played} played · {stats.wins} won
            </Text>
            {stats.streak > 1 ? (
              <View style={styles.streak}>
                <Ionicons name="flame" size={12} color={colors.higher} />
                <Text style={styles.streakText}>{stats.streak} streak</Text>
              </View>
            ) : null}
          </View>
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
      accessibilityLabel={`${title}. ${subtitle}. ${meta}`}
      style={({ pressed }) => [
        styles.card,
        elevation('raised', colors),
        pressed && styles.cardPressed,
      ]}
    >
      <View style={[styles.cardIcon, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
        <Text style={[styles.cardMetaText, { color: accent }]}>{meta}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
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
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
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
  word: {
    ...type.display,
    color: colors.higher,
    letterSpacing: 2,
  },
  wordLower: {
    color: colors.lower,
  },
  or: {
    ...type.label,
    color: colors.textMuted,
    marginVertical: spacing.xxs,
  },
  tagline: {
    ...type.sub,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  daily: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.goldTint,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    gap: spacing.xs,
  },
  dailyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dailyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dailyTitle: {
    ...type.label,
    color: colors.gold,
  },
  dailyDate: {
    ...type.numCaption,
    ...tabular,
    color: colors.textMuted,
  },
  dailyRange: {
    ...type.body,
    color: colors.textPrimary,
  },
  dailyMods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dailyMod: {
    ...type.caption,
    color: colors.textSecondary,
  },
  dailyFoot: {
    ...type.caption,
    color: colors.textMuted,
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
    backgroundColor: colors.card,
    borderWidth: 1,
    // The accent used to be the card's whole border, which made two static
    // panels look like two different states of the same control. The colour now
    // lives in the icon tile and the meta line, and the border is the neutral
    // one every other card uses.
    borderColor: colors.cardBorder,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.99 }],
  },
  pressed: {
    opacity: 0.6,
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  cardTitle: {
    ...type.heading,
    color: colors.textPrimary,
  },
  cardSubtitle: {
    ...type.caption,
    color: colors.textSecondary,
  },
  cardMetaText: {
    ...type.micro,
    marginTop: spacing.xxs,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.sm,
  },
  linkText: {
    ...type.caption,
    color: colors.textSecondary,
  },
  record: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recordText: {
    ...type.caption,
    color: colors.textMuted,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.higherTint,
  },
  streakText: {
    ...type.micro,
    color: colors.higher,
  },
});
