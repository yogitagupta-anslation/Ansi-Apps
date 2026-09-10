import AsyncStorage from '@react-native-async-storage/async-storage';
import {create} from 'zustand';

import type {
  Profile,
  Ride,
  RideHistoryEntry,
  RiderDetails,
  Role,
} from '../types';

/**
 * Everything Hitch remembers, and the one place it is remembered.
 *
 * All of it is local. There is no account, no sync and nowhere for any of this to be
 * uploaded to — which is not a limitation of the prototype but the point of the app: two
 * phones that can find each other over a radio do not need a company in between.
 *
 * Persistence is deliberately coarse. One JSON blob under one key, written after any
 * change that matters, because the whole state is a few kilobytes and a granular scheme
 * would be machinery in service of nothing.
 */

const KEY = '@hitch/state';

interface Persisted {
  role: Role | null;
  onboarded: boolean;
  profile: Profile | null;
  rider: RiderDetails | null;
  online: boolean;
  history: RideHistoryEntry[];
}

interface HitchState extends Persisted {
  /** False until the first read finishes, so the app can hold the splash rather than
   *  flashing onboarding at somebody who has already done it. */
  hydrated: boolean;
  /** The ride in progress, if any. Never persisted: a ride is a live thing between two
   *  phones, and restoring one from disk would claim a link that is not there. */
  ride: Ride | null;

  hydrate: () => Promise<void>;
  setRole: (role: Role) => void;
  completeOnboarding: (profile: Profile, rider?: RiderDetails) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  updateRider: (patch: Partial<RiderDetails>) => void;
  setOnline: (online: boolean) => void;
  setRide: (ride: Ride | null) => void;
  finishRide: (rating: number | null) => void;
  reset: () => void;
}

const EMPTY: Persisted = {
  role: null,
  onboarded: false,
  profile: null,
  rider: null,
  online: false,
  history: [],
};

function persist(state: HitchState): void {
  const snapshot: Persisted = {
    role: state.role,
    onboarded: state.onboarded,
    profile: state.profile,
    rider: state.rider,
    online: state.online,
    history: state.history,
  };
  void AsyncStorage.setItem(KEY, JSON.stringify(snapshot)).catch(() => undefined);
}

export const useHitch = create<HitchState>((set, get) => ({
  ...EMPTY,
  hydrated: false,
  ride: null,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Persisted>;
        set({
          ...EMPTY,
          ...saved,
          // A rider who was online when the app died is not online now: nothing has been
          // advertising in the meantime, and showing "You're online" over a dead radio is
          // the kind of small lie that costs somebody a ride.
          online: false,
          hydrated: true,
        });
        return;
      }
    } catch {
      // A corrupt blob is not worth failing to launch over; first run is the safe
      // fallback and the user loses a profile rather than the app.
    }
    set({...EMPTY, hydrated: true});
  },

  setRole: role => {
    set({role});
    persist(get());
  },

  completeOnboarding: (profile, rider) => {
    set({profile, rider: rider ?? get().rider, onboarded: true});
    persist(get());
  },

  updateProfile: patch => {
    const current = get().profile;
    if (!current) {
      return;
    }
    set({profile: {...current, ...patch}});
    persist(get());
  },

  updateRider: patch => {
    const current = get().rider;
    if (!current) {
      return;
    }
    set({rider: {...current, ...patch}});
    persist(get());
  },

  setOnline: online => {
    set({online});
    persist(get());
  },

  setRide: ride => set({ride}),

  /**
   * End the ride and keep the receipt.
   *
   * The entry is flattened rather than storing the whole Ride: history has to survive
   * every future change to the live-ride model, and a rider's peer id in last month's
   * list is a reference to a link that no longer exists.
   */
  finishRide: rating => {
    const ride = get().ride;
    if (!ride) {
      return;
    }
    const entry: RideHistoryEntry = {
      id: ride.id,
      mode: ride.mode,
      at: Date.now(),
      kind: ride.kind,
      fromLabel: ride.route.from.label,
      toLabel: ride.route.to.label,
      fare: ride.fare,
      rating,
      riderName: ride.rider?.riderName ?? 'Rider',
    };
    set({ride: null, history: [entry, ...get().history].slice(0, 100)});
    persist(get());
  },

  reset: () => {
    set({...EMPTY, hydrated: true, ride: null});
    void AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
}));
