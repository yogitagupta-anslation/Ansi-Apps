/**
 * GATT session integration suite.
 *
 * Two `InMemoryGattTransport` instances wired to each other, real framing, real
 * envelopes and a real `GattSessionManager` on each end. Nothing here is mocked:
 * every byte asserted below travelled through `fragmentMessage`, a reassembler
 * and `decodeGattMessage` exactly as it would on a link.
 *
 * Time is a plain mutable `now` driven by hand, so every deadline in the session
 * layer is asserted to the millisecond without a timer, a fake timer or a wait.
 */

import {
  GattMessageType,
  decodeGattMessage,
  encodeGattMessage,
  type GattMessage,
} from '../bluetooth/gatt/GattMessage';
import {
  ATT_DEFAULT_MTU,
  IOS_ASSUMED_MTU,
  payloadBytesForMtu,
} from '../bluetooth/gatt/GattProfile';
import {
  GattSessionManager,
  type GattSession,
} from '../bluetooth/gatt/GattSessionManager';
import {
  GattTransportError,
  type GattDisconnectReason,
  type GattDiscovery,
  type GattTransportErrorCode,
} from '../bluetooth/gatt/GattTransport';
import { InMemoryGattTransport } from '../bluetooth/gatt/transports/InMemoryGattTransport';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const A_ID = 'device-a';
const B_ID = 'device-b';
const C_ID = 'device-c';
const D_ID = 'device-d';

const A_NAME = 'Ada';
const B_NAME = 'Grace';

/** Two application types the transport layer knows nothing about. */
const APP_TYPE = 0x40;
const OTHER_APP_TYPE = 0x41;

const CLOCK_START = 1_000;

/** The injected clock. Nothing under test reads the wall clock. */
let now = CLOCK_START;
const clock = (): number => now;

interface RecordedClose {
  deviceId: string;
  reason: GattDisconnectReason;
}

interface RecordedMessage {
  deviceId: string;
  message: GattMessage;
}

interface Recorder {
  discoveries: GattDiscovery[];
  opened: GattSession[];
  closed: RecordedClose[];
  messages: RecordedMessage[];
  errors: GattTransportError[];
}

interface Endpoint {
  transport: InMemoryGattTransport;
  manager: GattSessionManager;
  /** What the application layer saw. */
  rec: Recorder;
  /** Whole reassembled payloads as they landed at the transport, below the session layer. */
  raw: Uint8Array[];
}

interface EndpointOptions {
  deviceId: string;
  displayName?: string;
  mtu?: number;
  connectTimeoutMs?: number;
  maxConcurrentLinks?: number;
  dedupeWindow?: number;
}

function createEndpoint(options: EndpointOptions): Endpoint {
  const transport = new InMemoryGattTransport({
    deviceId: options.deviceId,
    displayName: options.displayName,
    mtu: options.mtu,
    now: clock,
  });

  const raw: Uint8Array[] = [];
  transport.subscribe({
    onMessage: (_deviceId, payload) => {
      raw.push(payload);
    },
  });

  const manager = new GattSessionManager({
    transport,
    now: clock,
    connectTimeoutMs: options.connectTimeoutMs,
    maxConcurrentLinks: options.maxConcurrentLinks,
    dedupeWindow: options.dedupeWindow,
  });

  const rec: Recorder = {
    discoveries: [],
    opened: [],
    closed: [],
    messages: [],
    errors: [],
  };

  manager.start();
  manager.subscribe({
    onDiscovery: (discovery) => {
      rec.discoveries.push(discovery);
    },
    onSessionOpened: (session) => {
      rec.opened.push(session);
    },
    onSessionClosed: (deviceId, reason) => {
      rec.closed.push({ deviceId, reason });
    },
    onMessage: (deviceId, message) => {
      rec.messages.push({ deviceId, message });
    },
    onError: (error) => {
      rec.errors.push(error);
    },
  });

  return { transport, manager, rec, raw };
}

/** Bring `peripheral` up, put the two in range, and open a session from `central`. */
async function connectPair(central: Endpoint, peripheral: Endpoint): Promise<GattSession> {
  await peripheral.transport.startPeripheral();
  InMemoryGattTransport.pair(central.transport, peripheral.transport);
  return central.manager.open(peripheral.transport.deviceId);
}

/** Deterministic, non-repeating test bytes. */
function bytesOf(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i * 31 + seed * 101 + 7) & 0xff;
  }
  return out;
}

async function expectGattError(
  promise: Promise<unknown>,
  code: GattTransportErrorCode,
): Promise<GattTransportError> {
  let caught: unknown;
  let resolved = false;
  try {
    await promise;
    resolved = true;
  } catch (error) {
    caught = error;
  }
  if (resolved) {
    throw new Error(`expected a rejection with code ${code}, but the promise resolved`);
  }
  if (!(caught instanceof GattTransportError)) {
    throw new Error(`expected a GattTransportError, received ${String(caught)}`);
  }
  expect(caught.code).toBe(code);
  return caught;
}

beforeEach(() => {
  now = CLOCK_START;
});

/* ------------------------------------------------------------------ *
 * Discovery and the happy path
 * ------------------------------------------------------------------ */

describe('discovery and opening a session', () => {
  it('lets a scanner find an advertiser, open a session and exchange a message', async () => {
    const advertiser = createEndpoint({ deviceId: A_ID, displayName: A_NAME });
    const scanner = createEndpoint({ deviceId: B_ID, displayName: B_NAME });

    await advertiser.transport.startPeripheral();
    InMemoryGattTransport.pair(advertiser.transport, scanner.transport);
    await scanner.transport.startScan();

    expect(scanner.rec.discoveries.map((d) => d.deviceId)).toEqual([A_ID]);

    const session = await scanner.manager.open(A_ID);

    expect(session.deviceId).toBe(A_ID);
    expect(session.peer.role).toBe('central');
    expect(session.openedAt).toBe(CLOCK_START);
    expect(session.greeted).toBe(false);

    expect(scanner.manager.getSessions()).toEqual([session]);
    expect(scanner.manager.getLinkState(A_ID)).toBe('connected');

    const payload = bytesOf(24, 1);
    await scanner.manager.send(A_ID, APP_TYPE, payload);

    expect(advertiser.rec.messages).toHaveLength(1);
    expect(advertiser.rec.messages[0].deviceId).toBe(B_ID);
    expect(advertiser.rec.messages[0].message.type).toBe(APP_TYPE);
    expect(Array.from(advertiser.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('opens a session on both ends of one link', async () => {
    const advertiser = createEndpoint({ deviceId: A_ID, displayName: A_NAME });
    const scanner = createEndpoint({ deviceId: B_ID, displayName: B_NAME });

    await connectPair(scanner, advertiser);

    expect(scanner.rec.opened).toHaveLength(1);
    expect(advertiser.rec.opened).toHaveLength(1);
    expect(scanner.rec.opened[0].deviceId).toBe(A_ID);
    expect(advertiser.rec.opened[0].deviceId).toBe(B_ID);
    // The side that was connected TO holds the peripheral role.
    expect(advertiser.rec.opened[0].peer.role).toBe('peripheral');
    expect(advertiser.manager.getSession(B_ID)?.peer.displayName).toBe(B_NAME);
  });

  it('reports the advertiser device id and display name on the discovery event', async () => {
    const advertiser = createEndpoint({ deviceId: A_ID, displayName: A_NAME });
    const scanner = createEndpoint({ deviceId: B_ID, displayName: B_NAME });

    await advertiser.transport.startPeripheral();
    InMemoryGattTransport.pair(advertiser.transport, scanner.transport);
    now = CLOCK_START + 750;
    await scanner.transport.startScan();

    expect(scanner.rec.discoveries).toHaveLength(1);
    expect(scanner.rec.discoveries[0].deviceId).toBe(A_ID);
    expect(scanner.rec.discoveries[0].displayName).toBe(A_NAME);
    expect(scanner.rec.discoveries[0].discoveredAt).toBe(CLOCK_START + 750);
    expect(scanner.rec.discoveries[0].rssi).toBeUndefined();
  });

  it('does not discover a peer in range that is not advertising', async () => {
    const advertiser = createEndpoint({ deviceId: A_ID, displayName: A_NAME });
    const silent = createEndpoint({ deviceId: C_ID });
    const scanner = createEndpoint({ deviceId: B_ID });

    await advertiser.transport.startPeripheral();
    InMemoryGattTransport.pair(advertiser.transport, scanner.transport);
    InMemoryGattTransport.pair(silent.transport, scanner.transport);

    await scanner.transport.startScan();

    expect(scanner.rec.discoveries.map((d) => d.deviceId)).toEqual([A_ID]);
  });

  it('rejects a connect to a peer that is not advertising with connect_failed', async () => {
    const silent = createEndpoint({ deviceId: C_ID });
    const scanner = createEndpoint({ deviceId: B_ID });
    InMemoryGattTransport.pair(silent.transport, scanner.transport);

    const error = await expectGattError(scanner.manager.open(C_ID), 'connect_failed');

    expect(error.message).toContain('is not advertising');
    expect(scanner.manager.getSessions()).toEqual([]);
    expect(scanner.manager.pendingCount).toBe(0);
    expect(scanner.rec.opened).toEqual([]);
  });

  it('rejects a connect to a peer that is out of range with connect_failed', async () => {
    const scanner = createEndpoint({ deviceId: B_ID });

    await expectGattError(scanner.manager.open(D_ID), 'connect_failed');

    expect(scanner.manager.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Fragmentation over the real path
 * ------------------------------------------------------------------ */

describe('fragmentation across the real transport', () => {
  it('carries several hundred bytes byte-identically at the 23-byte Android floor', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    // 11 usable bytes per frame, so a 400-byte message is unambiguously fragmented.
    expect(payloadBytesForMtu(ATT_DEFAULT_MTU)).toBe(11);

    const payload = bytesOf(400, 3);
    await central.manager.send(B_ID, APP_TYPE, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    const received = peripheral.rec.messages[0].message.payload;
    expect(received.length).toBe(400);
    expect(Array.from(received)).toEqual(Array.from(payload));
  });

  it('carries several hundred bytes byte-identically at the 185-byte iOS MTU', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: IOS_ASSUMED_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: IOS_ASSUMED_MTU });
    await connectPair(central, peripheral);

    expect(payloadBytesForMtu(IOS_ASSUMED_MTU)).toBe(173);

    const payload = bytesOf(400, 4);
    await central.manager.send(B_ID, APP_TYPE, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    const received = peripheral.rec.messages[0].message.payload;
    expect(received.length).toBe(400);
    expect(Array.from(received)).toEqual(Array.from(payload));
  });

  it('really does split a 400-byte message into more than six frames at MTU 23', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    // Losing the sixth frame can only matter if a sixth frame exists.
    central.transport.faults.dropFragmentIndex = 5;
    await central.manager.send(B_ID, APP_TYPE, bytesOf(400, 5));

    expect(peripheral.rec.messages).toEqual([]);
  });

  it('needs no sixth frame for the same message at MTU 185', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: IOS_ASSUMED_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: IOS_ASSUMED_MTU });
    await connectPair(central, peripheral);

    central.transport.faults.dropFragmentIndex = 5;
    const payload = bytesOf(400, 5);
    await central.manager.send(B_ID, APP_TYPE, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    expect(Array.from(peripheral.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('delivers a message that fills exactly one frame at MTU 23', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    // 6-byte envelope + 5-byte payload == the 11 usable bytes of one frame, so
    // dropping a second frame proves there is no second frame.
    central.transport.faults.dropFragmentIndex = 1;
    const payload = bytesOf(5, 6);
    await central.manager.send(B_ID, APP_TYPE, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    expect(Array.from(peripheral.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('delivers a message one byte past a frame boundary at MTU 23', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    const payload = bytesOf(6, 7);
    await central.manager.send(B_ID, APP_TYPE, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    expect(Array.from(peripheral.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('delivers an empty payload as a zero-length application message', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    await central.manager.send(B_ID, APP_TYPE);

    expect(peripheral.rec.messages).toHaveLength(1);
    expect(peripheral.rec.messages[0].message.payload.length).toBe(0);
    expect(peripheral.rec.messages[0].message.type).toBe(APP_TYPE);
  });
});

/* ------------------------------------------------------------------ *
 * Concurrent and repeated opens
 * ------------------------------------------------------------------ */

describe('one link per device', () => {
  it('resolves two overlapping opens to the same session over a single link', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await peripheral.transport.startPeripheral();
    InMemoryGattTransport.pair(central.transport, peripheral.transport);

    const first = central.manager.open(B_ID);
    const second = central.manager.open(B_ID);
    const [one, two] = await Promise.all([first, second]);

    expect(one).toBe(two);
    expect(central.manager.getSessions()).toEqual([one]);
    expect(central.transport.getPeers()).toHaveLength(1);
    expect(peripheral.transport.getPeers()).toHaveLength(1);
    expect(central.rec.opened).toHaveLength(1);
    expect(peripheral.rec.opened).toHaveLength(1);
  });

  it('shares one pending connect between two overlapping opens', async () => {
    const central = createEndpoint({ deviceId: A_ID, connectTimeoutMs: 5_000 });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await peripheral.transport.startPeripheral();
    InMemoryGattTransport.pair(central.transport, peripheral.transport);
    central.transport.faults.stallConnect = true;

    const first = central.manager.open(B_ID);
    const second = central.manager.open(B_ID);
    const firstSettled = expectGattError(first, 'connect_timeout');
    const secondSettled = expectGattError(second, 'connect_timeout');

    expect(central.manager.pendingCount).toBe(1);

    now = CLOCK_START + 5_000;
    expect(central.manager.tick(now)).toEqual([B_ID]);

    await firstSettled;
    await secondSettled;
    expect(central.manager.pendingCount).toBe(0);
  });

  it('returns the existing session without reconnecting when one is already open', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    const first = await connectPair(central, peripheral);

    now = CLOCK_START + 9_999;
    const second = await central.manager.open(B_ID);

    expect(second).toBe(first);
    expect(second.openedAt).toBe(CLOCK_START);
    expect(central.rec.opened).toHaveLength(1);
    expect(peripheral.rec.opened).toHaveLength(1);
    expect(central.transport.getPeers()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * The concurrent-link ceiling
 * ------------------------------------------------------------------ */

describe('the concurrent link ceiling', () => {
  async function centralWithCap(cap: number): Promise<Endpoint> {
    const central = createEndpoint({ deviceId: A_ID, maxConcurrentLinks: cap });
    for (const id of [B_ID, C_ID, D_ID]) {
      const peripheral = createEndpoint({ deviceId: id });
      await peripheral.transport.startPeripheral();
      InMemoryGattTransport.pair(central.transport, peripheral.transport);
    }
    return central;
  }

  it('admits exactly as many links as the cap allows', async () => {
    const central = await centralWithCap(2);

    await central.manager.open(B_ID);
    await central.manager.open(C_ID);

    expect(central.manager.getSessions().map((s) => s.deviceId)).toEqual([B_ID, C_ID]);
    expect(central.transport.getPeers()).toHaveLength(2);
  });

  it('rejects the link one past the cap with connect_failed', async () => {
    const central = await centralWithCap(2);
    await central.manager.open(B_ID);
    await central.manager.open(C_ID);

    const error = await expectGattError(central.manager.open(D_ID), 'connect_failed');

    expect(error.recoverable).toBe(true);
    expect(error.message).toContain('2 links');
  });

  it('leaves the existing sessions untouched when an open is refused by the cap', async () => {
    const central = await centralWithCap(2);
    const toB = await central.manager.open(B_ID);
    const toC = await central.manager.open(C_ID);

    await expectGattError(central.manager.open(D_ID), 'connect_failed');

    expect(central.manager.getSessions()).toEqual([toB, toC]);
    expect(central.manager.getLinkState(B_ID)).toBe('connected');
    expect(central.manager.getLinkState(C_ID)).toBe('connected');
    expect(central.manager.getLinkState(D_ID)).toBe('idle');
    expect(central.rec.closed).toEqual([]);
    expect(central.transport.getPeers()).toHaveLength(2);
  });

  it('frees a slot once a session closes', async () => {
    const central = await centralWithCap(2);
    await central.manager.open(B_ID);
    await central.manager.open(C_ID);
    await expectGattError(central.manager.open(D_ID), 'connect_failed');

    await central.manager.close(B_ID);
    const toD = await central.manager.open(D_ID);

    expect(toD.deviceId).toBe(D_ID);
    expect(central.manager.getSessions().map((s) => s.deviceId)).toEqual([C_ID, D_ID]);
  });

  it('counts a connect still in flight against the cap', async () => {
    const central = await centralWithCap(2);
    await central.manager.open(B_ID);
    central.transport.faults.stallConnect = true;

    const stalled = central.manager.open(C_ID);
    const stalledSettled = expectGattError(stalled, 'connect_timeout');
    expect(central.manager.pendingCount).toBe(1);

    await expectGattError(central.manager.open(D_ID), 'connect_failed');

    now = CLOCK_START + 12_000;
    central.manager.tick(now);
    await stalledSettled;
  });
});

/* ------------------------------------------------------------------ *
 * Connect timeouts
 * ------------------------------------------------------------------ */

describe('connect timeouts', () => {
  async function stalledCentral(): Promise<Endpoint> {
    const central = createEndpoint({ deviceId: A_ID, connectTimeoutMs: 5_000 });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await peripheral.transport.startPeripheral();
    InMemoryGattTransport.pair(central.transport, peripheral.transport);
    central.transport.faults.stallConnect = true;
    return central;
  }

  it('does not expire a connect on a tick one millisecond before its deadline', async () => {
    const central = await stalledCentral();
    const attempt = central.manager.open(B_ID);
    const settled = expectGattError(attempt, 'connect_timeout');

    now = CLOCK_START + 4_999;
    expect(central.manager.tick(now)).toEqual([]);
    expect(central.manager.pendingCount).toBe(1);

    now = CLOCK_START + 5_000;
    central.manager.tick(now);
    await settled;
  });

  it('expires a connect exactly on its deadline and rejects with connect_timeout', async () => {
    const central = await stalledCentral();
    const attempt = central.manager.open(B_ID);
    const settled = expectGattError(attempt, 'connect_timeout');

    now = CLOCK_START + 5_000;
    expect(central.manager.tick(now)).toEqual([B_ID]);

    const error = await settled;
    expect(error.message).toContain('5000 ms');
    expect(central.manager.getSessions()).toEqual([]);
    expect(central.rec.opened).toEqual([]);
  });

  it('clears the pending entry once a connect has timed out', async () => {
    const central = await stalledCentral();
    const attempt = central.manager.open(B_ID);
    const settled = expectGattError(attempt, 'connect_timeout');

    expect(central.manager.pendingCount).toBe(1);
    now = CLOCK_START + 5_000;
    central.manager.tick(now);
    await settled;

    expect(central.manager.pendingCount).toBe(0);
    expect(central.manager.tick(now + 1_000)).toEqual([]);
  });

  it('tells the native side to let go of a link it timed out', async () => {
    const central = await stalledCentral();
    const attempt = central.manager.open(B_ID);
    const settled = expectGattError(attempt, 'connect_timeout');
    expect(central.manager.getLinkState(B_ID)).toBe('connecting');

    now = CLOCK_START + 5_000;
    central.manager.tick(now);
    await settled;

    expect(central.manager.getLinkState(B_ID)).toBe('idle');
  });

  it('reports nothing expired when no connect is pending', () => {
    const central = createEndpoint({ deviceId: A_ID, connectTimeoutMs: 5_000 });

    expect(central.manager.tick(CLOCK_START + 1_000_000)).toEqual([]);
    expect(central.manager.pendingCount).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Disconnect, cleanup and reconnect
 * ------------------------------------------------------------------ */

describe('disconnect cleanup', () => {
  it('removes the session and reports reason local after close()', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await central.manager.close(B_ID);

    expect(central.manager.getSessions()).toEqual([]);
    expect(central.manager.getSession(B_ID)).toBeUndefined();
    expect(central.rec.closed).toEqual([{ deviceId: B_ID, reason: 'local' }]);
    expect(central.manager.getLinkState(B_ID)).toBe('idle');
  });

  it('rejects a send after close with not_connected', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);
    await central.manager.close(B_ID);

    const error = await expectGattError(
      central.manager.send(B_ID, APP_TYPE, bytesOf(4)),
      'not_connected',
    );

    expect(error.message).toContain(B_ID);
    expect(peripheral.rec.messages).toEqual([]);
  });

  it('tells the far side the link ended when close() is called', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await central.manager.close(B_ID);

    expect(peripheral.rec.closed).toEqual([{ deviceId: A_ID, reason: 'remote' }]);
    expect(peripheral.manager.getSessions()).toEqual([]);
  });

  it('closes the session with reason remote when the far side hangs up', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await peripheral.transport.disconnect(A_ID);

    expect(central.rec.closed).toEqual([{ deviceId: B_ID, reason: 'remote' }]);
    expect(central.manager.getSessions()).toEqual([]);
    expect(peripheral.rec.closed).toEqual([{ deviceId: A_ID, reason: 'local' }]);
  });

  it('closes the session with reason remote when the peer simply vanishes', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    central.transport.teardown(B_ID, 'remote');

    expect(central.rec.closed).toEqual([{ deviceId: B_ID, reason: 'remote' }]);
    expect(central.manager.getSessions()).toEqual([]);
    await expectGattError(central.manager.send(B_ID, APP_TYPE), 'not_connected');
  });

  it('reports nothing when a device with no session is closed', async () => {
    const central = createEndpoint({ deviceId: A_ID });

    await central.manager.close(C_ID);

    expect(central.rec.closed).toEqual([]);
    expect(central.manager.getSessions()).toEqual([]);
  });

  it('yields a fresh session when a device is opened again after a disconnect', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    const first = await connectPair(central, peripheral);
    await central.manager.close(B_ID);

    now = CLOCK_START + 500;
    const second = await central.manager.open(B_ID);

    expect(second).not.toBe(first);
    expect(second.openedAt).toBe(CLOCK_START + 500);
    expect(second.greeted).toBe(false);
    expect(central.rec.opened).toHaveLength(2);
    expect(central.manager.getSessions()).toEqual([second]);

    const payload = bytesOf(12, 9);
    await central.manager.send(B_ID, APP_TYPE, payload);
    expect(peripheral.rec.messages).toHaveLength(1);
    expect(Array.from(peripheral.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });
});

/* ------------------------------------------------------------------ *
 * Duplicate delivery
 * ------------------------------------------------------------------ */

describe('duplicate suppression', () => {
  it('hands the application one message even when every frame is delivered twice', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    peripheral.transport.faults.duplicateFrames = true;
    // 6-byte envelope + 5-byte payload is one frame, so both copies reach the
    // session layer whole and it is the dedupe window that collapses them.
    const payload = bytesOf(5, 2);
    await peripheral.manager.send(A_ID, APP_TYPE, payload);

    // The wire really did deliver it twice; the session layer is what collapsed it.
    expect(central.raw).toHaveLength(2);
    expect(central.rec.messages).toHaveLength(1);
    expect(Array.from(central.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('hands the application one message when a fragmented one is delivered twice', async () => {
    const central = createEndpoint({ deviceId: A_ID, mtu: ATT_DEFAULT_MTU });
    const peripheral = createEndpoint({ deviceId: B_ID, mtu: ATT_DEFAULT_MTU });
    await connectPair(central, peripheral);

    peripheral.transport.faults.duplicateFrames = true;
    const payload = bytesOf(200, 6);
    await peripheral.manager.send(A_ID, APP_TYPE, payload);

    expect(central.rec.messages).toHaveLength(1);
    expect(Array.from(central.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('suppresses a replayed envelope with the same type and id', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const envelope = encodeGattMessage({ type: APP_TYPE, messageId: 77, payload: bytesOf(4, 1) });
    await peripheral.transport.send(A_ID, envelope);
    await peripheral.transport.send(A_ID, envelope);

    expect(central.raw).toHaveLength(2);
    expect(central.rec.messages).toHaveLength(1);
    expect(central.rec.messages[0].message.messageId).toBe(77);
  });

  it('does not suppress the same message id carried by a different type', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await peripheral.transport.send(A_ID, encodeGattMessage({ type: APP_TYPE, messageId: 77 }));
    await peripheral.transport.send(
      A_ID,
      encodeGattMessage({ type: OTHER_APP_TYPE, messageId: 77 }),
    );

    expect(central.rec.messages.map((m) => m.message.type)).toEqual([APP_TYPE, OTHER_APP_TYPE]);
    expect(central.rec.messages.map((m) => m.message.messageId)).toEqual([77, 77]);
  });

  it('forgets an id once it falls out of the dedupe window', async () => {
    const central = createEndpoint({ deviceId: A_ID, dedupeWindow: 2 });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const first = encodeGattMessage({ type: APP_TYPE, messageId: 1 });
    await peripheral.transport.send(A_ID, first);
    await peripheral.transport.send(A_ID, encodeGattMessage({ type: APP_TYPE, messageId: 2 }));
    await peripheral.transport.send(A_ID, encodeGattMessage({ type: APP_TYPE, messageId: 3 }));
    // Id 1 has now been evicted, so the replay is treated as new.
    await peripheral.transport.send(A_ID, first);

    expect(central.rec.messages.map((m) => m.message.messageId)).toEqual([1, 2, 3, 1]);
  });

  it('keeps separate dedupe state per link', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const first = createEndpoint({ deviceId: B_ID });
    const second = createEndpoint({ deviceId: C_ID });
    await connectPair(central, first);
    await connectPair(central, second);

    const envelope = encodeGattMessage({ type: APP_TYPE, messageId: 5 });
    await first.transport.send(A_ID, envelope);
    await second.transport.send(A_ID, envelope);

    expect(central.rec.messages.map((m) => m.deviceId)).toEqual([B_ID, C_ID]);
  });
});

/* ------------------------------------------------------------------ *
 * Malformed traffic
 * ------------------------------------------------------------------ */

describe('malformed traffic', () => {
  it('reports an undecodable payload and leaves the link usable', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    // Three bytes cannot hold the six-byte envelope header.
    await peripheral.transport.send(A_ID, Uint8Array.from([1, 2, 3]));

    expect(central.rec.errors).toHaveLength(1);
    expect(central.rec.errors[0].code).toBe('internal');
    expect(central.rec.errors[0].message).toContain(B_ID);
    expect(central.rec.messages).toEqual([]);
    expect(central.manager.getLinkState(B_ID)).toBe('connected');
    expect(central.manager.getSessions()).toHaveLength(1);

    const payload = bytesOf(10, 4);
    await peripheral.manager.send(A_ID, APP_TYPE, payload);
    expect(central.rec.messages).toHaveLength(1);
    expect(Array.from(central.rec.messages[0].message.payload)).toEqual(Array.from(payload));
  });

  it('reports an envelope from an unsupported version rather than surfacing it', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    // Version 2 in the high nibble of byte 0.
    await peripheral.transport.send(A_ID, Uint8Array.from([0x20, APP_TYPE, 9, 0, 0, 0, 42]));

    expect(central.rec.errors).toHaveLength(1);
    expect(central.rec.errors[0].code).toBe('internal');
    expect(central.rec.messages).toEqual([]);
    expect(central.manager.getSessions()).toHaveLength(1);
  });

  it('drops traffic addressed to a link the receiver has already torn down', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);
    // Only the receiving end lets go, so the sender still believes it has a link.
    central.transport.teardown(B_ID, 'remote');

    await peripheral.transport.send(A_ID, encodeGattMessage({ type: APP_TYPE, messageId: 1 }));

    expect(central.raw).toEqual([]);
    expect(central.rec.messages).toEqual([]);
    expect(central.rec.errors).toEqual([]);
  });

  it('rejects a transport send once both ends have torn the link down', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);
    await central.manager.close(B_ID);

    await expectGattError(
      peripheral.transport.send(A_ID, encodeGattMessage({ type: APP_TYPE, messageId: 1 })),
      'not_connected',
    );
  });
});

/* ------------------------------------------------------------------ *
 * Transport-level message types
 * ------------------------------------------------------------------ */

describe('transport-level message types', () => {
  it('marks the session greeted and acknowledges a Hello', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    expect(peripheral.manager.getSession(A_ID)?.greeted).toBe(false);

    const helloId = await central.manager.sendHello(B_ID);

    expect(peripheral.manager.getSession(A_ID)?.greeted).toBe(true);
    expect(central.raw).toHaveLength(1);
    const ack = decodeGattMessage(central.raw[0]);
    expect(ack.type).toBe(GattMessageType.Ack);
    expect(ack.messageId).toBe(helloId);
    expect(ack.payload.length).toBe(0);
  });

  it('lets a Hello reach the application while its Ack does not', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await central.manager.sendHello(B_ID, bytesOf(3, 8));

    expect(peripheral.rec.messages).toHaveLength(1);
    expect(peripheral.rec.messages[0].message.type).toBe(GattMessageType.Hello);
    expect(peripheral.rec.messages[0].message.known).toBe(true);
    // The acknowledgement travelled back but was consumed by the session layer.
    expect(central.rec.messages).toEqual([]);
  });

  it('answers a Ping with a Pong and surfaces neither', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const pingId = await central.manager.send(B_ID, GattMessageType.Ping);

    expect(peripheral.rec.messages).toEqual([]);
    expect(central.rec.messages).toEqual([]);
    expect(central.raw).toHaveLength(1);
    const pong = decodeGattMessage(central.raw[0]);
    expect(pong.type).toBe(GattMessageType.Pong);
    expect(pong.messageId).toBe(pingId);
  });

  it('never surfaces an Ack to the application', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await peripheral.transport.send(
      A_ID,
      encodeGattMessage({ type: GattMessageType.Ack, messageId: 31 }),
    );

    expect(central.raw).toHaveLength(1);
    expect(central.rec.messages).toEqual([]);
    expect(central.rec.errors).toEqual([]);
  });

  it('never surfaces a Pong to the application', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await peripheral.transport.send(
      A_ID,
      encodeGattMessage({ type: GattMessageType.Pong, messageId: 31 }),
    );

    expect(central.raw).toHaveLength(1);
    expect(central.rec.messages).toEqual([]);
    expect(central.rec.errors).toEqual([]);
  });

  it('surfaces a type this build does not know with known false', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const payload = bytesOf(7, 5);
    await central.manager.send(B_ID, 0x7f, payload);

    expect(peripheral.rec.messages).toHaveLength(1);
    const message = peripheral.rec.messages[0].message;
    expect(message.type).toBe(0x7f);
    expect(message.known).toBe(false);
    expect(message.version).toBe(1);
    expect(message.flags).toBe(0);
    expect(Array.from(message.payload)).toEqual(Array.from(payload));
  });

  it('allocates a fresh message id for every send on a link', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const first = await central.manager.send(B_ID, APP_TYPE);
    const second = await central.manager.send(B_ID, APP_TYPE);

    expect(second).toBe(first + 1);
    expect(peripheral.rec.messages.map((m) => m.message.messageId)).toEqual([first, second]);
  });
});

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

describe('manager lifecycle', () => {
  it('rejects an in-flight open and clears the sessions on stop()', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    const stalling = createEndpoint({ deviceId: C_ID });
    await connectPair(central, peripheral);
    await stalling.transport.startPeripheral();
    InMemoryGattTransport.pair(central.transport, stalling.transport);

    central.transport.faults.stallConnect = true;
    const attempt = central.manager.open(C_ID);
    const settled = expectGattError(attempt, 'not_connected');
    expect(central.manager.pendingCount).toBe(1);

    await central.manager.stop();

    const error = await settled;
    expect(error.message).toContain('abandoned on shutdown');
    expect(central.manager.getSessions()).toEqual([]);
    expect(central.manager.pendingCount).toBe(0);
  });

  it('shuts the transport down on stop()', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await central.manager.stop();

    expect(central.transport.getPeers()).toEqual([]);
    expect(central.transport.isPeripheralUp).toBe(false);
    await expectGattError(central.transport.send(B_ID, Uint8Array.from([1])), 'unavailable');
    // The far side learned its peer went away.
    expect(peripheral.rec.closed).toEqual([{ deviceId: A_ID, reason: 'remote' }]);
  });

  it('stops delivering session events after stop()', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    await central.manager.stop();

    expect(central.rec.closed).toEqual([]);
    await expectGattError(central.manager.send(B_ID, APP_TYPE), 'not_connected');
  });

  it('does not stack subscribers when start() is called twice', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    central.manager.start();
    central.manager.start();

    await connectPair(central, peripheral);
    await peripheral.manager.send(A_ID, APP_TYPE, bytesOf(4, 3));

    expect(central.rec.opened).toHaveLength(1);
    expect(central.rec.messages).toHaveLength(1);
  });

  it('stops delivery to a listener that unsubscribes', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });
    await connectPair(central, peripheral);

    const seen: number[] = [];
    const unsubscribe = central.manager.subscribe({
      onMessage: (_deviceId, message) => {
        seen.push(message.messageId);
      },
    });

    const first = await peripheral.manager.send(A_ID, APP_TYPE, bytesOf(3, 1));
    expect(seen).toEqual([first]);

    unsubscribe();
    await peripheral.manager.send(A_ID, APP_TYPE, bytesOf(3, 2));

    expect(seen).toEqual([first]);
    // The recorder attached at construction is unaffected.
    expect(central.rec.messages).toHaveLength(2);
  });

  it('rejects a send to a device with no session', async () => {
    const central = createEndpoint({ deviceId: A_ID });

    const error = await expectGattError(
      central.manager.send('nobody-at-all', APP_TYPE, bytesOf(2)),
      'not_connected',
    );

    expect(error.message).toContain('nobody-at-all');
  });

  it('reports the link state the transport holds', async () => {
    const central = createEndpoint({ deviceId: A_ID });
    const peripheral = createEndpoint({ deviceId: B_ID });

    expect(central.manager.getLinkState(B_ID)).toBe('idle');
    await connectPair(central, peripheral);
    expect(central.manager.getLinkState(B_ID)).toBe('connected');
  });
});
