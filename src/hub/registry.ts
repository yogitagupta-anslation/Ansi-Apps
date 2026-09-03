/**
 * The registry is the single source of truth for what the hub can launch.
 *
 * Everything else — the grid, the search index, the category chips, the recents
 * row, the featured slot, the route table in App.tsx — is derived from this list.
 * Adding a fourth app is therefore one entry here plus one lazy component; no
 * other file needs to learn its name.
 */

import type { ComponentType } from 'react';
import { lazy } from 'react';

export type AppId = 'blechat' | 'eventpulse' | 'higherlower';

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
    screen: lazy(() => import('../apps/higherlower/HigherLowerApp')),
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
