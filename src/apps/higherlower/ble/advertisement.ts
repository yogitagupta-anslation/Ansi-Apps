import { Range } from '../types/game';
import { bytesToHex, hexToBytes, utf8Decode, base64ToBytes } from './bytes';
import { HL_LOCAL_NAME_PREFIX, HL_MANUFACTURER_ID, MAX_CAPACITY, MIN_CAPACITY } from './constants';

/**
 * What a hosting phone puts on the air, and how a scanning phone reads it back.
 *
 * The advert is a *preview*, not the truth: it exists so somebody can see which
 * room they are about to walk into — its code, who is hosting, whether there is
 * still a seat — before spending three seconds on a connection. The
 * authoritative room settings arrive in the 'room' message the host sends the
 * moment a joiner is in.
 *
 * The shared native peripheral offers exactly three fields, so everything has
 * to be packed into them:
 *
 *   peer-id prefix   8 bytes, both platforms
 *   interest mask   24 bits,  both platforms
 *   display name    15 bytes, Android only (iOS has no manufacturer-data slot)
 *
 * Layout of the 8 prefix bytes:
 *
 *   0    version
 *   1-4  room code, four ASCII characters
 *   5    capacity in the low nibble, flags in the high nibble
 *   6    players currently in the room
 *   7    reserved
 *
 * and the 24-bit mask carries the top of the range, so the join list can say
 * "1–1,000" without connecting first.
 */

export const ADV_VERSION = 1;
const PREFIX_BYTES = 8;
const MASK_BYTES = 3;
const FLAG_PLAYING = 0x1;

export interface RoomAdvert {
  code: string;
  capacity: number;
  players: number;
  /** The round is already under way; joining now means waiting it out. */
  playing: boolean;
  /** Preview only — the host sends the real range on connect. */
  rangeMax: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Four characters, no O/0/I/1 — a code has to survive being read aloud. */
export function makeRoomCode(): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

const clampCapacity = (n: number): number =>
  Math.min(MAX_CAPACITY, Math.max(MIN_CAPACITY, Math.round(n) || MIN_CAPACITY));

/** Packs a room into the 8-byte prefix the peripheral advertises. */
export function encodeAdvertPrefix(advert: RoomAdvert): string {
  const bytes = new Uint8Array(PREFIX_BYTES);
  bytes[0] = ADV_VERSION;
  const code = normalizeCode(advert.code).padEnd(4, 'X');
  for (let i = 0; i < 4; i += 1) bytes[1 + i] = code.charCodeAt(i) & 0x7f;
  const flags = advert.playing ? FLAG_PLAYING : 0;
  bytes[5] = (clampCapacity(advert.capacity) & 0x0f) | ((flags & 0x0f) << 4);
  bytes[6] = Math.min(255, Math.max(0, Math.round(advert.players)));
  bytes[7] = 0;
  return bytesToHex(bytes);
}

/** The companion 24-bit field. Kept separate because the platforms are. */
export function encodeAdvertMask(range: Range): number {
  return Math.min(0xffffff, Math.max(0, Math.round(range.max)));
}

function decodeParts(prefix: Uint8Array, mask: number): RoomAdvert | null {
  if (prefix.length < PREFIX_BYTES || prefix[0] !== ADV_VERSION) return null;
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    const ch = String.fromCharCode(prefix[1 + i]);
    if (!/[A-Z0-9]/.test(ch)) return null;
    code += ch;
  }
  return {
    code,
    capacity: clampCapacity(prefix[5] & 0x0f),
    players: prefix[6],
    playing: ((prefix[5] >> 4) & FLAG_PLAYING) !== 0,
    rangeMax: mask,
  };
}

/** What a scan result carries, once the platform differences are ironed out. */
export interface ParsedAdvert {
  advert: RoomAdvert;
  /** Android puts it in manufacturer data; iOS has nowhere to put it. */
  hostName: string | null;
}

/**
 * Android: version | prefix (8) | mask (3, little-endian) | name.
 * ble-plx hands back the raw AD payload, company id included.
 */
function parseManufacturerData(base64: string): ParsedAdvert | null {
  const bytes = base64ToBytes(base64);
  if (bytes.length < 2 + 1 + PREFIX_BYTES + MASK_BYTES) return null;
  if ((bytes[0] | (bytes[1] << 8)) !== HL_MANUFACTURER_ID) return null;

  const body = bytes.subarray(2);
  // The peripheral writes its own version byte first; ours is the next one.
  const prefix = body.subarray(1, 1 + PREFIX_BYTES);
  let mask = 0;
  for (let i = MASK_BYTES - 1; i >= 0; i -= 1) mask = (mask << 8) | body[1 + PREFIX_BYTES + i];

  const advert = decodeParts(prefix, mask);
  if (!advert) return null;

  const nameAt = 1 + PREFIX_BYTES + MASK_BYTES;
  const name = body.length > nameAt ? utf8Decode(body.subarray(nameAt)).trim() : '';
  return { advert, hostName: name.length > 0 ? name : null };
}

/** iOS: everything the module can say is squeezed into the local name. */
function parseLocalName(localName: string): ParsedAdvert | null {
  if (!localName.startsWith(HL_LOCAL_NAME_PREFIX)) return null;
  const hex = localName.slice(HL_LOCAL_NAME_PREFIX.length);
  if (hex.length < PREFIX_BYTES * 2 + MASK_BYTES * 2) return null;
  const prefix = hexToBytes(hex.slice(0, PREFIX_BYTES * 2));
  const mask = parseInt(hex.slice(PREFIX_BYTES * 2, PREFIX_BYTES * 2 + MASK_BYTES * 2), 16);
  const advert = decodeParts(prefix, Number.isFinite(mask) ? mask : 0);
  return advert ? { advert, hostName: null } : null;
}

/** Reads whichever of the two shapes this platform produced. */
export function parseAdvert(input: {
  manufacturerData?: string | null;
  localName?: string | null;
}): ParsedAdvert | null {
  if (input.manufacturerData) {
    const fromMfg = parseManufacturerData(input.manufacturerData);
    if (fromMfg) return fromMfg;
  }
  return input.localName ? parseLocalName(input.localName) : null;
}
