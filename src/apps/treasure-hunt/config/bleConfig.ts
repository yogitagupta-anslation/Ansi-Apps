/**
 * BLE constants for the Treasure Hunt GATT profile.
 *
 * Topology
 * --------
 *   HOST   = GATT server (BLE peripheral). Advertises the service below.
 *   PLAYER = GATT client (BLE central). Scans, connects, subscribes.
 *
 * Two characteristics carry all traffic:
 *   HOST_TX   notify   host -> players   (broadcast + targeted)
 *   PLAYER_RX write    players -> host
 *
 * A player never talks directly to another player. Everything is relayed by the
 * host, which is also the game authority. This keeps the BLE topology a simple
 * star and avoids the connection limits you hit with a mesh.
 */

/**
 * Custom 128-bit UUIDs. These are randomly generated application UUIDs and are
 * intentionally NOT in the Bluetooth SIG assigned range.
 */
export const BLE_SERVICE_UUID = '7b4b1f60-2c3a-4f6d-9a1e-5c8f0d2e7a41';
export const BLE_CHAR_HOST_TX_UUID = '7b4b1f61-2c3a-4f6d-9a1e-5c8f0d2e7a41';
export const BLE_CHAR_PLAYER_RX_UUID = '7b4b1f62-2c3a-4f6d-9a1e-5c8f0d2e7a41';

/** Prefix used in the advertised local name, e.g. "TH#4821". */
export const ADVERTISED_NAME_PREFIX = 'TH#';

export function buildAdvertisedName(gameCode: string): string {
  return `${ADVERTISED_NAME_PREFIX}${gameCode}`;
}

/**
 * Recover the game code from an advertised local name.
 * Returns null when the name is not one of ours.
 */
export function parseAdvertisedName(name: string | null | undefined): string | null {
  if (!name || !name.startsWith(ADVERTISED_NAME_PREFIX)) {
    return null;
  }
  const code = name.slice(ADVERTISED_NAME_PREFIX.length).trim();
  return /^[0-9]{4}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------------
// MTU and framing
// ---------------------------------------------------------------------------

/**
 * BLE 4.0 default ATT MTU. Three bytes go to the ATT header, leaving 20 bytes
 * of payload. Everything must work at this size before negotiation succeeds.
 */
export const ATT_DEFAULT_MTU = 23;
export const ATT_HEADER_BYTES = 3;

/**
 * MTU we ask for on Android. iOS negotiates automatically and does not expose a
 * request API -- CoreBluetooth typically settles at 185 bytes.
 */
export const ANDROID_REQUESTED_MTU = 512;

/** Assumed MTU on iOS until the peripheral reports its real limit. */
export const IOS_ASSUMED_MTU = 185;

/**
 * Platform-specific MTU defaults live in ble/transport/mtu.ts. This module is
 * deliberately free of react-native imports so the config layer stays pure and
 * unit-testable outside a native runtime.
 */

/** Bytes of framer header prepended to every fragment. See Framer.ts. */
export const FRAME_HEADER_BYTES = 9;

/** Usable payload bytes per BLE packet at a given MTU. */
export function payloadBytesForMtu(mtu: number): number {
  return Math.max(1, mtu - ATT_HEADER_BYTES - FRAME_HEADER_BYTES);
}

/** Hard cap on a single reassembled message; guards against a hostile peer. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Drop a partially reassembled message if it stalls for this long. */
export const REASSEMBLY_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Reliability
// ---------------------------------------------------------------------------

export const RELIABILITY = {
  /** Wait this long for an ACK before the first retry. */
  ackTimeoutMs: 900,
  /** Each retry multiplies the wait by this factor. */
  backoffFactor: 1.7,
  /** Never wait longer than this between retries. */
  maxBackoffMs: 6000,
  /** Give up after this many sends (1 original + N-1 retries). */
  maxAttempts: 5,
  /** How many recently seen message ids to remember per peer. */
  dedupeWindow: 512,
  /** Minimum gap between writes on a single link, to avoid flooding it. */
  minSendIntervalMs: 12,
  /** Outbound queue depth per peer before the oldest unreliable msg is dropped. */
  maxQueueDepth: 96,
} as const;

// ---------------------------------------------------------------------------
// Scanning / connecting / reconnecting
// ---------------------------------------------------------------------------

export const SCAN = {
  /** Stop an unattended scan after this long to save battery. */
  timeoutMs: 30000,
  /**
   * Re-issue the underlying scan this often while the scanner is running.
   *
   * Two reasons. The platform scan stops itself after `timeoutMs`, which used
   * to leave the join list silently dead while the screen still claimed to be
   * scanning. And `allowDuplicates` is not honoured everywhere -- notably the
   * Android emulator reports a device once and then goes quiet -- so without a
   * periodic sweep a host that is still there ages out and vanishes.
   *
   * Android throttles an app to 5 scan starts per 30 s, so keep this well
   * above 6 s.
   */
  refreshMs: 10000,
  /**
   * Forget a discovered host not seen again within this window. Must stay
   * comfortably above `refreshMs`, or a host still present is pruned between
   * sweeps.
   */
  staleHostMs: 25000,
  /** Throttle duplicate advertisement callbacks to this interval. */
  dedupeIntervalMs: 500,
} as const;

export const CONNECTION = {
  connectTimeoutMs: 12000,
  /** Delay before the first reconnect attempt. */
  reconnectBaseDelayMs: 800,
  reconnectBackoffFactor: 1.8,
  reconnectMaxDelayMs: 15000,
  /** 0 = keep trying until the user cancels. */
  reconnectMaxAttempts: 0,
  /** Heartbeat interval used to detect a half-open link. */
  pingIntervalMs: 4000,
  /** Treat the link as dead if no traffic arrives for this long. */
  linkIdleTimeoutMs: 14000,
} as const;

/**
 * Practical ceiling on simultaneous centrals. Android GATT servers commonly cap
 * around 7 concurrent links and iOS is similar; beyond that, throughput per
 * player degrades badly. The lobby enforces this independently of game config.
 */
export const MAX_CONCURRENT_PEERS = 7;
