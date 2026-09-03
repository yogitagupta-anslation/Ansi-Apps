import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  Confetti,
  GameButton,
  Ribbon,
  Screen,
  StandingRow,
  TreasureChest,
} from '../components';
import {useGame} from '../state/GameContext';
import {GamePhase} from '../models/game';
import {navigateAfterCommit} from '../utils/navigation';
import {alpha, colors, radius, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Results'>;

export function ResultsScreen({navigation}: Props) {
  const {manager, state, players, lastResult, pushToast} = useGame();
  const [busy, setBusy] = useState(false);
  const chestScale = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const rows = useMemo(
    () => manager.scores.buildLeaderboard(players, state.localPlayerId),
    [manager, players, state.localPlayerId],
  );

  const winner = rows[0];
  const localWon = winner?.playerId === state.localPlayerId;
  const solo = state.gameCode === 'SOLO';
  const someoneFound = rows.some(row => row.foundTreasure);

  useEffect(() => {
    Animated.spring(chestScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 8,
      bounciness: 14,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [chestScale, glow]);

  const glowOpacity = glow.interpolate({inputRange: [0, 1], outputRange: [0.18, 0.5]});

  /**
   * Follow the match back to the lobby, for host and player alike.
   *
   * A rematch used to be a purely local affair: the host navigated itself here
   * and told nobody, so players stayed on this screen with a FINISHED engine
   * and missed the next GAME_START entirely. The host now broadcasts
   * LOBBY_STATE, and both roles react to the same synchronised phase.
   */
  useEffect(() => {
    if (state.phase === GamePhase.Lobby) {
      navigateAfterCommit(() => navigation.replace('Lobby'));
    }
  }, [state.phase, navigation]);

  const playAgain = useCallback(async () => {
    setBusy(true);
    try {
      if (solo) {
        navigateAfterCommit(() => navigation.replace('CreateGame', {solo: true}));
        return;
      }
      if (manager.isHost) {
        // Navigation is handled by the phase effect above -- playAgain() moves
        // the engine to LOBBY, and every device follows that, not this tap.
        await manager.playAgain();
      } else {
        // A player waiting out the rematch may go back and watch the lobby,
        // but it is the host's LOBBY_STATE that resets the engine.
        navigation.replace('Lobby');
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not restart.');
      setBusy(false);
    }
  }, [manager, navigation, pushToast, solo]);

  const goHome = useCallback(async () => {
    await manager.leaveGame();
    navigation.popToTop();
  }, [manager, navigation]);

  return (
    <Screen>
      <GameBackground variant="results">
        <View style={styles.ribbonRow}>
          <Ribbon label={someoneFound ? 'Treasure Found!' : 'Hunt Complete'} />
        </View>

        {/* Celebration on the left, the numbers on the right. Stacked, the hero
            chest alone would fill a short landscape screen. */}
        <View style={styles.columns}>
          <View style={styles.heroColumn}>
            <View style={styles.chestWrap}>
              <Confetti />
              <Animated.View style={[styles.chestGlow, {opacity: glowOpacity}]} />
              <Animated.View style={{transform: [{scale: chestScale}]}}>
                <TreasureChest size={84} />
              </Animated.View>
            </View>

            <Text style={styles.congrats}>
              {localWon ? 'Congratulations!' : someoneFound ? 'Congratulations!' : 'Time!'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {winner
                ? someoneFound
                  ? `${winner.name} found the treasure!`
                  : `${winner.name} finished on top.`
                : 'Nobody found the treasure this time.'}
            </Text>

            {winner ? (
              <View style={styles.winnerCard}>
                <Text style={styles.trophy}>🏆</Text>
                <View style={styles.winnerText}>
                  <Text style={typography.sectionLabel}>Winner</Text>
                  <Text style={styles.winnerName} numberOfLines={1}>
                    {winner.name}
                  </Text>
                </View>
                <Text style={styles.winnerScore}>{winner.score}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.standingsColumn}>
            <Text style={[typography.sectionLabel, styles.standingsTitle]}>
              Final Standings
            </Text>
            <ScrollView
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}>
              {rows.map(row => (
                <StandingRow key={row.playerId} row={row} />
              ))}
            </ScrollView>

            {lastResult ? (
              <View style={styles.metaRow}>
                <Meta label="Mode" value={lastResult.mode.replace(/_/g, ' ')} />
                <Meta label="Duration" value={`${lastResult.durationSec}s`} />
                <Meta label="Hunters" value={String(lastResult.standings.length)} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.footer}>
          <GameButton
            label={solo ? 'Hunt Again' : manager.isHost ? 'Play Again' : 'Back to Lobby'}
            tone="gold"
            loading={busy}
            onPress={playAgain}
            style={styles.footerButton}
          />
          <GameButton
            label="Back to Home"
            tone="blue"
            onPress={goHome}
            style={styles.footerButton}
          />
        </View>
      </GameBackground>
    </Screen>
  );
}

function Meta({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.meta}>
      <Text style={typography.sectionLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ribbonRow: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  columns: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  heroColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  standingsColumn: {
    flex: 1.1,
    paddingTop: spacing.xs,
  },
  chestWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 96,
    width: '100%',
  },
  chestGlow: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.gold,
  },
  congrats: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.gold,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  winnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: alpha(colors.gold, 0.6),
    backgroundColor: alpha(colors.gold, 0.1),
  },
  trophy: {
    fontSize: 22,
  },
  winnerText: {
    flex: 1,
    gap: 2,
  },
  winnerName: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  winnerScore: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.gold,
  },
  standingsTitle: {
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  meta: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    textTransform: 'capitalize',
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  footerButton: {
    flex: 1,
  },
});
