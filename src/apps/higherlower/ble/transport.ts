import { Range } from '../types/game';
import { Msg } from './protocol';

/** Radio/link state surfaced in the status badge at the top of every screen. */
export type BleState = 'off' | 'idle' | 'advertising' | 'scanning' | 'connected';

/**
 * A room seen while scanning. `rssi` drives the signal bars, and `range` rides
 * along in the advertisement so a player can see what they are joining before
 * they connect -- a BLE advert has room for a few bytes of service data.
 */
export interface DiscoveredRoom {
  id: string;
  code: string;
  hostName: string;
  players: number;
  rssi: number;
  range: Range;
}

export interface RoomInfo {
  id: string;
  code: string;
  hostName: string;
  /** The host's range. Every round in this room uses it. */
  range: Range;
}

export type Unsubscribe = () => void;

/**
 * The seam between the game and the radio.
 *
 * `MockBleTransport` implements this today so the whole multiplayer flow is
 * playable on a single device. A real driver (react-native-ble-plx as central +
 * a peripheral/advertiser module on the host) implements the same six calls and
 * drops straight in via `createTransport` — no screen or game code changes.
 */
export interface BleTransport {
  /** Stable id for this device, used as the racer id on the wire. */
  readonly deviceId: string;
  readonly label: string;

  getState(): BleState;
  onStateChange(cb: (state: BleState) => void): Unsubscribe;

  /** Host: begin advertising a room and accept connections. */
  startHosting(room: RoomInfo): Promise<void>;
  /** Client: scan for nearby rooms; the callback fires with the full list. */
  startScan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe;
  /** Client: connect to a discovered room. */
  join(roomId: string, playerName: string): Promise<void>;
  /** Tear the link down from either side. */
  leave(): Promise<void>;

  /**
   * Broadcast to everyone else in the room. The roster is built from the
   * 'hello'/'bye' messages this carries, so a driver needs no separate
   * peer-listing API.
   */
  send(msg: Msg): Promise<void>;
  onMessage(cb: (msg: Msg, fromId: string) => void): Unsubscribe;

  /** Releases radio handles/timers. Called when the provider unmounts. */
  destroy?(): void;
}
