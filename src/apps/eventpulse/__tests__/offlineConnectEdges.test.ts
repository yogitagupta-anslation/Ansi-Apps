/**
 * The provisional connect path, at its edges.
 *
 * EventPulse has no backend, so `AttendeeDirectory.peerIndex` — the only thing
 * that maps a rotating BLE `peerId` to a stable `profileId` — is always empty.
 * Every peer discovered over the radio is therefore someone the sender cannot
 * name. `requestByPeer()` dials them anyway, files the exchange under a
 * `peer:<PEERID>` stand-in, and reconciles onto the real profileId the moment
 * the far side's `CONNECTION_ACCEPT` arrives carrying their card.
 *
 * This file is about what happens around that path rather than down the middle
 * of it: a peer that rotates after the record already exists, a second dial to
 * a device already mid-exchange, a block learned only after the accept lands, a
 * request that expires to the millisecond, a restart with scaffolding still on
 * disk, and every malformed or unsolicited payload that can be written to our
 * RX characteristic.
 *
 * NOTHING HERE IS MOCKED. Each phone is a real `MemoryStorageAdapter`, a real
 * `LocalDatabase`, a real `ConnectionService`, a real `BlockService`, a real
 * `GattSessionManager` and a real `ConnectionRequestCoordinator` over an
 * `InMemoryGattTransport` at a 23-byte MTU — so every payload asserted below was
 * JSON-encoded, enveloped, fragmented, reassembled and decoded for real. Only
 * the HTTP seam is a stand-in, and it is there to prove it is never used.
 *
 * Time is a mutable `now` advanced by assignment and pushed through
 * `coordinator.tick(now)`. No fake timers, no waiting.
 *
 * The invariants this file exists to hold:
 *   - `peerId` is never a permanent identity. After reconciliation the only
 *     record is keyed by profileId and no `peer:` row survives in memory or on
 *     disk, however many times the peer id rotates afterwards.
 *   - A stand-in key does not outlive the exchange that minted it. An exchange
 *     that ends TERMINALLY without ever learning who it was talking to reports
 *     its outcome through `onSettled` — which still carries the record — and
 *     then leaves nothing behind: no row in memory, no `peer:` substring in the
 *     persisted blob. Only a real profileId earns a durable record.
 *   - The accept path finds its exchange by DEVICE, never by profileId — a
 *     provisional dial does not know the profileId, so an identity lookup would
 *     miss its own request.
 *   - Blocking is enforced on the LEARNED identity, at the first instant there
 *     is one to check.
 *   - A GATT link being up is never enough. `connected` requires an accept.
 */

import {
  ConnectionRequestCoordinator,
  ConnectionRequestError,
  PROVISIONAL_KEY_PREFIX,
  REQUEST_EXPIRY_MS,
  isProvisionalKey,
  provisionalKeyFor,
  type ConnectionFailureCode,
  type PendingRequest,
} from '../connections/ConnectionRequestCoordinator';
import { ConnectionService } from '../connections/ConnectionService';
import {
  CONNECTION_PROTOCOL_VERSION,
  decodeConnectionReject,
  encodeConnectionPayload,
  type ConnectionCard,
  type ConnectionRejectPayload,
} from '../connections/ConnectionProtocol';
import { BlockService } from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import {
  GattMessageType,
  GattSessionManager,
  InMemoryGattTransport,
  type GattMessage,
} from '../bluetooth/gatt';
import type { EventPulseApi } from '../api/ApiClient';
import type { Connection, ConnectionState, EventId, PeerId, ProfileId } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const EVENT_ID: EventId = 'evt_offline_edges';

const A_DEVICE = 'dev-ada';
const B_DEVICE = 'dev-grace';

const A_PROFILE: ProfileId = 'prof_ada';
const B_PROFILE: ProfileId = 'prof_grace';

const A_PEER: PeerId = 'PEER-ADA-1';
/** Grace's peer id for the first epoch, and for the one after she rotates. */
const B_PEER: PeerId = 'PEER-GRACE-1';
const B_PEER_2: PeerId = 'PEER-GRACE-2';

const A_KEY_ON_B = provisionalKeyFor(A_PEER);
const B_KEY_ON_A = provisionalKeyFor(B_PEER);
const B_KEY_2_ON_A = provisionalKeyFor(B_PEER_2);

const A_CARD: ConnectionCard = { profileId: A_PROFILE, name: 'Ada Lovelace', role: 'Analyst' };
const B_CARD: ConnectionCard = { profileId: B_PROFILE, name: 'Grace Hopper', role: 'Rear Admiral' };

const CLOCK_START = 1_000;

/** The injected clock. Advanced by assignment, never by a timer. */
let now = CLOCK_START;
const clock = (): number => now;

/**
 * Let every floating promise the transport started finish.
 *
 * `GattSessionManager` hands messages to the coordinator through
 * `void this.handleMessage(...)`, so a delivered byte is not a handled byte
 * until the microtask queue has drained. One `setImmediate` turn drains it;
 * several cover a chain of them without ever waiting on wall-clock time.
 */
async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/* ------------------------------------------------------------------ *
 * The network seam
 * ------------------------------------------------------------------ */

function unsupported(name: string): Promise<never> {
  return Promise.reject(new Error(`FakeApi.${name} must never be reached by the BLE handshake`));
}

/**
 * An `EventPulseApi` that records every call it receives.
 *
 * Offline is not a degraded mode for this feature, it is the only mode. The log
 * is what proves it: a provisional connect must complete end to end without a
 * single call reaching this object, so the tests below assert the log's exact
 * contents rather than merely that nothing threw.
 */
function makeApi(calls: string[]): EventPulseApi {
  return {
    listEvents: () => unsupported('listEvents'),
    getEvent: () => unsupported('getEvent'),
    joinEvent: () => unsupported('joinEvent'),
    leaveEvent: () => unsupported('leaveEvent'),
    getDirectory: () => unsupported('getDirectory'),
    getProfiles: () => unsupported('getProfiles'),
    publishPeerSchedule: () => unsupported('publishPeerSchedule'),
    updateProfile: () => unsupported('updateProfile'),
    updateEventProfile: () => unsupported('updateEventProfile'),
    updateVisibility: () => unsupported('updateVisibility'),
    searchAttendees: () => unsupported('searchAttendees'),
    requestConnection: () => unsupported('requestConnection'),
    respondToConnection: () => unsupported('respondToConnection'),
    listConnections: () => {
      calls.push('listConnections');
      return Promise.resolve<Connection[]>([]);
    },
    blockUser: (profileId: ProfileId) => {
      calls.push(`blockUser:${profileId}`);
      return Promise.resolve();
    },
    unblockUser: (profileId: ProfileId) => {
      calls.push(`unblockUser:${profileId}`);
      return Promise.resolve();
    },
    reportUser: (profileId: ProfileId) => {
      calls.push(`reportUser:${profileId}`);
      return Promise.resolve();
    },
  };
}

/* ------------------------------------------------------------------ *
 * A phone
 * ------------------------------------------------------------------ */

interface SettledEvent {
  profileId: ProfileId;
  state: ConnectionState;
}

interface LearnedEvent {
  provisionalKey: ProfileId;
  profileId: ProfileId;
}

interface WireEntry {
  deviceId: string;
  message: GattMessage;
}

interface Phone {
  deviceId: string;
  profileId: ProfileId;
  card: ConnectionCard;
  adapter: MemoryStorageAdapter;
  db: LocalDatabase;
  api: EventPulseApi;
  apiCalls: string[];
  connections: ConnectionService;
  blocks: BlockService;
  transport: InMemoryGattTransport;
  sessions: GattSessionManager;
  coordinator: ConnectionRequestCoordinator;
  incomingEvents: PendingRequest[];
  settledEvents: SettledEvent[];
  learnedEvents: LearnedEvent[];
  errors: ConnectionRequestError[];
  /** Every application message this phone's session layer surfaced. */
  wire: WireEntry[];
}

interface PhoneOptions {
  acceptsRequests?: boolean;
}

async function makePhone(
  deviceId: string,
  myProfileId: ProfileId,
  myName: string,
  myPeerId: PeerId,
  opts: PhoneOptions = {},
): Promise<Phone> {
  const adapter = new MemoryStorageAdapter();
  const db = new LocalDatabase(adapter);
  await db.open();

  const apiCalls: string[] = [];
  const api = makeApi(apiCalls);

  const connections = new ConnectionService({ db, api });
  await connections.load(EVENT_ID);

  const blocks = new BlockService(db, api);
  await blocks.load();

  // The transport advertises ITS OWN peer id as the GATT local name. That is
  // the only bridge between the radar's namespace and GATT's.
  const transport = new InMemoryGattTransport({
    deviceId,
    mtu: 23,
    displayName: myPeerId,
    now: clock,
  });
  const sessions = new GattSessionManager({ transport, now: clock });

  const card: ConnectionCard = { profileId: myProfileId, name: myName };
  let requestSeq = 0;

  const coordinator = new ConnectionRequestCoordinator({
    sessions,
    connections,
    blocks,
    db,
    now: clock,
    myCard: () => card,
    acceptsConnectionRequests: () => opts.acceptsRequests ?? true,
    // There is no directory offline, so nothing can resolve a peer id to a
    // person. Returning null is the whole premise of the provisional path.
    currentPeerIdFor: () => null,
    newRequestId: () => `${myProfileId}-req-${++requestSeq}`,
  });

  const incomingEvents: PendingRequest[] = [];
  const settledEvents: SettledEvent[] = [];
  const learnedEvents: LearnedEvent[] = [];
  const errors: ConnectionRequestError[] = [];
  const wire: WireEntry[] = [];

  coordinator.subscribe({
    onIncomingRequest: (request) => incomingEvents.push(request),
    onSettled: (profileId, connection) => settledEvents.push({ profileId, state: connection.state }),
    onIdentityLearned: (provisionalKey, profileId) =>
      learnedEvents.push({ provisionalKey, profileId }),
    onError: (_profileId, error) => errors.push(error),
  });

  sessions.start();
  await coordinator.start(EVENT_ID);

  // Recorded after the coordinator is attached, so the tests can read the exact
  // bytes that reached it rather than a paraphrase of them.
  sessions.subscribe({ onMessage: (from, message) => wire.push({ deviceId: from, message }) });

  return {
    deviceId,
    profileId: myProfileId,
    card,
    adapter,
    db,
    api,
    apiCalls,
    connections,
    blocks,
    transport,
    sessions,
    coordinator,
    incomingEvents,
    settledEvents,
    learnedEvents,
    errors,
    wire,
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Rotate the peer id a phone advertises.
 *
 * `InMemoryGattTransport` takes its local name at construction and exposes no
 * setter, so a rotation is a write to that field. From the other phone this is
 * indistinguishable from the real thing: the same deviceId starts announcing a
 * different name on the next scan.
 */
function rotateAdvertisedPeerId(transport: InMemoryGattTransport, peerId: PeerId): void {
  Reflect.set(transport, 'displayName', peerId);
}

async function expectRefusal(
  promise: Promise<unknown>,
  code: ConnectionFailureCode,
): Promise<ConnectionRequestError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionRequestError);
    const failure = error as ConnectionRequestError;
    expect(failure.code).toBe(code);
    return failure;
  }
  throw new Error(`expected the dial to be refused with '${code}', but it resolved`);
}

async function storedConnectionsRaw(phone: Phone): Promise<string> {
  return (await phone.adapter.getItem(`eventpulse:${keys.connections(EVENT_ID)}`)) ?? '[]';
}

async function storedConnections(phone: Phone): Promise<Connection[]> {
  return JSON.parse(await storedConnectionsRaw(phone)) as Connection[];
}

async function storedRequests(phone: Phone): Promise<PendingRequest[]> {
  const raw = await phone.adapter.getItem(`eventpulse:${keys.connectionRequests(EVENT_ID)}`);
  return raw === null ? [] : (JSON.parse(raw) as PendingRequest[]);
}

/**
 * The persisted connections blob holds no stand-in key, asserted as a STRING.
 *
 * A parsed scan of `profileId` fields would walk straight past a `peer:` key
 * hiding inside a record id — `ble_peer:PEER-GRACE-1_evt_offline_edges` is what
 * a surviving row is actually called — so the substring check is the one that
 * proves nothing made it to disk.
 */
async function expectNoPeerKeyInBlob(phone: Phone): Promise<void> {
  expect(await storedConnectionsRaw(phone)).not.toContain(PROVISIONAL_KEY_PREFIX);
}

/** No `peer:` scaffolding anywhere — not in memory, not in the persisted blob. */
async function expectNoProvisionalTrace(phone: Phone): Promise<void> {
  for (const connection of phone.connections.list()) {
    expect(isProvisionalKey(connection.profileId)).toBe(false);
  }
  const raw = await storedConnectionsRaw(phone);
  expect(raw.includes(PROVISIONAL_KEY_PREFIX)).toBe(false);
  for (const request of await storedRequests(phone)) {
    expect(isProvisionalKey(request.profileId)).toBe(false);
  }
}

function lastRejectOn(phone: Phone): ConnectionRejectPayload | null {
  for (let i = phone.wire.length - 1; i >= 0; i--) {
    const entry = phone.wire[i];
    if (entry.message.type === GattMessageType.ConnectionReject) {
      return decodeConnectionReject(entry.message.payload);
    }
  }
  return null;
}

/** Send a raw connection payload from one phone to the other, as a peer would. */
async function sendRaw(
  from: Phone,
  toDeviceId: string,
  type: number,
  payload: unknown,
): Promise<void> {
  await from.sessions.send(toDeviceId, type, encodeConnectionPayload(payload));
  await settle();
}

/* ------------------------------------------------------------------ *
 * Two phones in a room
 * ------------------------------------------------------------------ */

let ada: Phone;
let grace: Phone;

async function bringUp(graceOptions: PhoneOptions = {}): Promise<void> {
  now = CLOCK_START;
  ada = await makePhone(A_DEVICE, A_PROFILE, 'Ada Lovelace', A_PEER);
  grace = await makePhone(B_DEVICE, B_PROFILE, 'Grace Hopper', B_PEER, graceOptions);

  InMemoryGattTransport.pair(ada.transport, grace.transport);
  await ada.transport.startPeripheral();
  await grace.transport.startPeripheral();
  await ada.transport.startScan();
  await grace.transport.startScan();
  await settle();

  // `ConnectionService.load()` probes the server once. That is bootstrap, not
  // the handshake, so the log starts empty for what each test actually does.
  expect(ada.apiCalls).toEqual(['listConnections']);
  expect(grace.apiCalls).toEqual(['listConnections']);
  ada.apiCalls.length = 0;
  grace.apiCalls.length = 0;
}

/** A full provisional connect: Ada dials a stranger, Grace says yes. */
async function provisionalConnect(): Promise<PendingRequest> {
  const request = await ada.coordinator.requestByPeer(B_PEER);
  await settle();
  expect(grace.coordinator.incoming().map((r) => r.profileId)).toEqual([A_PROFILE]);

  await grace.coordinator.accept(A_PROFILE);
  await settle();
  return request;
}

beforeEach(async () => {
  await bringUp();
});

/* ================================================================== *
 * 1. Rotation must not produce a second record
 * ================================================================== */

describe('a peer id that rotates after reconciliation', () => {
  it('leaves exactly one connection keyed by profileId and no peer: row anywhere', async () => {
    await provisionalConnect();

    expect(ada.learnedEvents).toEqual([
      { provisionalKey: B_KEY_ON_A, profileId: B_PROFILE },
    ]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');

    // Grace's epoch turns over. Her deviceId is unchanged; the name she
    // advertises is not, so a fresh scan yields a peer id that would key a
    // brand-new `peer:` stand-in.
    rotateAdvertisedPeerId(grace.transport, B_PEER_2);
    now = CLOCK_START + 5_000;
    await ada.transport.startScan();
    await settle();
    expect(ada.coordinator.isPeerReachable(B_PEER_2)).toBe(true);

    // ...and now she asks again, from that new peer id, over the live link.
    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionRequest, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'grace-after-rotation',
      card: B_CARD,
      sentAt: now,
    });

    const rows = ada.connections.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].profileId).toBe(B_PROFILE);
    expect(rows[0].state).toBe('connected');

    // The rotation created no second exchange and no second row.
    expect(ada.coordinator.incoming()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.pendingFor(B_KEY_2_ON_A)).toBeNull();
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('none');
    expect(ada.incomingEvents).toEqual([]);

    const persisted = await storedConnections(ada);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].profileId).toBe(B_PROFILE);
    await expectNoProvisionalTrace(ada);

    // And the far side is symmetric: one record, keyed by the person.
    expect(grace.connections.list()).toHaveLength(1);
    expect(grace.connections.stateFor(A_PROFILE)).toBe('connected');

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 2 & 3. One link, one exchange
 * ================================================================== */

describe('a second dial while one is already in flight', () => {
  it('refuses the same peer with already_pending and opens no second link', async () => {
    const first = await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    expect(first.profileId).toBe(B_KEY_ON_A);
    expect(first.provisional).toBe(true);
    expect(ada.transport.getPeers()).toHaveLength(1);

    const error = await expectRefusal(ada.coordinator.requestByPeer(B_PEER), 'already_pending');
    expect(error.message).toBe('A request is already on its way.');

    expect(ada.transport.getPeers()).toHaveLength(1);
    expect(grace.transport.getPeers()).toHaveLength(1);
    expect(ada.coordinator.outgoing()).toHaveLength(1);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)?.requestId).toBe(first.requestId);
    expect(ada.connections.list()).toHaveLength(1);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(ada.errors.map((e) => e.code)).toEqual(['already_pending']);
    expect(ada.apiCalls).toEqual([]);
  });

  it('refuses a rotated peer id whose device is already mid-exchange under another key', async () => {
    const first = await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    // Same phone, new epoch. Nothing tells Ada these two peer ids are one
    // person, so without the device-level guard this would be a second
    // exchange riding the same link.
    rotateAdvertisedPeerId(grace.transport, B_PEER_2);
    now = CLOCK_START + 1_000;
    await ada.transport.startScan();
    await settle();
    expect(ada.coordinator.isPeerReachable(B_PEER_2)).toBe(true);

    await expectRefusal(ada.coordinator.requestByPeer(B_PEER_2), 'already_pending');

    expect(ada.transport.getPeers()).toHaveLength(1);
    expect(ada.coordinator.outgoing().map((r) => r.profileId)).toEqual([B_KEY_ON_A]);
    expect(ada.coordinator.pendingFor(B_KEY_2_ON_A)).toBeNull();
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)?.requestId).toBe(first.requestId);
    expect(ada.connections.list()).toHaveLength(1);
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('none');
    // Grace still sees exactly the one request Ada actually sent.
    expect(grace.incomingEvents).toHaveLength(1);
    expect(ada.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 4-6. Refusals
 * ================================================================== */

describe('refusing a provisional exchange', () => {
  it('enforces the blocklist at the first moment there is an identity to check it against', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');

    // Ada blocks Grace while the request is in flight. The dial could not have
    // consulted the blocklist — at the time it went out there was no identity
    // to look up, only `peer:PEER-GRACE-1`.
    await ada.blocks.block(B_PROFILE);
    expect(ada.blocks.isBlocked(B_PROFILE)).toBe(true);

    await grace.coordinator.accept(A_PROFILE);
    await settle();

    // The accept carried Grace's card, so it identified her — and it is refused
    // on that identity rather than honoured because it arrived. The refusal is
    // REPORTED first: `onSettled` carries the record in the state it reached,
    // so a screen waiting on the outcome sees the decline.
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'declined' }]);
    expect(ada.learnedEvents).toEqual([]);
    expect(ada.connections.connected()).toEqual([]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');

    // And then the stand-in row goes. Nothing here ever learned who
    // `peer:PEER-GRACE-1` was, so the row would be a permanent record of a
    // rotating id that is already meaningless.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(await storedRequests(ada)).toEqual([]);
    expect(request.provisional).toBe(true);

    // The only call is the blocklist's own mirror; nothing about the handshake
    // reached the network.
    expect(ada.apiCalls).toEqual([`blockUser:${B_PROFILE}`]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('declines a blocked stranger without surfacing the request or naming the block', async () => {
    await grace.blocks.block(A_PROFILE);
    expect(grace.apiCalls).toEqual([`blockUser:${A_PROFILE}`]);

    await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    // Grace is told nothing and shows nothing.
    expect(grace.incomingEvents).toEqual([]);
    expect(grace.coordinator.incoming()).toEqual([]);
    expect(grace.connections.list()).toEqual([]);

    // Ada is told 'declined' — never 'blocked'. Naming the block would confirm
    // to a person being avoided that they were noticed.
    const reject = lastRejectOn(ada);
    expect(reject).not.toBeNull();
    expect(reject?.reason).toBe('declined');
    expect(reject?.v).toBe(CONNECTION_PROTOCOL_VERSION);

    // The decline reaches Ada as an event carrying the record...
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'declined' }]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    // ...and the stand-in it was filed under is not kept afterwards.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(ada.apiCalls).toEqual([]);
  });

  it('declines when the far side is not accepting requests, with the same plain reason', async () => {
    await bringUp({ acceptsRequests: false });

    await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    expect(grace.incomingEvents).toEqual([]);
    expect(grace.coordinator.incoming()).toEqual([]);
    expect(grace.connections.list()).toEqual([]);

    const reject = lastRejectOn(ada);
    expect(reject?.reason).toBe('declined');

    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'declined' }]);
    expect(ada.connections.connected()).toEqual([]);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 7. Both strangers tap Connect
 * ================================================================== */

describe('simultaneous connect where neither side knows who the other is', () => {
  it('connects both, keyed by the real profileId, with no leftover peer: row on either phone', async () => {
    // Neither dial is awaited before the other starts, so both requests are on
    // the wire before either phone has answered anything.
    const adaDial = ada.coordinator.requestByPeer(B_PEER);
    const graceDial = grace.coordinator.requestByPeer(A_PEER);
    const [adaRequest, graceRequest] = await Promise.all([adaDial, graceDial]);
    await settle();

    expect(adaRequest.profileId).toBe(B_KEY_ON_A);
    expect(adaRequest.provisional).toBe(true);
    expect(graceRequest.profileId).toBe(A_KEY_ON_B);
    expect(graceRequest.provisional).toBe(true);

    expect(ada.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(grace.connections.stateFor(A_PROFILE)).toBe('connected');

    expect(ada.connections.list()).toHaveLength(1);
    expect(grace.connections.list()).toHaveLength(1);
    expect(ada.connections.list()[0].profileId).toBe(B_PROFILE);
    expect(grace.connections.list()[0].profileId).toBe(A_PROFILE);

    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(grace.connections.stateFor(A_KEY_ON_B)).toBe('none');
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(grace.coordinator.pendingFor(A_KEY_ON_B)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(grace.coordinator.outgoing()).toEqual([]);

    // Each side learned the other exactly once.
    expect(ada.learnedEvents).toEqual([{ provisionalKey: B_KEY_ON_A, profileId: B_PROFILE }]);
    expect(grace.learnedEvents).toEqual([{ provisionalKey: A_KEY_ON_B, profileId: A_PROFILE }]);

    await expectNoProvisionalTrace(ada);
    await expectNoProvisionalTrace(grace);
    expect(await storedConnections(ada)).toHaveLength(1);
    expect(await storedConnections(grace)).toHaveLength(1);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 8. Expiry, to the millisecond
 * ================================================================== */

describe('a provisional request that is never answered', () => {
  it('survives the millisecond before expiresAt, expires exactly on it, and keeps no row', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(request.createdAt).toBe(CLOCK_START);
    expect(request.expiresAt).toBe(CLOCK_START + REQUEST_EXPIRY_MS);

    now = request.expiresAt - 1;
    expect(await ada.coordinator.tick(now)).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)?.requestId).toBe(request.requestId);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');

    now = request.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_ON_A]);
    await settle();

    // The expiry is reported under the stand-in it was filed under — there is
    // still no identity to file it under instead — and the event carries the
    // record, so the outcome is observable...
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'expired' }]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);

    // ...but the row itself is withdrawn, because a `peer:` key that never
    // became a person is not something to keep.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(await storedRequests(ada)).toEqual([]);
    expect(ada.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 9 & 10. Restart
 * ================================================================== */

describe('restarting with work still on disk', () => {
  it('restores an unexpired provisional request with its peerId, and drops an expired one', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(await storedRequests(ada)).toHaveLength(1);

    // Restart before the request runs out: a fresh coordinator over a fresh
    // LocalDatabase on the same adapter, so the value asserted came off disk
    // rather than out of the previous instance's write-through cache.
    await ada.coordinator.stop();
    now = CLOCK_START + 30_000;
    const warmDb = new LocalDatabase(ada.adapter);
    await warmDb.open();
    const restored = new ConnectionRequestCoordinator({
      sessions: ada.sessions,
      connections: ada.connections,
      blocks: ada.blocks,
      db: warmDb,
      now: clock,
      myCard: () => ada.card,
      acceptsConnectionRequests: () => true,
      currentPeerIdFor: () => null,
      newRequestId: () => 'restored-should-not-mint',
    });
    await restored.start(EVENT_ID);

    const outgoing = restored.outgoing();
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].requestId).toBe(request.requestId);
    expect(outgoing[0].profileId).toBe(B_KEY_ON_A);
    expect(outgoing[0].provisional).toBe(true);
    expect(outgoing[0].peerId).toBe(B_PEER);
    expect(outgoing[0].deviceId).toBe(B_DEVICE);
    expect(outgoing[0].direction).toBe('outgoing');
    expect(outgoing[0].expiresAt).toBe(CLOCK_START + REQUEST_EXPIRY_MS);

    // The stand-in key is case-normalised, so the same person dialled as
    // 'peer-grace-1' resolves to the same exchange.
    expect(provisionalKeyFor(B_PEER.toLowerCase())).toBe(B_KEY_ON_A);
    expect(restored.pendingFor(provisionalKeyFor(B_PEER.toLowerCase()))?.requestId).toBe(
      request.requestId,
    );

    // Restart again, this time after it should have run out. A request that
    // died while the app was closed is not resurrected.
    await restored.stop();
    now = request.expiresAt + 1;
    const coldDb = new LocalDatabase(ada.adapter);
    await coldDb.open();
    const afterExpiry = new ConnectionRequestCoordinator({
      sessions: ada.sessions,
      connections: ada.connections,
      blocks: ada.blocks,
      db: coldDb,
      now: clock,
      myCard: () => ada.card,
      acceptsConnectionRequests: () => true,
      currentPeerIdFor: () => null,
      newRequestId: () => 'restored-should-not-mint',
    });
    await afterExpiry.start(EVENT_ID);

    expect(afterExpiry.outgoing()).toEqual([]);
    expect(afterExpiry.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(await storedRequests(ada)).toEqual([]);
    expect(ada.apiCalls).toEqual([]);

    await afterExpiry.stop();
  });

  it('shows a reconciled connection exactly once, keyed by profileId, to a fresh service', async () => {
    await provisionalConnect();
    expect(ada.apiCalls).toEqual([]);

    const freshDb = new LocalDatabase(ada.adapter);
    await freshDb.open();
    const freshService = new ConnectionService({ db: freshDb, api: ada.api });
    const loaded = await freshService.load(EVENT_ID);
    await settle();

    expect(loaded).toHaveLength(1);
    expect(freshService.list()).toHaveLength(1);
    expect(freshService.connected()).toHaveLength(1);
    expect(freshService.connected()[0].profileId).toBe(B_PROFILE);
    // The card that survives the restart is the one Grace actually put on the
    // wire in her accept — which offline is the only way Ada knows her name.
    expect(freshService.connected()[0].card).toEqual(grace.card);
    expect(freshService.stateFor(B_PROFILE)).toBe('connected');
    expect(freshService.stateFor(B_KEY_ON_A)).toBe('none');
    expect([...freshService.connectedProfileIds()]).toEqual([B_PROFILE]);
    expect(freshService.queuedCount).toBe(0);

    // Only the fresh service's own bootstrap probe; the handshake added nothing.
    expect(ada.apiCalls).toEqual(['listConnections']);
  });
});

/* ================================================================== *
 * 11-13. Hostile and unsolicited payloads
 * ================================================================== */

describe('payloads that cannot be trusted', () => {
  it('drops a request with no profileId and a request of garbage bytes, then honours a valid one', async () => {
    await grace.sessions.open(A_DEVICE);
    await settle();
    expect(ada.transport.getPeers()).toHaveLength(1);

    // A card with a name but no identity. There is nothing to key a connection
    // by, so it must not reach the user at all.
    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionRequest, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-no-profile',
      card: { name: 'Grace Hopper' },
      sentAt: now,
    });

    expect(ada.incomingEvents).toEqual([]);
    expect(ada.coordinator.incoming()).toEqual([]);
    expect(ada.connections.list()).toEqual([]);
    expect(ada.transport.getPeers()).toHaveLength(1);

    // Bytes that are not JSON at all.
    await grace.sessions.send(
      A_DEVICE,
      GattMessageType.ConnectionRequest,
      Uint8Array.from([0x7b, 0xff, 0x00, 0x21, 0x9c, 0x5d]),
    );
    await settle();

    expect(ada.incomingEvents).toEqual([]);
    expect(ada.coordinator.incoming()).toEqual([]);
    expect(ada.connections.list()).toEqual([]);
    expect(ada.errors).toEqual([]);
    expect(ada.transport.getPeers()).toHaveLength(1);

    // The link survived both, so the next real request works.
    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionRequest, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'req-valid',
      card: B_CARD,
      note: 'we met at the poster session',
      sentAt: now,
    });

    expect(ada.incomingEvents).toHaveLength(1);
    expect(ada.incomingEvents[0].profileId).toBe(B_PROFILE);
    expect(ada.incomingEvents[0].requestId).toBe('req-valid');
    expect(ada.incomingEvents[0].provisional).toBe(false);
    expect(ada.incomingEvents[0].peerId).toBeNull();
    expect(ada.incomingEvents[0].note).toBe('we met at the poster session');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('incoming_pending');
    expect(ada.connections.list()).toHaveLength(1);
    expect(ada.apiCalls).toEqual([]);
  });

  it('ignores an accept whose card has no profileId and leaves the provisional request pending', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionAccept, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: request.requestId,
      card: { name: 'Grace Hopper' },
      acceptedAt: now,
    });

    // There is nothing to reconcile onto, so the exchange stays exactly where
    // it was rather than being retired against a nameless accept.
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)?.requestId).toBe(request.requestId);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)?.provisional).toBe(true);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.connected()).toEqual([]);
    expect(ada.learnedEvents).toEqual([]);
    expect(ada.settledEvents).toEqual([]);
    expect(await storedRequests(ada)).toHaveLength(1);
    expect(ada.apiCalls).toEqual([]);
  });

  it('ignores an accept arriving on a link with no outstanding request', async () => {
    await grace.sessions.open(A_DEVICE);
    await settle();

    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionAccept, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'nobody-asked-for-this',
      card: B_CARD,
      acceptedAt: now,
    });

    expect(ada.connections.list()).toEqual([]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(ada.coordinator.incoming()).toEqual([]);
    expect(ada.settledEvents).toEqual([]);
    expect(ada.learnedEvents).toEqual([]);
    expect(ada.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 14 & 15. Accepts that arrive too late
 * ================================================================== */

describe('an accept that arrives after the exchange is over', () => {
  it('does not rebuild the discarded row of an expired provisional request', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    now = request.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_ON_A]);
    await settle();
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'expired' }]);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);

    // Expiry dropped the link, so Grace's phone has to come back to deliver the
    // answer at all. It still names the right requestId and the right card.
    now = request.expiresAt + 500;
    await grace.sessions.open(A_DEVICE);
    await settle();
    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionAccept, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: request.requestId,
      card: B_CARD,
      acceptedAt: now,
    });

    // The `settled` latch remembers the outcome, so the late accept neither
    // reopens the exchange nor writes the discarded row back — under the
    // stand-in it was dialled by, or under the identity it now carries.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.connected()).toEqual([]);
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.learnedEvents).toEqual([]);
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'expired' }]);
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(ada.apiCalls).toEqual([]);
  });

  it('does not rebuild the discarded row of a cancelled provisional request', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();

    await ada.coordinator.cancel(B_KEY_ON_A);
    await settle();
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'cancelled' }]);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();

    now = CLOCK_START + 2_000;
    await grace.sessions.open(A_DEVICE);
    await settle();
    await sendRaw(grace, A_DEVICE, GattMessageType.ConnectionAccept, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: request.requestId,
      card: B_CARD,
      acceptedAt: now,
    });

    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.connected()).toEqual([]);
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.learnedEvents).toEqual([]);
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'cancelled' }]);
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    expect(await storedRequests(ada)).toEqual([]);
    expect(ada.apiCalls).toEqual([]);
  });
});

/* ================================================================== *
 * 16. Nothing crosses the network
 * ================================================================== */

describe('the whole provisional path with no server', () => {
  it('completes a connect, a rotation and an expiry without a single API call', async () => {
    await provisionalConnect();

    rotateAdvertisedPeerId(grace.transport, B_PEER_2);
    now = CLOCK_START + 10_000;
    await ada.transport.startScan();
    await settle();

    now = CLOCK_START + REQUEST_EXPIRY_MS * 2;
    expect(await ada.coordinator.tick(now)).toEqual([]);
    expect(await grace.coordinator.tick(now)).toEqual([]);
    await settle();

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
    expect(ada.connections.queuedCount).toBe(0);
    expect(grace.connections.queuedCount).toBe(0);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(grace.connections.stateFor(A_PROFILE)).toBe('connected');
  });
});

/* ================================================================== *
 * 17-23. A stand-in key must not outlive the exchange that minted it
 * ================================================================== */

/**
 * `peer:<peerId>` is scaffolding between the tap and the answer, and the id it
 * is built from rotates every epoch. So an exchange that reaches a TERMINAL
 * state without ever learning who it was talking to has to leave nothing
 * behind. Otherwise dialling one unanswering stranger across an evening
 * deposits a fresh dead row per rotation, and Connections fills with keys that
 * name nobody and never will.
 *
 * The outcome is still REPORTED before the row goes: the record is written and
 * `onSettled` fires with it, so a screen watching the exchange sees the
 * decline, the expiry or the failure. Only the PERSISTED row is withdrawn.
 * Every test below therefore asserts both halves — what the listener saw, and
 * what is left in the in-memory view AND in the raw blob on disk.
 *
 * The blob is asserted as a string on purpose: a surviving row is called
 * `ble_peer:PEER-GRACE-1_evt_offline_edges`, so a stale key can hide inside a
 * record id where a scan of parsed `profileId` fields would miss it.
 *
 * `connected` is the one terminal state that does NOT trigger this, and it is
 * covered here too: it arrives via `reconcile()`, which files the connection
 * against the real profileId and retires the stand-in itself.
 */
describe('a provisional exchange that ends without ever learning who it was', () => {
  it('reports the decline and then discards the peer: row', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(request.provisional).toBe(true);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(grace.coordinator.incoming().map((r) => r.profileId)).toEqual([A_PROFILE]);

    // Grace taps Decline. Her reject names the requestId Ada is waiting on.
    await grace.coordinator.reject(A_PROFILE);
    await settle();

    // Observed.
    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'declined' }]);
    expect(lastRejectOn(ada)?.reason).toBe('declined');
    expect(ada.learnedEvents).toEqual([]);

    // Cleaned up, in memory...
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);
    // ...and on disk.
    expect(await storedConnections(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    // Grace filed hers against a real person, so hers is a record worth keeping.
    expect(grace.connections.stateFor(A_PROFILE)).toBe('declined');
    await expectNoProvisionalTrace(grace);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('reports the expiry and then discards the peer: row', async () => {
    const request = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(await storedConnections(ada)).toHaveLength(1);

    now = request.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_ON_A]);
    await settle();

    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'expired' }]);
    expect(ada.learnedEvents).toEqual([]);

    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(await storedConnections(ada)).toEqual([]);
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('reports the cancellation and then discards the peer: row', async () => {
    await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(await storedConnections(ada)).toHaveLength(1);

    // Ada withdraws before Grace has answered.
    await ada.coordinator.cancel(B_KEY_ON_A);
    await settle();

    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'cancelled' }]);
    expect(ada.learnedEvents).toEqual([]);

    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(await storedConnections(ada)).toEqual([]);
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('reports the failure and then discards the peer: row when the link drops mid-handshake', async () => {
    await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(grace.coordinator.incoming().map((r) => r.profileId)).toEqual([A_PROFILE]);
    expect(ada.transport.getPeers()).toHaveLength(1);

    // Grace's phone drops the link before she answers anything. `disconnect`
    // tears down both ends, so Ada's session closes with reason 'remote' — and
    // a link that goes away mid-handshake means no answer is coming on it,
    // which is what `handleSessionClosed` settles as `failed`.
    await grace.transport.disconnect(A_DEVICE);
    await settle();
    expect(ada.transport.getPeers()).toEqual([]);

    expect(ada.settledEvents).toEqual([{ profileId: B_KEY_ON_A, state: 'failed' }]);
    expect(ada.learnedEvents).toEqual([]);

    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(await storedConnections(ada)).toEqual([]);
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('retires the peer: row on accept while keeping the connection under the real profileId', async () => {
    await provisionalConnect();

    // Half one — the connection is kept, filed against the person Grace's
    // accept named, with the card she actually put on the wire.
    expect(ada.learnedEvents).toEqual([{ provisionalKey: B_KEY_ON_A, profileId: B_PROFILE }]);
    expect(ada.settledEvents).toEqual([{ profileId: B_PROFILE, state: 'connected' }]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(ada.connections.list()).toHaveLength(1);
    expect(ada.connections.list()[0].profileId).toBe(B_PROFILE);
    expect(ada.connections.list()[0].card).toEqual(grace.card);
    const persisted = await storedConnections(ada);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].profileId).toBe(B_PROFILE);
    expect(persisted[0].state).toBe('connected');

    // Half two — and the stand-in it was dialled under is gone from both views,
    // discarded by `reconcile` rather than by the terminal cleanup.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('leaves a reconciled connection untouched however many times the cleanup runs', async () => {
    await provisionalConnect();
    const real = { ...ada.connections.list()[0] };
    expect(real.profileId).toBe(B_PROFILE);
    expect(real.state).toBe('connected');

    // The cleanup is `discardLocal`, which is a no-op when the row is absent.
    // Aim it straight at the retired stand-in, repeatedly: the first call
    // already found nothing, and none of them may disturb the row beside it.
    for (let i = 0; i < 3; i++) {
      await ada.connections.discardLocal(EVENT_ID, B_KEY_ON_A);
    }
    expect(ada.connections.list()).toEqual([real]);

    // Ticks with nothing outstanding settle nothing, so nothing is cleaned up.
    for (const at of [
      CLOCK_START + 1_000,
      CLOCK_START + REQUEST_EXPIRY_MS,
      CLOCK_START + REQUEST_EXPIRY_MS * 2,
    ]) {
      now = at;
      expect(await ada.coordinator.tick(now)).toEqual([]);
    }
    await settle();

    // Cancels aimed at keys with no exchange behind them are no-ops too.
    await ada.coordinator.cancel(B_KEY_ON_A);
    await ada.coordinator.cancel(B_KEY_2_ON_A);
    await settle();
    expect(ada.connections.list()).toEqual([real]);

    // Now a SECOND provisional exchange that really does terminate. Grace's app
    // is closed, so her phone answers nothing: her transport still carries the
    // bytes, but no coordinator is listening for them.
    await grace.coordinator.stop();
    rotateAdvertisedPeerId(grace.transport, B_PEER_2);
    now = CLOCK_START + REQUEST_EXPIRY_MS * 2;
    await ada.transport.startScan();
    await settle();

    const second = await ada.coordinator.requestByPeer(B_PEER_2);
    await settle();
    expect(second.profileId).toBe(B_KEY_2_ON_A);
    expect(second.provisional).toBe(true);
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('outgoing_pending');
    expect(ada.connections.list()).toHaveLength(2);

    now = second.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_2_ON_A]);
    await settle();

    // The second stand-in went the way of every other one...
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    // ...and the real connection is byte for byte the row it was, still
    // connected. A record is not a socket: the link the cleanup closed under it
    // does not change what two people agreed to.
    expect(ada.connections.list()).toEqual([real]);
    expect(ada.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(ada.connections.connected()).toHaveLength(1);

    expect(await storedConnections(ada)).toEqual([real]);
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    expect(ada.settledEvents).toEqual([
      { profileId: B_PROFILE, state: 'connected' },
      { profileId: B_KEY_2_ON_A, state: 'expired' },
    ]);
    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });

  it('leaves no stale peer: row when a rotating peer id is dialled twice and answers neither time', async () => {
    // First epoch. Grace sees the request and simply never answers it.
    const first = await ada.coordinator.requestByPeer(B_PEER);
    await settle();
    expect(first.profileId).toBe(B_KEY_ON_A);
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('outgoing_pending');
    expect(grace.coordinator.incoming().map((r) => r.profileId)).toEqual([A_PROFILE]);

    now = first.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_ON_A]);
    await settle();
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.list()).toEqual([]);

    // Grace's epoch turns over. Same phone, same person, a name that keys a
    // brand-new stand-in — which is exactly how the old behaviour accumulated a
    // dead row per rotation.
    rotateAdvertisedPeerId(grace.transport, B_PEER_2);
    await ada.transport.startScan();
    await settle();
    expect(ada.coordinator.isPeerReachable(B_PEER_2)).toBe(true);

    const second = await ada.coordinator.requestByPeer(B_PEER_2);
    await settle();
    expect(second.profileId).toBe(B_KEY_2_ON_A);
    expect(second.profileId).not.toBe(first.profileId);
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('outgoing_pending');

    now = second.expiresAt;
    expect(await ada.coordinator.tick(now)).toEqual([B_KEY_2_ON_A]);
    await settle();

    // Both outcomes were reported, each under the key it was dialled by...
    expect(ada.settledEvents).toEqual([
      { profileId: B_KEY_ON_A, state: 'expired' },
      { profileId: B_KEY_2_ON_A, state: 'expired' },
    ]);
    expect(ada.learnedEvents).toEqual([]);

    // ...and ZERO rows are left. Not one per epoch, not one at all: nothing
    // here ever learned a person to file a record against.
    expect(ada.connections.stateFor(B_KEY_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_KEY_2_ON_A)).toBe('none');
    expect(ada.connections.stateFor(B_PROFILE)).toBe('none');
    expect(ada.connections.list()).toEqual([]);
    expect(ada.coordinator.outgoing()).toEqual([]);
    expect(ada.coordinator.pendingFor(B_KEY_ON_A)).toBeNull();
    expect(ada.coordinator.pendingFor(B_KEY_2_ON_A)).toBeNull();

    expect(await storedConnections(ada)).toEqual([]);
    expect(await storedRequests(ada)).toEqual([]);
    await expectNoPeerKeyInBlob(ada);
    await expectNoProvisionalTrace(ada);

    // Grace only ever filed against a real person, so nothing of hers is
    // provisional either — in memory or on disk.
    await expectNoProvisionalTrace(grace);
    await expectNoPeerKeyInBlob(grace);

    expect(ada.apiCalls).toEqual([]);
    expect(grace.apiCalls).toEqual([]);
  });
});
