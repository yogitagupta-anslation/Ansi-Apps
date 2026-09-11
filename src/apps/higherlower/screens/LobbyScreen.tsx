import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import Button from '../components/Button';
import Stepper from '../components/Stepper';
import BleStatusBadge from '../components/BleStatusBadge';
import ModifierPicker from '../components/ModifierPicker';
import SegmentedControl from '../components/SegmentedControl';
import OptionGrid from '../components/OptionGrid';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { MAX_CAPACITY, MIN_CAPACITY } from '../ble/constants';
import { useSettings } from '../settings/SettingsProvider';
import { parGuesses } from '../game/engine';
import { modifierById, multiplayerSafe } from '../game/modifiers';
import { RaceMode } from '../types/game';
import { plural } from '../util/format';
import { MIN_TOUCH, Palette, radius, spacing, tabular, type } from '../theme/tokens';
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
  const {
    room,
    role,
    players,
    state,
    capacity,
    full,
    error,
    setCapacity,
    setReady,
    setPlaying,
    leaveRoom,
    onMessage,
  } = useBle();
  const { range, mode, setMode, modifiers, toggleModifierId, matchRounds, setMatchRounds, setMaxPlayers } =
    useSettings();

  const isHost = role === 'host';
  const you = players.find((p) => p.isYou);
  // The room's range is whatever the host opened it with; ours only applies if
  // we are the one hosting.
  const roundRange = room?.range ?? range;
  const shared = multiplayerSafe(modifiers);
  const readyCount = players.filter((p) => p.ready).length;
  const waiting = players.filter((p) => !p.isYou && !p.ready);

  // Back in the lobby the door opens again: a round that has finished should
  // not keep a friend who arrived late standing outside.
  useEffect(() => {
    if (isHost) setPlaying(false);
  }, [isHost, setPlaying]);

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

  const changeCapacity = (next: number) => {
    setCapacity(next);
    setMaxPlayers(next); // so the next room you host opens the same size
  };

  const start = () => {
    // Shut the door before the round opens: a phone that connects mid-race
    // would have no target and nothing to guess at.
    setPlaying(true);
    onStart();
  };

  const enoughPlayers = players.length >= 2;
  const startLabel = !enoughPlayers
    ? 'Waiting for players…'
    : waiting.length > 0
      ? `Start anyway (${waiting.length} not ready)`
      : 'Start game';

  return (
    <Screen
      title={isHost ? 'Your game' : `${room?.hostName ?? 'Host'}'s game`}
      subtitle={isHost ? 'Set the rules, then start' : 'Waiting for the host to start'}
      onBack={leave}
      headerRight={<BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />}
      footer={
        isHost ? (
          <Button label={startLabel} icon="play" onPress={start} disabled={!enoughPlayers} />
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
          {isHost
            ? 'Read this out — the others type it on their Join screen'
            : 'You are connected to this room'}
        </Text>
      </View>

      {error ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.rosterHeader}>
        <Text style={styles.sectionLabel}>PLAYERS</Text>
        <Text style={styles.sectionMeta}>
          {players.length} / {capacity} here · {readyCount} ready
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
            {player.isHost ? (
              <Text style={styles.waitingText}>holds the start</Text>
            ) : player.ready ? (
              <View style={styles.readyPill}>
                <Ionicons name="checkmark" size={12} color={colors.correct} />
                <Text style={styles.readyText}>READY</Text>
              </View>
            ) : (
              <Text style={styles.waitingText}>waiting</Text>
            )}
          </View>
        ))}

        {full ? (
          <View style={[styles.player, styles.slot]}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
            <Text style={styles.slotText}>Room is full — nobody else can join</Text>
          </View>
        ) : (
          <View style={[styles.player, styles.slot]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.slotText}>
              Listening for {plural(capacity - players.length, 'more phone')}…
            </Text>
          </View>
        )}
      </View>

      {isHost ? (
        <>
          <Stepper
            label="Room size"
            hint="How many phones may join, yours included"
            value={capacity}
            min={Math.max(MIN_CAPACITY, players.length)}
            max={MAX_CAPACITY}
            onChange={changeCapacity}
            display={`${players.length} / ${capacity}`}
          />

          <Text style={[styles.sectionLabel, styles.spacedLabel]}>MODE</Text>
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
            Room size, range, mode and modifiers are all theirs. The rules arrive with the round — you will see them on
            the board.
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
              The range was fixed from Settings when you opened the room, and travels to every player with the round.
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
    ...type.label,
    color: colors.textMuted,
  },
  code: {
    ...type.numDisplay,
    ...tabular,
    color: colors.accent,
    letterSpacing: 10,
    // Tracking is applied after the last glyph too, so nudge the block right by
    // one space to keep it optically centred.
    marginLeft: 10,
    marginTop: spacing.xxs,
  },
  codeHint: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    marginBottom: spacing.md,
  },
  errorText: {
    ...type.caption,
    color: colors.textSecondary,
    flex: 1,
  },
  rosterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  spacedLabel: {
    marginTop: spacing.md,
  },
  sectionMeta: {
    ...type.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  roster: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH + spacing.sm,
    gap: spacing.md,
    padding: spacing.md,
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
    ...type.body,
    color: colors.textSecondary,
  },
  initialYou: {
    color: colors.accent,
  },
  playerBody: {
    flex: 1,
  },
  playerName: {
    ...type.body,
    color: colors.textPrimary,
  },
  playerRole: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  readyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.correctTint,
    borderWidth: 1,
    borderColor: colors.correctBorder,
  },
  readyText: {
    ...type.micro,
    color: colors.correct,
  },
  waitingText: {
    ...type.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  slot: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  slotText: {
    ...type.caption,
    color: colors.textMuted,
    flex: 1,
  },
  settings: {
    gap: spacing.sm,
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
    ...type.caption,
    color: colors.textSecondary,
  },
  settingValue: {
    ...type.numCaption,
    ...tabular,
    color: colors.textPrimary,
  },
  settingNote: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
