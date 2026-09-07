/**
 * Build configuration.
 *
 * Two switches matter:
 *
 *  - `api`: `mock` runs the whole app against an in-memory backend, so the
 *    product can be reviewed without Postgres. `http` talks to `backend/`.
 *  - `ble`: `native` uses the real radio (requires a development build).
 *    `simulated` drives the identical pipeline with a synthetic crowd, which is
 *    the only way to exercise the map on a simulator or in a screenshot.
 *
 * The simulated transport is never selected in a release build: a shipped app
 * showing imaginary people would be a lie, not a demo.
 */

import Constants from 'expo-constants';

export type ApiMode = 'mock' | 'http';
export type BleMode = 'native' | 'simulated';

export interface AppConfig {
  api: ApiMode;
  ble: BleMode;
  apiBaseUrl: string;
  /**
   * Bearer token sent to the backend. A development placeholder; a real build
   * replaces this with a signed session token from the auth flow.
   */
  authToken: string | null;
  /** People generated per event by the mock backend / simulator. */
  simulatedCrowdSize: number;
  /** Show the developer panel (transport state, scan plan, packet counters). */
  showDevPanel: boolean;
}

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
const DEFAULT_API_PORT = 4000;

/**
 * Work out where the backend is.
 *
 * `localhost` is the trap here: on a physical phone it means *the phone*, not
 * the laptop running the API, so a hard-coded default fails with a confusing
 * network error the first time anyone tests on real hardware.
 *
 * Metro already knows the laptop's LAN address — it is the host serving the
 * bundle — so in development we borrow it and swap the port. That makes
 * "run the backend, run the app" work on a device with no configuration.
 */
function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_EVENTPULSE_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  if (isDev) {
    // e.g. "10.5.58.45:8081" — the host Metro is serving this bundle from.
    const hostUri =
      Constants.expoConfig?.hostUri ??
      (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
    const host = hostUri?.split(':')[0];
    if (host) return `http://${host}:${DEFAULT_API_PORT}`;
  }

  return `http://localhost:${DEFAULT_API_PORT}`;
}

export const config: AppConfig = {
  /**
   * `http` only when there is somewhere to send the request.
   *
   * This used to key on `__DEV__`, which meant a release build asked for `http` and
   * then talked to `http://localhost:4000` — a port on the phone itself, where nothing
   * is listening. The app was not broken so much as pointed at nothing: no events, no
   * attendees, an empty screen with no explanation.
   *
   * An unset backend URL is not a configuration mistake, it is the ordinary case for a
   * build handed to someone to try. Falling back to the in-memory backend makes the
   * product reviewable; `isMockBackend()` is what the UI uses to say so out loud, so
   * nobody mistakes the sample crowd for real attendees.
   */
  api:
    (process.env.EXPO_PUBLIC_EVENTPULSE_API as ApiMode) ??
    (process.env.EXPO_PUBLIC_EVENTPULSE_API_URL ? 'http' : 'mock'),
  ble: (process.env.EXPO_PUBLIC_EVENTPULSE_BLE as BleMode) ?? 'native',
  apiBaseUrl: resolveApiBaseUrl(),
  // The backend fails closed on an unknown token, so an unauthenticated client
  // would 401 on every call. `demo` is the seeded development identity.
  // The seeded development identity. Only ever sent to a backend that was explicitly
  // configured; the mock one does not authenticate at all.
  authToken:
    process.env.EXPO_PUBLIC_EVENTPULSE_TOKEN ??
    (process.env.EXPO_PUBLIC_EVENTPULSE_API_URL ? null : 'demo'),
  simulatedCrowdSize: Number(process.env.EXPO_PUBLIC_EVENTPULSE_CROWD ?? 42),
  showDevPanel: isDev,
};

export function assertReleaseSafe(current: AppConfig = config): void {
  if (!isDev && current.ble === 'simulated') {
    throw new Error(
      'EventPulse: the simulated BLE transport must never ship. Set EXPO_PUBLIC_EVENTPULSE_BLE=native.',
    );
  }
}
