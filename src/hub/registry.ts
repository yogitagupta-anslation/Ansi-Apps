/**
 * The registry is the single source of truth for what the store can launch.
 *
 * Everything else — the grid, the search index, the category chips, the recents
 * rail, the featured slot, the detail page, the route table in App.tsx — is
 * derived from this list. Adding a sixth app is therefore one entry here plus one
 * lazy component; no other file needs to learn its name.
 *
 * A NOTE ON METADATA. Every field below is either editorial copy or a fact that
 * can be checked against the app's own source. There are deliberately no ratings,
 * review counts, download counts or install numbers: nobody has rated these apps,
 * so a number in that shape would be a decoration pretending to be a measurement.
 * Usage figures ("opened 12 times", "yesterday") are real and come from
 * `usage.ts`, which records them locally as apps are launched.
 */

import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { ImageSourcePropType } from 'react-native';

export type AppId =
  | 'blechat'
  | 'eventpulse'
  | 'higherlower'
  | 'attendance'
  | 'treasurehunt'
  | 'hitch';

/** A capability badge on a card. Both are facts about every app that carries them. */
export type AppBadge = 'bluetooth' | 'offline' | 'encrypted' | 'multiplayer';

export interface AppFeature {
  glyph: string;
  title: string;
  body: string;
}

export interface AppPermission {
  name: string;
  /** Why the app asks. Written plainly, because the detail page shows it verbatim. */
  why: string;
}

export interface HubApp {
  id: AppId;
  /** Shown on the card and in the shell strip. */
  name: string;
  /** One line under the name on the card. Keep it short — it is a chip, not a page. */
  tagline: string;
  /** The longer sentence, used by the featured card and by search. */
  description: string;
  icon: string;
  /** Drives the category chips; the first tag is the app's primary home. */
  tags: string[];
  accent: string;
  /** Same hue, low alpha — icon tiles and pressed states. */
  accentSoft: string;
  /** Extra words that should match in search but do not belong on the card. */
  keywords: string[];
  featured?: boolean;
  /** Capability badges. Derived from what the app actually does. */
  badges: AppBadge[];
  /** The detail page's long copy. */
  about: string;
  features: AppFeature[];
  permissions: AppPermission[];
  /**
   * Real artwork from the app's own asset folder. Only Treasure Hunt and
   * Attendance ship images; the rest render the fallback preview panel, which is
   * honest about there being nothing to show yet.
   */
  previews: ImageSourcePropType[];
  /**
   * Loaded on first launch, not at store startup. Each of these pulls in a whole
   * app — a BLE stack, a positioning engine, an audio bank — and the store has no
   * business paying for any of that before someone taps a card.
   */
  screen: ComponentType;
}

/** Every app here is bundled in this binary, so the version is the shell's. */
export const APP_VERSION = '1.0.0';

export const APPS: HubApp[] = [
  {
    id: 'blechat',
    name: 'BLE Chat',
    tagline: 'Offline messaging',
    description:
      'Encrypted peer-to-peer chat over Bluetooth Low Energy. No servers, no accounts, no internet — messages hop straight between phones in range.',
    icon: '💬',
    tags: ['Social', 'Tools', 'Experiments'],
    accent: '#A78BFA',
    accentSoft: 'rgba(167,139,250,0.16)',
    keywords: ['bluetooth', 'ble', 'chat', 'mesh', 'offline', 'encrypted', 'messaging', 'peers'],
    badges: ['bluetooth', 'offline', 'encrypted'],
    about:
      'BLE Chat turns two phones in the same room into a private network. Each device carries its own key pair, sessions are negotiated directly between peers, and a message exists only on the handsets that were present to receive it. Nothing is uploaded, because there is nowhere to upload it to.',
    features: [
      {
        glyph: '🔒',
        title: 'End-to-end encrypted',
        body: 'Every session is keyed between the two devices. Identities are held in the platform keystore.',
      },
      {
        glyph: '📡',
        title: 'Direct radio links',
        body: 'One phone acts as the GATT server, the other as the central. There is no access point in between.',
      },
      {
        glyph: '🧩',
        title: 'Fragmented delivery',
        body: 'Long messages are split, ordered and reassembled, so a message survives a link that only carries small frames.',
      },
      {
        glyph: '👥',
        title: 'Group conversations',
        body: 'Groups are local objects shared between the peers in range, not rooms hosted somewhere.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'the entire app; scanning, connecting and advertising to nearby phones' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
      { name: 'No network access', why: 'nothing typed here leaves the two devices' },
    ],
    previews: [],
    screen: lazy(() => import('../apps/blechat/BleChatApp')),
  },
  {
    id: 'eventpulse',
    name: 'EventPulse',
    tagline: 'Who is nearby, right now',
    description:
      'A live radar for conferences and meetups. See which attendees are around you, how far away they are, and who is worth walking over to meet.',
    icon: '🛰️',
    tags: ['Social', 'Experiments'],
    accent: '#38BDF8',
    accentSoft: 'rgba(56,189,248,0.16)',
    keywords: ['networking', 'event', 'conference', 'radar', 'map', 'attendees', 'proximity'],
    badges: ['bluetooth', 'offline'],
    about:
      'EventPulse reads the strength of nearby Bluetooth advertisements and turns them into a live map of the room. Positions are relative — it knows who is close, not where anyone is — so the map works in a basement conference hall with no signal at all.',
    features: [
      {
        glyph: '🛰️',
        title: 'Relative positioning',
        body: 'Signal strength is smoothed and solved into a layout of the room. No GPS is involved at any point.',
      },
      {
        glyph: '🧭',
        title: 'Orientation-aware map',
        body: 'The compass keeps the map pointing the way you are facing as you turn.',
      },
      {
        glyph: '🤝',
        title: 'Worth walking over',
        body: 'Matches attendees against your stated goals and surfaces the ones nearby right now.',
      },
      {
        glyph: '🙈',
        title: 'Visibility you control',
        body: 'Go invisible, or block an individual, and the change takes effect on the next advertisement.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'discovering and advertising to other attendees in the room' },
      { name: 'Motion and compass', why: 'keeping the event map oriented as you turn' },
      { name: 'Photos', why: 'optional profile picture. The image is cropped and resized on the device' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
    ],
    previews: [],
    screen: lazy(() => import('../apps/eventpulse/EventPulseApp')),
  },
  {
    id: 'higherlower',
    name: 'Higher or Lower',
    tagline: 'Guess the number',
    description:
      'A number-guessing race against the clock, a friend, or a daily challenge — with modifiers that change how much every guess costs you.',
    icon: '🎯',
    tags: ['Games'],
    accent: '#FBBF24',
    accentSoft: 'rgba(251,191,36,0.16)',
    keywords: ['game', 'guess', 'number', 'race', 'daily', 'multiplayer', 'higher', 'lower'],
    featured: true,
    badges: ['offline', 'multiplayer'],
    about:
      'Pick a number, get told higher or lower, and close the gap before your opponent does. Play it solo, take the same daily challenge everyone else gets, or race a phone in the same room over Bluetooth. Modifiers change what a wrong guess costs you.',
    features: [
      {
        glyph: '🏁',
        title: 'Three ways to play',
        body: 'Solo run, daily challenge, or head-to-head with a nearby phone.',
      },
      {
        glyph: '📡',
        title: 'Multiplayer over Bluetooth',
        body: 'No lobby server. Two phones in range are the whole network.',
      },
      {
        glyph: '⚙️',
        title: 'Guess modifiers',
        body: 'Each modifier changes how much a wrong guess costs you.',
      },
      {
        glyph: '🔊',
        title: 'Sound and haptics',
        body: 'Audio players load on open and are released when you leave.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'multiplayer only; solo and daily play need no radio' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
      { name: 'No network access', why: 'nothing about a game leaves the device' },
    ],
    previews: [],
    screen: lazy(() => import('../apps/higherlower/HigherLowerApp')),
  },
  {
    id: 'attendance',
    name: 'Bluetooth Attendance',
    tagline: 'Roll call over BLE',
    description:
      'Offline attendance for a room full of people. Employee phones broadcast an identifier, the host phone picks them up and records who was present — no backend, no cloud, no internet.',
    icon: '📋',
    tags: ['Work', 'Tools'],
    accent: '#34D399',
    accentSoft: 'rgba(52,211,153,0.16)',
    keywords: [
      'attendance',
      'bluetooth',
      'ble',
      'check-in',
      'employees',
      'host',
      'roll call',
      'reports',
      'offline',
    ],
    badges: ['bluetooth', 'offline'],
    about:
      'One phone runs as the host and listens; everyone else runs as an employee and advertises. Presence is recorded as people come into range and settled as they leave, and the month can be exported as a spreadsheet straight to the share sheet. The whole cycle happens without a network.',
    features: [
      {
        glyph: '📡',
        title: 'Host and employee roles',
        body: 'Employees advertise a short identifier; the host records who was in range and when.',
      },
      {
        glyph: '⏱️',
        title: 'Present, left, absent',
        body: 'A grace period decides when someone has actually left rather than briefly lost signal.',
      },
      {
        glyph: '📊',
        title: 'Monthly spreadsheet export',
        body: 'The month builds into a styled workbook and hands it to the share sheet as a real file.',
      },
      {
        glyph: '🔋',
        title: 'Keeps broadcasting',
        body: 'A foreground service keeps the advertisement on air, so a pocketed phone stays visible to the host.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'advertising as an employee and scanning as the host' },
      { name: 'Notifications', why: 'the ongoing notification the foreground service is required to show' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
    ],
    previews: [
      require('../apps/attendance/assets/no-employees-nearby.png'),
      require('../apps/attendance/assets/no-attendance-today.png'),
      require('../apps/attendance/assets/no-history.png'),
    ],
    screen: lazy(() => import('../apps/attendance/AttendanceApp')),
  },
  {
    id: 'treasurehunt',
    name: 'Treasure Hunt',
    tagline: 'Multiplayer hunt over BLE',
    description:
      'An offline multiplayer treasure hunt played in a virtual world. Bluetooth carries the game between phones and nothing else — no GPS, no maps, no backend.',
    icon: '🗺️',
    tags: ['Games'],
    accent: '#F472B6',
    accentSoft: 'rgba(244,114,182,0.16)',
    keywords: [
      'treasure',
      'hunt',
      'game',
      'multiplayer',
      'bluetooth',
      'ble',
      'lobby',
      'host',
      'offline',
      'compass',
    ],
    badges: ['bluetooth', 'offline', 'multiplayer'],
    about:
      'A host phone generates a world and the players in range join it over Bluetooth. Everyone moves through the same generated map, hunting the same chests, with the radio carrying every position and pickup between handsets. The world is virtual, so the game works in a room, a garden or a train carriage.',
    features: [
      {
        glyph: '🗺️',
        title: 'A generated world',
        body: 'Each match builds its own map from a shared seed, so every device draws the same world.',
      },
      {
        glyph: '🧭',
        title: 'Compass and proximity',
        body: 'A radar warms and cools as you close on a chest, without ever reading a real position.',
      },
      {
        glyph: '🎮',
        title: 'Five game modes',
        body: 'Individual, team, race, timed and shared-treasure hunts, each with its own scoring.',
      },
      {
        glyph: '📡',
        title: 'Reliable BLE mesh',
        body: 'Framing, acknowledgement and reconnection sit under the game, so a dropped link rejoins itself.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'hosting or joining a match with the phones around you' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
      { name: 'No network access', why: 'a match never leaves the phones playing it' },
    ],
    previews: [
      require('../apps/treasure-hunt/assets/bg-lobby.png'),
      require('../apps/treasure-hunt/assets/bg-world.png'),
      require('../apps/treasure-hunt/assets/bg-map.png'),
      require('../apps/treasure-hunt/assets/bg-results.png'),
    ],
    screen: lazy(() => import('../apps/treasure-hunt/TreasureHuntApp')),
  },
  {
    id: 'hitch',
    name: 'Hitch',
    tagline: 'Rides from phones nearby',
    description:
      'Find a ride from someone in the street around you over Bluetooth. No booking server, no account, no internet — the two phones are the whole system.',
    icon: '🛺',
    tags: ['Travel', 'Social'],
    accent: '#34D399',
    accentSoft: 'rgba(52,211,153,0.16)',
    keywords: [
      'ride',
      'rides',
      'auto',
      'rickshaw',
      'bike',
      'cab',
      'taxi',
      'travel',
      'passenger',
      'rider',
      'driver',
      'bluetooth',
      'offline',
      'commute',
    ],
    badges: ['bluetooth', 'offline'],
    about:
      'Hitch matches a passenger with a rider using nothing but the radios in their two phones. It shows what is around you by how strongly each vehicle is heard rather than by pinning it to a street, because proximity is what Bluetooth can honestly report — and it works in a basement car park, a power cut, or on a road with no signal at all.',
    features: [
      {
        glyph: '📡',
        title: 'Riders found over the radio',
        body: 'Vehicles are discovered directly between phones. There is no dispatch server in the middle.',
      },
      {
        glyph: '🗺️',
        title: 'A map that does not invent things',
        body: 'Vehicles sit on proximity rings rather than on streets. The radio knows near and far, never direction.',
      },
      {
        glyph: '🧑',
        title: 'Passenger or rider',
        body: 'Two onboarding flows and two home screens, switchable at any time from your profile.',
      },
      {
        glyph: '🔎',
        title: 'A vehicle you can identify',
        body: 'Number, model, colour and photos, so a passenger knows which vehicle is theirs before getting in.',
      },
    ],
    permissions: [
      { name: 'Bluetooth', why: 'finding riders nearby, and being findable as one' },
      { name: 'Photos', why: 'optional profile and vehicle pictures. They never leave the phone' },
      {
        name: 'Location (Android 12+)',
        why: 'required by the platform BLE stack. The app never reads a position',
      },
      { name: 'No network access', why: 'a ride is arranged between two handsets and nowhere else' },
    ],
    previews: [],
    screen: lazy(() => import('../apps/hitch/HitchApp')),
  },
];

export const ALL_CATEGORY = 'All';

/**
 * Derived rather than declared, so a category can never outlive the last app in
 * it. Order follows first appearance in the registry, which keeps the chip row
 * stable as apps are added.
 */
export const CATEGORIES: string[] = [
  ALL_CATEGORY,
  ...APPS.reduce<string[]>((tags, app) => {
    for (const tag of app.tags) if (!tags.includes(tag)) tags.push(tag);
    return tags;
  }, []),
];

/** Categories without the "All" pseudo-entry, for the Explore grid. */
export const REAL_CATEGORIES: string[] = CATEGORIES.filter((c) => c !== ALL_CATEGORY);

export function appById(id: string): HubApp | undefined {
  return APPS.find((app) => app.id === id);
}

export function appsInCategory(category: string): HubApp[] {
  return category === ALL_CATEGORY ? APPS : APPS.filter((app) => app.tags.includes(category));
}

/** The app's primary home — the first tag, by the registry's own convention. */
export function primaryCategory(app: HubApp): string {
  return app.tags[0] ?? 'Apps';
}

export const BADGE_LABEL: Record<AppBadge, string> = {
  bluetooth: 'Bluetooth',
  offline: 'Offline',
  encrypted: 'Encrypted',
  multiplayer: 'Multiplayer',
};

/**
 * Name and tagline first, then the long description and hidden keywords. A blank
 * query returns everything rather than nothing — the grid is the default view.
 */
export function searchApps(apps: HubApp[], query: string): HubApp[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return apps;
  return apps.filter((app) =>
    [app.name, app.tagline, app.description, ...app.tags, ...app.keywords]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * Why a result matched, for the line under a search row. Reports the strongest
 * true reason rather than every one, so the note stays one line.
 */
export function matchReason(app: HubApp, query: string): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return primaryCategory(app);
  if (app.name.toLowerCase().includes(needle)) return `Matches name · ${app.tags.join(', ')}`;
  if (app.tagline.toLowerCase().includes(needle)) return `Matches tagline · ${primaryCategory(app)}`;
  const tag = app.tags.find((t) => t.toLowerCase().includes(needle));
  if (tag) return `In ${tag}`;
  const keyword = app.keywords.find((k) => k.includes(needle));
  if (keyword) return `Matches “${keyword}” · ${primaryCategory(app)}`;
  return `Matches description · ${primaryCategory(app)}`;
}
