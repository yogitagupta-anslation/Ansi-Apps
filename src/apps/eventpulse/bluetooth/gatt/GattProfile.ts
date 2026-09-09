/**
 * The EventPulse GATT profile.
 *
 * WHERE THIS SITS RELATIVE TO THE PRESENCE BEACON
 * -----------------------------------------------
 * EventPulse has two independent radio channels and they must not be confused:
 *
 *   1. PRESENCE (existing, untouched by this module). A connectionless 16-bit
 *      service-data advertisement on 0xFDCF carrying the 13-21 byte frame from
 *      `BleProtocol.ts`, emitted by the hand-written `EventPulseBle` native
 *      module. This is what draws the radar. It is deliberately
 *      non-connectable (`EventPulseBleModule.kt:310`).
 *
 *   2. GATT (this module). A connection-oriented link on a real 128-bit service
 *      UUID, used only after two people have found each other and decided to
 *      exchange something. It carries the payloads the 24-byte advertisement
 *      budget can never hold: a full profile card, a connection request, an
 *      acknowledgement.
 *
 * Channel 1 discovers; channel 2 converses. Nothing here changes the frame, the
 * beacon, or the native presence module.
 *
 * THE iOS RULE THAT THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------
 * A UUID is an identifier, never a container. `EventPulseBle.swift:180` learned
 * this the hard way: it built a `CBUUID` out of a 13-21 byte advertisement
 * payload, and `CBUUID(data:)` accepts only 2, 4 or 16 bytes, so it raises an
 * Objective-C exception Swift cannot catch. Every UUID below is a fixed,
 * hard-coded 128-bit constant. No function in this module, or in any transport
 * built on it, may derive a UUID from data. Payload travels in characteristic
 * VALUES, which have no such restriction.
 *
 * TOPOLOGY
 * --------
 * Symmetric, unlike Treasure Hunt's star. Every device runs both roles: it
 * hosts the service so others can reach it, and it connects out when the user
 * chooses someone. Two characteristics carry all traffic on a link:
 *
 *   TX  notify  server -> client
 *   RX  write   client -> server
 *
 * A "server" here is whichever side was connected TO. There is no host.
 */

/**
 * The service. This is `EVENTPULSE_SERVICE_UUID_128`, declared in
 * `BleProtocol.ts` since the beginning and until now never imported by
 * anything — it was reserved for exactly this. Kept as a literal rather than an
 * import so this module stays free of the advertisement codec.
 */
export const GATT_SERVICE_UUID = '7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10';

/** Server -> client. Notify. The client subscribes on connect. */
export const GATT_CHAR_TX_UUID = '7e9f1a21-4b3c-4f0e-9c2d-1f4b7a6c5d10';

/** Client -> server. Write with response. */
export const GATT_CHAR_RX_UUID = '7e9f1a22-4b3c-4f0e-9c2d-1f4b7a6c5d10';

/** Every UUID this profile uses, for validation and for scan filters. */
export const GATT_UUIDS = [GATT_SERVICE_UUID, GATT_CHAR_TX_UUID, GATT_CHAR_RX_UUID] as const;

const UUID_128_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * True for a canonical lowercase 128-bit UUID string.
 *
 * Used by the profile's own tests to prove no UUID here could ever be mistaken
 * for a payload, and by the native transport to refuse a malformed id before it
 * reaches CoreBluetooth.
 */
export function isValidUuid128(value: string): boolean {
  return UUID_128_PATTERN.test(value);
}

/* ------------------------------------------------------------------ *
 * MTU
 * ------------------------------------------------------------------ */

/** BLE 4.0 default ATT MTU. Three bytes are the ATT header, leaving 20. */
export const ATT_DEFAULT_MTU = 23;
export const ATT_HEADER_BYTES = 3;

/**
 * What we ask Android for. iOS has no request API — CoreBluetooth negotiates on
 * its own and settles around 185.
 */
export const ANDROID_REQUESTED_MTU = 512;
export const IOS_ASSUMED_MTU = 185;

/** Bytes of `GattFraming` header on every fragment. */
export const FRAME_HEADER_BYTES = 9;

/**
 * Usable payload bytes per packet at a given MTU, after the ATT header and our
 * own fragment header.
 *
 * Never returns less than 1: a zero would make `fragment()` loop forever, and a
 * negative would silently produce empty frames. An MTU below the BLE minimum is
 * a broken stack, not an input we should honour.
 */
export function payloadBytesForMtu(mtu: number): number {
  if (!Number.isFinite(mtu)) return 1;
  return Math.max(1, Math.floor(mtu) - ATT_HEADER_BYTES - FRAME_HEADER_BYTES);
}

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

/**
 * Hard cap on one reassembled message. A peer is not trusted: without this a
 * hostile or broken device could pin memory by never finishing a group.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Abandon a partially reassembled message that stops making progress. */
export const REASSEMBLY_TIMEOUT_MS = 8_000;

/** Give up on a connection attempt that has not completed. */
export const CONNECT_TIMEOUT_MS = 12_000;

/**
 * Concurrent outbound links. Android GATT commonly degrades past a handful and
 * iOS is similar; a conference radar can show hundreds of people, so this is a
 * ceiling the session layer enforces rather than a number the radio gives us.
 */
export const MAX_CONCURRENT_LINKS = 4;
