/**
 * advertisingState.ts
 * -----------------------------------------------------------------------------
 * THE SINGLE SOURCE OF TRUTH for what the BLE advertiser is actually doing.
 *
 * TWO VALUES THAT MUST NEVER BE CONFLATED
 *
 *   desired  - the user's preference, persisted. "I want to be broadcasting."
 *   actual   - what the radio is doing right now. Never persisted, never
 *              assumed, only ever reported by the native layer.
 *
 * A stored `true` is NOT evidence that anything is on air. After a restart the
 * preference survives but the radio does not, so the two disagree until a real
 * advertiser has started and Android's own AdvertiseCallback.onStartSuccess has
 * fired. The UI renders `actual`; `desired` only decides whether the app should
 * try to restore.
 * -----------------------------------------------------------------------------
 */

/** What the radio is actually doing. */
export type AdvertisingState =
  /** Not advertising, and not trying to. */
  | 'OFF'
  /** start requested; awaiting Android's onStartSuccess / onStartFailure. */
  | 'STARTING'
  /** Confirmed on air by AdvertiseCallback.onStartSuccess. */
  | 'ACTIVE'
  /** stop requested; awaiting confirmation. */
  | 'STOPPING'
  /** Android rejected the advertisement, or the native call threw. */
  | 'ERROR'
  /** Bluetooth adapter is off - the user must turn it on. */
  | 'BLUETOOTH_DISABLED'
  /** BLUETOOTH_ADVERTISE not granted. */
  | 'PERMISSION_DENIED'
  /** This chipset has no peripheral role. No app can work around it. */
  | 'UNSUPPORTED';

/**
 * ACTIVE is the ONLY state that means "an advertisement is genuinely on air",
 * and it is reachable only from the native success callback.
 */
export function isOnAir(state: AdvertisingState): boolean {
  return state === 'ACTIVE';
}

/** States the user can fix themselves. Drives whether a Retry button shows. */
export function isRecoverable(state: AdvertisingState): boolean {
  return (
    state === 'BLUETOOTH_DISABLED' ||
    state === 'PERMISSION_DENIED' ||
    state === 'ERROR' ||
    state === 'OFF'
  );
}

/** Short label for the status line. */
export function advertisingLabel(state: AdvertisingState): string {
  switch (state) {
    case 'ACTIVE':
      return 'Advertising active';
    case 'STARTING':
      return 'Starting…';
    case 'STOPPING':
      return 'Stopping…';
    case 'BLUETOOTH_DISABLED':
      return 'Bluetooth is off';
    case 'PERMISSION_DENIED':
      return 'Permission required';
    case 'UNSUPPORTED':
      return 'Not supported on this phone';
    case 'ERROR':
      return 'Advertising failed';
    default:
      return 'Not advertising';
  }
}

/**
 * Why `actual` does not match `desired`. Shown verbatim on the Employee screen
 * and the debug panel, so it must say what to DO, not just what went wrong.
 */
export function advertisingReason(
  state: AdvertisingState,
  error: string | null,
): string | null {
  switch (state) {
    case 'BLUETOOTH_DISABLED':
      return 'Bluetooth is switched off, so nothing can be broadcast. Turn Bluetooth on, then start advertising again.';
    case 'PERMISSION_DENIED':
      return 'The Nearby devices (BLUETOOTH_ADVERTISE) permission is not granted. Android can also revoke permissions for apps that go unused. Grant it, then start advertising again.';
    case 'UNSUPPORTED':
      return "This phone's Bluetooth chipset does not support the peripheral role, so it cannot advertise at all. Use it as the Host instead, and a different phone as the Employee.";
    case 'ERROR':
      return error ?? 'Android rejected the advertisement. See the debug log for the failure code.';
    case 'OFF':
      return null;
    default:
      return null;
  }
}

/** Tone for the status pill. */
export function advertisingTone(
  state: AdvertisingState,
): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (state) {
    case 'ACTIVE':
      return 'success';
    case 'STARTING':
    case 'STOPPING':
      return 'info';
    case 'BLUETOOTH_DISABLED':
    case 'PERMISSION_DENIED':
      return 'warning';
    case 'ERROR':
    case 'UNSUPPORTED':
      return 'danger';
    default:
      return 'neutral';
  }
}
