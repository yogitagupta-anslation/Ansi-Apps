/** Real adapter states, mirrored from the platform. Never synthesised. */
export type BluetoothState =
  | 'Unknown'
  | 'Resetting'
  | 'Unsupported'
  | 'Unauthorized'
  | 'PoweredOff'
  | 'PoweredOn';

export type PermissionState =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';

/** Which BLE role produced a given link. */
export type LinkRole = 'central' | 'peripheral';

/**
 * Transport-level address of a physical BLE connection.
 * On Android/iOS central links this is the ble-plx device id; on peripheral links it is
 * the native module's identifier for the connected central.
 *
 * A LinkId is NOT a peer identity — the application-level peerId is only known once the
 * HELLO handshake completes. PeerManager owns the mapping between the two.
 */
export type LinkId = string;

/**
 * Every stage a link actually passes through, in order. Each value corresponds to a real
 * operation against the BLE stack, so the UI and the Debug screen can show exactly where
 * a connection is — or exactly where it died.
 *
 *   disconnected
 *        v
 *   discovering            seen advertising, not yet dialled
 *        v
 *   connecting             connectToDevice / GATT connect
 *        v
 *   discoveringServices    service + characteristic discovery
 *        v
 *   negotiatingMtu         MTU exchange (Android requests, iOS reports)
 *        v
 *   enablingNotifications  CCCD write on the remote TX characteristic
 *        v
 *   handshaking            HELLO / HELLO_ACK
 *        v
 *   connected
 *
 * Plus the exits: disconnecting, reconnecting, failed.
 */
export type LinkState =
  | 'disconnected'
  | 'discovering'
  | 'connecting'
  | 'discoveringServices'
  | 'negotiatingMtu'
  | 'enablingNotifications'
  | 'handshaking'
  | 'connected'
  | 'disconnecting'
  | 'reconnecting'
  | 'failed';

/** Ordered list of the stages a successful connection walks through. */
export const LINK_PROGRESS: LinkState[] = [
  'connecting',
  'discoveringServices',
  'negotiatingMtu',
  'enablingNotifications',
  'handshaking',
  'connected',
];

/**
 * Why a link failed. Deliberately a closed set: "Connection failed" is useless in the
 * field, whereas ServiceNotFound vs CharacteristicNotFound vs HandshakeTimeout each point
 * at a different bug on a different phone.
 */
export type LinkFailureReason =
  | 'PermissionDenied'
  | 'BluetoothOff'
  | 'BluetoothUnauthorized'
  | 'BluetoothUnsupported'
  | 'DeviceUnavailable'
  | 'ConnectionTimeout'
  | 'ConnectionRefused'
  /**
   * Android GATT_ERROR (status 133) — the catch-all the Android stack returns when a
   * connection attempt fails for a reason it will not name. Almost always transient:
   * a stale GATT cache, reconnecting too quickly, or too many links at once.
   */
  | 'AndroidGattError'
  | 'ServiceNotFound'
  | 'CharacteristicNotFound'
  | 'MtuFailed'
  | 'NotificationsFailed'
  | 'HandshakeTimeout'
  | 'HandshakeFailed'
  /** The peer could not prove it owns the identity it claimed. */
  | 'AuthenticationFailed'
  | 'ProtocolMismatch'
  /** The peer's proven identity is on this device's own block list. */
  | 'Blocked'
  | 'LinkLost'
  /** The user changed their mind and cancelled the attempt. Not a failure of anything. */
  | 'Cancelled'
  | 'Unknown';

export interface LinkFailure {
  reason: LinkFailureReason;
  /** The stage that was in progress when it failed. */
  phase: LinkState;
  /** Raw detail from the platform, kept verbatim for the exported report. */
  message: string;
  timestamp: number;
}

export interface DiscoveredAdvertisement {
  linkId: LinkId;
  /** Platform-reported device name, if any. May be null. */
  deviceName: string | null;
  /** Name we parsed out of the advertisement (manufacturer data or local-name prefix). */
  advertisedName: string | null;
  /** First 8 bytes of the peer's application peerId, hex encoded. Android peers only. */
  peerIdPrefix: string | null;
  /**
   * Catalogue interests decoded from the advertised bitmask, available BEFORE connecting.
   *
   * Only catalogue entries can appear here — a custom interest has no bit to occupy and
   * arrives with the handshake instead. Empty for a peer on an older payload version.
   */
  advertisedInterests: string[];
  rssi: number | null;
  timestamp: number;
  /** True only when the advertisement carries this application's service UUID. */
  isChatPeer: boolean;
  /**
   * Whether the advertisement says the device accepts connections.
   * Android reports this; iOS does not expose it, so it is null there.
   */
  isConnectable: boolean | null;
  /** Service UUIDs from the advertisement, used for classification. */
  serviceUuids: string[];
}

export interface GattDiagnostics {
  serviceFound: boolean;
  rxCharacteristicFound: boolean;
  txCharacteristicFound: boolean;
  notificationsEnabled: boolean;
  mtu: number;
}
