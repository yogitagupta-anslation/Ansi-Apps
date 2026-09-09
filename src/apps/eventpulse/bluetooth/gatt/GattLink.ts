/**
 * The connection lifecycle, as a state machine with no radio in it.
 *
 * BLE connection code goes wrong in the gaps between states: a connect that is
 * cancelled while it is still resolving, a disconnect callback that fires after
 * teardown, two taps on the same person producing two links. Those are ordering
 * bugs, and ordering bugs are testable — but only if the ordering lives
 * somewhere that does not need a radio to run. So it lives here, and the
 * transports below the seam do as they are told.
 *
 * Legal transitions:
 *
 *      idle ──connect──▶ connecting ──ready───▶ connected
 *        ▲                   │                     │
 *        │                   ├──fail─────▶ failed ◀┼──fail
 *        │                   ├──drop─────▶ failed  │
 *        │                   ├──timeout──▶ failed  │
 *        │                   └──disconnect──┐      ├──drop──▶ disconnected
 *        │                                  ▼      │              ▲
 *        │                            disconnecting ◀──disconnect─┘
 *        │                                  │
 *        │                                  └──drop / fail──▶ disconnected
 *        └────────────────reset (from a settled link only)──────────┘
 *
 * `failed` and `disconnected` are both terminal for one attempt; the session
 * layer decides whether to start a new one. Nothing returns to `connecting`
 * without going through `idle`, which is what makes a stale callback from a
 * previous attempt harmless.
 */

import type { GattDisconnectReason } from './GattTransport';

export type GattLinkState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'failed';

export type GattLinkEvent =
  | { kind: 'connect' }
  | { kind: 'ready' }
  | { kind: 'disconnect' }
  | { kind: 'drop'; reason: GattDisconnectReason }
  | { kind: 'fail'; reason: GattDisconnectReason }
  | { kind: 'reset' };

export interface GattLinkTransition {
  from: GattLinkState;
  to: GattLinkState;
  at: number;
  reason?: GattDisconnectReason;
}

/**
 * A single link's state.
 *
 * One instance per device id, owned by the session layer. It holds no timers:
 * the caller drives `tick(now)` or calls `event()`. That keeps it deterministic
 * under test and keeps timer ownership in exactly one place.
 */
export class GattLink {
  readonly deviceId: string;

  private currentState: GattLinkState = 'idle';
  private enteredAt: number;
  private lastReason: GattDisconnectReason | undefined;
  private connectDeadline: number | null = null;
  private readonly history: GattLinkTransition[] = [];

  constructor(deviceId: string, now = 0) {
    this.deviceId = deviceId;
    this.enteredAt = now;
  }

  get state(): GattLinkState {
    return this.currentState;
  }

  get reason(): GattDisconnectReason | undefined {
    return this.lastReason;
  }

  get stateEnteredAt(): number {
    return this.enteredAt;
  }

  /** Every transition this link has made, oldest first. For diagnostics and tests. */
  get transitions(): readonly GattLinkTransition[] {
    return this.history;
  }

  /** True while a link can carry traffic. */
  get isUsable(): boolean {
    return this.currentState === 'connected';
  }

  /** True while an attempt is in flight and a second one must not start. */
  get isBusy(): boolean {
    return this.currentState === 'connecting' || this.currentState === 'disconnecting';
  }

  /**
   * Apply an event.
   *
   * @returns the transition that happened, or null when the event is not legal
   *   from the current state. An illegal event is DROPPED, not thrown: almost
   *   every one is a late callback from an attempt that has already been
   *   superseded, and throwing there would turn a benign race into a crash.
   */
  event(event: GattLinkEvent, now: number, connectTimeoutMs?: number): GattLinkTransition | null {
    const from = this.currentState;
    const to = nextState(from, event);
    if (to === null) return null;

    if (event.kind === 'connect') {
      this.connectDeadline =
        connectTimeoutMs !== undefined && connectTimeoutMs > 0 ? now + connectTimeoutMs : null;
    } else if (to !== 'connecting') {
      this.connectDeadline = null;
    }

    this.currentState = to;
    this.enteredAt = now;
    this.lastReason =
      event.kind === 'drop' || event.kind === 'fail' ? event.reason : undefined;

    const transition: GattLinkTransition = { from, to, at: now, reason: this.lastReason };
    this.history.push(transition);
    return transition;
  }

  /**
   * Advance time. The only thing time can do to a link is expire a connect that
   * never completed.
   *
   * @returns the transition to `failed`, or null.
   */
  tick(now: number): GattLinkTransition | null {
    if (this.currentState !== 'connecting') return null;
    if (this.connectDeadline === null || now < this.connectDeadline) return null;
    return this.event({ kind: 'fail', reason: 'timeout' }, now);
  }

  /** Milliseconds until the in-flight connect expires, or null when none is pending. */
  timeUntilTimeout(now: number): number | null {
    if (this.currentState !== 'connecting' || this.connectDeadline === null) return null;
    return Math.max(0, this.connectDeadline - now);
  }
}

/**
 * The transition table.
 *
 * Written as an explicit switch rather than a map so an unhandled state is a
 * compile error rather than a silent `undefined`.
 */
function nextState(from: GattLinkState, event: GattLinkEvent): GattLinkState | null {
  if (event.kind === 'reset') {
    // Only a settled link may be reused. Resetting mid-flight would orphan the
    // native connection that is still being set up.
    return from === 'disconnected' || from === 'failed' || from === 'idle' ? 'idle' : null;
  }

  switch (from) {
    case 'idle':
      return event.kind === 'connect' ? 'connecting' : null;

    case 'connecting':
      if (event.kind === 'ready') return 'connected';
      if (event.kind === 'fail') return 'failed';
      if (event.kind === 'disconnect') return 'disconnecting';
      // A drop during setup is a failure to connect, not a connection that ended.
      if (event.kind === 'drop') return 'failed';
      return null;

    case 'connected':
      if (event.kind === 'disconnect') return 'disconnecting';
      if (event.kind === 'drop') return 'disconnected';
      if (event.kind === 'fail') return 'failed';
      return null;

    case 'disconnecting':
      if (event.kind === 'drop') return 'disconnected';
      // A teardown that errors is still a teardown; the link is gone either way.
      if (event.kind === 'fail') return 'disconnected';
      return null;

    case 'disconnected':
    case 'failed':
      return null;
  }
}
