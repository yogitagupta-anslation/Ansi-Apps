/**
 * Every radio identifier the game uses, in one place.
 *
 * The UUIDs are this app's own — deliberately unrelated to the other BLE apps
 * sharing this binary, so a scan for a Higher or Lower room can never surface a
 * chat peer and vice versa.
 */

/** 128-bit GATT service a hosting phone advertises. */
export const HL_SERVICE_UUID = '6f1e0001-3b7c-4d2a-9f18-5c7a2e9b41d0';

/** Joiners WRITE here; the host receives it. */
export const HL_RX_CHAR_UUID = '6f1e0002-3b7c-4d2a-9f18-5c7a2e9b41d0';

/** The host NOTIFIES here; joiners receive it. */
export const HL_TX_CHAR_UUID = '6f1e0003-3b7c-4d2a-9f18-5c7a2e9b41d0';

/** SIG-reserved "internal use" company id, same one the peripheral module emits. */
export const HL_MANUFACTURER_ID = 0xffff;

/**
 * Prefix the shared native peripheral puts on the iOS advertised local name.
 * iOS cannot advertise manufacturer data at all, so on that platform the whole
 * advert arrives as `BC-<16 hex><6 hex>` and is parsed back out of the name.
 */
export const HL_LOCAL_NAME_PREFIX = 'BC-';

/** Ask for enough MTU that a protocol message fits in a single write. */
export const REQUESTED_MTU = 185;

/** What every BLE stack guarantees before negotiation: 23 bytes, 20 usable. */
export const DEFAULT_ATT_MTU = 23;

export const CONNECT_TIMEOUT_MS = 12_000;

/** A room that has not been seen for this long has walked out of range. */
export const ROOM_STALE_MS = 9_000;

/** How many phones a host may let in, including themselves. */
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 8;
export const DEFAULT_CAPACITY = 4;
