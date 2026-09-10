/**
 * The connection handshake, end to end, over two real phones.
 *
 * Nothing in this file is mocked. Each "phone" is a `MemoryStorageAdapter`, a
 * real `LocalDatabase`, a real `ConnectionService`, a real `BlockService`, a
 * real `GattSessionManager` and a real `ConnectionRequestCoordinator` sitting on
 * an `InMemoryGattTransport`. The two transports are paired, so every byte
 * asserted below was encoded by `encodeConnectionPayload`, wrapped in a real
 * envelope, fragmented at a 23-byte MTU, reassembled on the far side and
 * decoded — exactly as it would be on a radio.
 *
 * The rule the whole suite exists to pin down: **a live GATT link is not a
 * connection.** Sending a request must never make anyone connected. Only a
 * person on the other phone saying yes does that.
 *
 * Time is a plain mutable `now` advanced by assignment. No fake timers.
 */

import {
  ConnectionRequestCoordinator,
  ConnectionRequestError,
  DISCOVERY_FRESHNESS_MS,
  REQUEST_EXPIRY_MS,
  type PendingRequest,
} from '../connections/ConnectionRequestCoordinator';
import { ConnectionService } from '../connections/ConnectionService';
import {
  CONNECTION_PROTOCOL_VERSION,
  encodeConnectionPayload,
  type ConnectionCard,
} from '../connections/ConnectionProtocol';
import { BlockService } from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter } from '../storage/LocalDatabase';
import {
  ATT_DEFAULT_MTU,
  GattMessageType,
  GattSessionManager,
  GroupIdSource,
  InMemoryGattTransport,
  encodeGattMessage,
  fragmentMessage,
  payloadBytesForMtu,
} from '../bluetooth/gatt';
import type { EventPulseApi } from '../api/ApiClient';
import type { Connection, ConnectionState, EventId, PeerId, ProfileId } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const EVENT_ID: EventId = 'evt-handshake';

const A_DEVICE = 'device-ada';
const B_DEVICE = 'device-grace';

const A_PROFILE: ProfileId = 'profile-ada';
const B_PROFILE: ProfileId = 'profile-grace';
/** Nobody advertises for this one. Used for the unreachable path. */
const C_PROFILE: ProfileId = 'profile-charles';

const A_PEER: PeerId = 'peer-ada-epoch-7';
const B_PEER: PeerId = 'peer-grace-epoch-7';

const A_CARD: ConnectionCard = {
  profileId: A_PROFILE,
  name: 'Ada Lovelace',
  role: 'Analyst',
  company: 'Analytical Engine Co.',
};

const B_CARD: ConnectionCard = {
  profileId: B_PROFILE,
  name: 'Grace Hopper',
  role: 'Rear Admiral',
  company: 'UNIVAC',
};

const CLOCK_START = 1_000;

/** The injected clock. Nothing under test reads the wall clock. */
let now = CLOCK_START;
const clock = (): number => now;

/**
 * What each phone's radar currently reports, profileId -> peerId.
 *
 * This is the correlation the coordinator depends on: a phone advertises its
 * own `peerId` as the GATT local name, and the other phone finds it by matching
 * that name against what its radar says this person's peer id is right now.
 */
let radar = new Map<ProfileId, PeerId>();

/* ------------------------------------------------------------------ *
 * A phone
 * ------------------------------------------------------------------ */

interface PhoneSpec {
  deviceId: string;
  /** Advertised as the GATT local name; the other side's radar must agree. */
  peerId: PeerId;
  card: ConnectionCard;
  acceptsRequests?: boolean;
  mtu?: number;
}

interface SettledEvent {
  profileId: ProfileId;
  state: ConnectionState;
}

interface Phone {
  spec: PhoneSpec;
  adapter: MemoryStorageAdapter;
  db: LocalDatabase;
  connections: ConnectionService;
  blocks: BlockService;
  transport: InMemoryGattTransport;
  sessions: GattSessionManager;
  coordinator: ConnectionRequestCoordinator;
  /** Everything `onIncomingRequest` fired with, in order. */
  incomingEvents: PendingRequest[];
  /** Everything `onSettled` fired with, in order. */
  settledEvents: SettledEvent[];
  errors: ConnectionRequestError[];
}

/**
 * An `EventPulseApi` that answers only what this path actually touches.
 *
 * `listConnections` is called by `ConnectionService.load()` and resolves empty;
 * the block/report calls resolve because `BlockService` awaits them. Everything
 * else throws, so a test that silently started depending on the server fails
 * loudly instead of passing on a stub.
 */
function makeApi(): EventPulseApi {
  const unused = (name: string): Error =>
    new Error(`EventPulseApi.${name} is not on the BLE handshake path`);

  return {
    listEvents: async () => {
      throw unused('listEvents');
    },
    getEvent: async () => {
      throw unused('getEvent');
    },
    joinEvent: async () => {
      throw unused('joinEvent');
    },
    leaveEvent: async () => {
      throw unused('leaveEvent');
    },
    getDirectory: async () => {
      throw unused('getDirectory');
    },
    getProfiles: async () => {
      throw unused('getProfiles');
    },
    publishPeerSchedule: async () => {
      throw unused('publishPeerSchedule');
    },
    updateProfile: async () => {
      throw unused('updateProfile');
    },
    updateEventProfile: async () => {
      throw unused('updateEventProfile');
    },
    updateVisibility: async () => {
      throw unused('updateVisibility');
    },
    listConnections: async () => [],
    requestConnection: async () => {
      throw unused('requestConnection');
    },
    respondToConnection: async () => {
      throw unused('respondToConnection');
    },
    blockUser: async () => undefined,
    unblockUser: async () => undefined,
    reportUser: async () => undefined,
    searchAttendees: async () => {
      throw unused('searchAttendees');
    },
  };
}

async function makePhone(spec: PhoneSpec): Promise<Phone> {
  const adapter = new MemoryStorageAdapter();
  const db = new LocalDatabase(adapter);
  await db.open();

  const api = makeApi();
  const connections = new ConnectionService({ db, api });
  await connections.load(EVENT_ID);

  const blocks = new BlockService(db, api);
  await blocks.load();

  const transport = new InMemoryGattTransport({
    deviceId: spec.deviceId,
    mtu: spec.mtu ?? ATT_DEFAULT_MTU,
    // The advertised local name IS this phone's current peer id.
    displayName: spec.peerId,
    now: clock,
  });
  const sessions = new GattSessionManager({ transport, now: clock });

  let requestCounter = 0;
  const coordinator = new ConnectionRequestCoordinator({
    sessions,
    connections,
    blocks,
    db,
    now: clock,
    myCard: () => spec.card,
    acceptsConnectionRequests: () => spec.acceptsRequests ?? true,
    currentPeerIdFor: (profileId) => radar.get(profileId) ?? null,
    // Deterministic: never Math.random.
    newRequestId: () => `${spec.deviceId}-req-${++requestCounter}`,
  });

  sessions.start();
  await coordinator.start(EVENT_ID);

  const phone: Phone = {
    spec,
    adapter,
    db,
    connections,
    blocks,
    transport,
    sessions,
    coordinator,
    incomingEvents: [],
    settledEvents: [],
    errors: [],
  };

  coordinator.subscribe({
    onIncomingRequest: (request) => {
      phone.incomingEvents.push(request);
    },
    onSettled: (profileId, connection) => {
      phone.settledEvents.push({ profileId, state: connection.state });
    },
    onError: (_profileId, error) => {
      phone.errors.push(error);
    },
  });

  return phone;
}

/** Put two phones in range, both hosting and both scanning. */
async function bring(a: Phone, b: Phone): Promise<void> {
  InMemoryGattTransport.pair(a.transport, b.transport);
  await a.transport.startPeripheral();
  await b.transport.startPeripheral();
  await a.transport.startScan();
  await b.transport.startScan();
}

/**
 * Let every floating promise in the handshake finish.
 *
 * The coordinator handles transport callbacks asynchronously (`void
 * this.handleMessage(...)`), so a message that has physically arrived may still
 * be a few microtasks from being recorded. This drains them; it never waits.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** The connections blob as it actually sits in the storage adapter. */
function onDisk(phone: Phone): Connection[] {
  const raw = phone.adapter.snapshot[`eventpulse:event:${EVENT_ID}:connections`];
  if (typeof raw !== 'string') {
    throw new Error(`no connections blob written for ${phone.spec.deviceId}`);
  }
  return JSON.parse(raw) as Connection[];
}

function diskRecordFor(phone: Phone, profileId: ProfileId): Connection {
  const found = onDisk(phone).find((connection) => connection.profileId === profileId);
  if (!found) throw new Error(`no persisted record for ${profileId}`);
  return found;
}

function memoryRecordFor(phone: Phone, profileId: ProfileId): Connection {
  const found = phone.connections.list().find((c) => c.profileId === profileId);
  if (!found) throw new Error(`no in-memory record for ${profileId}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * Suite
 * ------------------------------------------------------------------ */

describe('connection request flow over two real phones', () => {
  let a: Phone;
  let b: Phone;

  beforeEach(async () => {
    now = CLOCK_START;
    radar = new Map<ProfileId, PeerId>([
      [A_PROFILE, A_PEER],
      [B_PROFILE, B_PEER],
    ]);

    a = await makePhone({ deviceId: A_DEVICE, peerId: A_PEER, card: A_CARD });
    b = await makePhone({ deviceId: B_DEVICE, peerId: B_PEER, card: B_CARD });
    await bring(a, b);
  });

  afterEach(async () => {
    await a.coordinator.stop();
    await b.coordinator.stop();
    await a.sessions.stop();
    await b.sessions.stop();
  });

  /* ---------------------------------------------------------------- *
   * 1 + 2 + 3: the request crosses, and connects nobody
   * ---------------------------------------------------------------- */

  it('leaves the sender outgoing_pending and explicitly NOT connected after Connect', async () => {
    const request = await a.coordinator.request(B_PROFILE, 'Loved your compiler talk.');
    await drain();

    expect(request.requestId).toBe('device-ada-req-1');
    expect(request.direction).toBe('outgoing');
    expect(request.deviceId).toBe(B_DEVICE);

    expect(a.connections.stateFor(B_PROFILE)).toBe('outgoing_pending');
    // The core product rule: bytes moved, nobody connected.
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(a.connections.connectedProfileIds().has(B_PROFILE)).toBe(false);
    expect(a.connections.connected()).toEqual([]);
    expect(a.settledEvents).toEqual([]);
  });

  it('delivers the sender card and note to the far phone byte for byte', async () => {
    await a.coordinator.request(B_PROFILE, 'Loved your compiler talk.');
    await drain();

    const incoming = b.coordinator.incoming();
    expect(incoming).toHaveLength(1);
    expect(incoming[0].requestId).toBe('device-ada-req-1');
    expect(incoming[0].direction).toBe('incoming');
    expect(incoming[0].deviceId).toBe(A_DEVICE);
    expect(incoming[0].profileId).toBe(A_PROFILE);
    expect(incoming[0].card).toEqual({
      profileId: A_PROFILE,
      name: 'Ada Lovelace',
      role: 'Analyst',
      company: 'Analytical Engine Co.',
    });
    expect(incoming[0].note).toBe('Loved your compiler talk.');
    expect(incoming[0].createdAt).toBe(CLOCK_START);
    expect(incoming[0].expiresAt).toBe(CLOCK_START + REQUEST_EXPIRY_MS);

    // The receiver is pending, not connected, either.
    expect(b.connections.stateFor(A_PROFILE)).toBe('incoming_pending');
    expect(b.connections.stateFor(A_PROFILE)).not.toBe('connected');
  });

  it('fires the receiver onIncomingRequest subscriber exactly once with that request', async () => {
    await a.coordinator.request(B_PROFILE, 'Loved your compiler talk.');
    await drain();

    expect(b.incomingEvents).toHaveLength(1);
    expect(b.incomingEvents[0].requestId).toBe('device-ada-req-1');
    expect(b.incomingEvents[0].card.name).toBe('Ada Lovelace');
    expect(b.incomingEvents[0].note).toBe('Loved your compiler talk.');
    // The sender is not shown its own request.
    expect(a.incomingEvents).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 4 + 5 + 6 + 11: accept
   * ---------------------------------------------------------------- */

  it('connects the accepter the moment they accept', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();

    expect(b.connections.stateFor(A_PROFILE)).toBe('incoming_pending');

    now = 2_000;
    await b.coordinator.accept(A_PROFILE);
    await drain();

    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
    expect(b.coordinator.pendingFor(A_PROFILE)).toBeNull();
    expect(b.coordinator.incoming()).toEqual([]);
    expect(b.settledEvents).toEqual([{ profileId: A_PROFILE, state: 'connected' }]);
  });

  it('connects the sender only after the accept arrives, never on send', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();

    // Before the answer.
    expect(a.connections.stateFor(B_PROFILE)).toBe('outgoing_pending');
    expect(a.settledEvents).toEqual([]);

    now = 2_000;
    await b.coordinator.accept(A_PROFILE);
    await drain();

    // After the answer, and only then.
    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(a.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'connected' }]);
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
    expect(a.coordinator.outgoing()).toEqual([]);
  });

  it('persists a connected record on BOTH phones, on disk and not merely in memory', async () => {
    await a.coordinator.request(B_PROFILE, 'Coffee at the atrium?');
    await drain();
    now = 2_000;
    await b.coordinator.accept(A_PROFILE);
    await drain();

    const aRow = diskRecordFor(a, B_PROFILE);
    expect(aRow.state).toBe('connected');
    expect(aRow.eventId).toBe(EVENT_ID);
    expect(aRow.profileId).toBe(B_PROFILE);
    expect(aRow.pendingSync).toBe(false);
    expect(aRow.expiresAt).toBeUndefined();

    const bRow = diskRecordFor(b, A_PROFILE);
    expect(bRow.state).toBe('connected');
    expect(bRow.eventId).toBe(EVENT_ID);
    expect(bRow.profileId).toBe(A_PROFILE);
    expect(bRow.pendingSync).toBe(false);

    // One row per person per event, not a trail of settled attempts.
    expect(onDisk(a)).toHaveLength(1);
    expect(onDisk(b)).toHaveLength(1);

    // And the in-flight request blob is empty again on both sides.
    const aRequests = a.adapter.snapshot[`eventpulse:event:${EVENT_ID}:connection-requests`];
    const bRequests = b.adapter.snapshot[`eventpulse:event:${EVENT_ID}:connection-requests`];
    expect(JSON.parse(aRequests) as PendingRequest[]).toEqual([]);
    expect(JSON.parse(bRequests) as PendingRequest[]).toEqual([]);
  });

  it('teaches the sender who accepted, by carrying the accepter card back', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();
    now = 2_000;
    await b.coordinator.accept(A_PROFILE);
    await drain();

    const stored = memoryRecordFor(a, B_PROFILE);
    expect(stored.card).toEqual({
      profileId: B_PROFILE,
      name: 'Grace Hopper',
      role: 'Rear Admiral',
      company: 'UNIVAC',
    });
    // The same card survived the write to disk.
    expect(diskRecordFor(a, B_PROFILE).card?.name).toBe('Grace Hopper');
    // And the receiver kept the requester's card.
    expect(diskRecordFor(b, A_PROFILE).card?.name).toBe('Ada Lovelace');
  });

  /* ---------------------------------------------------------------- *
   * 7: reject
   * ---------------------------------------------------------------- */

  it('leaves both sides declined and neither connected when the receiver rejects', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();

    now = 2_000;
    await b.coordinator.reject(A_PROFILE);
    await drain();

    expect(b.connections.stateFor(A_PROFILE)).toBe('declined');
    expect(a.connections.stateFor(B_PROFILE)).toBe('declined');
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(b.connections.stateFor(A_PROFILE)).not.toBe('connected');

    expect(a.connections.connected()).toEqual([]);
    expect(b.connections.connected()).toEqual([]);
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
    expect(b.coordinator.pendingFor(A_PROFILE)).toBeNull();
    expect(a.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'declined' }]);
  });

  /* ---------------------------------------------------------------- *
   * 8: cancel
   * ---------------------------------------------------------------- */

  it('cancels the sender, and a later answer from the receiver cannot connect them', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();

    now = 2_000;
    await a.coordinator.cancel(B_PROFILE);
    await drain();

    expect(a.connections.stateFor(B_PROFILE)).toBe('cancelled');
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();

    // The receiver answering afterwards changes nothing for the sender: the
    // exchange it belonged to is over.
    now = 3_000;
    await b.coordinator.accept(A_PROFILE);
    await drain();

    expect(a.connections.stateFor(B_PROFILE)).toBe('cancelled');
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(a.connections.connected()).toEqual([]);
    expect(diskRecordFor(a, B_PROFILE).state).toBe('cancelled');
  });

  it('drops the receiver pending request when the cancelling side closes the link', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();
    expect(b.coordinator.incoming()).toHaveLength(1);

    now = 2_000;
    await a.coordinator.cancel(B_PROFILE);
    await drain();

    // `handleSessionClosed`: a link that drops mid-handshake means no answer
    // can be delivered on it, so the receiver's side settles rather than
    // leaving a request the user could answer into a void.
    expect(b.coordinator.incoming()).toEqual([]);
    expect(b.connections.stateFor(A_PROFILE)).toBe('failed');
    expect(b.connections.stateFor(A_PROFILE)).not.toBe('connected');
  });

  /* ---------------------------------------------------------------- *
   * 9: expiry, to the millisecond
   * ---------------------------------------------------------------- */

  it('expires an unanswered request at exactly createdAt + REQUEST_EXPIRY_MS, not one ms before', async () => {
    const request = await a.coordinator.request(B_PROFILE);
    await drain();
    expect(request.createdAt).toBe(CLOCK_START);
    expect(request.expiresAt).toBe(CLOCK_START + REQUEST_EXPIRY_MS);

    // One millisecond before the deadline: still live.
    now = request.expiresAt - 1;
    const early = await a.coordinator.tick(now);
    expect(early).toEqual([]);
    expect(a.connections.stateFor(B_PROFILE)).toBe('outgoing_pending');
    expect(a.coordinator.pendingFor(B_PROFILE)).not.toBeNull();

    // At the deadline: expired.
    now = request.expiresAt;
    const expired = await a.coordinator.tick(now);
    expect(expired).toEqual([B_PROFILE]);
    expect(a.connections.stateFor(B_PROFILE)).toBe('expired');
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
    expect(a.coordinator.outgoing()).toEqual([]);
    expect(a.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'expired' }]);

    // A second tick has nothing left to expire.
    now = request.expiresAt + 1;
    expect(await a.coordinator.tick(now)).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 10: the peer walks away
   * ---------------------------------------------------------------- */

  it('settles a request to failed when the link drops mid-handshake, never to connected', async () => {
    await a.coordinator.request(B_PROFILE);
    await drain();
    expect(a.connections.stateFor(B_PROFILE)).toBe('outgoing_pending');

    // They walked out of range: the link ends from the far side.
    now = 2_000;
    a.transport.teardown(B_DEVICE, 'remote');
    await drain();

    expect(a.connections.stateFor(B_PROFILE)).toBe('failed');
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
    expect(a.connections.connected()).toEqual([]);
    expect(a.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'failed' }]);
    expect(diskRecordFor(a, B_PROFILE).state).toBe('failed');
  });

  it('reports connect_failed and settles to failed when the peer stopped hosting before the dial', async () => {
    // The discovery is still fresh, but the far side is no longer advertising —
    // a real and common race.
    await b.transport.stopPeripheral();

    await expect(a.coordinator.request(B_PROFILE)).rejects.toThrow(ConnectionRequestError);
    await drain();

    expect(a.errors).toHaveLength(1);
    expect(a.errors[0].code).toBe('connect_failed');
    expect(a.connections.stateFor(B_PROFILE)).toBe('failed');
    expect(a.connections.stateFor(B_PROFILE)).not.toBe('connected');
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
  });

  /* ---------------------------------------------------------------- *
   * 12: fragmentation at a 23-byte MTU
   * ---------------------------------------------------------------- */

  it('carries a 400-character note across dozens of fragments byte-identical at MTU 23', async () => {
    // 400 characters, no leading or trailing whitespace (the decoder trims).
    const note = `Met you by the ${'espresso machine and we talked about COBOL, '.repeat(9)}end.`
      .slice(0, 400)
      .trim();
    expect(note).toHaveLength(400);

    const at = now;
    const sent = await a.coordinator.request(B_PROFILE, note);
    await drain();

    const received = b.coordinator.incoming();
    expect(received).toHaveLength(1);
    expect(received[0].note).toBe(note);
    expect(received[0].note).toHaveLength(400);
    expect(received[0].card).toEqual(A_CARD);

    // This really did fragment: reconstruct the exact bytes that went out and
    // count the frames the framing layer would cut them into.
    const wire = encodeGattMessage({
      type: GattMessageType.ConnectionRequest,
      messageId: 1,
      payload: encodeConnectionPayload({
        v: CONNECTION_PROTOCOL_VERSION,
        requestId: sent.requestId,
        card: A_CARD,
        note,
        sentAt: at,
      }),
    });
    expect(payloadBytesForMtu(ATT_DEFAULT_MTU)).toBe(11);
    const frames = fragmentMessage(wire, payloadBytesForMtu(ATT_DEFAULT_MTU), new GroupIdSource());
    expect(frames.length).toBeGreaterThan(40);
  });

  it('carries a long name, role and company across the same fragmented link', async () => {
    const longName = 'Dr Grace Brewster Murray Hopper-Vanden Heuvel de la Torre';
    const longRole = 'Rear Admiral, Director of Programming Languages and Standards, Retired';
    const longCompany = 'UNIVAC Division of Remington Rand, Systems Engineering Directorate';

    const wide = await makePhone({
      deviceId: 'device-wide',
      peerId: 'peer-wide-epoch-7',
      card: {
        profileId: 'profile-wide',
        name: longName,
        role: longRole,
        company: longCompany,
      },
    });
    radar.set('profile-wide', 'peer-wide-epoch-7');
    await bring(wide, b);

    await wide.coordinator.request(B_PROFILE, 'Long card, small MTU.');
    await drain();

    const received = b.coordinator.incoming().find((r) => r.profileId === 'profile-wide');
    expect(received).toBeDefined();
    expect(received?.card.name).toBe(longName);
    expect(received?.card.role).toBe(longRole);
    expect(received?.card.company).toBe(longCompany);

    await wide.coordinator.stop();
    await wide.sessions.stop();
  });

  /* ---------------------------------------------------------------- *
   * 13: reachability
   * ---------------------------------------------------------------- */

  it('reports a paired advertising peer as reachable, and stops once the discovery goes stale', async () => {
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(true);
    expect(b.coordinator.isReachable(A_PROFILE)).toBe(true);

    // The discovery was recorded at CLOCK_START. It is trusted right up to the
    // freshness boundary inclusive.
    now = CLOCK_START + DISCOVERY_FRESHNESS_MS;
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(true);

    now = CLOCK_START + DISCOVERY_FRESHNESS_MS + 1;
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(false);
  });

  it('does not become reachable again from a rescan once the peer stopped advertising', async () => {
    now = CLOCK_START + DISCOVERY_FRESHNESS_MS + 1;
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(false);

    await b.transport.stopPeripheral();
    await a.transport.startScan();

    // A phone that is not hosting emits no discovery, so nothing refreshed.
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(false);

    // It comes back the moment it hosts again and is seen again.
    await b.transport.startPeripheral();
    await a.transport.startScan();
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(true);
  });

  it('reports someone the radar cannot place as unreachable', async () => {
    expect(a.coordinator.isReachable(C_PROFILE)).toBe(false);
    radar.set(C_PROFILE, 'peer-charles-epoch-7');
    // On the radar, but no GATT device ever announced that name.
    expect(a.coordinator.isReachable(C_PROFILE)).toBe(false);
  });

  /* ---------------------------------------------------------------- *
   * 14: unreachable
   * ---------------------------------------------------------------- */

  it('throws peer_not_found and leaves no pending request and no record behind', async () => {
    radar.set(C_PROFILE, 'peer-charles-epoch-7');

    await expect(a.coordinator.request(C_PROFILE, 'hello?')).rejects.toBeInstanceOf(
      ConnectionRequestError,
    );

    let code: string | null = null;
    try {
      await a.coordinator.request(C_PROFILE, 'hello?');
    } catch (error) {
      code = error instanceof ConnectionRequestError ? error.code : null;
    }
    expect(code).toBe('peer_not_found');

    expect(a.coordinator.pendingFor(C_PROFILE)).toBeNull();
    expect(a.coordinator.outgoing()).toEqual([]);
    expect(a.connections.stateFor(C_PROFILE)).toBe('none');
    expect(onDisk(a).some((row) => row.profileId === C_PROFILE)).toBe(false);
    expect(a.errors.map((error) => error.code)).toEqual(['peer_not_found', 'peer_not_found']);
  });

  it('throws peer_not_found when the radar has no peer id for the person at all', async () => {
    // Never put on the radar: `currentPeerIdFor` returns null.
    let code: string | null = null;
    try {
      await a.coordinator.request(C_PROFILE);
    } catch (error) {
      code = error instanceof ConnectionRequestError ? error.code : null;
    }
    expect(code).toBe('peer_not_found');
    expect(a.connections.stateFor(C_PROFILE)).toBe('none');
    expect(a.coordinator.pendingFor(C_PROFILE)).toBeNull();
  });
});
