/**
 * The log for the BLE proof-of-concept.
 *
 * Every line goes two places: `console.log` with a `[BLE-TEST]` tag so it shows
 * up in `adb logcat`, and an in-memory buffer the screen renders. The second
 * one matters on a physical phone that is not plugged into a laptop — which is
 * exactly the situation this test is built for.
 *
 * The rule this module exists to enforce: a step that fails is logged as a
 * failure and the sequence stops there. A diagnostic that reports success it
 * did not observe is worse than no diagnostic at all, because it sends you
 * looking in the wrong place.
 */

const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

export type BleTestLevel = 'step' | 'ok' | 'fail';

export interface BleTestEntry {
  id: number;
  at: number;
  level: BleTestLevel;
  message: string;
  detail?: string;
}

type Listener = (entries: BleTestEntry[]) => void;

const MAX_ENTRIES = 300;

let entries: BleTestEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(entries);
}

function push(level: BleTestLevel, message: string, detail?: unknown): void {
  const rendered =
    detail === undefined
      ? undefined
      : detail instanceof Error
        ? detail.message
        : typeof detail === 'string'
          ? detail
          : safeStringify(detail);

  const entry: BleTestEntry = { id: nextId++, at: Date.now(), level, message, detail: rendered };

  // Newest first: on a phone screen the interesting line is the one that just
  // happened, and scrolling to the bottom of a live log to find it is busywork.
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);

  if (IS_DEV) {
    const suffix = rendered ? ` ${rendered}` : '';
    // eslint-disable-next-line no-console
    console.log(`[BLE-TEST] ${message}${suffix}`);
  }

  emit();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export const bleTestLog = {
  /** A step being attempted. */
  step: (message: string, detail?: unknown) => push('step', message, detail),
  /** A step that demonstrably succeeded — never one merely assumed to have. */
  ok: (message: string, detail?: unknown) => push('ok', message, detail),
  /** A step that failed. This is where the sequence stops. */
  fail: (message: string, detail?: unknown) => push('fail', message, detail),

  entries: (): BleTestEntry[] => entries,

  clear: (): void => {
    entries = [];
    emit();
  },

  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    listener(entries);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * The first failure, which is the only one worth reading.
   *
   * Everything after a failed step is downstream noise: a scan that never
   * started cannot discover anything, so its silence says nothing.
   */
  firstFailure: (): BleTestEntry | null => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].level === 'fail') return entries[i];
    }
    return null;
  },
};
