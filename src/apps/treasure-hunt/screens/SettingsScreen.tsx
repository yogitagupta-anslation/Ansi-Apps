import React, {useCallback, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  GameButton,
  Panel,
  Screen,
  ScreenHeader,
  TextField,
} from '../components';
import {useGame} from '../state/GameContext';
import {AVATARS, type Avatar} from '../models/player';
import {clearHistory, computeStats, loadHistory} from '../storage';
import {alpha, colors, radius, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export function SettingsScreen({navigation}: Props) {
  const {profile, updateProfile, pushToast} = useGame();
  const [name, setName] = useState(profile?.name ?? '');
  const [stats, setStats] = useState({matchesPlayed: 0, wins: 0, bestScore: 0});

  React.useEffect(() => {
    if (!profile) {
      return;
    }
    let cancelled = false;
    void loadHistory().then(history => {
      if (!cancelled) {
        setStats(computeStats(history, profile.name));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const commitName = useCallback(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setName(profile?.name ?? '');
      return;
    }
    void updateProfile({name: trimmed.slice(0, 18)});
  }, [name, profile, updateProfile]);

  const wipeHistory = useCallback(async () => {
    await clearHistory();
    setStats({matchesPlayed: 0, wins: 0, bestScore: 0});
    pushToast('info', 'Match history cleared.');
  }, [pushToast]);

  if (!profile) {
    return (
      <Screen>
        <GameBackground variant="popup">
          <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
        </GameBackground>
      </Screen>
    );
  }

  return (
    <Screen>
      <GameBackground variant="popup">
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView
          removeClippedSubviews={false}
        style={styles.scrollFlex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Three columns: a landscape screen is wide and short, so stacking
            every panel would turn this into a long scroll for very little
            content. Split this way nothing scrolls at all. */}
        <View style={styles.columns}>
        <View style={styles.column}>
        <Panel>
          <Text style={typography.fieldLabel}>Hunter Name</Text>
          <View style={styles.field}>
            <TextField
              value={name}
              onChangeText={setName}
              onCommit={commitName}
              placeholder="Your name"
              maxLength={18}
            />
          </View>

          <Text style={[typography.fieldLabel, styles.spaced]}>Avatar</Text>
          <View style={styles.avatarGrid}>
            {AVATARS.map(avatar => {
              const selected = avatar === profile.avatar;
              return (
                <Pressable
                  key={avatar}
                  accessibilityRole="radio"
                  accessibilityState={{selected}}
                  accessibilityLabel={`Avatar ${avatar}`}
                  onPress={() => void updateProfile({avatar: avatar as Avatar})}
                  style={[styles.avatarCell, selected && styles.avatarCellOn]}>
                  <Text style={styles.avatarGlyph}>{avatar}</Text>
                </Pressable>
              );
            })}
          </View>
        </Panel>

        <View style={styles.actions}>
          <GameButton
            label="Clear History"
            tone="dark"
            size="md"
            onPress={wipeHistory}
            style={styles.action}
          />
          <GameButton
            label="Done"
            tone="gold"
            size="md"
            onPress={() => navigation.goBack()}
            style={styles.action}
          />
        </View>
        </View>

        <View style={styles.column}>
        <Panel>
          <Text style={typography.fieldLabel}>Controls</Text>
          <ToggleRow
            title="Replay the movement tip"
            blurb="Shows the drag-to-move coach mark again next time you play."
            value={!profile.hasMovedOnce}
            onToggle={() => void updateProfile({hasMovedOnce: !profile.hasMovedOnce})}
          />
          <ToggleRow
            title="Haptics"
            blurb="Vibrate on pickups and treasure finds."
            value={profile.hapticsEnabled}
            onToggle={() => void updateProfile({hapticsEnabled: !profile.hapticsEnabled})}
          />
          <ToggleRow
            title="Sound"
            blurb="Audio cues during the hunt."
            value={profile.soundEnabled}
            onToggle={() => void updateProfile({soundEnabled: !profile.soundEnabled})}
          />
        </Panel>

        </View>

        <View style={styles.column}>
        <Panel>
          <Text style={typography.fieldLabel}>Your Record</Text>
          <View style={styles.statsRow}>
            <Stat label="Hunts" value={stats.matchesPlayed} />
            <Stat label="Wins" value={stats.wins} tint={colors.gold} />
            <Stat label="Best" value={stats.bestScore} tint={colors.cyan} />
          </View>
        </Panel>

        <Panel accent={colors.cyan}>
          <Text style={typography.fieldLabel}>About</Text>
          <Text style={styles.about}>
            Treasure Hunt is fully offline. The world, the treasure and every
            position are virtual coordinates generated on-device — no GPS, no
            maps, no server. Bluetooth only carries messages between phones.
          </Text>
        </Panel>
        </View>
        </View>
      </ScrollView>
      </GameBackground>
    </Screen>
  );
}

function Stat({label, value, tint = colors.text}: {label: string; value: number; tint?: string}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, {color: tint}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ToggleRow({
  title,
  blurb,
  value,
  onToggle,
}: {
  title: string;
  blurb: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      onPress={onToggle}
      style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.blurb}>{blurb}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  column: {
    flex: 1,
    gap: spacing.md,
  },
  /**
   * Actions live at the end of the scroll content, not in a pinned bar.
   * A short landscape screen has no room for a permanent footer, and a pinned
   * one clipped the last button against the gesture bar.
   */
  actions: {
    gap: spacing.sm,
  },
  action: {
    alignSelf: 'stretch',
  },
  scrollFlex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  field: {
    marginTop: spacing.sm,
  },
  spaced: {
    marginTop: spacing.lg,
  },
  avatarGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing.sm,
  },
  avatarCell: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceRaised,
  },
  avatarCellOn: {
    borderColor: colors.gold,
    backgroundColor: alpha(colors.gold, 0.18),
  },
  avatarGlyph: {
    fontSize: 21,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  toggleText: {
    flex: 1,
    gap: 3,
  },
  toggleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  blurb: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  switch: {
    width: 50,
    height: 29,
    borderRadius: 15,
    padding: 3,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.hairline,
    justifyContent: 'center',
  },
  switchOn: {
    backgroundColor: alpha(colors.green, 0.35),
    borderColor: colors.green,
  },
  knob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: colors.textFaint,
  },
  knobOn: {
    backgroundColor: colors.greenBright,
    alignSelf: 'flex-end',
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  about: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
