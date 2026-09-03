import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Achievement, EMPTY_STATS, RoundRecord, Stats, recordRound } from '../game/progress';
import { isPersistent, loadJson, saveJson } from './storage';

const KEY = 'hol.stats.v1';

interface StatsContextValue {
  stats: Stats;
  /** False once storage has failed — the profile screen says so. */
  persistent: boolean;
  ready: boolean;
  /** Folds a finished round in; returns any badges it earned. */
  record(entry: RoundRecord): Achievement[];
  reset(): void;
}

const StatsContext = createContext<StatsContextValue | null>(null);

/**
 * The player's profile. Loaded once on boot and written back after every round,
 * so a cold start keeps your streak, your best time and your badges.
 */
export function StatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [ready, setReady] = useState(false);
  // Recording happens during a screen transition, so the newest value has to be
  // readable synchronously rather than waiting for the next render.
  const latest = useRef(EMPTY_STATS);

  useEffect(() => {
    let alive = true;
    loadJson<Stats>(KEY, EMPTY_STATS).then((loaded) => {
      if (!alive) return;
      latest.current = loaded;
      setStats(loaded);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const record = useCallback((entry: RoundRecord): Achievement[] => {
    const { stats: next, unlocked } = recordRound(latest.current, entry);
    latest.current = next;
    setStats(next);
    void saveJson(KEY, next);
    return unlocked;
  }, []);

  const reset = useCallback(() => {
    latest.current = EMPTY_STATS;
    setStats(EMPTY_STATS);
    void saveJson(KEY, EMPTY_STATS);
  }, []);

  const value = useMemo<StatsContextValue>(
    () => ({ stats, ready, persistent: isPersistent(), record, reset }),
    [stats, ready, record, reset],
  );

  return <StatsContext.Provider value={value}>{children}</StatsContext.Provider>;
}

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error('useStats must be used inside <StatsProvider>');
  return ctx;
}
