/**
 * The connection handshake, over BLE, with nothing in the middle.
 *
 * Tapping Connect used to write a local record and queue an API call that could
 * never be delivered. This is what replaces it:
 *
 *   find the peer's GATT device → open a link → send CONNECTION_REQUEST
 *      → they see it → they accept or decline → we hear the answer
 *      → only then is anyone connected
 *
 * The distinction that governs this whole file: **a live GATT link is not a
 * connection.** The transport being up only means bytes can move. A connection
 * exists when a person on the other phone said yes. Nothing here reports
 * `connected` on the strength of a socket.
 *
 * WHAT THIS DOES NOT OWN. Persistence of connections belongs to
 * `ConnectionService`, which already had the right record shape and the right
 * per-event storage; this drives it rather than duplicating it. Blocking
 * belongs to `BlockService` and field visibility to `PrivacyService`; both are
 * consulted, neither is reimplemented.
 *
 * ─── correlating two channels ────────────────────────────────────────────────
 *
 * The radar and the GATT service are different namespaces. The radar knows a
 * rotating `peerId`; GATT knows a `deviceId` that is a MAC address on Android
 * and an opaque CoreBluetooth identifier on iOS. Nothing links them a priori.
 *
 * The bridge is the GATT advertisement's local name, which carries the
 * advertiser's CURRENT `peerId`. That discloses nothing new — the same value is
 * already in the clear in every presence beacon — and it rotates on the same
 * epoch, so it hands a passive observer no stable handle. It also needs no
 * change to the presence frame and leaves the presence advertiser
 * non-connectable, exactly as it was.
 *
 * But a name match is a DIALLING HINT, not proof of identity. Anyone can put
 * any string in an advertisement. So the name only decides which device to ring;
 * the authoritative check is the `profileId` inside the request payload, which
 * is validated after the link is up and before anything is shown to the user.
 *
 * ─── identity, and dialling someone you have never heard of ──────────────────
 *
 * A connection is keyed by `profileId`, which is stable for the life of the
 * event. Never by `peerId` (rotates every epoch) and never by `deviceId`
 * (per-link, and not even stable across a reinstall on iOS). So a peer that
 * rotates mid-handshake changes nothing: the open link is keyed by deviceId and
 * survives, and the record it produces is keyed by profileId.
 *
 * But offline the sender usually does NOT know the far side's profileId. The
 * only thing that maps a rotating peer id to a person is the attendee directory,
 * which is populated from a server payload, and there is no server. Requiring a
 * profileId up front therefore made Connect impossible for exactly the people it
 * exists for: the ones discovered purely over the radio.
 *
 * So a request may start PROVISIONAL. It is filed under `peer:<peerId>` — a key,
 * not an identity — and dialled by the advertised name. The real profileId
 * arrives inside the far side's `CONNECTION_ACCEPT`, at which point the record is
 * RECONCILED onto it and the provisional row is discarded. The peer id is never
 * promoted to a stable identifier and never survives the exchange; it is scaffolding
 * that exists only between the tap and the answer.
 *
 * The receiver never needs any of this. A `CONNECTION_REQUEST` carries the
 * sender's card, so the far side learns who is calling from the message itself —
 * which is why the handshake works with no directory on either phone.
 *
 * ─── both people tap Connect ─────────────────────────────────────────────────
 *
 * If a request arrives from someone we already have an outgoing request to,
 * that is mutual consent and both sides connect immediately. No tie-break, no
 * ordering rule, no window where one side is connected and the other is not —
 * and it is what two people who each tapped Connect plainly meant.
 */

import type { Connection, EventId, PeerId, ProfileId } from '../types';
import type { BlockService } from '../security/BlockService';
import type { ConnectionService } from './ConnectionService';
import type { LocalDatabase } from '../storage/LocalDatabase';
import { keys } from '../storage/LocalDatabase';
import { GattMessageType, type GattMessage } from '../bluetooth/gatt/GattMessage';
import { trace } from '../runtime/diagnostics';
import type { GattSessionManager } from '../bluetooth/gatt/GattSessionManager';
import type { GattDisconnectReason, GattDiscovery } from '../bluetooth/gatt/GattTransport';
import {
  CONNECTION_PROTOCOL_VERSION,
  decodeConnectionAccept,
  decodeConnectionReject,
  decodeConnectionRequest,
  encodeConnectionPayload,
  rejectReasonToSend,
  type ConnectionCard,
  type ConnectionRejectReason,
} from './ConnectionProtocol';

/** How long a sent request stays valid before it is given up on. */
export const REQUEST_EXPIRY_MS = 2 * 60 * 1000;

/**
 * The prefix marking a key as a stand-in rather than a person.
 *
 * Deliberately not a valid profileId shape, so a provisional key can never be
 * mistaken for one if it leaks into a log or a record.
 */
export const PROVISIONAL_KEY_PREFIX = 'peer:';

/** A temporary key for someone whose real identity is not known yet. */
export function provisionalKeyFor(peerId: PeerId): ProfileId {
  return `${PROVISIONAL_KEY_PREFIX}${peerId.trim().toUpperCase()}`;
}

/** True when this key is scaffolding, not a person. */
export function isProvisionalKey(key: string): boolean {
  return key.startsWith(PROVISIONAL_KEY_PREFIX);
}

/** How long a GATT discovery is trusted to still be reachable at that deviceId. */
export const DISCOVERY_FRESHNESS_MS = 30_000;

export type ConnectionFailureCode =
  | 'blocked'
  | 'not_accepting'
  | 'already_connected'
  | 'already_pending'
  | 'peer_not_found'
  | 'connect_failed'
  | 'connect_timeout'
  | 'send_failed'
  | 'no_identity'
  | 'unavailable';

export class ConnectionRequestError extends Error {
  readonly code: ConnectionFailureCode;

  constructor(code: ConnectionFailureCode, message: string) {
    super(message);
    this.name = 'ConnectionRequestError';
    this.code = code;
  }
}

/** A request we have sent or received that has not settled yet. */
export interface PendingRequest {
  requestId: string;
  /**
   * The key this exchange is filed under.
   *
   * A real `profileId` once it is known, or a `peer:<peerId>` stand-in while it
   * is not. `provisional` says which, and is the only thing that should ever be
   * consulted before treating this as an identity.
   */
  profileId: ProfileId;
  /** True while `profileId` is a stand-in and the real one is still unknown. */
  provisional: boolean;
  /** The rotating id we dialled, when we dialled by peer rather than by person. */
  peerId: PeerId | null;
  direction: 'outgoing' | 'incoming';
  deviceId: string | null;
  card: ConnectionCard;
  note?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ConnectionRequestEvents {
  /** A request arrived and is waiting for the user. */
  onIncomingRequest(request: PendingRequest): void;
  /** Any request settled, in either direction. */
  onSettled(profileId: ProfileId, connection: Connection): void;
  /**
   * A provisional exchange learned who it was actually talking to.
   *
   * Emitted before the connection is persisted under the real id, so a screen
   * showing "connecting to the person at 7AC212AD" can put a name to it.
   */
  onIdentityLearned(provisionalKey: ProfileId, profileId: ProfileId): void;
  onError(profileId: ProfileId, error: ConnectionRequestError): void;
}

export interface ConnectionRequestCoordinatorOptions {
  sessions: GattSessionManager;
  connections: ConnectionService;
  blocks: BlockService;
  db: LocalDatabase;
  /** Injected clock. Nothing here reads the wall clock. */
  now: () => number;
  /** Our own card, redacted for a stranger by the caller. */
  myCard: () => ConnectionCard | null;
  /** Our own privacy setting. False means we refuse every inbound request. */
  acceptsConnectionRequests: () => boolean;
  /** The peer id the radar is currently seeing for a person, if any. */
  currentPeerIdFor: (profileId: ProfileId) => PeerId | null;
  /** Unique per request. Injected so tests are deterministic. */
  newRequestId: () => string;
  expiryMs?: number;
}

export class ConnectionRequestCoordinator {
  private readonly sessions: GattSessionManager;
  private readonly connections: ConnectionService;
  private readonly blocks: BlockService;
  private readonly db: LocalDatabase;
  private readonly now: () => number;
  private readonly myCard: () => ConnectionCard | null;
  private readonly acceptsRequests: () => boolean;
  private readonly currentPeerIdFor: (profileId: ProfileId) => PeerId | null;
  private readonly newRequestId: () => string;
  private readonly expiryMs: number;

  /** By profileId. At most one live request per person, in either direction. */
  private readonly pending = new Map<ProfileId, PendingRequest>();
  /** GATT devices seen advertising our service: deviceId -> what they announced. */
  private readonly discoveries = new Map<string, { peerId: string; at: number }>();
  /** Live links we opened or accepted, so a message can be traced to a person. */
  private readonly deviceToProfile = new Map<string, ProfileId>();
  /**
   * What each exchange settled to, recorded SYNCHRONOUSLY.
   *
   * `ConnectionService` is the store of record, but writing to it is async, and
   * the instant between "no longer pending" and "written" is where the
   * simultaneous-Connect bug lived: a crossing request or a late disconnect
   * arriving in that gap saw an exchange that was neither live nor finished and
   * treated it as brand new. This map closes the gap. It is a latch for the
   * current exchange only, cleared when a new one starts.
   */
  private readonly settled = new Map<ProfileId, Connection['state']>();

  private readonly listeners = new Set<Partial<ConnectionRequestEvents>>();
  private detach: (() => void) | null = null;
  private eventId: EventId | null = null;
  private started = false;

  constructor(options: ConnectionRequestCoordinatorOptions) {
    this.sessions = options.sessions;
    this.connections = options.connections;
    this.blocks = options.blocks;
    this.db = options.db;
    this.now = options.now;
    this.myCard = options.myCard;
    this.acceptsRequests = options.acceptsConnectionRequests;
    this.currentPeerIdFor = options.currentPeerIdFor;
    this.newRequestId = options.newRequestId;
    this.expiryMs = options.expiryMs ?? REQUEST_EXPIRY_MS;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  async start(eventId: EventId): Promise<void> {
    if (this.started) await this.stop();
    this.started = true;
    this.eventId = eventId;

    const stored = (await this.db.get<PendingRequest[]>(keys.connectionRequests(eventId))) ?? [];
    this.pending.clear();
    for (const request of stored) {
      // A request restored from disk may already have run out of time while the
      // app was closed. Expire on load rather than resurrecting it.
      if (request.expiresAt > this.now()) this.pending.set(request.profileId, request);
    }
    await this.persist();

    this.detach = this.sessions.subscribe({
      onDiscovery: (discovery) => this.handleDiscovery(discovery),
      onMessage: (deviceId, message) => void this.handleMessage(deviceId, message),
      onSessionClosed: (deviceId, reason) => this.handleSessionClosed(deviceId, reason),
    });
  }

  async stop(): Promise<void> {
    this.detach?.();
    this.detach = null;
    this.started = false;
    this.eventId = null;
    this.pending.clear();
    this.settled.clear();
    this.discoveries.clear();
    this.deviceToProfile.clear();
  }

  subscribe(events: Partial<ConnectionRequestEvents>): () => void {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  /* ---------------------------------------------------------------- *
   * Outgoing
   * ---------------------------------------------------------------- */

  /**
   * Ask someone to connect.
   *
   * Every guard below fails LOUDLY — the caller gets an error with a code, not a
   * silent no-op. A Connect button that does nothing is the defect this whole
   * phase exists to remove.
   */
  /**
   * Ask a KNOWN person to connect.
   *
   * The directory resolved them, so the exchange is filed against their real
   * profileId from the start and nothing needs reconciling later.
   */
  async request(profileId: ProfileId, note?: string): Promise<PendingRequest> {
    this.assertStarted();

    if (this.blocks.isBlocked(profileId)) {
      throw this.fail(profileId, 'blocked', 'You have blocked this person.');
    }

    const peerId = this.currentPeerIdFor(profileId);
    trace('GATT', 'device correlation...', {
      profileId,
      peerId,
      knownDevices: this.discoveries.size,
      advertised: [...this.discoveries.values()].map((d) => d.peerId).join(','),
    });

    return this.dial({ key: profileId, provisional: false, peerId, note });
  }

  /**
   * Ask a peer the radar found to connect, without knowing who they are.
   *
   * This is the ordinary offline case, not a fallback. Nothing maps a rotating
   * peer id to a person without a directory, so requiring one would make Connect
   * unusable for anyone discovered over the radio — which is everyone.
   *
   * The exchange is filed under a `peer:` stand-in and reconciled onto the real
   * profileId the moment their accept arrives carrying it.
   */
  async requestByPeer(peerId: PeerId, note?: string): Promise<PendingRequest> {
    this.assertStarted();

    const key = provisionalKeyFor(peerId);
    trace('Connect', 'profileId unavailable — proceeding offline', { peerId, key });
    trace('GATT', 'device correlation...', {
      peerId,
      knownDevices: this.discoveries.size,
      advertised: [...this.discoveries.values()].map((d) => d.peerId).join(','),
    });

    return this.dial({ key, provisional: true, peerId, note });
  }

  /**
   * The one path that opens a link and sends a request.
   *
   * Shared deliberately: a provisional dial and a resolved one differ only in
   * what they are filed under, and letting them drift apart is how one of them
   * quietly stops enforcing a guard the other still does.
   */
  private async dial(input: {
    key: ProfileId;
    provisional: boolean;
    peerId: PeerId | null;
    note?: string;
  }): Promise<PendingRequest> {
    const { key, provisional, peerId, note } = input;

    const state = this.connections.stateFor(key);
    if (state === 'connected') {
      throw this.fail(key, 'already_connected', 'You are already connected.');
    }

    const existing = this.pending.get(key);
    if (existing) {
      if (existing.direction === 'incoming') {
        // They asked first. Answering is the right move; a second request
        // crossways would leave two exchanges to settle.
        await this.accept(key);
        return existing;
      }
      throw this.fail(key, 'already_pending', 'A request is already on its way.');
    }

    const card = this.myCard();
    if (!card) {
      throw this.fail(key, 'no_identity', 'Your own profile is not ready yet.');
    }

    const deviceId = peerId ? this.findDeviceForPeer(peerId) : null;
    trace('GATT', deviceId ? 'device found' : 'device NOT found', { deviceId, peerId });
    if (!deviceId) {
      throw this.fail(
        key,
        'peer_not_found',
        'They are on the radar but not reachable for a connection right now. Their phone has to be advertising the connection service.',
      );
    }

    // A dial to a device we are already mid-exchange with under a different key
    // would open a second exchange on one link. Refuse rather than duplicate.
    const heldBy = this.deviceToProfile.get(deviceId);
    if (heldBy && heldBy !== key && this.pending.has(heldBy)) {
      throw this.fail(key, 'already_pending', 'A request to this person is already on its way.');
    }

    this.clearSettled(key);

    const at = this.now();
    const request: PendingRequest = {
      requestId: this.newRequestId(),
      profileId: key,
      provisional,
      peerId,
      direction: 'outgoing',
      deviceId,
      card,
      note,
      createdAt: at,
      expiresAt: at + this.expiryMs,
    };

    // Recorded BEFORE the radio is touched. If the link fails we want a record
    // to move to `failed`, not a request that never existed.
    this.pending.set(key, request);
    this.deviceToProfile.set(deviceId, key);
    await this.persist();
    await this.writeConnection(key, 'outgoing_pending', request);

    try {
      trace('GATT', 'connecting...', { deviceId });
      await this.sessions.open(deviceId);
      trace('GATT', 'connected', { deviceId });
      await this.sessions.send(
        deviceId,
        GattMessageType.ConnectionRequest,
        encodeConnectionPayload({
          v: CONNECTION_PROTOCOL_VERSION,
          requestId: request.requestId,
          card,
          note,
          sentAt: at,
        }),
      );
      trace('Request', 'sent', { deviceId, requestId: request.requestId, provisional });
    } catch (error) {
      trace('GATT', 'failed', {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string } | null)?.code,
      });
      await this.settle(key, 'failed');
      throw this.fail(
        key,
        codeForTransportError(error),
        'Could not reach them. They may have moved out of range.',
      );
    }

    return request;
  }

  /** Withdraw our own request. */
  async cancel(profileId: ProfileId): Promise<void> {
    const request = this.pending.get(profileId);
    if (!request || request.direction !== 'outgoing') return;
    await this.settle(profileId, 'cancelled');
    if (request.deviceId) await this.closeIfIdle(request.deviceId);
  }

  /* ---------------------------------------------------------------- *
   * Incoming
   * ---------------------------------------------------------------- */

  async accept(profileId: ProfileId): Promise<void> {
    const request = this.pending.get(profileId);
    if (!request) return;
    // Accepting our own outgoing request is meaningless; only the far side can.
    if (request.direction !== 'incoming') return;

    const card = this.myCard();
    if (request.deviceId && card) {
      await this.sendSafely(request.deviceId, GattMessageType.ConnectionAccept, {
        v: CONNECTION_PROTOCOL_VERSION,
        requestId: request.requestId,
        card,
        acceptedAt: this.now(),
      });
    }
    await this.settle(profileId, 'connected');
  }

  async reject(profileId: ProfileId): Promise<void> {
    const request = this.pending.get(profileId);
    if (!request || request.direction !== 'incoming') return;
    await this.sendReject(request.deviceId, request.requestId, 'declined');
    await this.settle(profileId, 'declined');
    if (request.deviceId) await this.closeIfIdle(request.deviceId);
  }

  /* ---------------------------------------------------------------- *
   * Time
   * ---------------------------------------------------------------- */

  /** Expire anything that has run out of time. Returns who expired. */
  async tick(now: number): Promise<ProfileId[]> {
    const expired: ProfileId[] = [];
    for (const [profileId, request] of [...this.pending]) {
      if (now < request.expiresAt) continue;
      expired.push(profileId);
      await this.settle(profileId, 'expired');
      if (request.deviceId) await this.closeIfIdle(request.deviceId);
    }

    for (const [deviceId, seen] of [...this.discoveries]) {
      if (now - seen.at > DISCOVERY_FRESHNESS_MS) this.discoveries.delete(deviceId);
    }
    return expired;
  }

  /* ---------------------------------------------------------------- *
   * Reads
   * ---------------------------------------------------------------- */

  pendingFor(profileId: ProfileId): PendingRequest | null {
    return this.pending.get(profileId) ?? null;
  }

  incoming(): PendingRequest[] {
    return [...this.pending.values()]
      .filter((request) => request.direction === 'incoming')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  outgoing(): PendingRequest[] {
    return [...this.pending.values()].filter((request) => request.direction === 'outgoing');
  }

  /** True when this person is reachable for a connection right now. */
  isReachable(profileId: ProfileId): boolean {
    const peerId = this.currentPeerIdFor(profileId);
    return peerId !== null && this.findDeviceForPeer(peerId) !== null;
  }

  /** True when this radar peer is reachable, without needing to know who they are. */
  isPeerReachable(peerId: PeerId): boolean {
    return this.findDeviceForPeer(peerId) !== null;
  }

  /* ---------------------------------------------------------------- *
   * Transport callbacks
   * ---------------------------------------------------------------- */

  private handleDiscovery(discovery: GattDiscovery): void {
    // The advertised name is the peer's current rotating id. Treated as a hint
    // only — see the header. An advertisement with no name tells us nothing we
    // can correlate, so it is remembered but never matched.
    const peerId = (discovery.displayName ?? '').trim().toUpperCase();
    trace('GATT', 'discovery', {
      deviceId: discovery.deviceId,
      name: discovery.displayName,
      usable: peerId.length > 0,
    });
    if (peerId.length === 0) return;
    this.discoveries.set(discovery.deviceId, { peerId, at: this.now() });
  }

  private handleSessionClosed(deviceId: string, reason: GattDisconnectReason): void {
    const profileId = this.deviceToProfile.get(deviceId);
    this.deviceToProfile.delete(deviceId);
    if (!profileId) return;

    const request = this.pending.get(profileId);
    if (!request) return;
    // The exchange already finished; this teardown is its own cleanup arriving
    // back at us, not a failure.
    if (this.settled.has(profileId)) return;

    // A link that drops mid-handshake means no answer is coming on it. An
    // established connection is unaffected: it is a record, not a socket.
    void this.settle(profileId, reason === 'timeout' ? 'expired' : 'failed');
  }

  private async handleMessage(deviceId: string, message: GattMessage): Promise<void> {
    switch (message.type) {
      case GattMessageType.ConnectionRequest:
        await this.onRequest(deviceId, message.payload);
        return;
      case GattMessageType.ConnectionAccept:
        await this.onAccept(deviceId, message.payload);
        return;
      case GattMessageType.ConnectionReject:
        await this.onReject(deviceId, message.payload);
        return;
      default:
        // Hello and anything unknown. Not ours.
        return;
    }
  }

  private async onRequest(deviceId: string, payload: Uint8Array): Promise<void> {
    const request = decodeConnectionRequest(payload);
    if (!request) return; // malformed: dropped without disturbing the link

    const profileId = request.card.profileId;
    const myCard = this.myCard();

    trace('Request', 'received', { deviceId, from: profileId, requestId: request.requestId });

    // Refuse a request that claims to be from us. Nothing legitimate does this,
    // and accepting it would create a connection to yourself.
    if (myCard && profileId === myCard.profileId) return;

    /*
     * Capture the key this link is already filed under BEFORE re-pointing it.
     * If we dialled them provisionally, our own outstanding exchange lives
     * under `peer:<peerId>`, and overwriting the mapping first would lose the
     * only handle we have on it — turning mutual consent into two unrelated
     * requests.
     */
    const keyByDevice = this.deviceToProfile.get(deviceId);
    this.deviceToProfile.set(deviceId, profileId);

    // Blocked and privacy-refused both go out as a plain decline: telling
    // someone they are blocked confirms they were noticed.
    if (this.blocks.isBlocked(profileId)) {
      await this.sendReject(deviceId, request.requestId, 'blocked');
      return;
    }
    if (!this.acceptsRequests()) {
      await this.sendReject(deviceId, request.requestId, 'not_accepting');
      return;
    }

    // Already connected: re-confirm rather than creating a second record. This
    // is what makes a retry after a dropped link idempotent.
    if (this.hasSettledAsConnected(profileId)) {
      if (myCard) {
        await this.sendSafely(deviceId, GattMessageType.ConnectionAccept, {
          v: CONNECTION_PROTOCOL_VERSION,
          requestId: request.requestId,
          card: myCard,
          acceptedAt: this.now(),
        });
      }
      return;
    }

    // Look for our own exchange under the identity they just gave us, and also
    // under whatever key this link was already filed as — which is how a
    // provisional dial to the same person is recognised as the same exchange.
    const existingKey = this.pending.has(profileId)
      ? profileId
      : keyByDevice && this.pending.has(keyByDevice)
        ? keyByDevice
        : null;
    const existing = existingKey ? this.pending.get(existingKey) : undefined;

    // Both tapped Connect. Mutual consent — connect, and tell them so.
    if (existing?.direction === 'outgoing' && existingKey) {
      if (myCard) {
        await this.sendSafely(deviceId, GattMessageType.ConnectionAccept, {
          v: CONNECTION_PROTOCOL_VERSION,
          requestId: request.requestId,
          card: myCard,
          acceptedAt: this.now(),
        });
      }
      if (existing.provisional && existingKey !== profileId) {
        await this.reconcile(existingKey, profileId, existing, request.card);
      } else {
        await this.settle(existingKey, 'connected', request.card);
        trace('Connection', 'persisted', { profileId });
      }
      return;
    }

    // A duplicate of a request we are already showing. Keep the original — its
    // requestId is the one the far side is waiting on an answer for.
    if (existing?.direction === 'incoming') {
      existing.deviceId = deviceId;
      await this.persist();
      return;
    }

    this.clearSettled(profileId);

    const at = this.now();
    const pending: PendingRequest = {
      requestId: request.requestId,
      // Never provisional: an inbound request states who it is from, which is
      // the whole reason the receiver needs no directory.
      provisional: false,
      peerId: null,
      profileId,
      direction: 'incoming',
      deviceId,
      card: request.card,
      note: request.note,
      createdAt: at,
      expiresAt: at + this.expiryMs,
    };
    this.pending.set(profileId, pending);
    await this.persist();
    await this.writeConnection(profileId, 'incoming_pending', pending);
    this.emit('onIncomingRequest', pending);
  }

  private async onAccept(deviceId: string, payload: Uint8Array): Promise<void> {
    const accept = decodeConnectionAccept(payload);
    if (!accept) return;

    const learned = accept.card.profileId;

    /*
     * Find the exchange by the LINK it arrived on, not by the identity in the
     * payload. A provisional dial is filed under `peer:<peerId>` precisely
     * because we did not know that identity when we sent the request, so
     * looking it up by profileId would miss our own outstanding exchange and
     * the accept would be discarded as unsolicited.
     */
    const key = this.deviceToProfile.get(deviceId) ?? learned;
    const request = this.pending.get(key);

    // An accept for an exchange we are not in, or for a different request than
    // the one outstanding, is a late message from a settled attempt. Ignored.
    if (!request || request.requestId !== accept.requestId) return;
    if (request.direction !== 'outgoing') return;

    trace('Request', 'accepted', {
      deviceId,
      key,
      learnedProfileId: learned,
      provisional: request.provisional,
    });

    /*
     * Blocking, enforced on the identity we have only just learned.
     *
     * A provisional dial could not check the blocklist before sending — there
     * was no identity to check. This is the first moment it can be, and it has
     * to happen before anything is recorded as connected.
     */
    if (this.blocks.isBlocked(learned)) {
      await this.settle(key, 'declined');
      await this.closeIfIdle(deviceId);
      return;
    }

    this.deviceToProfile.set(deviceId, learned);

    if (request.provisional && key !== learned) {
      await this.reconcile(key, learned, request, accept.card);
      return;
    }

    await this.settle(key, 'connected', accept.card);
    trace('Connection', 'persisted', { profileId: key });
  }

  /**
   * Move a provisional exchange onto the identity it turned out to belong to.
   *
   * The `peer:` key was scaffolding between the tap and the answer. Once the
   * far side has said who they are, the connection is filed against that stable
   * profileId and the placeholder row is discarded — so the pair appears once,
   * as a person, and a later rotation of their peer id cannot produce a second
   * permanent record for the same human.
   */
  private async reconcile(
    provisionalKey: ProfileId,
    profileId: ProfileId,
    request: PendingRequest,
    card: ConnectionCard,
  ): Promise<void> {
    trace('Connection', 'reconciling provisional key onto profileId', {
      provisionalKey,
      profileId,
    });
    this.emit('onIdentityLearned', provisionalKey, profileId);

    // Retire the stand-in and re-file the exchange, so `settle` writes the
    // connection against the real person.
    this.pending.delete(provisionalKey);
    this.settled.set(provisionalKey, 'connected');
    this.pending.set(profileId, { ...request, profileId, provisional: false });

    await this.settle(profileId, 'connected', card);

    if (this.eventId) {
      await this.connections.discardLocal(this.eventId, provisionalKey);
    }
    trace('Connection', 'persisted', { profileId });
  }

  private async onReject(deviceId: string, payload: Uint8Array): Promise<void> {
    const reject = decodeConnectionReject(payload);
    if (!reject) return;

    const profileId = this.deviceToProfile.get(deviceId);
    if (!profileId) return;

    const request = this.pending.get(profileId);
    if (!request || request.requestId !== reject.requestId) return;
    if (request.direction !== 'outgoing') return;

    await this.settle(profileId, 'declined');
    await this.closeIfIdle(deviceId);
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  /**
   * Which GATT device is advertising this peer id, if any.
   *
   * Matches the id the radar reports against the name the GATT advertisement
   * carried. A discovery older than `DISCOVERY_FRESHNESS_MS` is not trusted:
   * peer ids rotate, and a stale mapping would dial a stranger.
   */
  private findDeviceForPeer(peerId: PeerId): string | null {
    const wanted = peerId.trim().toUpperCase();
    const cutoff = this.now() - DISCOVERY_FRESHNESS_MS;

    for (const [deviceId, seen] of this.discoveries) {
      if (seen.peerId === wanted && seen.at >= cutoff) return deviceId;
    }
    return null;
  }

  private async settle(
    profileId: ProfileId,
    state: 'connected' | 'declined' | 'cancelled' | 'expired' | 'failed',
    card?: ConnectionCard,
  ): Promise<void> {
    const request = this.pending.get(profileId);

    // A settle for an exchange that has already finished is a late message from
    // a superseded attempt. Ignore it rather than overwriting the real outcome
    // with a staler one.
    if (!request && this.settled.has(profileId)) return;

    this.pending.delete(profileId);
    this.settled.set(profileId, state);

    const connection = await this.writeConnection(profileId, state, request, card);
    await this.persist();
    if (connection) this.emit('onSettled', profileId, connection);

    /*
     * A stand-in key must not outlive the exchange that minted it.
     *
     * `peer:<rotatingPeerId>` is scaffolding, not a person. When an exchange
     * reaches a terminal state without ever learning who it was talking to, the
     * row is a record of a rotating id that will never mean anything again —
     * and because the id rotates every epoch, dialling one unanswering peer
     * repeatedly would leave a fresh dead row behind each time.
     *
     * The record is still WRITTEN and `onSettled` still fires before this, so a
     * screen watching the outcome sees it; only the persisted row goes. Three
     * guards keep it narrow:
     *
     *   - only provisional keys, so a real profileId connection is never at risk;
     *   - never on `connected`, which reaches here only via `reconcile` and is
     *     already filed against a stable identity;
     *   - `discardLocal` is a no-op when the row is absent, so repeating this is
     *     harmless.
     */
    if (state !== 'connected' && isProvisionalKey(profileId) && this.eventId) {
      await this.connections.discardLocal(this.eventId, profileId);
    }
  }

  /** True once this exchange has finished, even if the write is still in flight. */
  private hasSettledAsConnected(profileId: ProfileId): boolean {
    return (
      this.settled.get(profileId) === 'connected' ||
      this.connections.stateFor(profileId) === 'connected'
    );
  }

  /** A new exchange with this person supersedes whatever the last one decided. */
  private clearSettled(profileId: ProfileId): void {
    this.settled.delete(profileId);
  }

  private async writeConnection(
    profileId: ProfileId,
    state: Connection['state'],
    request?: PendingRequest,
    card?: ConnectionCard,
  ): Promise<Connection | null> {
    if (!this.eventId) return null;
    return this.connections.applyLocalState({
      eventId: this.eventId,
      profileId,
      state,
      requestId: request?.requestId,
      note: request?.note,
      card: card ?? request?.card,
      expiresAt:
        state === 'outgoing_pending' || state === 'incoming_pending'
          ? request?.expiresAt
          : undefined,
      at: this.now(),
    });
  }

  private async sendReject(
    deviceId: string | null,
    requestId: string,
    reason: ConnectionRejectReason,
  ): Promise<void> {
    if (!deviceId) return;
    await this.sendSafely(deviceId, GattMessageType.ConnectionReject, {
      v: CONNECTION_PROTOCOL_VERSION,
      requestId,
      reason: rejectReasonToSend(reason),
      rejectedAt: this.now(),
    });
  }

  /**
   * Send, tolerating a link that has already gone.
   *
   * Every caller here is on a path where the local decision has been made and
   * must stand whatever the radio does: declining someone is still declining
   * them even if the reject never reaches their phone.
   */
  private async sendSafely(deviceId: string, type: number, payload: unknown): Promise<void> {
    try {
      await this.sessions.send(deviceId, type, encodeConnectionPayload(payload));
    } catch {
      // The link is gone. The local record is already correct.
    }
  }

  /**
   * The device a person is currently reachable on, or null.
   *
   * A read of what this class already tracks, added because it is the only
   * component that knows it. `deviceToProfile` is written when we dial out
   * (`request`), when a request arrives, and again on accept — where it is
   * re-pointed from a provisional `peer:` key onto the real profileId. So after
   * a completed handshake it holds exactly the mapping a conversation needs,
   * and rebuilding it anywhere else would be a second copy that drifts.
   *
   * A scan rather than a reverse index: this map holds one entry per live link,
   * of which there are a handful at most, and a second map maintained alongside
   * the first is precisely the kind of thing that goes stale.
   */
  deviceFor(profileId: ProfileId): string | null {
    for (const [deviceId, id] of this.deviceToProfile) {
      if (id === profileId) return deviceId;
    }
    return null;
  }

  /**
   * Which person a live link belongs to, or null. The forward read of `deviceFor`.
   *
   * A direct `.get` where `deviceFor` must scan, because the map is already
   * keyed this way. Two things are deliberately reported as unknown.
   *
   * A provisional `peer:` key is a rotating id, not a person; a conversation
   * filed under one would be persisted to disk under a name that stops meaning
   * anything at the next epoch.
   *
   * And an entry whose exchange has not settled as connected is not an
   * attribution yet. `deviceToProfile` is written on the first sight of a
   * request - BEFORE the block check and before the privacy check - and again
   * on an outgoing dial before the radio is touched. Answering from it
   * unguarded would hand chat a person we blocked, refused, or never finished
   * greeting, and route their messages into the UI.
   */
  profileForDevice(deviceId: string): ProfileId | null {
    const profileId = this.deviceToProfile.get(deviceId) ?? null;
    if (profileId === null || isProvisionalKey(profileId)) return null;
    return this.hasSettledAsConnected(profileId) ? profileId : null;
  }

  /**
   * Who a peer on the radar turned out to be, once a connection settled.
   *
   * Offline a radar entry is a rotating peer id and nothing else — no directory
   * maps it to a person — so a screen holding one cannot ask
   * `connectionService` anything about them. This composes the two things the
   * coordinator already knows: which device is advertising that peer id right
   * now, and which person answered on that device. Read-only, and it inherits
   * `profileForDevice`'s guards, so it stays null until the exchange has
   * actually settled as connected.
   */
  profileForPeer(peerId: PeerId): ProfileId | null {
    const deviceId = this.findDeviceForPeer(peerId);
    return deviceId ? this.profileForDevice(deviceId) : null;
  }

  /** Drop a link that no longer has a live exchange on it. */
  private async closeIfIdle(deviceId: string): Promise<void> {
    const profileId = this.deviceToProfile.get(deviceId);
    if (profileId && this.pending.has(profileId)) return;
    this.deviceToProfile.delete(deviceId);
    try {
      await this.sessions.close(deviceId);
    } catch {
      // Already closed.
    }
  }

  private async persist(): Promise<void> {
    if (!this.eventId) return;
    await this.db.set(keys.connectionRequests(this.eventId), [...this.pending.values()]);
  }

  private assertStarted(): void {
    if (!this.started || !this.eventId) {
      throw new ConnectionRequestError('unavailable', 'Not in an event yet.');
    }
  }

  private fail(
    profileId: ProfileId,
    code: ConnectionFailureCode,
    message: string,
  ): ConnectionRequestError {
    const error = new ConnectionRequestError(code, message);
    this.emit('onError', profileId, error);
    return error;
  }

  private emit<K extends keyof ConnectionRequestEvents>(
    name: K,
    ...args: Parameters<NonNullable<ConnectionRequestEvents[K]>>
  ): void {
    for (const listener of [...this.listeners]) {
      const handler = listener[name];
      if (handler) (handler as (...a: unknown[]) => void)(...args);
    }
  }
}

function codeForTransportError(error: unknown): ConnectionFailureCode {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'connect_timeout') return 'connect_timeout';
  if (code === 'not_connected' || code === 'write_failed' || code === 'notify_failed') {
    return 'send_failed';
  }
  return 'connect_failed';
}
