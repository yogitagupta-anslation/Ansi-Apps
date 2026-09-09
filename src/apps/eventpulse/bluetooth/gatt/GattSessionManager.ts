/**
 * Sessions: what the app talks to instead of a radio.
 *
 * The transport moves bytes to a `deviceId`. This layer turns that into
 * something the rest of EventPulse can use without knowing BLE exists:
 *
 *   - one connect attempt per device, ever, no matter how many times the user taps
 *   - a ceiling on concurrent links, because Android GATT degrades past a handful
 *   - connect timeouts that actually fire, driven by an injected clock
 *   - envelopes, message ids and acknowledgement
 *   - duplicate suppression, because a re-delivered message must not be handled twice
 *   - cleanup on disconnect, so nothing outlives its link
 *
 * It holds no timers of its own. `tick(now)` drives expiry, which is what keeps
 * the whole thing deterministic under test — every timeout in this file can be
 * asserted to the millisecond without waiting for one.
 *
 * DELIBERATELY NOT HERE: any notion of who a person is. This layer knows device
 * ids and message bytes. Mapping a link to an attendee, and the connect/accept
 * workflow itself, belong to the phase above and are not implemented yet.
 */

import { CONNECT_TIMEOUT_MS, MAX_CONCURRENT_LINKS } from './GattProfile';
import {
  GattMessageType,
  MessageIdSource,
  encodeGattMessage,
  tryDecodeGattMessage,
  type GattMessage,
} from './GattMessage';
import type { GattLinkState } from './GattLink';
import {
  GattTransportError,
  type GattDisconnectReason,
  type GattDiscovery,
  type GattPeer,
  type GattTransport,
} from './GattTransport';

export interface GattSessionEvents {
  onDiscovery(discovery: GattDiscovery): void;
  onSessionOpened(session: GattSession): void;
  onSessionClosed(deviceId: string, reason: GattDisconnectReason): void;
  /**
   * A message for the application. Ack, Ping and Pong are answered internally
   * and never surface here; Hello does, because its payload is the peer's
   * identity. An unrecognised type arrives with `known: false`.
   */
  onMessage(deviceId: string, message: GattMessage): void;
  onError(error: GattTransportError): void;
}

export interface GattSession {
  deviceId: string;
  peer: GattPeer;
  openedAt: number;
  /** True once a `Hello` has been seen on this link. */
  greeted: boolean;
}

export interface GattSessionManagerOptions {
  transport: GattTransport;
  /** Injected clock. Nothing in this class reads the wall clock. */
  now: () => number;
  connectTimeoutMs?: number;
  maxConcurrentLinks?: number;
  /** Message ids remembered per link for duplicate suppression. */
  dedupeWindow?: number;
}

interface Tracked {
  session: GattSession;
  /** Ids seen from this peer, newest last. Bounded by `dedupeWindow`. */
  seen: string[];
  seenSet: Set<string>;
}

interface PendingConnect {
  deviceId: string;
  startedAt: number;
  deadline: number;
  resolve: (session: GattSession) => void;
  reject: (error: Error) => void;
}

export class GattSessionManager {
  private readonly transport: GattTransport;
  private readonly now: () => number;
  private readonly connectTimeoutMs: number;
  private readonly maxLinks: number;
  private readonly dedupeWindow: number;

  private readonly sessions = new Map<string, Tracked>();
  private readonly pending = new Map<string, PendingConnect>();
  private readonly listeners = new Set<Partial<GattSessionEvents>>();
  private readonly messageIds = new MessageIdSource();

  private detach: (() => void) | null = null;
  private started = false;

  constructor(options: GattSessionManagerOptions) {
    this.transport = options.transport;
    this.now = options.now;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.maxLinks = options.maxConcurrentLinks ?? MAX_CONCURRENT_LINKS;
    this.dedupeWindow = options.dedupeWindow ?? 256;
  }

  /** Attach to the transport. Idempotent, so a second call cannot stack subscribers. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.detach = this.transport.subscribe({
      onDiscovery: (discovery) => this.emit('onDiscovery', discovery),
      onPeerConnected: (peer) => this.handleConnected(peer),
      onPeerDisconnected: (deviceId, reason) => this.handleDisconnected(deviceId, reason),
      onMessage: (deviceId, payload) => this.handleMessage(deviceId, payload),
      onError: (error) => this.emit('onError', error),
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.detach?.();
    this.detach = null;

    for (const [deviceId, pending] of this.pending) {
      pending.reject(
        new GattTransportError('not_connected', `connect to ${deviceId} abandoned on shutdown`),
      );
    }
    this.pending.clear();
    this.sessions.clear();
    await this.transport.shutdown();
  }

  /* ---------------------------------------------------------------- *
   * Opening and closing
   * ---------------------------------------------------------------- */

  /**
   * Open a session, or return the one that already exists.
   *
   * Two taps on the same person return the SAME promise rather than opening a
   * second link. That is not a nicety: a duplicate GATT connection to one
   * device is how Android ends up with a handle it never releases.
   */
  async open(deviceId: string): Promise<GattSession> {
    const existing = this.sessions.get(deviceId);
    if (existing) return existing.session;

    const inFlight = this.pending.get(deviceId);
    if (inFlight) {
      return new Promise<GattSession>((resolve, reject) => {
        const original = inFlight.resolve;
        const originalReject = inFlight.reject;
        inFlight.resolve = (session) => {
          original(session);
          resolve(session);
        };
        inFlight.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }

    if (this.sessions.size + this.pending.size >= this.maxLinks) {
      throw new GattTransportError(
        'connect_failed',
        `already holding ${this.maxLinks} links, which is as many as the radio handles well`,
        { recoverable: true },
      );
    }

    const startedAt = this.now();
    const promise = new Promise<GattSession>((resolve, reject) => {
      this.pending.set(deviceId, {
        deviceId,
        startedAt,
        deadline: startedAt + this.connectTimeoutMs,
        resolve,
        reject,
      });
    });

    this.transport.connect(deviceId, { timeoutMs: this.connectTimeoutMs }).catch((error) => {
      this.settleFailure(deviceId, error instanceof Error ? error : new Error(String(error)));
    });

    return promise;
  }

  async close(deviceId: string): Promise<void> {
    this.settleFailure(
      deviceId,
      new GattTransportError('not_connected', `connect to ${deviceId} cancelled`),
    );
    await this.transport.disconnect(deviceId);
  }

  /* ---------------------------------------------------------------- *
   * Time
   * ---------------------------------------------------------------- */

  /**
   * Expire connect attempts that have run out of time.
   *
   * @returns the device ids that timed out on this tick.
   */
  tick(now: number): string[] {
    const expired: string[] = [];
    for (const [deviceId, entry] of [...this.pending]) {
      if (now < entry.deadline) continue;
      expired.push(deviceId);
      this.settleFailure(
        deviceId,
        new GattTransportError(
          'connect_timeout',
          `connect to ${deviceId} did not complete within ${this.connectTimeoutMs} ms`,
        ),
      );
      // The native side may still be mid-connect; tell it to let go, or the
      // handle leaks for the rest of the session.
      void this.transport.disconnect(deviceId).catch(() => undefined);
    }
    return expired;
  }

  /* ---------------------------------------------------------------- *
   * Traffic
   * ---------------------------------------------------------------- */

  /** Send an application message. Returns the id it was sent under. */
  async send(deviceId: string, type: number, payload?: Uint8Array): Promise<number> {
    const tracked = this.sessions.get(deviceId);
    if (!tracked) {
      throw new GattTransportError('not_connected', `no session with ${deviceId}`);
    }
    const messageId = this.messageIds.allocate();
    await this.transport.send(deviceId, encodeGattMessage({ type, messageId, payload }));
    return messageId;
  }

  /** Announce ourselves on a fresh link. Phase 3 puts an identity in the payload. */
  async sendHello(deviceId: string, payload?: Uint8Array): Promise<number> {
    return this.send(deviceId, GattMessageType.Hello, payload);
  }

  getSession(deviceId: string): GattSession | undefined {
    return this.sessions.get(deviceId)?.session;
  }

  getSessions(): GattSession[] {
    return [...this.sessions.values()].map((t) => t.session);
  }

  getLinkState(deviceId: string): GattLinkState {
    return this.transport.getLinkState(deviceId);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  subscribe(events: Partial<GattSessionEvents>): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  /* ---------------------------------------------------------------- *
   * Transport callbacks
   * ---------------------------------------------------------------- */

  private handleConnected(peer: GattPeer): void {
    const session: GattSession = {
      deviceId: peer.deviceId,
      peer,
      openedAt: this.now(),
      greeted: false,
    };
    this.sessions.set(peer.deviceId, { session, seen: [], seenSet: new Set() });

    const pending = this.pending.get(peer.deviceId);
    if (pending) {
      this.pending.delete(peer.deviceId);
      pending.resolve(session);
    }

    this.emit('onSessionOpened', session);
  }

  private handleDisconnected(deviceId: string, reason: GattDisconnectReason): void {
    const had = this.sessions.delete(deviceId);

    const pending = this.pending.get(deviceId);
    if (pending) {
      this.pending.delete(deviceId);
      pending.reject(
        new GattTransportError(
          reason === 'timeout' ? 'connect_timeout' : 'connect_failed',
          `connect to ${deviceId} ended before it was usable (${reason})`,
        ),
      );
    }

    if (had) this.emit('onSessionClosed', deviceId, reason);
  }

  private handleMessage(deviceId: string, payload: Uint8Array): void {
    const tracked = this.sessions.get(deviceId);
    if (!tracked) return;

    const message = tryDecodeGattMessage(payload);
    if (!message) {
      this.emit(
        'onError',
        new GattTransportError('internal', `discarded an undecodable message from ${deviceId}`),
      );
      return;
    }

    // Duplicate suppression is keyed on (type, id): an Ack for message 7 and a
    // Hello with id 7 are different messages that happen to share a number.
    const key = `${message.type}:${message.messageId}`;
    if (tracked.seenSet.has(key)) return;
    tracked.seenSet.add(key);
    tracked.seen.push(key);
    while (tracked.seen.length > this.dedupeWindow) {
      const evicted = tracked.seen.shift();
      if (evicted !== undefined) tracked.seenSet.delete(evicted);
    }

    // Transport-level housekeeping is handled here.
    //
    // Ack, Pong and Ping `return` — they are pure plumbing and the application
    // has nothing to do with them. Hello `break`s and DOES surface: it is the
    // message that will carry a peer's identity in the next phase, so the layer
    // above has to see it. The distinction is deliberate; do not "tidy" the
    // break into a return.
    switch (message.type) {
      case GattMessageType.Hello:
        tracked.session.greeted = true;
        void this.replyAck(deviceId, message.messageId);
        break;
      case GattMessageType.Ping:
        void this.transport
          .send(
            deviceId,
            encodeGattMessage({
              type: GattMessageType.Pong,
              messageId: message.messageId,
            }),
          )
          .catch(() => undefined);
        return;
      case GattMessageType.Ack:
      case GattMessageType.Pong:
        return;
      default:
        break;
    }

    this.emit('onMessage', deviceId, message);
  }

  private async replyAck(deviceId: string, messageId: number): Promise<void> {
    try {
      await this.transport.send(
        deviceId,
        encodeGattMessage({ type: GattMessageType.Ack, messageId }),
      );
    } catch {
      // An ack that cannot be sent means the link is already gone; the
      // disconnect callback is what cleans up, not this.
    }
  }

  /** Resolve a pending connect as a failure, if one is outstanding. */
  private settleFailure(deviceId: string, error: Error): void {
    const pending = this.pending.get(deviceId);
    if (!pending) return;
    this.pending.delete(deviceId);
    pending.reject(error);
  }

  private emit<K extends keyof GattSessionEvents>(
    name: K,
    ...args: Parameters<NonNullable<GattSessionEvents[K]>>
  ): void {
    for (const listener of [...this.listeners]) {
      const handler = listener[name];
      if (handler) (handler as (...a: unknown[]) => void)(...args);
    }
  }
}
