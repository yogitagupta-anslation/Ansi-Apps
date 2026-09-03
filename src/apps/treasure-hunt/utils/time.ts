/**
 * Time helpers.
 *
 * Device clocks are NOT synchronised. The host sends absolute epoch timestamps,
 * but a player must never subtract them from its own Date.now() -- a phone
 * whose clock is a minute off would show a wildly wrong timer. Instead a player
 * records when it received the host timestamp and tracks elapsed local time
 * from there. `RemoteClock` encapsulates that.
 */

export function now(): number {
  return Date.now();
}

/** Format milliseconds as MM:SS, clamped at zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Tracks a countdown that was defined by a remote peer, using only local
 * elapsed time so a skewed device clock cannot corrupt it.
 */
export class RemoteClock {
  private localAnchorMs = 0;
  private remainingAtAnchorMs = 0;
  private running = false;

  /** Called whenever the host tells us how much time is left. */
  sync(remainingMs: number, nowMs: number = now()): void {
    this.remainingAtAnchorMs = Math.max(0, remainingMs);
    this.localAnchorMs = nowMs;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  remainingMs(nowMs: number = now()): number {
    if (!this.running) {
      return this.remainingAtAnchorMs;
    }
    return Math.max(0, this.remainingAtAnchorMs - (nowMs - this.localAnchorMs));
  }

  get isRunning(): boolean {
    return this.running && this.remainingMs() > 0;
  }
}

/**
 * Calls `fn` at a fixed rate using setInterval, and guarantees `fn` receives
 * the real elapsed time so simulation stays correct when the JS thread stalls.
 */
export class TickLoop {
  private handle: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;

  constructor(
    private readonly hz: number,
    private readonly fn: (deltaSec: number) => void,
  ) {}

  start(): void {
    if (this.handle !== null) {
      return;
    }
    this.lastTickMs = now();
    const intervalMs = Math.max(1, Math.round(1000 / this.hz));
    this.handle = setInterval(() => {
      const t = now();
      const deltaSec = (t - this.lastTickMs) / 1000;
      this.lastTickMs = t;
      // Cap the step so a long stall cannot teleport a player across the map.
      this.fn(Math.min(deltaSec, 0.25));
    }, intervalMs);
  }

  stop(): void {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }
}

/** Promise that resolves after `ms`. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Limits how often a function runs. Unlike a debounce, the first call goes
 * through immediately -- movement packets should not wait for a quiet period.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): (...args: A) => void {
  let lastRun = 0;
  return (...args: A) => {
    const t = now();
    if (t - lastRun >= intervalMs) {
      lastRun = t;
      fn(...args);
    }
  };
}
