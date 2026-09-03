/**
 * Shared BLE-layer types. Deliberately free of any library import so the game
 * engine can depend on these without pulling native code into a test process.
 */

export enum BleRole {
  /** GATT server. The host advertises and accepts player connections. */
  Peripheral = 'PERIPHERAL',
  /** GATT client. Players scan for and connect to the host. */
  Central = 'CENTRAL',
}

export enum BleAdapterState {
  Unknown = 'UNKNOWN',
  Resetting = 'RESETTING',
  Unsupported = 'UNSUPPORTED',
  Unauthorized = 'UNAUTHORIZED',
  PoweredOff = 'POWERED_OFF',
  PoweredOn = 'POWERED_ON',
}

export enum BleLinkState {
  Idle = 'IDLE',
  Scanning = 'SCANNING',
  Advertising = 'ADVERTISING',
  Connecting = 'CONNECTING',
  Connected = 'CONNECTED',
  Reconnecting = 'RECONNECTING',
  Disconnected = 'DISCONNECTED',
  Failed = 'FAILED',
}

/** A host advertisement seen while scanning. */
export interface DiscoveredHost {
  /** Platform device identifier -- MAC on Android, opaque UUID on iOS. */
  deviceId: string;
  /** Four-digit lobby code recovered from the advertised local name. */
  gameCode: string;
  name: string | null;
  /**
   * Raw signal strength. Used ONLY to sort the host list by which radio is
   * nearest, never to infer anything about the virtual treasure.
   */
  rssi: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** A connected counterpart, from either side of the link. */
export interface BlePeer {
  /**
   * Stable handle for this link. On the host this is the central UUID reported
   * by the peripheral manager; on a player it is the host device id.
   */
  peerId: string;
  /** Game-level player id, learned once the peer identifies itself. */
  playerId?: string;
  state: BleLinkState;
  /** Negotiated ATT MTU; drives fragment sizing. */
  mtu: number;
  connectedAt: number;
  lastRxAt: number;
  lastTxAt: number;
}

export class BleError extends Error {
  constructor(
    message: string,
    readonly code: BleErrorCode,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BleError';
  }
}

export enum BleErrorCode {
  Unsupported = 'UNSUPPORTED',
  PermissionDenied = 'PERMISSION_DENIED',
  BluetoothOff = 'BLUETOOTH_OFF',
  ScanFailed = 'SCAN_FAILED',
  AdvertiseFailed = 'ADVERTISE_FAILED',
  ConnectFailed = 'CONNECT_FAILED',
  Disconnected = 'DISCONNECTED',
  WriteFailed = 'WRITE_FAILED',
  NotifyFailed = 'NOTIFY_FAILED',
  ServiceSetupFailed = 'SERVICE_SETUP_FAILED',
  Timeout = 'TIMEOUT',
  PeripheralUnavailable = 'PERIPHERAL_UNAVAILABLE',
  Unknown = 'UNKNOWN',
}

/** Human-readable, user-facing explanation for a BLE failure. */
export const BLE_ERROR_MESSAGE: Record<BleErrorCode, string> = {
  [BleErrorCode.Unsupported]: 'This device does not support Bluetooth Low Energy.',
  [BleErrorCode.PermissionDenied]: 'Bluetooth permission was denied. Grant it in Settings to play.',
  [BleErrorCode.BluetoothOff]: 'Bluetooth is turned off. Switch it on to host or join a hunt.',
  [BleErrorCode.ScanFailed]: 'Could not scan for nearby hunts. Try again.',
  [BleErrorCode.AdvertiseFailed]: 'Could not start advertising this game.',
  [BleErrorCode.ConnectFailed]: 'Could not connect to the host.',
  [BleErrorCode.Disconnected]: 'The connection dropped.',
  [BleErrorCode.WriteFailed]: 'Could not send data to the host.',
  [BleErrorCode.NotifyFailed]: 'Could not send data to players.',
  [BleErrorCode.ServiceSetupFailed]: 'Could not publish the game service.',
  [BleErrorCode.Timeout]: 'The Bluetooth operation timed out.',
  [BleErrorCode.PeripheralUnavailable]:
    'Hosting needs BLE peripheral support, which this device or build does not provide.',
  [BleErrorCode.Unknown]: 'An unexpected Bluetooth error occurred.',
};

/** Events every transport emits, regardless of role. */
export interface TransportEvents {
  adapterState: BleAdapterState;
  peerConnected: BlePeer;
  peerDisconnected: {peerId: string; reason?: string};
  /** One fully reassembled message payload from a peer. */
  data: {peerId: string; bytes: Uint8Array};
  mtuChanged: {peerId: string; mtu: number};
  error: BleError;
}
