/**
 * BleAdvertisementParser.ts
 * -----------------------------------------------------------------------------
 * Turns a raw react-native-ble-plx scan result into either "one of our
 * employees" or "not our app". Pure functions, no side effects, no state - so
 * the parsing rules can be reasoned about and unit-tested in isolation.
 *
 * The Host must never treat an arbitrary nearby Bluetooth device as an
 * employee. Every advertisement has to prove it belongs to this application
 * before its payload is even looked at.
 * -----------------------------------------------------------------------------
 */

import type { Device } from 'react-native-ble-plx';
import {
  CHECKOUT_UUID_16_FULL,
  MANUFACTURER_ID,
  PROTOCOL_VERSION,
  SERVICE_UUID_128,
  SERVICE_UUID_16_FULL,
} from '../constants/bluetoothConfig';
import { base64ToBytes, bytesToAscii, bytesToHex, normalizeUuid } from '../utils/bytes';

/** Which of the independent identification signals were present. */
export type MatchSignal =
  | 'serviceUuid16'
  | 'serviceUuid128'
  | 'serviceData'
  | 'manufacturerData';

export interface ParsedAdvertisement {
  /** True only when this advertisement provably belongs to our application. */
  isOurApp: boolean;
  /** The advertised employee id, or null if the payload did not parse. */
  employeeId: string | null;
  protocolVersion: number | null;
  matchedBy: MatchSignal[];
  /** Raw manufacturer bytes, for the Debug screen. */
  rawManufacturerHex: string | null;
  /** Set when the advertisement looked like ours but the payload was corrupt. */
  malformed: boolean;
  /**
   * The employee is declaring a departure right now.
   *
   * Present only while a check-out is pending on their phone, so its ABSENCE
   * is not evidence of anything — an older employee build never sends it, and
   * an active scan is needed to see the scan response at all. Treat a true as
   * a statement and a false as silence, never as "they are still here".
   */
  checkOutIntent: boolean;
}

const NOT_OURS: ParsedAdvertisement = {
  isOurApp: false,
  employeeId: null,
  protocolVersion: null,
  matchedBy: [],
  rawManufacturerHex: null,
  malformed: false,
  checkOutIntent: false,
};

/**
 * Extract [version][employeeId] from the manufacturer-specific data.
 *
 * VERIFIED against react-native-ble-plx 3.5.1 source
 * (android/src/main/java/com/bleplx/adapter/AdvertisementData.java,
 * parseManufacturerData): the library copies the whole AD data region, so
 * `manufacturerData` INCLUDES the 2-byte little-endian company id. It does NOT
 * strip it. This deliberately matches iOS CoreBluetooth, and differs from
 * Android's own ScanRecord.getManufacturerSpecificData(int), which uses the
 * company id as a map key and removes it - so code ported from a native Android
 * sample is off by two bytes.
 *
 * Layout A is therefore the real one. Layout B is still accepted as a fallback,
 * because the cost is three lines and the failure mode it guards against
 * (a library change, or a different platform) is a total silent detection
 * failure that looks identical to "no employees are nearby".
 *
 *   layout A:  [companyLo][companyHi][version][employeeId ASCII...]   <- actual
 *   layout B:  [version][employeeId ASCII...]                         <- fallback
 */
function parseManufacturerPayload(
  bytes: number[],
): { employeeId: string; protocolVersion: number } | null {
  if (bytes.length < 2) {
    return null;
  }

  // Splitting a 16-bit company id into little-endian bytes is inherently bitwise.
  // eslint-disable-next-line no-bitwise
  const companyLo = MANUFACTURER_ID & 0xff;
  // eslint-disable-next-line no-bitwise
  const companyHi = (MANUFACTURER_ID >> 8) & 0xff;

  let offset: number;

  if (
    bytes.length >= 3 &&
    bytes[0] === companyLo &&
    bytes[1] === companyHi &&
    bytes[2] === PROTOCOL_VERSION
  ) {
    offset = 2; // layout A - company id present
  } else if (bytes[0] === PROTOCOL_VERSION) {
    offset = 0; // layout B - company id already stripped
  } else {
    return null;
  }

  const protocolVersion = bytes[offset];
  const idBytes = bytes.slice(offset + 1);

  if (idBytes.length === 0) {
    return null;
  }

  const employeeId = bytesToAscii(idBytes).trim();

  // bytesToAscii substitutes '.' for any non-printable byte, so a payload that
  // arrived corrupted shows up as dots rather than being accepted as an id.
  if (employeeId.length === 0 || employeeId.includes('.')) {
    return null;
  }

  return { employeeId, protocolVersion };
}

/**
 * Decide whether a scan result belongs to this application, and if so, which
 * employee id it carries.
 *
 * An advertisement counts as ours when EITHER service UUID matches, OR the
 * manufacturer payload parses cleanly into our format. Any one signal suffices,
 * which keeps detection working if a particular handset drops one of them - and
 * `matchedBy` records which ones actually arrived so partial matches are
 * visible rather than mysterious.
 */
export function parseAdvertisement(device: Device): ParsedAdvertisement {
  const matchedBy: MatchSignal[] = [];

  const uuids = (device.serviceUUIDs || []).map(normalizeUuid);
  if (uuids.includes(SERVICE_UUID_16_FULL)) {
    matchedBy.push('serviceUuid16');
  }

  /**
   * Deliberately NOT added to matchedBy: this UUID must never make an
   * advertisement count as ours on its own. It is a modifier on an
   * advertisement already identified by the signals above — otherwise any
   * device that happened to advertise 0xF00E would be read as an employee
   * declaring a departure.
   */
  const checkOutIntent = uuids.includes(CHECKOUT_UUID_16_FULL);
  if (uuids.includes(normalizeUuid(SERVICE_UUID_128))) {
    matchedBy.push('serviceUuid128');
  }

  const serviceDataKeys = Object.keys(device.serviceData || {}).map(normalizeUuid);
  if (
    serviceDataKeys.includes(SERVICE_UUID_16_FULL) ||
    serviceDataKeys.includes(normalizeUuid(SERVICE_UUID_128))
  ) {
    matchedBy.push('serviceData');
  }

  const manufacturerBytes = base64ToBytes(device.manufacturerData);
  const payload = parseManufacturerPayload(manufacturerBytes);

  if (payload) {
    matchedBy.push('manufacturerData');
  }

  if (matchedBy.length === 0) {
    return NOT_OURS;
  }

  const rawManufacturerHex =
    manufacturerBytes.length > 0 ? bytesToHex(manufacturerBytes) : null;

  // A service UUID matched, so this IS our app - but the payload did not parse.
  // Report it as malformed rather than silently ignoring it, so a wire-format
  // bug is visible on the Debug screen instead of looking like "no employees".
  if (!payload) {
    return {
      isOurApp: true,
      employeeId: null,
      protocolVersion: null,
      matchedBy,
      rawManufacturerHex,
      malformed: true,
      checkOutIntent,
    };
  }

  return {
    isOurApp: true,
    employeeId: payload.employeeId,
    protocolVersion: payload.protocolVersion,
    matchedBy,
    checkOutIntent,
    rawManufacturerHex,
    malformed: false,
  };
}

/** Build the manufacturer payload the Employee broadcasts. Inverse of the parser. */
export function buildManufacturerPayload(employeeId: string): number[] {
  const bytes: number[] = [PROTOCOL_VERSION];
  for (let i = 0; i < employeeId.length; i++) {
    const code = employeeId.charCodeAt(i);
    if (code <= 0x7f) {
      bytes.push(code);
    }
  }
  return bytes;
}
