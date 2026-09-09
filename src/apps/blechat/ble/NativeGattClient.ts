import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

import {
  BLE_RX_CHAR_UUID,
  BLE_SERVICE_UUID,
  BLE_TX_CHAR_UUID,
} from '../config/constants';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';

/**
 * The central role, driven by our own Kotlin rather than by ble-plx.
 *
 * Written because every characteristic write on a ble-plx link came back refused before
 * any radio traffic, and the pre-Android-13 API it calls returns a bare `false` with no
 * reason attached. A session of eliminating explanations above that line — the
 * simultaneous dial, a race with the subscription write, the scan restarting, a stale
 * characteristic handle, the declared properties, the library's pinned RxAndroidBle —
 * left nothing above it to blame, and no way to see below it.
 *
 * The native side calls the Android 13+ overload, which returns a documented status, and
 * serialises operations itself. So a refusal now arrives with the framework's own reason
 * instead of a word.
 *
 * Scanning is deliberately NOT here: discovery through ble-plx works, and replacing what
 * works is how a diagnosis turns into a rewrite.
 */
const TAG = 'NativeGatt';

interface NativeClient {
  connect(
    address: string,
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
  ): Promise<{address: string; mtu: number; rxProperties: number}>;
  disconnect(address: string): Promise<boolean>;
  write(address: string, base64: string, withResponse: boolean): Promise<boolean>;
  linkInfo(address: string): Promise<{
    mtu: number;
    rxFound: boolean;
    txFound: boolean;
    rxProperties: number;
    queueIdle: boolean;
  } | null>;
}

const native: NativeClient | undefined = (
  NativeModules as {BleClient?: NativeClient}
).BleClient;

/** Android only: the module is Kotlin, and iOS has its own working path. */
export const isNativeGattAvailable = Platform.OS === 'android' && !!native;

type Events = {
  data: {address: string; base64: string};
  disconnected: {address: string; status: number};
};

export const nativeGattBus = new EventBus<Events>();

if (isNativeGattAvailable) {
  const emitter = new NativeEventEmitter(
    NativeModules.BleClient as ConstructorParameters<typeof NativeEventEmitter>[0],
  );
  emitter.addListener('bleClientData', (e: {address: string; base64: string}) => {
    nativeGattBus.emit('data', e);
  });
  emitter.addListener('bleClientDisconnected', (e: {address: string; status: number}) => {
    logger.info(TAG, `${e.address} disconnected (status ${e.status})`);
    nativeGattBus.emit('disconnected', e);
  });
}

export async function nativeConnect(
  address: string,
): Promise<{mtu: number; rxProperties: number}> {
  if (!native) {
    throw new Error('The native GATT client is not available on this build');
  }
  const result = await native.connect(
    address,
    BLE_SERVICE_UUID,
    BLE_RX_CHAR_UUID,
    BLE_TX_CHAR_UUID,
  );
  logger.info(
    TAG,
    `${address}: link ready (MTU ${result.mtu}, rx properties 0x${result.rxProperties.toString(16)})`,
  );
  return {mtu: result.mtu, rxProperties: result.rxProperties};
}

export async function nativeDisconnect(address: string): Promise<void> {
  if (!native) {
    return;
  }
  await native.disconnect(address).catch(() => undefined);
}

export async function nativeWrite(
  address: string,
  base64: string,
  withResponse: boolean,
): Promise<void> {
  if (!native) {
    throw new Error('The native GATT client is not available on this build');
  }
  await native.write(address, base64, withResponse);
}

/** What the link actually settled on — for Diagnostics, and for reading a refusal. */
export async function nativeLinkInfo(address: string) {
  if (!native) {
    return null;
  }
  return native.linkInfo(address).catch(() => null);
}
