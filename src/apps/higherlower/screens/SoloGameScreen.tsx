import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import GuessBoard from '../components/GuessBoard';
import Stopwatch from '../components/Stopwatch';
import { useSoloRace } from '../game/useSoloRace';
import { summarize } from '../game/raceState';
import { useSettings } from '../settings/SettingsProvider';
import { feedback } from '../util/feedback';
import { Range, RoundSummary } from '../types/game';
import { ModifierId, rulesSummary } from '../game/modifiers';
import { Palette, fonts, spacing } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';

interface SoloGameScreenProps {
  onQuit: () => void;
  onFinish: (summary: RoundSummary, youId: string) => void;
  /** Today's fixed challenge, when this round is the daily. */
  challenge?: { range: Range; target: number; modifiers: ModifierId[] } | null;
}

/** Beat between the CORRECT banner landing and the results screen taking over. */
const RESULT_DELAY_MS = 1500;

export default function SoloGameScreen({ onQuit, onFinish, challenge }: SoloGameScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const settings = useSettings();
  const { difficulty, playerName } = settings;
  // A daily challenge overrides the picked range and modifiers for that round.
  const range = challenge?.range ?? settings.range;
  const modifiers = challenge?.modifiers ?? settings.modifiers;
  const { race, you, aiQuip, start, guess, end, youId } = useSoloRace({
    range,
    difficulty,
    playerName,
    modifiers,
    fixedTarget: challenge?.target,
  });
  const [entry, setEntry] = useState('');

  useEffect(start, [start]);

  // A short rise as the number is hidden, so the round has a starting gun.
  useEffect(() => {
    if (race.status === 'running') feedback.roundStart();
  }, [race.startedAt]);

  // Feedback for each new verdict of yours, and once when the race ends.
  const seenGuesses = useRef(0);
  useEffect(() => {
    const count = you?.guesses.length ?? 0;
    if (count === seenGuesses.current) return;
    seenGuesses.current = count;
    const last = you?.guesses[count - 1];
    if (!last) return;
    feedback.verdict(last.verdict);
  }, [you?.guesses]);

  useEffect(() => {
    if (race.status !== 'finished') return;
    if (you?.eliminated) feedback.eliminated();
    else if (race.winnerId === youId) feedback.win();
    else feedback.lose();
    const timer = setTimeout(() => onFinish(summarize(race), youId), RESULT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [race, youId, onFinish]);

  const submit = (wagered: boolean) => {
    const value = Number(entry);
    if (!Number.isFinite(value)) return;
    guess(value, wagered);
    setEntry('');
  };

  const lastGuess = you?.guesses[you.guesses.length - 1] ?? null;

  return (
    <Screen
      title={challenge ? 'Daily challenge' : 'Solo race'}
      subtitle={rulesSummary(range, modifiers)}
      onBack={onQuit}
      headerRight={
        <View style={styles.headerRight}>
          <Stopwatch startedAt={race.startedAt} running={race.status === 'running'} />
          <Text style={styles.headerLabel}>ELAPSED</Text>
        </View>
      }
    >
      {race.status === 'idle' ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Hiding a number…</Text>
        </View>
      ) : (
        <GuessBoard
          race={race}
          youId={youId}
          entry={entry}
          onEntryChange={setEntry}
          onSubmit={submit}
          lastVerdict={lastGuess?.verdict ?? null}
          verdictNonce={you?.guesses.length ?? 0}
          onSkipWait={end}
          opponentNote={aiQuip}
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  headerRight: {
    alignItems: 'flex-end',
  },
  headerLabel: {
    ...fonts.label,
    color: colors.textMuted,
    fontSize: 9,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
