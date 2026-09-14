/**
 * Advertising startup, and why it must not be awaited on the promise.
 *
 * The bug these tests pin was measured on two emulators: five native
 * advertisements, five `Advertising started successfully`, and zero settled
 * promises. `react-native-ble-peripheral-manager` builds its `AdvertiseCallback`
 * once and captures the promise from the call that created it
 * (`BlePeripheralManagerModule.kt:266-281`), then keeps that callback for the
 * life of the process — so every later `startAdvertising` stores a promise
 * nothing will ever resolve.
 *
 * That alone would have been survivable. What made it fatal is that
 * `applyAdvertisingPlan` awaited it before starting the scan, so a phone that
 * was advertising perfectly well never looked for anyone, and Connect reported
 * "not reachable" about a peer that was on the air the whole time.
 *
 * So there are two things to hold: settle on the EVENT, and never let the
 * peripheral half decide whether the central half runs.
 */

import { BlePlxGattTransport } from '../../bluetooth/gatt/transports/BlePlxGattTransport';
import { GATT_SERVICE_UUID } from '../../bluetooth/gatt/GattProfile';

/* ------------------------------------------------------------------ *
 * Fakes
 * ------------------------------------------------------------------ */

type Listener = (payload: never) => void;

function makeHarness(options: { advertising?: 'event' | 'reject' | 'hang' } = {}) {
  const mode = options.advertising ?? 'event';
  const listeners = new Map<string, Listener[]>();

  const on = (event: string) => (listener: Listener) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
    return {
      remove: () => {
        removed.push(event);
      },
    };
  };
  const removed: string[] = [];

  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? []) (listener as (p: unknown) => void)(payload);
  };

  const calls = {
    startAdvertising: [] as { localName?: string; serviceUUIDs?: string[] }[],
    stopAdvertising: 0,
    startScan: 0,
    stopScan: 0,
    addService: 0,
  };

  const peripheral = {
    addService: () => {
      calls.addService += 1;
    },
    removeService: () => undefined,
    addCharacteristicToServiceBase64: () => undefined,
    startAdvertising: (opts: { localName?: string; serviceUUIDs?: string[] }) => {
      calls.startAdvertising.push(opts);
      if (mode === 'reject') return Promise.reject(new Error('no advertiser'));
      // 'event' and 'hang' both model the real module: the promise never
      // settles. Only the event distinguishes them.
      return new Promise<void>(() => undefined);
    },
    stopAdvertising: () => {
      calls.stopAdvertising += 1;
    },
    updateValueBase64: async () => true,
    respondToRequestBase64: () => undefined,
    onDidStartAdvertising: on('didStartAdvertising'),
    onDidReceiveWriteRequests: on('write'),
    onDidSubscribeToCharacteristic: on('subscribe'),
    onDidUnsubscribeFromCharacteristic: on('unsubscribe'),
    onReadyToUpdateSubscribers: on('ready'),
  };

  const plx = {
    startDeviceScan: (uuids: string[] | null) => {
      calls.startScan += 1;
      lastScanFilter = uuids;
    },
    stopDeviceScan: () => {
      calls.stopScan += 1;
    },
    connectToDevice: async () => ({}) as never,
    cancelDeviceConnection: async () => ({}) as never,
  };
  let lastScanFilter: string[] | null = null;

  const transport = new BlePlxGattTransport(
    plx as unknown as ConstructorParameters<typeof BlePlxGattTransport>[0],
    peripheral as unknown as ConstructorParameters<typeof BlePlxGattTransport>[1],
  );

  return {
    transport,
    calls,
    removed,
    emit,
    scanFilter: () => lastScanFilter,
    /** The adapter confirming, exactly as the native module does. */
    confirmAdvertising: (success = true, error?: string) =>
      emit('didStartAdvertising', { success, error }),
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------ *
 * The event settles startup
 * ------------------------------------------------------------------ */

describe('advertising startup', () => {
  it('resolves when the adapter confirms, even though the promise never settles', async () => {
    const h = makeHarness({ advertising: 'event' });

    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising();

    await expect(started).resolves.toBeUndefined();
  });

  it('advertises the EventPulse service under the rotating peer id', async () => {
    const h = makeHarness();
    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising();
    await started;

    expect(h.calls.startAdvertising).toHaveLength(1);
    expect(h.calls.startAdvertising[0]).toEqual({
      localName: 'A1B2C3D4',
      serviceUUIDs: [GATT_SERVICE_UUID],
    });
  });

  it('clears the advertiser before claiming it', async () => {
    // The module holds one advertisement; re-applying the plan must replace it.
    const h = makeHarness();
    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising();
    await started;

    expect(h.calls.stopAdvertising).toBeGreaterThan(0);
  });

  it('fails when the adapter reports a refusal on the event', async () => {
    const h = makeHarness();
    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising(false, 'Data too large');

    await expect(started).rejects.toMatchObject({ code: 'advertise_failed' });
  });

  it('fails immediately on a genuine native rejection', async () => {
    // A real rejection must not have to wait out the timeout.
    const h = makeHarness({ advertising: 'reject' });
    await expect(h.transport.startPeripheral({ displayName: 'A1B2C3D4' })).rejects.toMatchObject({
      code: 'advertise_failed',
    });
  });

  it('settles a second advertisement too, which is the case that used to hang', async () => {
    /*
     * The captured-promise bug only bites from the SECOND call onward, and the
     * peer id rotates, so the second call is the one that matters in practice.
     */
    const h = makeHarness();

    const first = h.transport.startPeripheral({ displayName: 'ROUND-ONE' });
    await flush();
    h.confirmAdvertising();
    await first;

    const second = h.transport.startPeripheral({ displayName: 'ROUND-TWO' });
    await flush();
    h.confirmAdvertising();

    await expect(second).resolves.toBeUndefined();
    expect(h.calls.startAdvertising).toHaveLength(2);
  });

  it('publishes the GATT service only once across repeated starts', async () => {
    const h = makeHarness();
    const first = h.transport.startPeripheral({ displayName: 'ONE' });
    await flush();
    h.confirmAdvertising();
    await first;

    const second = h.transport.startPeripheral({ displayName: 'TWO' });
    await flush();
    h.confirmAdvertising();
    await second;

    expect(h.calls.addService).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The timeout is bounded
 * ------------------------------------------------------------------ */

describe('bounded startup', () => {
  it('gives up rather than hanging when the adapter never confirms', async () => {
    jest.useFakeTimers();
    try {
      const h = makeHarness({ advertising: 'hang' });
      const started = h.transport.startPeripheral({ displayName: 'SILENT' });
      const assertion = expect(started).rejects.toMatchObject({ code: 'advertise_failed' });

      // Long enough to cover the confirmation window, and no longer.
      await jest.advanceTimersByTimeAsync(9_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reject after the event already settled it', async () => {
    // The late timer must not turn a success into a failure, nor surface as an
    // unhandled rejection.
    jest.useFakeTimers();
    try {
      const h = makeHarness();
      const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
      await Promise.resolve();
      h.confirmAdvertising();
      await expect(started).resolves.toBeUndefined();

      await jest.advanceTimersByTimeAsync(30_000);
    } finally {
      jest.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Scanning is independent
 * ------------------------------------------------------------------ */

describe('scanning independence', () => {
  it('starts the scan even when advertising is refused', async () => {
    /*
     * The whole point. A phone that cannot host can still dial out, and a phone
     * whose advertisement is refused can still find everyone else.
     */
    const h = makeHarness({ advertising: 'reject' });

    await expect(h.transport.startPeripheral({ displayName: 'X' })).rejects.toBeDefined();
    await h.transport.startScan();

    expect(h.calls.startScan).toBe(1);
    expect(h.scanFilter()).toEqual([GATT_SERVICE_UUID]);
  });

  it('starts the scan while advertising is still unconfirmed', async () => {
    // Modelling the real failure: the promise is pending for ever. Scanning
    // must not be waiting behind it.
    jest.useFakeTimers();
    try {
      const h = makeHarness({ advertising: 'hang' });

      const advertising = h.transport.startPeripheral({ displayName: 'X' });
      const settled = expect(advertising).rejects.toBeDefined();

      await h.transport.startScan();
      expect(h.calls.startScan).toBe(1);

      // Let the bounded wait finish inside the test rather than after it.
      await jest.advanceTimersByTimeAsync(9_000);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps scanning across a rotation re-advertise', async () => {
    /*
     * What the Android rotation trigger actually does every fifteen minutes:
     * re-advertise under a new local name while the phone is already scanning.
     * The advertiser is torn down and put back to do it, and the central half
     * must not go with it — a phone that stopped looking at every rotation
     * would be exactly the "not reachable" failure this whole area exists to
     * prevent, just on a timer.
     */
    const h = makeHarness();

    await h.transport.startScan();
    expect(h.calls.startScan).toBe(1);

    const rotated = h.transport.startPeripheral({ displayName: 'ROTATED' });
    await flush();
    h.confirmAdvertising();
    await rotated;

    // Re-advertised under the new name, and the scan was never touched.
    expect(h.calls.startAdvertising.at(-1)).toEqual({
      localName: 'ROTATED',
      serviceUUIDs: [GATT_SERVICE_UUID],
    });
    expect(h.calls.startScan).toBe(1);
    expect(h.calls.stopScan).toBe(0);
    expect(h.scanFilter()).toEqual([GATT_SERVICE_UUID]);
  });

  it('keeps scanning even when the rotation re-advertise is refused', async () => {
    // A rotation that the adapter rejects must not take the scanner down with
    // it: the phone can still find everyone else under their new names.
    const h = makeHarness({ advertising: 'reject' });

    await h.transport.startScan();
    await expect(h.transport.startPeripheral({ displayName: 'ROTATED' })).rejects.toMatchObject({
      code: 'advertise_failed',
    });

    expect(h.calls.startScan).toBe(1);
    expect(h.calls.stopScan).toBe(0);
  });

  it('does not start a second scan while one is running', async () => {
    const h = makeHarness();
    await h.transport.startScan();
    await h.transport.startScan();

    expect(h.calls.startScan).toBe(1);
  });

  it('can stop and restart the scan', async () => {
    const h = makeHarness();
    await h.transport.startScan();
    await h.transport.stopScan();
    await h.transport.startScan();

    expect(h.calls.startScan).toBe(2);
    expect(h.calls.stopScan).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Cleanup
 * ------------------------------------------------------------------ */

describe('cleanup', () => {
  it('stops advertising and scanning on shutdown', async () => {
    const h = makeHarness();
    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising();
    await started;
    await h.transport.startScan();

    await h.transport.shutdown();

    expect(h.calls.stopScan).toBeGreaterThan(0);
    expect(h.calls.stopAdvertising).toBeGreaterThan(1);
  });

  it('releases the native listeners on shutdown', async () => {
    const h = makeHarness();
    const started = h.transport.startPeripheral({ displayName: 'A1B2C3D4' });
    await flush();
    h.confirmAdvertising();
    await started;

    await h.transport.shutdown();

    expect(h.removed).toContain('didStartAdvertising');
  });

  it('leaves no waiter that a later event could resolve', async () => {
    // A waiter surviving teardown would resolve a start that never happened.
    jest.useFakeTimers();
    try {
      const h = makeHarness({ advertising: 'hang' });
      const advertising = h.transport.startPeripheral({ displayName: 'X' });
      const settled = expect(advertising).rejects.toBeDefined();

      await h.transport.shutdown();
      // Firing the event now must not throw or resurrect anything.
      expect(() => h.confirmAdvertising()).not.toThrow();

      await jest.advanceTimersByTimeAsync(9_000);
      await settled;
    } finally {
      jest.useRealTimers();
    }
  });
});
