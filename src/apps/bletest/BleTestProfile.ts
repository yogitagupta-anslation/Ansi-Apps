/**
 * The isolated GATT proof-of-concept profile.
 *
 * This exists to answer one question and nothing else: can two physical Android
 * phones running this APK open a real GATT link and exchange two short
 * messages? No identity, no rotation, no fragmentation, no state machine. If
 * this does not work, nothing built on top of it can.
 *
 * The UUIDs below were checked against every UUID in the repository — EventPulse
 * (`7e9f1a2x`), Treasure Hunt (`7b4b1f6x`), BleChat (`6f1e000x`, `7a0b000x`),
 * Attendance (`0xFDCF`, `6f2a1c4x`) — and the `9c4d7e1x` range collides with
 * none of them. That matters more than it sounds: the peripheral manager is a
 * process-wide singleton shared by every app in this hub, so a clashing service
 * UUID would have one app's test tearing down another app's live service.
 */

/** The service both phones advertise and scan for. */
export const TEST_SERVICE_UUID = '9c4d7e10-8f2b-4a63-b5d1-0e7c3a9f6b20';

/** Central -> peripheral. Written by the phone that dialled. */
export const TEST_CHAR_RX_UUID = '9c4d7e11-8f2b-4a63-b5d1-0e7c3a9f6b20';

/** Peripheral -> central, by notification. The reply path. */
export const TEST_CHAR_TX_UUID = '9c4d7e12-8f2b-4a63-b5d1-0e7c3a9f6b20';

/**
 * The entire protocol.
 *
 * Two ASCII strings, short enough to fit the 20-byte payload of the default
 * 23-byte ATT MTU, so the test proves the link rather than the fragmenter. If
 * these arrive intact, GATT works.
 */
export const HELLO_REQUEST = 'HELLO_REQUEST';
export const HELLO_RESPONSE = 'HELLO_RESPONSE';

/**
 * What the peripheral puts in its advertisement as the local name.
 *
 * Only a human-readable label for the tester — it carries no identity and
 * nothing matches on it. A 128-bit service UUID already costs 18 of the 31
 * advertisement bytes, so this stays short by necessity as much as by choice.
 */
export const TEST_LOCAL_NAME_PREFIX = 'BLETEST';

/** How long the central waits for a link before giving up. */
export const CONNECT_TIMEOUT_MS = 15_000;
