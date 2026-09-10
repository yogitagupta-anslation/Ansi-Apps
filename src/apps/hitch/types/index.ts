/**
 * What this app is about, as types.
 *
 * Hitch matches a passenger with a rider using nothing but the radios in their two
 * phones. That constraint shapes every type here, and the shape worth noticing is what is
 * ABSENT: there are no latitudes, no longitudes, and no distances in metres. Bluetooth
 * reports how strong a signal is, which is a fuzzy, noisy, obstruction-dependent proxy
 * for "how close" — so the model carries proximity as a band ('veryClose' | 'near' |
 * 'far') rather than a number, and the UI can never accidentally print "200 m away"
 * because there is nowhere for that number to come from.
 *
 * Places and routes are the exception, and they are quarantined behind services/routing.
 * A pickup and a destination genuinely are points on a map; the app just has no online
 * map to resolve them against yet. See that file for how the seam is drawn.
 */

/** Which side of a ride this phone is on. Stored locally; switchable in Profile. */
export type Role = 'passenger' | 'rider';

/**
 * What is being moved: a person, or a thing.
 *
 * The two flows share pickup, drop, vehicle choice and matching. They diverge on the one
 * fact that changes everything downstream — a parcel has a receiver at the far end who is
 * not in this conversation and may not have the app.
 */
export type RideMode = 'ride' | 'parcel';

export type VehicleKind = 'bike' | 'auto' | 'cab' | 'other';

/**
 * How close something is, as the radio can actually tell it.
 *
 * Three bands rather than a distance. Signal strength swings with the phone model, the
 * pocket it is in and the person standing between the two — so a band is the finest
 * distinction that survives contact with a real street, and the widest one that is still
 * useful for "walk towards them".
 */
export type Proximity = 'veryClose' | 'near' | 'far';

/** A person, as the other phone sees them. */
export interface Profile {
  /** sha256 of the identity public key, shortened. Not a phone number, not an account. */
  id: string;
  name: string;
  /** Kept on this device only. Never advertised; used for the call button and nothing else. */
  phone: string;
  photoUri: string | null;
  languages: string[];
  /** Passenger only, and local: whom to call, not whom to broadcast. */
  emergencyContact?: string;
}

export interface Vehicle {
  kind: VehicleKind;
  /** "HR 26 AB 1234". Displayed so a passenger can identify the actual vehicle. */
  registration: string;
  model: string;
  colour: string;
  /** Front, side, and anything else. Local file URIs; photos never leave the phone. */
  photos: string[];
}

export interface RiderDetails {
  vehicle: Vehicle;
  /** Years. A claim the rider makes about themselves, shown as one. */
  experienceYears: number;
  acceptsPassengers: boolean;
  showNearbyRequests: boolean;
}

/**
 * A vehicle heard over the radio.
 *
 * `proximity` is the honest positional fact. `bearing` is a stable pseudo-angle derived
 * from the peer id — it exists so the map can place icons around you without them
 * jittering between frames, and it is explicitly NOT a direction. The map says so.
 */
export interface NearbyRide {
  peerId: string;
  riderName: string;
  vehicle: Vehicle;
  proximity: Proximity;
  /** True when the rider is online and not already carrying somebody. */
  available: boolean;
  /** 0-360, stable per peer. A seat on the dial, not a heading. */
  bearing: number;
  /** Set once a ride with this rider has been completed before. */
  ridesTogether?: number;
}

/** A named point. Until offline routing lands, these come from the saved/recent list. */
export interface Place {
  id: string;
  label: string;
  /** A free-text address. No geocoding yet — see services/routing.ts. */
  detail?: string;
  /** Normalised 0-1 coordinates on the schematic map. Replaced by real ones later. */
  x: number;
  y: number;
  /** Marks Home / Work / PG so they can lead the recents row. */
  saved?: boolean;
}

/**
 * The output of `getRoute`, and the only thing the UI consumes.
 *
 * Deliberately dumb: a polyline plus two summary numbers. An offline routing engine
 * produces exactly this, so swapping the implementation changes no screen.
 */
export interface Route {
  from: Place;
  to: Place;
  /** Normalised 0-1 points, in order. The map scales them to whatever size it is. */
  points: Array<{x: number; y: number}>;
  /** Kilometres. An estimate, and labelled as one everywhere it is shown. */
  distanceKm: number;
  /** Minutes, same caveat. */
  durationMin: number;
}

/**
 * Where a ride has got to.
 *
 * One flat union rather than booleans, because the states are genuinely exclusive and the
 * screen renders one of them. 'searching' covers Bluetooth discovery, which is the step
 * that has no equivalent in an online ride app and takes real, visible time.
 */
export type RideStatus =
  | 'idle'
  | 'choosing'
  | 'searching'
  | 'requested'
  | 'accepted'
  | 'arriving'
  | 'riding'
  | 'completed'
  | 'cancelled';

export interface Ride {
  id: string;
  mode: RideMode;
  status: RideStatus;
  route: Route;
  kind: VehicleKind;
  /** Set once a rider accepts. Null while searching. */
  rider: NearbyRide | null;
  /** Set only when `mode` is parcel. */
  parcel?: ParcelDetails;
  requestedAt: number;
  completedAt?: number;
  /** Rupees. An estimate until the ride ends, then what was agreed. */
  fare: number;
  rating?: number;
}

/**
 * The extra facts a parcel needs and a ride does not.
 *
 * Attached to a Ride rather than modelled separately: the route, the vehicle, the matching
 * and the fare all behave identically, and a parallel type would duplicate every one of
 * them to express a handful of additional fields.
 */
export interface ParcelDetails {
  /** What is in the bag, in the sender's words. The rider is told before accepting. */
  contents: string;
  size: import('../config/parcel').ParcelSize;
  receiverName: string;
  /** Local only, handed to the rider on match so they can call at the door. */
  receiverPhone: string;
  /**
   * Four digits the receiver gives the rider to close the delivery.
   *
   * Generated when the parcel is booked and shown to the sender, who passes it to the
   * receiver however they like. With no server and no tracking, this is the whole of the
   * proof that the right person got it.
   */
  handoverCode: string;
  /** The sender ticked the prohibited-items list. Recorded because it was asked. */
  confirmedAllowed: boolean;
}

/** A completed ride, kept on this phone. There is no server to sync it to. */
export interface RideHistoryEntry {
  id: string;
  mode: RideMode;
  at: number;
  kind: VehicleKind;
  fromLabel: string;
  toLabel: string;
  fare: number;
  rating: number | null;
  riderName: string;
}
