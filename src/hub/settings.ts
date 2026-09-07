import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import type { HubThemeMode } from './theme';

/**
 * Hub settings: the values the Settings tab owns.
 *
 * Two kinds live here, and the difference matters because one of them is a claim and the
 * other is a fact:
 *
 *   - `displayName` and `themeMode` are the hub's own preferences. They are stored here
 *     and read by the hub's own screens.
 *   - The permissions are not stored at all. They are read back from the OS every time,
 *     because they are genuinely shared: the five apps ship inside one APK with one
 *     manifest, so a permission granted is granted for all of them. That is what lets a
 *     detail page say "Bluetooth is off" before you launch anything, and mean it.
 *
 * Nothing here reaches into the five apps. Each keeps its own theme and its own identity;
 * the hub does not overwrite them.
 */

const NAME_KEY = '@apphub/displayName';
const THEME_KEY = '@apphub/themeMode';

interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const memory = new Map<string, string>();
let resolved: KeyValueStore | null | undefined;

/**
 * Lazy and guarded, for the same reason the recents list is: AsyncStorage throws the
 * moment it is loaded without its native half, and a preference is not worth taking the
 * launcher down for.
 */
function backend(): KeyValueStore | null {
  if (resolved !== undefined) return resolved;
  try {
    const mod = require('@react-native-async-storage/async-storage');
    const store = (mod?.default ?? mod) as KeyValueStore | undefined;
    resolved = store && typeof store.getItem === 'function' ? store : null;
  } catch {
    resolved = null;
  }
  return resolved;
}

async function read(key: string): Promise<string | null> {
  const store = backend();
  if (store) {
    try {
      return await store.getItem(key);
    } catch {
      resolved = null;
    }
  }
  return memory.get(key) ?? null;
}

async function write(key: string, value: string): Promise<void> {
  const store = backend();
  if (store) {
    try {
      await store.setItem(key, value);
      return;
    } catch {
      resolved = null;
    }
  }
  memory.set(key, value);
}

// ---------------------------------------------------------------- preferences

export interface HubSettings {
  displayName: string;
  themeMode: HubThemeMode;
}

const DEFAULTS: HubSettings = { displayName: '', themeMode: 'system' };

let cache: HubSettings = { ...DEFAULTS };
const listeners = new Set<(s: HubSettings) => void>();

function publish(next: HubSettings): void {
  cache = next;
  for (const listener of listeners) listener(next);
}

export async function loadHubSettings(): Promise<HubSettings> {
  const [name, theme] = await Promise.all([read(NAME_KEY), read(THEME_KEY)]);
  const next: HubSettings = {
    displayName: name ?? DEFAULTS.displayName,
    themeMode:
      theme === 'light' || theme === 'dark' || theme === 'system'
        ? theme
        : DEFAULTS.themeMode,
  };
  publish(next);
  return next;
}

export function setDisplayName(displayName: string): void {
  publish({ ...cache, displayName });
  void write(NAME_KEY, displayName);
}

export function setThemeMode(themeMode: HubThemeMode): void {
  publish({ ...cache, themeMode });
  void write(THEME_KEY, themeMode);
}

/**
 * The read is shared across every consumer.
 *
 * `useHubTheme` calls this, and every card, row and chip on a screen calls `useHubTheme` —
 * so a per-mount read would mean dozens of storage round trips to answer one question that
 * has one answer. The first caller starts the read and the rest wait on the same promise;
 * the subscription is what keeps them all current afterwards.
 */
let pending: Promise<HubSettings> | null = null;

function loadOnce(): Promise<HubSettings> {
  pending ??= loadHubSettings();
  return pending;
}

/** Subscribes to the settings the hub's own chrome is drawn from. */
export function useHubSettings(): HubSettings {
  const [settings, setSettings] = useState<HubSettings>(cache);
  useEffect(() => {
    listeners.add(setSettings);
    void loadOnce();
    return () => {
      listeners.delete(setSettings);
    };
  }, []);
  return settings;
}

/** "Alex Rivera" -> "AR". The avatar in the header and the settings card. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// --------------------------------------------------------------- permissions

export type HubPermissionId = 'bluetooth' | 'location' | 'camera' | 'notifications';

export interface HubPermission {
  id: HubPermissionId;
  label: string;
  /** What it buys, and how many of the five apps actually use it. */
  detail: string;
  granted: boolean;
}

/**
 * The Android runtime permissions behind each row.
 *
 * Bluetooth is two on API 31+ — scanning and connecting are separate grants — and the
 * row is only honest as "on" when both are held, since holding one without the other
 * still leaves the apps unable to do the job the row describes.
 */
const ANDROID_PERMISSIONS: Record<HubPermissionId, string[]> = {
  bluetooth:
    Platform.OS === 'android' && Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION],
  location: [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION],
  camera: [PermissionsAndroid.PERMISSIONS.CAMERA],
  notifications:
    Platform.OS === 'android' && Number(Platform.Version) >= 33
      ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS]
      : [],
};

/**
 * What each permission buys.
 *
 * No app counts here on purpose. "Used by 4 apps" is a checkable claim, and one written
 * into a string is a claim that goes stale the moment an app is added or stops needing
 * the permission. The Settings screen counts the registry instead, so the number is true
 * by construction rather than by maintenance.
 */
const LABELS: Record<HubPermissionId, { label: string; detail: string }> = {
  bluetooth: { label: 'Bluetooth', detail: 'Finding nearby phones and moving data between them' },
  location: { label: 'Location', detail: 'Android requires it before an app may scan for devices' },
  camera: { label: 'Camera', detail: 'Taking a profile photo instead of picking one' },
  notifications: { label: 'Notifications', detail: 'Alerts while a session runs in the background' },
};

export const PERMISSION_ORDER: HubPermissionId[] = [
  'bluetooth',
  'location',
  'camera',
  'notifications',
];

async function checkOne(id: HubPermissionId): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const names = ANDROID_PERMISSIONS[id];
  // An empty list means the platform does not gate this at runtime on this version —
  // held by the manifest alone, so it is on.
  if (names.length === 0) return true;
  const results = await Promise.all(
    names.map(name => PermissionsAndroid.check(name as never).catch(() => false)),
  );
  return results.every(Boolean);
}

/**
 * Live permission state, re-read whenever the app comes back to the foreground.
 *
 * That refresh is not a nicety: revoking a permission means a trip to system settings,
 * which backgrounds the app, and a screen still showing the old value on return would be
 * stating something it had every opportunity to know was false.
 */
export function useHubPermissions(): {
  permissions: HubPermission[];
  refresh: () => void;
  request: (id: HubPermissionId) => void;
} {
  const [granted, setGranted] = useState<Record<HubPermissionId, boolean>>({
    bluetooth: false,
    location: false,
    camera: false,
    notifications: false,
  });

  const refresh = useCallback(() => {
    void Promise.all(PERMISSION_ORDER.map(id => checkOne(id).then(ok => [id, ok] as const)))
      .then(entries => {
        setGranted(
          Object.fromEntries(entries) as Record<HubPermissionId, boolean>,
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  /**
   * Asking is only possible in one direction.
   *
   * Android has no API to hand a permission back, so a granted row cannot be switched
   * off from in here — it opens system settings instead, which is where that actually
   * happens. Pretending the switch could do it would be a control that silently does
   * nothing.
   */
  const request = useCallback(
    (id: HubPermissionId) => {
      if (Platform.OS !== 'android') return;
      if (granted[id]) {
        void Linking.openSettings();
        return;
      }
      const names = ANDROID_PERMISSIONS[id];
      if (names.length === 0) return;
      void PermissionsAndroid.requestMultiple(names as never[])
        .then(() => refresh())
        .catch(() => undefined);
    },
    [granted, refresh],
  );

  return {
    permissions: PERMISSION_ORDER.map(id => ({
      id,
      label: LABELS[id].label,
      detail: LABELS[id].detail,
      granted: granted[id],
    })),
    refresh,
    request,
  };
}
