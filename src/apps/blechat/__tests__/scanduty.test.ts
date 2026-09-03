/**
 * Scan pacing.
 *
 * Two things must both hold, and they pull against each other: the radio has to rest
 * often enough to matter for battery, and it must never be started more often than
 * Android tolerates — because breaching that limit does not raise an error, it just
 * makes discovery stop working.
 *
 * A fake clock and fake timers, so the budget can be driven past its limit deliberately
 * rather than by waiting thirty seconds.
 */
import {
  ScanDutyCycle,
  SCAN_BUDGET_WINDOW_MS,
  SCAN_PROFILES,
  type ScanIntensity,
} from '../ble/ScanDutyCycle';

/** A controllable clock plus a queue of pending timers. */
class FakeScheduler {
  time = 0;
  private next = 1;
  private pending = new Map<number, {at: number; fn: () => void}>();

  readonly starts: Array<{at: number; lowPower: boolean}> = [];
  readonly stops: number[] = [];

  hooks = {
    startRadio: (lowPower: boolean) => {
      this.starts.push({at: this.time, lowPower});
    },
    stopRadio: () => {
      this.stops.push(this.time);
    },
    now: () => this.time,
    setTimer: (fn: () => void, ms: number) => {
      const id = this.next++;
      this.pending.set(id, {at: this.time + ms, fn});
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      this.pending.delete(handle as unknown as number);
    },
  };

  /** Advance time, firing timers in order as their deadlines pass. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let soonestId: number | null = null;
      let soonestAt = Infinity;
      for (const [id, t] of this.pending) {
        if (t.at <= target && t.at < soonestAt) {
          soonestAt = t.at;
          soonestId = id;
        }
      }
      if (soonestId === null) {
        break;
      }
      const entry = this.pending.get(soonestId)!;
      this.pending.delete(soonestId);
      this.time = entry.at;
      entry.fn();
    }
    this.time = target;
  }
}

function cycler(scheduler: FakeScheduler): ScanDutyCycle {
  return new ScanDutyCycle(scheduler.hooks);
}

describe('duty cycling', () => {
  let s: FakeScheduler;
  let duty: ScanDutyCycle;

  beforeEach(() => {
    s = new FakeScheduler();
    duty = cycler(s);
  });

  afterEach(() => duty.stop());

  it('starts the radio immediately when scanning begins', () => {
    duty.start('balanced');
    expect(s.starts).toHaveLength(1);
    expect(duty.isBursting).toBe(true);
  });

  it('rests after the burst, then scans again', () => {
    duty.start('balanced');
    const {burstMs, restMs} = SCAN_PROFILES.balanced;

    s.advance(burstMs!);
    expect(s.stops).toHaveLength(1);
    expect(duty.isBursting).toBe(false);

    s.advance(restMs);
    expect(s.starts).toHaveLength(2);
    expect(duty.isBursting).toBe(true);
  });

  it('leaves the radio on continuously in active mode', () => {
    duty.start('active');
    s.advance(60_000);
    // One start, no stops: the user is watching the Nearby screen and wants results now.
    expect(s.starts).toHaveLength(1);
    expect(s.stops).toHaveLength(0);
  });

  it('actually rests for most of the time in saver mode', () => {
    duty.start('saver');
    const {burstMs, restMs} = SCAN_PROFILES.saver;
    const period = burstMs! + restMs;
    // The whole point: the radio is off far more than it is on.
    expect(burstMs! / period).toBeLessThan(0.2);
  });

  it('uses low power while scanning in saver mode, and low latency otherwise', () => {
    duty.start('saver');
    expect(s.starts[0].lowPower).toBe(true);

    duty.stop();
    const other = cycler(s);
    other.start('balanced');
    expect(s.starts[1].lowPower).toBe(false);
    other.stop();
  });

  it('stops the radio when scanning is turned off mid-burst', () => {
    duty.start('balanced');
    duty.stop();
    expect(s.stops).toHaveLength(1);
    expect(duty.isRunning).toBe(false);
    expect(duty.isBursting).toBe(false);
  });

  it('does nothing further once stopped', () => {
    duty.start('balanced');
    duty.stop();
    const startsBefore = s.starts.length;
    s.advance(120_000);
    expect(s.starts).toHaveLength(startsBefore);
  });
});

describe("Android's scan-start budget", () => {
  let s: FakeScheduler;
  let duty: ScanDutyCycle;

  beforeEach(() => {
    s = new FakeScheduler();
    duty = cycler(s);
  });

  afterEach(() => duty.stop());

  it('never exceeds the allowance in any 30-second window', () => {
    duty.start('balanced');
    s.advance(10 * 60_000);

    // The failure this guards against is silent: Android simply stops returning
    // results, with no error for the app to surface.
    for (const {at} of s.starts) {
      const inWindow = s.starts.filter(
        x => x.at > at - SCAN_BUDGET_WINDOW_MS && x.at <= at,
      );
      expect(inWindow.length).toBeLessThanOrEqual(5);
    }
  });

  /**
   * The realistic way to exhaust the allowance: a user tapping the scan toggle on and
   * off. Switching INTENSITY does not spend starts by design — the radio keeps running
   * and only the pacing changes — so that cannot be used to drive this.
   */
  function toggleScanRepeatedly(times: number): void {
    for (let i = 0; i < times; i++) {
      duty.stop();
      duty.start('balanced');
      s.advance(200);
    }
  }

  it('holds off rather than starting when the budget is spent', () => {
    duty.start('balanced');
    toggleScanRepeatedly(8);

    expect(duty.startsRemaining()).toBe(0);

    const before = s.starts.length;
    // Advance far enough that the current burst ends and the next one WANTS to start —
    // advancing less would prove nothing, because no timer would have fired.
    const {burstMs, restMs} = SCAN_PROFILES.balanced;
    s.advance(burstMs! + restMs + 1_000);

    // Still inside the 30s window, so the wanted start must be held off. Spending it
    // is what makes Android stop returning results with no error to show for it.
    expect(s.starts).toHaveLength(before);
    expect(duty.isBursting).toBe(false);
  });

  it('is still running while it waits, not silently dead', () => {
    duty.start('balanced');
    toggleScanRepeatedly(8);
    // Out of budget, but the user asked for scanning and it will resume by itself.
    expect(duty.isRunning).toBe(true);
  });

  it('resumes scanning once the window rolls forward', () => {
    duty.start('balanced');
    toggleScanRepeatedly(8);
    const before = s.starts.length;

    // Past the window, the oldest starts no longer count against the budget.
    s.advance(SCAN_BUDGET_WINDOW_MS + 1_000);

    expect(s.starts.length).toBeGreaterThan(before);
    expect(duty.isRunning).toBe(true);
  });

  it('keeps a start in reserve rather than spending the whole allowance', () => {
    duty.start('balanced');
    // A connect also restarts the scan; spending the last start here would make that
    // fail invisibly.
    toggleScanRepeatedly(10);
    const inWindow = s.starts.filter(x => x.at > s.time - SCAN_BUDGET_WINDOW_MS);
    expect(inWindow.length).toBeLessThanOrEqual(4);
  });
});

describe('changing intensity', () => {
  let s: FakeScheduler;
  let duty: ScanDutyCycle;

  beforeEach(() => {
    s = new FakeScheduler();
    duty = cycler(s);
  });

  afterEach(() => duty.stop());

  it('does not spend a start when the radio is already on', () => {
    duty.start('balanced');
    const before = s.starts.length;
    duty.setIntensity('active');
    // Already scanning: re-pacing must not stop and restart just to apply a mode.
    expect(s.starts).toHaveLength(before);
    expect(s.stops).toHaveLength(0);
  });

  it('ignores a change to the intensity already in force', () => {
    duty.start('balanced');
    const before = s.starts.length;
    duty.setIntensity('balanced');
    s.advance(100);
    expect(s.starts).toHaveLength(before);
  });

  it('takes effect on the next cycle', () => {
    duty.start('saver');
    s.advance(SCAN_PROFILES.saver.burstMs!);
    expect(duty.isBursting).toBe(false);

    // Switching to a shorter rest while resting should bring the next burst forward.
    duty.setIntensity('balanced');
    s.advance(SCAN_PROFILES.balanced.restMs);
    expect(s.starts.length).toBeGreaterThan(1);
  });

  it('reports the intensity it is running at', () => {
    duty.start('balanced');
    expect(duty.currentIntensity).toBe('balanced');
    duty.setIntensity('saver');
    expect(duty.currentIntensity).toBe('saver');
  });

  it('every profile stays inside the budget on its own', () => {
    for (const intensity of ['active', 'balanced', 'saver'] as ScanIntensity[]) {
      const fresh = new FakeScheduler();
      const d = cycler(fresh);
      d.start(intensity);
      fresh.advance(5 * 60_000);
      for (const {at} of fresh.starts) {
        const inWindow = fresh.starts.filter(
          x => x.at > at - SCAN_BUDGET_WINDOW_MS && x.at <= at,
        );
        expect(inWindow.length).toBeLessThanOrEqual(5);
      }
      d.stop();
    }
  });
});

describe('telemetry — the evidence a battery test needs', () => {
  let s: FakeScheduler;
  let duty: ScanDutyCycle;

  beforeEach(() => {
    s = new FakeScheduler();
    duty = cycler(s);
  });

  afterEach(() => duty.stop());

  it('reports a duty percentage matching the profile', () => {
    duty.start('saver');
    const {burstMs, restMs} = SCAN_PROFILES.saver;
    // Ten full cycles.
    s.advance((burstMs! + restMs) * 10);

    const t = duty.telemetry();
    const expected = (burstMs! / (burstMs! + restMs)) * 100;
    // The number that decides whether duty cycling is worth anything.
    expect(t.dutyPercent).toBeGreaterThan(expected - 2);
    expect(t.dutyPercent).toBeLessThan(expected + 2);
  });

  it('counts bursts', () => {
    duty.start('balanced');
    const {burstMs, restMs} = SCAN_PROFILES.balanced;
    s.advance((burstMs! + restMs) * 3);
    expect(duty.telemetry().burstCount).toBeGreaterThanOrEqual(3);
  });

  it('counts the burst currently in progress, not just finished ones', () => {
    duty.start('balanced');
    s.advance(2_000); // Mid-burst.
    // Waiting for the burst to end before counting it would make the figure lag.
    expect(duty.telemetry().radioOnMs).toBe(2_000);
    expect(duty.telemetry().bursting).toBe(true);
  });

  it('reports 100% duty in active mode, because the radio never rests', () => {
    duty.start('active');
    s.advance(60_000);
    expect(duty.telemetry().dutyPercent).toBeCloseTo(100, 0);
  });

  it('describes this run of scanning, not the whole app lifetime', () => {
    duty.start('balanced');
    s.advance(30_000);
    duty.stop();
    // Time spent not scanning at all would otherwise dilute the figure into nonsense.
    s.advance(600_000);
    duty.start('balanced');
    s.advance(1_000);

    const t = duty.telemetry();
    expect(t.elapsedMs).toBe(1_000);
    expect(t.burstCount).toBe(1);
  });

  it('surfaces the remaining start budget, so a stalled scan is explainable', () => {
    duty.start('balanced');
    expect(duty.telemetry().startsRemaining).toBeGreaterThan(0);
    for (let i = 0; i < 8; i++) {
      duty.stop();
      duty.start('balanced');
      s.advance(200);
    }
    // "Discovery went quiet" is otherwise almost impossible to attribute.
    expect(duty.telemetry().startsRemaining).toBe(0);
  });
});
