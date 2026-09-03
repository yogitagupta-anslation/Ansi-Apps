import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import GuessBoard from '../components/GuessBoard';
import Stopwatch from '../components/Stopwatch';
import BleStatusBadge from '../components/BleStatusBadge';
import { IncomingReaction, ReactionBar, ReactionStream } from '../components/Reactions';
import { bleStatusLabel, useBle } from '../ble/BleProvider';
import { emptyRace, raceReducer, RacerSeed, summarize } from '../game/raceState';
import { makeTarget } from '../game/engine';
import { multiplayerSafe, parseModifierIds, resolveRules, rulesSummary } from '../game/modifiers';
import { RaceMode } from '../types/game';
import { useSettings } from '../settings/SettingsProvider';
import { feedback } from '../util/feedback';
import { RoundSummary } from '../types/game';
import { Palette } from '../theme/tokens';
import { useThemedStyles } from '../theme/ThemeProvider';
import { IncomingRound } from './LobbyScreen';

interface MultiplayerGameScreenProps {
  /** Set when the host's 'go' brought us here; absent means we are the host. */
  round?: IncomingRound;
  onQuit: () => void;
  onFinish: (summary: RoundSummary, youId: string) => void;
}

const RESULT_DELAY_MS = 1600;

/**
 * The BLE race.
 *
 * Each device judges its own player's guesses against the target the host sent,
 * so typing feels instant, and relays the raw guess so everyone else's lane
 * updates. The host has the final say on who won: it broadcasts 'end' and every
 * device adopts that, which settles the case where two people land on the number
 * within a few milliseconds of each other.
 */
export default function MultiplayerGameScreen({ round, onQuit, onFinish }: MultiplayerGameScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const { players, youId, role, room, send, onMessage, state, leaveRoom } = useBle();
  const { range, modifiers, mode } = useSettings();
  const [race, dispatch] = useReducer(raceReducer, emptyRace);
  const [entry, setEntry] = useState('');
  const [reactions, setReactions] = useState<IncomingReaction[]>([]);

  const isHost = role === 'host';
  const roundIdRef = useRef<string>(round?.rid ?? '');
  const endSentRef = useRef(false);

  // Reactions name whoever sent them, and the roster changes mid-round.
  const playersRef = useRef(players);
  playersRef.current = players;

  const react = useCallback(
    (emoji: string) => {
      send({ t: 'rx', id: youId, e: emoji });
      feedback.react();
      const key = `me-${Date.now()}`;
      setReactions((prev) => [...prev.slice(-3), { key, name: 'You', emoji }]);
      setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 2400);
    },
    [send, youId],
  );

  const seeds = useCallback(
    (): RacerSeed[] =>
      players.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.isYou ? ('you' as const) : ('peer' as const),
      })),
    [players],
  );

  // Open the round: the host invents it and announces it, clients replay the
  // 'go' that carried them here.
  // Starting gun, once the round actually opens.
  useEffect(() => {
    if (race.status === 'running') feedback.roundStart();
  }, [race.startedAt]);

  useEffect(() => {
    if (race.status !== 'idle') return;

    if (round) {
      const incoming = { min: round.lo, max: round.hi };
      roundIdRef.current = round.rid;
      dispatch({
        type: 'start',
        range: incoming,
        target: round.tg,
        racers: seeds(),
        now: Date.now(),
        rules: {
          ...resolveRules(incoming, parseModifierIds(round.mf)),
          ...(round.md === 'sudden' ? { guessLimit: 1 } : {}),
        },
        mode: (round.md as RaceMode) ?? 'speed',
      });
      return;
    }

    const hostRange = room?.range ?? range;
    // Survival is the Limited modifier by another name, so the mode switches it
    // on even when the host did not tap the chip.
    const withMode =
      (mode === 'elimination' || mode === 'sudden') && !modifiers.includes('limited')
        ? [...modifiers, 'limited' as const]
        : modifiers;
    const shared = multiplayerSafe(withMode);
    const rid = `r-${Math.random().toString(36).slice(2, 8)}`;
    const target = makeTarget(hostRange);
    roundIdRef.current = rid;
    dispatch({
      type: 'start',
      range: hostRange,
      target,
      racers: seeds(),
      now: Date.now(),
      // One guess each is the whole mode, so it overrides par.
      rules: { ...resolveRules(hostRange, shared), ...(mode === 'sudden' ? { guessLimit: 1 } : {}) },
      mode,
    });
    send({ t: 'go', rid, lo: hostRange.min, hi: hostRange.max, tg: target, md: mode, mf: shared });
  }, [race.status, round, range, room, seeds, send, modifiers, mode]);

  // Inbound traffic.
  useEffect(() => {
    return onMessage((msg) => {
      switch (msg.t) {
        case 'g':
          if (msg.rid !== roundIdRef.current) return;
          dispatch({ type: 'guess', racerId: msg.id, value: msg.v, now: Date.now() });
          feedback.peerGuess();
          return;

        case 'fin':
          // Someone found it. Nobody is stopped by that -- it just fills in
          // their lane, in case their winning guess never reached us.
          if (msg.rid !== roundIdRef.current) return;
          dispatch({ type: 'finished', racerId: msg.id, at: msg.ms });
          return;

        case 'end':
          if (msg.rid !== roundIdRef.current) return;
          dispatch({ type: 'end' });
          return;

        case 'rx': {
          const from = playersRef.current.find((p) => p.id === msg.id);
          const key = `${msg.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          setReactions((prev) => [...prev.slice(-3), { key, name: from?.name ?? 'Someone', emoji: msg.e }]);
          feedback.react();
          setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), 2400);
          return;
        }

        case 'off':
          dispatch({ type: 'connection', racerId: msg.id, online: false });
          return;

        case 'on':
          dispatch({ type: 'connection', racerId: msg.id, online: true });
          return;

        case 'bye':
          dispatch({ type: 'removeRacer', racerId: msg.id });
          return;

        default:
          return;
      }
    });
  }, [onMessage]);

  const you = race.racers.find((r) => r.id === youId);

  // Haptics for your own verdicts.
  const seen = useRef(0);
  useEffect(() => {
    const count = you?.guesses.length ?? 0;
    if (count === seen.current) return;
    seen.current = count;
    const last = you?.guesses[count - 1];
    if (!last) return;
    feedback.verdict(last.verdict);
  }, [you?.guesses]);

  // Once the room is done the host calls it, so every device closes together.
  useEffect(() => {
    if (race.status !== 'finished' || !isHost || endSentRef.current) return;
    endSentRef.current = true;
    send({ t: 'end', rid: roundIdRef.current, id: race.winnerId ?? youId });
  }, [race.status, race.winnerId, isHost, send, youId]);

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
    dispatch({ type: 'guess', racerId: youId, value, now: Date.now(), wagered });
    send({ t: 'g', rid: roundIdRef.current, id: youId, v: value });
    setEntry('');

    if (value === race.target) {
      const elapsed = Date.now() - race.startedAt;
      const count = (you?.guesses.length ?? 0) + 1;
      send({ t: 'fin', rid: roundIdRef.current, id: youId, n: count, ms: elapsed });
    }
  };

  const quit = async () => {
    await leaveRoom();
    onQuit();
  };

  const lastGuess = you?.guesses[you.guesses.length - 1] ?? null;

  return (
    <Screen
      title="Live race"
      subtitle={race.status === 'idle' ? 'Syncing round…' : rulesSummary(race.range, race.rules.modifiers, race.mode)}
      onBack={quit}
      headerRight={
        <View style={styles.headerRight}>
          <BleStatusBadge label={bleStatusLabel(state, players.length - 1)} live={state === 'connected'} />
          <Stopwatch startedAt={race.startedAt} running={race.status === 'running'} />
        </View>
      }
    >
      {race.status === 'idle' ? (
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Waiting for the number…</Text>
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
          onSkipWait={() => dispatch({ type: 'end' })}
          slot={<ReactionBar onSend={react} disabled={race.status !== 'running'} />}
        />
      )}

      <ReactionStream items={reactions} />
    </Screen>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  headerRight: {
    alignItems: 'flex-end',
    gap: 3,
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
