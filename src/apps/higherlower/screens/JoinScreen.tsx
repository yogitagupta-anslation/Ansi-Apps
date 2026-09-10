import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import SignalBars from '../components/SignalBars';
import BleStatusBadge from '../components/BleStatusBadge';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { normalizeCode } from '../ble/advertisement';
import { DiscoveredRoom } from '../ble/transport';
import { signalFor } from '../ble/signal';
import { MIN_TOUCH, Palette, radius, spacing, tabular, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface JoinScreenProps {
  onBack: () => void;
  onJoined: () => void;
}

const CODE_LENGTH = 4;

/**
 * Two ways in, because a room is found two ways in practice: someone reads the
 * code out, or you are standing next to them and just pick their name off the
 * list. Typing a code does not skip the scan -- BLE has no directory to look a
 * room up in, so the code is a filter over what the radio can already hear.
 */
export default function JoinScreen({ onBack, onJoined }: JoinScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { scan, joinRoom, state, players, error, clearError } = useBle();
  const [rooms, setRooms] = useState<DiscoveredRoom[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const autoJoined = useRef(false);

  useEffect(() => scan(setRooms), [scan]);

  const join = useCallback(
    async (room: DiscoveredRoom) => {
      setJoiningId(room.id);
      setJoinError(null);
      clearError();
      try {
        await joinRoom(room);
        onJoined();
      } catch (err) {
        // Deliberately leaves autoJoined set: retrying every time the scan
        // ticks would hammer a room that just refused us. Editing the code
        // clears it, and the row below is still one tap away.
        setJoinError(err instanceof Error ? err.message : 'Could not join that room.');
      } finally {
        setJoiningId(null);
      }
    },
    [clearError, joinRoom, onJoined],
  );

  const typed = normalizeCode(code);
  const match = useMemo(
    () => (typed.length === CODE_LENGTH ? rooms.find((r) => r.code === typed) ?? null : null),
    [rooms, typed],
  );

  // A complete code that matches something in range goes straight in: having
  // typed it, there is nothing left to decide.
  useEffect(() => {
    if (!match || autoJoined.current || joiningId !== null || match.full) return;
    autoJoined.current = true;
    void join(match);
  }, [join, joiningId, match]);

  const visible = typed.length > 0 ? rooms.filter((r) => r.code.startsWith(typed)) : rooms;
  const problem = joinError ?? error;

  return (
    <Screen
      title="Join a game"
      subtitle="Type the host's code, or pick their room below"
      onBack={onBack}
      headerRight={<BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />}
      scroll
    >
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>ROOM CODE</Text>
        <TextInput
          value={typed}
          onChangeText={(next) => {
            autoJoined.current = false;
            setCode(normalizeCode(next));
          }}
          placeholder="––––"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          keyboardType="visible-password"
          accessibilityLabel="Room code"
          style={styles.codeInput}
        />
        <Text style={styles.codeHint}>
          {typed.length === CODE_LENGTH && !match
            ? 'No room with that code in range yet — keep it typed and it will join as soon as it is heard.'
            : 'Four letters, on the host’s screen'}
        </Text>
      </View>

      {problem ? (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{problem}</Text>
        </View>
      ) : null}

      {visible.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.emptyTitle}>Listening for hosts…</Text>
          <Text style={styles.emptyBody}>
            Make sure the host has tapped "Host a game" and is standing within about ten metres.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visible.map((room) => {
            const blocked = room.full || room.playing;
            return (
              <Pressable
                key={room.id}
                onPress={() => join(room)}
                disabled={joiningId !== null || blocked}
                accessibilityRole="button"
                accessibilityState={{ disabled: blocked }}
                accessibilityLabel={`Join ${room.hostName ?? 'a'} game, code ${room.code}`}
                style={({ pressed }) => [
                  styles.room,
                  pressed && !blocked && styles.roomPressed,
                  joiningId === room.id && styles.roomBusy,
                  blocked && styles.roomBlocked,
                ]}
              >
                <View style={styles.roomIcon}>
                  <Text style={styles.roomCode}>{room.code}</Text>
                </View>
                <View style={styles.roomBody}>
                  <Text style={styles.roomHost}>
                    {room.hostName ? `${room.hostName}'s game` : 'Nearby game'}
                  </Text>
                  <Text style={styles.roomMeta}>
                    {room.players}/{room.capacity} players · {signalFor(room.rssi).label}
                  </Text>
                </View>
                {joiningId === room.id ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : blocked ? (
                  <Text style={styles.blockedTag}>{room.playing ? 'IN PLAY' : 'FULL'}</Text>
                ) : (
                  <View style={styles.roomRight}>
                    <SignalBars rssi={room.rssi} />
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                )}
              </Pressable>
            );
          })}
          <Text style={styles.scanning}>Still scanning…</Text>
        </View>
      )}
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
  codeInput: {
    ...type.numDisplay,
    ...tabular,
    // See SettingsScreen: a lineHeight on a TextInput misaligns the text and the
    // caret on Android.
    lineHeight: undefined,
    color: colors.accent,
    letterSpacing: 10,
    // The tracking is applied to the right of every glyph including the last,
    // so the field sits visually left of centre without this compensation.
    marginLeft: 10,
    marginTop: spacing.xxs,
    paddingVertical: spacing.xs,
    minWidth: 200,
    textAlign: 'center',
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
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    ...type.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  emptyBody: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    gap: spacing.sm,
  },
  room: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH + spacing.md,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  roomPressed: {
    opacity: 0.7,
  },
  roomBusy: {
    borderColor: colors.accent,
  },
  roomBlocked: {
    opacity: 0.5,
  },
  roomIcon: {
    paddingHorizontal: spacing.sm + spacing.xxs,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
  },
  roomCode: {
    ...type.numBody,
    ...tabular,
    color: colors.accent,
    letterSpacing: 1,
  },
  roomBody: {
    flex: 1,
  },
  roomHost: {
    ...type.body,
    color: colors.textPrimary,
  },
  roomMeta: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: spacing.xxs,
  },
  roomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  blockedTag: {
    ...type.micro,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.wash,
    overflow: 'hidden',
  },
  scanning: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
