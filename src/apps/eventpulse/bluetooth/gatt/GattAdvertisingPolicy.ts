/**
 * Who gets the radio, and when.
 *
 * EventPulse now wants two things from the same antenna and they do not always
 * fit:
 *
 *   PRESENCE   the 0xFDCF service-data beacon, non-connectable, drives the radar
 *   GATT       a connectable 128-bit service, so someone can send you a request
 *
 * On Android both can run: `BluetoothLeAdvertiser` supports multiple concurrent
 * advertise sets on essentially every chipset that supports advertising at all,
 * and the two go out from different libraries.
 *
 * On iOS they cannot. `CBPeripheralManager.startAdvertising` replaces whatever
 * was being advertised; there is one advertisement per app, and it only runs in
 * the foreground. So on iOS this is a genuine either/or, and pretending
 * otherwise would produce a phone that silently stops appearing on other
 * people's radar the moment it becomes reachable — or, worse, one that looks
 * reachable and is not.
 *
 * This module is the decision, and nothing else. It touches no radio: it maps
 * (platform, what the user is doing) to a desired state, and the runtime applies
 * it. That keeps the policy testable, which matters more here than anywhere else
 * in the GATT layer, because the failure mode is invisible — you cannot tell by
 * looking at your own phone that you have stopped being discoverable.
 *
 * THE iOS TRADE, stated plainly: presence wins by default. A person who is not
 * on anyone's radar cannot be found at all, whereas a person who is on the radar
 * but not currently reachable simply takes a moment longer to connect to — the
 * sender's request retries while the receiver's slice comes round. Being
 * invisible is the worse failure, so it is the one we refuse.
 */

export type GattPlatform = 'android' | 'ios' | 'other';

export interface AdvertisingPolicyInput {
  platform: GattPlatform;
  /** In an event at all. Nothing advertises outside one. */
  inEvent: boolean;
  /** The user's own visibility choice. `invisible` silences everything. */
  visibility: 'visible' | 'connections_only' | 'invisible';
  /** Their privacy setting; false means nobody may send them a request. */
  acceptsConnectionRequests: boolean;
  /**
   * We are trying to reach someone right now.
   *
   * NOTE this no longer gates scanning. It used to, and that was a deadlock:
   * a request cannot be created until the target has been discovered, and
   * discovery cannot happen until a scan runs, and the scan only ran once a
   * request existed. Connect could therefore never succeed on any hardware.
   * The flag is kept because a live request is still worth knowing about.
   */
  hasOutgoingRequest: boolean;
  /** Someone is mid-handshake with us, so the peripheral must stay up. */
  hasActiveInboundLink: boolean;
  /**
   * iOS only. Advances to give the GATT peripheral a turn — see
   * `nextIosSlice`. Ignored on every other platform.
   */
  iosSlice?: 'presence' | 'gatt';
}

export interface AdvertisingPlan {
  /** Run the 0xFDCF presence beacon. */
  presenceAdvertising: boolean;
  /** Run the connectable GATT peripheral, so others can open a link. */
  gattPeripheral: boolean;
  /** Scan for other people's GATT service, so we can open one. */
  gattScanning: boolean;
  /** Why, in words a status strip could show. */
  reason: string;
}

/**
 * How long iOS spends on each side before switching.
 *
 * Long enough that a scan on the far side has a real chance of catching the
 * window, short enough that a person is never off the radar for long. Android
 * never uses these.
 */
export const IOS_PRESENCE_SLICE_MS = 8_000;
export const IOS_GATT_SLICE_MS = 4_000;

export function computeAdvertisingPlan(input: AdvertisingPolicyInput): AdvertisingPlan {
  if (!input.inEvent) {
    return {
      presenceAdvertising: false,
      gattPeripheral: false,
      gattScanning: false,
      reason: 'not in an event',
    };
  }

  if (input.visibility === 'invisible') {
    // Invisible means invisible on every channel. A phone that stopped
    // beaconing but still hosted a connectable service would still be
    // discoverable, which is exactly what the user asked it not to be.
    return {
      presenceAdvertising: false,
      gattPeripheral: false,
      // Scanning is receive-only and emits nothing, so it continues: an
      // invisible user can still see the room and still reach out to someone.
      gattScanning: true,
      reason: 'invisible — broadcasting nothing',
    };
  }

  // Someone is mid-handshake with us. Dropping the peripheral now would strand
  // a request that is already in flight, so it outranks the slice schedule.
  if (input.hasActiveInboundLink) {
    return {
      presenceAdvertising: input.platform === 'android',
      gattPeripheral: true,
      gattScanning: true,
      reason: 'a connection request is in progress',
    };
  }

  const reachable = input.acceptsConnectionRequests;

  if (input.platform === 'android') {
    // Multiple advertise sets. No trade to make.
    return {
      presenceAdvertising: true,
      gattPeripheral: reachable,
      // Always scanning while in an event. Someone has to have been seen before
      // they can be connected to, so the scan is what makes Connect possible at
      // all - it cannot wait for a request that needs it to already have run.
      gattScanning: true,
      reason: reachable ? 'presence and connections both live' : 'presence only — not accepting requests',
    };
  }

  if (input.platform === 'ios') {
    if (!reachable) {
      return {
        presenceAdvertising: true,
        gattPeripheral: false,
        gattScanning: true,
        reason: 'presence only — not accepting requests',
      };
    }
    // One advertisement at a time, so take turns.
    const onGatt = input.iosSlice === 'gatt';
    return {
      presenceAdvertising: !onGatt,
      gattPeripheral: onGatt,
      gattScanning: true,
      reason: onGatt
        ? 'reachable for connections (iOS takes turns with presence)'
        : 'on the radar (iOS takes turns with connections)',
    };
  }

  return {
    presenceAdvertising: false,
    gattPeripheral: false,
    gattScanning: false,
    reason: `Bluetooth is not supported on ${input.platform}`,
  };
}

/** The next slice, and how long to stay in it. Only meaningful on iOS. */
export function nextIosSlice(current: 'presence' | 'gatt'): {
  slice: 'presence' | 'gatt';
  durationMs: number;
} {
  return current === 'presence'
    ? { slice: 'gatt', durationMs: IOS_GATT_SLICE_MS }
    : { slice: 'presence', durationMs: IOS_PRESENCE_SLICE_MS };
}

/** True when two plans ask for the same radio state, so nothing needs doing. */
export function advertisingPlansEqual(a: AdvertisingPlan, b: AdvertisingPlan): boolean {
  return (
    a.presenceAdvertising === b.presenceAdvertising &&
    a.gattPeripheral === b.gattPeripheral &&
    a.gattScanning === b.gattScanning
  );
}
