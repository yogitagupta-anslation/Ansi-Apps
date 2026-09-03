import React, {useCallback, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  FormRow,
  GameBackground,
  GameButton,
  type Option,
  Panel,
  Screen,
  ScreenHeader,
  Select,
  TextField,
  TreasureChest,
} from '../components';
import {useGame} from '../state/GameContext';
import {navigateAfterCommit} from '../utils/navigation';
import {ALL_GAME_MODES} from '../game/modes';
import {GAME_MODE_LABEL, GameMode} from '../models/game';
import {DEFAULT_GAME_CONFIG} from '../config/gameConfig';
import {colors, spacing} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateGame'>;

/** Landscape-shaped worlds; the value is the width, height is derived. */
const WORLD_SIZES: ReadonlyArray<Option<number>> = [
  {label: 'Small (60 x 34)', value: 60},
  {label: 'Medium (90 x 50)', value: 90},
  {label: 'Large (130 x 72)', value: 130},
  {label: 'Huge (180 x 100)', value: 180},
];

/** Keeps every world at roughly 16:9, like the screen it is played on. */
function worldHeightFor(width: number): number {
  return Math.round((width * 9) / 16);
}

const DURATIONS: ReadonlyArray<Option<number>> = [
  {label: '2 Minutes', value: 120},
  {label: '5 Minutes', value: 300},
  {label: '10 Minutes', value: 600},
  {label: 'No time limit', value: 0},
];

const PLAYER_COUNTS: ReadonlyArray<Option<number>> = [
  {label: '2 Players', value: 2},
  {label: '4 Players', value: 4},
  {label: '6 Players', value: 6},
  {label: '8 Players', value: 8},
];

const MODE_OPTIONS: ReadonlyArray<Option<GameMode>> = ALL_GAME_MODES.map(mode => ({
  label: GAME_MODE_LABEL[mode],
  value: mode,
}));

export function CreateGameScreen({navigation, route}: Props) {
  const solo = route.params?.solo ?? false;
  const {manager, profile, pushToast} = useGame();

  const [name, setName] = useState('My Treasure Hunt');
  const [worldSize, setWorldSize] = useState(90);
  const [durationSec, setDurationSec] = useState(600);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [mode, setMode] = useState<GameMode>(GameMode.SharedTreasure);
  const [busy, setBusy] = useState(false);

  const config = useMemo(
    () => ({
      ...DEFAULT_GAME_CONFIG,
      mode,
      durationSec,
      maxPlayers,
      worldSize: {width: worldSize, height: worldHeightFor(worldSize)},
      // Keep density sensible as the world scales, based on actual area.
      obstacleCount: Math.round((worldSize * worldHeightFor(worldSize)) / 240),
      coinCount: Math.round((worldSize * worldHeightFor(worldSize)) / 300),
      gemCount: Math.max(2, Math.round((worldSize * worldHeightFor(worldSize)) / 1600)),
      powerUpCount: Math.max(3, Math.round((worldSize * worldHeightFor(worldSize)) / 900)),
      minTreasureSpawnDistance: Math.round(worldSize * 0.3),
    }),
    [mode, durationSec, maxPlayers, worldSize],
  );

  const start = useCallback(async () => {
    if (!profile) {
      return;
    }
    setBusy(true);
    try {
      if (solo) {
        await manager.startSoloGame(config, {name: profile.name, avatar: profile.avatar});
        navigateAfterCommit(() => navigation.replace('Loading'));
      } else {
        await manager.createGame(config, {name: profile.name, avatar: profile.avatar});
        navigateAfterCommit(() => navigation.replace('Lobby'));
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not start the hunt.');
      setBusy(false);
    }
  }, [config, manager, navigation, profile, pushToast, solo]);

  return (
    <Screen>
      <GameBackground variant="lobby">
        <ScreenHeader
          title={solo ? 'Solo Practice' : 'Create Game'}
          onBack={() => navigation.goBack()}
        />

        <ScrollView
          removeClippedSubviews={false}
          style={styles.scrollFlex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* Two columns, so the whole form fits a landscape screen without
              scrolling and the action stays in view. */}
          <View style={styles.columns}>
          <Panel style={styles.column}>
            <FormRow label="Game Name" icon="📜" iconColor={colors.gold}>
              <TextField
                value={name}
                onChangeText={setName}
                placeholder="My Treasure Hunt"
                maxLength={24}
              />
            </FormRow>

            <FormRow label="World Size" icon="🗺" iconColor={colors.crystal}>
              <Select
                value={worldSize}
                options={WORLD_SIZES}
                onChange={setWorldSize}
                accessibilityLabel="World size"
              />
            </FormRow>

            <FormRow label="Game Duration" icon="⏳" iconColor={colors.amber}>
              <Select
                value={durationSec}
                options={DURATIONS}
                onChange={setDurationSec}
                accessibilityLabel="Game duration"
              />
            </FormRow>
          </Panel>

          <View style={styles.column}>
          <Panel>
            {!solo ? (
              <FormRow label="Max Players" icon="🛡" iconColor={colors.blue}>
                <Select
                  value={maxPlayers}
                  options={PLAYER_COUNTS}
                  onChange={setMaxPlayers}
                  accessibilityLabel="Max players"
                />
              </FormRow>
            ) : null}

            <FormRow
              label="Treasure Type"
              iconNode={<TreasureChest size={26} />}
              iconColor={colors.orange}>
              <Select
                value={mode}
                options={MODE_OPTIONS}
                onChange={setMode}
                accessibilityLabel="Treasure type"
              />
            </FormRow>
          </Panel>

          <GameButton
            label={solo ? 'Start Practice' : 'Create Game'}
            tone="gold"
            size="md"
            loading={busy}
            onPress={start}
            style={styles.cta}
          />
          </View>
          </View>
        </ScrollView>

      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  column: {
    flex: 1,
    gap: spacing.md,
  },
  cta: {
    alignSelf: 'stretch',
  },
  /**
   * Actions live at the end of the scroll content, not in a pinned bar.
   * A short landscape screen has no room for a permanent footer, and a pinned
   * one clipped the last button against the gesture bar.
   */
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  action: {
    flex: 1,
    maxWidth: 260,
  },
  scrollFlex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    width: '100%',
    maxWidth: 900,
    alignSelf: 'center',
  },
});
