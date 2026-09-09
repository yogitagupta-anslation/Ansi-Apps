/**
 * PeerRegistry — the "who is near me" state machine.
 *
 * Every frame in this suite is produced by the real `encodeAdvertisement`, so the
 * registry is exercised through the same bytes a radio would hand it. Nothing is
 * mocked: the RSSI filter, the distance model and the band classifier are the real
 * implementations. Time is driven exclusively through explicit `timestamp` /
 * `tick(now)` arguments — the registry is timer-free by design.
 */

import type { EncodeInput } from '../bluetooth/BleProtocol';
import { encodeAdvertisement } from '../bluetooth/BleProtocol';
import type { PeerChange, PeerChangeKind, PeerRegistryOptions } from '../bluetooth/PeerRegistry';
import { PeerRegistry } from '../bluetooth/PeerRegistry';
import type { BleScanResult, PeerCapabilities } from '../types';

const EVENT_CODE = 0x1234;
const OTHER_EVENT_CODE = 0x4321;

const PEER_A = 'AABBCCDD';
const PEER_B = '11223344';
const PEER_C = '99887766';
const PEER_D = 'FEDCBA98';

const CAPS: PeerCapabilities = {
  acceptsConnections: true,
  supportsNavigation: false,
  isAnchor: false,
};

/** TTLs used by every test unless a case overrides them, so boundaries are explicit. */
const ACTIVE_AFTER_MS = 5_000;
const STALE_AFTER_MS = 12_000;
const EXPIRE_AFTER_MS = 30_000;
const DUPLICATE_WINDOW_MS = 25;

/**
 * A filter configuration with no smoothing and no warm-up, used where a test needs
 * the smoothed RSSI (and therefore the band) to equal the raw sample exactly.
 * These are ordinary constructor options of the module under test, not a fake.
 */
const RAW_FILTER = { medianWindow: 1, emaAlpha: 1, warmupSamples: 1 };

function buildFrame(overrides: Partial<EncodeInput> = {}): Uint8Array {
  return encodeAdvertisement({
    eventCode: EVENT_CODE,
    peerId: PEER_A,
    profileVersion: 7,
    avatarId: 'A1B2',
    displayTag: 'Ana',
    status: 'available',
    capabilities: CAPS,
    ...overrides,
  });
}

interface ScanOptions extends Partial<EncodeInput> {
  rssi?: number;
  timestamp?: number;
}

/** A scan hit carrying a genuinely encoded EventPulse frame. */
function scan(options: ScanOptions = {}): BleScanResult {
  const { rssi = -55, timestamp = 0, ...encodeOverrides } = options;
  return { data: buildFrame(encodeOverrides), rssi, timestamp };
}

function withByte(bytes: Uint8Array, index: number, value: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index] = value;
  return copy;
}

function makeRegistry(overrides: Partial<PeerRegistryOptions> = {}): PeerRegistry {
  return new PeerRegistry({
    eventCode: EVENT_CODE,
    activeAfterMs: ACTIVE_AFTER_MS,
    staleAfterMs: STALE_AFTER_MS,
    expireAfterMs: EXPIRE_AFTER_MS,
    duplicateWindowMs: DUPLICATE_WINDOW_MS,
    ...overrides,
  });
}

/** Feed the three distinct packets the default filter needs before it is warm. */
function warmUp(registry: PeerRegistry, peerId: string, startAt = 0): number {
  registry.ingest(scan({ peerId, rssi: -55, timestamp: startAt }));
  registry.ingest(scan({ peerId, rssi: -56, timestamp: startAt + 100 }));
  registry.ingest(scan({ peerId, rssi: -55, timestamp: startAt + 200 }));
  return startAt + 200;
}

function kinds(changes: readonly PeerChange[]): PeerChangeKind[] {
  return changes.map((c) => c.kind);
}

/* ------------------------------------------------------------------ *
 * First packet
 * ------------------------------------------------------------------ */

describe('the first packet from a peer', () => {
  it('creates exactly one record in the initial `discovered` state', () => {
    const registry = makeRegistry();

    const result = registry.ingest(scan({ timestamp: 1_000 }));

    expect(result).toEqual({ accepted: true, peerId: PEER_A });
    expect(registry.size).toBe(1);
    expect(registry.get(PEER_A)?.state).toBe('discovered');
  });

  it('copies the advertised fields onto the record verbatim', () => {
    const registry = makeRegistry();
    registry.ingest(
      scan({
        peerId: PEER_B,
        profileVersion: 42,
        avatarId: '00FF',
        displayTag: 'Bo',
        status: 'busy',
        capabilities: {
          acceptsConnections: false,
          supportsNavigation: true,
          isAnchor: true,
        },
        rssi: -70,
        timestamp: 1_500,
      }),
    );

    const record = registry.get(PEER_B);
    expect(record).toBeDefined();
    expect(record?.peerId).toBe(PEER_B);
    expect(record?.eventCode).toBe(EVENT_CODE);
    expect(record?.advertisement.profileVersion).toBe(42);
    expect(record?.advertisement.avatarId).toBe('00FF');
    expect(record?.advertisement.displayTag).toBe('Bo');
    expect(record?.advertisement.status).toBe('busy');
    expect(record?.advertisement.capabilities).toEqual({
      acceptsConnections: false,
      supportsNavigation: true,
      isAnchor: true,
    });
    expect(record?.advertisement.protocolVersion).toBe(1);
  });

  it('seeds the timing and signal fields from the single sample it has', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ rssi: -55, timestamp: 2_000 }));

    const record = registry.get(PEER_A);
    expect(record?.firstSeen).toBe(2_000);
    expect(record?.lastSeen).toBe(2_000);
    expect(record?.packets).toBe(1);
    expect(record?.rawRssi).toBe(-55);
    // One sample: median === raw, and the EMA seeds from it, so no smoothing lag.
    expect(record?.rssi).toBe(-55);
    // -55 dBm through the default log-distance model lands well inside 3 m.
    expect(record?.estimatedDistance).toBeCloseTo(0.6813, 4);
    expect(record?.band).toBe('very_close');
    // The trend is withheld until the filter is warm, so navigation never opens on a guess.
    expect(record?.trend).toBe('steady');
  });

  it('queues a single `added` change carrying the record and bumps the revision to 1', () => {
    const registry = makeRegistry();
    expect(registry.version).toBe(0);

    registry.ingest(scan({ timestamp: 10 }));

    expect(registry.version).toBe(1);
    const changes = registry.drainChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('added');
    expect(changes[0].peerId).toBe(PEER_A);
    expect(changes[0].record?.state).toBe('discovered');
  });
});

/* ------------------------------------------------------------------ *
 * Event filtering
 * ------------------------------------------------------------------ */

describe('event filtering', () => {
  it('rejects a well-formed frame belonging to another event before allocating anything', () => {
    const registry = makeRegistry();

    const result = registry.ingest(scan({ eventCode: OTHER_EVENT_CODE, timestamp: 5 }));

    expect(result).toEqual({ accepted: false, reason: 'wrong_event' });
    // Rejected at the pre-filter: no peerId is even reported back, and nothing is tracked.
    expect(result.peerId).toBeUndefined();
    expect(registry.size).toBe(0);
    expect(registry.get(PEER_A)).toBeUndefined();
    expect(registry.version).toBe(0);
    expect(registry.drainChanges()).toEqual([]);
  });

  it('rejects the event codes immediately either side of the configured one', () => {
    const registry = makeRegistry();

    expect(registry.ingest(scan({ eventCode: EVENT_CODE - 1 })).reason).toBe('wrong_event');
    expect(registry.ingest(scan({ eventCode: EVENT_CODE + 1 })).reason).toBe('wrong_event');
    expect(registry.ingest(scan({ eventCode: EVENT_CODE })).accepted).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('keeps two events apart when both are in the air at once', () => {
    const registry = makeRegistry();

    registry.ingest(scan({ peerId: PEER_A, eventCode: EVENT_CODE, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, eventCode: OTHER_EVENT_CODE, timestamp: 1 }));
    registry.ingest(scan({ peerId: PEER_C, eventCode: EVENT_CODE, timestamp: 2 }));

    expect(
      registry
        .getAll()
        .map((r) => r.peerId)
        .sort(),
    ).toEqual([PEER_A, PEER_C].sort());
  });
});

/* ------------------------------------------------------------------ *
 * Frame validation
 * ------------------------------------------------------------------ */

describe('malformed frames', () => {
  it('rejects a frame whose CRC does not match, without creating a record', () => {
    const registry = makeRegistry();
    const frame = buildFrame();
    const corrupted = withByte(frame, frame.length - 1, frame[frame.length - 1] ^ 0xff);

    const result = registry.ingest({
      data: corrupted,
      rssi: -55,
      timestamp: 0,
    });

    // The two-byte pre-filter still passes (version + event code are intact),
    // so this one reaches the full decode and fails there.
    expect(result).toEqual({ accepted: false, reason: 'undecodable' });
    expect(registry.size).toBe(0);
    expect(registry.version).toBe(0);
  });

  it('rejects a frame announcing an unsupported protocol version', () => {
    const registry = makeRegistry();
    const future = buildFrame({ protocolVersion: 2 });

    const result = registry.ingest({ data: future, rssi: -55, timestamp: 0 });

    expect(result.accepted).toBe(false);
    // `matchesEvent` checks the version nibble as part of its two-byte pre-filter, so a
    // future-version frame is refused there and reported as `wrong_event` rather than
    // `undecodable`. The rejection is what matters; the label is a diagnostic detail.
    expect(result.reason).toBe('wrong_event');
    expect(registry.size).toBe(0);
  });

  it('rejects a frame truncated below the minimum length', () => {
    const registry = makeRegistry();
    const short = buildFrame().slice(0, 12);

    expect(registry.ingest({ data: short, rssi: -55, timestamp: 0 }).accepted).toBe(false);
    expect(registry.ingest({ data: new Uint8Array(0), rssi: -55, timestamp: 0 }).accepted).toBe(
      false,
    );
    expect(registry.size).toBe(0);
  });

  it('rejects a frame whose declared tag length overruns the buffer', () => {
    const registry = makeRegistry();
    // 'Ana' is 3 bytes; claiming 8 pushes the CRC offset past the end of the frame.
    const lying = withByte(buildFrame({ displayTag: 'Ana' }), 11, 8);

    expect(registry.ingest({ data: lying, rssi: -55, timestamp: 0 })).toEqual({
      accepted: false,
      reason: 'undecodable',
    });
    expect(registry.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Deduplication
 * ------------------------------------------------------------------ */

describe('deduplication', () => {
  it('collapses a torrent of identical packets into one record whose packet counter rises', () => {
    const registry = makeRegistry();

    for (let i = 0; i < 50; i++) {
      registry.ingest(scan({ rssi: -60, timestamp: i * 100 }));
    }

    expect(registry.size).toBe(1);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get(PEER_A)?.packets).toBe(50);
    expect(registry.get(PEER_A)?.lastSeen).toBe(4_900);
    // firstSeen is set once and never moves.
    expect(registry.get(PEER_A)?.firstSeen).toBe(0);
  });

  it('discards a same-RSSI repeat inside the duplicate window instead of counting it', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ rssi: -60, timestamp: 1_000 }));

    const result = registry.ingest(scan({ rssi: -60, timestamp: 1_010 }));

    expect(result).toEqual({
      accepted: false,
      reason: 'duplicate',
      peerId: PEER_A,
    });
    expect(registry.get(PEER_A)?.packets).toBe(1);
    expect(registry.version).toBe(1);
  });

  it('treats a repeat at exactly the duplicate window as a fresh packet, one millisecond earlier as a duplicate', () => {
    const atBoundary = makeRegistry();
    atBoundary.ingest(scan({ rssi: -60, timestamp: 0 }));
    expect(atBoundary.ingest(scan({ rssi: -60, timestamp: DUPLICATE_WINDOW_MS })).accepted).toBe(
      true,
    );
    expect(atBoundary.get(PEER_A)?.packets).toBe(2);

    const belowBoundary = makeRegistry();
    belowBoundary.ingest(scan({ rssi: -60, timestamp: 0 }));
    expect(
      belowBoundary.ingest(scan({ rssi: -60, timestamp: DUPLICATE_WINDOW_MS - 1 })).reason,
    ).toBe('duplicate');
    expect(belowBoundary.get(PEER_A)?.packets).toBe(1);
  });

  it('still refreshes lastSeen for a discarded duplicate so the peer does not age out', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ rssi: -60, timestamp: 1_000 }));

    registry.ingest(scan({ rssi: -60, timestamp: 1_020 }));

    expect(registry.get(PEER_A)?.lastSeen).toBe(1_020);
    expect(registry.get(PEER_A)?.packets).toBe(1);
  });

  it('folds in a same-instant packet whose RSSI differs, since that is a real second reading', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ rssi: -60, timestamp: 1_000 }));

    const result = registry.ingest(scan({ rssi: -61, timestamp: 1_000 }));

    expect(result).toEqual({ accepted: true, peerId: PEER_A });
    expect(registry.get(PEER_A)?.packets).toBe(2);
    expect(registry.get(PEER_A)?.rawRssi).toBe(-61);
  });

  it('deduplicates per peer, not globally', () => {
    const registry = makeRegistry();

    registry.ingest(scan({ peerId: PEER_A, rssi: -60, timestamp: 0 }));
    const other = registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 1 }));

    expect(other.accepted).toBe(true);
    expect(registry.size).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

describe('the presence state machine', () => {
  it('holds a peer at `discovered` until the RSSI filter has warmed up', () => {
    const registry = makeRegistry();

    registry.ingest(scan({ rssi: -55, timestamp: 0 }));
    expect(registry.get(PEER_A)?.state).toBe('discovered');

    registry.ingest(scan({ rssi: -56, timestamp: 100 }));
    expect(registry.get(PEER_A)?.state).toBe('discovered');

    // Third distinct sample: warmupSamples defaults to 3.
    registry.ingest(scan({ rssi: -55, timestamp: 200 }));
    expect(registry.get(PEER_A)?.state).toBe('active');
  });

  it('reports the discovered -> active promotion as a state change', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A);

    const changes = registry.drainChanges();
    expect(kinds(changes)).toEqual(['added', 'state_changed']);
    expect(changes[1].previousState).toBe('discovered');
    expect(changes[1].record?.state).toBe('active');
  });

  it('demotes active -> nearby at exactly activeAfterMs and not one millisecond sooner', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.drainChanges();

    expect(registry.tick(lastPacket + ACTIVE_AFTER_MS - 1)).toEqual([]);
    expect(registry.get(PEER_A)?.state).toBe('active');

    const changes = registry.tick(lastPacket + ACTIVE_AFTER_MS);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('state_changed');
    expect(changes[0].peerId).toBe(PEER_A);
    expect(changes[0].previousState).toBe('active');
    expect(registry.get(PEER_A)?.state).toBe('nearby');
  });

  it('demotes nearby -> out_of_range at exactly staleAfterMs and not one millisecond sooner', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.tick(lastPacket + ACTIVE_AFTER_MS);

    expect(registry.tick(lastPacket + STALE_AFTER_MS - 1)).toEqual([]);
    expect(registry.get(PEER_A)?.state).toBe('nearby');

    const changes = registry.tick(lastPacket + STALE_AFTER_MS);
    expect(changes).toHaveLength(1);
    expect(changes[0].previousState).toBe('nearby');
    expect(registry.get(PEER_A)?.state).toBe('out_of_range');
  });

  it('walks a silent peer through the full documented sequence in order', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    const seen: string[] = ['discovered', 'active'];

    for (const now of [
      lastPacket + ACTIVE_AFTER_MS,
      lastPacket + STALE_AFTER_MS,
      lastPacket + EXPIRE_AFTER_MS,
    ]) {
      const changes = registry.tick(now);
      for (const change of changes) {
        seen.push(change.kind === 'removed' ? 'expired' : (change.record?.state ?? 'unknown'));
      }
    }

    expect(seen).toEqual(['discovered', 'active', 'nearby', 'out_of_range', 'expired']);
  });

  it('restores a stale peer to active the moment it advertises again', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.tick(lastPacket + STALE_AFTER_MS);
    expect(registry.get(PEER_A)?.state).toBe('out_of_range');
    registry.drainChanges();

    const result = registry.ingest(scan({ rssi: -57, timestamp: lastPacket + STALE_AFTER_MS + 5 }));

    expect(result.accepted).toBe(true);
    expect(registry.get(PEER_A)?.state).toBe('active');
    expect(kinds(registry.drainChanges())).toEqual(['state_changed']);
  });

  it('keeps a continuously advertising peer active forever', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A);

    for (let t = 1_000; t <= 120_000; t += 1_000) {
      registry.ingest(scan({ rssi: -55, timestamp: t }));
      registry.tick(t);
    }

    expect(registry.get(PEER_A)?.state).toBe('active');
    expect(registry.size).toBe(1);
  });

  it('never promotes a peer that has not warmed up, but still ages it out', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ rssi: -55, timestamp: 0 }));

    // Age past activeAfterMs: a cold peer stays `discovered` rather than becoming `nearby`.
    expect(registry.tick(ACTIVE_AFTER_MS)).toEqual([]);
    expect(registry.get(PEER_A)?.state).toBe('discovered');

    const stale = registry.tick(STALE_AFTER_MS);
    expect(stale[0].previousState).toBe('discovered');
    expect(registry.get(PEER_A)?.state).toBe('out_of_range');

    expect(kinds(registry.tick(EXPIRE_AFTER_MS))).toEqual(['removed']);
    expect(registry.size).toBe(0);
  });

  it('returns an empty change list from a tick that settles nothing', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    registry.drainChanges();

    expect(registry.tick(300)).toEqual([]);
    expect(registry.tick(301)).toEqual([]);
    expect(registry.drainChanges()).toEqual([]);
  });

  it('ticks an empty registry without error', () => {
    const registry = makeRegistry();
    expect(registry.tick(999_999)).toEqual([]);
    expect(registry.version).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Expiry
 * ------------------------------------------------------------------ */

describe('peer expiry', () => {
  it('keeps a peer at exactly one millisecond before expireAfterMs and removes it at the threshold', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.tick(lastPacket + STALE_AFTER_MS);
    registry.drainChanges();

    expect(registry.tick(lastPacket + EXPIRE_AFTER_MS - 1)).toEqual([]);
    expect(registry.get(PEER_A)).toBeDefined();
    expect(registry.size).toBe(1);

    const changes = registry.tick(lastPacket + EXPIRE_AFTER_MS);
    expect(changes).toEqual([{ kind: 'removed', peerId: PEER_A, previousState: 'out_of_range' }]);
    expect(registry.get(PEER_A)).toBeUndefined();
    expect(registry.size).toBe(0);
  });

  it('expires only the silent peer and leaves the one still advertising', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    warmUp(registry, PEER_B, 0);
    for (let t = 1_000; t <= 30_200; t += 1_000) {
      registry.ingest(scan({ peerId: PEER_B, rssi: -55, timestamp: t }));
    }

    const changes = registry.tick(30_200);

    expect(changes.filter((c) => c.kind === 'removed').map((c) => c.peerId)).toEqual([PEER_A]);
    expect(registry.getAll().map((r) => r.peerId)).toEqual([PEER_B]);
  });

  it('expires a peer straight from `discovered` when it only ever sent one packet', () => {
    const registry = makeRegistry({ expireAfterMs: 1_000, staleAfterMs: 900 });
    registry.ingest(scan({ rssi: -55, timestamp: 0 }));

    expect(registry.tick(999)[0].record?.state).toBe('out_of_range');
    expect(registry.tick(1_000)).toEqual([
      { kind: 'removed', peerId: PEER_A, previousState: 'out_of_range' },
    ]);
    expect(registry.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * getVisible / getAll
 * ------------------------------------------------------------------ */

describe('getVisible', () => {
  it('includes a peer in every non-expired stage, including out_of_range', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ peerId: PEER_A, rssi: -55, timestamp: 0 }));
    expect(registry.getVisible().map((r) => r.state)).toEqual(['discovered']);

    const lastPacket = warmUp(registry, PEER_A);
    expect(registry.getVisible().map((r) => r.state)).toEqual(['active']);
    registry.tick(lastPacket + ACTIVE_AFTER_MS);
    expect(registry.getVisible().map((r) => r.state)).toEqual(['nearby']);
    // out_of_range is deliberately still visible: a faded node beats one that vanishes
    // mid-conversation.
    registry.tick(lastPacket + STALE_AFTER_MS);
    expect(registry.getVisible().map((r) => r.state)).toEqual(['out_of_range']);
  });

  it('drops the peer entirely once it expires', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.tick(lastPacket + EXPIRE_AFTER_MS);

    expect(registry.getVisible()).toEqual([]);
    expect(registry.getAll()).toEqual([]);
  });

  it('never yields a record whose state is `expired`', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    warmUp(registry, PEER_B, 0);

    for (let now = 0; now <= 40_000; now += 500) {
      registry.tick(now);
      expect(registry.getVisible().every((r) => r.state !== 'expired')).toBe(true);
    }
    expect(registry.size).toBe(0);
  });

  it('orders peers strongest signal first', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ peerId: PEER_A, rssi: -70, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -50, timestamp: 1 }));
    registry.ingest(scan({ peerId: PEER_C, rssi: -60, timestamp: 2 }));

    expect(registry.getAll().map((r) => r.peerId)).toEqual([PEER_B, PEER_C, PEER_A]);
    expect(registry.getVisible().map((r) => r.peerId)).toEqual([PEER_B, PEER_C, PEER_A]);
  });
});

/* ------------------------------------------------------------------ *
 * Bands and trend
 * ------------------------------------------------------------------ */

describe('band and trend tracking', () => {
  it('emits a band change when a peer moves out of its band', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    registry.ingest(scan({ rssi: -55, timestamp: 0 }));
    expect(registry.get(PEER_A)?.band).toBe('very_close');
    registry.drainChanges();

    registry.ingest(scan({ rssi: -85, timestamp: 1_000 }));

    const bandChanges = registry.drainChanges().filter((c) => c.kind === 'band_changed');
    expect(bandChanges).toHaveLength(1);
    expect(bandChanges[0].previousBand).toBe('very_close');
    expect(registry.get(PEER_A)?.band).toBe('far');
  });

  it('applies hysteresis so a peer hovering on a boundary does not flicker', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    // -79 dBm -> 6.81 m, inside `close` (ceiling 7 m).
    registry.ingest(scan({ rssi: -79, timestamp: 0 }));
    expect(registry.get(PEER_A)?.band).toBe('close');
    registry.drainChanges();

    // -80 dBm -> 7.50 m: naively `nearby`, but short of the 7 + 0.75 m overshoot.
    registry.ingest(scan({ rssi: -80, timestamp: 1_000 }));
    expect(registry.get(PEER_A)?.band).toBe('close');
    expect(registry.drainChanges().filter((c) => c.kind === 'band_changed')).toEqual([]);

    // -81 dBm -> 8.25 m clears the margin.
    registry.ingest(scan({ rssi: -81, timestamp: 2_000 }));
    expect(registry.get(PEER_A)?.band).toBe('nearby');
    expect(registry.drainChanges().filter((c) => c.kind === 'band_changed')).toHaveLength(1);
  });

  it('reports an approaching peer once the filter is warm', () => {
    const registry = makeRegistry({ rssiOptions: { medianWindow: 1 } });
    registry.ingest(scan({ rssi: -90, timestamp: 0 }));
    registry.ingest(scan({ rssi: -80, timestamp: 1_000 }));
    expect(registry.get(PEER_A)?.trend).toBe('steady');

    registry.ingest(scan({ rssi: -70, timestamp: 2_000 }));

    expect(registry.get(PEER_A)?.trend).toBe('approaching');
  });

  it('reports a receding peer once the filter is warm', () => {
    const registry = makeRegistry({ rssiOptions: { medianWindow: 1 } });
    registry.ingest(scan({ rssi: -70, timestamp: 0 }));
    registry.ingest(scan({ rssi: -80, timestamp: 1_000 }));
    registry.ingest(scan({ rssi: -90, timestamp: 2_000 }));

    expect(registry.get(PEER_A)?.trend).toBe('receding');
  });

  it('emits a profile version hint without touching the advertised identity', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    registry.ingest(scan({ profileVersion: 7, rssi: -55, timestamp: 0 }));
    registry.drainChanges();

    registry.ingest(scan({ profileVersion: 8, rssi: -55, timestamp: 1_000 }));

    const hints = registry.drainChanges().filter((c) => c.kind === 'profile_version_changed');
    expect(hints).toHaveLength(1);
    expect(hints[0].peerId).toBe(PEER_A);
    expect(registry.get(PEER_A)?.advertisement.profileVersion).toBe(8);
    expect(registry.size).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * drainChanges
 * ------------------------------------------------------------------ */

describe('drainChanges', () => {
  it('reports every transition once and is empty on the next call', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    registry.ingest(scan({ rssi: -55, profileVersion: 7, timestamp: 0 }));
    registry.ingest(scan({ rssi: -85, profileVersion: 8, timestamp: 1_000 }));

    expect(kinds(registry.drainChanges())).toEqual([
      'added',
      'state_changed',
      'band_changed',
      'profile_version_changed',
    ]);
    expect(registry.drainChanges()).toEqual([]);
  });

  it('reports a tick removal exactly once', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.drainChanges();

    const returned = registry.tick(lastPacket + EXPIRE_AFTER_MS);
    const drained = registry.drainChanges();

    expect(kinds(returned)).toEqual(['removed']);
    expect(kinds(drained)).toEqual(['removed']);
    expect(registry.drainChanges()).toEqual([]);
  });

  it('accumulates ingest and tick changes together in arrival order', () => {
    const registry = makeRegistry();
    const lastPacket = warmUp(registry, PEER_A);
    registry.tick(lastPacket + ACTIVE_AFTER_MS);
    registry.ingest(
      scan({
        peerId: PEER_B,
        rssi: -60,
        timestamp: lastPacket + ACTIVE_AFTER_MS,
      }),
    );

    expect(kinds(registry.drainChanges())).toEqual([
      'added', // A
      'state_changed', // A discovered -> active
      'state_changed', // A active -> nearby (tick)
      'added', // B
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Identity: rotation and lookalikes
 * ------------------------------------------------------------------ */

describe('peer identity', () => {
  it('treats two peer ids as two people, because a rotatable id is all it can see', () => {
    const registry = makeRegistry();
    // Same human, same display tag, same avatar, same profile version — only the
    // event-scoped peer id differs. Nothing in the frame links them, and the registry
    // deliberately does not guess: it would rather show a duplicate node than merge
    // two strangers who happen to share a display tag.
    const shared = { displayTag: 'Ana', avatarId: 'A1B2', profileVersion: 7 };
    registry.ingest(scan({ ...shared, peerId: PEER_A, rssi: -55, timestamp: 0 }));
    registry.ingest(scan({ ...shared, peerId: PEER_B, rssi: -55, timestamp: 1 }));

    expect(registry.size).toBe(2);
    expect(registry.get(PEER_A)?.advertisement.displayTag).toBe('Ana');
    expect(registry.get(PEER_B)?.advertisement.displayTag).toBe('Ana');
    expect(registry.get(PEER_A)?.packets).toBe(1);
    expect(registry.get(PEER_B)?.packets).toBe(1);
  });

  it('starts a rotated identity from scratch rather than inheriting the old record', () => {
    const registry = makeRegistry();
    const rotateAt = warmUp(registry, PEER_A);
    expect(registry.get(PEER_A)?.state).toBe('active');

    registry.ingest(scan({ peerId: PEER_B, rssi: -55, timestamp: rotateAt }));

    const rotated = registry.get(PEER_B);
    expect(rotated?.state).toBe('discovered');
    expect(rotated?.packets).toBe(1);
    expect(rotated?.firstSeen).toBe(rotateAt);
    // The old record is untouched: no history is carried across a rotation.
    expect(registry.get(PEER_A)?.packets).toBe(3);
  });

  it('lets an old identity and its replacement coexist for exactly expireAfterMs', () => {
    const registry = makeRegistry();
    const rotateAt = warmUp(registry, PEER_A); // A's last packet
    registry.ingest(scan({ peerId: PEER_B, rssi: -55, timestamp: rotateAt }));
    expect(registry.size).toBe(2);

    // B keeps advertising; A is silent from `rotateAt` onwards.
    for (let t = rotateAt + 1_000; t < rotateAt + EXPIRE_AFTER_MS; t += 1_000) {
      registry.ingest(scan({ peerId: PEER_B, rssi: -55, timestamp: t }));
      registry.tick(t);
    }

    // One millisecond before the ceiling both are still tracked — the duplicate-node window.
    expect(registry.tick(rotateAt + EXPIRE_AFTER_MS - 1)).toEqual([]);
    expect(registry.size).toBe(2);
    expect(
      registry
        .getVisible()
        .map((r) => r.peerId)
        .sort(),
    ).toEqual([PEER_B, PEER_A].sort());

    const changes = registry.tick(rotateAt + EXPIRE_AFTER_MS);

    expect(changes).toEqual([{ kind: 'removed', peerId: PEER_A, previousState: 'out_of_range' }]);
    expect(registry.size).toBe(1);
    expect(registry.get(PEER_A)).toBeUndefined();
    expect(registry.get(PEER_B)?.state).toBe('active');
  });
});

/* ------------------------------------------------------------------ *
 * Suppression / blocking
 * ------------------------------------------------------------------ */

describe('suppression', () => {
  it('drops packets from a suppressed peer at the edge', () => {
    const registry = makeRegistry();
    registry.setSuppressed([PEER_A]);

    const result = registry.ingest(scan({ peerId: PEER_A, timestamp: 0 }));

    expect(result).toEqual({
      accepted: false,
      reason: 'suppressed',
      peerId: PEER_A,
    });
    expect(registry.isSuppressed(PEER_A)).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.getVisible()).toEqual([]);
    expect(registry.version).toBe(0);
  });

  it('removes an existing record the moment its peer is suppressed', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A);
    registry.drainChanges();
    const before = registry.version;

    registry.setSuppressed([PEER_A]);

    expect(registry.size).toBe(0);
    expect(registry.get(PEER_A)).toBeUndefined();
    expect(registry.version).toBe(before + 1);
    expect(registry.drainChanges()).toEqual([{ kind: 'removed', peerId: PEER_A }]);
  });

  it('leaves every other peer alone', () => {
    const registry = makeRegistry();
    registry.ingest(scan({ peerId: PEER_A, rssi: -55, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 1 }));

    registry.setSuppressed([PEER_A]);

    expect(registry.getAll().map((r) => r.peerId)).toEqual([PEER_B]);
    expect(registry.ingest(scan({ peerId: PEER_B, rssi: -61, timestamp: 100 })).accepted).toBe(
      true,
    );
  });

  it('produces no change when suppressing a peer that was never seen', () => {
    const registry = makeRegistry();

    registry.setSuppressed([PEER_C]);

    expect(registry.version).toBe(0);
    expect(registry.drainChanges()).toEqual([]);
    expect(registry.isSuppressed(PEER_C)).toBe(true);
  });

  it('lets a peer back in as a brand new record once suppression is cleared', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A);
    registry.setSuppressed([PEER_A]);
    registry.drainChanges();

    registry.setSuppressed([]);

    expect(registry.isSuppressed(PEER_A)).toBe(false);
    expect(registry.ingest(scan({ peerId: PEER_A, rssi: -55, timestamp: 5_000 })).accepted).toBe(
      true,
    );
    const record = registry.get(PEER_A);
    // No history survives a block: the returning peer starts at `discovered`, packet 1.
    expect(record?.state).toBe('discovered');
    expect(record?.packets).toBe(1);
    expect(record?.firstSeen).toBe(5_000);
  });

  it('replaces the suppression set wholesale on every call', () => {
    const registry = makeRegistry();
    registry.setSuppressed([PEER_A, PEER_B]);
    expect(registry.isSuppressed(PEER_A)).toBe(true);
    expect(registry.isSuppressed(PEER_B)).toBe(true);

    registry.setSuppressed([PEER_B, PEER_C]);

    expect(registry.isSuppressed(PEER_A)).toBe(false);
    expect(registry.isSuppressed(PEER_B)).toBe(true);
    expect(registry.isSuppressed(PEER_C)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Revision counter
 * ------------------------------------------------------------------ */

describe('the revision counter', () => {
  it('rises once per meaningful change and not at all for rejected packets', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    expect(registry.version).toBe(0);

    registry.ingest(scan({ rssi: -55, profileVersion: 7, timestamp: 0 }));
    expect(registry.version).toBe(1); // added

    // One packet, three observable changes: state, band and profile version.
    registry.ingest(scan({ rssi: -85, profileVersion: 8, timestamp: 1_000 }));
    expect(registry.version).toBe(4);

    registry.ingest(scan({ eventCode: OTHER_EVENT_CODE, timestamp: 2_000 }));
    registry.ingest(scan({ rssi: -85, profileVersion: 8, timestamp: 1_010 }));
    expect(registry.version).toBe(4);
  });

  it('does not rise for a signal-only update that changes no state, band or profile', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    registry.ingest(scan({ rssi: -55, timestamp: 0 }));
    registry.ingest(scan({ rssi: -56, timestamp: 1_000 })); // discovered -> active
    const settled = registry.version;

    // Same band (`very_close`), same state, same profile version: a pure RSSI wobble,
    // which is exactly the no-op re-render the counter exists to let the UI skip.
    registry.ingest(scan({ rssi: -57, timestamp: 2_000 }));

    expect(registry.get(PEER_A)?.rssi).toBe(-57);
    expect(registry.version).toBe(settled);
  });

  it('rises once per transition produced by a tick', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    warmUp(registry, PEER_B, 0);
    const before = registry.version;

    const changes = registry.tick(200 + ACTIVE_AFTER_MS);

    expect(changes).toHaveLength(2);
    expect(registry.version).toBe(before + 2);
  });

  it('rises on clear and on an eviction', () => {
    const registry = makeRegistry({ maxPeers: 1 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -70, timestamp: 0 }));
    const afterFirst = registry.version;

    registry.ingest(scan({ peerId: PEER_B, rssi: -50, timestamp: 1 })); // evict + add
    expect(registry.version).toBe(afterFirst + 2);

    const beforeClear = registry.version;
    registry.clear();
    expect(registry.version).toBe(beforeClear + 1);
  });
});

/* ------------------------------------------------------------------ *
 * Capacity
 * ------------------------------------------------------------------ */

describe('the capacity ceiling', () => {
  it('tracks peers right up to maxPeers', () => {
    const registry = makeRegistry({ maxPeers: 3 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 1 }));
    registry.ingest(scan({ peerId: PEER_C, rssi: -70, timestamp: 2 }));

    expect(registry.size).toBe(3);
    expect(registry.getAll().map((r) => r.peerId)).toEqual([PEER_A, PEER_B, PEER_C]);
  });

  it('refuses a newcomer weaker than the weakest tracked peer', () => {
    const registry = makeRegistry({ maxPeers: 3 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 1 }));
    registry.ingest(scan({ peerId: PEER_C, rssi: -70, timestamp: 2 }));
    registry.drainChanges();

    const result = registry.ingest(scan({ peerId: PEER_D, rssi: -80, timestamp: 3 }));

    expect(result).toEqual({
      accepted: false,
      reason: 'capacity',
      peerId: PEER_D,
    });
    expect(registry.size).toBe(3);
    expect(registry.get(PEER_D)).toBeUndefined();
    expect(registry.get(PEER_C)).toBeDefined();
    expect(registry.drainChanges()).toEqual([]);
  });

  it('refuses a newcomer whose signal exactly equals the weakest, evicting only for a strictly stronger one', () => {
    const equal = makeRegistry({ maxPeers: 2 });
    equal.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    equal.ingest(scan({ peerId: PEER_B, rssi: -70, timestamp: 1 }));
    expect(equal.ingest(scan({ peerId: PEER_C, rssi: -70, timestamp: 2 })).reason).toBe('capacity');
    expect(equal.get(PEER_B)).toBeDefined();

    const stronger = makeRegistry({ maxPeers: 2 });
    stronger.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    stronger.ingest(scan({ peerId: PEER_B, rssi: -70, timestamp: 1 }));
    expect(stronger.ingest(scan({ peerId: PEER_C, rssi: -69, timestamp: 2 })).accepted).toBe(true);
    expect(stronger.get(PEER_B)).toBeUndefined();
  });

  it('evicts the weakest peer and reports the swap as removed then added', () => {
    const registry = makeRegistry({ maxPeers: 3 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -70, timestamp: 1 }));
    registry.ingest(scan({ peerId: PEER_C, rssi: -60, timestamp: 2 }));
    registry.drainChanges();

    const result = registry.ingest(scan({ peerId: PEER_D, rssi: -55, timestamp: 3 }));

    expect(result).toEqual({ accepted: true, peerId: PEER_D });
    expect(registry.size).toBe(3);
    expect(registry.getAll().map((r) => r.peerId)).toEqual([PEER_A, PEER_D, PEER_C]);
    const changes = registry.drainChanges();
    expect(kinds(changes)).toEqual(['removed', 'added']);
    expect(changes[0].peerId).toBe(PEER_B);
    expect(changes[1].peerId).toBe(PEER_D);
  });

  it('never applies the ceiling to a peer it already tracks', () => {
    const registry = makeRegistry({ maxPeers: 2 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    registry.ingest(scan({ peerId: PEER_B, rssi: -90, timestamp: 1 }));

    // -95 is weaker than everything tracked, but B is already in the map.
    const result = registry.ingest(scan({ peerId: PEER_B, rssi: -95, timestamp: 100 }));

    expect(result).toEqual({ accepted: true, peerId: PEER_B });
    expect(registry.size).toBe(2);
    expect(registry.get(PEER_B)?.packets).toBe(2);
  });

  it('accepts nobody at all when maxPeers is zero', () => {
    const registry = makeRegistry({ maxPeers: 0 });

    expect(registry.ingest(scan({ rssi: -30, timestamp: 0 }))).toEqual({
      accepted: false,
      reason: 'capacity',
      peerId: PEER_A,
    });
    expect(registry.size).toBe(0);
  });

  it('frees a slot again once the evicted-out peer expires', () => {
    const registry = makeRegistry({ maxPeers: 1 });
    registry.ingest(scan({ peerId: PEER_A, rssi: -50, timestamp: 0 }));
    expect(registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 1 })).reason).toBe(
      'capacity',
    );

    registry.tick(EXPIRE_AFTER_MS);

    expect(registry.size).toBe(0);
    expect(registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 30_001 })).accepted).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------------ *
 * clear
 * ------------------------------------------------------------------ */

describe('clear', () => {
  it('empties the registry and queues a removal for every tracked peer', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    registry.ingest(scan({ peerId: PEER_B, rssi: -60, timestamp: 300 }));
    registry.drainChanges();

    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.getAll()).toEqual([]);
    expect(registry.getVisible()).toEqual([]);
    expect(registry.get(PEER_A)).toBeUndefined();
    expect(registry.drainChanges()).toEqual([
      { kind: 'removed', peerId: PEER_A },
      { kind: 'removed', peerId: PEER_B },
    ]);
  });

  it('is a silent no-op on an already empty registry', () => {
    const registry = makeRegistry();

    registry.clear();

    expect(registry.version).toBe(0);
    expect(registry.drainChanges()).toEqual([]);
  });

  it('leaves the registry usable, with cleared peers arriving as new records', () => {
    const registry = makeRegistry();
    warmUp(registry, PEER_A, 0);
    registry.clear();
    registry.drainChanges();

    registry.ingest(scan({ peerId: PEER_A, rssi: -55, timestamp: 1_000 }));

    expect(registry.size).toBe(1);
    expect(registry.get(PEER_A)?.state).toBe('discovered');
    expect(registry.get(PEER_A)?.packets).toBe(1);
    expect(registry.get(PEER_A)?.firstSeen).toBe(1_000);
  });

  it('keeps suppression in force across a clear', () => {
    const registry = makeRegistry();
    registry.setSuppressed([PEER_A]);
    registry.ingest(scan({ peerId: PEER_B, rssi: -55, timestamp: 0 }));

    registry.clear();

    expect(registry.isSuppressed(PEER_A)).toBe(true);
    expect(registry.ingest(scan({ peerId: PEER_A, rssi: -55, timestamp: 1 })).reason).toBe(
      'suppressed',
    );
  });
});

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

describe('configuration', () => {
  it('honours custom TTLs rather than the defaults', () => {
    const registry = makeRegistry({
      activeAfterMs: 100,
      staleAfterMs: 200,
      expireAfterMs: 300,
    });
    const lastPacket = warmUp(registry, PEER_A);

    expect(registry.tick(lastPacket + 99)).toEqual([]);
    expect(registry.tick(lastPacket + 100)[0].record?.state).toBe('nearby');
    expect(registry.tick(lastPacket + 199)).toEqual([]);
    expect(registry.tick(lastPacket + 200)[0].record?.state).toBe('out_of_range');
    expect(registry.tick(lastPacket + 299)).toEqual([]);
    expect(kinds(registry.tick(lastPacket + 300))).toEqual(['removed']);
  });

  it('honours a custom distance model when classifying a band', () => {
    const registry = makeRegistry({
      rssiOptions: RAW_FILTER,
      // A far more pessimistic path loss pushes the same RSSI into a wider band.
      distanceModel: { txPower: -59, pathLossExponent: 1.6 },
    });
    registry.ingest(scan({ rssi: -75, timestamp: 0 }));

    // (−59 − −75) / 16 = 1.0 -> 10 m, which is `nearby`, not the `close` the
    // default 2.4 exponent would produce.
    expect(registry.get(PEER_A)?.estimatedDistance).toBeCloseTo(10, 6);
    expect(registry.get(PEER_A)?.band).toBe('nearby');
  });
});

/* ------------------------------------------------------------------ *
 * Behaviour under load
 * ------------------------------------------------------------------ */

describe('under load', () => {
  it('removes every peer that crosses the expiry threshold in the same tick', () => {
    const registry = makeRegistry();
    const ids = [PEER_A, PEER_B, PEER_C, PEER_D, '00000001', '00000002', '00000003'];
    ids.forEach((id, i) => registry.ingest(scan({ peerId: id, rssi: -50 - i, timestamp: 0 })));
    expect(registry.size).toBe(7);

    const changes = registry.tick(EXPIRE_AFTER_MS);

    // Deleting from the map while iterating it must not skip the following entries.
    expect(changes).toHaveLength(7);
    expect(changes.map((c) => c.peerId).sort()).toEqual([...ids].sort());
    expect(registry.size).toBe(0);
    expect(registry.getAll()).toEqual([]);
  });

  it('throttles a peer advertising a constant RSSI to one reading per duplicate window', () => {
    const registry = makeRegistry();
    // A radio pushing the same reading every 10 ms across three channels for a minute.
    for (let t = 0; t <= 60_000; t += 10) {
      registry.ingest(scan({ rssi: -60, timestamp: t }));
    }

    const record = registry.get(PEER_A);
    // The window is measured from the last *accepted* packet, so 10/20 ms repeats are
    // dropped and the 30 ms one is kept: one in three survives.
    expect(record?.packets).toBe(2_001);
    expect(record?.lastSeen).toBe(60_000);
    expect(registry.size).toBe(1);
    // Duplicates still count as presence, so the peer never ages out.
    expect(registry.tick(60_000)).toEqual([]);
    expect(record?.state).toBe('active');
  });

  it('keeps interleaved peers independent', () => {
    const registry = makeRegistry();
    const ids = [PEER_A, PEER_B, PEER_C];

    for (let t = 0; t <= 900; t += 100) {
      ids.forEach((id, i) =>
        registry.ingest(scan({ peerId: id, rssi: -50 - i * 10, timestamp: t })),
      );
    }

    expect(registry.size).toBe(3);
    for (const id of ids) {
      expect(registry.get(id)?.packets).toBe(10);
      expect(registry.get(id)?.state).toBe('active');
      expect(registry.get(id)?.firstSeen).toBe(0);
      expect(registry.get(id)?.lastSeen).toBe(900);
    }
    expect(registry.getAll().map((r) => r.peerId)).toEqual(ids);
  });

  it('leaves the band untouched when only time passes', () => {
    const registry = makeRegistry({ rssiOptions: RAW_FILTER });
    registry.ingest(scan({ rssi: -85, timestamp: 0 }));
    registry.ingest(scan({ rssi: -85, timestamp: 1_000 }));
    expect(registry.get(PEER_A)?.band).toBe('far');
    registry.drainChanges();

    registry.tick(1_000 + ACTIVE_AFTER_MS);
    registry.tick(1_000 + STALE_AFTER_MS);

    // Ageing changes presence, never the last known distance estimate.
    expect(registry.get(PEER_A)?.band).toBe('far');
    expect(registry.get(PEER_A)?.rssi).toBe(-85);
    expect(registry.drainChanges().every((c) => c.kind === 'state_changed')).toBe(true);
  });
});
