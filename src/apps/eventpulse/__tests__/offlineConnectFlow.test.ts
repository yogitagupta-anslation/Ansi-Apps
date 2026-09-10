/**
 * Connect with NO attendee directory on either phone.
 *
 * `AttendeeDirectory.peerIndex` — the only thing that maps a rotating BLE
 * `peerId` to a stable `profileId` — is populated exclusively from a server
 * payload. EventPulse has no server, so offline that index is always empty and
 * `currentPeerIdFor` can only ever answer `null`. Every phone in this file is
 * built that way on purpose: the stub returns `null` for every profileId, for
 * the whole run. That is not a fault being injected, it is the ordinary offline
 * condition, and the handshake below has to work under it.
 *
 * Nothing here is mocked. Each "phone" is a `MemoryStorageAdapter`, a real
 * `LocalDatabase`, a real `ConnectionService`, a real `BlockService`, a real
 * `GattSessionManager` and a real `ConnectionRequestCoordinator` over an
 * `InMemoryGattTransport` at a 23-byte MTU — so every byte asserted here was
 * JSON-encoded, wrapped in a real envelope, fragmented into 11-byte chunks,
 * reassembled on the far side and decoded.
 *
 * The two invariants this file exists to nail down:
 *
 *   1. A `peer:` key is scaffolding, never an identity. It exists between the
 *      tap and the answer and must not survive the exchange anywhere — not in
 *      `ConnectionService`, not on disk.
 *   2. A live GATT link is not a connection. Only CONNECTION_ACCEPT connects.
 *
 * Time is a plain mutable `now`. No fake timers, no waiting.
 */

import {
  ConnectionRequestCoordinator,
  ConnectionRequestError,
  PROVISIONAL_KEY_PREFIX,
  isProvisionalKey,
  provisionalKeyFor,
  type PendingRequest,
} from '../connections/ConnectionRequestCoordinator';
import { ConnectionService } from '../connections/ConnectionService';
import type { ConnectionCard } from '../connections/ConnectionProtocol';
import { BlockService } from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import {
  GattSessionManager,
  InMemoryGattTransport,
  payloadBytesForMtu,
} from '../bluetooth/gatt';
import type { EventPulseApi } from '../api/ApiClient';
import type { Connection, ConnectionState, EventId, PeerId, ProfileId } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const EVENT_ID: EventId = 'evt-offline-hall';

const A_DEVICE = 'device-ada';
const B_DEVICE = 'device-grace';

const A_PROFILE: ProfileId = 'profile-ada';
const B_PROFILE: ProfileId = 'profile-grace';

/**
 * Rotating ids, deliberately lower case.
 *
 * `provisionalKeyFor` upper-cases and `handleDiscovery` upper-cases the
 * advertised name, so a lower-case fixture proves the normalisation on both
 * sides actually meets in the middle instead of two raw strings happening to
 * match.
 */
const A_PEER: PeerId = '3f81c0d2-ep7';
const B_PEER: PeerId = '7ac212ad-ep7';

/** Advertised by nobody. Used for the unreachable path. */
const GHOST_PEER: PeerId = 'ffffffff-ep7';

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

/** The MTU every link in this file negotiates. Fragmentation is real at 23. */
const MTU = 23;

const CLOCK_START = 1_000;

let now = CLOCK_START;
const clock = (): number => now;

/** The key the sender files the exchange under while it knows nothing. */
const B_PROVISIONAL: ProfileId = provisionalKeyFor(B_PEER);

const CONNECTIONS_BLOB_KEY = `eventpulse:${keys.connections(EVENT_ID)}`;
const REQUESTS_BLOB_KEY = `eventpulse:${keys.connectionRequests(EVENT_ID)}`;

/* ------------------------------------------------------------------ *
 * The API stub: a server that must never be spoken to
 * ------------------------------------------------------------------ */

/**
 * An `EventPulseApi` that logs every call and refuses everything it can.
 *
 * `listConnections` resolves empty and the block/report calls resolve, because
 * `ConnectionService.load()` and `BlockService` await them during construction.
 * Every other method records the call and then throws, so a handshake that
 * quietly grew a server dependency fails loudly rather than passing on a stub
 * that happened to answer.
 */
function makeApi(calls: string[]): EventPulseApi {
  const refuse = (name: string): never => {
    calls.push(name);
    throw new Error(`EventPulseApi.${name} must never be called on the offline BLE path`);
  };

  return {
    listEvents: async () => refuse('listEvents'),
    getEvent: async () => refuse('getEvent'),
    joinEvent: async () => refuse('joinEvent'),
    leaveEvent: async () => refuse('leaveEvent'),
    getDirectory: async () => refuse('getDirectory'),
    getProfiles: async () => refuse('getProfiles'),
    publishPeerSchedule: async () => refuse('publishPeerSchedule'),
    updateProfile: async () => refuse('updateProfile'),
    updateEventProfile: async () => refuse('updateEventProfile'),
    updateVisibility: async () => refuse('updateVisibility'),
    listConnections: async () => {
      calls.push('listConnections');
      return [];
    },
    requestConnection: async () => refuse('requestConnection'),
    respondToConnection: async () => refuse('respondToConnection'),
    blockUser: async () => {
      calls.push('blockUser');
    },
    unblockUser: async () => {
      calls.push('unblockUser');
    },
    reportUser: async () => {
      calls.push('reportUser');
    },
    searchAttendees: async () => refuse('searchAttendees'),
  };
}

/* ------------------------------------------------------------------ *
 * A phone
 * ------------------------------------------------------------------ */

interface IdentityLearned {
  provisionalKey: ProfileId;
  profileId: ProfileId;
}

interface SettledEvent {
  profileId: ProfileId;
  state: ConnectionState;
}

interface Phone {
  deviceId: string;
  peerId: PeerId;
  card: ConnectionCard;
  adapter: MemoryStorageAdapter;
  db: LocalDatabase;
  connections: ConnectionService;
  blocks: BlockService;
  transport: InMemoryGattTransport;
  sessions: GattSessionManager;
  coordinator: ConnectionRequestCoordinator;
  /** Every API method this phone's services actually invoked, in order. */
  apiCalls: string[];
  incomingEvents: PendingRequest[];
  settledEvents: SettledEvent[];
  identityEvents: IdentityLearned[];
  errors: ConnectionRequestError[];
  /** Every profileId `currentPeerIdFor` was asked about, to prove it answered null. */
  directoryLookups: ProfileId[];
}

async function makePhone(
  deviceId: string,
  myProfileId: ProfileId,
  card: ConnectionCard,
  myPeerId: PeerId,
): Promise<Phone> {
  // The card a phone sends IS its identity; a fixture that disagreed would make
  // every "keyed by the real profileId" assertion below meaningless.
  if (card.profileId !== myProfileId) {
    throw new Error(`fixture mismatch: ${card.profileId} is not ${myProfileId}`);
  }

  const adapter = new MemoryStorageAdapter();
  const db = new LocalDatabase(adapter);
  await db.open();

  const apiCalls: string[] = [];
  const api = makeApi(apiCalls);

  const connections = new ConnectionService({ db, api });
  await connections.load(EVENT_ID);

  const blocks = new BlockService(db, api);
  await blocks.load();

  const transport = new InMemoryGattTransport({
    deviceId,
    mtu: MTU,
    // The advertised local name IS this phone's current rotating peer id.
    displayName: myPeerId,
    now: clock,
  });
  const sessions = new GattSessionManager({ transport, now: clock });

  const directoryLookups: ProfileId[] = [];
  let requestCounter = 0;

  const coordinator = new ConnectionRequestCoordinator({
    sessions,
    connections,
    blocks,
    db,
    now: clock,
    myCard: () => card,
    acceptsConnectionRequests: () => true,
    // THE WHOLE POINT. There is no directory offline, so nothing can resolve a
    // peerId to a person. This answers null for everyone, always.
    currentPeerIdFor: (profileId) => {
      directoryLookups.push(profileId);
      return null;
    },
    newRequestId: () => `${deviceId}-req-${++requestCounter}`,
  });

  sessions.start();
  await coordinator.start(EVENT_ID);

  const phone: Phone = {
    deviceId,
    peerId: myPeerId,
    card,
    adapter,
    db,
    connections,
    blocks,
    transport,
    sessions,
    coordinator,
    apiCalls,
    incomingEvents: [],
    settledEvents: [],
    identityEvents: [],
    errors: [],
    directoryLookups,
  };

  coordinator.subscribe({
    onIncomingRequest: (request) => {
      phone.incomingEvents.push(request);
    },
    onSettled: (profileId, connection) => {
      phone.settledEvents.push({ profileId, state: connection.state });
    },
    onIdentityLearned: (provisionalKey, profileId) => {
      phone.identityEvents.push({ provisionalKey, profileId });
    },
    onError: (_profileId, error) => {
      phone.errors.push(error);
    },
  });

  return phone;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Let every floating promise in the handshake finish.
 *
 * The transport delivers through `void this.handleMessage(...)`, so a message
 * that has physically arrived may still be a few microtasks from being
 * recorded. This drains them; it never waits on a clock.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** The raw connections blob string exactly as it sits in the storage adapter. */
function rawConnections(phone: Phone): string {
  const raw = phone.adapter.snapshot[CONNECTIONS_BLOB_KEY];
  if (typeof raw !== 'string') {
    throw new Error(`no connections blob written for ${phone.deviceId}`);
  }
  return raw;
}

function onDiskConnections(phone: Phone): Connection[] {
  return JSON.parse(rawConnections(phone)) as Connection[];
}

function onDiskRequests(phone: Phone): PendingRequest[] {
  const raw = phone.adapter.snapshot[REQUESTS_BLOB_KEY];
  if (typeof raw !== 'string') {
    throw new Error(`no connection-requests blob written for ${phone.deviceId}`);
  }
  return JSON.parse(raw) as PendingRequest[];
}

function diskRecordFor(phone: Phone, profileId: ProfileId): Connection {
  const found = onDiskConnections(phone).find(
    (connection) => connection.profileId === profileId,
  );
  if (!found) throw new Error(`no persisted record for ${profileId} on ${phone.deviceId}`);
  return found;
}

function memoryRecordFor(phone: Phone, profileId: ProfileId): Connection {
  const found = phone.connections.list().find((c) => c.profileId === profileId);
  if (!found) throw new Error(`no in-memory record for ${profileId} on ${phone.deviceId}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * Suite
 * ------------------------------------------------------------------ */

describe('offline Connect: two phones, no attendee directory on either', () => {
  let a: Phone;
  let b: Phone;

  beforeEach(async () => {
    now = CLOCK_START;

    a = await makePhone(A_DEVICE, A_PROFILE, A_CARD, A_PEER);
    b = await makePhone(B_DEVICE, B_PROFILE, B_CARD, B_PEER);

    InMemoryGattTransport.pair(a.transport, b.transport);
    // B hosts, so A can discover it by the peer id in its advertisement.
    await b.transport.startPeripheral();
    await a.transport.startScan();
    await settle();
  });

  afterEach(async () => {
    await a.coordinator.stop();
    await b.coordinator.stop();
    await a.sessions.stop();
    await b.sessions.stop();
  });

  /** A discovers B, dials by peer id, B accepts. The whole headline flow. */
  async function handshake(note?: string): Promise<PendingRequest> {
    const request = await a.coordinator.requestByPeer(B_PEER, note);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();
    return request;
  }

  /* ---------------------------------------------------------------- *
   * 1: the dial itself
   * ---------------------------------------------------------------- */

  it('resolves requestByPeer into a provisional PendingRequest keyed by peer:<PEERID>, with the directory answering null throughout', async () => {
    const request = await a.coordinator.requestByPeer(B_PEER);

    expect(request.provisional).toBe(true);
    expect(request.peerId).toBe(B_PEER);
    expect(request.direction).toBe('outgoing');
    expect(request.deviceId).toBe(B_DEVICE);
    expect(request.profileId).toBe(B_PROVISIONAL);
    expect(request.profileId).toBe('peer:7AC212AD-EP7');

    // The key agrees with the predicate the rest of the app guards on, and a
    // real profileId is not mistaken for one.
    expect(isProvisionalKey(request.profileId)).toBe(true);
    expect(request.profileId.startsWith(PROVISIONAL_KEY_PREFIX)).toBe(true);
    expect(isProvisionalKey(B_PROFILE)).toBe(false);

    // The peer is reachable as a radio peer, and NOT resolvable as a person:
    // that gap is exactly why the provisional path exists.
    expect(a.coordinator.isPeerReachable(B_PEER)).toBe(true);
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(false);
    expect(a.directoryLookups.every((id) => id === B_PROFILE || id === A_PROFILE)).toBe(true);
  });

  it('cannot dial by profileId at all offline, which is the defect requestByPeer exists to route around', async () => {
    await expect(a.coordinator.request(B_PROFILE)).rejects.toBeInstanceOf(
      ConnectionRequestError,
    );

    // Nothing resolved, so nothing was even attempted over the radio.
    expect(a.errors).toHaveLength(1);
    expect(a.errors[0].code).toBe('peer_not_found');
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();
    expect(a.connections.stateFor(B_PROFILE)).toBe('none');
  });

  /* ---------------------------------------------------------------- *
   * 2: persisted before anybody knows who B is
   * ---------------------------------------------------------------- */

  it('persists the outgoing request and its connection row under the provisional key before the real profileId is known', async () => {
    const request = await a.coordinator.requestByPeer(B_PEER, 'Coffee urn, north hall?');

    const storedRequests = onDiskRequests(a);
    expect(storedRequests).toHaveLength(1);
    expect(storedRequests[0].profileId).toBe(B_PROVISIONAL);
    expect(storedRequests[0].provisional).toBe(true);
    expect(storedRequests[0].peerId).toBe(B_PEER);
    expect(storedRequests[0].direction).toBe('outgoing');
    expect(storedRequests[0].requestId).toBe(request.requestId);

    const storedConnections = onDiskConnections(a).filter((c) =>
      isProvisionalKey(c.profileId),
    );
    expect(storedConnections).toHaveLength(1);
    expect(storedConnections[0].profileId).toBe(B_PROVISIONAL);
    expect(storedConnections[0].state).toBe('outgoing_pending');
    expect(storedConnections[0].note).toBe('Coffee urn, north hall?');
    expect(storedConnections[0].expiresAt).toBe(CLOCK_START + 2 * 60 * 1000);
    expect(storedConnections[0].pendingSync).toBe(false);

    // And no row yet exists for the person, because nobody has said who they are.
    expect(a.connections.stateFor(B_PROFILE)).toBe('none');
  });

  /* ---------------------------------------------------------------- *
   * 3 + 4: the receiver needs no directory either
   * ---------------------------------------------------------------- */

  it('lets the receiver name the sender from the request payload alone, with no directory of its own', async () => {
    await a.coordinator.requestByPeer(B_PEER, 'Loved your compiler talk.');
    await settle();

    const incoming = b.coordinator.incoming();
    expect(incoming).toHaveLength(1);
    expect(incoming[0].card).toEqual({
      profileId: A_PROFILE,
      name: 'Ada Lovelace',
      role: 'Analyst',
      company: 'Analytical Engine Co.',
    });
    expect(incoming[0].note).toBe('Loved your compiler talk.');

    // B never asked a directory anything: the bytes carried the answer.
    expect(b.directoryLookups).toEqual([]);
    expect(b.incomingEvents).toHaveLength(1);
    expect(b.incomingEvents[0].card.name).toBe('Ada Lovelace');
  });

  it('files an inbound request against the sender real profileId and never marks it provisional', async () => {
    await a.coordinator.requestByPeer(B_PEER);
    await settle();

    const incoming = b.coordinator.incoming();
    expect(incoming).toHaveLength(1);
    expect(incoming[0].provisional).toBe(false);
    expect(incoming[0].profileId).toBe(A_PROFILE);
    expect(incoming[0].peerId).toBeNull();
    expect(incoming[0].direction).toBe('incoming');
    expect(isProvisionalKey(incoming[0].profileId)).toBe(false);

    expect(b.connections.stateFor(A_PROFILE)).toBe('incoming_pending');
    expect(b.connections.list().filter((c) => isProvisionalKey(c.profileId))).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 5 + 12: a link is not a connection
   * ---------------------------------------------------------------- */

  it('leaves the sender outgoing_pending and explicitly not connected while the GATT link is up but unanswered', async () => {
    await a.coordinator.requestByPeer(B_PEER);
    await settle();

    // The link is genuinely open in both directions...
    expect(a.sessions.getSession(B_DEVICE)?.deviceId).toBe(B_DEVICE);
    expect(a.sessions.getLinkState(B_DEVICE)).toBe('connected');
    expect(b.sessions.getSession(A_DEVICE)?.deviceId).toBe(A_DEVICE);

    // ...and that connects nobody, on either phone.
    expect(a.connections.stateFor(B_PROVISIONAL)).toBe('outgoing_pending');
    expect(a.connections.stateFor(B_PROFILE)).toBe('none');
    expect(a.connections.connected()).toEqual([]);
    expect(a.connections.connectedProfileIds().size).toBe(0);
    expect(b.connections.connectedProfileIds().size).toBe(0);
    expect(a.settledEvents).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 6: the accepter
   * ---------------------------------------------------------------- */

  it('records the accepter as connected under the sender real profileId', async () => {
    await handshake();

    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
    expect(b.coordinator.incoming()).toEqual([]);
    expect(b.coordinator.pendingFor(A_PROFILE)).toBeNull();

    const record = memoryRecordFor(b, A_PROFILE);
    expect(record.id).toBe(`ble_${A_PROFILE}_${EVENT_ID}`);
    expect(record.state).toBe('connected');
    expect(record.expiresAt).toBeUndefined();
    expect(record.pendingSync).toBe(false);
    expect(diskRecordFor(b, A_PROFILE).state).toBe('connected');

    expect(b.settledEvents).toEqual([{ profileId: A_PROFILE, state: 'connected' }]);
  });

  /* ---------------------------------------------------------------- *
   * 7 + 10: the sender reconciles
   * ---------------------------------------------------------------- */

  it('reconciles the sender provisional exchange onto the learned profileId, carrying the accepter card', async () => {
    await handshake();

    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');

    const record = memoryRecordFor(a, B_PROFILE);
    expect(record.id).toBe(`ble_${B_PROFILE}_${EVENT_ID}`);
    expect(record.state).toBe('connected');
    // Offline the Connections screen has nothing else to render a name from.
    expect(record.card).toEqual({
      profileId: B_PROFILE,
      name: 'Grace Hopper',
      role: 'Rear Admiral',
      company: 'UNIVAC',
    });
    expect(diskRecordFor(a, B_PROFILE).card?.name).toBe('Grace Hopper');

    expect(a.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'connected' }]);
    expect(a.coordinator.outgoing()).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 8: peerId is never a permanent identity
   * ---------------------------------------------------------------- */

  it('leaves no peer: row anywhere once the identity is learned', async () => {
    await handshake();

    expect(a.connections.stateFor(B_PROVISIONAL)).toBe('none');
    expect(a.connections.list()).toHaveLength(1);
    expect(a.connections.list()[0].profileId).toBe(B_PROFILE);

    const disk = onDiskConnections(a);
    expect(disk).toHaveLength(1);
    expect(disk[0].profileId).toBe(B_PROFILE);
    // Not just "no row we recognised" — the substring is absent from the blob,
    // so it cannot be hiding in an id or a stale field either.
    expect(rawConnections(a)).not.toContain(PROVISIONAL_KEY_PREFIX);

    // The in-flight request store is empty too: nothing is still pending.
    expect(onDiskRequests(a)).toEqual([]);
    expect(a.coordinator.pendingFor(B_PROVISIONAL)).toBeNull();
    expect(a.coordinator.pendingFor(B_PROFILE)).toBeNull();

    // And the receiver never held one at all.
    expect(rawConnections(b)).not.toContain(PROVISIONAL_KEY_PREFIX);
    expect(b.connections.list()).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- *
   * 9: the identity-learned moment
   * ---------------------------------------------------------------- */

  it('emits onIdentityLearned exactly once, with the provisional key and the learned profileId', async () => {
    await handshake();

    expect(a.identityEvents).toEqual([
      { provisionalKey: B_PROVISIONAL, profileId: B_PROFILE },
    ]);
    // The receiver was never provisional, so it learns nothing it did not know.
    expect(b.identityEvents).toEqual([]);
  });

  /* ---------------------------------------------------------------- *
   * 11: no network, at all
   * ---------------------------------------------------------------- */

  it('completes the entire handshake without a single network call', async () => {
    // Bootstrap is the only thing that ever touches the API: ConnectionService
    // .load() kicks off one background refresh per phone. Assert that, then
    // clear the log so the handshake itself is measured against zero.
    expect(a.apiCalls).toEqual(['listConnections']);
    expect(b.apiCalls).toEqual(['listConnections']);
    a.apiCalls.length = 0;
    b.apiCalls.length = 0;

    await handshake('See you at the keynote.');

    expect(a.apiCalls).toEqual([]);
    expect(b.apiCalls).toEqual([]);
    expect(a.connections.queuedCount).toBe(0);
    expect(b.connections.queuedCount).toBe(0);

    // The exchange really did happen, so the empty log means "never called",
    // not "never got that far".
    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
  });

  /* ---------------------------------------------------------------- *
   * 13: dialling a peer nobody is advertising
   * ---------------------------------------------------------------- */

  it('fails a dial to a peer that is not advertising with peer_not_found and leaves no trace', async () => {
    const ghostKey = provisionalKeyFor(GHOST_PEER);

    await expect(a.coordinator.requestByPeer(GHOST_PEER)).rejects.toMatchObject({
      name: 'ConnectionRequestError',
      code: 'peer_not_found',
    });

    expect(a.coordinator.isPeerReachable(GHOST_PEER)).toBe(false);
    expect(a.coordinator.pendingFor(ghostKey)).toBeNull();
    expect(a.coordinator.outgoing()).toEqual([]);
    expect(a.connections.stateFor(ghostKey)).toBe('none');
    expect(a.connections.list()).toEqual([]);
    expect(onDiskRequests(a)).toEqual([]);
    expect(onDiskConnections(a)).toEqual([]);

    expect(a.errors).toHaveLength(1);
    expect(a.errors[0]).toBeInstanceOf(ConnectionRequestError);
    expect(a.errors[0].code).toBe('peer_not_found');

    // Nothing was dialled, so no link was opened either.
    expect(a.sessions.getSessions()).toEqual([]);
    expect(a.sessions.pendingCount).toBe(0);
  });

  /* ---------------------------------------------------------------- *
   * 14: fragmentation at MTU 23 is real
   * ---------------------------------------------------------------- */

  it('carries a 324-character note byte-identical across a 23-byte MTU', async () => {
    const note = `${'We met by the coffee urn in the north hall. '.repeat(7)}Lets swap notes.`;
    expect(note).toHaveLength(324);
    expect(note.trim()).toBe(note); // the decoder trims; nothing here is trimmable

    // 11 usable bytes per frame, so this note alone spans at least 30 frames.
    expect(payloadBytesForMtu(MTU)).toBe(11);
    expect(Math.ceil(note.length / payloadBytesForMtu(MTU))).toBe(30);

    await a.coordinator.requestByPeer(B_PEER, note);
    await settle();

    const incoming = b.coordinator.incoming();
    expect(incoming).toHaveLength(1);
    expect(incoming[0].note).toBe(note);
    expect(incoming[0].note).toHaveLength(324);
    expect(diskRecordFor(b, A_PROFILE).note).toBe(note);

    // And it survives the rest of the exchange on the sender's record too.
    await b.coordinator.accept(A_PROFILE);
    await settle();
    expect(memoryRecordFor(a, B_PROFILE).note).toBe(note);
  });

  /* ---------------------------------------------------------------- *
   * The headline flow, asserted as one story
   * ---------------------------------------------------------------- */

  it('runs discover -> connect -> GATT -> request -> accept -> reconcile with both sides persisting one record keyed by profileId', async () => {
    // A can see a radio peer and cannot name it.
    expect(a.coordinator.isPeerReachable(B_PEER)).toBe(true);
    expect(a.coordinator.isReachable(B_PROFILE)).toBe(false);

    const request = await a.coordinator.requestByPeer(B_PEER, 'Hello from the hall.');
    expect(request.provisional).toBe(true);
    expect(a.connections.stateFor(B_PROVISIONAL)).toBe('outgoing_pending');

    await settle();

    // B sees a named human, A is still nobody's connection.
    expect(b.coordinator.incoming()[0].card.name).toBe('Ada Lovelace');
    expect(a.connections.connected()).toEqual([]);
    expect(b.connections.connected()).toEqual([]);

    await b.coordinator.accept(A_PROFILE);
    await settle();

    // Both sides connected, each keyed by the other's stable profileId.
    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
    expect([...a.connections.connectedProfileIds()]).toEqual([B_PROFILE]);
    expect([...b.connections.connectedProfileIds()]).toEqual([A_PROFILE]);

    // Exactly one record each, and no scaffolding left behind.
    expect(onDiskConnections(a).map((c) => c.profileId)).toEqual([B_PROFILE]);
    expect(onDiskConnections(b).map((c) => c.profileId)).toEqual([A_PROFILE]);
    expect(rawConnections(a)).not.toContain(PROVISIONAL_KEY_PREFIX);
    expect(onDiskRequests(a)).toEqual([]);
    expect(onDiskRequests(b)).toEqual([]);

    expect(a.identityEvents).toEqual([
      { provisionalKey: B_PROVISIONAL, profileId: B_PROFILE },
    ]);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
});
