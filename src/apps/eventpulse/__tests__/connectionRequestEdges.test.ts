/**
 * ConnectionRequestCoordinator — the edges.
 *
 * The happy path of a BLE handshake is the easy half. What breaks a connection
 * state machine is everything around it: the same request delivered twice, both
 * people tapping Connect in the same second, a link that drops after the answer
 * arrived, an accept for a request that expired ten minutes ago, an identity
 * that rotates mid-exchange.
 *
 * NOTHING HERE IS MOCKED. Two `Phone`s are built out of the real
 * `LocalDatabase` over the real `MemoryStorageAdapter`, the real
 * `ConnectionService`, the real `BlockService`, the real `GattSessionManager`
 * and two real `InMemoryGattTransport`s wired to each other — framing,
 * fragmentation at a 23-byte MTU, the envelope and the link state machine all
 * run for real. Only the HTTP seam is a stand-in, because it is an interface
 * these classes are handed rather than a collaborator they own.
 *
 * Time is a module-level `now` advanced by assignment and pushed through
 * `coordinator.tick(now)`. No fake timers, no waiting.
 *
 * The correlation that makes any of this work: a phone's GATT advertisement
 * name is its own current `peerId`, and the other phone's `currentPeerIdFor`
 * must return exactly that for the person it belongs to. Break that and every
 * `request()` fails with `peer_not_found`, which is also why rotation gets a
 * suite of its own below.
 */

import { type EventPulseApi } from '../api/ApiClient';
import {
  ConnectionRequestCoordinator,
  ConnectionRequestError,
  DISCOVERY_FRESHNESS_MS,
  REQUEST_EXPIRY_MS,
  type ConnectionFailureCode,
  type PendingRequest,
} from '../connections/ConnectionRequestCoordinator';
import { ConnectionService } from '../connections/ConnectionService';
import {
  CONNECTION_PROTOCOL_VERSION,
  decodeConnectionReject,
  encodeConnectionPayload,
  type ConnectionCard,
} from '../connections/ConnectionProtocol';
import { BlockService } from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter } from '../storage/LocalDatabase';
import {
  GattMessageType,
  InMemoryGattTransport,
  GattSessionManager,
  type GattMessage,
} from '../bluetooth/gatt';
import type { Connection, PeerId, ProfileId } from '../types';

const EVENT_ID = 'evt_edges';

const ADA: ProfileId = 'prof_ada';
const GRACE: ProfileId = 'prof_grace';

const ADA_PEER: PeerId = 'PEER-ADA-1';
const GRACE_PEER: PeerId = 'PEER-GRACE-1';

const DEV_ADA = 'dev-ada';
const DEV_GRACE = 'dev-grace';

/** The injected clock. Advanced by assignment, never by a timer. */
let now = 1_000;
const clock = (): number => now;

/* ------------------------------------------------------------------ *
 * The network seam
 * ------------------------------------------------------------------ */

function unsupported(name: string): Promise<never> {
  return Promise.reject(new Error(`FakeApi.${name} is outside the connection seam`));
}

/**
 * Offline is the normal condition for this feature: the whole point of the BLE
 * handshake is that no server is involved. So the reads resolve empty and the
 * three calls `BlockService` makes resolve, and everything else is a loud
 * failure if some path unexpectedly reaches for the network.
 */
function makeApi(): EventPulseApi {
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
    listConnections: () => Promise.resolve<Connection[]>([]),
    blockUser: () => Promise.resolve(),
    unblockUser: () => Promise.resolve(),
    reportUser: () => Promise.resolve(),
  };
}

/* ------------------------------------------------------------------ *
 * A phone
 * ------------------------------------------------------------------ */

interface PhoneSpec {
  deviceId: string;
  profileId: ProfileId;
  peerId: PeerId;
  name: string;
}

interface WireMessage {
  deviceId: string;
  message: GattMessage;
}

class Phone {
  readonly spec: PhoneSpec;
  readonly adapter = new MemoryStorageAdapter();
  /** What the radar currently reports for other people. Mutable: ids rotate. */
  readonly peerIds = new Map<ProfileId, PeerId>();
  /** Every application message the session layer surfaced, in order. */
  readonly received: WireMessage[] = [];
  readonly incomingSeen: PendingRequest[] = [];

  accepts = true;
  requestCounter = 0;

  readonly db: LocalDatabase;
  readonly api: EventPulseApi;
  readonly connections: ConnectionService;
  readonly blocks: BlockService;
  readonly transport: InMemoryGattTransport;
  readonly sessions: GattSessionManager;
  coordinator: ConnectionRequestCoordinator;

  constructor(spec: PhoneSpec) {
    this.spec = spec;
    this.db = new LocalDatabase(this.adapter);
    this.api = makeApi();
    this.connections = new ConnectionService({ db: this.db, api: this.api });
    this.blocks = new BlockService(this.db, this.api);
    this.transport = new InMemoryGattTransport({
      deviceId: spec.deviceId,
      mtu: 23,
      // The advertisement carries our own current peer id. This is the bridge
      // between the radar's namespace and GATT's.
      displayName: spec.peerId,
      now: clock,
    });
    this.sessions = new GattSessionManager({ transport: this.transport, now: clock });
    this.coordinator = this.makeCoordinator(this.db);
  }

  get profileId(): ProfileId {
    return this.spec.profileId;
  }

  get deviceId(): string {
    return this.spec.deviceId;
  }

  card(): ConnectionCard {
    return { profileId: this.spec.profileId, name: this.spec.name };
  }

  /** A coordinator over a given database handle. A restart gets a fresh one. */
  makeCoordinator(db: LocalDatabase): ConnectionRequestCoordinator {
    return new ConnectionRequestCoordinator({
      sessions: this.sessions,
      connections: this.connections,
      blocks: this.blocks,
      db,
      now: clock,
      myCard: () => this.card(),
      acceptsConnectionRequests: () => this.accepts,
      currentPeerIdFor: (profileId) => this.peerIds.get(profileId) ?? null,
      newRequestId: () => `${this.spec.deviceId}-req-${++this.requestCounter}`,
    });
  }

  async boot(): Promise<void> {
    await this.db.open();
    await this.connections.load(EVENT_ID);
    await this.blocks.load();
    this.sessions.start();
    this.sessions.subscribe({
      onMessage: (deviceId, message) => {
        this.received.push({ deviceId, message });
      },
    });
    this.coordinator.subscribe({
      onIncomingRequest: (request) => {
        this.incomingSeen.push(request);
      },
    });
    await this.coordinator.start(EVENT_ID);
  }

  /** Every record this phone holds for one person. Should never exceed one. */
  recordsFor(profileId: ProfileId): Connection[] {
    return this.connections.list().filter((connection) => connection.profileId === profileId);
  }

  messagesOfType(type: number): GattMessage[] {
    return this.received.filter((entry) => entry.message.type === type).map((e) => e.message);
  }
}

/* ------------------------------------------------------------------ *
 * Harness helpers
 * ------------------------------------------------------------------ */

/**
 * Let every queued continuation run.
 *
 * Delivery through the in-memory wire is synchronous, but both coordinators
 * handle a message on an async chain (persist, write the record, emit). Draining
 * the microtask queue behind a macrotask settles all of it without a timer.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Put two phones in range, advertising, and scanning — so each discovers the other. */
async function bringIntoRange(a: Phone, b: Phone): Promise<void> {
  InMemoryGattTransport.pair(a.transport, b.transport);
  await a.transport.startPeripheral();
  await b.transport.startPeripheral();
  await a.transport.startScan();
  await b.transport.startScan();
  await settle();
}

async function expectFailure(
  action: () => Promise<unknown>,
  code: ConnectionFailureCode,
): Promise<ConnectionRequestError> {
  let caught: unknown = null;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConnectionRequestError);
  const error = caught as ConnectionRequestError;
  expect(error.code).toBe(code);
  return error;
}

/** Put a raw connection payload on the wire, bypassing the coordinator's own send. */
async function sendRaw(
  from: Phone,
  toDeviceId: string,
  type: number,
  payload: unknown,
): Promise<void> {
  await from.sessions.send(toDeviceId, type, encodeConnectionPayload(payload));
  await settle();
}

function requestPayload(from: Phone, requestId: string, note?: string): unknown {
  return {
    v: CONNECTION_PROTOCOL_VERSION,
    requestId,
    card: from.card(),
    note,
    sentAt: now,
  };
}

function acceptPayload(from: Phone, requestId: string): unknown {
  return {
    v: CONNECTION_PROTOCOL_VERSION,
    requestId,
    card: from.card(),
    acceptedAt: now,
  };
}

function rejectPayload(requestId: string, reason: string): unknown {
  return {
    v: CONNECTION_PROTOCOL_VERSION,
    requestId,
    reason,
    rejectedAt: now,
  };
}

/** A fresh coordinator over the same bytes on disk — an app restart. */
async function restartCoordinator(phone: Phone): Promise<ConnectionRequestCoordinator> {
  await phone.coordinator.stop();
  const db = new LocalDatabase(phone.adapter);
  await db.open();
  const coordinator = phone.makeCoordinator(db);
  await coordinator.start(EVENT_ID);
  phone.coordinator = coordinator;
  await settle();
  return coordinator;
}

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

let ada: Phone;
let grace: Phone;

beforeEach(async () => {
  now = 1_000;
  ada = new Phone({ deviceId: DEV_ADA, profileId: ADA, peerId: ADA_PEER, name: 'Ada' });
  grace = new Phone({ deviceId: DEV_GRACE, profileId: GRACE, peerId: GRACE_PEER, name: 'Grace' });
  // Each phone's radar resolves the OTHER person to the peer id that person is
  // actually advertising. This is the whole correlation.
  ada.peerIds.set(GRACE, GRACE_PEER);
  grace.peerIds.set(ADA, ADA_PEER);
  await ada.boot();
  await grace.boot();
  await bringIntoRange(ada, grace);
});

/** Ada asks, Grace answers yes. The ordinary path the edge cases start from. */
async function connectBothWays(): Promise<PendingRequest> {
  const sent = await ada.coordinator.request(GRACE);
  await settle();
  await grace.coordinator.accept(ADA);
  await settle();
  return sent;
}

/* ------------------------------------------------------------------ *
 * Duplicates
 * ------------------------------------------------------------------ */

describe('a request delivered twice', () => {
  it('leaves exactly one pending request, still carrying the original requestId', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    expect(grace.coordinator.incoming()).toHaveLength(1);
    expect(grace.coordinator.incoming()[0].requestId).toBe(sent.requestId);

    // The same payload again — a retry, a re-delivery, a peer that did not hear
    // an answer. The session layer only dedupes by message id, so this is a
    // genuinely new message carrying an old request.
    await sendRaw(ada, DEV_GRACE, GattMessageType.ConnectionRequest, requestPayload(ada, sent.requestId));

    const pending = grace.coordinator.incoming();
    expect(pending).toHaveLength(1);
    expect(pending[0].requestId).toBe(sent.requestId);
    expect(pending[0].direction).toBe('incoming');
    expect(grace.recordsFor(ADA)).toHaveLength(1);
    expect(grace.connections.stateFor(ADA)).toBe('incoming_pending');
  });

  it('surfaces the second copy to the UI only once', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();
    await sendRaw(ada, DEV_GRACE, GattMessageType.ConnectionRequest, requestPayload(ada, sent.requestId));

    expect(grace.incomingSeen).toHaveLength(1);
    expect(grace.incomingSeen[0].requestId).toBe(sent.requestId);
  });
});

describe('an accept sent twice', () => {
  it('connects the requester exactly once, with one record', async () => {
    const sent = await connectBothWays();

    await grace.coordinator.accept(ADA);
    await settle();
    // And once more straight onto the wire, for the same request id.
    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionAccept, acceptPayload(grace, sent.requestId));

    expect(ada.connections.stateFor(GRACE)).toBe('connected');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(grace.recordsFor(ADA)).toHaveLength(1);
    expect(grace.connections.stateFor(ADA)).toBe('connected');
  });
});

describe('a reject sent twice', () => {
  it('leaves the requester declined with one record and no crash', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    await grace.coordinator.reject(ADA);
    await settle();
    // The second call finds nothing pending and must be a no-op, not a throw.
    await expect(grace.coordinator.reject(ADA)).resolves.toBeUndefined();
    await settle();

    expect(ada.connections.stateFor(GRACE)).toBe('declined');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.recordsFor(GRACE)[0].requestId).toBe(sent.requestId);
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(grace.connections.stateFor(ADA)).toBe('declined');
    expect(grace.recordsFor(ADA)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Both people tap Connect
 * ------------------------------------------------------------------ */

describe('both people tap Connect before either answers', () => {
  /**
   * DEFECT — `ConnectionRequestCoordinator.settle()` empties `this.pending`
   * synchronously (ConnectionRequestCoordinator.ts:575) but writes the
   * `connected` record on an awaited path (`await this.persist()` then
   * `await this.writeConnection(...)`, lines 576-578). Between those two,
   * `onRequest` sees no pending exchange (line 474) AND a record that does not
   * yet say `connected` (line 462), so it takes neither the re-confirm branch
   * nor the mutual-consent branch: it files the crossing request as a brand new
   * INCOMING one and overwrites the settled record with `incoming_pending`
   * (lines 498-512).
   *
   * When both people tap Connect, Grace's request reaches Ada first, Ada
   * mutually consents and accepts, Grace settles `connected` — and then Ada's
   * own request lands inside that window. Observed end state: Ada is
   * `connected`, Grace is back to `incoming_pending` holding a request from the
   * person she is already connected to. That is exactly the window the file
   * header says does not exist ("no window where one side is connected and the
   * other is not", ConnectionRequestCoordinator.ts:48-53), and it strands the
   * pair: Grace's request now expires, and Ada cannot re-ask because her own
   * guard answers `already_connected`.
   *
   * FIXED in ConnectionRequestCoordinator.settle(): the record is now written
   * before `pending` is cleared, so the exchange is never invisible to a
   * crossing request. This is the regression test for that window.
   */
  it('connects both sides, with no pending or declined left anywhere', async () => {
    // Neither await is taken before the other call starts: both requests are
    // genuinely outstanding at the same moment.
    const fromAda = ada.coordinator.request(GRACE);
    const fromGrace = grace.coordinator.request(ADA);
    const [adaRequest, graceRequest] = await Promise.all([fromAda, fromGrace]);
    await settle();

    expect(adaRequest.direction).toBe('outgoing');
    expect(graceRequest.direction).toBe('outgoing');

    expect(ada.connections.stateFor(GRACE)).toBe('connected');
    expect(grace.connections.stateFor(ADA)).toBe('connected');

    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(grace.coordinator.pendingFor(ADA)).toBeNull();
    expect(ada.coordinator.incoming()).toHaveLength(0);
    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(ada.coordinator.outgoing()).toHaveLength(0);
    expect(grace.coordinator.outgoing()).toHaveLength(0);

    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(grace.recordsFor(ADA)).toHaveLength(1);
  });

  it('records each other\'s card, so neither side is connected to a stranger', async () => {
    await Promise.all([ada.coordinator.request(GRACE), grace.coordinator.request(ADA)]);
    await settle();

    expect(ada.recordsFor(GRACE)[0].card).toEqual({ profileId: GRACE, name: 'Grace' });
    expect(grace.recordsFor(ADA)[0].card).toEqual({ profileId: ADA, name: 'Ada' });
  });
});

/* ------------------------------------------------------------------ *
 * Guards
 * ------------------------------------------------------------------ */

describe('once connected', () => {
  it('refuses a second request with already_connected', async () => {
    await connectBothWays();
    expect(ada.connections.stateFor(GRACE)).toBe('connected');

    const error = await expectFailure(() => ada.coordinator.request(GRACE), 'already_connected');
    expect(error.message).toBe('You are already connected.');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.connections.stateFor(GRACE)).toBe('connected');
  });

  it('answers a fresh inbound request with an accept and creates no second record', async () => {
    await connectBothWays();
    const acceptsBefore = grace.messagesOfType(GattMessageType.ConnectionAccept).length;

    // Grace's phone re-asks under a brand new request id — a retry after she
    // reinstalled, say. Ada is already connected and must re-confirm.
    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionRequest, requestPayload(grace, 'grace-retry-1'));

    expect(ada.coordinator.incoming()).toHaveLength(0);
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.connections.stateFor(GRACE)).toBe('connected');

    const accepts = grace.messagesOfType(GattMessageType.ConnectionAccept);
    expect(accepts).toHaveLength(acceptsBefore + 1);
  });
});

describe('while a request is outstanding', () => {
  it('refuses a second request with already_pending and opens no second link', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();
    expect(ada.transport.getPeers()).toHaveLength(1);

    const error = await expectFailure(() => ada.coordinator.request(GRACE), 'already_pending');
    expect(error.message).toBe('A request is already on its way.');

    expect(ada.transport.getPeers()).toHaveLength(1);
    expect(ada.sessions.getSessions()).toHaveLength(1);
    expect(ada.coordinator.outgoing()).toHaveLength(1);
    expect(ada.coordinator.pendingFor(GRACE)?.requestId).toBe(sent.requestId);
    expect(grace.coordinator.incoming()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Blocking and privacy
 * ------------------------------------------------------------------ */

describe('blocking, outgoing', () => {
  it('refuses to send at all, so the blocked person never hears from us', async () => {
    await ada.blocks.block(GRACE);
    expect(ada.blocks.isBlocked(GRACE)).toBe(true);

    await expectFailure(() => ada.coordinator.request(GRACE), 'blocked');
    await settle();

    expect(grace.messagesOfType(GattMessageType.ConnectionRequest)).toHaveLength(0);
    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.recordsFor(ADA)).toHaveLength(0);
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
  });
});

describe('blocking, incoming', () => {
  it('surfaces nothing and answers with a plain decline, never "blocked"', async () => {
    await grace.blocks.block(ADA);

    const sent = await ada.coordinator.request(GRACE);
    await settle();

    // Grace sees nothing at all.
    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.incomingSeen).toHaveLength(0);
    expect(grace.recordsFor(ADA)).toHaveLength(0);

    // And what went out on the wire says only "declined". Telling someone they
    // are blocked confirms to them that they were noticed.
    const rejects = ada.messagesOfType(GattMessageType.ConnectionReject);
    expect(rejects).toHaveLength(1);
    const decoded = decodeConnectionReject(rejects[0].payload);
    expect(decoded).not.toBeNull();
    expect(decoded?.reason).toBe('declined');
    expect(decoded?.requestId).toBe(sent.requestId);

    expect(ada.connections.stateFor(GRACE)).toBe('declined');
  });
});

describe('privacy: not accepting connection requests', () => {
  it('is indistinguishable from an ordinary decline', async () => {
    grace.accepts = false;

    const sent = await ada.coordinator.request(GRACE);
    await settle();

    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.incomingSeen).toHaveLength(0);
    expect(grace.recordsFor(ADA)).toHaveLength(0);

    const rejects = ada.messagesOfType(GattMessageType.ConnectionReject);
    expect(rejects).toHaveLength(1);
    const decoded = decodeConnectionReject(rejects[0].payload);
    expect(decoded?.reason).toBe('declined');
    expect(decoded?.requestId).toBe(sent.requestId);
    expect(ada.connections.stateFor(GRACE)).toBe('declined');
  });
});

/* ------------------------------------------------------------------ *
 * Hostile and nonsensical input
 * ------------------------------------------------------------------ */

describe('a malformed request', () => {
  it('is dropped without a pending request, and the link still works after', async () => {
    await ada.sessions.open(DEV_GRACE);
    await settle();

    await ada.sessions.send(
      DEV_GRACE,
      GattMessageType.ConnectionRequest,
      new Uint8Array([0x01, 0x7f, 0x02, 0x03, 0x04, 0x05]),
    );
    await settle();

    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.recordsFor(ADA)).toHaveLength(0);
    expect(grace.messagesOfType(GattMessageType.ConnectionRequest)).toHaveLength(1);

    // The link survived the garbage: a real request straight after is honoured.
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    expect(grace.coordinator.incoming()).toHaveLength(1);
    expect(grace.coordinator.incoming()[0].requestId).toBe(sent.requestId);
  });

  it('drops a well-formed envelope whose card has no profileId', async () => {
    await ada.sessions.open(DEV_GRACE);
    await settle();

    await sendRaw(ada, DEV_GRACE, GattMessageType.ConnectionRequest, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'no-card-1',
      card: { name: 'Ada' },
      sentAt: now,
    });

    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.recordsFor(ADA)).toHaveLength(0);
  });
});

describe('a request claiming to be from us', () => {
  it('is ignored entirely — no pending request, no record, no answer', async () => {
    await ada.sessions.open(DEV_GRACE);
    await settle();

    await sendRaw(ada, DEV_GRACE, GattMessageType.ConnectionRequest, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId: 'self-1',
      // Grace's own profileId, arriving at Grace's phone.
      card: { profileId: GRACE, name: 'Grace' },
      sentAt: now,
    });

    expect(grace.coordinator.incoming()).toHaveLength(0);
    expect(grace.coordinator.pendingFor(GRACE)).toBeNull();
    expect(grace.connections.list()).toHaveLength(0);
    // Not even a decline goes back: a self-request is not answered.
    expect(ada.messagesOfType(GattMessageType.ConnectionReject)).toHaveLength(0);
    expect(ada.messagesOfType(GattMessageType.ConnectionAccept)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Restart
 * ------------------------------------------------------------------ */

describe('restarting with a pending request', () => {
  it('restores one that has not expired and drops one that has', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    const stored = grace.coordinator.pendingFor(ADA);
    expect(stored).not.toBeNull();
    const expiresAt = stored?.expiresAt ?? 0;
    expect(expiresAt).toBe((stored?.createdAt ?? 0) + REQUEST_EXPIRY_MS);

    // One millisecond inside the window: restored, with the same request id, so
    // answering it still means something to the phone waiting on the answer.
    now = expiresAt - 1;
    const restored = await restartCoordinator(grace);
    const revived = restored.pendingFor(ADA);
    expect(revived).not.toBeNull();
    expect(revived?.requestId).toBe(sent.requestId);
    expect(revived?.direction).toBe('incoming');
    expect(revived?.card).toEqual({ profileId: ADA, name: 'Ada' });
    expect(restored.incoming()).toHaveLength(1);

    // At the expiry instant itself it is gone: `expiresAt > now` is the rule.
    now = expiresAt;
    const afterExpiry = await restartCoordinator(grace);
    expect(afterExpiry.pendingFor(ADA)).toBeNull();
    expect(afterExpiry.incoming()).toHaveLength(0);
  });

  it('does not resurrect a request the restart dropped, even from disk', async () => {
    await ada.coordinator.request(GRACE);
    await settle();

    now = 1_000 + REQUEST_EXPIRY_MS + 1;
    await restartCoordinator(grace);
    expect(grace.coordinator.pendingFor(ADA)).toBeNull();

    // A second restart reads what the first one wrote back, and it is empty.
    const again = await restartCoordinator(grace);
    expect(again.pendingFor(ADA)).toBeNull();
    expect(again.incoming()).toHaveLength(0);
  });
});

describe('restarting with an established connection', () => {
  it('keeps the connected record across a fresh ConnectionService', async () => {
    await connectBothWays();
    expect(ada.connections.stateFor(GRACE)).toBe('connected');

    const db = new LocalDatabase(ada.adapter);
    await db.open();
    const reloaded = new ConnectionService({ db, api: makeApi() });
    const list = await reloaded.load(EVENT_ID);
    await settle();

    expect(list).toHaveLength(1);
    expect(reloaded.stateFor(GRACE)).toBe('connected');
    expect(reloaded.connected()).toHaveLength(1);
    expect(reloaded.connected()[0].profileId).toBe(GRACE);
    expect(reloaded.connected()[0].card).toEqual({ profileId: GRACE, name: 'Grace' });
  });
});

/* ------------------------------------------------------------------ *
 * The link is not the connection
 * ------------------------------------------------------------------ */

describe('the GATT link dropping after both sides connected', () => {
  it('leaves both sides connected: a connection is a record, not a socket', async () => {
    await connectBothWays();
    expect(ada.transport.getPeers()).toHaveLength(1);
    expect(grace.transport.getPeers()).toHaveLength(1);

    await ada.transport.disconnect(DEV_GRACE);
    await settle();

    expect(ada.transport.getPeers()).toHaveLength(0);
    expect(grace.transport.getPeers()).toHaveLength(0);
    expect(ada.sessions.getSessions()).toHaveLength(0);
    expect(grace.sessions.getSessions()).toHaveLength(0);

    expect(ada.connections.stateFor(GRACE)).toBe('connected');
    expect(grace.connections.stateFor(ADA)).toBe('connected');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(grace.recordsFor(ADA)).toHaveLength(1);
  });

  it('fails an in-flight request instead, because no answer is coming on it', async () => {
    await ada.coordinator.request(GRACE);
    await settle();
    expect(ada.coordinator.outgoing()).toHaveLength(1);

    await ada.transport.disconnect(DEV_GRACE);
    await settle();

    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(ada.connections.stateFor(GRACE)).toBe('failed');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
  });
});

describe('reconnecting after the link dropped', () => {
  it('re-confirms rather than creating a second connection', async () => {
    await connectBothWays();
    await ada.transport.disconnect(DEV_GRACE);
    await settle();

    // A brand-new link, and a brand-new request id from the far side.
    await grace.sessions.open(DEV_ADA);
    await settle();
    expect(ada.transport.getPeers()).toHaveLength(1);

    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionRequest, requestPayload(grace, 'grace-after-drop'));

    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.connections.stateFor(GRACE)).toBe('connected');
    expect(ada.coordinator.incoming()).toHaveLength(0);
    expect(grace.messagesOfType(GattMessageType.ConnectionAccept)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Rotating identity
 * ------------------------------------------------------------------ */

describe('a peer id that rotates mid-handshake', () => {
  it('does not disturb the exchange already in flight', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();
    expect(grace.coordinator.incoming()).toHaveLength(1);

    // The epoch turns over. Ada's radar now reports a different peer id for
    // Grace, and the stale advertisement no longer matches anything.
    ada.peerIds.set(GRACE, 'PEER-GRACE-2');
    expect(ada.coordinator.isReachable(GRACE)).toBe(false);

    // The exchange is keyed by profileId and the open link by deviceId, so it
    // completes regardless.
    await grace.coordinator.accept(ADA);
    await settle();

    expect(ada.connections.stateFor(GRACE)).toBe('connected');
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
    expect(ada.recordsFor(GRACE)[0].requestId).toBe(sent.requestId);
    expect(ada.recordsFor(GRACE)[0].card).toEqual({ profileId: GRACE, name: 'Grace' });
  });

  it('cannot be dialled again until the advertisement carries the new id', async () => {
    ada.peerIds.set(GRACE, 'PEER-GRACE-2');

    // The advertisement still says PEER-GRACE-1, so nothing correlates.
    expect(ada.coordinator.isReachable(GRACE)).toBe(false);
    await expectFailure(() => ada.coordinator.request(GRACE), 'peer_not_found');
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(ada.recordsFor(GRACE)).toHaveLength(0);

    // Grace re-advertises under the rotated id at the same deviceId, and Ada
    // scans again.
    const rotated = new InMemoryGattTransport({
      deviceId: DEV_GRACE,
      mtu: 23,
      displayName: 'PEER-GRACE-2',
      now: clock,
    });
    InMemoryGattTransport.pair(ada.transport, rotated);
    await rotated.startPeripheral();
    await ada.transport.startScan();
    await settle();

    expect(ada.coordinator.isReachable(GRACE)).toBe(true);
    const sent = await ada.coordinator.request(GRACE);
    await settle();
    expect(sent.direction).toBe('outgoing');
    expect(sent.deviceId).toBe(DEV_GRACE);
    expect(ada.connections.stateFor(GRACE)).toBe('outgoing_pending');
  });
});

/* ------------------------------------------------------------------ *
 * Late and mis-addressed messages
 * ------------------------------------------------------------------ */

describe('a late answer from an exchange that already settled', () => {
  it('cannot revive an expired request', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    now = sent.expiresAt;
    const expired = await ada.coordinator.tick(now);
    await settle();
    expect(expired).toEqual([GRACE]);
    expect(ada.connections.stateFor(GRACE)).toBe('expired');

    // The link was dropped on expiry; a new one carries the stale accept.
    await ada.sessions.open(DEV_GRACE);
    await settle();
    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionAccept, acceptPayload(grace, sent.requestId));

    expect(ada.connections.stateFor(GRACE)).toBe('expired');
    expect(ada.coordinator.pendingFor(GRACE)).toBeNull();
    expect(ada.recordsFor(GRACE)).toHaveLength(1);
  });

  it('ignores an accept whose requestId is not the one outstanding', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionAccept, acceptPayload(grace, 'some-other-request'));

    expect(ada.connections.stateFor(GRACE)).toBe('outgoing_pending');
    expect(ada.coordinator.pendingFor(GRACE)?.requestId).toBe(sent.requestId);
    expect(ada.recordsFor(GRACE)).toHaveLength(1);

    // The right id still settles it, which proves the guard was about the id.
    await sendRaw(grace, DEV_ADA, GattMessageType.ConnectionAccept, acceptPayload(grace, sent.requestId));
    expect(ada.connections.stateFor(GRACE)).toBe('connected');
  });
});

describe('a reject arriving in the wrong direction', () => {
  it('cannot cancel a request we are the recipient of', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();
    expect(grace.coordinator.incoming()).toHaveLength(1);

    // Ada rejects the request Ada herself sent. Grace holds it as INCOMING, so
    // this is the wrong direction and must be ignored.
    await sendRaw(ada, DEV_GRACE, GattMessageType.ConnectionReject, rejectPayload(sent.requestId, 'declined'));

    expect(grace.coordinator.incoming()).toHaveLength(1);
    expect(grace.coordinator.pendingFor(ADA)?.requestId).toBe(sent.requestId);
    expect(grace.connections.stateFor(ADA)).toBe('incoming_pending');

    // And it is still answerable.
    await grace.coordinator.accept(ADA);
    await settle();
    expect(grace.connections.stateFor(ADA)).toBe('connected');
    expect(ada.connections.stateFor(GRACE)).toBe('connected');
  });
});

/* ------------------------------------------------------------------ *
 * Discovery freshness
 * ------------------------------------------------------------------ */

describe('tick and stale GATT discoveries', () => {
  it('keeps a discovery reachable up to the freshness boundary and not past it', async () => {
    expect(ada.coordinator.isReachable(GRACE)).toBe(true);

    // Exactly at the boundary: `now - at > DISCOVERY_FRESHNESS_MS` is false, and
    // `at >= now - DISCOVERY_FRESHNESS_MS` still holds.
    now = 1_000 + DISCOVERY_FRESHNESS_MS;
    await ada.coordinator.tick(now);
    expect(ada.coordinator.isReachable(GRACE)).toBe(true);

    now = 1_000 + DISCOVERY_FRESHNESS_MS + 1;
    await ada.coordinator.tick(now);
    expect(ada.coordinator.isReachable(GRACE)).toBe(false);

    // Evicted, not merely stale — and a fresh scan puts it back.
    await expectFailure(() => ada.coordinator.request(GRACE), 'peer_not_found');
    await ada.transport.startScan();
    await settle();
    expect(ada.coordinator.isReachable(GRACE)).toBe(true);
  });

  it('expires a request and evicts discoveries in the same tick', async () => {
    const sent = await ada.coordinator.request(GRACE);
    await settle();

    now = sent.expiresAt;
    const expired = await ada.coordinator.tick(now);

    expect(expired).toEqual([GRACE]);
    expect(ada.connections.stateFor(GRACE)).toBe('expired');
    expect(ada.coordinator.isReachable(GRACE)).toBe(false);
  });
});
