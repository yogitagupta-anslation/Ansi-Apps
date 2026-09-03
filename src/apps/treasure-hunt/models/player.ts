import type {Position} from './geometry';
import type {ItemKind} from './world';

export enum PlayerConnectionState {
  /** Known to the host and exchanging messages. */
  Connected = 'CONNECTED',
  /** Link dropped, still inside the reconnect grace window. */
  Reconnecting = 'RECONNECTING',
  /** Grace window expired or the player left deliberately. */
  Disconnected = 'DISCONNECTED',
}

export enum PlayerStatus {
  InLobby = 'IN_LOBBY',
  Hunting = 'HUNTING',
  Finished = 'FINISHED',
  Eliminated = 'ELIMINATED',
}

export const AVATARS = [
  '🦊', '🐼', '🐸', '🦉', '🐙', '🦁', '🐺', '🦄',
] as const;
export type Avatar = (typeof AVATARS)[number];

export interface ActivePowerUp {
  kind: ItemKind;
  /** Epoch ms after which the effect stops applying. */
  expiresAt: number;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  /** Undefined outside of Team Hunt mode. */
  teamId?: string;
  isHost: boolean;
  position: Position;
  score: number;
  status: PlayerStatus;
  connection: PlayerConnectionState;
  /** Item kinds banked but not yet activated. */
  inventory: ItemKind[];
  activePowerUps: ActivePowerUp[];
  collectedItemIds: string[];
  /** Epoch ms of the last message received from this player. */
  lastSeenAt: number;
  /** Monotonic counter used to reject out-of-order movement packets. */
  lastMoveSeq: number;
  /**
   * Opaque handle for the BLE link. On the host this is the central's UUID as
   * reported by the peripheral manager; unset for the host's own entry.
   */
  peerId?: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
  score: number;
}

export function createPlayer(init: Partial<Player> & Pick<Player, 'id' | 'name'>): Player {
  return {
    avatar: AVATARS[0],
    isHost: false,
    position: {x: 0, y: 0},
    score: 0,
    status: PlayerStatus.InLobby,
    connection: PlayerConnectionState.Connected,
    inventory: [],
    activePowerUps: [],
    collectedItemIds: [],
    lastSeenAt: 0,
    lastMoveSeq: -1,
    ...init,
  };
}

/** Leaderboard ordering: score desc, then earliest finisher, then name. */
export function compareForLeaderboard(a: Player, b: Player): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  if (a.status !== b.status) {
    if (a.status === PlayerStatus.Finished) return -1;
    if (b.status === PlayerStatus.Finished) return 1;
  }
  return a.name.localeCompare(b.name);
}
