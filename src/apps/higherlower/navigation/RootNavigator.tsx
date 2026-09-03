import React, { useMemo, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import SoloSetupScreen from '../screens/SoloSetupScreen';
import SoloGameScreen from '../screens/SoloGameScreen';
import ResultScreen from '../screens/ResultScreen';
import MultiplayerScreen from '../screens/MultiplayerScreen';
import JoinScreen from '../screens/JoinScreen';
import LobbyScreen, { IncomingRound } from '../screens/LobbyScreen';
import MultiplayerGameScreen from '../screens/MultiplayerGameScreen';
import HowToPlayScreen from '../screens/HowToPlayScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useBle } from '../ble/BleProvider';
import { useTheme } from '../theme/ThemeProvider';
import { useStats } from '../store/StatsProvider';
import { dailyChallenge, dailyKey } from '../game/daily';
import { Achievement } from '../game/progress';
import { RoundSummary } from '../types/game';
import { useSettings } from '../settings/SettingsProvider';

export type RootStackParamList = {
  Home: undefined;
  SoloSetup: undefined;
  SoloGame: { daily?: boolean } | undefined;
  Result: undefined;
  Multiplayer: undefined;
  Join: undefined;
  Lobby: undefined;
  MultiplayerGame: { round?: IncomingRound } | undefined;
  HowToPlay: undefined;
  Profile: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

interface FinishedRound {
  summary: RoundSummary;
  youId: string;
  mode: 'solo' | 'multiplayer' | 'daily';
  unlocked: Achievement[];
}

/**
 * Best-of-N bookkeeping. A match is just rounds with a running tally, so it
 * lives here beside the finished round rather than inside the race reducer.
 */
interface MatchState {
  rounds: number;
  played: number;
  wins: Record<string, number>;
  names: Record<string, string>;
}

function clinched(match: MatchState): string | null {
  const needed = Math.floor(match.rounds / 2) + 1;
  const leader = Object.entries(match.wins).find(([, wins]) => wins >= needed);
  return leader ? leader[0] : null;
}

function scoreline(match: MatchState, youId: string): string {
  return Object.entries(match.wins)
    .sort((a, b) => b[1] - a[1])
    .map(([id, wins]) => `${id === youId ? 'You' : match.names[id] ?? 'Player'} ${wins}`)
    .join(' · ');
}

/**
 * Home -> Solo, Daily or Multiplayer, all converging on the shared Result
 * screen.
 *
 * The finished round is held here rather than passed as a nav param: it is a
 * chunky object that only two screens care about, and this is also where a
 * finished round gets folded into the player's profile.
 */
export default function RootNavigator() {
  const { leaveRoom } = useBle();
  const { colors, scheme } = useTheme();
  const { record } = useStats();
  const { matchRounds } = useSettings();
  const [finished, setFinished] = useState<FinishedRound | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);

  // The navigator paints the gap behind screens during transitions; left at its
  // default that gap is white, which flashes on every push in dark mode.
  const navTheme = useMemo<Theme>(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.background,
        card: colors.backgroundAlt,
        text: colors.textPrimary,
        border: colors.divider,
        primary: colors.accent,
        notification: colors.accent,
      },
    };
  }, [colors, scheme]);

  const finish = (
    summary: RoundSummary,
    youId: string,
    mode: FinishedRound['mode'],
    matchRounds = 1,
  ): void => {
    const unlocked = record({
      summary,
      youId,
      multiplayer: mode === 'multiplayer',
      ...(mode === 'daily' ? { dailyKey: dailyKey() } : {}),
    });
    setFinished({ summary, youId, mode, unlocked });

    // Daily runs are one-offs; everything else can be part of a match.
    if (mode === 'daily' || matchRounds <= 1) {
      setMatch(null);
      return;
    }
    setMatch((prev) => {
      const base: MatchState =
        prev && prev.rounds === matchRounds && !clinched(prev)
          ? prev
          : { rounds: matchRounds, played: 0, wins: {}, names: {} };
      const names = { ...base.names };
      summary.racers.forEach((r) => {
        names[r.id] = r.name;
      });
      const wins = { ...base.wins };
      summary.racers.forEach((r) => {
        wins[r.id] = wins[r.id] ?? 0;
      });
      if (summary.winnerId) wins[summary.winnerId] = (wins[summary.winnerId] ?? 0) + 1;
      return { rounds: matchRounds, played: base.played + 1, wins, names };
    });
  };

  const matchWinner = match ? clinched(match) : null;

  return (
    <NavigationThemeProvider value={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }} initialRouteName="Home">
        <Stack.Screen name="Home">
          {({ navigation }) => (
            <HomeScreen
              onSolo={() => navigation.navigate('SoloSetup')}
              onDaily={() => navigation.navigate('SoloGame', { daily: true })}
              onMultiplayer={() => navigation.navigate('Multiplayer')}
              onHowToPlay={() => navigation.navigate('HowToPlay')}
              onProfile={() => navigation.navigate('Profile')}
              onSettings={() => navigation.navigate('Settings')}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="SoloSetup">
          {({ navigation }) => (
            <SoloSetupScreen onBack={() => navigation.goBack()} onStart={() => navigation.navigate('SoloGame')} />
          )}
        </Stack.Screen>

        <Stack.Screen name="SoloGame">
          {({ navigation, route }) => {
            const isDaily = route.params?.daily === true;
            const today = isDaily ? dailyChallenge(dailyKey()) : null;
            return (
              <SoloGameScreen
                challenge={today ? { range: today.range, target: today.target, modifiers: today.modifiers } : null}
                onQuit={() => navigation.navigate('Home')}
                onFinish={(summary, youId) => {
                  finish(summary, youId, isDaily ? 'daily' : 'solo', isDaily ? 1 : matchRounds);
                  navigation.replace('Result');
                }}
              />
            );
          }}
        </Stack.Screen>

        <Stack.Screen name="Multiplayer">
          {({ navigation }) => (
            <MultiplayerScreen
              onBack={() => navigation.goBack()}
              onHosted={() => navigation.navigate('Lobby')}
              onJoin={() => navigation.navigate('Join')}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Join">
          {({ navigation }) => (
            <JoinScreen onBack={() => navigation.goBack()} onJoined={() => navigation.replace('Lobby')} />
          )}
        </Stack.Screen>

        <Stack.Screen name="Lobby">
          {({ navigation }) => (
            <LobbyScreen
              onLeave={() => navigation.navigate('Home')}
              onStart={() => navigation.navigate('MultiplayerGame')}
              onRoundStarted={(round) => navigation.navigate('MultiplayerGame', { round })}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="MultiplayerGame">
          {({ navigation, route }) => (
            <MultiplayerGameScreen
              round={route.params?.round}
              onQuit={() => navigation.navigate('Home')}
              onFinish={(summary, youId) => {
                finish(summary, youId, 'multiplayer', matchRounds);
                navigation.replace('Result');
              }}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Result">
          {({ navigation }) =>
            finished ? (
              <ResultScreen
                summary={finished.summary}
                youId={finished.youId}
                unlocked={finished.unlocked}
                matchLine={
                  match
                    ? matchWinner
                      ? `🏆 MATCH ${matchWinner === finished.youId ? 'WON' : 'LOST'} — ${scoreline(match, finished.youId)}`
                      : `ROUND ${match.played} OF ${match.rounds} — ${scoreline(match, finished.youId)}`
                    : null
                }
                playAgainLabel={
                  match && !matchWinner
                    ? 'Next round'
                    : finished.mode === 'multiplayer'
                      ? 'Back to lobby'
                      : finished.mode === 'daily'
                        ? 'Try again'
                        : 'Play again'
                }
                onPlayAgain={() => {
                  if (matchWinner) setMatch(null);
                  if (finished.mode === 'multiplayer') navigation.replace('Lobby');
                  else if (finished.mode === 'daily') navigation.replace('SoloGame', { daily: true });
                  else navigation.replace('SoloGame');
                }}
                onHome={() => {
                  if (finished.mode === 'multiplayer') void leaveRoom();
                  setMatch(null);
                  navigation.navigate('Home');
                }}
              />
            ) : null
          }
        </Stack.Screen>

        <Stack.Screen name="HowToPlay">
          {({ navigation }) => <HowToPlayScreen onBack={() => navigation.goBack()} />}
        </Stack.Screen>

        <Stack.Screen name="Profile">
          {({ navigation }) => <ProfileScreen onBack={() => navigation.goBack()} />}
        </Stack.Screen>

        <Stack.Screen name="Settings">
          {({ navigation }) => <SettingsScreen onBack={() => navigation.goBack()} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationThemeProvider>
  );
}
