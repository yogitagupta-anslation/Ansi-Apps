/**
 * The registry is the single source of truth for what the hub can launch.
 *
 * Everything else — the home grid, the search index, the category chips, the recents
 * row, the featured slot, the detail page, the permission counts in Settings, the route
 * table in App.tsx — is derived from this list. Adding a sixth app is one entry here
 * plus one lazy component; no other file needs to learn its name.
 *
 * A note on the fields the detail page reads. Everything below is checkable against the
 * app it describes — `needs` is the permissions that app's own code actually requests,
 * `offline` is whether it genuinely runs with the network off. There are no ratings,
 * download counts or install sizes in here, because none of those exist for an app that
 * ships inside this bundle and was never on a store. A store layout is not a reason to
 * invent store numbers.
 */

import type { ComponentType } from 'react';
import { lazy } from 'react';
import type { HubPermissionId } from './settings';

export type AppId =
  | 'blechat'
  | 'eventpulse'
  | 'higherlower'
  | 'attendance'
  | 'treasurehunt';

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

  // ---- read by the detail page -------------------------------------------------

  /** Two or three sentences. What it is for, and what it is not. */
  about: string;
  /** Three things it actually does. Short enough to scan, specific enough to mean something. */
  highlights: string[];
  /**
   * The hub permissions this app's code genuinely requests. Drives "Uses from your hub",
   * where each one is shown against its live OS state — so the page can warn you before
   * a launch instead of after it.
   */
  needs: HubPermissionId[];
  /** True when it works with the network off. All five do; the field keeps that honest if one stops. */
  offline: boolean;

  /**
   * Loaded on first launch, not at hub startup. Each of these pulls in a whole
   * app — a BLE stack, a positioning engine, an audio bank — and the hub has no
   * business paying for any of that before someone taps a card.
   */
  screen: ComponentType;
}

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
    about:
      'Two phones in Bluetooth range can hold a conversation with nothing else involved — no account, no server, no signal. Keys are exchanged on first contact and messages are encrypted end to end. Range is the catch: this is a room, a carriage or a queue, not a city.',
    highlights: [
      'End-to-end encrypted, keys never leave the phones',
      'A radar that places peers by measured signal strength',
      'Threads survive a dropped link and resume when it returns',
    ],
    needs: ['bluetooth', 'location'],
    offline: true,
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
    about:
      'Built for the hour between talks. Everyone running it broadcasts a short profile, and the radar ranks the room by how close each person is. Signal strength is a rough proxy for distance, so treat the ordering as a hint about who is on this side of the room, not a measurement in metres.',
    highlights: [
      'A live ranking of who is in the room with you',
      'Profiles and interests exchanged over the air',
      'Sample events built in, so it demonstrates without a venue',
    ],
    needs: ['bluetooth', 'location', 'camera'],
    offline: true,
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
    about:
      'Binary search as a sport. Pick a number, get told higher or lower, and try to close the gap before the clock or your guess budget does. Modifiers change what each guess costs, which turns an obvious strategy into a decision. The multiplayer race runs against a simulated opponent — the over-the-air version is still being built.',
    highlights: [
      'Daily challenge with a seed everyone shares',
      'Modifiers that change the cost of a guess',
      'Streaks and personal bests kept on the device',
    ],
    // Nothing: the radio path is stubbed today, so claiming Bluetooth would be a
    // permission asked for on behalf of code that never runs.
    needs: [],
    offline: true,
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
    about:
      'One phone hosts, everyone else broadcasts, and the register fills itself as people walk in. Records stay on the host device and export as a spreadsheet. Presence here means "this phone was in range", which is the honest limit of what Bluetooth can tell you.',
    highlights: [
      'The host sees the room fill in as people arrive',
      'Registers export to a formatted spreadsheet',
      'Runs entirely on the phones — no backend to stand up',
    ],
    needs: ['bluetooth', 'location', 'camera', 'notifications'],
    offline: true,
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
    about:
      'A hunt played across a virtual map rather than a real one, with Bluetooth carrying the whole game between phones. One player hosts a lobby, the rest join, and everyone races the same board. No GPS and no map data, so it works as well in a basement as in a park.',
    highlights: [
      'Host a lobby and everyone in range can join',
      'A shared board with no server keeping score',
      'A compass that points at objectives, not at north',
    ],
    needs: ['bluetooth', 'location'],
    offline: true,
    screen: lazy(() => import('../apps/treasure-hunt/TreasureHuntApp')),
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

export function appById(id: string): HubApp | undefined {
  return APPS.find((app) => app.id === id);
}

/** How many apps actually request a given permission. The number Settings shows. */
export function appsNeeding(permission: HubPermissionId): HubApp[] {
  return APPS.filter((app) => app.needs.includes(permission));
}

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
