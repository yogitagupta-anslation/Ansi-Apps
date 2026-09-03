/**
 * logger.ts
 * -----------------------------------------------------------------------------
 * Console logging plus an in-memory ring buffer that the UI can render.
 *
 * The on-screen log matters more than usual here: this prototype is tested by
 * walking around a room with two phones, and you cannot watch `adb logcat` while
 * doing that. Every log line is therefore visible on the device itself.
 * -----------------------------------------------------------------------------
 */

import { LOG_BUFFER_SIZE } from '../constants/bluetoothConfig';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogTag = 'BLE' | 'ADVERTISE' | 'SCAN' | 'PERMISSION' | 'ATTENDANCE';

export interface LogEntry {
  id: number;
  time: string;
  tag: LogTag;
  level: LogLevel;
  message: string;
}

type Listener = (entries: LogEntry[]) => void;

let nextId = 1;
let buffer: LogEntry[] = [];
const listeners = new Set<Listener>();

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds()) +
    '.' +
    pad(d.getMilliseconds(), 3)
  );
}

function push(tag: LogTag, level: LogLevel, message: string): void {
  const entry: LogEntry = {
    id: nextId++,
    time: timestamp(),
    tag,
    level,
    message,
  };

  // Newest first - that is the order the UI wants, and it avoids reversing a
  // 200-element array on every render.
  buffer = [entry, ...buffer].slice(0, LOG_BUFFER_SIZE);

  const line = '[' + tag + '] ' + message;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }

  listeners.forEach(listener => listener(buffer));
}

export const log = {
  info: (tag: LogTag, message: string) => push(tag, 'info', message),
  warn: (tag: LogTag, message: string) => push(tag, 'warn', message),
  error: (tag: LogTag, message: string) => push(tag, 'error', message),

  /** Subscribe to buffer changes. Returns an unsubscribe function. */
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    listener(buffer);
    return () => {
      listeners.delete(listener);
    };
  },

  getEntries: (): LogEntry[] => buffer,

  clear: (): void => {
    buffer = [];
    listeners.forEach(listener => listener(buffer));
  },
};

/**
 * Turn anything thrown (Error, BleError, string, or a plain object) into a
 * readable single line. react-native-ble-plx throws BleError objects that carry
 * `reason` and `errorCode`, which are far more useful than `message` alone and
 * are lost if you only ever log `error.message`.
 */
export function describeError(error: unknown): string {
  if (!error) {
    return 'unknown error';
  }
  if (typeof error === 'string') {
    return error;
  }

  const anyError = error as {
    message?: string;
    reason?: string;
    errorCode?: number;
    androidErrorCode?: number;
  };

  const parts: string[] = [];
  if (anyError.message) {
    parts.push(anyError.message);
  }
  if (anyError.reason && anyError.reason !== anyError.message) {
    parts.push('reason=' + anyError.reason);
  }
  if (anyError.errorCode !== undefined) {
    parts.push('bleErrorCode=' + anyError.errorCode);
  }
  if (anyError.androidErrorCode !== undefined) {
    parts.push('androidErrorCode=' + anyError.androidErrorCode);
  }

  return parts.length > 0 ? parts.join(' | ') : String(error);
}
