/**
 * Mode registry.
 *
 * Adding a mode: implement GameModeStrategy, add it to MODE_REGISTRY, and add
 * the enum member. Nothing in GameManager needs to change.
 */
import {GameMode} from '../../models/game';
import type {GameModeStrategy} from './GameModeStrategy';
import {IndividualHuntMode} from './IndividualHuntMode';
import {RaceMode} from './RaceMode';
import {SharedTreasureMode} from './SharedTreasureMode';
import {TeamHuntMode} from './TeamHuntMode';
import {TimedHuntMode} from './TimedHuntMode';

const MODE_REGISTRY: Record<GameMode, () => GameModeStrategy> = {
  [GameMode.SharedTreasure]: () => new SharedTreasureMode(),
  [GameMode.Race]: () => new RaceMode(),
  [GameMode.IndividualHunt]: () => new IndividualHuntMode(),
  [GameMode.TeamHunt]: () => new TeamHuntMode(),
  [GameMode.TimedHunt]: () => new TimedHuntMode(),
};

export function createGameMode(mode: GameMode): GameModeStrategy {
  const factory = MODE_REGISTRY[mode];
  if (!factory) {
    // An unknown mode from a newer peer falls back to the default rather than
    // failing the match outright.
    return new SharedTreasureMode();
  }
  return factory();
}

export const ALL_GAME_MODES: readonly GameMode[] = Object.keys(MODE_REGISTRY) as GameMode[];

export * from './GameModeStrategy';
export {SharedTreasureMode, RaceMode, IndividualHuntMode, TeamHuntMode, TimedHuntMode};
