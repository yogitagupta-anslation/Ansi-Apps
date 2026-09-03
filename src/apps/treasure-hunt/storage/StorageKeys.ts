/** Namespaced AsyncStorage keys. Bump the prefix to invalidate everything. */
const PREFIX = 'th.v1';

export const StorageKeys = {
  profile: `${PREFIX}.profile`,
  settings: `${PREFIX}.settings`,
  matchHistory: `${PREFIX}.matchHistory`,
  lastGameConfig: `${PREFIX}.lastGameConfig`,
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
