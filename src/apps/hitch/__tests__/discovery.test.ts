/**
 * The discovery contract, now that Phase 2 has landed behind it.
 *
 * These tests were written in Phase 1 against a simulated street. The point of them was
 * never the simulation — it was the SHAPE every screen consumes, and that shape has not
 * changed now that a real radio sits behind it. So they still assert the same things, and
 * the fact that they pass unedited is the evidence that Nearby, Ride, the map and the
 * vehicle sheet did not need touching.
 *
 * In a test environment there is no Bluetooth, so `subscribeNearby` correctly falls back
 * to the generated fleet and reports `isSimulated() === true`. That fallback is itself
 * under test below: an empty street and a broken radio look identical on screen, and the
 * app has to be able to tell the difference and say which it is.
 */
import {
  PROXIMITY_LABEL,
  byUsefulness,
  isSimulated,
  radioStatus,
  requestRide,
  subscribeNearby,
} from '../services/discovery';
import type {NearbyRide, Proximity} from '../types';

jest.useRealTimers();

function collect(ms: number): Promise<NearbyRide[]> {
  return new Promise(resolve => {
    let latest: NearbyRide[] = [];
    const stop = subscribeNearby(rides => {
      latest = rides;
    });
    setTimeout(() => {
      stop();
      resolve(latest);
    }, ms);
  });
}

describe('discovering vehicles', () => {
  it('reports vehicles as they are heard rather than all at once', async () => {
    const early = await collect(400);
    const later = await collect(2000);
    expect(early.length).toBeGreaterThan(0);
    expect(later.length).toBeGreaterThan(early.length);
  }, 15_000);

  it('stops working when unsubscribed', async () => {
    let calls = 0;
    const stop = subscribeNearby(() => {
      calls += 1;
    });
    await new Promise(r => setTimeout(r, 400));
    const atStop = calls;
    stop();
    await new Promise(r => setTimeout(r, 600));
    // A screen that goes away must not leave a scan running behind it.
    expect(calls).toBe(atStop);
  }, 15_000);

  it('gives every vehicle everything a passenger needs to identify it', async () => {
    const rides = await collect(2000);
    for (const ride of rides) {
      expect(ride.riderName.length).toBeGreaterThan(1);
      expect(['bike', 'auto', 'cab', 'other']).toContain(ride.vehicle.kind);
      expect(typeof ride.peerId).toBe('string');
    }
  }, 15_000);

  it('describes closeness as a band and never as a distance', async () => {
    const rides = await collect(2000);
    const bands: Proximity[] = ['veryClose', 'near', 'far'];
    for (const ride of rides) {
      expect(bands).toContain(ride.proximity);
      // The whole model: there is no metre reading anywhere for the UI to leak.
      expect(ride).not.toHaveProperty('distanceMeters');
      expect(ride).not.toHaveProperty('lat');
      expect(ride).not.toHaveProperty('lng');
      expect(ride).not.toHaveProperty('rssi');
    }
  }, 15_000);

  it('keeps a vehicle on the same seat of the dial between updates', async () => {
    const first = await collect(2000);
    const second = await collect(2000);
    for (const ride of first) {
      const twin = second.find(r => r.peerId === ride.peerId);
      expect(twin?.bearing).toBe(ride.bearing);
    }
  }, 20_000);
});

describe('being honest about the source', () => {
  it('says it is simulating when there is no radio to scan with', async () => {
    // There is no Bluetooth in a test environment, and there is none on an emulator
    // either. A real scan correctly returns nothing in both cases — and an empty Nearby
    // screen is indistinguishable from a quiet street, which is why the app falls back
    // AND flags it rather than silently showing an empty road.
    //
    // Read while the subscription is live, which is when a screen reads it. With nothing
    // subscribed the answer is false, because nothing is being shown at all.
    const stop = subscribeNearby(() => undefined);
    await new Promise(r => setTimeout(r, 600));
    expect(isSimulated()).toBe(true);
    stop();
    // And it stops claiming to simulate once the screen has gone.
    expect(isSimulated()).toBe(false);
  }, 15_000);

  it('reports a radio status the UI can act on', () => {
    expect(['unsupported', 'poweredOff', 'unauthorized', 'scanning', 'idle']).toContain(
      radioStatus(),
    );
  });
});

describe('ordering a list of rides', () => {
  const make = (id: string, proximity: Proximity, available: boolean): NearbyRide => ({
    peerId: id,
    riderName: 'X',
    vehicle: {kind: 'auto', registration: 'HR 26 AA 0001', model: '', colour: '', photos: []},
    proximity,
    available,
    bearing: 0,
  });

  it('puts available vehicles before busy ones', () => {
    const sorted = [make('a', 'veryClose', false), make('b', 'far', true)].sort(byUsefulness);
    // A busy auto two metres away is no use; an available one down the road is.
    expect(sorted[0].peerId).toBe('b');
  });

  it('puts the closest available one first', () => {
    const sorted = [
      make('far', 'far', true),
      make('close', 'veryClose', true),
      make('near', 'near', true),
    ].sort(byUsefulness);
    expect(sorted.map(r => r.peerId)).toEqual(['close', 'near', 'far']);
  });
});

describe('asking for a ride', () => {
  const auto = (id: string, available: boolean): NearbyRide => ({
    peerId: id,
    riderName: 'Rahul',
    vehicle: {kind: 'auto', registration: 'HR 26 AA 0002', model: '', colour: '', photos: []},
    proximity: 'near',
    available,
    bearing: 10,
  });

  it('returns the nearest suitable rider', async () => {
    const match = await requestRide([auto('busy', false), auto('free', true)], 'auto');
    expect(match?.peerId).toBe('free');
  }, 15_000);

  it('returns null when nothing suitable is around', async () => {
    const match = await requestRide([auto('free', true)], 'cab');
    expect(match).toBeNull();
  }, 15_000);
});

describe('proximity wording', () => {
  it('never says a number', () => {
    for (const label of Object.values(PROXIMITY_LABEL)) {
      expect(label).not.toMatch(/\d/);
    }
  });
});
