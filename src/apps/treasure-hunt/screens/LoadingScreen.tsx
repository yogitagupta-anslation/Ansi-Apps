import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  FantasyPanel,
  GameBackground,
  ProgressBar,
  Screen,
  TreasureChest,
} from '../components';
import {useGame} from '../state/GameContext';
import {GamePhase} from '../models/game';
import {alpha, colors, spacing, typography} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Loading'>;

/**
 * The "generating world" interstitial.
 *
 * World generation itself is near-instant, so this is a deliberate beat that
 * covers the countdown and gives the match a sense of occasion. It advances to
 * the game as soon as the engine reports PLAYING.
 */
export function LoadingScreen({navigation}: Props) {
  const {state, countdown} = useGame();
  const [progress, setProgress] = useState(0.08);
  const float = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    bob.start();
    const shimmer = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {toValue: 1, duration: 900, useNativeDriver: true}),
        Animated.timing(glow, {toValue: 0, duration: 900, useNativeDriver: true}),
      ]),
    );
    shimmer.start();
    return () => {
      bob.stop();
      shimmer.stop();
    };
  }, [float, glow]);

  // Creep the bar forward; it completes when the countdown finishes.
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(current => Math.min(0.96, current + 0.06));
    }, 180);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state.phase === GamePhase.Playing) {
      navigation.replace('Game');
    }
  }, [state.phase, navigation]);

  const translateY = float.interpolate({inputRange: [0, 1], outputRange: [0, -12]});
  const glowOpacity = glow.interpolate({inputRange: [0, 1], outputRange: [0.2, 0.55]});

  return (
    <Screen background={colors.abyss}>
      <GameBackground variant="loading">
        <View style={styles.body}>
          {/* Left: the chest, breathing on its own lantern light. */}
          <View style={styles.chestWrap}>
            <Animated.View style={[styles.chestGlow, {opacity: glowOpacity}]} />
            <Animated.View style={{transform: [{translateY}]}}>
              <TreasureChest size={120} />
            </Animated.View>
          </View>

          {/* Right: title and the progress plaque. */}
          <View style={styles.column}>
            <Text style={styles.title}>TREASURE HUNT</Text>
            <Text style={styles.subtitle}>
              The forest is waking. Ready yourself.
            </Text>

            <FantasyPanel tone="gold" style={styles.plaque} bodyStyle={styles.plaqueBody}>
              <View style={styles.progressRow}>
                <Text style={styles.progressLabel} numberOfLines={1}>
                  {countdown !== null
                    ? `Starting in ${countdown}...`
                    : 'Generating world...'}
                </Text>
                <Text style={styles.progressPercent}>
                  {countdown !== null ? '100%' : `${Math.round(progress * 100)}%`}
                </Text>
              </View>
              <ProgressBar progress={countdown !== null ? 1 : progress} />
            </FantasyPanel>
          </View>
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.xxl,
  },
  chestWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chestGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.amber,
  },
  column: {
    flex: 1,
    maxWidth: 340,
    gap: spacing.sm,
  },
  title: {
    ...typography.hero,
    fontSize: 26,
    color: colors.gold,
  },
  subtitle: {
    ...typography.bodyMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  plaque: {
    marginTop: spacing.md,
  },
  plaqueBody: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    ...typography.fieldLabel,
    flex: 1,
    fontSize: 11,
    color: alpha(colors.text, 0.85),
  },
  progressPercent: {
    ...typography.fieldLabel,
    fontSize: 11,
    color: colors.gold,
  },
});
