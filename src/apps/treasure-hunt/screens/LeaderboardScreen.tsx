import React, {useMemo, useState} from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {
  GameBackground,
  Screen,
  ScreenHeader,
  StandingRow,
  Tabs,
} from '../components';
import {useGame} from '../state/GameContext';
import {colors, spacing} from '../theme';
import type {RootStackParamList} from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Leaderboard'>;

type SortMode = 'score' | 'treasure';

export function LeaderboardScreen({navigation}: Props) {
  const {manager, players, state} = useGame();
  const [sort, setSort] = useState<SortMode>('score');

  const rows = useMemo(() => {
    const base = manager.scores.buildLeaderboard(players, state.localPlayerId);
    if (sort === 'score') {
      return base;
    }
    // Treasure view: finders first, then by score, re-ranked.
    return base
      .slice()
      .sort((a, b) => {
        if (a.foundTreasure !== b.foundTreasure) {
          return a.foundTreasure ? -1 : 1;
        }
        return b.score - a.score;
      })
      .map((row, index) => ({...row, rank: index + 1}));
  }, [manager, players, state.localPlayerId, sort]);

  return (
    <Screen>
      <GameBackground variant="results">
        <ScreenHeader title="Leaderboard" onBack={() => navigation.goBack()} />

        <View style={styles.body}>
          <Tabs
            tabs={[
              {label: 'SCORE', value: 'score' as SortMode},
              {label: 'TREASURE', value: 'treasure' as SortMode},
            ]}
            value={sort}
            onChange={setSort}
          />

          <ScrollView
          removeClippedSubviews={false}
          style={styles.scrollFlex}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}>
            {rows.length === 0 ? (
              <Text style={styles.empty}>No hunters scored yet.</Text>
            ) : (
              rows.map(row => <StandingRow key={row.playerId} row={row} />)
            )}
          </ScrollView>

          <Text style={styles.footnote}>⚡ Scores update in real-time</Text>
        </View>
      </GameBackground>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollFlex: {
    flex: 1,
  },
  body: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.md,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  list: {
    paddingBottom: spacing.lg,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    paddingVertical: spacing.xxl,
  },
  footnote: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.cyan,
  },
});
