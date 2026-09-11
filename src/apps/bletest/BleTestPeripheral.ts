/**
 * The peripheral half: a real Android GATT server.
 *
 * Built on `react-native-ble-peripheral-manager`, which wraps
 * `BluetoothGattServer` on Android. `react-native-ble-plx` cannot do this — it
 * is central-only by design — so there is no choice to make here.
 *
 * Everything below follows the sequence that is known to work in this
 * repository, and each departure from the obvious is a bug that has already
 * been paid for once:
 *
 *  - `start()` is NOT an initialiser. On both platforms it is a legacy alias
 *    for `startAdvertising("{}")`: it puts a service-less advertisement on the
 *    air and latches the module's single-advertisement flag, after which the
 *    real `startAdvertising` is rejected with "Already advertising" and the
 *    device is broadcasting nothing anyone can find. This module never calls
 *    it, and clears the advertiser before claiming it.
 *
 *  - The write event carries its ATT request id at the TOP LEVEL, not on each
 *    request, and its fields are flat strings: `{ requestId, requests: [{
 *    centralUUID, characteristicUUID, serviceUUID, offset, value }] }`. Reading
 *    the wrong key yields `undefined` in silence, the ATT response is never
 *    sent, and the central's write dies at the 30-second spec timeout.
 *
 *  - The answer goes out FIRST, before the payload is looked at. An unanswered
 *    write request holds the central's only ATT transaction slot open, so
 *    anything that could throw belongs after the acknowledgement, not before.
 *
 *  - `removeAllServices()` is never called. The peripheral manager is a
 *    process-wide singleton shared with the other BLE apps in this hub, and
 *    wiping every service would take a running Treasure Hunt game down with it.
 */

import {
  CharacteristicPermissions,
  CharacteristicProperties,
  ManagerState,
  addCharacteristicToServiceBase64,
  addService,
  getState,
  isAdvertising,
  onDidReceiveWriteRequests,
  onDidSubscribeToCharacteristic,
  onDidUnsubscribeFromCharacteristic,
  removeService,
  respondToRequestBase64,
  startAdvertising,
  stopAdvertising,
  updateValueBase64,
} from 'react-native-ble-peripheral-manager';

import { asciiToBase64, base64ToAscii } from './BleTestBase64';
import { bleTestLog } from './BleTestLog';
import {
  HELLO_REQUEST,
  HELLO_RESPONSE,
  TEST_CHAR_RX_UUID,
  TEST_CHAR_TX_UUID,
  TEST_LOCAL_NAME_PREFIX,
  TEST_SERVICE_UUID,
} from './BleTestProfile';

/** ATT success, used when acknowledging a write. */
const ATT_SUCCESS = 0x00;

interface Subscription {
  remove(): void;
}

export interface PeripheralStatus {
  serverUp: boolean;
  advertising: boolean;
  subscribedCentrals: string[];
}

type StatusListener = (status: PeripheralStatus) => void;

export class BleTestPeripheral {
  private subs: Subscription[] = [];
  private servicePublished = false;
  private advertising = false;
  private readonly subscribed = new Set<string>();
  private readonly listeners = new Set<StatusListener>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => {
      this.listeners.delete(listener);
    };
  }

  status(): PeripheralStatus {
    return {
      serverUp: this.servicePublished,
      advertising: this.advertising,
      subscribedCentrals: [...this.subscribed],
    };
  }

  private emit(): void {
    const snapshot = this.status();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** Bring up the GATT server and start connectable advertising. */
  async start(localName: string): Promise<void> {
    bleTestLog.step('Bluetooth state: checking');
    const state = await getState();
    if (state !== ManagerState.PoweredOn) {
      bleTestLog.fail('Bluetooth state: not powered on', { state });
      throw new Error(`Bluetooth is not powered on (state ${state})`);
    }
    bleTestLog.ok('Bluetooth state: powered on');

    if (!this.servicePublished) {
      bleTestLog.step('Starting GATT server');
      try {
        // Ours only. Never removeAllServices() — other apps in this process
        // have services registered on the same singleton.
        removeService(TEST_SERVICE_UUID);
      } catch {
        // Nothing published yet. Expected on the first run.
      }

      addService(TEST_SERVICE_UUID, true);

      // Peripheral -> central. Read is included so a central that would rather
      // poll than subscribe still has a way through.
      addCharacteristicToServiceBase64(
        TEST_SERVICE_UUID,
        TEST_CHAR_TX_UUID,
        CharacteristicProperties.Notify | CharacteristicProperties.Read,
        CharacteristicPermissions.Readable,
        '',
      );

      // Central -> peripheral, write with response.
      addCharacteristicToServiceBase64(
        TEST_SERVICE_UUID,
        TEST_CHAR_RX_UUID,
        CharacteristicProperties.Write | CharacteristicProperties.WriteWithoutResponse,
        CharacteristicPermissions.Writeable,
        '',
      );

      this.attachListeners();
      this.servicePublished = true;
      bleTestLog.ok('GATT service created', {
        service: TEST_SERVICE_UUID,
        tx: TEST_CHAR_TX_UUID,
        rx: TEST_CHAR_RX_UUID,
      });
    }

    bleTestLog.step('Starting advertising', { localName });

    // Clear whatever is on the air before claiming the single advertising slot.
    try {
      if (await isAdvertising()) {
        bleTestLog.step('Clearing an advertisement that was already running');
        stopAdvertising();
      }
    } catch {
      // isAdvertising is informational; a failure here must not stop the test.
    }

    try {
      await startAdvertising({
        localName,
        serviceUUIDs: [TEST_SERVICE_UUID],
      });
    } catch (error) {
      bleTestLog.fail('Advertising failed to start', error);
      throw error;
    }

    this.advertising = true;
    bleTestLog.ok('Advertising started', { localName, serviceUUID: TEST_SERVICE_UUID });
    this.emit();
  }

  async stop(): Promise<void> {
    try {
      stopAdvertising();
    } catch (error) {
      bleTestLog.fail('stopAdvertising threw', error);
    }
    this.advertising = false;
    bleTestLog.ok('Advertising stopped');
    this.emit();
  }

  /** Tear down listeners and remove our service. Leaves other apps alone. */
  dispose(): void {
    for (const sub of this.subs) {
      try {
        sub.remove();
      } catch {
        // A listener that is already gone is not a problem.
      }
    }
    this.subs = [];
    try {
      removeService(TEST_SERVICE_UUID);
    } catch {
      // Already gone.
    }
    this.servicePublished = false;
    this.advertising = false;
    this.subscribed.clear();
    this.emit();
  }

  private attachListeners(): void {
    this.subs.push(
      onDidSubscribeToCharacteristic((event) => {
        if (event.characteristicUUID?.toLowerCase() !== TEST_CHAR_TX_UUID) return;
        this.subscribed.add(event.centralUUID);
        bleTestLog.ok('Central subscribed', { central: event.centralUUID });
        this.emit();
      }) as Subscription,
    );

    this.subs.push(
      onDidUnsubscribeFromCharacteristic((event) => {
        this.subscribed.delete(event.centralUUID);
        bleTestLog.step('Central unsubscribed', { central: event.centralUUID });
        this.emit();
      }) as Subscription,
    );

    this.subs.push(
      onDidReceiveWriteRequests((event) => {
        // Answer first. Anything below this line can throw; the ATT response
        // must not be the casualty when it does.
        try {
          respondToRequestBase64(event.requestId, ATT_SUCCESS, '');
        } catch (error) {
          bleTestLog.fail('Could not acknowledge the write request', error);
        }

        for (const request of event.requests ?? []) {
          if (request.characteristicUUID?.toLowerCase() !== TEST_CHAR_RX_UUID) continue;

          let text: string;
          try {
            text = base64ToAscii(request.value ?? '');
          } catch (error) {
            bleTestLog.fail('Could not decode the written value', error);
            continue;
          }

          bleTestLog.ok('Received write', { from: request.centralUUID, text });

          if (text === HELLO_REQUEST) {
            bleTestLog.ok('HELLO_REQUEST received');
            void this.sendResponse(request.centralUUID);
          } else {
            bleTestLog.step('Ignoring an unrecognised payload', { text });
          }
        }
      }) as Subscription,
    );
  }

  /** Notify HELLO_RESPONSE back to the central that asked. */
  private async sendResponse(centralUUID: string): Promise<void> {
    bleTestLog.step('Sending HELLO_RESPONSE', { to: centralUUID });
    try {
      const accepted = await updateValueBase64(
        TEST_SERVICE_UUID,
        TEST_CHAR_TX_UUID,
        asciiToBase64(HELLO_RESPONSE),
        [centralUUID],
      );
      if (accepted) {
        bleTestLog.ok('HELLO_RESPONSE sent');
      } else {
        // updateValue returning false means the transmit queue was full and
        // NOTHING was sent. Saying "sent" here would be a lie the far side
        // disproves by waiting forever.
        bleTestLog.fail('HELLO_RESPONSE was not sent — the transmit queue was full');
      }
    } catch (error) {
      bleTestLog.fail('HELLO_RESPONSE failed', error);
    }
  }
}

/** A short, human-readable advertisement name. Carries no identity. */
export function makeLocalName(): string {
  // Four hex characters is enough to tell two phones apart on a bench and
  // leaves room inside the 31-byte advertisement beside a 128-bit service UUID.
  const suffix = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `${TEST_LOCAL_NAME_PREFIX}-${suffix}`;
}
