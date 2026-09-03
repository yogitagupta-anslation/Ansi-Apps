/**
 * The seam between the game and the radio.
 *
 * Everything above this interface (reliability, routing, game engine) is pure
 * TypeScript and unit-testable. Everything below it is a thin adapter over a
 * native BLE library:
 *
 *   CentralTransport     -> react-native-ble-plx        (player / GATT client)
 *   PeripheralTransport  -> react-native-ble-peripheral-manager (host / GATT server)
 *
 * A transport speaks only in reassembled byte payloads addressed to a peerId.
 * Fragmentation lives inside the transport because the fragment size depends on
 * the MTU negotiated for that specific link.
 */
import type {Emitter} from '../../utils/emitter';
import type {
  BleAdapterState,
  BlePeer,
  BleRole,
  TransportEvents,
} from '../BleTypes';

export interface Transport {
  readonly role: BleRole;
  readonly events: Emitter<TransportEvents>;

  /** Bring the radio up and report whether it is usable. */
  initialize(): Promise<BleAdapterState>;

  /** Current adapter state without waiting for an event. */
  getAdapterState(): Promise<BleAdapterState>;

  /** Send one message payload to a specific peer. Fragments internally. */
  send(peerId: string, payload: Uint8Array): Promise<void>;

  /** Send to every connected peer. Failures for one peer must not block others. */
  broadcast(payload: Uint8Array, excludePeerId?: string): Promise<void>;

  getPeers(): BlePeer[];
  getPeer(peerId: string): BlePeer | undefined;

  /** Tear down links, stop scanning or advertising, release native resources. */
  shutdown(): Promise<void>;
}

/** Extra surface only a host (peripheral) transport provides. */
export interface PeripheralTransport extends Transport {
  role: BleRole.Peripheral;
  /** Publish the GATT service and begin advertising the given lobby code. */
  startAdvertising(gameCode: string): Promise<void>;
  stopAdvertising(): Promise<void>;
  isAdvertising(): Promise<boolean>;
}

/** Extra surface only a player (central) transport provides. */
export interface CentralTransport extends Transport {
  role: BleRole.Central;
  startScan(onDiscover: (host: import('../BleTypes').DiscoveredHost) => void): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<BlePeer>;
  disconnect(peerId: string): Promise<void>;
}

/**
 * Reason a transport could not be created on this device or build.
 * Surfaced to the UI so the user is told the truth rather than being handed a
 * silently degraded experience.
 */
export interface TransportUnavailable {
  available: false;
  reason: string;
}

export interface TransportAvailable<T extends Transport> {
  available: true;
  transport: T;
}

export type TransportProbe<T extends Transport> =
  | TransportAvailable<T>
  | TransportUnavailable;
