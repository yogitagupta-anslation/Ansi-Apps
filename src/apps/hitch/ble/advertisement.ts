import type {Proximity, RideMode, Role, VehicleKind} from '../types';

/**
 * What a Hitch phone says about itself before anyone connects to it.
 *
 * This is the whole reason the Nearby list can exist. A discovery screen showing fifteen
 * vehicles cannot open a GATT connection to fifteen phones to find out what they are —
 * that is fifteen connection attempts against a radio that holds about six links, and it
 * would take a minute to fill a list that has to feel instant. So everything the list
 * needs travels in the ADVERTISEMENT itself, which is broadcast continuously and readable
 * by any scanner without a connection at all.
 *
 * The payload rides in the manufacturer-data field that the peripheral module already
 * writes. Its layout, which this app did not invent and does not change:
 *
 *   [0..1]  company id, little-endian
 *   [2]     version
 *   [3..10] peer-id prefix, 8 bytes
 *   [11..13] a 24-bit little-endian field
 *   [14..]  display name, ASCII
 *
 * BLE Chat uses that 24-bit field for an interest bitmask. Hitch uses the same three bytes
 * for its own state — role, vehicle, availability — because it is the one channel the
 * existing native advertiser already exposes, and reusing it means Phase 2 needs no new
 * Kotlin at all. The two apps never confuse each other: they advertise under different
 * service UUIDs, so a scanner filtering for Hitch's UUID never sees BLE Chat's phones.
 *
 * Twenty-four bits is a lot for four facts, and the spare room is deliberate — this is a
 * broadcast format, so anything added later has to be readable by phones running today's
 * build. Unknown bits are ignored rather than rejected.
 */

/** Hitch's own service UUID. Different from BLE Chat's, so the two never mix. */
export const HITCH_SERVICE_UUID = '9c4e0001-7f31-4d2a-9a6b-5e8c1d0f3b72';
export const HITCH_RX_CHAR_UUID = '9c4e0002-7f31-4d2a-9a6b-5e8c1d0f3b72';
export const HITCH_TX_CHAR_UUID = '9c4e0003-7f31-4d2a-9a6b-5e8c1d0f3b72';

/** Matches what the native advertiser writes, and what BLE Chat's parser expects. */
export const HITCH_COMPANY_ID = 0xffff;
const PREFIX_BYTES = 8;
const STATE_BYTES = 3;

/** Bumped only if the LAYOUT changes. New bits inside the state field do not need it. */
export const ADV_VERSION = 2;

/**
 * The state field, bit by bit.
 *
 *   0-1  vehicle kind
 *   2    role: 0 passenger, 1 rider
 *   3    available for a ride right now
 *   4    will carry a parcel
 *   5-23 spare
 */
const KIND_BITS: Record<VehicleKind, number> = {bike: 0, auto: 1, cab: 2, other: 3};
const KIND_FROM_BITS: VehicleKind[] = ['bike', 'auto', 'cab', 'other'];

export interface HitchState {
  role: Role;
  vehicleKind: VehicleKind;
  available: boolean;
  carriesParcels: boolean;
}

export function encodeState(state: HitchState): number {
  let bits = KIND_BITS[state.vehicleKind] & 0b11;
  if (state.role === 'rider') {
    bits |= 1 << 2;
  }
  if (state.available) {
    bits |= 1 << 3;
  }
  if (state.carriesParcels) {
    bits |= 1 << 4;
  }
  return bits;
}

export function decodeState(bits: number): HitchState {
  return {
    vehicleKind: KIND_FROM_BITS[bits & 0b11] ?? 'auto',
    role: (bits >> 2) & 1 ? 'rider' : 'passenger',
    available: !!((bits >> 3) & 1),
    carriesParcels: !!((bits >> 4) & 1),
  };
}

/** What a scan actually recovered from one advertisement. */
export interface HitchAdvertisement {
  peerIdPrefix: string;
  name: string | null;
  state: HitchState;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function decodeAscii(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    // Printable ASCII only. A name is chosen by a stranger's phone, so anything outside
    // that range is dropped rather than rendered — a control character in a list row is
    // at best a broken glyph and at worst a way to make one row impersonate another.
    if (b >= 32 && b < 127) {
      out += String.fromCharCode(b);
    }
  }
  return out.trim();
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob
    ? globalThis.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Read one advertisement, or null if it is not a Hitch phone.
 *
 * Every byte here was chosen by another device, so nothing is trusted: lengths are
 * checked before they are indexed, the name is bounded and filtered, and a payload that
 * does not parse is simply not a Hitch peer rather than an error. A scanner runs this
 * against every advertisement in a crowded street, several times a second.
 */
export function parseHitchAdvertisement(
  manufacturerDataBase64: string | null,
  localName: string | null,
): HitchAdvertisement | null {
  if (!manufacturerDataBase64) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(manufacturerDataBase64);
  } catch {
    return null;
  }

  const header = 2 + 1 + PREFIX_BYTES + STATE_BYTES;
  if (bytes.length < header) {
    return null;
  }
  const companyId = bytes[0] | (bytes[1] << 8);
  if (companyId !== HITCH_COMPANY_ID) {
    return null;
  }
  const version = bytes[2];
  if (version < ADV_VERSION) {
    // A build older than the state field has nothing this list can show.
    return null;
  }

  const prefix = bytesToHex(bytes.subarray(3, 3 + PREFIX_BYTES));
  const stateAt = 3 + PREFIX_BYTES;
  const bits =
    bytes[stateAt] | (bytes[stateAt + 1] << 8) | (bytes[stateAt + 2] << 16);

  const name =
    bytes.length > header ? decodeAscii(bytes.subarray(header, header + 24)) : null;

  return {
    peerIdPrefix: prefix,
    name: name || localName || null,
    state: decodeState(bits),
  };
}

/**
 * Signal strength, as one of the three words this app is willing to say.
 *
 * The thresholds are the ones BLE Chat's own diagnostics teach — around −50 is very
 * close, −90 is the edge of usable range — and the bands are wide because the underlying
 * number is not stable to anything finer. A phone in a trouser pocket reads perhaps 15
 * dBm weaker than the same phone held up, at the same distance; a body between the two
 * costs more than that again. Any attempt to turn this into metres would be inventing
 * precision the radio does not have, which is why nothing downstream can even ask for it.
 */
export function proximityFromRssi(rssi: number): Proximity {
  if (rssi >= -60) {
    return 'veryClose';
  }
  if (rssi >= -80) {
    return 'near';
  }
  return 'far';
}

/**
 * A stable seat on the map's dial, derived from the peer id.
 *
 * Not a bearing — the radio cannot give one. It exists so a vehicle does not jump to a
 * new angle every time its RSSI updates, which it would if the position were random.
 */
export function bearingFor(peerIdPrefix: string): number {
  let h = 2166136261;
  for (let i = 0; i < peerIdPrefix.length; i++) {
    h = Math.imul(h ^ peerIdPrefix.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 360;
}

/** Only the modes a rider can be in are worth advertising availability for. */
export function isOfferingRides(state: HitchState, mode: RideMode): boolean {
  return state.role === 'rider' && state.available && (mode === 'ride' || state.carriesParcels);
}
