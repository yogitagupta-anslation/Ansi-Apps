/**
 * Pacing the scan so leaving the app on does not flatten the battery.
 *
 * Until now the radio scanned continuously in `ScanMode.LowLatency` with duplicates
 * enabled — the most power-hungry configuration Android offers, running forever. For an
 * app whose whole premise is "leave it on and discover people nearby", that is the
 * difference between something you keep running and something you uninstall.
 *
 * THE CONSTRAINT THAT SHAPES ALL OF THIS: Android allows roughly **5 scan starts per 30
 * seconds** per app. Exceed it and the platform stops delivering results — on newer
 * versions with SCAN_FAILED_SCANNING_TOO_FREQUENTLY, on others by simply going quiet,
 * which is worse because nothing reports an error. A naive "scan 1s, sleep 1s" duty cycle
 * therefore does not save battery; it silently destroys discovery.
 *
 * So every profile below has a period well above six seconds, and `ScanDutyCycle`
 * additionally refuses to start a burst that would breach the budget, no matter how the
 * profiles are configured or how often the intensity is switched.
 *
 * Timers and the clock are injected so the whole thing is testable without waiting in
 * real time — and so the budget logic can be driven past its limits deliberately.
 */

export type ScanIntensity =
  /** The user is looking at the Nearby screen. Continuous, as before. */
  | 'active'
  /** App in the foreground, but the user is elsewhere. Paced. */
  | 'balanced'
  /** App in the background. Paced hard, and low-power while it does scan. */
  | 'saver';

export interface DutyCycleProfile {
  /** How long each burst of real scanning lasts. null = never rest. */
  burstMs: number | null;
  /** How long the radio idles between bursts. */
  restMs: number;
  /** Use the low-power scan mode rather than low-latency during the burst. */
  lowPower: boolean;
}

/**
 * Periods chosen against the 5-starts-per-30s budget, not picked for roundness:
 *
 *   balanced  4s on + 8s off  = 12s period → 2.5 starts / 30s
 *   saver     3s on + 27s off = 30s period → 1.0 starts / 30s
 *
 * Both leave headroom, because a profile switch also costs a start.
 */
export const SCAN_PROFILES: Record<ScanIntensity, DutyCycleProfile> = {
  active: {burstMs: null, restMs: 0, lowPower: false},
  balanced: {burstMs: 4_000, restMs: 8_000, lowPower: false},
  saver: {burstMs: 3_000, restMs: 27_000, lowPower: true},
};

/** Android's documented allowance, and the window it applies over. */
export const SCAN_START_BUDGET = 5;
export const SCAN_BUDGET_WINDOW_MS = 30_000;
/**
 * Leave one start spare. The app also starts a scan on its own after a connect, and
 * spending the last one here would make that fail invisibly.
 */
const USABLE_STARTS = SCAN_START_BUDGET - 1;

/**
 * What the radio has actually been doing.
 *
 * Exists because "the battery seems better" is not evidence. Duty cycling can only be
 * validated against numbers — how much of the time the radio was genuinely on, and how
 * many bursts it took — and without this the Debug screen could only report a boolean.
 */
export interface ScanTelemetry {
  intensity: ScanIntensity;
  /** True only while a burst is in progress, unlike the user-facing scanning flag. */
  bursting: boolean;
  /** Bursts since scanning was last switched on. */
  burstCount: number;
  /** Milliseconds the radio has genuinely been scanning. */
  radioOnMs: number;
  /** Milliseconds since scanning was switched on. */
  elapsedMs: number;
  /** radioOnMs / elapsedMs, as a percentage. The number that matters for battery. */
  dutyPercent: number;
  /** Headroom left in Android's start budget. Zero means discovery is being held back. */
  startsRemaining: number;
}

export interface DutyCycleHooks {
  /** Begin a real radio scan. */
  startRadio: (lowPower: boolean) => void;
  /** Stop the radio scan. Not called when the profile never rests. */
  stopRadio: () => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

export class ScanDutyCycle {
  private intensity: ScanIntensity = 'balanced';
  private running = false;
  private bursting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamps of recent radio starts, for the budget guard. */
  private starts: number[] = [];

  // Telemetry. Accumulated rather than sampled, so a burst that began before the Debug
  // screen was opened still counts toward the total.
  private burstCount = 0;
  private radioOnMs = 0;
  private burstStartedAt: number | null = null;
  private runStartedAt: number | null = null;

  constructor(private readonly hooks: DutyCycleHooks) {}

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Whether the radio is scanning at this instant.
   *
   * Deliberately NOT what the UI's "Scanning" indicator follows. The user asked for
   * scanning and it is ongoing; a light that blinked off every rest period would say
   * the app had stopped looking, which is not true.
   */
  get isBursting(): boolean {
    return this.bursting;
  }

  get currentIntensity(): ScanIntensity {
    return this.intensity;
  }

  start(intensity: ScanIntensity): void {
    this.intensity = intensity;
    if (this.running) {
      // Already going: re-pace rather than stacking a second cycle.
      this.reschedule();
      return;
    }
    this.running = true;
    // Reset the counters: telemetry describes this run of scanning, not the app's
    // whole lifetime, or the duty figure would be diluted by time spent not scanning.
    this.burstCount = 0;
    this.radioOnMs = 0;
    this.runStartedAt = this.hooks.now();
    this.beginBurst();
  }

  setIntensity(intensity: ScanIntensity): void {
    if (intensity === this.intensity) {
      return;
    }
    this.intensity = intensity;
    if (this.running) {
      this.reschedule();
    }
  }

  stop(): void {
    this.running = false;
    this.clear();
    if (this.bursting) {
      this.closeBurst();
      this.hooks.stopRadio();
    }
    this.runStartedAt = null;
  }

  /** Fold the in-progress burst into the running total. */
  private closeBurst(): void {
    if (this.burstStartedAt !== null) {
      this.radioOnMs += this.hooks.now() - this.burstStartedAt;
      this.burstStartedAt = null;
    }
    this.bursting = false;
  }

  telemetry(): ScanTelemetry {
    const now = this.hooks.now();
    // Include the burst still running, or the figure would lag a whole burst behind.
    const liveBurst =
      this.burstStartedAt !== null ? now - this.burstStartedAt : 0;
    const radioOnMs = this.radioOnMs + liveBurst;
    const elapsedMs = this.runStartedAt !== null ? now - this.runStartedAt : 0;
    return {
      intensity: this.intensity,
      bursting: this.bursting,
      burstCount: this.burstCount,
      radioOnMs,
      elapsedMs,
      dutyPercent: elapsedMs > 0 ? (radioOnMs / elapsedMs) * 100 : 0,
      startsRemaining: this.startsRemaining(),
    };
  }

  /**
   * How many starts remain in the current window. Exposed for diagnostics: "discovery
   * went quiet" is otherwise very hard to attribute to a rate limit.
   */
  startsRemaining(): number {
    this.pruneStarts();
    return Math.max(0, USABLE_STARTS - this.starts.length);
  }

  // ---- internals --------------------------------------------------------

  private clear(): void {
    if (this.timer !== null) {
      this.hooks.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private pruneStarts(): void {
    const cutoff = this.hooks.now() - SCAN_BUDGET_WINDOW_MS;
    this.starts = this.starts.filter(t => t > cutoff);
  }

  /**
   * How long until a start is permitted, in ms. Zero when one is available now.
   *
   * This is the guard that makes the whole thing safe: whatever the profiles say, and
   * however often the intensity changes, the radio is never started more often than
   * Android tolerates.
   */
  private delayUntilStartAllowed(): number {
    this.pruneStarts();
    if (this.starts.length < USABLE_STARTS) {
      return 0;
    }
    const oldest = this.starts[0];
    return Math.max(0, oldest + SCAN_BUDGET_WINDOW_MS - this.hooks.now());
  }

  private beginBurst(): void {
    this.clear();
    if (!this.running) {
      return;
    }

    const wait = this.delayUntilStartAllowed();
    if (wait > 0) {
      // Out of budget. Waiting is the only correct response — starting anyway is what
      // makes the platform stop returning results with no error to show for it.
      this.timer = this.hooks.setTimer(() => this.beginBurst(), wait);
      return;
    }

    const profile = SCAN_PROFILES[this.intensity];
    const now = this.hooks.now();
    this.starts.push(now);
    this.bursting = true;
    this.burstStartedAt = now;
    this.burstCount++;
    this.hooks.startRadio(profile.lowPower);

    if (profile.burstMs === null) {
      // Continuous: nothing to schedule, the radio simply stays on.
      return;
    }
    this.timer = this.hooks.setTimer(() => this.endBurst(), profile.burstMs);
  }

  private endBurst(): void {
    this.clear();
    if (!this.running) {
      return;
    }
    const profile = SCAN_PROFILES[this.intensity];
    if (profile.burstMs === null) {
      return;
    }
    this.closeBurst();
    this.hooks.stopRadio();
    this.timer = this.hooks.setTimer(() => this.beginBurst(), profile.restMs);
  }

  /**
   * Apply a changed profile without wasting a start.
   *
   * If the radio is already on, it keeps running and only the burst length changes —
   * stopping and immediately restarting to "apply" a new mode would spend a start from
   * the budget for no discovery benefit.
   */
  private reschedule(): void {
    this.clear();
    const profile = SCAN_PROFILES[this.intensity];
    if (this.bursting) {
      if (profile.burstMs === null) {
        return;
      }
      this.timer = this.hooks.setTimer(() => this.endBurst(), profile.burstMs);
      return;
    }
    this.beginBurst();
  }
}
