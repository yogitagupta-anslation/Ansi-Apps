/**
 * GattProfile — the constants that keep a UUID an identifier and never a container.
 *
 * This module exists because `EventPulseBle.swift:180` built a `CBUUID` out of a
 * 13-21 byte advertisement frame. `CBUUID(data:)` accepts 2, 4 or 16 bytes only,
 * so anything else raises an Objective-C exception Swift cannot catch and the app
 * dies. The tests below pin the two invariants that make a repeat impossible:
 *
 *   1. every UUID this profile exposes is a fixed, hard-coded, canonical 128-bit
 *      constant that `isValidUuid128` accepts, and
 *   2. `isValidUuid128` rejects a presence payload in every string form one can
 *      take — hex, latin-1, joined bytes, base64 — including the 16-byte length
 *      that CoreBluetooth would otherwise have swallowed.
 *
 * The MTU arithmetic gets the same treatment: `payloadBytesForMtu` returning 0
 * would spin the fragmenter forever, so every degenerate input is asserted, not
 * assumed.
 */

import {
  ANDROID_REQUESTED_MTU,
  ATT_DEFAULT_MTU,
  ATT_HEADER_BYTES,
  CONNECT_TIMEOUT_MS,
  FRAME_HEADER_BYTES,
  GATT_CHAR_RX_UUID,
  GATT_CHAR_TX_UUID,
  GATT_SERVICE_UUID,
  GATT_UUIDS,
  IOS_ASSUMED_MTU,
  MAX_CONCURRENT_LINKS,
  MAX_MESSAGE_BYTES,
  REASSEMBLY_TIMEOUT_MS,
  isValidUuid128,
  payloadBytesForMtu,
} from '../bluetooth/gatt/GattProfile';
import { EVENTPULSE_SERVICE_UUID_128, encodeAdvertisement } from '../bluetooth/BleProtocol';
import { bytesToHex } from '../utils/bytes';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * A real presence frame — the exact kind of thing `EventPulseBle.swift:180` fed
 * to `CBUUID(data:)`. `displayTag` drives the length: 0 bytes of tag gives the
 * 13-byte minimum, 8 gives the 21-byte maximum.
 */
function presenceFrame(displayTag: string): Uint8Array {
  return encodeAdvertisement({
    eventCode: 0xbeef,
    peerId: 'A1B2C3D4',
    profileVersion: 7,
    avatarId: '0F1E',
    displayTag,
    status: 'available',
    capabilities: { acceptsConnections: true, supportsNavigation: false, isAnchor: false },
  });
}

/** The bytes read back as one character per byte — the naive `String(data:)`. */
function latin1(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('');
}

/** MTUs swept for properties that must hold everywhere, not only at named points. */
const MTU_SWEEP: number[] = [];
for (let mtu = -40; mtu <= 600; mtu++) MTU_SWEEP.push(mtu);

/* ------------------------------------------------------------------ *
 * The UUID constants
 * ------------------------------------------------------------------ */

describe('the profile UUIDs are fixed 128-bit constants', () => {
  it('exposes the service UUID reserved for EventPulse as a hard-coded literal', () => {
    expect(GATT_SERVICE_UUID).toBe('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10');
  });

  it('exposes the notify (server to client) characteristic as a hard-coded literal', () => {
    expect(GATT_CHAR_TX_UUID).toBe('7e9f1a21-4b3c-4f0e-9c2d-1f4b7a6c5d10');
  });

  it('exposes the write (client to server) characteristic as a hard-coded literal', () => {
    expect(GATT_CHAR_RX_UUID).toBe('7e9f1a22-4b3c-4f0e-9c2d-1f4b7a6c5d10');
  });

  it('lists exactly the service, TX and RX UUIDs, in that order, for scan filters', () => {
    expect(GATT_UUIDS.length).toBe(3);
    expect(Array.from(GATT_UUIDS)).toEqual([
      '7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10',
      '7e9f1a21-4b3c-4f0e-9c2d-1f4b7a6c5d10',
      '7e9f1a22-4b3c-4f0e-9c2d-1f4b7a6c5d10',
    ]);
  });

  it('accepts every one of its own UUIDs through isValidUuid128', () => {
    for (const uuid of GATT_UUIDS) {
      expect(isValidUuid128(uuid)).toBe(true);
    }
  });

  it('gives every UUID the canonical 36-character 8-4-4-4-12 shape', () => {
    for (const uuid of GATT_UUIDS) {
      expect(uuid.length).toBe(36);
      expect(uuid.split('-').map((group) => group.length)).toEqual([8, 4, 4, 4, 12]);
    }
  });

  it('writes every UUID in lowercase, the only case isValidUuid128 accepts', () => {
    for (const uuid of GATT_UUIDS) {
      expect(uuid).toBe(uuid.toLowerCase());
      expect(uuid).not.toBe(uuid.toUpperCase());
    }
  });

  it('uses RFC 4122 version 4 with the 10xx variant on every UUID', () => {
    for (const uuid of GATT_UUIDS) {
      expect(uuid.charAt(14)).toBe('4');
      expect('89ab'.includes(uuid.charAt(19))).toBe(true);
    }
  });

  it('keeps the three UUIDs distinct so the two characteristics cannot collide', () => {
    expect(new Set(Array.from(GATT_UUIDS)).size).toBe(3);
    expect(GATT_SERVICE_UUID).not.toBe(GATT_CHAR_TX_UUID);
    expect(GATT_SERVICE_UUID).not.toBe(GATT_CHAR_RX_UUID);
    expect(GATT_CHAR_TX_UUID).not.toBe(GATT_CHAR_RX_UUID);
  });

  it('allocates all three from one block, differing only in the fourth hex byte', () => {
    for (const uuid of GATT_UUIDS) {
      expect(uuid.slice(0, 6)).toBe('7e9f1a');
      expect(uuid.slice(9)).toBe('4b3c-4f0e-9c2d-1f4b7a6c5d10');
    }
    expect([
      GATT_SERVICE_UUID.slice(6, 8),
      GATT_CHAR_TX_UUID.slice(6, 8),
      GATT_CHAR_RX_UUID.slice(6, 8),
    ]).toEqual(['20', '21', '22']);
  });

  it('reuses EVENTPULSE_SERVICE_UUID_128 verbatim, so the service cannot drift in two halves', () => {
    expect(GATT_SERVICE_UUID).toBe(EVENTPULSE_SERVICE_UUID_128);
    expect(isValidUuid128(EVENTPULSE_SERVICE_UUID_128)).toBe(true);
  });

  it('never reuses the 16-bit presence identifier as a GATT UUID string', () => {
    for (const uuid of GATT_UUIDS) {
      expect(uuid).not.toBe('fdcf');
      expect(uuid).not.toBe('0000fdcf-0000-1000-8000-00805f9b34fb');
    }
  });
});

/* ------------------------------------------------------------------ *
 * isValidUuid128 — what it accepts
 * ------------------------------------------------------------------ */

describe('isValidUuid128 accepts canonical lowercase 128-bit UUIDs', () => {
  it('accepts the all-zero UUID', () => {
    expect(isValidUuid128('00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('accepts the all-f UUID', () => {
    expect(isValidUuid128('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
  });

  it('accepts the Bluetooth base UUID expansion of the 0xfdcf presence service', () => {
    expect(isValidUuid128('0000fdcf-0000-1000-8000-00805f9b34fb')).toBe(true);
  });

  it('accepts a UUID that uses every lowercase hex digit', () => {
    expect(isValidUuid128('01234567-89ab-cdef-0123-456789abcdef')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * isValidUuid128 — what it must reject
 * ------------------------------------------------------------------ */

describe('isValidUuid128 rejects anything that is not a canonical 128-bit UUID', () => {
  it('rejects an otherwise valid UUID written in uppercase', () => {
    expect(isValidUuid128('7E9F1A20-4B3C-4F0E-9C2D-1F4B7A6C5D10')).toBe(false);
  });

  it('rejects a UUID with a single uppercase hex digit', () => {
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5D10')).toBe(false);
  });

  it('rejects a 16-bit UUID such as the presence service "fdcf"', () => {
    expect(isValidUuid128('fdcf')).toBe(false);
    expect(isValidUuid128('0xfdcf')).toBe(false);
  });

  it('rejects a 32-bit short-form UUID', () => {
    expect(isValidUuid128('0000fdcf')).toBe(false);
  });

  it('rejects the same 128 bits written as bare hex with no dashes', () => {
    expect(isValidUuid128('7e9f1a204b3c4f0e9c2d1f4b7a6c5d10')).toBe(false);
  });

  it('rejects a first group of the wrong length', () => {
    expect(isValidUuid128('7e9f1a2-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('7e9f1a200-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
  });

  it('rejects a middle group of the wrong length', () => {
    expect(isValidUuid128('7e9f1a20-4b3-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0ee-9c2d-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2-1f4b7a6c5d10')).toBe(false);
  });

  it('rejects a final group of the wrong length', () => {
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d1')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d100')).toBe(false);
  });

  it('rejects the wrong number of dash-separated groups', () => {
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c-5d10')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidUuid128('')).toBe(false);
  });

  it('rejects a string of whitespace alone', () => {
    expect(isValidUuid128(' ')).toBe(false);
    expect(isValidUuid128('   ')).toBe(false);
  });

  it('rejects a valid UUID with trailing whitespace', () => {
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10 ')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10\t')).toBe(false);
  });

  it('rejects a valid UUID with a trailing newline', () => {
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10\n')).toBe(false);
  });

  it('rejects a valid UUID with leading whitespace', () => {
    expect(isValidUuid128(' 7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('\n7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
  });

  it('rejects the braced registry form', () => {
    expect(isValidUuid128('{7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10}')).toBe(false);
  });

  it('rejects the URN form', () => {
    expect(isValidUuid128('urn:uuid:7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
  });

  it('rejects underscores in place of the dashes', () => {
    expect(isValidUuid128('7e9f1a20_4b3c_4f0e_9c2d_1f4b7a6c5d10')).toBe(false);
  });

  it('rejects a non-hex character anywhere in the string', () => {
    expect(isValidUuid128('7e9f1a2g-4b3c-4f0e-9c2d-1f4b7a6c5d10')).toBe(false);
    expect(isValidUuid128('7e9f1a20-4b3c-4f0e-9c2d-1f4b7a6c5dzz')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * isValidUuid128 vs. the payload that crashed iOS
 * ------------------------------------------------------------------ */

describe('isValidUuid128 rejects an advertisement payload in every string form it can take', () => {
  it('builds presence frames across the documented 13 to 21 byte range', () => {
    expect(presenceFrame('').length).toBe(13);
    expect(presenceFrame('abc').length).toBe(16);
    expect(presenceFrame('12345678').length).toBe(21);
  });

  it('rejects the hex string of a minimum-length 13-byte presence frame', () => {
    const hex = bytesToHex(presenceFrame(''));
    expect(hex.length).toBe(26);
    expect(isValidUuid128(hex)).toBe(false);
  });

  it('rejects the hex string of a maximum-length 21-byte presence frame', () => {
    const hex = bytesToHex(presenceFrame('12345678'));
    expect(hex.length).toBe(42);
    expect(isValidUuid128(hex)).toBe(false);
  });

  it('rejects the hex of a 16-byte payload, the one length CBUUID(data:) would have swallowed', () => {
    const frame = presenceFrame('abc');
    expect(frame.length).toBe(16);
    const hex = bytesToHex(frame);
    expect(hex.length).toBe(32);
    expect(isValidUuid128(hex)).toBe(false);
  });

  it('rejects the hex of every presence frame length from 13 through 21 bytes', () => {
    for (let tagLength = 0; tagLength <= 8; tagLength++) {
      const frame = presenceFrame('x'.repeat(tagLength));
      expect(frame.length).toBe(13 + tagLength);
      expect(isValidUuid128(bytesToHex(frame))).toBe(false);
    }
  });

  it('rejects the raw byte-per-character string of a presence frame', () => {
    expect(isValidUuid128(latin1(presenceFrame('demo')))).toBe(false);
  });

  it('rejects the comma-joined byte list of a presence frame', () => {
    expect(isValidUuid128(Array.from(presenceFrame('demo')).join(','))).toBe(false);
  });

  it('rejects the base64 encoding of a presence frame', () => {
    expect(isValidUuid128(Buffer.from(presenceFrame('demo')).toString('base64'))).toBe(false);
  });

  it('rejects arbitrary binary bytes as hex and as raw characters at every length 0 to 24', () => {
    for (let length = 0; length <= 24; length++) {
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(isValidUuid128(bytesToHex(bytes))).toBe(false);
      expect(isValidUuid128(latin1(bytes))).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * payloadBytesForMtu
 * ------------------------------------------------------------------ */

describe('payloadBytesForMtu at the MTUs the radios actually give us', () => {
  it('leaves 11 usable payload bytes at the BLE 4.0 default MTU of 23', () => {
    expect(payloadBytesForMtu(23)).toBe(11);
    expect(payloadBytesForMtu(ATT_DEFAULT_MTU)).toBe(11);
  });

  it('leaves 500 usable payload bytes at the Android negotiated MTU of 512', () => {
    expect(payloadBytesForMtu(512)).toBe(500);
    expect(payloadBytesForMtu(ANDROID_REQUESTED_MTU)).toBe(500);
  });

  it('leaves 173 usable payload bytes at the iOS assumed MTU of 185', () => {
    expect(payloadBytesForMtu(185)).toBe(173);
    expect(payloadBytesForMtu(IOS_ASSUMED_MTU)).toBe(173);
  });

  it('agrees with the header constants at the default MTU', () => {
    expect(payloadBytesForMtu(ATT_DEFAULT_MTU)).toBe(
      ATT_DEFAULT_MTU - ATT_HEADER_BYTES - FRAME_HEADER_BYTES,
    );
  });

  it('gives strictly more room on iOS than at the default, and more again on Android', () => {
    expect(payloadBytesForMtu(IOS_ASSUMED_MTU)).toBeGreaterThan(
      payloadBytesForMtu(ATT_DEFAULT_MTU),
    );
    expect(payloadBytesForMtu(ANDROID_REQUESTED_MTU)).toBeGreaterThan(
      payloadBytesForMtu(IOS_ASSUMED_MTU),
    );
  });
});

describe('payloadBytesForMtu around the point where the headers consume the packet', () => {
  it('returns 1 at MTU 12, where the ATT and frame headers exactly fill the packet', () => {
    expect(ATT_HEADER_BYTES + FRAME_HEADER_BYTES).toBe(12);
    expect(payloadBytesForMtu(12)).toBe(1);
  });

  it('returns 1 at MTU 11, one below the threshold, rather than 0', () => {
    expect(payloadBytesForMtu(11)).toBe(1);
  });

  it('returns 1 at MTU 13, the first MTU with a genuine byte of room', () => {
    expect(payloadBytesForMtu(13)).toBe(1);
  });

  it('returns 2 at MTU 14, one above the first MTU with real room', () => {
    expect(payloadBytesForMtu(14)).toBe(2);
  });
});

describe('payloadBytesForMtu never returns a chunk size that would hang the fragmenter', () => {
  it('returns 1 for MTU 0', () => {
    expect(payloadBytesForMtu(0)).toBe(1);
  });

  it('returns 1 for MTU 1', () => {
    expect(payloadBytesForMtu(1)).toBe(1);
  });

  it('returns 1 for a negative MTU', () => {
    expect(payloadBytesForMtu(-1)).toBe(1);
    expect(payloadBytesForMtu(-512)).toBe(1);
    expect(payloadBytesForMtu(Number.MIN_SAFE_INTEGER)).toBe(1);
  });

  it('returns 1 for NaN', () => {
    expect(payloadBytesForMtu(NaN)).toBe(1);
  });

  it('returns 1 for Infinity rather than an unbounded chunk size', () => {
    expect(payloadBytesForMtu(Infinity)).toBe(1);
  });

  it('returns 1 for -Infinity', () => {
    expect(payloadBytesForMtu(-Infinity)).toBe(1);
  });

  it('returns at least 1 for every MTU across a sweep from -40 to 600', () => {
    for (const mtu of MTU_SWEEP) {
      expect(payloadBytesForMtu(mtu)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('payloadBytesForMtu produces whole, non-decreasing chunk sizes', () => {
  it('floors a fractional MTU rather than producing a fractional chunk size', () => {
    expect(payloadBytesForMtu(23.9)).toBe(11);
    expect(payloadBytesForMtu(23.0001)).toBe(11);
    expect(payloadBytesForMtu(24.999)).toBe(12);
    expect(payloadBytesForMtu(512.75)).toBe(500);
    expect(payloadBytesForMtu(13.5)).toBe(1);
  });

  it('floors a negative fractional MTU downwards and still clamps to 1', () => {
    expect(payloadBytesForMtu(-0.5)).toBe(1);
  });

  it('returns an integer for every MTU across the sweep, fractional inputs included', () => {
    for (const mtu of MTU_SWEEP) {
      expect(Number.isInteger(payloadBytesForMtu(mtu))).toBe(true);
      expect(Number.isInteger(payloadBytesForMtu(mtu + 0.5))).toBe(true);
    }
  });

  it('is monotonic non-decreasing as the MTU rises across the sweep', () => {
    for (let i = 1; i < MTU_SWEEP.length; i++) {
      expect(payloadBytesForMtu(MTU_SWEEP[i])).toBeGreaterThanOrEqual(
        payloadBytesForMtu(MTU_SWEEP[i - 1]),
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * The numeric constants
 * ------------------------------------------------------------------ */

describe('the numeric constants are internally coherent', () => {
  it('pins the ATT default MTU and the two header sizes', () => {
    expect(ATT_DEFAULT_MTU).toBe(23);
    expect(ATT_HEADER_BYTES).toBe(3);
    expect(FRAME_HEADER_BYTES).toBe(9);
  });

  it('matches the documented frame layout of 1 + 4 + 2 + 2 header bytes', () => {
    expect(FRAME_HEADER_BYTES).toBe(1 + 4 + 2 + 2);
  });

  it('fits both headers inside the default MTU with room left for payload', () => {
    expect(ATT_HEADER_BYTES + FRAME_HEADER_BYTES).toBeLessThan(ATT_DEFAULT_MTU);
    expect(ATT_DEFAULT_MTU - ATT_HEADER_BYTES - FRAME_HEADER_BYTES).toBeGreaterThanOrEqual(1);
  });

  it('pins the platform MTUs, both above the BLE default', () => {
    expect(ANDROID_REQUESTED_MTU).toBe(512);
    expect(IOS_ASSUMED_MTU).toBe(185);
    expect(ANDROID_REQUESTED_MTU).toBeGreaterThan(ATT_DEFAULT_MTU);
    expect(IOS_ASSUMED_MTU).toBeGreaterThan(ATT_DEFAULT_MTU);
    expect(ANDROID_REQUESTED_MTU).toBeGreaterThan(IOS_ASSUMED_MTU);
  });

  it('caps a reassembled message at a positive, finite 64 KiB', () => {
    expect(MAX_MESSAGE_BYTES).toBe(65536);
    expect(MAX_MESSAGE_BYTES).toBe(64 * 1024);
    expect(Number.isFinite(MAX_MESSAGE_BYTES)).toBe(true);
    expect(Number.isInteger(MAX_MESSAGE_BYTES)).toBe(true);
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(0);
  });

  it('keeps a maximum-size message inside the 16-bit fragTotal field at the worst MTU', () => {
    const fragments = Math.ceil(MAX_MESSAGE_BYTES / payloadBytesForMtu(ATT_DEFAULT_MTU));
    expect(fragments).toBe(5958);
    expect(fragments).toBeLessThanOrEqual(0xffff);
  });

  it('gives the reassembly timeout a positive, finite 8 seconds', () => {
    expect(REASSEMBLY_TIMEOUT_MS).toBe(8000);
    expect(Number.isFinite(REASSEMBLY_TIMEOUT_MS)).toBe(true);
    expect(REASSEMBLY_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('gives the connect timeout a positive, finite 12 seconds, longer than a reassembly stall', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(12000);
    expect(Number.isFinite(CONNECT_TIMEOUT_MS)).toBe(true);
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CONNECT_TIMEOUT_MS).toBeGreaterThan(REASSEMBLY_TIMEOUT_MS);
  });

  it('allows at least one concurrent outbound link, and caps the ceiling at 4', () => {
    expect(MAX_CONCURRENT_LINKS).toBe(4);
    expect(MAX_CONCURRENT_LINKS).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(MAX_CONCURRENT_LINKS)).toBe(true);
    expect(Number.isFinite(MAX_CONCURRENT_LINKS)).toBe(true);
  });
});
