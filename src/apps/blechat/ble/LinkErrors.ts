import {BleError, BleErrorCode} from 'react-native-ble-plx';
import {ANDROID_GATT_ERROR} from '../config/constants';
import type {LinkFailure, LinkFailureReason, LinkState} from '../types/BLE';

/**
 * Turns whatever the BLE stack threw into a closed-set reason plus the stage it happened
 * in, so a failure is actionable instead of just "Connection failed".
 */
export class BleLinkError extends Error {
  constructor(
    readonly reason: LinkFailureReason,
    readonly phase: LinkState,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BleLinkError';
  }

  toFailure(): LinkFailure {
    return {
      reason: this.reason,
      phase: this.phase,
      message: this.message,
      timestamp: Date.now(),
    };
  }
}

/**
 * Map a ble-plx error code to our reason. The codes are stable and far more reliable
 * than string-matching the message, which differs per platform and per vendor.
 */
function reasonFromBleErrorCode(code: BleErrorCode): LinkFailureReason | null {
  switch (code) {
    case BleErrorCode.BluetoothPoweredOff:
      return 'BluetoothOff';
    case BleErrorCode.BluetoothUnauthorized:
      return 'BluetoothUnauthorized';
    case BleErrorCode.BluetoothUnsupported:
      return 'BluetoothUnsupported';

    case BleErrorCode.OperationTimedOut:
      return 'ConnectionTimeout';

    /**
     * The user pressed Cancel.
     *
     * ble-plx rejects the in-flight connect with this the moment
     * `cancelDeviceConnection` lands, and without this case it fell through to the
     * phase fallback and was recorded as ConnectionRefused — so cancelling produced
     * "Connection failed: Operation was cancelled", marked the peer failed, and counted
     * against it in the reconnect budget. A cancellation is evidence of nothing.
     */
    case BleErrorCode.OperationCancelled:
      return 'Cancelled';

    case BleErrorCode.DeviceNotFound:
    case BleErrorCode.DeviceNotConnected:
    case BleErrorCode.DeviceDisconnected:
      return 'DeviceUnavailable';
    case BleErrorCode.DeviceConnectionFailed:
      return 'ConnectionRefused';
    case BleErrorCode.DeviceMTUChangeFailed:
      return 'MtuFailed';

    case BleErrorCode.ServiceNotFound:
    case BleErrorCode.ServicesNotDiscovered:
    case BleErrorCode.ServicesDiscoveryFailed:
      return 'ServiceNotFound';

    case BleErrorCode.CharacteristicNotFound:
    case BleErrorCode.CharacteristicsNotDiscovered:
    case BleErrorCode.CharacteristicsDiscoveryFailed:
      return 'CharacteristicNotFound';
    case BleErrorCode.CharacteristicNotifyChangeFailed:
      return 'NotificationsFailed';

    default:
      return null;
  }
}

/**
 * Spot Android's GATT_ERROR (133).
 *
 * It has to be checked before the generic code mapping, because ble-plx surfaces it as a
 * plain DeviceConnectionFailed — which reads as "the peer refused us" and is exactly the
 * wrong conclusion. 133 is the Android stack declining to say why, and retrying usually
 * succeeds, so conflating the two turns a recoverable failure into a dead end.
 *
 * The numeric field is authoritative where it is populated; the string checks catch the
 * vendor stacks that only put the status in the message text.
 */
export function isAndroidGattError(err: unknown): boolean {
  // Read the field directly rather than narrowing on `instanceof BleError`: the code is
  // what matters, and several wrappers pass it along on a plain Error.
  const reported = (err as {androidErrorCode?: unknown} | null)?.androidErrorCode;
  if (reported === ANDROID_GATT_ERROR) {
    return true;
  }
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (message.includes('gatt_error')) {
    return true;
  }
  const code = String(ANDROID_GATT_ERROR);
  return STATUS_LABELS.some(label => hasStatusCode(message, label, code));
}

const STATUS_LABELS = ['status', 'error', 'code', 'gatt'];

/**
 * True when `message` contains e.g. "status 133", "status: 133" or "status=133".
 *
 * Deliberately not a loose search for "133": device identifiers, byte counts and MTU
 * values all contain digits, and misreading one as a GATT status would make us retry a
 * failure that was never going to succeed.
 */
function hasStatusCode(message: string, label: string, code: string): boolean {
  let from = 0;
  for (;;) {
    const at = message.indexOf(label, from);
    if (at === -1) {
      return false;
    }
    from = at + label.length;
    // Skip whatever separator the platform put between the label and the number.
    let cursor = from;
    while (cursor < message.length && ' \t:=#'.includes(message[cursor])) {
      cursor++;
    }
    if (
      message.startsWith(code, cursor) &&
      !isDigit(message[cursor + code.length])
    ) {
      return true;
    }
  }
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/**
 * Best-effort classification of an unknown throw.
 *
 * `phase` is what the caller was doing, and is used both as the reported stage and as the
 * fallback when the error itself carries no usable code — a failure during
 * discoveringServices is a ServiceNotFound far more often than anything else.
 */
export function classifyBleError(err: unknown, phase: LinkState): BleLinkError {
  if (err instanceof BleLinkError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);

  if (isAndroidGattError(err)) {
    return new BleLinkError('AndroidGattError', phase, message, err);
  }

  if (err instanceof BleError) {
    const mapped = reasonFromBleErrorCode(err.errorCode);
    if (mapped) {
      return new BleLinkError(mapped, phase, message, err);
    }
  }

  // Some Android stacks surface permission problems as plain exceptions.
  const lower = message.toLowerCase();
  if (lower.includes('permission')) {
    return new BleLinkError('PermissionDenied', phase, message, err);
  }
  if (lower.includes('bluetooth is turned off') || lower.includes('poweredoff')) {
    return new BleLinkError('BluetoothOff', phase, message, err);
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return new BleLinkError('ConnectionTimeout', phase, message, err);
  }
  // Both spellings, for the stacks that throw a plain Error rather than a coded one.
  if (lower.includes('cancelled') || lower.includes('canceled')) {
    return new BleLinkError('Cancelled', phase, message, err);
  }

  return new BleLinkError(fallbackReason(phase), phase, message, err);
}

function fallbackReason(phase: LinkState): LinkFailureReason {
  switch (phase) {
    case 'connecting':
      return 'ConnectionRefused';
    case 'discoveringServices':
      return 'ServiceNotFound';
    case 'negotiatingMtu':
      return 'MtuFailed';
    case 'enablingNotifications':
      return 'NotificationsFailed';
    case 'handshaking':
      return 'HandshakeFailed';
    default:
      return 'Unknown';
  }
}

/** One-line, human-readable explanation for the UI. */
export function describeFailure(failure: LinkFailure): string {
  switch (failure.reason) {
    case 'PermissionDenied':
      return 'Missing Bluetooth permission';
    case 'BluetoothOff':
      return 'Bluetooth is turned off';
    case 'BluetoothUnauthorized':
      return 'Bluetooth access not authorised';
    case 'BluetoothUnsupported':
      return 'Bluetooth LE not supported on this device';
    case 'DeviceUnavailable':
      return 'Peer is out of range or stopped advertising';
    case 'ConnectionTimeout':
      return 'Peer did not respond in time';
    case 'ConnectionRefused':
      return 'Peer refused the connection';
    case 'AndroidGattError':
      return 'Android GATT error 133 — connection failed, retrying usually works';
    case 'ServiceNotFound':
      return 'Peer is not running the chat service';
    case 'CharacteristicNotFound':
      return 'Chat service is missing a required characteristic';
    case 'MtuFailed':
      return 'MTU negotiation failed (falling back to 23 bytes)';
    case 'NotificationsFailed':
      return 'Could not subscribe to notifications';
    case 'HandshakeTimeout':
      return 'Peer never completed the handshake';
    case 'HandshakeFailed':
      return 'Handshake was rejected';
    case 'AuthenticationFailed':
      return 'Peer could not prove its identity';
    case 'ProtocolMismatch':
      return 'Peer is running an incompatible protocol version';
    case 'Blocked':
      return 'This person is blocked';
    case 'LinkLost':
      return 'Connection dropped';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Unknown error';
  }
}
