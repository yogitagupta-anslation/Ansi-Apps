/**
 * Connect-flow tracing.
 *
 * The connection handshake spans a button, an action, a coordinator, two BLE
 * roles and a radio, and when it does not work the interesting question is
 * always *which step was the first to fail*. Guessing at that from a toast is
 * how you end up "fixing" the wrong layer, so every step announces itself.
 *
 * Development only: `config.showDevPanel` is `__DEV__`, so a release build
 * compiles these to a call that returns immediately and logs nothing. The tags
 * are stable and greppable:
 *
 *   adb logcat | grep EventPulse
 */

/**
 * `__DEV__` directly rather than `config.showDevPanel`.
 *
 * `runtime/config.ts` imports `expo-constants`, which reaches an ESM module the
 * eventpulse Jest project cannot transform — that project runs in bare node with
 * no react-native preset precisely so the pure layer stays testable. Importing
 * config from here would drag that dependency into every module that traces,
 * and the coordinator is one of them. `__DEV__` is injected by Metro and is
 * simply absent under Jest, which the `typeof` guard handles.
 */
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

export type DiagnosticTag = 'Connect' | 'GATT' | 'Request' | 'Connection' | 'Advertising';

/**
 * One line per step.
 *
 * `data` is rendered inline rather than as an object so a single logcat line
 * carries the whole story — Android's log viewer collapses multi-line objects
 * and the detail is exactly what is needed here.
 */
export function trace(tag: DiagnosticTag, message: string, data?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const detail =
    data === undefined
      ? ''
      : ' ' +
        Object.entries(data)
          .map(([key, value]) => `${key}=${format(value)}`)
          .join(' ');
  // eslint-disable-next-line no-console
  console.log(`[EventPulse][${tag}] ${message}${detail}`);
}

function format(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value.length === 0 ? "''" : value;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '<object>';
    }
  }
  return String(value);
}
