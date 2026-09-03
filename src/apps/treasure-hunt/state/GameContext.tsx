import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {GameManager, type LocalProfile} from '../game/GameManager';
import {BleAdapterState, BleLinkState} from '../ble/BleTypes';
import type {DiscoveredHost} from '../ble/BleTypes';
import {GamePhase, type GameState, type MatchResult, type ProximityReport} from '../models/game';
import {ProximityLevel} from '../models/game';
import type {Player} from '../models/player';
import type {ToastMessage} from '../components/Toast';
import {
  loadProfile,
  saveProfile,
  recordMatch,
  type PlayerProfile,
} from '../storage';
import {uid} from '../utils/id';
import {createLogger} from '../utils/logger';

const log = createLogger('GameContext');

interface GameContextValue {
  manager: GameManager;
  state: GameState;
  players: Player[];
  proximity: ProximityReport;
  adapterState: BleAdapterState;
  linkState: BleLinkState;
  hosts: DiscoveredHost[];
  countdown: number | null;
  remainingMs: number;
  toasts: ToastMessage[];
  lastResult: MatchResult | null;
  profile: PlayerProfile | null;
  updateProfile: (patch: Partial<PlayerProfile>) => Promise<void>;
  dismissToast: (id: string) => void;
  pushToast: (kind: ToastMessage['kind'], message: string) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

const INITIAL_PROXIMITY: ProximityReport = {
  level: ProximityLevel.VeryFar,
  distanceBand: 0,
  boosted: false,
};

/**
 * Bridges the imperative, event-driven GameManager to React state.
 *
 * The manager is created once and lives for the whole app session; React only
 * mirrors what it emits. Keeping the engine outside React is what lets it run a
 * 30 Hz simulation without dragging the component tree through every tick.
 */
export function GameProvider({children}: {children: React.ReactNode}) {
  const managerRef = useRef<GameManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new GameManager();
  }
  const manager = managerRef.current;

  const [state, setState] = useState<GameState>(() => manager.getState());
  const [players, setPlayers] = useState<Player[]>([]);
  const [proximity, setProximity] = useState<ProximityReport>(INITIAL_PROXIMITY);
  const [adapterState, setAdapterState] = useState<BleAdapterState>(
    BleAdapterState.Unknown,
  );
  const [linkState, setLinkState] = useState<BleLinkState>(BleLinkState.Idle);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [lastResult, setLastResult] = useState<MatchResult | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);

  const pushToast = useCallback((kind: ToastMessage['kind'], message: string) => {
    setToasts(current => {
      const next = [...current, {id: uid('t'), kind, message}];
      // Cap the stack so a burst of events cannot bury the screen.
      return next.slice(-3);
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadProfile().then(loaded => {
      if (!cancelled) {
        setProfile(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateProfile = useCallback(
    async (patch: Partial<PlayerProfile>) => {
      setProfile(current => {
        if (!current) {
          return current;
        }
        const next = {...current, ...patch};
        void saveProfile(next);
        return next;
      });
    },
    [],
  );

  // Subscribe to the engine once. Every handler is a plain state setter, so a
  // burst of BLE traffic costs at most one re-render per frame.
  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(manager.events.on('stateChanged', next => setState(next)));
    offs.push(manager.events.on('rosterChanged', roster => setPlayers(roster)));
    offs.push(manager.events.on('proximityChanged', report => setProximity(report)));
    offs.push(manager.events.on('hostsChanged', found => setHosts(found)));
    offs.push(manager.events.on('adapterStateChanged', next => setAdapterState(next)));
    offs.push(manager.events.on('linkStateChanged', next => setLinkState(next)));

    offs.push(
      manager.events.on('countdownTick', ({secondsLeft}) => {
        setCountdown(secondsLeft > 0 ? secondsLeft : null);
      }),
    );

    offs.push(
      manager.events.on('timerTick', ({remainingMs: left}) => setRemainingMs(left)),
    );

    offs.push(
      manager.events.on('phaseChanged', phase => {
        if (phase === GamePhase.Playing) {
          setCountdown(null);
        }
        if (phase === GamePhase.Idle || phase === GamePhase.Lobby) {
          setProximity(INITIAL_PROXIMITY);
        }
      }),
    );

    offs.push(
      manager.events.on('matchEnded', result => {
        setLastResult(result);
        void recordMatch(result);
      }),
    );

    offs.push(
      manager.events.on('itemCollected', ({item, points, isLocal}) => {
        if (isLocal) {
          pushToast('info', `Collected ${item.kind.toLowerCase()} +${points}`);
        }
      }),
    );

    offs.push(
      manager.events.on('notice', ({kind, message}) => pushToast(kind, message)),
    );

    offs.push(
      manager.events.on('error', error => {
        log.error('engine error', error);
        pushToast('error', error.message);
      }),
    );

    offs.push(
      manager.events.on('connectionChanged', ({connected, reconnecting}) => {
        setLinkState(
          reconnecting
            ? BleLinkState.Reconnecting
            : connected
              ? BleLinkState.Connected
              : BleLinkState.Disconnected,
        );
      }),
    );

    return () => {
      for (const off of offs) {
        off();
      }
    };
  }, [manager, pushToast]);

  useEffect(() => {
    return () => {
      void manager.dispose();
    };
  }, [manager]);

  const value = useMemo<GameContextValue>(
    () => ({
      manager,
      state,
      players,
      proximity,
      adapterState,
      linkState,
      hosts,
      countdown,
      remainingMs,
      toasts,
      lastResult,
      profile,
      updateProfile,
      dismissToast,
      pushToast,
    }),
    [
      manager,
      state,
      players,
      proximity,
      adapterState,
      linkState,
      hosts,
      countdown,
      remainingMs,
      toasts,
      lastResult,
      profile,
      updateProfile,
      dismissToast,
      pushToast,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) {
    throw new Error('useGame() must be used inside a <GameProvider>');
  }
  return value;
}

export type {LocalProfile};
