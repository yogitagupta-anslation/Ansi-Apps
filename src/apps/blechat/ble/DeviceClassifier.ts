import {BLE_SERVICE_UUID} from '../config/constants';

/**
 * Best-effort device classification from what the advertisement actually contains.
 *
 * The only honest inputs available before connecting are the advertised service UUIDs
 * and the local name. There is no way to know a device is "TWS Earbuds" from a BLE
 * advertisement — Bluetooth audio is Classic, not LE — so anything unrecognised is
 * reported as Unknown rather than guessed at.
 *
 * GAP "appearance" would help, but it is a GATT characteristic on most devices rather
 * than an advertising field, and react-native-ble-plx does not surface the AD form.
 */

export type DeviceKind =
  | 'chat'
  | 'input'
  | 'health'
  | 'sensor'
  | 'audio'
  | 'lighting'
  | 'wearable'
  | 'beacon'
  | 'unknown';

export interface DeviceClass {
  kind: DeviceKind;
  /** e.g. "Health" */
  category: string;
  /** e.g. "Heart Rate" */
  detail: string;
  /** Single glyph for the avatar. */
  glyph: string;
}

/** Expand a 16-bit assigned number into its full 128-bit form. */
function uuid16(short: string): string {
  return `0000${short}-0000-1000-8000-00805f9b34fb`.toLowerCase();
}

/** Assigned numbers from the Bluetooth SIG GATT services list. */
const SERVICE_MAP: Array<{uuid: string; cls: Omit<DeviceClass, 'kind'> & {kind: DeviceKind}}> = [
  {uuid: uuid16('1812'), cls: {kind: 'input', category: 'Input', detail: 'HID', glyph: '⌨'}},
  {uuid: uuid16('180d'), cls: {kind: 'health', category: 'Health', detail: 'Heart Rate', glyph: '♥'}},
  {uuid: uuid16('1826'), cls: {kind: 'health', category: 'Health', detail: 'Fitness Machine', glyph: '♥'}},
  {uuid: uuid16('1816'), cls: {kind: 'health', category: 'Health', detail: 'Cycling', glyph: '♥'}},
  {uuid: uuid16('1814'), cls: {kind: 'health', category: 'Health', detail: 'Running', glyph: '♥'}},
  {uuid: uuid16('181a'), cls: {kind: 'sensor', category: 'Sensor', detail: 'Environmental', glyph: '🌡'}},
  {uuid: uuid16('1809'), cls: {kind: 'sensor', category: 'Sensor', detail: 'Thermometer', glyph: '🌡'}},
  {uuid: uuid16('181b'), cls: {kind: 'health', category: 'Health', detail: 'Body Composition', glyph: '♥'}},
  {uuid: uuid16('1810'), cls: {kind: 'health', category: 'Health', detail: 'Blood Pressure', glyph: '♥'}},
  {uuid: uuid16('1808'), cls: {kind: 'health', category: 'Health', detail: 'Glucose', glyph: '♥'}},
  {uuid: uuid16('184e'), cls: {kind: 'audio', category: 'Audio', detail: 'LE Audio', glyph: '🎧'}},
  {uuid: uuid16('1844'), cls: {kind: 'audio', category: 'Audio', detail: 'Volume Control', glyph: '🎧'}},
  {uuid: uuid16('1843'), cls: {kind: 'audio', category: 'Audio', detail: 'Audio Input', glyph: '🎧'}},
  {uuid: uuid16('1855'), cls: {kind: 'audio', category: 'Audio', detail: 'Telephony', glyph: '🎧'}},
  {uuid: uuid16('1827'), cls: {kind: 'beacon', category: 'Mesh', detail: 'Provisioning', glyph: '◈'}},
  {uuid: uuid16('1828'), cls: {kind: 'beacon', category: 'Mesh', detail: 'Proxy', glyph: '◈'}},
  {uuid: uuid16('fd6f'), cls: {kind: 'beacon', category: 'Beacon', detail: 'Exposure Notification', glyph: '◈'}},
  {uuid: uuid16('1805'), cls: {kind: 'wearable', category: 'Wearable', detail: 'Current Time', glyph: '⌚'}},
  {uuid: uuid16('180a'), cls: {kind: 'unknown', category: 'Generic', detail: 'Device Info', glyph: '?'}},
];

/** Exported so a peer we are connected to can be listed without a scan result. */
export const CHAT: DeviceClass = {
  kind: 'chat',
  category: 'BLE Chat',
  detail: 'Peer',
  glyph: '✦',
};

const UNKNOWN: DeviceClass = {
  kind: 'unknown',
  category: 'Unknown',
  detail: '',
  glyph: '?',
};

export function classifyDevice(
  serviceUuids: string[] | null,
  localName: string | null,
): DeviceClass {
  const uuids = (serviceUuids ?? []).map(u => u.toLowerCase());

  if (uuids.includes(BLE_SERVICE_UUID.toLowerCase())) {
    return CHAT;
  }

  for (const entry of SERVICE_MAP) {
    if (uuids.includes(entry.uuid)) {
      // Device Information alone is not a category worth claiming.
      if (entry.cls.kind === 'unknown' && uuids.length > 1) {
        continue;
      }
      return entry.cls;
    }
  }

  // A name is a weak hint, not evidence. Only used when nothing else is known, and only
  // for unambiguous words.
  const name = (localName ?? '').toLowerCase();
  if (name) {
    if (/\b(buds|headset|headphone|airpod|earphone)\b/.test(name)) {
      return {kind: 'audio', category: 'Audio', detail: 'by name', glyph: '🎧'};
    }
    if (/\b(watch|band|fit)\b/.test(name)) {
      return {kind: 'wearable', category: 'Wearable', detail: 'by name', glyph: '⌚'};
    }
    if (/\b(bulb|lamp|light)\b/.test(name)) {
      return {kind: 'lighting', category: 'Lighting', detail: 'by name', glyph: '💡'};
    }
  }

  return UNKNOWN;
}

/** Theme-independent accent per kind; the screen maps these onto palette colours. */
export function kindTone(kind: DeviceKind): 'accent' | 'ok' | 'purple' | 'amber' | 'neutral' {
  switch (kind) {
    case 'chat':
      return 'accent';
    case 'health':
    case 'wearable':
      return 'purple';
    case 'sensor':
    case 'lighting':
      return 'ok';
    case 'audio':
      return 'purple';
    case 'input':
      return 'ok';
    case 'beacon':
      return 'amber';
    default:
      return 'neutral';
  }
}

export function describeClass(cls: DeviceClass): string {
  return cls.detail ? `${cls.category} • ${cls.detail}` : cls.category;
}
