/**
 * Match clock: a countdown, then the hunt.
 *
 * Only the host runs an authoritative timer. Players mirror it from the
 * remaining-milliseconds figure in GAME_STATE, tracked through RemoteClock so a
 * skewed device clock cannot corrupt the display.
 */
import {Emitter} from '../utils/emitter';
import {RemoteClock} from '../utils/time';
import {createLogger} from '../utils/logger';

const log = createLogger('GameTimer');

export interface GameTimerEvents {
  countdownTick: {secondsLeft: number};
  countdownFinished: void;
  tick: {remainingMs: number};
  expired: void;
}

export class GameTimer {
  readonly events = new Emitter<GameTimerEvents>();

  private countdownHandle: ReturnType<typeof setInterval> | null = null;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private endsAtMs: number | null = null;
  private durationMs = 0;
  private readonly clock = new RemoteClock();
  private authoritative = true;

  /** Host: run the pre-match countdown, then invoke `onDone`. */
  startCountdown(seconds: number, onDone: () => void): void {
    this.stopCountdown();
    let remaining = seconds;
    this.events.emit('countdownTick', {secondsLeft: remaining});

    this.countdownHandle = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        this.events.emit('countdownTick', {secondsLeft: remaining});
        return;
      }
      this.stopCountdown();
      this.events.emit('countdownTick', {secondsLeft: 0});
      this.events.emit('countdownFinished', undefined);
      onDone();
    }, 1000);
  }

  stopCountdown(): void {
    if (this.countdownHandle) {
      clearInterval(this.countdownHandle);
      this.countdownHandle = null;
    }
  }

  /**
   * Host: start the authoritative match clock.
   * @param durationSec 0 means no time limit.
   */
  start(durationSec: number): void {
    this.stop();
    this.authoritative = true;
    this.durationMs = durationSec * 1000;

    if (durationSec <= 0) {
      this.endsAtMs = null;
      log.info('match started with no time limit');
      return;
    }

    this.endsAtMs = Date.now() + this.durationMs;
    this.clock.sync(this.durationMs);
    log.info(`match clock started: ${durationSec}s`);
    this.runTicker();
  }

  /** Player: follow the host's clock. */
  followRemote(remainingMs: number): void {
    this.authoritative = false;
    this.clock.sync(remainingMs);
    if (!this.tickHandle && remainingMs > 0) {
      this.runTicker();
    }
  }

  private runTicker(): void {
    if (this.tickHandle) {
      return;
    }
    this.tickHandle = setInterval(() => {
      const remaining = this.remainingMs();
      this.events.emit('tick', {remainingMs: remaining});

      // Only the host may declare time up; a player waits to be told, so a
      // brief clock disagreement cannot end the match early on one device.
      if (remaining <= 0 && this.authoritative) {
        this.stop();
        log.info('match clock expired');
        this.events.emit('expired', undefined);
      }
    }, 250);
  }

  remainingMs(): number {
    if (this.authoritative) {
      if (this.endsAtMs === null) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.max(0, this.endsAtMs - Date.now());
    }
    return this.clock.remainingMs();
  }

  get hasTimeLimit(): boolean {
    return this.authoritative ? this.endsAtMs !== null : true;
  }

  get isRunning(): boolean {
    return this.tickHandle !== null;
  }

  get endsAt(): number | null {
    return this.endsAtMs;
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.clock.stop();
  }

  dispose(): void {
    this.stopCountdown();
    this.stop();
    this.endsAtMs = null;
    this.events.removeAllListeners();
  }
}
