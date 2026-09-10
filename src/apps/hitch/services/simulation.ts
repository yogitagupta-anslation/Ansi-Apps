import {byUsefulness} from './discovery';
import type {NearbyRide, Proximity, VehicleKind} from '../types';

/**
 * The generated street, kept for the cases where a radio genuinely cannot run.
 *
 * This was the whole of discovery in Phase 1. Now that the scan is real it has one job:
 * an emulator has no Bluetooth, and a phone can have it switched off or the permission
 * refused. In every one of those cases a real scan correctly returns nothing, and an empty
 * Nearby screen looks exactly like a quiet road — so the app falls back to this AND says
 * so, through the "Simulated" badge on every screen that lists vehicles.
 *
 * It is deliberately in its own file now. When discovery was simulated, mixing the two was
 * unavoidable; now that it is not, keeping the generator beside the radio would make it
 * easy to reach for by accident.
 */

const FIRST_NAMES = [
  'Rahul', 'Ankit', 'Suresh', 'Imran', 'Vikas', 'Deepak', 'Manoj', 'Farhan',
  'Sunil', 'Rakesh', 'Amit', 'Jaspreet', 'Naveen', 'Sameer',
];

const MODELS: Record<VehicleKind, string[]> = {
  bike: ['Splendor', 'Pulsar 150', 'Activa 6G', 'Apache RTR'],
  auto: ['Bajaj RE', 'Piaggio Ape', 'TVS King'],
  cab: ['Swift Dzire', 'WagonR', 'Aura', 'Tiago'],
  other: ['Tempo'],
};

const COLOURS: Record<VehicleKind, string[]> = {
  bike: ['Black', 'Red', 'Blue'],
  auto: ['Green & yellow', 'Black & yellow'],
  cab: ['White', 'Silver', 'Grey'],
  other: ['White'],
};

function seeded(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function pick<T>(list: T[], seed: string, salt: number): T {
  return list[Math.floor(seeded(seed, salt) * list.length) % list.length];
}

function plateFor(seed: string): string {
  const digits = Math.floor(seeded(seed, 7) * 9000) + 1000;
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const a = letters[Math.floor(seeded(seed, 8) * letters.length)];
  const b = letters[Math.floor(seeded(seed, 9) * letters.length)];
  const district = String(Math.floor(seeded(seed, 10) * 80) + 10).padStart(2, '0');
  return `HR ${district} ${a}${b} ${digits}`;
}

const BANDS: Proximity[] = ['veryClose', 'near', 'far'];

function makeRide(index: number, kind: VehicleKind): NearbyRide {
  const peerId = `sim-${kind}-${index}`;
  return {
    peerId,
    riderName: pick(FIRST_NAMES, peerId, 1),
    vehicle: {
      kind,
      registration: plateFor(peerId),
      model: pick(MODELS[kind], peerId, 2),
      colour: pick(COLOURS[kind], peerId, 3),
      photos: [],
    },
    proximity: BANDS[Math.floor(seeded(peerId, 4) * 3)],
    available: seeded(peerId, 5) > 0.3,
    bearing: Math.floor(seeded(peerId, 6) * 360),
    ridesTogether: seeded(peerId, 11) > 0.85 ? 1 : undefined,
  };
}

const FLEET: Record<VehicleKind, number> = {bike: 8, auto: 5, cab: 2, other: 0};

function fullFleet(): NearbyRide[] {
  const out: NearbyRide[] = [];
  (Object.keys(FLEET) as VehicleKind[]).forEach(kind => {
    for (let i = 0; i < FLEET[kind]; i++) {
      out.push(makeRide(i, kind));
    }
  });
  return out;
}

/** The Phase 1 stream, unchanged: vehicles arrive over a few seconds, then churn. */
export function simulatedFleet(
  onChange: (rides: NearbyRide[]) => void,
): () => void {
  let alive = true;
  const fleet = fullFleet();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const revealed: NearbyRide[] = [];

  fleet.forEach((ride, i) => {
    timers.push(
      setTimeout(() => {
        if (!alive) {
          return;
        }
        revealed.push(ride);
        onChange([...revealed]);
      }, 120 + i * 180),
    );
  });

  const churn = setInterval(() => {
    if (!alive || revealed.length === 0) {
      return;
    }
    const i = Math.floor(Math.random() * revealed.length);
    revealed[i] = {...revealed[i], available: !revealed[i].available};
    onChange([...revealed]);
  }, 6000);

  return () => {
    alive = false;
    timers.forEach(clearTimeout);
    clearInterval(churn);
  };
}

/**
 * Accepting a request, still simulated.
 *
 * Discovery is real; the request is not yet. Sending one means opening a GATT connection
 * to the chosen peer and waiting for a person to tap Accept — the connection layer exists
 * in this repo, but the request packet and the rider-side prompt do not. Until they do,
 * this picks from REAL peers and fakes only the answer.
 */
export function simulatedRequest(
  candidates: NearbyRide[],
  kind: VehicleKind,
): Promise<NearbyRide | null> {
  const suitable = candidates
    .filter(r => r.vehicle.kind === kind && r.available)
    .sort(byUsefulness);
  return new Promise(resolve => {
    setTimeout(() => resolve(suitable[0] ?? null), 2600);
  });
}
