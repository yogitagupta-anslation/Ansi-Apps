import type {Place, VehicleKind} from '../types';

/**
 * The vehicle kinds, and what each one is for.
 *
 * Ordered cheapest first, which is also how somebody in a hurry scans the list: the
 * question is usually "what is the least I can spend to get there", and the answer is
 * near the top.
 */
export interface VehicleSpec {
  kind: VehicleKind;
  label: string;
  glyph: string;
  /** One line under the name. Says who it suits, not what it is. */
  blurb: string;
  seats: number;
}

export const VEHICLES: readonly VehicleSpec[] = [
  {kind: 'bike', label: 'Bike', glyph: '🛵', blurb: 'One passenger, quickest through traffic', seats: 1},
  {kind: 'auto', label: 'Auto', glyph: '🛺', blurb: 'Up to three, covered', seats: 3},
  {kind: 'cab', label: 'Cab', glyph: '🚕', blurb: 'Four seats, boot space', seats: 4},
  {kind: 'other', label: 'Other', glyph: '🚐', blurb: 'Anything else you drive', seats: 6},
];

export function vehicleSpec(kind: VehicleKind): VehicleSpec {
  return VEHICLES.find(v => v.kind === kind) ?? VEHICLES[1];
}

/** Offered on the language step. Short, and the ones actually spoken on these roads. */
export const LANGUAGES = [
  'Hindi',
  'English',
  'Punjabi',
  'Haryanvi',
  'Bengali',
  'Tamil',
  'Telugu',
  'Marathi',
  'Bhojpuri',
];

/**
 * Somewhere to go, before there is a map to search.
 *
 * These are the app's stand-in for geocoding: a short list of named places with fixed
 * positions on the schematic map. When offline map data lands, this becomes a search over
 * that data and `Place` keeps its shape — which is why the coordinates here are
 * normalised 0-1 rather than pretending to be real ones.
 */
export const PLACES: readonly Place[] = [
  {id: 'home', label: 'Home', detail: 'Sector 45', x: 0.22, y: 0.72, saved: true},
  {id: 'work', label: 'Office', detail: 'Cyber Hub', x: 0.74, y: 0.28, saved: true},
  {id: 'pg', label: 'PG', detail: 'Sikanderpur', x: 0.36, y: 0.44, saved: true},
  {id: 'metro', label: 'Metro station', detail: 'Huda City Centre', x: 0.58, y: 0.62},
  {id: 'mall', label: 'Ambience Mall', detail: 'NH-8', x: 0.82, y: 0.55},
  {id: 'station', label: 'Railway station', detail: 'Gurugram', x: 0.14, y: 0.34},
  {id: 'hospital', label: 'Medanta', detail: 'Sector 38', x: 0.46, y: 0.86},
  {id: 'airport', label: 'Airport', detail: 'Terminal 3', x: 0.92, y: 0.14},
  {id: 'market', label: 'Sadar Bazaar', detail: 'Old city', x: 0.28, y: 0.18},
  {id: 'park', label: 'Leisure Valley Park', detail: 'Sector 29', x: 0.62, y: 0.4},
];

/** Where a passenger is standing, until there is a positioning source. */
export const CURRENT_LOCATION: Place = {
  id: 'here',
  label: 'Current location',
  detail: 'Your pickup',
  x: 0.4,
  y: 0.58,
};

export function searchPlaces(query: string): Place[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return PLACES.filter(p => p.saved);
  }
  return PLACES.filter(p =>
    `${p.label} ${p.detail ?? ''}`.toLowerCase().includes(needle),
  );
}
