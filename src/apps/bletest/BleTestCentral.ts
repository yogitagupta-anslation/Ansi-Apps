/**
 * The central half: scan, connect, write, listen.
 *
 * Built on `react-native-ble-plx`, which is central-only and ships real
 * TypeScript declarations (`node_modules/react-native-ble-plx/src/index.d.ts`).
 * Those declarations are imported rather than hand-copied, deliberately: every
 * GATT bug found in this repository so far came from a local interface that
 * described what someone believed the library did, which meant the compiler
 * checked the code against the mistake instead of against the library.
 *
 * Each numbered step below logs before it acts and again when it succeeds, so a
 * run that stops tells you which step it stopped on rather than leaving you to
 * guess from silence.
 */

import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';

import { asciiToBase64, base64ToAscii } from './BleTestBase64';
import { bleTestLog } from './BleTestLog';
import {
  CONNECT_TIMEOUT_MS,
  HELLO_REQUEST,
  HELLO_RESPONSE,
  TEST_CHAR_RX_UUID,
  TEST_CHAR_TX_UUID,
  TEST_SERVICE_UUID,
} from './BleTestProfile';

/** Android starts every link at the 23-byte ATT floor until asked otherwise. */
const REQUESTED_MTU = 185;

export interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

export interface CentralStatus {
  scanning: boolean;
  connectedTo: string | null;
  devices: DiscoveredDevice[];
  received: string[];
}

type StatusListener = (status: CentralStatus) => void;

export class BleTestCentral {
  private manager: BleManager | null = null;
  private scanning = false;
  private device: Device | null = null;
  private monitor: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private readonly devices = new Map<string, DiscoveredDevice>();
  private received: string[] = [];
  private readonly listeners = new Set<StatusListener>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => {
      this.listeners.delete(listener);
    };
  }

  status(): CentralStatus {
    return {
      scanning: this.scanning,
      connectedTo: this.device?.id ?? null,
      devices: [...this.devices.values()],
      received: [...this.received],
    };
  }

  private emit(): void {
    const snapshot = this.status();
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * The manager is created lazily.
   *
   * Constructing a `BleManager` powers up the native stack, so doing it when
   * the screen mounts would turn merely opening the test into a Bluetooth
   * session even if nothing is ever pressed.
   */
  private require(): BleManager {
    if (!this.manager) this.manager = new BleManager();
    return this.manager;
  }

  async bluetoothState(): Promise<State> {
    return this.require().state();
  }

  /* ---------------------------------------------------------------- *
   * Scan
   * ---------------------------------------------------------------- */

  async startScan(): Promise<void> {
    if (this.scanning) return;

    bleTestLog.step('Bluetooth state: checking');
    const state = await this.bluetoothState();
    if (state !== State.PoweredOn) {
      bleTestLog.fail('Bluetooth state: not powered on', { state });
      throw new Error(`Bluetooth is not powered on (state ${state})`);
    }
    bleTestLog.ok('Bluetooth state: powered on');

    bleTestLog.step('Starting scan', { filterServiceUUID: TEST_SERVICE_UUID });
    this.scanning = true;
    this.emit();

    this.require().startDeviceScan(
      [TEST_SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          bleTestLog.fail('Scan error', {
            message: error.message,
            reason: error.reason,
            errorCode: error.errorCode,
          });
          this.scanning = false;
          this.emit();
          return;
        }
        if (!device) return;

        // Logged before any filtering, so what the radio actually returned is
        // visible even when nothing follows it.
        const known = this.devices.has(device.id);
        this.devices.set(device.id, {
          id: device.id,
          name: device.localName ?? device.name ?? null,
          rssi: device.rssi ?? null,
        });

        if (!known) {
          bleTestLog.ok('Device discovered');
          bleTestLog.ok('Device name', device.localName ?? device.name ?? '(none)');
          bleTestLog.ok('Device ID', device.id);
          bleTestLog.ok('Service UUID', (device.serviceUUIDs ?? []).join(', ') || '(not in advert)');
        }
        this.emit();
      },
    );

    bleTestLog.ok('Scan started');
  }

  stopScan(): void {
    if (!this.scanning) return;
    try {
      this.require().stopDeviceScan();
    } catch (error) {
      bleTestLog.fail('stopDeviceScan threw', error);
    }
    this.scanning = false;
    bleTestLog.ok('Scan stopped');
    this.emit();
  }

  /* ---------------------------------------------------------------- *
   * Connect
   * ---------------------------------------------------------------- */

  async connect(deviceId: string): Promise<void> {
    // Scanning while connecting makes both slower and is a common cause of
    // flaky links on Android.
    this.stopScan();

    bleTestLog.step('Connecting', { deviceId });
    let device: Device;
    try {
      device = await this.require().connectToDevice(deviceId, { timeout: CONNECT_TIMEOUT_MS });
    } catch (error) {
      bleTestLog.fail('Connect failed', error);
      throw error;
    }
    this.device = device;
    bleTestLog.ok('Connected', { deviceId });
    this.emit();

    this.disconnectSub = device.onDisconnected(() => {
      bleTestLog.step('Disconnected', { deviceId });
      this.teardownLink();
    });

    bleTestLog.step('Discovering services');
    try {
      await device.discoverAllServicesAndCharacteristics();
    } catch (error) {
      bleTestLog.fail('Service discovery failed', error);
      throw error;
    }
    bleTestLog.ok('Services discovered');

    try {
      const updated = await device.requestMTU(REQUESTED_MTU);
      bleTestLog.ok('MTU negotiated', { mtu: updated.mtu });
    } catch {
      // A refused request just means the link stays at the 23-byte floor,
      // which is still enough for this protocol.
      bleTestLog.step('MTU request refused; staying at the ATT default');
    }

    try {
      const characteristics = await device.characteristicsForService(TEST_SERVICE_UUID);
      for (const characteristic of characteristics) {
        bleTestLog.ok('Characteristic discovered', {
          uuid: characteristic.uuid,
          writable: characteristic.isWritableWithResponse,
          notifiable: characteristic.isNotifiable,
        });
      }
      if (characteristics.length === 0) {
        bleTestLog.fail('No characteristics on the test service', { service: TEST_SERVICE_UUID });
      }
    } catch (error) {
      bleTestLog.fail('Could not list characteristics', error);
      throw error;
    }

    // Subscribe before writing, so a reply that comes back immediately is not
    // missed by a listener that had not been attached yet.
    this.monitor = device.monitorCharacteristicForService(
      TEST_SERVICE_UUID,
      TEST_CHAR_TX_UUID,
      (error, characteristic) => {
        if (error) {
          bleTestLog.fail('Notification subscription failed', {
            message: error.message,
            reason: error.reason,
          });
          return;
        }
        if (!characteristic?.value) return;

        let text: string;
        try {
          text = base64ToAscii(characteristic.value);
        } catch (decodeError) {
          bleTestLog.fail('Could not decode a notification', decodeError);
          return;
        }

        this.received = [text, ...this.received].slice(0, 50);
        if (text === HELLO_RESPONSE) {
          bleTestLog.ok('Received HELLO_RESPONSE');
        } else {
          bleTestLog.ok('Received a notification', { text });
        }
        this.emit();
      },
    );
    bleTestLog.ok('Subscribed to the reply characteristic');
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    if (!device) return;
    try {
      await device.cancelConnection();
    } catch {
      // Already gone; the teardown below still converges.
    }
    this.teardownLink();
  }

  /* ---------------------------------------------------------------- *
   * Traffic
   * ---------------------------------------------------------------- */

  async sendHello(): Promise<void> {
    const device = this.device;
    if (!device) {
      bleTestLog.fail('Cannot send: not connected');
      throw new Error('not connected');
    }

    bleTestLog.step('Writing HELLO_REQUEST');
    try {
      await device.writeCharacteristicWithResponseForService(
        TEST_SERVICE_UUID,
        TEST_CHAR_RX_UUID,
        asciiToBase64(HELLO_REQUEST),
      );
    } catch (error) {
      bleTestLog.fail('Writing HELLO_REQUEST failed', error);
      throw error;
    }
    bleTestLog.ok('HELLO_REQUEST written');
  }

  private teardownLink(): void {
    try {
      this.monitor?.remove();
    } catch {
      // Already removed.
    }
    try {
      this.disconnectSub?.remove();
    } catch {
      // Already removed.
    }
    this.monitor = null;
    this.disconnectSub = null;
    this.device = null;
    this.emit();
  }

  dispose(): void {
    this.stopScan();
    this.teardownLink();
    try {
      this.manager?.destroy();
    } catch {
      // Nothing useful to do if the native manager has already gone.
    }
    this.manager = null;
  }
}
