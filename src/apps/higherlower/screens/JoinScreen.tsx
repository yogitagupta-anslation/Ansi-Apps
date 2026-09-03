import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Screen from '../components/Screen';
import SignalBars from '../components/SignalBars';
import BleStatusBadge from '../components/BleStatusBadge';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { DiscoveredRoom } from '../ble/transport';
import { signalFor } from '../ble/signal';
import { plural } from '../util/format';
import { Palette, fonts, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface JoinScreenProps {
  onBack: () => void;
  onJoined: () => void;
}

export default function JoinScreen({ onBack, onJoined }: JoinScreenProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { scan, joinRoom, state, players } = useBle();
  const [rooms, setRooms] = useState<DiscoveredRoom[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => scan(setRooms), [scan]);

  const join = async (room: DiscoveredRoom) => {
    setJoiningId(room.id);
    try {
      await joinRoom(room);
      onJoined();
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Screen
      title="Nearby games"
      subtitle="Games advertising within Bluetooth range"
      onBack={onBack}
      headerRight={<BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />}
      scroll
    >
      {rooms.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.emptyTitle}>Listening for hosts…</Text>
          <Text style={styles.emptyBody}>
            Make sure the host has tapped "Host a game" and is standing within about ten metres.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              onPress={() => join(room)}
              disabled={joiningId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Join ${room.hostName}'s game, code ${room.code}`}
              style={({ pressed }) => [styles.room, pressed && styles.roomPressed, joiningId === room.id && styles.roomBusy]}
            >
              <View style={styles.roomIcon}>
                <Text style={styles.roomCode}>{room.code}</Text>
              </View>
              <View style={styles.roomBody}>
                <Text style={styles.roomHost}>{room.hostName}'s game</Text>
                <Text style={styles.roomMeta}>
                  {plural(room.players, 'player')} · {signalFor(room.rssi).label}
                </Text>
              </View>
              {joiningId === room.id ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <View style={styles.roomRight}>
                  <SignalBars rssi={room.rssi} />
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </View>
              )}
            </Pressable>
          ))}
          <Text style={styles.scanning}>Still scanning…</Text>
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    ...fonts.label,
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  list: {
    gap: spacing.sm,
  },
  room: {
    flexDirection: 'row',
    alignItems: 'center',
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
  roomIcon: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
  },
  roomCode: {
    ...fonts.numeric,
    color: colors.accent,
    fontSize: 15,
    letterSpacing: 1,
  },
  roomBody: {
    flex: 1,
  },
  roomHost: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  roomMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  roomRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
