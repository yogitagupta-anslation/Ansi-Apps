import type {VehicleKind} from '../types';

/**
 * Sending a thing instead of a person.
 *
 * The flow is the same shape as a ride — pickup, drop, pick a vehicle, wait — and the
 * differences are all consequences of one fact: THERE IS A THIRD PERSON. A ride has a
 * passenger who is present the whole way. A parcel has a sender who hands it over, a
 * rider who carries it, and a receiver at the other end who may never have heard of this
 * app. Everything below exists because of that gap.
 *
 * What Rapido, Uber Connect and Ola Parcel all do, and why each is here:
 *
 *  - Receiver name and phone are mandatory. Rapido and Ola both take them at booking;
 *    Uber activates the delivery PIN only once they are filled in. Without them the rider
 *    arrives at an address with nobody to hand anything to.
 *  - A weight cap per vehicle. Rapido caps a bike parcel at 5 kg, Uber at about 13.
 *    A cap is not a formality: it decides whether the thing physically fits.
 *  - Prohibited items, confirmed by the sender before booking rather than buried in terms.
 *    Uber makes it an explicit agreement, and it is the one screen a courier service
 *    genuinely cannot skip — the rider is the one who carries the legal risk.
 *  - A handover code. Uber calls it a delivery PIN; it is how the rider proves they gave
 *    the parcel to the right person.
 *
 * The handover code matters MORE here than in any of those apps, not less. They can fall
 * back on a server: live tracking, a photo uploaded at the door, support staff who can see
 * both sides. Hitch has none of that — there is no server and no internet — so a code the
 * sender reads out and the receiver repeats is the entire proof of delivery. It is also
 * the one mechanism in this design that works perfectly with no network at all.
 */

export type ParcelSize = 'small' | 'medium' | 'large';

export interface ParcelSizeSpec {
  id: ParcelSize;
  label: string;
  /** Something the reader can picture, rather than dimensions in centimetres. */
  example: string;
  /** Upper bound in kilograms. The number the vehicle cap is compared against. */
  maxKg: number;
  glyph: string;
}

export const PARCEL_SIZES: readonly ParcelSizeSpec[] = [
  {id: 'small', label: 'Small', example: 'Documents, keys, a phone', maxKg: 2, glyph: '✉️'},
  {id: 'medium', label: 'Medium', example: 'A shoebox, a laptop bag', maxKg: 5, glyph: '📦'},
  {id: 'large', label: 'Large', example: 'A carton, a small suitcase', maxKg: 15, glyph: '🧳'},
];

export function parcelSizeSpec(size: ParcelSize): ParcelSizeSpec {
  return PARCEL_SIZES.find(s => s.id === size) ?? PARCEL_SIZES[0];
}

/**
 * What each vehicle will actually carry.
 *
 * Bike at 5 kg follows Rapido's own limit, which exists because the rider holds the parcel
 * between their feet or in a backpack. An auto has floor space; a cab has a boot. These
 * are the numbers that decide which options a sender is even offered.
 */
export const CARRY_LIMIT_KG: Record<VehicleKind, number> = {
  bike: 5,
  auto: 15,
  cab: 25,
  other: 25,
};

export function canCarry(kind: VehicleKind, size: ParcelSize): boolean {
  return CARRY_LIMIT_KG[kind] >= parcelSizeSpec(size).maxKg;
}

/**
 * The list the sender has to confirm they are not sending.
 *
 * Kept short and concrete. A wall of legal text gets agreed to without being read, which
 * defeats the purpose — the point is that somebody actually thinks for two seconds about
 * what is in the bag before a stranger puts it on their bike.
 */
export const PROHIBITED = [
  'Anything illegal to carry or sell',
  'Cash, gold, or anything you could not replace',
  'Alcohol, tobacco, or medicines',
  'Anything that could catch fire or leak',
  'Live animals',
] as const;

/**
 * A four-digit handover code.
 *
 * Read out by the sender, repeated by the receiver, typed by the rider. Four digits
 * because it has to be said aloud across a doorway and remembered for the length of that
 * sentence; longer is not meaningfully harder to guess when there is exactly one attempt
 * and the rider is standing in front of you.
 *
 * Math.random is right here and a cryptographic source would be theatre: this is not a
 * secret being protected from an attacker, it is a check that the rider found the right
 * person. The threat it addresses is a wrong door, not an adversary.
 */
export function handoverCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Parcel fares, per kilometre.
 *
 * Lower than the same vehicle carrying a person — Ola Parcel starts around ₹25 for 5 km,
 * well under a passenger fare for the same distance — because the rider is carrying a bag
 * rather than a person, and because the two markets price differently. Bigger parcels cost
 * more on the same vehicle: it is the space that is being sold.
 */
export const PARCEL_BASE: Record<VehicleKind, number> = {
  bike: 20,
  auto: 30,
  cab: 50,
  other: 30,
};

export const PARCEL_PER_KM: Record<VehicleKind, number> = {
  bike: 5,
  auto: 8,
  cab: 12,
  other: 8,
};

const SIZE_MULTIPLIER: Record<ParcelSize, number> = {
  small: 1,
  medium: 1.15,
  large: 1.4,
};

export function estimateParcelFare(
  kind: VehicleKind,
  distanceKm: number,
  size: ParcelSize,
): number {
  const base = PARCEL_BASE[kind] ?? PARCEL_BASE.auto;
  const perKm = PARCEL_PER_KM[kind] ?? PARCEL_PER_KM.auto;
  const raw = (base + perKm * distanceKm) * SIZE_MULTIPLIER[size];
  // Rounded to five rupees, for the same reason a ride fare is: the distance behind it is
  // an estimate, and a total given to the rupee would imply otherwise.
  return Math.round(raw / 5) * 5;
}
