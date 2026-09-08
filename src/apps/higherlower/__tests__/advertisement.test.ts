import {
  ADV_VERSION,
  encodeAdvertMask,
  encodeAdvertPrefix,
  makeRoomCode,
  normalizeCode,
  parseAdvert,
  RoomAdvert,
} from '../ble/advertisement';
import { bytesToBase64, hexToBytes } from '../ble/bytes';
import { HL_MANUFACTURER_ID } from '../ble/constants';

/**
 * These tests stand in for the native peripheral.
 *
 * The advertisement is the one part of the link where two languages have to
 * agree byte for byte: Kotlin writes the payload, TypeScript reads it, and a
 * mistake shows up as rooms that simply never appear in anybody's scan — the
 * single hardest failure to diagnose with two phones on a table. So the exact
 * layout the native modules produce is rebuilt here and parsed back.
 */

/** What BlePeripheralModule.kt puts in the scan response, byte for byte. */
function androidManufacturerData(prefixHex: string, mask: number, name: string): string {
  const prefix = hexToBytes(prefixHex);
  const nameBytes = Array.from(name).map((c) => c.charCodeAt(0));
  const bytes = new Uint8Array(2 + 1 + 8 + 3 + nameBytes.length);

  // ble-plx hands back the raw AD payload, company id included and little-endian.
  bytes[0] = HL_MANUFACTURER_ID & 0xff;
  bytes[1] = (HL_MANUFACTURER_ID >> 8) & 0xff;
  bytes[2] = 2; // the module's own payload version, which we skip over
  bytes.set(prefix, 3);

  let remaining = mask;
  for (let i = 0; i < 3; i += 1) {
    bytes[11 + i] = remaining & 0xff;
    remaining >>= 8;
  }
  bytes.set(nameBytes, 14);
  return bytesToBase64(bytes);
}

/** What BlePeripheral.swift puts in the advertised local name. */
function iosLocalName(prefixHex: string, mask: number): string {
  return `BC-${prefixHex}${mask.toString(16).padStart(6, '0')}`;
}

const room: RoomAdvert = {
  code: 'K7QM',
  capacity: 5,
  players: 3,
  playing: false,
  rangeMax: 1000,
};

describe('room advertisement', () => {
  it('survives the trip through an Android scan response', () => {
    const parsed = parseAdvert({
      manufacturerData: androidManufacturerData(
        encodeAdvertPrefix(room),
        encodeAdvertMask({ min: 1, max: room.rangeMax }),
        'Priya',
      ),
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.advert).toEqual(room);
    expect(parsed?.hostName).toBe('Priya');
  });

  it('survives the trip through an iOS local name, minus the name', () => {
    const parsed = parseAdvert({
      localName: iosLocalName(
        encodeAdvertPrefix(room),
        encodeAdvertMask({ min: 1, max: room.rangeMax }),
      ),
    });

    expect(parsed?.advert).toEqual(room);
    // iOS has no manufacturer-data slot: the name only arrives after connecting.
    expect(parsed?.hostName).toBeNull();
  });

  it('carries the in-play flag so a joiner is not offered a running round', () => {
    const playing = { ...room, playing: true };
    const parsed = parseAdvert({
      manufacturerData: androidManufacturerData(
        encodeAdvertPrefix(playing),
        encodeAdvertMask({ min: 1, max: playing.rangeMax }),
        'Ava',
      ),
    });

    expect(parsed?.advert.playing).toBe(true);
    expect(parsed?.advert.capacity).toBe(playing.capacity);
  });

  it('reports a full room by the numbers it carries', () => {
    const parsed = parseAdvert({
      localName: iosLocalName(
        encodeAdvertPrefix({ ...room, players: 5 }),
        encodeAdvertMask({ min: 1, max: 100 }),
      ),
    });

    expect(parsed?.advert.players).toBe(5);
    expect(parsed?.advert.capacity).toBe(5);
  });

  it('refuses a payload from a version it does not understand', () => {
    const prefix = hexToBytes(encodeAdvertPrefix(room));
    prefix[0] = ADV_VERSION + 1;
    let hex = '';
    prefix.forEach((b) => {
      hex += b.toString(16).padStart(2, '0');
    });

    expect(parseAdvert({ localName: iosLocalName(hex, 100) })).toBeNull();
  });

  it('ignores a device that is not advertising one of our rooms', () => {
    expect(parseAdvert({ localName: 'Some Headphones' })).toBeNull();
    expect(parseAdvert({ manufacturerData: bytesToBase64(new Uint8Array([1, 2, 3])) })).toBeNull();
    expect(parseAdvert({})).toBeNull();
  });

  it('clamps a capacity the packing cannot hold', () => {
    const parsed = parseAdvert({
      localName: iosLocalName(encodeAdvertPrefix({ ...room, capacity: 99 }), 100),
    });
    // Four bits and a documented maximum: 99 seats is not a room, it is a bug.
    expect(parsed?.advert.capacity).toBe(8);
  });
});

describe('room codes', () => {
  it('avoids the characters people misread aloud', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(makeRoomCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });

  it('forgives however somebody types the code they were told', () => {
    expect(normalizeCode('k7qm')).toBe('K7QM');
    expect(normalizeCode(' k7-qm ')).toBe('K7QM');
    expect(normalizeCode('K7QMEXTRA')).toBe('K7QM');
  });
});
