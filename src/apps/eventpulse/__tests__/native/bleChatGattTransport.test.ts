/**
 * The BleChat-backed GATT transport, against fake native modules.
 *
 * Every dependency this adapter has is injected, so these tests exercise the
 * part that is genuinely ours — addressing, framing, link bookkeeping and the
 * translation between BleChat's native events and EventPulse's transport
 * events. The Kotlin is BleChat's and is not under test here; what is under
 * test is whether we call it correctly and interpret what it says.
 *
 * Nothing here proves the radio works. That needs two physical phones, and is
 * called out as such in the report rather than implied by a green run.
 */

import {
  BleChatGattTransport,
  type BleChatTransportDeps,
  type GattScanner,
  type NativeEvents,
  type ScannedDevice,
} from '../../bluetooth/gatt/transports/BleChatGattTransport';
import {
  GATT_CHAR_RX_UUID,
  GATT_CHAR_TX_UUID,
  GATT_SERVICE_UUID,
} from '../../bluetooth/gatt/GattProfile';
import { GattReassembler } from '../../bluetooth/gatt/GattFraming';
import type { GattDiscovery, GattPeer } from '../../bluetooth/gatt/GattTransport';

/* ------------------------------------------------------------------ *
 * Fakes
 * ------------------------------------------------------------------ */

const ADDRESS = 'AA:BB:CC:DD:EE:FF';
const CENTRAL_DEVICE = `c:${ADDRESS}`;
const CENTRAL_ID = '11:22:33:44:55:66';
const PERIPHERAL_DEVICE = `p:${CENTRAL_ID}`;

/** A native event source that lets a test push events by name. */
class FakeEvents implements NativeEvents {
  private readonly handlers = new Map<string, ((payload: unknown) => void)[]>();
  removed = 0;

  addListener<T>(event: string, handler: (payload: T) => void): { remove(): void } {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as (payload: unknown) => void);
    this.handlers.set(event, list);
    return {
      remove: () => {
        this.removed += 1;
      },
    };
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  listenerCount(event: string): number {
    return (this.handlers.get(event) ?? []).length;
  }
}

class FakeScanner implements GattScanner {
  adapterState = 'PoweredOn';
  scanning = false;
  filters: string[] | null = null;
  stopped = 0;
  private listener: ((e: { message: string } | null, d: ScannedDevice | null) => void) | null = null;

  async state(): Promise<string> {
    return this.adapterState;
  }

  startDeviceScan(
    serviceUuids: string[] | null,
    _options: { allowDuplicates?: boolean } | null,
    listener: (error: { message: string } | null, device: ScannedDevice | null) => void,
  ): void {
    this.scanning = true;
    this.filters = serviceUuids;
    this.listener = listener;
  }

  stopDeviceScan(): void {
    this.scanning = false;
    this.stopped += 1;
  }

  see(device: ScannedDevice): void {
    this.listener?.(null, device);
  }

  fail(message: string): void {
    this.listener?.({ message }, null);
  }
}

interface Harness {
  transport: BleChatGattTransport;
  client: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    write: jest.Mock;
  };
  peripheral: {
    getCapabilities: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    send: jest.Mock;
  };
  clientEvents: FakeEvents;
  peripheralEvents: FakeEvents;
  scanner: FakeScanner;
  events: {
    discovered: GattDiscovery[];
    connected: GattPeer[];
    disconnected: { deviceId: string; reason: string }[];
    messages: { deviceId: string; payload: Uint8Array }[];
    mtus: { deviceId: string; mtu: number }[];
    errors: string[];
  };
}

function makeHarness(overrides: Partial<BleChatTransportDeps> = {}): Harness {
  const client = {
    connect: jest.fn(async () => ({ address: ADDRESS, mtu: 185, rxProperties: 0x08 })),
    disconnect: jest.fn(async () => true),
    write: jest.fn(async () => true),
  };
  const peripheral = {
    getCapabilities: jest.fn(async () => ({
      hasBluetooth: true,
      bluetoothEnabled: true,
      supportsMultipleAdvertisement: true,
      hasAdvertiser: true,
      isAdvertising: false,
      sdkInt: 34,
      missingPermissions: [] as string[],
    })),
    start: jest.fn(async () => ({ advertising: true })),
    stop: jest.fn(async () => true),
    send: jest.fn(async () => true),
  };
  const clientEvents = new FakeEvents();
  const peripheralEvents = new FakeEvents();
  const scanner = new FakeScanner();

  const transport = new BleChatGattTransport({
    client,
    peripheral,
    clientEvents,
    peripheralEvents,
    scanner,
    ...overrides,
  } as BleChatTransportDeps);

  const events: Harness['events'] = {
    discovered: [],
    connected: [],
    disconnected: [],
    messages: [],
    mtus: [],
    errors: [],
  };

  transport.subscribe({
    onDiscovery: (d) => events.discovered.push(d),
    onPeerConnected: (p) => events.connected.push(p),
    onPeerDisconnected: (deviceId, reason) => events.disconnected.push({ deviceId, reason }),
    onMessage: (deviceId, payload) => events.messages.push({ deviceId, payload }),
    onMtuChanged: (deviceId, mtu) => events.mtus.push({ deviceId, mtu }),
    onError: (e) => events.errors.push(e.code),
  });

  return { transport, client, peripheral, clientEvents, peripheralEvents, scanner, events };
}

/** Everything the native client would hand back for one written frame. */
function framesWrittenTo(client: Harness['client']): Uint8Array[] {
  return client.write.mock.calls.map(([, base64]) => {
    const binary = Buffer.from(base64 as string, 'base64');
    return new Uint8Array(binary);
  });
}

/* ------------------------------------------------------------------ *
 * 1. Connect
 * ------------------------------------------------------------------ */

describe('connect', () => {
  it('dials the stripped address with EventPulse UUIDs, not BleChat s', async () => {
    // The entire reason this adapter exists: the same native module, asked
    // about our service instead of the chat s.
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);

    expect(h.client.connect).toHaveBeenCalledWith(
      ADDRESS,
      GATT_SERVICE_UUID,
      GATT_CHAR_RX_UUID,
      GATT_CHAR_TX_UUID,
    );
  });

  it('reports the peer once the native call resolves', async () => {
    const h = makeHarness();
    const peer = await h.transport.connect(CENTRAL_DEVICE);

    expect(peer).toMatchObject({ deviceId: CENTRAL_DEVICE, role: 'central', mtu: 185 });
    expect(h.events.connected).toHaveLength(1);
  });

  it('stops scanning before dialling', async () => {
    // Scanning through a connect is a well-known source of flaky links.
    const h = makeHarness();
    await h.transport.startScan();
    await h.transport.connect(CENTRAL_DEVICE);

    expect(h.scanner.scanning).toBe(false);
  });

  it('is idempotent for a link that is already up', async () => {
    const h = makeHarness();
    const first = await h.transport.connect(CENTRAL_DEVICE);
    const second = await h.transport.connect(CENTRAL_DEVICE);

    expect(second).toBe(first);
    expect(h.client.connect).toHaveBeenCalledTimes(1);
  });

  it('refuses to dial an inbound link', async () => {
    // A `p:` handle belongs to a central that dialled us; there is nothing to
    // dial back to, and pretending otherwise would open a second link.
    const h = makeHarness();
    await expect(h.transport.connect(PERIPHERAL_DEVICE)).rejects.toMatchObject({
      code: 'not_connected',
    });
  });
});

/* ------------------------------------------------------------------ *
 * 2. Connection failure
 * ------------------------------------------------------------------ */

describe('connection failure', () => {
  it('surfaces a refused dial as connect_failed and opens no link', async () => {
    const h = makeHarness();
    h.client.connect.mockRejectedValueOnce(new Error('GATT_ERROR status 133'));

    await expect(h.transport.connect(CENTRAL_DEVICE)).rejects.toMatchObject({
      code: 'connect_failed',
    });
    expect(h.transport.getPeers()).toHaveLength(0);
    expect(h.events.connected).toHaveLength(0);
  });

  it('keeps the original reason as the cause', async () => {
    // The whole point of the native client is that a refusal arrives with the
    // framework's reason attached. Losing it here would undo that.
    const h = makeHarness();
    const underlying = new Error('write not permitted');
    h.client.connect.mockRejectedValueOnce(underlying);

    await expect(h.transport.connect(CENTRAL_DEVICE)).rejects.toMatchObject({
      cause: underlying,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 3 + 4. Service and characteristic discovery
 * ------------------------------------------------------------------ */

describe('service and characteristic discovery', () => {
  it('is complete before connect resolves', async () => {
    /*
     * There is no separate discover step to assert, and that is the point:
     * `BleClientModule.connect` discovers the service, finds RX and TX, settles
     * the MTU and subscribes before it resolves. The contract this transport
     * implements says a resolved connect means the link can carry a message, so
     * the assertion is that we do not add a second, redundant discovery pass.
     */
    const h = makeHarness();
    const peer = await h.transport.connect(CENTRAL_DEVICE);

    expect(h.client.connect).toHaveBeenCalledTimes(1);
    expect(peer.mtu).toBe(185);
    // `connected` IS the usable state; GattLink has no separate `ready`.
    expect(h.transport.getLinkState(CENTRAL_DEVICE)).toBe('connected');
  });

  it('reads the RX write type the far side actually reported', async () => {
    // 0x08 is WRITE, 0x04 is WRITE_NO_RESPONSE. Writing with a response to a
    // characteristic that does not support one fails on the radio, not here.
    const h = makeHarness();
    h.client.connect.mockResolvedValueOnce({ address: ADDRESS, mtu: 23, rxProperties: 0x04 });

    await h.transport.connect(CENTRAL_DEVICE);
    await h.transport.send(CENTRAL_DEVICE, new Uint8Array([1, 2, 3]));

    expect(h.client.write).toHaveBeenCalledWith(ADDRESS, expect.any(String), false);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Write
 * ------------------------------------------------------------------ */

describe('write', () => {
  it('sends through the native client for an outbound link', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);
    await h.transport.send(CENTRAL_DEVICE, new Uint8Array([9, 9, 9]));

    expect(h.client.write).toHaveBeenCalledTimes(1);
    expect(h.peripheral.send).not.toHaveBeenCalled();
  });

  it('notifies through the peripheral for an inbound link', async () => {
    // The same `send()` has to reach two different native modules depending on
    // who dialled whom. Getting this backwards is silent: nothing arrives.
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });

    await h.transport.send(PERIPHERAL_DEVICE, new Uint8Array([7, 7]));

    expect(h.peripheral.send).toHaveBeenCalledTimes(1);
    expect(h.client.write).not.toHaveBeenCalled();
  });

  it('refuses to send with no live link', async () => {
    const h = makeHarness();
    await expect(h.transport.send(CENTRAL_DEVICE, new Uint8Array([1]))).rejects.toMatchObject({
      code: 'not_connected',
    });
  });

  it('reports a failed write rather than losing it', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);
    h.client.write.mockRejectedValueOnce(new Error('refused'));

    await expect(h.transport.send(CENTRAL_DEVICE, new Uint8Array([1]))).rejects.toMatchObject({
      code: 'write_failed',
    });
  });
});

/* ------------------------------------------------------------------ *
 * 6. Notification / inbound data
 * ------------------------------------------------------------------ */

describe('notifications', () => {
  it('reassembles a native notification into one whole message', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);

    // Round-trip a real message through the real framing: send it, capture the
    // frames the native client was given, and feed those back as notifications.
    const message = new Uint8Array(Array.from({ length: 40 }, (_v, i) => i));
    await h.transport.send(CENTRAL_DEVICE, message);
    const frames = framesWrittenTo(h.client);
    h.client.write.mockClear();

    for (const frame of frames) {
      h.clientEvents.emit('bleClientData', {
        address: ADDRESS,
        base64: Buffer.from(frame).toString('base64'),
      });
    }

    expect(h.events.messages).toHaveLength(1);
    expect(Array.from(h.events.messages[0].payload)).toEqual(Array.from(message));
    expect(h.events.messages[0].deviceId).toBe(CENTRAL_DEVICE);
  });

  it('routes peripheral data to the inbound link', async () => {
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });

    const message = new Uint8Array([5, 6, 7]);
    await h.transport.send(PERIPHERAL_DEVICE, message);
    const [, base64] = h.peripheral.send.mock.calls[0] as [string, string];

    h.peripheralEvents.emit('BlePeripheral:data', { centralId: CENTRAL_ID, data: base64 });

    expect(h.events.messages).toHaveLength(1);
    expect(h.events.messages[0].deviceId).toBe(PERIPHERAL_DEVICE);
  });

  it('discards a malformed frame without taking the link down', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);

    h.clientEvents.emit('bleClientData', {
      address: ADDRESS,
      base64: Buffer.from([0xff, 0xff, 0xff]).toString('base64'),
    });

    expect(h.events.messages).toHaveLength(0);
    expect(h.events.errors).toContain('internal');
    // `connected` IS the usable state; GattLink has no separate `ready`.
    expect(h.transport.getLinkState(CENTRAL_DEVICE)).toBe('connected');
  });
});

/* ------------------------------------------------------------------ *
 * 7. Disconnect and reconnect
 * ------------------------------------------------------------------ */

describe('disconnect', () => {
  it('tells the native client and reports the reason as local', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);
    await h.transport.disconnect(CENTRAL_DEVICE);

    expect(h.client.disconnect).toHaveBeenCalledWith(ADDRESS);
    expect(h.events.disconnected).toEqual([{ deviceId: CENTRAL_DEVICE, reason: 'local' }]);
    expect(h.transport.getPeers()).toHaveLength(0);
  });

  it('reports a native drop as remote', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);

    h.clientEvents.emit('bleClientDisconnected', { address: ADDRESS, status: 19 });

    expect(h.events.disconnected).toEqual([{ deviceId: CENTRAL_DEVICE, reason: 'remote' }]);
  });

  it('reconnects cleanly after a drop', async () => {
    // The old transport could not do this: a stale entry blocked the same phone
    // from ever reconnecting.
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);
    h.clientEvents.emit('bleClientDisconnected', { address: ADDRESS, status: 19 });

    const peer = await h.transport.connect(CENTRAL_DEVICE);

    expect(peer.deviceId).toBe(CENTRAL_DEVICE);
    expect(h.client.connect).toHaveBeenCalledTimes(2);
    expect(h.transport.getPeers()).toHaveLength(1);
  });

  it('drops an inbound link when the central goes away', async () => {
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });
    h.peripheralEvents.emit('BlePeripheral:centralDisconnected', { centralId: CENTRAL_ID });

    expect(h.events.disconnected).toEqual([{ deviceId: PERIPHERAL_DEVICE, reason: 'remote' }]);
  });

  it('is silent about a link that was never open', async () => {
    const h = makeHarness();
    await expect(h.transport.disconnect(CENTRAL_DEVICE)).resolves.toBeUndefined();
    expect(h.events.disconnected).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * 8. MTU and fragmentation
 * ------------------------------------------------------------------ */

describe('MTU and fragmentation', () => {
  it('fragments to the negotiated MTU, once', async () => {
    /*
     * The double-fragmentation guard. BleChat fragments inside its own
     * `BLETransport`, which this adapter does not use; EventPulse's framing is
     * the only layer in this path. If a second one ever appeared, these frames
     * would not reassemble back into the original message.
     */
    const h = makeHarness();
    h.client.connect.mockResolvedValueOnce({ address: ADDRESS, mtu: 23, rxProperties: 0x08 });
    await h.transport.connect(CENTRAL_DEVICE);

    const message = new Uint8Array(120).fill(3);
    await h.transport.send(CENTRAL_DEVICE, message);
    const frames = framesWrittenTo(h.client);

    expect(frames.length).toBeGreaterThan(1);

    const reassembler = new GattReassembler();
    let out: Uint8Array | null = null;
    for (const frame of frames) out = reassembler.push(frame) ?? out;
    expect(out && Array.from(out)).toEqual(Array.from(message));
  });

  it('sends a small message as a single frame at a large MTU', async () => {
    const h = makeHarness();
    await h.transport.connect(CENTRAL_DEVICE);
    await h.transport.send(CENTRAL_DEVICE, new Uint8Array([1, 2, 3, 4]));

    expect(framesWrittenTo(h.client)).toHaveLength(1);
  });

  it('reports an MTU the peripheral negotiates after the link is up', async () => {
    // The server side is not told the MTU at connect time; it arrives later as
    // an event, and the fragment size has to follow it.
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });
    h.peripheralEvents.emit('BlePeripheral:mtu', { centralId: CENTRAL_ID, mtu: 247 });

    expect(h.events.mtus).toContainEqual({ deviceId: PERIPHERAL_DEVICE, mtu: 247 });
    expect(h.transport.getPeer(PERIPHERAL_DEVICE)?.mtu).toBe(247);
  });
});

/* ------------------------------------------------------------------ *
 * 9. Advertising and discovery
 * ------------------------------------------------------------------ */

describe('advertising', () => {
  it('publishes EventPulse UUIDs and never renames the adapter', async () => {
    /*
     * The previous transport put the peer id in the phone's Bluetooth adapter
     * name, which needs BLUETOOTH_CONNECT and silently kept the old name
     * without it. Here the peer id is a parameter of the advertisement.
     */
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });

    expect(h.peripheral.start).toHaveBeenCalledWith(
      GATT_SERVICE_UUID,
      GATT_CHAR_RX_UUID,
      GATT_CHAR_TX_UUID,
      'A1B2C3D4',
      'A1B2C3D4',
      0,
    );
  });

  it('surfaces a refusal as advertise_failed', async () => {
    const h = makeHarness();
    h.peripheral.start.mockRejectedValueOnce(new Error('no advertiser'));

    await expect(h.transport.startPeripheral({ displayName: 'A1B2C3D4' })).rejects.toMatchObject({
      code: 'advertise_failed',
    });
  });

  it('reports no peripheral role when the phone has no advertiser', async () => {
    const h = makeHarness();
    h.peripheral.getCapabilities.mockResolvedValueOnce({
      hasBluetooth: true,
      bluetoothEnabled: true,
      supportsMultipleAdvertisement: false,
      hasAdvertiser: false,
      isAdvertising: false,
      sdkInt: 30,
      missingPermissions: [],
    });

    const caps = await h.transport.getCapabilities();
    expect(caps.supportsPeripheral).toBe(false);
    expect(caps.unavailableReason).toMatch(/advertiser/i);
  });
});

describe('scanning and correlation', () => {
  /** version | peerId(4) padded to 8 | interests(3) | name */
  function manufacturerPayload(peerIdHex: string): string {
    const bytes = [0xff, 0xff, 0x02];
    for (let i = 0; i < 8; i++) {
      const byte = peerIdHex.slice(i * 2, i * 2 + 2);
      bytes.push(byte ? parseInt(byte, 16) : 0);
    }
    bytes.push(0, 0, 0);
    return Buffer.from(bytes).toString('base64');
  }

  it('filters the scan on the EventPulse service', async () => {
    const h = makeHarness();
    await h.transport.startScan();
    expect(h.scanner.filters).toEqual([GATT_SERVICE_UUID]);
  });

  it('recovers the peer id from the manufacturer payload', async () => {
    // This is what replaces the adapter-name trick, and it is what
    // ConnectionRequestCoordinator matches a radar peer against.
    const h = makeHarness();
    await h.transport.startScan();
    h.scanner.see({
      id: ADDRESS,
      name: null,
      localName: null,
      rssi: -55,
      manufacturerData: manufacturerPayload('A1B2C3D4'),
    });

    expect(h.events.discovered).toHaveLength(1);
    expect(h.events.discovered[0]).toMatchObject({
      deviceId: CENTRAL_DEVICE,
      displayName: 'A1B2C3D4',
      rssi: -55,
    });
  });

  it('falls back to the advertised local name', async () => {
    // A phone still on the previous transport advertises its peer id as the
    // adapter name. It should stay findable during a rollout.
    const h = makeHarness();
    await h.transport.startScan();
    h.scanner.see({ id: ADDRESS, name: null, localName: 'DEADBEEF', manufacturerData: null });

    expect(h.events.discovered[0].displayName).toBe('DEADBEEF');
  });

  it('refuses to scan when the adapter is off', async () => {
    const h = makeHarness();
    h.scanner.adapterState = 'PoweredOff';
    await expect(h.transport.startScan()).rejects.toMatchObject({ code: 'adapter_off' });
  });

  it('surfaces a scan error', async () => {
    const h = makeHarness();
    await h.transport.startScan();
    h.scanner.fail('scan failed to start');
    expect(h.events.errors).toContain('internal');
  });
});

/* ------------------------------------------------------------------ *
 * 10 + 11. EventPulse request and accept delivery
 * ------------------------------------------------------------------ */

describe('EventPulse message delivery', () => {
  /**
   * A connection request is a real payload, not a toy one.
   *
   * The card, the note and the request id put it past a single 23-byte frame,
   * which is exactly where a fragmentation mistake would show up. These two
   * tests are the reason the adapter exists at all: they are the messages
   * Connect actually sends and receives.
   */
  const REQUEST = new Uint8Array(
    Buffer.from(
      JSON.stringify({
        t: 'req',
        requestId: 'req_abc123',
        card: { profileId: 'ep_' + 'A'.repeat(32), name: 'Ada Lovelace', role: 'Analyst' },
        note: 'We spoke about the analytical engine talk earlier.',
      }),
      'utf8',
    ),
  );

  const ACCEPT = new Uint8Array(
    Buffer.from(
      JSON.stringify({
        t: 'acc',
        requestId: 'req_abc123',
        card: { profileId: 'ep_' + 'B'.repeat(32), name: 'Grace Hopper', role: 'Rear Admiral' },
      }),
      'utf8',
    ),
  );

  it('delivers a connection request over an outbound link, intact', async () => {
    const h = makeHarness();
    h.client.connect.mockResolvedValueOnce({ address: ADDRESS, mtu: 23, rxProperties: 0x08 });
    await h.transport.connect(CENTRAL_DEVICE);

    await h.transport.send(CENTRAL_DEVICE, REQUEST);
    const frames = framesWrittenTo(h.client);

    // At the ATT floor this must have taken several frames.
    expect(frames.length).toBeGreaterThan(1);

    const reassembler = new GattReassembler();
    let received: Uint8Array | null = null;
    for (const frame of frames) received = reassembler.push(frame) ?? received;

    expect(received).not.toBeNull();
    expect(Buffer.from(received!).toString('utf8')).toBe(Buffer.from(REQUEST).toString('utf8'));
  });

  it('delivers an accept back over the inbound link, intact', async () => {
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });

    await h.transport.send(PERIPHERAL_DEVICE, ACCEPT);

    const frames = h.peripheral.send.mock.calls.map(
      ([, base64]) => new Uint8Array(Buffer.from(base64 as string, 'base64')),
    );
    const reassembler = new GattReassembler();
    let received: Uint8Array | null = null;
    for (const frame of frames) received = reassembler.push(frame) ?? received;

    expect(received).not.toBeNull();
    expect(Buffer.from(received!).toString('utf8')).toBe(Buffer.from(ACCEPT).toString('utf8'));
  });

  it('carries a request in and an accept out on the same pair of links', async () => {
    // The shape of a real exchange: they dial us, we answer.
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    h.peripheralEvents.emit('BlePeripheral:centralConnected', { centralId: CENTRAL_ID });

    // Their request arrives, framed by their transport — modelled here by
    // framing it with ours, since both sides run the same code.
    await h.transport.send(PERIPHERAL_DEVICE, REQUEST);
    const outbound = h.peripheral.send.mock.calls.map(([, b64]) => b64 as string);
    h.peripheral.send.mockClear();
    for (const base64 of outbound) {
      h.peripheralEvents.emit('BlePeripheral:data', { centralId: CENTRAL_ID, data: base64 });
    }

    expect(h.events.messages).toHaveLength(1);
    expect(Buffer.from(h.events.messages[0].payload).toString('utf8')).toContain('req_abc123');

    await h.transport.send(PERIPHERAL_DEVICE, ACCEPT);
    expect(h.peripheral.send).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

describe('shutdown', () => {
  it('closes links, stops both roles and releases the native listeners', async () => {
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await h.transport.startScan();
    await h.transport.connect(CENTRAL_DEVICE);

    await h.transport.shutdown();

    expect(h.transport.getPeers()).toHaveLength(0);
    expect(h.peripheral.stop).toHaveBeenCalled();
    expect(h.scanner.scanning).toBe(false);
    expect(h.clientEvents.removed + h.peripheralEvents.removed).toBeGreaterThan(0);
  });

  it('attaches the native listeners exactly once', async () => {
    // Twice would deliver every frame twice, which reassembly would report as a
    // duplicate fragment rather than as the wiring mistake it is.
    const h = makeHarness();
    await h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await h.transport.connect(CENTRAL_DEVICE);

    expect(h.clientEvents.listenerCount('bleClientData')).toBe(1);
    expect(h.peripheralEvents.listenerCount('BlePeripheral:data')).toBe(1);
  });
});
