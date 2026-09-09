import { Range } from '../types/game';
import { Msg } from './protocol';

/** Radio/link state surfaced in the status badge at the top of every screen. */
export type BleState = 'off' | 'idle' | 'advertising' | 'scanning' | 'connected';

/**
 * A room seen while scanning. `rssi` drives the signal bars, and the rest rides
 * along in the advertisement so a player can see what they are joining before
 * they connect -- a BLE advert has room for a few bytes of service data.
 *
 * `hostName` is null on rooms hosted from an iPhone: iOS cannot advertise
 * manufacturer data, so the name only arrives once the link is up.
 */
export interface DiscoveredRoom {
  id: string;
  code: string;
  hostName: string | null;
  players: number;
  capacity: number;
  /** No seat left. Shown, not hidden -- the room is still worth recognising. */
  full: boolean;
  /** The round is already running. */
  playing: boolean;
  rssi: number;
  range: Range;
}

export interface RoomInfo {
  id: string;
  code: string;
  hostName: string;
  /** The host's range. Every round in this room uses it. */
  range: Range;
  /** How many phones the host is letting in, including their own. */
  capacity: number;
}

export type Unsubscribe = () => void;

/**
 * The seam between the game and the radio.
 *
 * `NativeBleTransport` drives the real thing: the host is a GATT peripheral,
 * joiners are centrals, and the host relays so every phone sees every guess.
 * `MockBleTransport` implements the same calls against simulated opponents,
 * which is what keeps Multiplayer explorable in Expo Go where there is no
 * native radio to talk to. `createTransport` picks; nothing above it knows.
 */
export interface BleTransport {
  /** Stable id for this device, used as the racer id on the wire. */
  readonly deviceId: string;
  readonly label: string;
  /** True when the opponents are stand-ins rather than other phones. */
  readonly simulated: boolean;

  getState(): BleState;
  onStateChange(cb: (state: BleState) => void): Unsubscribe;

  /** Host: begin advertising a room and accept connections. */
  startHosting(room: RoomInfo): Promise<void>;
  /** Host: change how many phones may join, after the room is already open. */
  setCapacity?(capacity: number): Promise<void>;
  /** Host: stop taking joiners once the round is under way. */
  setPlaying?(playing: boolean): void;

  /** Client: scan for nearby rooms; the callback fires with the full list. */
  startScan(cb: (rooms: DiscoveredRoom[]) => void): Unsubscribe;
  /** Client: connect to a discovered room. */
  join(roomId: string, playerName: string): Promise<void>;
  /** Tear the link down from either side. */
  leave(): Promise<void>;

  /**
   * Broadcast to everyone else in the room, or to one peer when `to` is given.
   * The roster is built from the 'hello'/'bye' messages this carries, so a
   * driver needs no separate peer-listing API.
   */
  send(msg: Msg, to?: string): Promise<void>;
  onMessage(cb: (msg: Msg, fromId: string) => void): Unsubscribe;

  /** Releases radio handles/timers. Called when the provider unmounts. */
  destroy?(): void;
}
