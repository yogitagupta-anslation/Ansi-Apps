import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import Button from '../components/Button';
import BleStatusBadge from '../components/BleStatusBadge';
import ModifierPicker from '../components/ModifierPicker';
import SegmentedControl from '../components/SegmentedControl';
import OptionGrid from '../components/OptionGrid';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { useSettings } from '../settings/SettingsProvider';
import { parGuesses } from '../game/engine';
import { modifierById, multiplayerSafe } from '../game/modifiers';
import { RaceMode } from '../types/game';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

export interface IncomingRound {
  rid: string;
  lo: number;
  hi: number;
  tg: number;
  /** Race mode chosen by the host. */
  md?: string;
  /** Modifier ids the host switched on. */
  mf?: string[];
}

interface LobbyScreenProps {
  onLeave: () => void;
  /** Host taps start; the round itself is created on the game screen. */
  onStart: () => void;
  /** A 'go' arrived from the host — join the round it describes. */
  onRoundStarted: (round: IncomingRound) => void;
}

const MODES: { value: RaceMode; label: string; hint: string }[] = [
  { value: 'speed', label: 'Speed', hint: 'First correct guess wins' },
  { value: 'efficiency', label: 'Fewest', hint: 'Fewest guesses, time breaks ties' },
  { value: 'elimination', label: 'Survival', hint: 'Par guesses each, then you are out' },
  { value: 'sudden', label: 'Sudden death', hint: 'One guess each — closest wins' },
];

export default function LobbyScreen({ onLeave, onStart, onRoundStarted }: LobbyScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { room, role, players, state, allReady, setReady, leaveRoom, onMessage } = useBle();
  const { range, mode, setMode, modifiers, toggleModifierId, matchRounds, setMatchRounds } = useSettings();

  const isHost = role === 'host';
  const you = players.find((p) => p.isYou);
  // The room's range is whatever the host advertised; ours only applies if we
  // are the one hosting.
  const roundRange = room?.range ?? range;
  const shared = multiplayerSafe(modifiers);
  const readyCount = players.filter((p) => p.ready).length;

  // Clients follow the host into the round the moment 'go' lands.
  useEffect(() => {
    if (isHost) return;
    return onMessage((msg) => {
      if (msg.t === 'go') {
        onRoundStarted({ rid: msg.rid, lo: msg.lo, hi: msg.hi, tg: msg.tg, md: msg.md, mf: msg.mf });
      }
    });
  }, [isHost, onMessage, onRoundStarted]);

  const leave = async () => {
    await leaveRoom();
    onLeave();
  };

  const enoughPlayers = players.length >= 2;

  return (
    <Screen
      title={isHost ? 'Your game' : `${room?.hostName ?? 'Host'}'s game`}
      subtitle={isHost ? 'Set the rules, then start' : 'Waiting for the host to start'}
      onBack={leave}
      headerRight={<BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />}
      footer={
        isHost ? (
          <Button
            label={enoughPlayers ? 'Start game' : 'Waiting for players…'}
            icon="play"
            onPress={onStart}
            disabled={!enoughPlayers || !allReady}
          />
        ) : (
          <Button
            label={you?.ready ? 'Ready — waiting for host' : "I'm ready"}
            icon={you?.ready ? 'checkmark-circle' : 'hand-right-outline'}
            variant={you?.ready ? 'success' : 'primary'}
            onPress={() => setReady(!you?.ready)}
          />
        )
      }
      scroll
    >
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>ROOM CODE</Text>
        <Text style={styles.code}>{room?.code ?? '––––'}</Text>
        <Text style={styles.codeHint}>
          {isHost ? 'Nearby players will see this in their scan list' : 'You are connected to this room'}
        </Text>
      </View>

      <View style={styles.rosterHeader}>
        <Text style={styles.sectionLabel}>PLAYERS</Text>
        <Text style={styles.sectionMeta}>
          {readyCount} / {players.length} ready
        </Text>
      </View>

      <View style={styles.roster}>
        {players.map((player) => (
          <View key={player.id} style={styles.player}>
            <View style={[styles.avatar, player.isYou && styles.avatarYou]}>
              <Text style={[styles.initial, player.isYou && styles.initialYou]}>
                {player.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.playerBody}>
              <Text style={styles.playerName}>
                {player.name}
                {player.isYou ? ' (you)' : ''}
              </Text>
              <Text style={styles.playerRole}>{player.isHost ? 'Host' : 'Player'}</Text>
            </View>
            {player.ready ? (
              <View style={styles.readyPill}>
                <Ionicons name="checkmark" size={12} color={colors.correct} />
                <Text style={styles.readyText}>READY</Text>
              </View>
            ) : (
              <Text style={styles.waitingText}>waiting</Text>
            )}
          </View>
        ))}

        {players.length < 4 ? (
          <View style={[styles.player, styles.slot]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.slotText}>Listening for more phones…</Text>
          </View>
        ) : null}
      </View>

      {isHost ? (
        <>
          <Text style={styles.sectionLabel}>MODE</Text>
          <OptionGrid
            options={MODES.map((m) => ({ value: m.value, title: m.label, subtitle: m.hint }))}
            value={mode}
            onChange={setMode}
          />

          <Text style={[styles.sectionLabel, styles.spacedLabel]}>ROUNDS</Text>
          <SegmentedControl
            segments={[
              { value: '1', label: 'Single', hint: 'one round' },
              { value: '3', label: 'Best of 3', hint: 'first to 2' },
            ]}
            value={String(matchRounds)}
            onChange={(v) => setMatchRounds(Number(v))}
          />

          <Text style={[styles.sectionLabel, styles.spacedLabel]}>MODIFIERS</Text>
          <ModifierPicker active={modifiers} onToggle={toggleModifierId} allowSoloOnly={false} />
        </>
      ) : (
        <View style={styles.settings}>
          <Text style={styles.sectionLabel}>THE HOST DECIDES</Text>
          <Text style={styles.settingNote}>
            Range, mode and modifiers arrive with the round — you will see them on the board.
          </Text>
        </View>
      )}

      <View style={styles.settings}>
        <Text style={styles.sectionLabel}>ROUND</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingKey}>Range</Text>
          <Text style={styles.settingValue}>
            {roundRange.min.toLocaleString('en-US')} – {roundRange.max.toLocaleString('en-US')}
          </Text>
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingKey}>Par</Text>
          <Text style={styles.settingValue}>{parGuesses(roundRange)} guesses</Text>
        </View>
        {isHost ? (
          <>
            <View style={styles.settingRow}>
              <Text style={styles.settingKey}>Mode</Text>
              <Text style={styles.settingValue}>{MODES.find((m) => m.value === mode)?.label}</Text>
            </View>
            <View style={styles.settingRow}>
              <Text style={styles.settingKey}>Modifiers</Text>
              <Text style={styles.settingValue}>
                {shared.length === 0 ? 'none' : shared.map((id) => modifierById(id).icon).join(' ')}
              </Text>
            </View>
            <Text style={styles.settingNote}>
              Your range comes from Settings and is sent to every player when the round starts.
            </Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  codeCard: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
    marginBottom: spacing.md,
  },
  codeLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
  },
  code: {
    ...fonts.numeric,
    color: colors.accent,
    fontSize: 42,
    letterSpacing: 8,
    marginTop: 2,
    marginLeft: 8,
  },
  codeHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: spacing.xs,
  },
  rosterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: spacing.sm,
  },
  spacedLabel: {
    marginTop: spacing.md,
  },
  sectionMeta: {
    color: colors.textMuted,
    fontSize: 10,
    marginBottom: spacing.sm,
  },
  roster: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  avatarYou: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  initial: {
    ...fonts.title,
    color: colors.textSecondary,
    fontSize: 14,
  },
  initialYou: {
    color: colors.accent,
  },
  playerBody: {
    flex: 1,
  },
  playerName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  playerRole: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.correctTint,
    borderWidth: 1,
    borderColor: colors.correctBorder,
  },
  readyText: {
    ...fonts.label,
    color: colors.correct,
    fontSize: 9,
  },
  waitingText: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
  },
  slot: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  slotText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  settings: {
    gap: 6,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    marginTop: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  settingKey: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  settingValue: {
    ...fonts.numeric,
    color: colors.textPrimary,
    fontSize: 13,
  },
  settingNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
