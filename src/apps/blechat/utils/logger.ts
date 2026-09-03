import {EventBus} from './EventBus';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  tag: string;
  message: string;
}

const MAX_ENTRIES = 500;

/**
 * In-memory ring buffer feeding the Debug screen. Physical BLE debugging is
 * impossible without a timestamped log you can read on the device itself.
 */
class Logger {
  readonly bus = new EventBus<{entry: LogEntry; cleared: void}>();
  private entries: LogEntry[] = [];
  private nextId = 1;

  private push(level: LogLevel, tag: string, parts: unknown[]): void {
    const message = parts
      .map(p => {
        if (typeof p === 'string') {
          return p;
        }
        if (p instanceof Error) {
          return p.message;
        }
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .join(' ');

    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      tag,
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    const line = `[${tag}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
    this.bus.emit('entry', entry);
  }

  debug(tag: string, ...parts: unknown[]) {
    this.push('debug', tag, parts);
  }
  info(tag: string, ...parts: unknown[]) {
    this.push('info', tag, parts);
  }
  warn(tag: string, ...parts: unknown[]) {
    this.push('warn', tag, parts);
  }
  error(tag: string, ...parts: unknown[]) {
    this.push('error', tag, parts);
  }

  /**
   * Returns a COPY.
   *
   * Handing out the internal array aliases it into the store, and because push() appends
   * before it emits, the store's own `[...logs, entry]` append then produced the entry
   * twice — which React reports as "Encountered two children with the same key" and can
   * duplicate or omit rows on the Debug screen. Copying severs that alias.
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
    this.bus.emit('cleared', undefined);
  }
}

export const logger = new Logger();

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
    d.getSeconds(),
  )}.${pad(d.getMilliseconds(), 3)}`;
}
