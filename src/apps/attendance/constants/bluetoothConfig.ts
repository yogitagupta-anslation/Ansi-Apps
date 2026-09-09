/**
 * bluetoothConfig.ts
 * -----------------------------------------------------------------------------
 * Single source of truth for every BLE constant and tunable.
 *
 * DIRECTION OF COMMUNICATION
 * -----------------------------------------------------------------------------
 *      EMPLOYEE PHONE                        HOST PHONE
 *      BluetoothLeAdvertiser   ~~~~~~~~>     BluetoothLeScanner
 *      (native Kotlin module)     BLE        (react-native-ble-plx)
 *      broadcasts employeeId              resolves it against the local
 *      (+ the check-out UUID in           employee registry, reads RSSI,
 *       the scan response while a         marks attendance
 *       check-out is pending)
 *
 *      GATT server             <~~~~~~~~    GATT client
 *      (BleAdvertiseService)     write      (StatusDeliveryService, ble-plx)
 *      receives the status                connects and writes the report it
 *      report and displays it             just recorded, then disconnects
 *
 * The Employee advertises and the Host scans - but the path is NOT one-way. The
 * advertisement is CONNECTABLE (connectable: true, BleAdvertiser.ts), so while
 * it is up the phone accepts BLE connections unconditionally - setConnectable is
 * applied whatever else is true. Given BLUETOOTH_CONNECT and both UUIDs, it also
 * runs a GATT server holding a single write-only characteristic, and that is the
 * only channel by which an employee is ever told their own check-in: the Host
 * connects, writes the status report, disconnects. Without that permission the
 * advertisement is still connectable, but the reply channel silently does not
 * exist and the employee is never told anything.
 *
 * No pairing or bonding is involved, and that is a trade-off, not a safeguard.
 * The characteristic is PERMISSION_WRITE - unencrypted, unauthenticated - and
 * the write callback never inspects who wrote. Any central in range can connect
 * and write; the only gate is the strict JS decoder plus an own-employee-id
 * match, and that id is broadcast in the clear. See the TRUST BOUNDARY note in
 * bluetooth/statusReport.ts, where this is documented as an accepted risk.
 *
 * Both phones must run a build with identical values in this file, or the Host
 * will never recognise the Employee's advertisement.
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. BLE IDENTIFIERS
 * -----------------------------------------------------------------------------
 * Two independent signals let the Host tell our app apart from the dozens of
 * unrelated BLE devices in any room (earbuds, TVs, watches, tiles):
 *
 *   a) a 16-bit service UUID in the primary advertisement  -> cheap, always seen
 *   b) manufacturer data carrying protocol version + employee id
 *   c) a full 128-bit service UUID in the scan response    -> strong confirmation
 * ========================================================================== */

/**
 * 16-bit service UUID, sent in the PRIMARY advertising packet.
 *
 * Why 16-bit: a 128-bit UUID costs 18 of the 31 available bytes, leaving no room
 * for the employee id. A 16-bit UUID costs 4. Android encodes any UUID matching
 * the Bluetooth Base UUID pattern (0000XXXX-0000-1000-8000-00805F9B34FB) down to
 * its 2-byte form on air automatically.
 *
 * 0xF00D sits outside every range the Bluetooth SIG has assigned, so a collision
 * with a commercial product is very unlikely. It is not a registered value -
 * fine for a prototype, not for a shipping product.
 */
export const SERVICE_UUID_16 = 'f00d';
export const SERVICE_UUID_16_FULL =
  '0000' + SERVICE_UUID_16 + '-0000-1000-8000-00805f9b34fb';

/**
 * 16-bit service UUID the EMPLOYEE adds to its SCAN RESPONSE while, and only
 * while, a check-out is pending. Its presence IS the message; it carries no
 * payload of its own.
 *
 * WHY THIS AND NOT THE MANUFACTURER PAYLOAD. The payload is version-framed —
 * parseManufacturerPayload accepts a packet only when the version byte matches
 * exactly, and the employee id runs to the end of the buffer, so an appended
 * byte is either swallowed into the id or rejected as corrupt. Any change there
 * breaks every phone running an older build, in the way that looks exactly like
 * "nobody is nearby". An extra service UUID is invisible to a build that does
 * not look for it: old Hosts ignore it, old employees never send it, and
 * PROTOCOL_VERSION does not move.
 *
 * WHY NOT A GATT READ. The Host only connects when it has something to deliver,
 * so a characteristic holding this would sit unread until something else
 * happened to trigger a connection — minutes, on a busy registry. This rides
 * the advertisement, so the Host sees it on the next scan: about a second,
 * which is what makes "tap and walk out" work at all.
 *
 * BUDGET: the scan response holds the 128-bit UUID at 18 bytes of its own
 * 31-byte allowance. A 16-bit UUID costs 4, for 22. Fits.
 *
 * PRIVACY NOTE: this is world-readable, like the rest of the advertisement.
 * Anyone sniffing the air learns that some opaque id is about to leave — the
 * same class of exposure as the id itself, which is already public.
 */
export const CHECKOUT_UUID_16 = 'f00e';
export const CHECKOUT_UUID_16_FULL =
  '0000' + CHECKOUT_UUID_16 + '-0000-1000-8000-00805f9b34fb';

/**
 * Full random 128-bit service UUID, sent in the SCAN RESPONSE packet, which has
 * its own separate 31-byte budget. Effectively collision-proof.
 *
 * Only visible on an ACTIVE scan. Android's SCAN_MODE_LOW_LATENCY scans
 * actively, so in practice it arrives - but detection never depends on it. It
 * is treated as bonus confirmation only.
 */
export const SERVICE_UUID_128 = '6f2a1c40-9d3b-4e18-9a77-0b5c8e2d41f3';

/**
 * Company identifier for the manufacturer-specific data field.
 * 0xFFFF is reserved by the Bluetooth SIG for internal use and testing, which is
 * exactly what this is. A shipping product needs a real member ID.
 */
export const MANUFACTURER_ID = 0xffff;

/**
 * GATT characteristic on the EMPLOYEE device that the HOST writes attendance
 * status reports into — the reply channel. Lives inside the 128-bit service.
 * Same base UUID as the service with the low byte of the first group bumped,
 * so the pair is visibly related in any BLE inspector.
 */
export const STATUS_CHAR_UUID = '6f2a1c41-9d3b-4e18-9a77-0b5c8e2d41f3';

/**
 * Protocol version, the first byte of the manufacturer payload. Lets a future
 * build change the wire format without an older Host misreading it.
 */
export const PROTOCOL_VERSION = 0x01;

/* =============================================================================
 * 2. ADVERTISING PAYLOAD BUDGET  (Android legacy advertising = 31 bytes)
 * -----------------------------------------------------------------------------
 * Primary advertising packet:
 *   AD flags (Android adds this automatically)              3 bytes
 *   16-bit service UUID   (len + type + 2)                  4 bytes
 *   manufacturer data     (len + type + 2 company + N)   4 + N bytes
 *                                                      --------------
 *   with N = 1 version byte + 7 employee id bytes        = 19 bytes  <= 31  OK
 *
 * Scan response packet (its own separate 31-byte budget):
 *   128-bit service UUID  (len + type + 16)                18 bytes
 *   16-bit check-out UUID (len + type + 2), only while pending  4 bytes
 *                                                      --------------
 *                                                       = 22 bytes  <= 31  OK
 *
 * setIncludeDeviceName(false) is essential - the device name is appended to the
 * primary packet and overflows it, producing ADVERTISE_FAILED_DATA_TOO_LARGE.
 *
 * WHAT IS DELIBERATELY *NOT* BROADCAST
 * -----------------------------------------------------------------------------
 * The employee's NAME, department, phone and email are never advertised - the
 * Host resolves the name locally from its own registry. What DOES go on air is
 * the employee id in plain ASCII, the service UUIDs, and - while a check-out is
 * pending - the check-out UUID.
 *
 * Do not read that as anonymity. The id is free text the employee types,
 * validated only against /^[A-Za-z0-9_-]+$/ and the byte cap below, so
 * "JAISMEET-KAUR" is a legal id; opacity is a property of whatever scheme an
 * administrator chooses, not something this app enforces. And even a genuinely
 * opaque id is a STABLE identifier repeated at LOW_LATENCY / TX_POWER_HIGH,
 * which defeats the platform's BLE address rotation for anyone who links it to
 * a face once.
 * ========================================================================== */

/**
 * Maximum employee id length in bytes, derived from the budget above:
 *   31 - 3 (flags) - 4 (uuid16) - 4 (mfg header) - 1 (version) = 19
 * "EMP_001" is 7 bytes, leaving plenty of headroom.
 */
export const MAX_EMPLOYEE_ID_BYTES = 19;

/* =============================================================================
 * 3. PROXIMITY  (RSSI)
 * -----------------------------------------------------------------------------
 * !! RSSI IS NOT A DISTANCE MEASUREMENT !!
 *
 * RSSI is received signal strength in dBm. Stronger (closer to zero) generally
 * means nearer. That is the entire guarantee. It is never converted to metres
 * anywhere in this app, and it must not be.
 *
 * It is affected by: transmit power (varies widely between phone models),
 * antenna placement and grip, the human body (2.4 GHz is absorbed badly - a body
 * between two phones can cost 15-20 dBm, more than several metres of clear air),
 * cases, walls, metal, Wi-Fi interference, and multipath reflections that can
 * make a FARTHER phone read STRONGER.
 *
 * Two phones at the same distance can differ by 20 dBm. Treat these thresholds
 * as "tune them for your room", not as physics.
 * ========================================================================== */

/** At or above this, an employee counts as NEARBY and is eligible for check-in. */
export const DEFAULT_RSSI_THRESHOLD = -65;

/** Qualitative signal bands for display. Never expressed as distance. */
export const RSSI_STRONG = -60;
export const RSSI_MEDIUM = -75;

export type ProximityBand = 'STRONG' | 'MEDIUM' | 'WEAK';

/**
 * Number of raw RSSI samples averaged before the threshold is applied. Raw BLE
 * RSSI is very noisy; a short moving average removes most of the jitter at the
 * cost of about a second of lag.
 */
export const RSSI_SMOOTHING_WINDOW = 5;

/* =============================================================================
 * 4. DETECTION CONFIDENCE
 * ========================================================================== */

/**
 * Consecutive NEARBY readings required before attendance is marked. A single
 * strong reading can be a multipath reflection from across the room; a run of
 * them cannot. Configurable in Settings.
 */
export const DEFAULT_REQUIRED_NEARBY_READINGS = 3;

/**
 * An employee is reported as no longer detected if no advertisement arrives
 * within this window. This affects the LIVE PROXIMITY display only - it never
 * affects attendance, which is a permanent check-in event.
 */
export const DEFAULT_DETECTION_TIMEOUT_MS = 10000;

/* =============================================================================
 * 5. SCANNING BEHAVIOUR
 * ========================================================================== */

/**
 * BLE scan callbacks fire many times per second. Pushing each one into React
 * state would re-render the employee list constantly and drop frames, so
 * callbacks accumulate in a map and the UI is refreshed on this interval.
 */
export const UI_REFRESH_MS = 500;

/** Unknown (non-app) devices are dropped from the debug list after this long. */
export const UNKNOWN_DEVICE_STALE_MS = 15000;

/**
 * Android throttles an app that calls startScan more than 5 times in a
 * 30-second window. When throttled the scan silently returns nothing, so the
 * scanner warns as this limit is approached.
 */
export const SCAN_THROTTLE_WINDOW_MS = 30000;
export const SCAN_THROTTLE_LIMIT = 5;

/* =============================================================================
 * 6. DEBUG
 * ========================================================================== */

/** Log every scan callback. Extremely noisy - off by default. */
export const DEFAULT_VERBOSE_LOGGING = false;

/** Lines kept in the in-app log buffer. */
export const LOG_BUFFER_SIZE = 300;
