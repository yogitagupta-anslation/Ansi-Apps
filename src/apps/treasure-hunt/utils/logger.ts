/**
 * Namespaced logger with a runtime level switch.
 *
 * BLE debugging generates a lot of noise, so each subsystem gets its own tag
 * and levels can be turned down without touching call sites.
 */

export enum LogLevel {
  Debug = 10,
  Info = 20,
  Warn = 30,
  Error = 40,
  Silent = 100,
}

/** __DEV__ exists in the RN runtime but not under plain Node (jest, tooling). */
const IS_DEV: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

let currentLevel: LogLevel = IS_DEV ? LogLevel.Debug : LogLevel.Warn;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;
  return {
    debug(message, ...args) {
      if (currentLevel <= LogLevel.Debug) {
        console.log(prefix, message, ...args);
      }
    },
    info(message, ...args) {
      if (currentLevel <= LogLevel.Info) {
        console.log(prefix, message, ...args);
      }
    },
    warn(message, ...args) {
      if (currentLevel <= LogLevel.Warn) {
        console.warn(prefix, message, ...args);
      }
    },
    error(message, ...args) {
      if (currentLevel <= LogLevel.Error) {
        console.error(prefix, message, ...args);
      }
    },
  };
}
