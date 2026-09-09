/**
 * The seam between EventPulse and a connection-oriented radio.
 *
 * This is the GATT counterpart of `bluetooth/BleTransport.ts`, and it exists
 * for the same reason: everything above it is plain TypeScript that runs in
 * Node and under Jest, and everything below it is a thin adapter over a native
 * library that cannot run there at all.
 *
 * Implementations:
 *
 *   BlePlxGattTransport  — the real one. `react-native-ble-plx` for the client
 *                          half, `react-native-ble-peripheral-manager` for the
 *                          server half. Untestable off-device by construction.
 *   InMemoryGattTransport — a deterministic loopback pair. Two instances wired
 *                          to each other exercise the whole stack above the
 *                          seam, including fragmentation at a chosen MTU.
 *
 * Application services must depend on this interface and never on a BLE
 * library. That is what lets the session layer, the framing and the lifecycle
 * be tested for real rather than mocked.
 *
 * A transport speaks in whole reassembled payloads addressed to a peer. It owns
 * fragmentation, because the fragment size depends on the MTU negotiated for
 * one specific link and nothing above here can know it.
 */

import type { GattLinkState } from './GattLink';

/** How this device came to be talking to that one. */
export type GattRole =
  /** We connected out to them: GATT client / BLE central. */
  | 'central'
  /** They connected in to us: GATT server / BLE peripheral. */
  | 'peripheral';

export interface GattPeer {
  /**
   * The transport's handle for this link.
   *
   * NOT an EventPulse peer id and NOT a profile id. On Android it is a MAC
   * address, on iOS a CoreBluetooth identifier, and for the in-memory transport
   * an arbitrary string. Mapping it to a person is the session layer's job,
   * and it happens only after a `Hello` arrives on the link.
   */
  deviceId: string;
  role: GattRole;
  /** Negotiated ATT MTU, or the platform's assumed value before negotiation. */
  mtu: number;
  /** Advertised name, when the platform gave us one. Never trusted for identity. */
  displayName?: string;
  connectedAt: number;
}

/** A device seen while scanning for the EventPulse GATT service. */
export interface GattDiscovery {
  deviceId: string;
  displayName?: string;
  rssi?: number;
  discoveredAt: number;
}

export type GattTransportErrorCode =
  | 'unavailable'
  | 'permission_denied'
  | 'adapter_off'
  | 'connect_failed'
  | 'connect_timeout'
  | 'service_not_found'
  | 'characteristic_not_found'
  | 'not_connected'
  | 'write_failed'
  | 'notify_failed'
  | 'advertise_failed'
  | 'message_too_large'
  | 'internal';

export class GattTransportError extends Error {
  readonly code: GattTransportErrorCode;
  /** True when the same call could plausibly succeed later. */
  readonly recoverable: boolean;
  readonly cause?: unknown;

  constructor(
    code: GattTransportErrorCode,
    message: string,
    options: { recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'GattTransportError';
    this.code = code;
    this.recoverable = options.recoverable ?? true;
    this.cause = options.cause;
  }
}

export interface GattTransportEvents {
  /** A device advertising the EventPulse GATT service was seen. */
  onDiscovery(discovery: GattDiscovery): void;
  /** A link reached `connected`, in either role. */
  onPeerConnected(peer: GattPeer): void;
  /** A link ended, however it ended. */
  onPeerDisconnected(deviceId: string, reason: GattDisconnectReason): void;
  /** One complete, reassembled message arrived. */
  onMessage(deviceId: string, payload: Uint8Array): void;
  /** The MTU for a link changed, so the fragment size did too. */
  onMtuChanged(deviceId: string, mtu: number): void;
  /** Something went wrong that is not tied to a single call site. */
  onError(error: GattTransportError): void;
}

export type GattDisconnectReason =
  /** We asked for it. */
  | 'local'
  /** They went away, or the link dropped. */
  | 'remote'
  /** The link never came up in time. */
  | 'timeout'
  /** The radio went away underneath us. */
  | 'adapter_off'
  | 'error';

/**
 * What the transport can currently do.
 *
 * Peripheral support is the fragile half on phones: a minority of Android
 * chipsets expose no advertiser at all. Reporting it honestly lets the UI say
 * "this phone cannot host" rather than appearing to work and never being found.
 */
export interface GattCapabilities {
  supportsCentral: boolean;
  supportsPeripheral: boolean;
  /** Why a role is missing, when one is. Shown to the user verbatim. */
  unavailableReason?: string;
}

export interface GattTransport {
  readonly name: string;

  getCapabilities(): Promise<GattCapabilities>;

  /* --- server half: let others reach us --- */

  /** Publish the GATT service and start advertising it. */
  startPeripheral(options?: { displayName?: string }): Promise<void>;
  stopPeripheral(): Promise<void>;

  /* --- client half: reach out to them --- */

  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  /**
   * Open a link. Resolves once the service and characteristics are discovered,
   * the MTU is settled and notifications are subscribed — that is, once the
   * link can actually carry a message, not merely when the radio says
   * "connected".
   */
  connect(deviceId: string, options?: { timeoutMs?: number }): Promise<GattPeer>;

  disconnect(deviceId: string): Promise<void>;

  /* --- traffic --- */

  /** Send one whole message. Fragments internally at the link's current MTU. */
  send(deviceId: string, payload: Uint8Array): Promise<void>;

  getPeers(): GattPeer[];
  getPeer(deviceId: string): GattPeer | undefined;
  getLinkState(deviceId: string): GattLinkState;

  subscribe(events: Partial<GattTransportEvents>): () => void;

  /** Drop every link, stop both roles, release native resources. */
  shutdown(): Promise<void>;
}
