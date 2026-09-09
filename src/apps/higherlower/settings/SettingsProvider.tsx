import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Difficulty, RaceMode, Range } from '../types/game';
import { parGuesses } from '../game/engine';
import { ModifierId, toggleModifier } from '../game/modifiers';
import { DEFAULT_CAPACITY, MAX_CAPACITY, MIN_CAPACITY } from '../ble/constants';

export interface RangePreset {
  id: string;
  label: string;
  range: Range;
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'quick', label: 'Quick', range: { min: 1, max: 20 } },
  { id: 'classic', label: 'Classic', range: { min: 1, max: 100 } },
  { id: 'hard', label: 'Hard', range: { min: 1, max: 1000 } },
  { id: 'insane', label: 'Insane', range: { min: 1, max: 10000 } },
];

/** "1–1,000" — thousands separators, because 10000 is hard to read at a glance. */
export function formatRange(range: Range): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return `${n(range.min)}–${n(range.max)}`;
}

export function presetPar(preset: RangePreset): number {
  return parGuesses(preset.range);
}

export interface Settings {
  playerName: string;
  difficulty: Difficulty;
  rangeId: string;
  haptics: boolean;
  sound: boolean;
  modifiers: ModifierId[];
  mode: RaceMode;
  /** 1 for a single round, 3 for best-of-three. */
  matchRounds: number;
  /** Seats in a room you host, your own included. */
  maxPlayers: number;
}

interface SettingsContextValue extends Settings {
  range: Range;
  preset: RangePreset;
  setPlayerName(name: string): void;
  setDifficulty(difficulty: Difficulty): void;
  setRangeId(id: string): void;
  setHaptics(on: boolean): void;
  setSound(on: boolean): void;
  toggleModifierId(id: ModifierId): void;
  setModifiers(ids: ModifierId[]): void;
  setMode(mode: RaceMode): void;
  setMatchRounds(rounds: number): void;
  setMaxPlayers(players: number): void;
}

const DEFAULTS: Settings = {
  playerName: 'You',
  difficulty: 'normal',
  rangeId: 'classic',
  haptics: true,
  sound: true,
  modifiers: [],
  mode: 'speed',
  matchRounds: 1,
  maxPlayers: DEFAULT_CAPACITY,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * App-wide preferences: who you are, how hard the round should be, and which
 * rules are bent. Kept in memory for now -- everything here is cheap to re-pick;
 * swap the useState for storage-backed state if it should survive a cold start.
 */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  const patch = useCallback((next: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
  }, []);

  const value = useMemo<SettingsContextValue>(() => {
    const preset = RANGE_PRESETS.find((p) => p.id === settings.rangeId) ?? RANGE_PRESETS[1];
    return {
      ...settings,
      preset,
      range: preset.range,
      setPlayerName: (playerName) => patch({ playerName }),
      setDifficulty: (difficulty) => patch({ difficulty }),
      setRangeId: (rangeId) => patch({ rangeId }),
      setHaptics: (haptics) => patch({ haptics }),
      setSound: (sound) => patch({ sound }),
      setModifiers: (modifiers) => patch({ modifiers }),
      toggleModifierId: (id) =>
        setSettings((prev) => ({ ...prev, modifiers: toggleModifier(prev.modifiers, id) })),
      setMode: (mode) => patch({ mode }),
      setMatchRounds: (matchRounds) => patch({ matchRounds }),
      setMaxPlayers: (players) =>
        patch({ maxPlayers: Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, players)) }),
    };
  }, [settings, patch]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
