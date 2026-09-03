import React, {useCallback, useEffect, useState} from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  GameButton,
  GameCodeCard,
  PlayersFrame,
  RosterEmptyRow,
  RosterRow,
  Screen,
  ScreenHeader,
  StatusLine,
} from '../components';
import {useGame} from '../state/GameContext';
import {GamePhase} from '../models/game';
import {createLogger} from '../utils/logger';
import {navigateAfterCommit} from '../utils/navigation';
import {BleAdapterState, BleLinkState} from '../ble/BleTypes';
import {colors, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

const log = createLogger('LobbyScreen');

type Props = NativeStackScreenProps<RootStackParamList, 'Lobby'>;

export function LobbyScreen({navigation}: Props) {
  const {manager, state, players, adapterState, linkState, pushToast} = useGame();
  const [starting, setStarting] = useState(false);

  const isHost = manager.isHost;
  const capacity = state.config.maxPlayers;

  /**
   * Leave the lobby when the MATCH says so, not when a button is pressed.
   *
   * The host used to navigate inline in `start()`, so only the device that
   * tapped Start ever reached the game. A joining player's engine received
   * GAME_START and moved to COUNTDOWN, but nothing here acted on it and the
   * player sat in the lobby forever. Both roles now follow the same rule:
   * the synchronised phase is what opens the game.
   */
  useEffect(() => {
    if (state.phase === GamePhase.Countdown || state.phase === GamePhase.Playing) {
      log.info(`phase ${state.phase} -> opening GameScreen`);
      navigateAfterCommit(() => navigation.replace('Game'));
    }
  }, [state.phase, navigation]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      // Navigation is handled by the phase effect above, for host and player
      // alike -- do not navigate here or the host takes a different path.
      await manager.startMatch();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not start.');
      setStarting(false);
    }
  }, [manager, pushToast]);

  const leave = useCallback(async () => {
    await manager.leaveGame();
    navigation.popToTop();
  }, [manager, navigation]);

  const statusLabel = (() => {
    if (isHost) {
      return manager.bleManager?.isAdvertising
        ? 'BLE Advertising...'
        : adapterState === BleAdapterState.PoweredOn
          ? 'BLE Ready'
          : 'Bluetooth Off';
    }
    return linkState === BleLinkState.Connected
      ? 'Connected to Host'
      : linkState === BleLinkState.Reconnecting
        ? 'Reconnecting...'
        : 'Linking...';
  })();

  const statusColor = (() => {
    if (adapterState !== BleAdapterState.PoweredOn) {
      return colors.warning;
    }
    if (!isHost && linkState === BleLinkState.Reconnecting) {
      return colors.warning;
    }
    return colors.cyan;
  })();

  return (
    <Screen>
      <GameBackground variant="lobby">
        <ScreenHeader
          title="Lobby"
          onBack={leave}
          rightGlyph={isHost ? '👑' : undefined}
        />

        {/* Two columns: the code and its status on the left, the roster on the
            right. Stacked vertically there is no room for the player list on a
            short landscape screen. */}
        <View style={styles.columns}>
          <View style={styles.codeColumn}>
            <GameCodeCard
              code={state.gameCode || '----'}
              caption={
                isHost
                  ? 'Share this code with your friends'
                  : 'Waiting for host to start...'
              }
            />
            <StatusLine label={statusLabel} color={statusColor} />
            {!isHost ? (
              <Text style={styles.hostHint}>❄ Host will start the game soon...</Text>
            ) : null}
          </View>

          <PlayersFrame style={styles.rosterColumn}>
            <View style={styles.rosterHeader}>
              <Image
                source={require('../assets/icon-players.png')}
                style={styles.rosterBadge}
                resizeMode="contain"
                fadeDuration={0}
              />
              <Text style={typography.sectionLabel}>
                Players ({players.length}/{capacity})
              </Text>
            </View>
            {/* Android clips off-screen children by default, and its
                re-parenting threw "The specified child already has a parent"
                when the roster changed. These lists are a handful of rows. */}
            <ScrollView
              removeClippedSubviews={false}
              style={styles.rosterScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.rosterList}>
              {players.map(player => (
                <RosterRow
                  key={player.id}
                  player={player}
                  isLocal={player.id === state.localPlayerId}
                />
              ))}

              {/* Painted empty seats, so the roster shows the room's capacity
                  rather than trailing off. */}
              {Array.from({length: Math.max(0, capacity - players.length)}, (_, i) => (
                <RosterEmptyRow key={`seat-${i}`} />
              ))}

              {isHost && players.length < 2 ? (
                <Text style={styles.waitingText}>
                  📡 Broadcasting over Bluetooth — waiting for hunters to join.
                </Text>
              ) : null}
            </ScrollView>
          </PlayersFrame>
        </View>

        <View style={styles.footer}>
          {isHost ? (
            <GameButton
              label="Start Hunt"
              tone="green"
              loading={starting}
              disabled={players.length < 1}
              onPress={start}
              style={styles.footerPrimary}
            />
          ) : null}
          <GameButton
            label="Leave Lobby"
            tone="dark"
            size="md"
            onPress={leave}
            style={styles.footerSecondary}
          />
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rosterScroll: {
    flex: 1,
  },
  rosterList: {
    gap: 6,
    paddingBottom: spacing.sm,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  codeColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  rosterColumn: {
    flex: 1.2,
    gap: spacing.sm,
  },
  rosterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  rosterBadge: {
    width: 17,
    height: 17.5,
  },
  waitingText: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  hostHint: {
    textAlign: 'center',
    color: colors.cyan,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  footerPrimary: {
    flex: 2,
  },
  footerSecondary: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },
});
