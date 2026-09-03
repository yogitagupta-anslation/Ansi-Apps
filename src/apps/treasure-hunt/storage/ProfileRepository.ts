/**
 * The local player's identity and preferences.
 *
 * Generated on first launch so a new player can jump straight into a hunt
 * without a setup screen, then edited from Settings.
 */
import {AVATARS, type Avatar} from '../models/player';
import {DEFAULT_GAME_CONFIG} from '../config/gameConfig';
import type {GameConfig} from '../models/game';
import {StorageKeys} from './StorageKeys';
import {readJson, writeJson} from './LocalStorage';

export interface PlayerProfile {
  name: string;
  avatar: Avatar;
  /** Haptics and sound, both default on. */
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  /**
   * Set once the player has dragged to move. Gates the one-time gesture coach
   * mark so it never reappears after they have got the idea.
   */
  hasMovedOnce: boolean;
}

const ADJECTIVES = ['Swift', 'Bold', 'Sly', 'Lucky', 'Wily', 'Keen', 'Brave'];
const NOUNS = ['Fox', 'Otter', 'Falcon', 'Badger', 'Nomad', 'Scout', 'Raven'];

function randomName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adjective} ${noun}`;
}

function randomAvatar(): Avatar {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)] as Avatar;
}

export function createDefaultProfile(): PlayerProfile {
  return {
    name: randomName(),
    avatar: randomAvatar(),
    hapticsEnabled: true,
    soundEnabled: true,
    hasMovedOnce: false,
  };
}

export async function loadProfile(): Promise<PlayerProfile> {
  const stored = await readJson<Partial<PlayerProfile> | null>(StorageKeys.profile, null);
  if (!stored || typeof stored.name !== 'string') {
    const fresh = createDefaultProfile();
    await saveProfile(fresh);
    return fresh;
  }
  // Merge over the defaults so a profile written by an older build still loads.
  return {...createDefaultProfile(), ...stored} as PlayerProfile;
}

export async function saveProfile(profile: PlayerProfile): Promise<void> {
  await writeJson(StorageKeys.profile, profile);
}

export async function loadLastGameConfig(): Promise<GameConfig> {
  const stored = await readJson<Partial<GameConfig> | null>(
    StorageKeys.lastGameConfig,
    null,
  );
  return {...DEFAULT_GAME_CONFIG, ...(stored ?? {})};
}

export async function saveLastGameConfig(config: GameConfig): Promise<void> {
  await writeJson(StorageKeys.lastGameConfig, config);
}
