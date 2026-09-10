import {hitchRadio, type RadioStatus} from '../ble/HitchRadio';
import {canSendRequests, sendRideRequest, type RequestOutcome} from '../ble/RideLink';
import type {RideRequestMessage} from '../ble/protocol';
import type {NearbyRide, Proximity, VehicleKind} from '../types';
import {simulatedFleet, simulatedRequest} from './simulation';

/**
 * Where nearby vehicles come from.
 *
 * PHASE 2 LANDED HERE AND NOWHERE ELSE. This module's exports are unchanged —
 * `subscribeNearby`, `requestRide`, `byUsefulness`, `PROXIMITY_LABEL` — so Nearby, Ride,
 * the map and the vehicle sheet consume exactly what they did before and were not edited.
 * That was the point of drawing the seam here in Phase 1.
 *
 * What changed is what sits behind it: a real BLE scan (`ble/HitchRadio`) rather than a
 * generated street. Vehicles are now phones that are actually advertising, their names
 * come off the air, and their proximity is a smoothed reading of real signal strength.
 *
 * THE FALLBACK IS DELIBERATE AND IT IS NOT A CHEAT. An emulator has no Bluetooth radio; a
 * phone can have Bluetooth switched off or the permission refused. In each of those cases
 * a real scan correctly returns nothing, and a screen showing an empty street is
 * indistinguishable from a quiet road. So when the radio reports it cannot run, this falls
 * back to the simulated fleet AND SAYS SO — `isSimulated()` drives the "Simulated" badge
 * that every screen already renders. The badge was built in Phase 1 for exactly this
 * moment: the one thing a viewer cannot check by eye is whether the vehicles are real.
 */

export type {RadioStatus};

/** Live view of whether what is on screen came off a radio or out of a generator. */
let simulating = false;

export function isSimulated(): boolean {
  return simulating;
}

/**
 * Watch the vehicles around you.
 *
 * Contract unchanged from Phase 1: emits immediately, emits again as the street changes,
 * returns an unsubscribe. Callers cannot tell which source they are on, and do not need
 * to — except through `isSimulated`, which exists so the UI can be honest.
 */
export function subscribeNearby(
  onChange: (rides: NearbyRide[]) => void,
): () => void {
  let stopSimulation: (() => void) | null = null;
  let stopRadio: (() => void) | null = null;
  let disposed = false;

  const useSimulation = () => {
    if (disposed || stopSimulation) {
      return;
    }
    simulating = true;
    stopSimulation = simulatedFleet(onChange);
  };

  const dropSimulation = () => {
    stopSimulation?.();
    stopSimulation = null;
    simulating = false;
  };

  // The radio's own verdict decides the source, and it can change while a screen is open
  // — somebody switches Bluetooth on, or grants the permission from the settings screen.
  const stopStatus = hitchRadio.onStatus((status: RadioStatus) => {
    if (disposed) {
      return;
    }
    if (status === 'scanning') {
      dropSimulation();
      return;
    }
    if (status === 'unsupported' || status === 'poweredOff' || status === 'unauthorized') {
      useSimulation();
    }
  });

  stopRadio = hitchRadio.subscribe(rides => {
    if (!disposed && !simulating) {
      onChange(rides);
    }
  });

  return () => {
    disposed = true;
    stopStatus();
    stopRadio?.();
    dropSimulation();
  };
}

/**
 * Ask the closest suitable rider — Phase 3, over a real link where there is one.
 *
 * The old signature is kept for the simulated path, and `askRider` below is the real one.
 * A caller that has a live radio uses that and gets somebody's actual decision; a caller
 * on an emulator falls through to here and gets the generated answer, flagged as before.
 */
export function requestRide(
  candidates: NearbyRide[],
  kind: VehicleKind,
): Promise<NearbyRide | null> {
  return simulatedRequest(candidates, kind);
}

/** Whether a request would reach a person, or be answered by the generator. */
export function canAskForReal(): boolean {
  return canSendRequests && !simulating;
}

/**
 * Send a request to one specific rider and wait for them to answer it.
 *
 * This is the Phase 3 seam. It resolves with what actually happened — accepted, declined,
 * unreachable, or nobody looked at their phone — rather than a rider or null, because
 * those four outcomes need four different things said to the passenger and collapsing
 * them into "no match" is how an app ends up blaming the radio for a human "no".
 */
export async function askRider(
  ride: NearbyRide,
  request: Omit<RideRequestMessage, 't' | 'v' | 'id'>,
): Promise<RequestOutcome> {
  const address = hitchRadio.addressFor(ride.peerId);
  if (!address) {
    return {status: 'unreachable', reason: 'They are no longer in range.'};
  }
  return sendRideRequest(address, request);
}

export type {RequestOutcome};

/** Human wording for a proximity band. The app never converts these to metres. */
export const PROXIMITY_LABEL: Record<Proximity, string> = {
  veryClose: 'Very close',
  near: 'Nearby',
  far: 'Further away',
};

/** Sort order for a list: available first, then closest. */
export function byUsefulness(a: NearbyRide, b: NearbyRide): number {
  const rank: Record<Proximity, number> = {veryClose: 0, near: 1, far: 2};
  if (a.available !== b.available) {
    return a.available ? -1 : 1;
  }
  return rank[a.proximity] - rank[b.proximity];
}

/**
 * Go on air as a rider, so passengers nearby can find you.
 *
 * Returns what actually happened. A rider who believes they are online while nothing is
 * advertising will sit waiting for a request that cannot arrive, so a refusal is reported
 * rather than swallowed.
 */
export async function goOnline(
  peerIdPrefix: string,
  displayName: string,
  vehicleKind: VehicleKind,
  carriesParcels: boolean,
): Promise<{ok: boolean; reason?: string}> {
  return hitchRadio.advertise(peerIdPrefix, displayName, {
    role: 'rider',
    vehicleKind,
    available: true,
    carriesParcels,
  });
}

export async function goOffline(): Promise<void> {
  await hitchRadio.stopAdvertising();
}

export function radioStatus(): RadioStatus {
  return hitchRadio.getStatus();
}
