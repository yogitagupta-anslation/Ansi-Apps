/**
 * Unit tests for the rotating, event-scoped BLE identity.
 *
 * Everything here exercises the real implementation: real HMAC-SHA256, real
 * byte helpers, real advertisement codec. The only injected fake is a
 * `RandomSource`, which is an explicit constructor boundary of the module.
 */

import {
  DEFAULT_ROTATION_MS,
  DEFAULT_SCHEDULE_DEPTH,
  PeerIdentityService,
  SEED_BYTES,
  peerIdentityService,
  type PeerIdWindow,
  type RandomSource,
} from '../bluetooth/BleIdentity';
import { decodeAdvertisement, encodeAdvertisement } from '../bluetooth/BleProtocol';
import type { BleAdvertisement, PeerCapabilities, PresenceStatus } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const R = DEFAULT_ROTATION_MS;

/** An epoch index that lands on a realistic wall-clock timestamp. */
const EPOCH_INDEX = 1_888_889;
/** 2023-11-14T22:15:00.000Z — exactly on a rotation boundary. */
const BOUNDARY = EPOCH_INDEX * R;

const SEED_A = Uint8Array.from([
  0x9f, 0x21, 0x0c, 0x7d, 0xb4, 0x53, 0xee, 0x08, 0x11, 0xa6, 0x3c, 0xd0, 0x77, 0x42, 0x95, 0x6b,
]);
/** Differs from SEED_A in exactly one bit (last byte, bit 0). */
const SEED_A_ONE_BIT = Uint8Array.from([
  0x9f, 0x21, 0x0c, 0x7d, 0xb4, 0x53, 0xee, 0x08, 0x11, 0xa6, 0x3c, 0xd0, 0x77, 0x42, 0x95, 0x6a,
]);
const SEED_B = Uint8Array.from([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
]);

const EVENT_A = 'evt-2024-devcon';
const EVENT_B = 'evt-2024-designweek';

const HEX8 = /^[0-9A-F]{8}$/;
const HEX4 = /^[0-9A-F]{4}$/;

const CAPS: PeerCapabilities = {
  acceptsConnections: true,
  supportsNavigation: false,
  isAnchor: false,
};
const STATUS: PresenceStatus = 'available';

/** Broadcast the given identity through the real codec and read it back. */
function broadcast(peerId: string, avatarId: string): BleAdvertisement {
  return decodeAdvertisement(
    encodeAdvertisement({
      eventCode: 0x4d2a,
      peerId,
      profileVersion: 3,
      avatarId,
      displayTag: 'Ada',
      status: STATUS,
      capabilities: CAPS,
    }),
  );
}

function newService(rotationMs?: number): PeerIdentityService {
  return rotationMs === undefined
    ? new PeerIdentityService()
    : new PeerIdentityService({ rotationMs });
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('epoch arithmetic', () => {
  const svc = newService();

  it('maps every instant inside one rotation window to the same epoch number', () => {
    expect(svc.epochAt(BOUNDARY)).toBe(EPOCH_INDEX);
    expect(svc.epochAt(BOUNDARY + 1)).toBe(EPOCH_INDEX);
    expect(svc.epochAt(BOUNDARY + R / 2)).toBe(EPOCH_INDEX);
    expect(svc.epochAt(BOUNDARY + R - 1)).toBe(EPOCH_INDEX);
  });

  it('advances the epoch number at the exact rotation boundary', () => {
    expect(svc.epochAt(BOUNDARY - 1)).toBe(EPOCH_INDEX - 1);
    expect(svc.epochAt(BOUNDARY)).toBe(EPOCH_INDEX);
    expect(svc.epochAt(BOUNDARY + R)).toBe(EPOCH_INDEX + 1);
  });

  it('maps epoch zero to the window starting at the unix epoch', () => {
    expect(svc.epochAt(0)).toBe(0);
    expect(svc.epochAt(R - 1)).toBe(0);
    expect(svc.epochStart(0)).toBe(0);
  });

  it('round-trips epochStart back through epochAt for every boundary', () => {
    for (let epoch = EPOCH_INDEX - 2; epoch <= EPOCH_INDEX + 2; epoch++) {
      const start = svc.epochStart(epoch);
      expect(start).toBe(epoch * R);
      expect(svc.epochAt(start)).toBe(epoch);
      expect(svc.epochAt(start + R - 1)).toBe(epoch);
    }
  });

  it('uses the configured rotation period instead of the default', () => {
    const fast = newService(60_000);
    expect(fast.epochAt(60_000)).toBe(1);
    expect(fast.epochAt(59_999)).toBe(0);
    expect(fast.epochStart(7)).toBe(420_000);
  });
});

describe('currentPeerId determinism', () => {
  const svc = newService();

  it('returns the identical id for repeated calls with the same seed, event and time', () => {
    const first = svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + 12_345);
    for (let i = 0; i < 25; i++) {
      expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + 12_345)).toBe(first);
    }
  });

  it('is independent of the PeerIdentityService instance that derives it', () => {
    const a = newService().currentPeerId(SEED_A, EVENT_A, BOUNDARY);
    const b = newService().currentPeerId(SEED_A, EVENT_A, BOUNDARY);
    expect(a).toBe(b);
  });

  it('agrees with derivePeerId for the epoch containing the instant', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + 7)).toBe(
      svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX),
    );
  });

  it('holds one id steady from the first to the last millisecond of an epoch', () => {
    const expected = svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX);
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).toBe(expected);
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + 1)).toBe(expected);
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + R / 2)).toBe(expected);
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + R - 1)).toBe(expected);
  });

  it('derives a byte-stable value that does not drift between process ticks', () => {
    // Guards the hand-rolled HMAC against accumulated state across calls.
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX));
    expect(ids.size).toBe(1);
  });
});

describe('peer id shape', () => {
  const svc = newService();

  it('is exactly eight uppercase hexadecimal characters', () => {
    const id = svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY);
    expect(id).toHaveLength(8);
    expect(id).toMatch(HEX8);
    expect(id).toBe(id.toUpperCase());
  });

  it('is accepted verbatim by encodeAdvertisement and survives the decode round trip', () => {
    const id = svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY);
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    expect(broadcast(id, avatar).peerId).toBe(id);
  });

  it('stays a legal advertisement field for every epoch of a full day', () => {
    const epochsPerDay = Math.floor(86_400_000 / R);
    expect(epochsPerDay).toBe(96);
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    for (let i = 0; i < epochsPerDay; i++) {
      const id = svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + i * R);
      expect(id).toMatch(HEX8);
      expect(broadcast(id, avatar).peerId).toBe(id);
    }
  });

  it('never emits a short id when the derived bytes contain leading zeroes', () => {
    // Scan a wide epoch range: any byte rendered without zero-padding would
    // shorten the string and be rejected by encodeAdvertisement.
    for (let epoch = 0; epoch < 400; epoch++) {
      expect(svc.derivePeerId(SEED_B, EVENT_B, epoch)).toMatch(HEX8);
    }
  });
});

describe('rotation across the epoch boundary', () => {
  const svc = newService();
  const previousId = svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX - 1);
  const boundaryId = svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX);

  it('still broadcasts the previous id one millisecond before the boundary', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY - 1)).toBe(previousId);
  });

  it('switches to the new id at the exact boundary millisecond', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).toBe(boundaryId);
    expect(boundaryId).not.toBe(previousId);
  });

  it('keeps the new id one millisecond after the boundary', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + 1)).toBe(boundaryId);
  });

  it('rotates to a fresh id in every epoch of a whole day', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 96; i++) seen.add(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + i * R));
    expect(seen.size).toBe(96);
  });

  it('rotates on the configured period rather than the default one', () => {
    const fast = newService(60_000);
    const before = fast.currentPeerId(SEED_A, EVENT_A, 600_000 - 1);
    const after = fast.currentPeerId(SEED_A, EVENT_A, 600_000);
    expect(before).not.toBe(after);
    // The default-period service sees no rotation at all across that instant.
    expect(svc.currentPeerId(SEED_A, EVENT_A, 600_000 - 1)).toBe(
      svc.currentPeerId(SEED_A, EVENT_A, 600_000),
    );
  });
});

describe('unlinkability', () => {
  const svc = newService();

  it('gives one seed different ids at two different events', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_A, EVENT_B, BOUNDARY),
    );
  });

  it('gives two different seeds different ids at the same event and instant', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_B, EVENT_A, BOUNDARY),
    );
  });

  it('gives seeds differing in a single bit unrelated ids', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_A_ONE_BIT, EVENT_A, BOUNDARY),
    );
  });

  it('keeps cross-event ids distinct for every epoch of a day, not just one', () => {
    for (let i = 0; i < 96; i++) {
      const at = BOUNDARY + i * R;
      expect(svc.currentPeerId(SEED_A, EVENT_A, at)).not.toBe(
        svc.currentPeerId(SEED_A, EVENT_B, at),
      );
    }
  });

  it('treats event ids that differ only in trailing whitespace as different events', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_A, `${EVENT_A} `, BOUNDARY),
    );
  });

  it('treats event ids that differ only in case as different events', () => {
    expect(svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_A, EVENT_A.toUpperCase(), BOUNDARY),
    );
  });

  it('does not let a slash inside an event id collide with the epoch separator', () => {
    // "evt/5" at epoch 7 must not hash the same string as "evt" at some epoch.
    const withSlash = svc.derivePeerId(SEED_A, 'evt/5', 7);
    expect(withSlash).not.toBe(svc.derivePeerId(SEED_A, 'evt', 57));
    expect(withSlash).not.toBe(svc.derivePeerId(SEED_A, 'evt/5/7', 0));
  });

  it('handles an empty event id without producing the same id as a whitespace one', () => {
    expect(svc.currentPeerId(SEED_A, '', BOUNDARY)).toMatch(HEX8);
    expect(svc.currentPeerId(SEED_A, '', BOUNDARY)).not.toBe(
      svc.currentPeerId(SEED_A, ' ', BOUNDARY),
    );
  });
});

describe('nextRotationAt', () => {
  const svc = newService();

  it('returns a boundary strictly in the future from anywhere inside an epoch', () => {
    for (const now of [BOUNDARY, BOUNDARY + 1, BOUNDARY + R / 2, BOUNDARY + R - 1]) {
      expect(svc.nextRotationAt(now)).toBeGreaterThan(now);
    }
  });

  it('returns the following boundary, not the current one, when called on a boundary', () => {
    expect(svc.nextRotationAt(BOUNDARY)).toBe(BOUNDARY + R);
  });

  it('returns the imminent boundary one millisecond before it', () => {
    expect(svc.nextRotationAt(BOUNDARY - 1)).toBe(BOUNDARY);
  });

  it('names the exact instant at which currentPeerId changes', () => {
    const now = BOUNDARY + 4_000;
    const next = svc.nextRotationAt(now);
    const idNow = svc.currentPeerId(SEED_A, EVENT_A, now);
    expect(svc.currentPeerId(SEED_A, EVENT_A, next - 1)).toBe(idNow);
    expect(svc.currentPeerId(SEED_A, EVENT_A, next)).not.toBe(idNow);
  });

  it('lands on the rotation grid for a custom period', () => {
    const fast = newService(60_000);
    expect(fast.nextRotationAt(60_001)).toBe(120_000);
    expect(fast.nextRotationAt(119_999)).toBe(120_000);
  });
});

describe('schedule', () => {
  const svc = newService();
  const NOW = BOUNDARY + 3 * 60_000;

  it('covers one epoch of history plus the requested depth ahead', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    expect(windows).toHaveLength(DEFAULT_SCHEDULE_DEPTH + 2);
    expect(windows[0].epoch).toBe(EPOCH_INDEX - 1);
    expect(windows[windows.length - 1].epoch).toBe(EPOCH_INDEX + DEFAULT_SCHEDULE_DEPTH);
  });

  it('lists windows in strictly ascending epoch order', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].epoch).toBe(windows[i - 1].epoch + 1);
      expect(windows[i].validFrom).toBeGreaterThan(windows[i - 1].validFrom);
    }
  });

  it('produces contiguous windows with no gap and no overlap', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].validFrom).toBe(windows[i - 1].validUntil);
    }
  });

  it('aligns each window to the rotation grid and gives it exactly one period', () => {
    for (const w of svc.schedule(SEED_A, EVENT_A, NOW)) {
      expect(w.validFrom).toBe(w.epoch * R);
      expect(w.validUntil - w.validFrom).toBe(R);
    }
  });

  it('contains exactly one window covering the current instant', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    const covering = windows.filter((w) => w.validFrom <= NOW && NOW < w.validUntil);
    expect(covering).toHaveLength(1);
    expect(covering[0].epoch).toBe(EPOCH_INDEX);
    expect(covering[0].peerId).toBe(svc.currentPeerId(SEED_A, EVENT_A, NOW));
  });

  it('gives every window the id currentPeerId returns anywhere inside it', () => {
    for (const w of svc.schedule(SEED_A, EVENT_A, NOW)) {
      expect(svc.currentPeerId(SEED_A, EVENT_A, w.validFrom)).toBe(w.peerId);
      expect(svc.currentPeerId(SEED_A, EVENT_A, w.validFrom + R / 2)).toBe(w.peerId);
      expect(svc.currentPeerId(SEED_A, EVENT_A, w.validUntil - 1)).toBe(w.peerId);
    }
  });

  it('hands the following window id to the instant on the next boundary', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    for (let i = 0; i < windows.length - 1; i++) {
      expect(svc.currentPeerId(SEED_A, EVENT_A, windows[i].validUntil)).toBe(windows[i + 1].peerId);
    }
  });

  it('covers at least the requested horizon into the future', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    const end = windows[windows.length - 1].validUntil;
    expect(end - NOW).toBeGreaterThanOrEqual(DEFAULT_SCHEDULE_DEPTH * R);
    expect(end).toBe((EPOCH_INDEX + DEFAULT_SCHEDULE_DEPTH + 1) * R);
  });

  it('uses a distinct peer id for every window', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW, 32);
    expect(new Set(windows.map((w) => w.peerId)).size).toBe(windows.length);
  });

  it('emits only advertisement-legal peer ids', () => {
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    for (const w of svc.schedule(SEED_A, EVENT_A, NOW, 20)) {
      expect(w.peerId).toMatch(HEX8);
      expect(broadcast(w.peerId, avatar).peerId).toBe(w.peerId);
    }
  });

  it('returns history plus current only at the minimum depth of zero', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW, 0);
    expect(windows.map((w) => w.epoch)).toEqual([EPOCH_INDEX - 1, EPOCH_INDEX]);
  });

  it('adds exactly one future window at depth one', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW, 1);
    expect(windows.map((w) => w.epoch)).toEqual([EPOCH_INDEX - 1, EPOCH_INDEX, EPOCH_INDEX + 1]);
  });

  it('returns an empty schedule when the depth reaches back past the history window', () => {
    // depth -2 makes the loop bound fall below its start: no window is emitted.
    expect(svc.schedule(SEED_A, EVENT_A, NOW, -2)).toEqual([]);
  });

  it('is deterministic: two calls with the same inputs are deeply equal', () => {
    expect(svc.schedule(SEED_A, EVENT_A, NOW)).toEqual(svc.schedule(SEED_A, EVENT_A, NOW));
  });

  it('does not change when now moves within the same epoch', () => {
    expect(svc.schedule(SEED_A, EVENT_A, BOUNDARY)).toEqual(
      svc.schedule(SEED_A, EVENT_A, BOUNDARY + R - 1),
    );
  });

  it('shifts by exactly one window when now crosses a boundary', () => {
    const before = svc.schedule(SEED_A, EVENT_A, BOUNDARY + R - 1);
    const after = svc.schedule(SEED_A, EVENT_A, BOUNDARY + R);
    expect(after[0]).toEqual(before[1]);
    expect(after[after.length - 1].epoch).toBe(before[before.length - 1].epoch + 1);
  });

  it('builds its windows on the configured rotation period', () => {
    const fast = newService(60_000);
    const windows = fast.schedule(SEED_A, EVENT_A, 600_000, 2);
    expect(windows.map((w) => w.validFrom)).toEqual([540_000, 600_000, 660_000, 720_000]);
    expect(windows[3].validUntil).toBe(780_000);
  });
});

describe('needsRepublish', () => {
  const svc = newService();
  const NOW = BOUNDARY + 1_000;

  it('demands a republish when nothing has ever been published', () => {
    expect(svc.needsRepublish([], NOW)).toBe(true);
  });

  it('is satisfied by a schedule published in the current epoch', () => {
    expect(svc.needsRepublish(svc.schedule(SEED_A, EVENT_A, NOW), NOW)).toBe(false);
  });

  it('is still satisfied at the exact threshold of three epochs of coverage', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    // Last covered epoch is EPOCH_INDEX + 8; move now forward five epochs so
    // exactly three remain ahead — the documented minimum, still acceptable.
    const at = BOUNDARY + 5 * R;
    expect(svc.epochAt(at)).toBe(EPOCH_INDEX + 5);
    expect(svc.needsRepublish(windows, at)).toBe(false);
  });

  it('demands a republish one epoch past the threshold', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    const at = BOUNDARY + 6 * R;
    expect(svc.epochAt(at)).toBe(EPOCH_INDEX + 6);
    expect(svc.needsRepublish(windows, at)).toBe(true);
  });

  it('flips exactly at the boundary millisecond of the threshold epoch', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    expect(svc.needsRepublish(windows, BOUNDARY + 6 * R - 1)).toBe(false);
    expect(svc.needsRepublish(windows, BOUNDARY + 6 * R)).toBe(true);
  });

  it('demands a republish once the last window has expired', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    expect(svc.needsRepublish(windows, BOUNDARY + 20 * R)).toBe(true);
  });

  it('honours a custom minimum of zero epochs ahead', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW, 2);
    // Last covered epoch is EPOCH_INDEX + 2.
    expect(svc.needsRepublish(windows, BOUNDARY + 2 * R, 0)).toBe(false);
    expect(svc.needsRepublish(windows, BOUNDARY + 3 * R, 0)).toBe(true);
  });

  it('honours a custom minimum of one epoch ahead', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW, 2);
    expect(svc.needsRepublish(windows, BOUNDARY + R, 1)).toBe(false);
    expect(svc.needsRepublish(windows, BOUNDARY + 2 * R, 1)).toBe(true);
  });

  it('judges by the furthest covered epoch regardless of array order', () => {
    const windows = svc.schedule(SEED_A, EVENT_A, NOW);
    const shuffled: PeerIdWindow[] = [...windows].reverse();
    expect(svc.needsRepublish(shuffled, NOW)).toBe(false);
    expect(svc.needsRepublish(shuffled, BOUNDARY + 6 * R)).toBe(true);
  });

  it('treats a single-window schedule as covering only its own epoch', () => {
    const only: PeerIdWindow[] = [
      {
        peerId: svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX),
        epoch: EPOCH_INDEX,
        validFrom: BOUNDARY,
        validUntil: BOUNDARY + R,
      },
    ];
    expect(svc.needsRepublish(only, NOW)).toBe(true);
    expect(svc.needsRepublish(only, NOW, 0)).toBe(false);
  });
});

describe('deriveAvatarId', () => {
  const svc = newService();

  it('is exactly four uppercase hexadecimal characters', () => {
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    expect(avatar).toHaveLength(4);
    expect(avatar).toMatch(HEX4);
    expect(avatar).toBe(avatar.toUpperCase());
  });

  it('returns the same value for the same seed and event on every call', () => {
    const first = svc.deriveAvatarId(SEED_A, EVENT_A);
    for (let i = 0; i < 20; i++) expect(svc.deriveAvatarId(SEED_A, EVENT_A)).toBe(first);
  });

  it('differs for two seeds at the same event', () => {
    expect(svc.deriveAvatarId(SEED_A, EVENT_A)).not.toBe(svc.deriveAvatarId(SEED_B, EVENT_A));
  });

  it('differs for one seed at two events', () => {
    expect(svc.deriveAvatarId(SEED_A, EVENT_A)).not.toBe(svc.deriveAvatarId(SEED_A, EVENT_B));
  });

  it('is domain-separated from the peer id derivation', () => {
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    const peer = svc.derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX);
    expect(peer.startsWith(avatar)).toBe(false);
  });

  it('is accepted verbatim by encodeAdvertisement and survives the decode round trip', () => {
    const avatar = svc.deriveAvatarId(SEED_A, EVENT_A);
    const peer = svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY);
    expect(broadcast(peer, avatar).avatarId).toBe(avatar);
  });

  // REGRESSION: the whole broadcast tuple must turn over together across a day.
  // The avatar id used to be derived from (seed, eventId) alone, so it stayed
  // constant for 96 consecutive epochs and handed a passive observer a stable
  // handle to stitch them back together with.
  it('turns over with the peer id across every epoch of a whole day', () => {
    const broadcastAvatars = new Set<string>();
    const broadcastPeers = new Set<string>();
    for (let i = 0; i < 96; i++) {
      const at = BOUNDARY + i * R;
      const frame = broadcast(
        svc.currentPeerId(SEED_A, EVENT_A, at),
        svc.deriveAvatarId(SEED_A, EVENT_A, at),
      );
      broadcastAvatars.add(frame.avatarId);
      broadcastPeers.add(frame.peerId);
    }
    expect(broadcastPeers.size).toBe(96);
    // Two bytes is a 65,536-value space, so 96 draws collide occasionally by
    // chance; what matters is that it is not pinned to one value all day.
    expect(broadcastAvatars.size).toBeGreaterThan(90);
  });

  it('is stable within a single epoch, so one advertisement window is coherent', () => {
    const start = svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY);
    expect(svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY + 1)).toBe(start);
    expect(svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY + R - 1)).toBe(start);
    expect(svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY + R)).not.toBe(start);
  });

  /**
   * REGRESSION (was a defect at BleIdentity.ts:109-112, fixed).
   *
   * The avatar id rides in the same frame as the rotating peer id
   * (BleProtocol.ts:167-168). Derived from (seed, eventId) with no epoch, it
   * gave a passive observer a constant two bytes with which to link every
   * advertisement a device emitted for the whole event — defeating the module
   * header's promise that "the identifier rotates on a fixed epoch so a passive
   * observer cannot follow one device across a whole day". The epoch is now
   * folded into the derivation exactly as `derivePeerId` does it.
   */
  it('rotates with the peer id so two epochs cannot be linked on it', () => {
    const epochOne = broadcast(
      svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY),
      svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY),
    );
    const epochTwo = broadcast(
      svc.currentPeerId(SEED_A, EVENT_A, BOUNDARY + R),
      svc.deriveAvatarId(SEED_A, EVENT_A, BOUNDARY + R),
    );
    expect(epochTwo.peerId).not.toBe(epochOne.peerId);
    expect(epochTwo.avatarId).not.toBe(epochOne.avatarId);
  });
});

describe('createSeed', () => {
  it('produces a seed of the documented length', () => {
    expect(SEED_BYTES).toBe(16);
    const seed = new PeerIdentityService().createSeed();
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(SEED_BYTES);
  });

  it('produces a distinct seed on every call', () => {
    const svc = new PeerIdentityService();
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) seen.add(svc.createSeed().join(','));
    expect(seen.size).toBe(64);
  });

  it('does not return an all-zero seed from the platform CSPRNG', () => {
    const seed = new PeerIdentityService().createSeed();
    expect(seed.some((byte) => byte !== 0)).toBe(true);
  });

  it('asks the injected random source for exactly SEED_BYTES bytes', () => {
    const requested: number[] = [];
    const random: RandomSource = (byteLength) => {
      requested.push(byteLength);
      return new Uint8Array(byteLength).fill(0xab);
    };
    const seed = new PeerIdentityService({ random }).createSeed();
    expect(requested).toEqual([SEED_BYTES]);
    expect([...seed]).toEqual(new Array<number>(SEED_BYTES).fill(0xab));
  });

  it('feeds a freshly created seed straight into a legal advertisement', () => {
    const svc = new PeerIdentityService();
    const seed = svc.createSeed();
    const peer = svc.currentPeerId(seed, EVENT_A, BOUNDARY);
    const avatar = svc.deriveAvatarId(seed, EVENT_A);
    expect(peer).toMatch(HEX8);
    expect(avatar).toMatch(HEX4);
    const frame = broadcast(peer, avatar);
    expect(frame.peerId).toBe(peer);
    expect(frame.avatarId).toBe(avatar);
  });

  it('gives two independently created seeds unrelated ids at the same event', () => {
    const svc = new PeerIdentityService();
    const a = svc.currentPeerId(svc.createSeed(), EVENT_A, BOUNDARY);
    const b = svc.currentPeerId(svc.createSeed(), EVENT_A, BOUNDARY);
    expect(a).not.toBe(b);
  });
});

describe('the shared peerIdentityService singleton', () => {
  it('rotates on the default period', () => {
    expect(peerIdentityService.nextRotationAt(BOUNDARY + 1)).toBe(BOUNDARY + R);
    expect(peerIdentityService.currentPeerId(SEED_A, EVENT_A, BOUNDARY)).toBe(
      new PeerIdentityService().derivePeerId(SEED_A, EVENT_A, EPOCH_INDEX),
    );
  });

  it('publishes the default schedule depth', () => {
    expect(peerIdentityService.schedule(SEED_A, EVENT_A, BOUNDARY)).toHaveLength(
      DEFAULT_SCHEDULE_DEPTH + 2,
    );
  });
});
