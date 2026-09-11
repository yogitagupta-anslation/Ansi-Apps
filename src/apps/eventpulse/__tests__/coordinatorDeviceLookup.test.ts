/**
 * Finding the live link for a person you are already connected to.
 *
 * This is the lookup the Connection Space needs, and its absence is what made a
 * healthy link invisible. Measured on two emulators: the BLE link from a
 * successful connect was still up sixteen minutes later — `Connected devices:
 * 1`, no disconnect anywhere in the buffer, same process — while Chat showed
 * "Out of range", because nothing outside the coordinator could map the
 * person back to the device they were reachable on.
 *
 * Nothing is mocked that matters: a real `LocalDatabase`, a real
 * `ConnectionService`, a real `BlockService`, a real `GattSessionManager` over
 * a paired `InMemoryGattTransport`. Every byte asserted here was framed,
 * fragmented at a 23-byte MTU and reassembled, exactly as on a radio.
 */

import { ConnectionRequestCoordinator } from '../connections/ConnectionRequestCoordinator';
import { ConnectionService } from '../connections/ConnectionService';
import type { ConnectionCard } from '../connections/ConnectionProtocol';
import { BlockService } from '../security/BlockService';
import { ATT_DEFAULT_MTU, GattSessionManager, InMemoryGattTransport } from '../bluetooth/gatt';
import { LocalDatabase, MemoryStorageAdapter } from '../storage/LocalDatabase';
import type { EventPulseApi } from '../api/ApiClient';
import type { EventId, PeerId, ProfileId } from '../types';

const EVENT_ID: EventId = 'evt-lookup';

const A_DEVICE = 'device-ada';
const B_DEVICE = 'device-grace';
const A_PROFILE: ProfileId = 'ep_ADA';
const B_PROFILE: ProfileId = 'ep_GRACE';
const A_PEER: PeerId = 'peer-ada-1';
const B_PEER: PeerId = 'peer-grace-1';

const A_CARD: ConnectionCard = { profileId: A_PROFILE, name: 'Ada Lovelace', role: 'Analyst' };
const B_CARD: ConnectionCard = { profileId: B_PROFILE, name: 'Grace Hopper', role: 'Rear Admiral' };

let now = 1_000;
const clock = () => now;

/**
 * An API that throws on everything this path must not touch.
 *
 * `listConnections` resolves empty because `ConnectionService.load` calls it;
 * the block/report calls resolve because `BlockService` awaits them. Anything
 * else throwing is the point: a lookup that quietly grew a network dependency
 * fails loudly here instead of passing on a stub.
 */
function makeApi(): EventPulseApi {
  const unused = (name: string) => () => {
    throw new Error(`EventPulseApi.${name} must not be on the device-lookup path`);
  };
  return new Proxy({} as EventPulseApi, {
    get: (_target, prop: string) => {
      if (prop === 'listConnections') return async () => [];
      if (prop === 'block' || prop === 'unblock' || prop === 'report') return async () => undefined;
      return unused(prop);
    },
  });
}

interface Phone {
  coordinator: ConnectionRequestCoordinator;
  sessions: GattSessionManager;
  transport: InMemoryGattTransport;
  connections: ConnectionService;
  blocks: BlockService;
}

async function makePhone(
  deviceId: string,
  card: ConnectionCard,
  radar: Map<ProfileId, PeerId>,
  advertisedPeerId: PeerId,
): Promise<Phone> {
  const db = new LocalDatabase(new MemoryStorageAdapter());
  await db.open();
  const api = makeApi();
  const connections = new ConnectionService({ db, api });
  const blocks = new BlockService(db, api);
  await connections.load(EVENT_ID);
  await blocks.load();

  const transport = new InMemoryGattTransport({
    deviceId,
    mtu: ATT_DEFAULT_MTU,
    // The advertised local name IS this phone's current peer id, and the clock
    // must be the coordinator's: discovery is rejected as stale if the two
    // disagree about what time it is.
    displayName: advertisedPeerId,
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
    myCard: () => card,
    acceptsConnectionRequests: () => true,
    currentPeerIdFor: (profileId) => radar.get(profileId) ?? null,
    newRequestId: () => `${deviceId}-req-${++requestCounter}`,
  });

  sessions.start();
  await coordinator.start(EVENT_ID);

  return { coordinator, sessions, transport, connections, blocks };
}

/** Two phones that can see and reach each other. */
async function makePair(): Promise<{ a: Phone; b: Phone }> {
  const radarA = new Map<ProfileId, PeerId>([[B_PROFILE, B_PEER]]);
  const radarB = new Map<ProfileId, PeerId>([[A_PROFILE, A_PEER]]);

  const a = await makePhone(A_DEVICE, A_CARD, radarA, A_PEER);
  const b = await makePhone(B_DEVICE, B_CARD, radarB, B_PEER);
  InMemoryGattTransport.pair(a.transport, b.transport);

  // Both hosting and both scanning: correlation matches a radar peer against
  // the local name in the other phone's advertisement.
  await a.transport.startPeripheral();
  await b.transport.startPeripheral();
  await a.transport.startScan();
  await b.transport.startScan();
  await settle();

  return { a, b };
}

async function settle(): Promise<void> {
  // The coordinator handles transport callbacks asynchronously, so a message
  // that has physically arrived may still be a few microtasks from being
  // recorded. This drains them; it never waits.
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/* ------------------------------------------------------------------ *
 * 1 + 2. The accessor itself
 * ------------------------------------------------------------------ */

describe('deviceFor', () => {
  it('returns null for someone we have never dialled', () => {
    const empty = new ConnectionRequestCoordinator({
      sessions: {} as unknown as GattSessionManager,
      connections: {} as unknown as ConnectionService,
      blocks: {} as unknown as BlockService,
      db: new LocalDatabase(new MemoryStorageAdapter()),
      now: clock,
      myCard: () => A_CARD,
      acceptsConnectionRequests: () => true,
      currentPeerIdFor: () => null,
      newRequestId: () => 'r1',
    });

    expect(empty.deviceFor(B_PROFILE)).toBeNull();
  });

  it('returns the device once we have dialled that person', async () => {
    const { a } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();

    expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
  });

  it('still returns null for a different person on the same phone', async () => {
    const { a } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();

    expect(a.coordinator.deviceFor('ep_SOMEONE_ELSE')).toBeNull();
  });

  it('does not mutate anything it reads', async () => {
    // A lookup that quietly rewrote the mapping would be a second source of
    // truth wearing an accessor's clothes.
    const { a } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();

    const first = a.coordinator.deviceFor(B_PROFILE);
    const second = a.coordinator.deviceFor(B_PROFILE);
    a.coordinator.deviceFor('ep_NOBODY');
    const third = a.coordinator.deviceFor(B_PROFILE);

    expect(first).toBe(B_DEVICE);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

/* ------------------------------------------------------------------ *
 * 3 + 4. The case chat actually needs
 * ------------------------------------------------------------------ */

describe('an accepted connection', () => {
  it('resolves the device on the side that dialled out', async () => {
    /*
     * The failing case exactly. The dialler never receives an
     * `onIncomingRequest`, so every mapping rebuilt from public events is
     * blind to this link — while the coordinator has known the device since
     * before the radio was touched.
     */
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
  });

  it('resolves the device on the side that accepted', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
    expect(b.coordinator.deviceFor(A_PROFILE)).toBe(A_DEVICE);
  });

  it('keeps resolving while the link stays up', async () => {
    // Nothing about opening a screen should change the answer.
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    now += 60_000;
    await settle();

    expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
    expect(a.sessions.getLinkState(B_DEVICE)).toBe('connected');
  });

  it('stops resolving once the link is closed', async () => {
    // The honest half: when the link really is gone, say so.
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    await a.sessions.close(B_DEVICE);
    await settle();

    expect(a.sessions.getLinkState(B_DEVICE)).not.toBe('connected');
  });
});

/* ------------------------------------------------------------------ *
 * 5. Nothing reached the network
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 6. The forward lookup: which person a link belongs to
 * ------------------------------------------------------------------ */

/*
 * The direction chat receives on. A message arrives naming a deviceId and
 * nothing else, and until this existed `ConversationService.onIncoming`
 * resolved null and dropped it — measured on two emulators, where the
 * accepting phone logged the inbound bytes and rendered nothing.
 *
 * The map is written EARLIER than attribution is actually decided: on first
 * sight of a request, before the block check and before the privacy check, and
 * again on an outgoing dial before the radio is touched. So the accessor guards
 * on both sides — never a provisional key, never an unsettled exchange.
 */

describe('profileForDevice', () => {
  it('returns null for a device we have never seen', async () => {
    const { a } = await makePair();
    expect(a.coordinator.profileForDevice('device-nobody')).toBeNull();
  });

  it('resolves the person on the side that dialled out', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.connections.stateFor(B_PROFILE)).toBe('connected');
    expect(a.coordinator.profileForDevice(B_DEVICE)).toBe(B_PROFILE);
  });

  it('resolves the person on the side that accepted', async () => {
    // The failing side in the field: on mutual consent the accepting phone
    // never emits an `onIncomingRequest` for anything else to rebuild from.
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(b.connections.stateFor(A_PROFILE)).toBe('connected');
    expect(b.coordinator.profileForDevice(A_DEVICE)).toBe(A_PROFILE);
  });

  it('round-trips with deviceFor on both sides', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    const deviceA = a.coordinator.deviceFor(B_PROFILE);
    expect(deviceA).toBe(B_DEVICE);
    expect(a.coordinator.profileForDevice(deviceA as string)).toBe(B_PROFILE);

    const deviceB = b.coordinator.deviceFor(A_PROFILE);
    expect(deviceB).toBe(A_DEVICE);
    expect(b.coordinator.profileForDevice(deviceB as string)).toBe(A_PROFILE);
  });

  it('does not attribute a link whose exchange has not settled', async () => {
    // A dial writes the mapping before the radio is touched. Answering from it
    // then would hand chat someone who has not accepted.
    const { a } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();

    expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
    expect(a.coordinator.profileForDevice(B_DEVICE)).toBeNull();
  });

  it('does not attribute a link to a blocked person', async () => {
    /*
     * The mapping is written at line 613, the block check runs at 617. So B's
     * map genuinely holds A after A dials — and routing chat to it would put a
     * blocked person's messages on screen.
     */
    const { a, b } = await makePair();
    await b.blocks.block(A_PROFILE);
    await a.coordinator.request(B_PROFILE);
    await settle();

    expect(b.connections.stateFor(A_PROFILE)).not.toBe('connected');
    expect(b.coordinator.profileForDevice(A_DEVICE)).toBeNull();
  });

  it('stops attributing once the link is closed', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.coordinator.profileForDevice(B_DEVICE)).toBe(B_PROFILE);

    await a.sessions.close(B_DEVICE);
    await settle();

    expect(a.coordinator.profileForDevice(B_DEVICE)).toBeNull();
  });

  it('never reports a provisional key as a person', async () => {
    /*
     * `peer:<PEERID>` is scaffolding for someone not yet identified. Returned
     * here it would become a conversation key, and ConversationService persists
     * by key — writing a durable row named after an id that stops meaning
     * anything at the next epoch.
     */
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    const resolved = a.coordinator.profileForDevice(B_DEVICE);
    expect(resolved).not.toBeNull();
    expect(String(resolved).startsWith('peer:')).toBe(false);
  });

  it('does not mutate anything it reads', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    const first = a.coordinator.profileForDevice(B_DEVICE);
    a.coordinator.profileForDevice('device-nobody');
    const second = a.coordinator.profileForDevice(B_DEVICE);

    expect(first).toBe(B_PROFILE);
    expect(second).toBe(first);
    expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
  });

  it('resolves a person without any network call', async () => {
    const globals = globalThis as { fetch?: unknown };
    const original = globals.fetch;
    globals.fetch = () => {
      throw new Error('the forward lookup must never reach the network');
    };

    try {
      const { a, b } = await makePair();
      await a.coordinator.request(B_PROFILE);
      await settle();
      await b.coordinator.accept(A_PROFILE);
      await settle();

      expect(b.coordinator.profileForDevice(A_DEVICE)).toBe(A_PROFILE);
    } finally {
      globals.fetch = original;
    }
  });
});

/* ------------------------------------------------------------------ *
 * 7. Naming a peer the directory never resolved
 * ------------------------------------------------------------------ */

/*
 * The lookup the radar needs, and the absence of which made Connect misbehave.
 *
 * Offline a radar entry is a rotating peer id and nothing else, so the map
 * screen could not ask anything about that person and fell back to "no
 * connection" — which rendered an enabled Connect for someone already
 * connected. Every tap then threw `already_connected`, reported failure, and
 * left the sheet open on an error about a request that had already gone out.
 */

describe('profileForPeer', () => {
  it('returns null for a peer nobody has connected to', async () => {
    const { a } = await makePair();
    expect(a.coordinator.profileForPeer(B_PEER)).toBeNull();
  });

  it('names the person once the connection has settled', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.coordinator.profileForPeer(B_PEER)).toBe(B_PROFILE);
  });

  it('stays null while the request is still only pending', async () => {
    // Pending is the provisional key's job; this accessor speaks only for
    // settled connections, so the two cannot both claim the same exchange.
    const { a } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();

    expect(a.coordinator.profileForPeer(B_PEER)).toBeNull();
  });

  it('returns null for a peer id the radar cannot currently see', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.coordinator.profileForPeer('peer-nobody')).toBeNull();
  });

  it('goes quiet again once the discovery goes stale', async () => {
    /*
     * It answers from what the radar can see *now*. When they walk away the
     * peer id stops being discoverable and this stops claiming to know them,
     * rather than naming someone from a reading minutes old.
     */
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.coordinator.profileForPeer(B_PEER)).toBe(B_PROFILE);

    now += 60_000;
    expect(a.coordinator.profileForPeer(B_PEER)).toBeNull();
  });

  it('is case-insensitive about the peer id, as the radar is', async () => {
    const { a, b } = await makePair();
    await a.coordinator.request(B_PROFILE);
    await settle();
    await b.coordinator.accept(A_PROFILE);
    await settle();

    expect(a.coordinator.profileForPeer(B_PEER.toUpperCase())).toBe(B_PROFILE);
  });
});

describe('offline', () => {
  it('resolves a device without any network call', async () => {
    /*
     * The eventpulse project runs on bare node with no react-native and no
     * mocks, so `fetch` here would be the real one. Replacing it with a
     * throwing stub turns an accidental network call into a failed test rather
     * than a silent dependency — and `makeApi` throws on every method that is
     * not on this path, so a backend creeping in fails twice over.
     */
    const globals = globalThis as { fetch?: unknown };
    const original = globals.fetch;
    globals.fetch = () => {
      throw new Error('the device lookup must never reach the network');
    };

    try {
      const { a, b } = await makePair();
      await a.coordinator.request(B_PROFILE);
      await settle();
      await b.coordinator.accept(A_PROFILE);
      await settle();

      expect(a.coordinator.deviceFor(B_PROFILE)).toBe(B_DEVICE);
    } finally {
      globals.fetch = original;
    }
  });
});
