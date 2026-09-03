/**
 * Bluetooth being turned off underneath a running conversation.
 *
 * This is not a rare edge: people toggle it from the quick-settings tray, airplane mode
 * flips it, and battery savers turn it off on their own. What must not happen is the app
 * carrying on as though the radio were still there — peers left showing "connected",
 * messages reported as sent when nothing was transmitted, or a scan that still believes
 * it is running.
 *
 * Scope, stated plainly: this drives the adapter-state callback that the OS delivers and
 * asserts OUR reaction to it. It does not simulate a radio. Whether Android actually
 * delivers that callback, and how fast, is a hardware question these tests cannot answer.
 */
import {BLECentral} from '../ble/BLECentral';
import {VirtualAir} from './support/LoopbackTransport';
import {VirtualPhone, waitFor} from './support/VirtualPhone';
import {DEFAULT_ATT_MTU} from '../config/constants';
import {toCentralLinkId} from '../utils/linkId';
import type {BluetoothState} from '../types/BLE';

/** Drive the adapter the way the OS would. */
function setAdapterState(state: string): void {
  (globalThis as unknown as {__setBleState: (s: string) => void}).__setBleState(state);
}

function resetAdapter(): void {
  (globalThis as unknown as {__bleStateListeners: Set<unknown>}).__bleStateListeners.clear();
  (globalThis as unknown as {__bleAdapterState?: string}).__bleAdapterState = 'PoweredOn';
}

describe('BLECentral reacts to the adapter being switched off', () => {
  let central: BLECentral;

  beforeEach(() => {
    resetAdapter();
    central = new BLECentral();
  });

  afterEach(() => {
    central.destroy();
  });

  it('reports the state the adapter is actually in', () => {
    central.init();
    expect(central.bluetoothState).toBe('PoweredOn');

    setAdapterState('PoweredOff');
    expect(central.bluetoothState).toBe('PoweredOff');

    setAdapterState('PoweredOn');
    expect(central.bluetoothState).toBe('PoweredOn');
  });

  it('announces every transition, so the UI cannot show a stale radio', () => {
    const seen: BluetoothState[] = [];
    central.bus.on('bluetoothState', state => seen.push(state));
    central.init();

    setAdapterState('PoweredOff');
    setAdapterState('PoweredOn');

    // Includes the initial emission, which is why the UI is correct before any change.
    expect(seen).toEqual(['PoweredOn', 'PoweredOff', 'PoweredOn']);
  });

  it('stops believing it is scanning once the radio is gone', () => {
    central.init();
    expect(central.isScanning).toBe(false);

    setAdapterState('PoweredOff');

    // A scan indicator still spinning after Bluetooth is off tells the user the app is
    // looking for people when it cannot be.
    expect(central.isScanning).toBe(false);
  });

  it('maps unauthorised and unsupported adapters to their own states', () => {
    central.init();
    setAdapterState('Unauthorized');
    expect(central.bluetoothState).toBe('Unauthorized');
    setAdapterState('Unsupported');
    expect(central.bluetoothState).toBe('Unsupported');
    // Never collapsed into a generic "off": the user needs different advice for each.
    setAdapterState('Resetting');
    expect(central.bluetoothState).toBe('Resetting');
  });
});

describe('the app when the radio disappears mid-conversation', () => {
  let air: VirtualAir;
  let phoneA: VirtualPhone;
  let phoneB: VirtualPhone;

  beforeEach(() => {
    air = new VirtualAir();
    phoneA = new VirtualPhone('deviceA', 'Phone A', air, DEFAULT_ATT_MTU);
    phoneB = new VirtualPhone('deviceB', 'Phone B', air, DEFAULT_ATT_MTU);
  });

  afterEach(() => {
    phoneA.dispose();
    phoneB.dispose();
  });

  async function connect(): Promise<void> {
    phoneB.startAdvertising();
    await phoneA.scan();
    await phoneA.peerManager.connect(toCentralLinkId('deviceB'));
    await waitFor(
      () =>
        phoneA.isConnectedTo(phoneB.peerId) && phoneB.isConnectedTo(phoneA.peerId),
      'both sides to reach connected',
    );
  }

  /**
   * Bluetooth going off is, to everything above the transport, every link dropping at
   * once. That is what this models — the same teardown BLECentral performs when the
   * adapter callback fires.
   */
  async function radioOff(phone: VirtualPhone): Promise<void> {
    for (const linkId of [...phone.transport.linkIds]) {
      phone.transport.simulateDrop(linkId);
    }
    await waitFor(
      () => phone.transport.linkIds.length === 0,
      'every link to be torn down',
    );
  }

  it('marks the peer disconnected rather than leaving it looking live', async () => {
    await connect();
    await radioOff(phoneA);

    await waitFor(
      () => !phoneA.isConnectedTo(phoneB.peerId),
      'A to stop reporting the peer as connected',
    );
    // A peer frozen at "connected" invites the user to send into a link that is gone.
    expect(phoneA.peerManager.getPeer(phoneB.peerId)?.state).not.toBe('connected');
  });

  it('queues a message written after the radio went, never claiming it was sent', async () => {
    await connect();
    await radioOff(phoneA);

    await phoneA.messages.send(phoneB.peerId, 'typed after bluetooth went off');

    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);
    const last = phoneA.conversationWith(phoneB.peerId).slice(-1)[0];
    expect(last.status).toBe('pending');
    // And it genuinely did not reach the other phone.
    expect(phoneB.conversationWith(phoneA.peerId)).toHaveLength(0);
  });

  it('discards the encryption session, so nothing can be sent on stale keys', async () => {
    await connect();
    expect(phoneA.sessions.size).toBe(1);

    await radioOff(phoneA);

    expect(phoneA.sessions.size).toBe(0);
  });

  it('delivers the backlog once Bluetooth comes back', async () => {
    await connect();
    await radioOff(phoneA);

    await phoneA.messages.send(phoneB.peerId, 'written while the radio was off');
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);

    // Radio back on: the user reconnects and the outbox drains by itself.
    await connect();
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 1,
      'the queued message to arrive after the radio returns',
    );

    expect(phoneB.conversationWith(phoneA.peerId)[0].text).toBe(
      'written while the radio was off',
    );
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(0);
  });

  it('leaves the other phone consistent too, not stuck holding a dead link', async () => {
    await connect();
    await radioOff(phoneA);

    await waitFor(
      () => !phoneB.isConnectedTo(phoneA.peerId),
      'B to notice the peer vanished',
    );
    expect(phoneB.transport.linkIds).toHaveLength(0);
    expect(phoneB.sessions.size).toBe(0);
  });

  it('survives Bluetooth being toggled repeatedly', async () => {
    for (let i = 0; i < 4; i++) {
      await connect();
      await radioOff(phoneA);
      await phoneA.messages.send(phoneB.peerId, `toggle ${i}`);
    }
    // Only the most recent one is still waiting: each reconnect drains what the
    // previous power cycle left behind, which is the behaviour a user wants and the
    // reason the queue does not grow across a day of toggling.
    expect(phoneA.messages.queue.countFor(phoneB.peerId)).toBe(1);

    await connect();
    await waitFor(
      () => phoneB.conversationWith(phoneA.peerId).length === 4,
      'all four queued messages to arrive once the radio settles',
    );

    // Nothing lost across four power cycles, nothing duplicated, order intact.
    expect(phoneB.conversationWith(phoneA.peerId).map(m => m.text)).toEqual([
      'toggle 0',
      'toggle 1',
      'toggle 2',
      'toggle 3',
    ]);
  });
});
