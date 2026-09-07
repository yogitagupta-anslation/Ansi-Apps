import {
  HANDSHAKE_TIMEOUT_MS,
  PEER_STALE_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  RECONNECT_MAX_DELAY_MS,
} from '../config/constants';
import {isCentralLink} from '../utils/linkId';
import type {MessageRouter, PeerRouteResolver} from '../messaging/MessageRouter';
import {
  buildHello,
  buildHelloAck,
  buildHelloConfirm,
} from '../messaging/Packet';
import {
  challengeBytes,
  hexToPrivateKey,
  randomNonce,
  sign,
  verifyPeerClaim,
} from '../crypto/Identity';
import {
  deriveSessionKeys,
  ephemeralPublicKeyFromHex,
  ephemeralPublicKeyToHex,
  generateEphemeralKeyPair,
  SessionCipher,
  type EphemeralKeyPair,
} from '../crypto/SessionCrypto';
import {SessionRegistry} from '../crypto/SessionRegistry';
import {
  agreeCapabilities,
  localCapabilities,
  LOCAL_VERSION,
  negotiateVersion,
  parseCapabilities,
  type Capabilities,
} from '../messaging/Negotiation';
import {LinkMetrics, type LinkMetricsSnapshot} from './LinkMetrics';
import {DEFAULT_ATT_MTU} from '../config/constants';
import type {LinkFailure, LinkId, LinkRole, LinkState} from '../types/BLE';
import type {
  Packet,
  HelloPayload,
  HelloAckPayload,
  HelloConfirmPayload,
} from '../types/Packet';
import type {PeerLinkTransport} from '../types/Transport';
import type {Peer, PeerIdentity, SignalStrength} from '../types/Peer';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {sanitiseInterests} from '../config/interests';
import {shortId} from '../utils/id';
import {makeFailure, toLinkFailure} from '../utils/linkFailure';

const TAG = 'PeerManager';

type PeerEvents = {
  peersChanged: Peer[];
  peerConnected: Peer;
  /** A peer whose application identity is now known, worth remembering. */
  peerIdentified: {peerId: string; displayName: string};
  peerDisconnected: {peerId: string; linkId: LinkId};
  handshakeFailed: {linkId: LinkId; reason: string};
  /** The full block list, whenever it changes — the persistence hook's cue to save. */
  blockedPeersChanged: string[];
  /**
   * A handshake was refused for a security reason, as opposed to a radio one.
   *
   * Emitted so the composition root can record it in the security history. Kept separate
   * from handshakeFailed, which covers every failure including ordinary timeouts.
   */
  securityRefusal: {
    kind: 'blocked' | 'authFailed';
    peerId: string | null;
    displayName: string | null;
    detail: string;
  };
};

interface LinkSession {
  linkId: LinkId;
  role: LinkRole;
  state: LinkState;
  peerId: string | null;
  displayName: string | null;
  protocolVersion: number | null;
  relay: boolean;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  /** The nonce WE issued, which the peer must sign. Single use. */
  ourChallenge: string;
  /** Set once the peer has proven ownership of its key. */
  peerAuthenticated: boolean;
  /** Held until the peer's HELLO_CONFIRM arrives (responder side). */
  pendingNegotiation: Negotiated | null;
  /** Our X25519 keypair for THIS link only. Never reused across connections. */
  ephemeral: EphemeralKeyPair;
  /** Their ephemeral public key, hex, once their HELLO/HELLO_ACK has supplied it. */
  peerEphemeralKey: string | null;
  /** Their challenge, kept because the session KDF binds both challenges. */
  peerChallenge: string | null;
}

/** What both ends settled on during the handshake. */
interface Negotiated {
  peerId: string;
  displayName: string;
  protocolVersion: number;
  capabilities: Capabilities;
  agreed: Capabilities;
  compatibilityNote: string | null;
  publicKey: string;
  /** Sanitised: the peer chose these bytes, so they are bounded before we keep them. */
  interests: string[];
}

/**
 * One line in a link's connection timeline.
 *
 * Recorded because "Connection failed" on its own is unactionable: knowing whether it got
 * as far as discovering services, negotiating an MTU or shaking hands is the difference
 * between a peer that is out of range and one that is running the wrong build.
 */
export interface ConnectionEvent {
  at: number;
  label: string;
  detail?: string;
  tone: 'progress' | 'ok' | 'error';
}

/** Attempt bookkeeping per link, kept even before an identity is known. */
export interface LinkStats {
  attempts: number;
  successes: number;
  failures: number;
}

/** How many timeline entries one link keeps. Bounded — this runs for the whole session. */
const MAX_HISTORY_PER_LINK = 60;

/** Timeline wording. Reads as a sequence of things that happened, not as state names. */
const PHASE_LABEL: Partial<Record<LinkState, string>> = {
  connecting: 'Connecting',
  discoveringServices: 'Service discovered',
  negotiatingMtu: 'MTU negotiated',
  enablingNotifications: 'Notifications enabled',
  handshaking: 'Handshake started',
  disconnecting: 'Disconnecting',
  reconnecting: 'Reconnecting',
};

/** A peer record for a link whose application identity is not known yet. */
function blankPeer(linkId: LinkId, state: LinkState): Peer {
  const now = Date.now();
  return {
    peerId: null,
    peerIdPrefix: null,
    displayName: null,
    interests: [],
    linkId,
    role: isCentralLink(linkId) ? 'central' : 'peripheral',
    state,
    rssi: null,
    lastSeen: now,
    firstSeen: now,
    connectCount: 0,
    attempts: 0,
    failures: 0,
    reconnectAttempt: 0,
    protocolVersion: null,
    capabilities: null,
    agreedCapabilities: null,
    compatibilityNote: null,
    publicKey: null,
    authenticated: false,
    queuedCount: 0,
    metrics: null,
    gatt: null,
    failure: null,
  };
}

/**
 * Discovery, link lifecycle, the application handshake, and the peerId <-> linkId map.
 *
 * The handshake is deliberately asymmetric: whoever opened the link (the CENTRAL) sends
 * HELLO, and the PERIPHERAL answers HELLO_ACK. Both sides sending HELLO would race.
 */
export class PeerManager implements PeerRouteResolver {
  readonly bus = new EventBus<PeerEvents>();

  private identity: PeerIdentity | null = null;
  private sessions = new Map<LinkId, LinkSession>();
  /** peerId -> the link currently carrying that peer. */
  private routes = new Map<string, LinkId>();
  /** Everything we have seen advertising or connected, keyed by peerId when known. */
  private peers = new Map<string, Peer>();
  /** Advertisements we cannot yet attribute to a peerId, keyed by linkId. */
  private unidentified = new Map<LinkId, Peer>();
  /**
   * Transport address -> peerId, remembered across disconnects so a peer that starts
   * advertising again is recognised instead of reappearing as a second, unnamed entry.
   * Best-effort only: BLE addresses are randomised and do rotate, at which point the
   * peer is simply rediscovered and re-identified by the handshake.
   */
  private linkToPeer = new Map<LinkId, string>();
  /**
   * Transport address -> advertised peer-id prefix.
   *
   * Kept separately from `unidentified` because that map is cleared as soon as a peer is
   * recognised, and the redundant-dial guard still needs to know which peer a link would
   * reach. Losing that is what let a second link open to an already-connected peer.
   */
  private linkToPrefix = new Map<LinkId, string>();

  /** Per-peer measurements, keyed by peerId so they survive a reconnect. */
  private metrics = new Map<string, LinkMetrics>();
  /** Supplied by the app layer; reflects the relay setting and negotiated MTU. */
  private capabilitiesProvider: () => Capabilities = () =>
    localCapabilities({relay: true, largeMtu: false});
  /** How many messages are waiting in the outbox for a peer. */
  private queuedCountProvider: (peerId: string) => number = () => 0;
  /**
   * Read at handshake time rather than captured once, so editing your profile in Settings
   * reaches the next peer you meet without restarting anything.
   */
  private interestsProvider: () => string[] = () => [];

  /**
   * Links we tore down ourselves because a better link to the same peer already exists.
   *
   * They must be distinguished from a link that was lost. A lost link is worth chasing;
   * a superseded one is not, and chasing it produces an endless loop — re-dial, duplicate
   * detected, torn down again, re-dial — which on two real phones shows up as a peer
   * flickering between connected and reconnecting forever.
   */
  private superseded = new Set<LinkId>();
  /**
   * Identities this device refuses to handshake with.
   *
   * Enforced only at the handshake (see `negotiate`) — the one point an identity is
   * actually proven, rather than merely claimed in an advertisement. Anything upstream of
   * that (an advertised prefix, a device name) is exactly the kind of unverified claim
   * blocking exists to not be fooled by.
   */
  private blockedPeerIds = new Set<string>();
  /** Timeline and attempt counters, keyed by link so a pre-handshake failure still counts. */
  private linkHistory = new Map<LinkId, ConnectionEvent[]>();
  private linkStats = new Map<LinkId, LinkStats>();
  private reconnectTimers = new Map<LinkId, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<LinkId, number>();
  private autoReconnect = true;
  private router: MessageRouter | null = null;
  private unsubscribers: Array<() => void> = [];

  /**
   * Depends on the PeerLinkTransport interface, never on the BLE implementation, so
   * peers/ stays independent of ble/ and this whole layer is testable off-device.
   */
  constructor(
    private readonly transport: PeerLinkTransport,
    /**
     * Shared with the codec. Defaulted so existing tests that only exercise the
     * handshake keep constructing a PeerManager with one argument, but in the real app
     * this is the SAME instance the codec reads from — that shared identity is what
     * makes an established session actually encrypt anything.
     */
    private readonly sessionRegistry: SessionRegistry = new SessionRegistry(),
  ) {}

  setIdentity(identity: PeerIdentity): void {
    this.identity = identity;
  }

  /**
   * Seed the peer list from storage so previously-known peers are visible before they
   * advertise again — you can see who you have talked to, and queued messages for them
   * have somewhere to appear, without waiting for them to come back into range.
   */
  hydrateKnownPeers(
    known: Array<{
      peerId: string;
      displayName: string;
      lastSeen: number;
      interests?: string[];
      connectCount?: number;
      firstSeen?: number;
      lastConnected?: number;
      lastFailureReason?: string;
      lastFailureAt?: number;
    }>,
  ): void {
    for (const entry of known) {
      if (this.peers.has(entry.peerId)) {
        continue;
      }
      this.peers.set(entry.peerId, {
        peerId: entry.peerId,
        peerIdPrefix: entry.peerId.slice(0, 16),
        interests: entry.interests ?? [],
        attempts: 0,
        failures: 0,
        reconnectAttempt: 0,
        displayName: entry.displayName,
        // No link: it is remembered, not reachable. A Connect action only appears once
        // it advertises again and a real linkId is attached.
        linkId: null,
        role: null,
        state: 'disconnected',
        rssi: null,
        lastSeen: entry.lastSeen,
        // Both restored rather than defaulted: firstSeen is what makes "known since
        // March" true, and a connectCount that restarts at zero every launch is a
        // number that reads as history while only describing this session.
        firstSeen: entry.firstSeen ?? entry.lastSeen,
        connectCount: entry.connectCount ?? 0,
        protocolVersion: null,
        capabilities: null,
        agreedCapabilities: null,
        compatibilityNote: null,
        publicKey: null,
        // Remembered, not proven: authentication happens per connection.
        authenticated: false,
        queuedCount: 0,
        metrics: null,
        gatt: null,
        failure: null,
      });
    }
    if (known.length > 0) {
      logger.info(TAG, `restored ${known.length} known peer(s)`);
    }
    this.emitPeers();
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
  }

  /** Restore the block list from storage before anything gets a chance to handshake. */
  hydrateBlockedPeers(ids: string[]): void {
    this.blockedPeerIds = new Set(ids);
  }

  isBlocked(peerId: string): boolean {
    return this.blockedPeerIds.has(peerId);
  }

  blockedPeers(): string[] {
    return Array.from(this.blockedPeerIds);
  }

  /** A peerId this advertised prefix belongs to, if we have ever identified it. */
  peerIdForPrefix(prefix: string | null): string | null {
    if (!prefix) {
      return null;
    }
    return this.findPeerByPrefix(prefix)?.peerId ?? null;
  }

  /**
   * Refuse this identity from now on, and drop any live link to it immediately.
   *
   * A currently-connected peer does not wait for the next handshake to be cut off —
   * blocking someone mid-conversation would be a strange thing to have to explain.
   */
  blockPeer(peerId: string): void {
    if (this.blockedPeerIds.has(peerId)) {
      return;
    }
    this.blockedPeerIds.add(peerId);
    logger.info(TAG, `blocked ${shortId(peerId)}`);
    const linkId = this.routes.get(peerId);
    if (linkId) {
      this.cancelReconnect(linkId);
      void this.transport.disconnect(linkId);
    }
    this.bus.emit('blockedPeersChanged', this.blockedPeers());
    this.emitPeers();
  }

  unblockPeer(peerId: string): void {
    if (!this.blockedPeerIds.delete(peerId)) {
      return;
    }
    logger.info(TAG, `unblocked ${shortId(peerId)}`);
    this.bus.emit('blockedPeersChanged', this.blockedPeers());
    this.emitPeers();
  }

  setCapabilitiesProvider(provider: () => Capabilities): void {
    this.capabilitiesProvider = provider;
  }

  setInterestsProvider(provider: () => string[]): void {
    this.interestsProvider = provider;
  }

  setQueuedCountProvider(provider: (peerId: string) => number): void {
    this.queuedCountProvider = provider;
  }

  /** Live measurements for a peer, creating the record on first use. */
  metricsFor(peerId: string): LinkMetrics {
    let m = this.metrics.get(peerId);
    if (!m) {
      m = new LinkMetrics();
      this.metrics.set(peerId, m);
    }
    return m;
  }

  metricsSnapshot(peerId: string): LinkMetricsSnapshot | null {
    return this.metrics.get(peerId)?.snapshot() ?? null;
  }

  attachRouter(router: MessageRouter): void {
    this.router = router;
    router.on('HELLO', ({linkId, packet}) => {
      this.onHello(linkId, packet as Packet<HelloPayload>);
    });
    router.on('HELLO_ACK', ({linkId, packet}) => {
      this.onHelloAck(linkId, packet as Packet<HelloAckPayload>);
    });
    router.on('HELLO_CONFIRM', ({linkId, packet}) => {
      this.onHelloConfirm(linkId, packet as Packet<HelloConfirmPayload>);
    });
  }

  start(): void {
    this.unsubscribers.push(
      this.transport.onDiscovered(adv => {
        this.onAdvertisement(adv.linkId, adv);
      }),
      this.transport.onLinkUp(({linkId, role}) => {
        this.onLinkUp(linkId, role);
      }),
      this.transport.onLinkDown(({linkId, reason}) => {
        this.onLinkDown(linkId, reason);
      }),
      this.transport.onLinkPhase(({linkId, phase}) => {
        this.onPhase(linkId, phase);
      }),
    );
  }

  // ---- PeerRouteResolver ------------------------------------------------

  resolveLink(peerId: string): LinkId | null {
    return this.routes.get(peerId) ?? null;
  }

  establishedLinks(): LinkId[] {
    const out: LinkId[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === 'connected') {
        out.push(session.linkId);
      }
    }
    return out;
  }

  /** Attempt counters and any pending reconnect, read fresh so they never go stale. */
  private liveCounters(linkId: LinkId | null): {
    attempts: number;
    failures: number;
    reconnectAttempt: number;
  } {
    const stats = this.statsFor(linkId);
    return {
      attempts: stats.attempts,
      failures: stats.failures,
      reconnectAttempt:
        linkId && this.reconnectTimers.has(linkId)
          ? this.reconnectAttempts.get(linkId) ?? 0
          : 0,
    };
  }

  /** The connection timeline for a link, oldest first. */
  historyFor(linkId: LinkId | null): ConnectionEvent[] {
    return linkId ? this.linkHistory.get(linkId) ?? [] : [];
  }

  statsFor(linkId: LinkId | null): LinkStats {
    return (
      (linkId ? this.linkStats.get(linkId) : undefined) ?? {
        attempts: 0,
        successes: 0,
        failures: 0,
      }
    );
  }

  private note(
    linkId: LinkId,
    label: string,
    tone: ConnectionEvent['tone'] = 'progress',
    detail?: string,
  ): void {
    const list = this.linkHistory.get(linkId) ?? [];
    list.push({at: Date.now(), label, detail, tone});
    if (list.length > MAX_HISTORY_PER_LINK) {
      list.splice(0, list.length - MAX_HISTORY_PER_LINK);
    }
    this.linkHistory.set(linkId, list);
  }

  private bumpStats(linkId: LinkId, field: keyof LinkStats): void {
    const stats = this.linkStats.get(linkId) ?? {
      attempts: 0,
      successes: 0,
      failures: 0,
    };
    stats[field] += 1;
    this.linkStats.set(linkId, stats);
  }

  peerIdForLink(linkId: LinkId): string | null {
    return this.sessions.get(linkId)?.peerId ?? null;
  }

  /**
   * Mirror a transport-reported connection stage. Purely observational: the transport
   * owns the sequence, PeerManager reflects it so the UI can show where a link really is.
   */
  private onPhase(linkId: LinkId, phase: LinkState): void {
    const session = this.sessions.get(linkId);
    if (session) {
      session.state = phase;
    }
    this.note(linkId, PHASE_LABEL[phase] ?? phase);
    this.updateUnidentifiedState(linkId, phase);
    this.emitPeers();
  }

  // ---- discovery --------------------------------------------------------

  private onAdvertisement(
    linkId: LinkId,
    adv: {
      advertisedName: string | null;
      deviceName: string | null;
      peerIdPrefix: string | null;
      rssi: number | null;
      advertisedInterests?: string[];
    },
  ): void {
    // Catalogue interests decoded from the advertisement. Available before any connection
    // exists, which is the point: it is what makes one stranger worth tapping on.
    const advertised = adv.advertisedInterests ?? [];
    if (adv.peerIdPrefix) {
      this.linkToPrefix.set(linkId, adv.peerIdPrefix);
    }
    // If this link is already handshaken, just refresh the identified peer.
    const session = this.sessions.get(linkId);
    if (session?.peerId) {
      const peer = this.peers.get(session.peerId);
      if (peer) {
        peer.rssi = adv.rssi;
        peer.lastSeen = Date.now();
        this.emitPeers();
      }
      return;
    }

    // Same phone, seen on a different link.
    //
    // Both phones advertise and scan, so A can be mid-handshake on its own outbound
    // (central) link while already connected on the inbound (peripheral) one. The
    // advertised prefix is the first 16 hex chars of the peerId, which is enough to
    // recognise that and avoid listing one physical phone twice.
    if (adv.peerIdPrefix) {
      const identified = this.findPeerByPrefix(adv.peerIdPrefix);
      if (identified) {
        identified.rssi = adv.rssi;
        identified.lastSeen = Date.now();
        if (identified.interests.length === 0 && advertised.length > 0) {
          // The handshake list is richer (it can carry custom entries), so it wins where
          // we have one. This only fills a gap.
          identified.interests = advertised;
        }
        // Do NOT overwrite linkId here: the identified peer is reachable over its
        // established link, which may not be the one this advertisement arrived on.
        this.unidentified.delete(linkId);
        this.emitPeers();
        return;
      }
    }

    // A peer we have identified before, now advertising again after a disconnect.
    const knownPeerId = this.linkToPeer.get(linkId);
    if (knownPeerId) {
      const peer = this.peers.get(knownPeerId);
      if (peer) {
        peer.rssi = adv.rssi;
        peer.lastSeen = Date.now();
        // Keep the dial address current so Connect works straight from the list.
        peer.linkId = linkId;
        this.emitPeers();
        return;
      }
    }

    const existing = this.unidentified.get(linkId);
    if (existing) {
      existing.rssi = adv.rssi;
      existing.lastSeen = Date.now();
      if (existing.state === 'disconnected' || existing.state === 'failed') {
        // Advertising again, so a previous failure is no longer the current truth.
        existing.state = 'discovering';
        existing.failure = null;
      }
      if (adv.peerIdPrefix) {
        existing.peerIdPrefix = adv.peerIdPrefix;
      }
      if (adv.advertisedName) {
        existing.displayName = adv.advertisedName;
      }
      if (advertised.length > 0) {
        // Only overwritten when the advertisement actually carried some: an older peer
        // sends none, and blanking a list we already have would lose ground.
        existing.interests = advertised;
      }
    } else {
      const peer = blankPeer(linkId, 'discovering');
      peer.peerIdPrefix = adv.peerIdPrefix;
      peer.displayName = adv.advertisedName ?? adv.deviceName;
      peer.interests = advertised;
      peer.rssi = adv.rssi;
      peer.role = null;
      this.unidentified.set(linkId, peer);
    }
    this.emitPeers();
  }

  // ---- link lifecycle ---------------------------------------------------

  private onLinkUp(linkId: LinkId, role: LinkRole): void {
    if (!this.identity) {
      logger.error(TAG, 'link up before identity was set');
      return;
    }

    this.reconnectAttempts.delete(linkId);
    const timer = this.reconnectTimers.get(linkId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(linkId);
    }

    const session: LinkSession = {
      linkId,
      role,
      state: 'handshaking',
      peerId: null,
      displayName: null,
      protocolVersion: null,
      relay: false,
      handshakeTimer: null,
      // Fresh per link, so a signature captured on one connection cannot be replayed
      // on another.
      ourChallenge: randomNonce(),
      peerAuthenticated: false,
      pendingNegotiation: null,
      // Generated per link, discarded when the link drops: that is what gives forward
      // secrecy, so traffic captured today stays unreadable even if the identity key
      // leaks tomorrow.
      ephemeral: generateEphemeralKeyPair(),
      peerEphemeralKey: null,
      peerChallenge: null,
    };
    this.sessions.set(linkId, session);
    this.updateUnidentifiedState(linkId, 'handshaking');

    session.handshakeTimer = setTimeout(() => {
      if (session.state === 'handshaking') {
        this.recordFailure(
          linkId,
          makeFailure(
            'HandshakeTimeout',
            'handshaking',
            `Peer did not answer HELLO within ${HANDSHAKE_TIMEOUT_MS}ms`,
          ),
        );
        this.bus.emit('handshakeFailed', {linkId, reason: 'HandshakeTimeout'});
        void this.transport.disconnect(linkId);
      }
    }, HANDSHAKE_TIMEOUT_MS);

    // The side that dialled speaks first.
    if (role === 'central') {
      const hello = buildHello(
        {...this.identity, interests: this.interestsProvider()},
        this.capabilitiesProvider(),
        session.ourChallenge,
        ephemeralPublicKeyToHex(session.ephemeral.publicKey),
      );
      logger.info(TAG, `sending HELLO on ${linkId}`);
      this.router?.sendOnLink(linkId, hello).catch(err => {
        logger.error(TAG, `HELLO failed on ${linkId}`, err);
        this.bus.emit('handshakeFailed', {
          linkId,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    } else {
      logger.info(TAG, `awaiting HELLO on ${linkId} (peripheral role)`);
    }

    this.emitPeers();
  }

  private onLinkDown(linkId: LinkId, reason: string | null): void {
    const session = this.sessions.get(linkId);
    if (session?.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
    }
    this.sessions.delete(linkId);
    // Keys are derived per connection; a reconnect negotiates new ones. Holding the old
    // cipher could only ever let it be used on a session it was not derived for.
    this.sessionRegistry.clear(linkId);

    this.note(
      linkId,
      reason === 'local disconnect' ? 'Disconnected' : 'Connection lost',
      reason === 'local disconnect' ? 'progress' : 'error',
      reason ?? undefined,
    );

    // A link we dropped on purpose is not a link that failed. Nothing about it should
    // reach the UI or the reconnect logic.
    //
    // Both ends run the tie-break independently, so the close can arrive here as a plain
    // REMOTE disconnect before our own side has decided anything — our marker would be
    // empty and the peer would look lost. Holding a second link to the same identity is
    // the general answer: connected or still shaking hands, the peer is not going
    // anywhere, and this close is bookkeeping rather than a failure.
    const wasSuperseded =
      this.superseded.delete(linkId) ||
      (session?.peerId !== null &&
        session?.peerId !== undefined &&
        this.hasOtherLinkTo(session.peerId, linkId));

    if (session?.peerId) {
      // Only if it is still OUR route. During the tie-break the winning link may have
      // claimed it already, and clearing that would strand a peer that is connected.
      if (this.routes.get(session.peerId) === linkId) {
        this.routes.delete(session.peerId);
      }

      if (wasSuperseded) {
        logger.info(
          TAG,
          `${linkId} closed: superseded by a better link to ${shortId(session.peerId)}`,
        );
      } else {
        this.metrics.get(session.peerId)?.markDisconnected();
        const peer = this.peers.get(session.peerId);
        if (peer) {
          peer.state = 'disconnected';
          // linkId is deliberately retained: it is the address needed to dial this peer
          // again, and clearing it would leave the UI with a Connect button it cannot use.
          peer.gatt = null;
          peer.failure = reason
            ? makeFailure('LinkLost', 'connected', reason)
            : null;
        }
        logger.warn(
          TAG,
          `peer ${shortId(session.peerId)} disconnected: ${reason ?? 'unknown'}`,
        );
        this.bus.emit('peerDisconnected', {peerId: session.peerId, linkId});
      }
    }

    if (!wasSuperseded) {
      this.updateUnidentifiedState(linkId, 'disconnected');
    }
    this.emitPeers();

    // Only central links can be re-dialled; a peripheral link is the remote side's to
    // re-establish. A superseded link is never re-dialled at all.
    if (this.autoReconnect && isCentralLink(linkId) && !wasSuperseded) {
      this.scheduleReconnect(linkId);
    }
  }

  /**
   * Close a link because a better one to the same peer exists, without treating it as a
   * failure. Any reconnect already queued for it is cancelled too.
   */
  private supersedeLink(linkId: LinkId): void {
    this.superseded.add(linkId);
    this.cancelReconnect(linkId);
    void this.transport.disconnect(linkId);
  }

  private cancelReconnect(linkId: LinkId): void {
    const timer = this.reconnectTimers.get(linkId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(linkId);
    }
    this.reconnectAttempts.delete(linkId);
  }

  private scheduleReconnect(linkId: LinkId): void {
    if (this.reconnectTimers.has(linkId)) {
      return;
    }
    // A block issued after the link dropped must still stick — nothing here should
    // re-dial someone the user just told the app to stop talking to.
    const knownPeerId = this.linkToPeer.get(linkId);
    if (knownPeerId && this.blockedPeerIds.has(knownPeerId)) {
      return;
    }
    // Redialling a peer that is already reachable on another link only recreates the
    // duplicate the tie-break just resolved.
    if (this.hasBetterRoute(linkId)) {
      return;
    }
    const attempt = (this.reconnectAttempts.get(linkId) ?? 0) + 1;
    if (attempt > RECONNECT_MAX_ATTEMPTS) {
      // Stop rather than retrying forever. The peer is left alone until it advertises
      // again — which is real evidence that it is back, unlike another blind dial.
      logger.warn(
        TAG,
        `giving up on ${linkId} after ${RECONNECT_MAX_ATTEMPTS} reconnect attempts`,
      );
      this.note(linkId, 'Gave up reconnecting', 'error');
      this.reconnectAttempts.delete(linkId);
      this.updateUnidentifiedState(linkId, 'disconnected');
      this.emitPeers();
      return;
    }
    this.reconnectAttempts.set(linkId, attempt);

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    logger.info(TAG, `reconnect to ${linkId} in ${delay}ms (attempt ${attempt})`);
    this.updateUnidentifiedState(linkId, 'reconnecting');

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(linkId);
      if (!this.autoReconnect) {
        return;
      }
      // Re-checked on the way out as well as on the way in: the peer may have dialled us
      // during the backoff, in which case there is nothing left to reconnect to.
      if (this.hasBetterRoute(linkId)) {
        logger.info(TAG, `reconnect to ${linkId} cancelled; peer is already reachable`);
        this.reconnectAttempts.delete(linkId);
        return;
      }
      this.connect(linkId).catch(err => {
        logger.warn(TAG, `reconnect to ${linkId} failed: ${String(err)}`);
        this.scheduleReconnect(linkId);
      });
    }, delay);

    this.reconnectTimers.set(linkId, timer);
  }

  /**
   * Is there another live session for this identity?
   *
   * Counts a link that is still handshaking, not only a completed one — during the
   * simultaneous-dial race the surviving link is often mid-handshake at the exact moment
   * the losing one closes, and calling that "disconnected" is what produced the flicker.
   */
  private hasOtherLinkTo(peerId: string, excludingLinkId: LinkId): boolean {
    for (const [id, other] of this.sessions) {
      if (id === excludingLinkId) {
        continue;
      }
      if (other.peerId === peerId || other.pendingNegotiation?.peerId === peerId) {
        return true;
      }
    }
    return false;
  }

  /** Is the peer this link belonged to already reachable some other way? */
  private hasBetterRoute(linkId: LinkId): boolean {
    // linkToPeer survives a disconnect precisely so this question can be answered.
    const peerId = this.linkToPeer.get(linkId);
    if (!peerId) {
      return false;
    }
    const route = this.routes.get(peerId);
    return route !== undefined && route !== linkId;
  }

  // ---- handshake --------------------------------------------------------

  private onHello(linkId: LinkId, packet: Packet<HelloPayload>): void {
    const session = this.sessions.get(linkId);
    if (!session || !this.identity) {
      return;
    }
    const payload = packet.payload;
    logger.info(
      TAG,
      `HELLO from ${shortId(payload.peerId)} "${payload.displayName}" ` +
        `v${payload.minProtocolVersion ?? payload.protocolVersion}-${payload.protocolVersion}`,
    );

    // No ephemeral key means no encrypted session is possible. Refused outright rather
    // than continued in plaintext: a downgrade an attacker can trigger by stripping one
    // field is not a fallback, it is the vulnerability.
    const peerEphemeral = ephemeralPublicKeyFromHex(payload.ephemeralKey);
    if (!peerEphemeral) {
      logger.warn(
        TAG,
        `HELLO from ${shortId(payload.peerId)} carried no usable ephemeral key; refusing`,
      );
      this.recordFailure(
        linkId,
        makeFailure(
          'AuthenticationFailed',
          'handshaking',
          'Peer did not offer an encryption key',
        ),
      );
      this.bus.emit('handshakeFailed', {linkId, reason: 'AuthenticationFailed'});
      void this.transport.disconnect(linkId);
      return;
    }

    const negotiated = this.negotiate(linkId, payload);
    if (!negotiated) {
      return;
    }

    session.peerEphemeralKey = payload.ephemeralKey;
    session.peerChallenge = payload.challenge;

    // The initiator has NOT proven anything yet — it has only made a claim. Answer its
    // challenge, issue our own, and wait for HELLO_CONFIRM before trusting the identity.
    session.pendingNegotiation = negotiated;

    const ourEphemeralHex = ephemeralPublicKeyToHex(session.ephemeral.publicKey);
    const signature = sign(
      challengeBytes(
        'hello-ack',
        payload.challenge,
        this.identity.peerId,
        payload.peerId,
        // We are the responder, so the initiator's key is theirs and ours is second.
        payload.ephemeralKey,
        ourEphemeralHex,
      ),
      hexToPrivateKey(this.identity.privateKey),
    );

    const ack = buildHelloAck(
      {...this.identity, interests: this.interestsProvider()},
      payload.peerId,
      this.capabilitiesProvider(),
      negotiated.protocolVersion,
      session.ourChallenge,
      signature,
      ourEphemeralHex,
    );
    this.router?.sendOnLink(linkId, ack).catch(err => {
      logger.error(TAG, `HELLO_ACK failed on ${linkId}`, err);
    });
  }

  /**
   * The initiator's answer to our challenge. Only now is its identity proven.
   */
  private onHelloConfirm(
    linkId: LinkId,
    packet: Packet<HelloConfirmPayload>,
  ): void {
    const session = this.sessions.get(linkId);
    if (!session || !this.identity) {
      return;
    }
    const pending = session.pendingNegotiation;
    if (!pending) {
      logger.warn(TAG, `unexpected HELLO_CONFIRM on ${linkId}`);
      return;
    }

    const check = verifyPeerClaim({
      claimedPeerId: pending.peerId,
      publicKeyHex: pending.publicKey,
      signatureHex: packet.payload?.signature,
      label: 'hello',
      challenge: session.ourChallenge,
      audiencePeerId: this.identity.peerId,
      // Their key first: on this side the peer is the initiator.
      initiatorEphemeralKey: session.peerEphemeralKey ?? '',
      responderEphemeralKey: ephemeralPublicKeyToHex(session.ephemeral.publicKey),
    });

    if (!check.ok) {
      logger.error(
        TAG,
        `rejecting ${shortId(pending.peerId)}: ${check.reason}`,
      );
      this.bus.emit('securityRefusal', {
        kind: 'authFailed',
        peerId: pending.peerId,
        displayName: pending.displayName ?? null,
        detail: `A peer could not prove its identity: ${check.reason ?? 'unknown'}.`,
      });
      this.recordFailure(
        linkId,
        makeFailure(
          'AuthenticationFailed',
          'handshaking',
          check.reason ?? 'identity could not be proven',
        ),
      );
      void this.transport.disconnect(linkId);
      return;
    }

    // Only now — after the signature covering both ephemeral keys verified — is it safe
    // to turn those keys into a session. Deriving earlier would mean encrypting to
    // whoever supplied the key, which is exactly the MITM this ordering prevents.
    if (!this.establishSession(session, {isInitiator: false, peer: pending.peerId})) {
      return;
    }

    session.peerAuthenticated = true;
    session.pendingNegotiation = null;
    logger.info(TAG, `${shortId(pending.peerId)} authenticated`);
    this.completeHandshake(session, pending);
  }

  private onHelloAck(linkId: LinkId, packet: Packet<HelloAckPayload>): void {
    const session = this.sessions.get(linkId);
    if (!session) {
      return;
    }
    const payload = packet.payload;
    logger.info(
      TAG,
      `HELLO_ACK from ${shortId(payload.peerId)} "${payload.displayName}"`,
    );

    const peerEphemeral = ephemeralPublicKeyFromHex(payload.ephemeralKey);
    if (!peerEphemeral) {
      logger.warn(
        TAG,
        `HELLO_ACK from ${shortId(payload.peerId)} carried no usable ephemeral key; refusing`,
      );
      this.recordFailure(
        linkId,
        makeFailure(
          'AuthenticationFailed',
          'handshaking',
          'Peer did not offer an encryption key',
        ),
      );
      this.bus.emit('handshakeFailed', {linkId, reason: 'AuthenticationFailed'});
      void this.transport.disconnect(linkId);
      return;
    }

    const negotiated = this.negotiate(linkId, payload);
    if (!negotiated) {
      return;
    }
    if (!this.identity) {
      return;
    }

    session.peerEphemeralKey = payload.ephemeralKey;
    session.peerChallenge = payload.challenge;
    const ourEphemeralHex = ephemeralPublicKeyToHex(session.ephemeral.publicKey);

    // The responder signed OUR challenge, so this proves it holds the private key for
    // the public key its peerId commits to — and, because the ephemeral keys are inside
    // that signature, that the key we are about to encrypt to is really theirs.
    const check = verifyPeerClaim({
      claimedPeerId: payload.peerId,
      publicKeyHex: payload.publicKey,
      signatureHex: payload.signature,
      label: 'hello-ack',
      challenge: session.ourChallenge,
      audiencePeerId: this.identity.peerId,
      // Ours first: on this side we are the initiator.
      initiatorEphemeralKey: ourEphemeralHex,
      responderEphemeralKey: payload.ephemeralKey,
    });

    if (!check.ok) {
      logger.error(TAG, `rejecting ${shortId(payload.peerId)}: ${check.reason}`);
      this.bus.emit('securityRefusal', {
        kind: 'authFailed',
        peerId: payload.peerId,
        displayName: payload.displayName ?? null,
        detail: `A peer could not prove its identity: ${check.reason ?? 'unknown'}.`,
      });
      this.recordFailure(
        linkId,
        makeFailure(
          'AuthenticationFailed',
          'handshaking',
          check.reason ?? 'identity could not be proven',
        ),
      );
      void this.transport.disconnect(linkId);
      return;
    }

    if (!this.establishSession(session, {isInitiator: true, peer: payload.peerId})) {
      return;
    }

    session.peerAuthenticated = true;

    // Close the loop: answer the responder's challenge so authentication is mutual.
    const confirm = buildHelloConfirm(
      this.identity,
      payload.peerId,
      sign(
        challengeBytes(
          'hello',
          payload.challenge,
          this.identity.peerId,
          payload.peerId,
          ourEphemeralHex,
          payload.ephemeralKey,
        ),
        hexToPrivateKey(this.identity.privateKey),
      ),
    );
    this.router?.sendOnLink(linkId, confirm).catch(err => {
      logger.error(TAG, `HELLO_CONFIRM failed on ${linkId}`, err);
    });

    this.completeHandshake(session, negotiated);
  }

  /**
   * Turn the verified ephemeral keys into a live cipher for this link.
   *
   * Called only after the identity signature covering both ephemeral keys has verified —
   * see the call sites. Returns false (and tears the link down) if key agreement fails,
   * because a link that cannot be encrypted must not be allowed to carry messages: the
   * alternative is silently falling back to plaintext, which is the failure mode this
   * whole layer exists to remove.
   */
  private establishSession(
    session: LinkSession,
    context: {isInitiator: boolean; peer: string},
  ): boolean {
    const peerEphemeral = ephemeralPublicKeyFromHex(session.peerEphemeralKey);
    const peerChallenge = session.peerChallenge;
    if (!peerEphemeral || !peerChallenge || !this.identity) {
      this.failSession(session, 'encryption key agreement had no usable inputs');
      return false;
    }

    const ourChallenge = session.ourChallenge;
    try {
      const keys = deriveSessionKeys({
        privateKey: session.ephemeral.privateKey,
        peerPublicKey: peerEphemeral,
        isInitiator: context.isInitiator,
        // Both sides must order these identically or they derive different keys, so the
        // order follows the protocol roles rather than "mine then theirs".
        initiatorChallenge: context.isInitiator ? ourChallenge : peerChallenge,
        responderChallenge: context.isInitiator ? peerChallenge : ourChallenge,
        initiatorPeerId: context.isInitiator ? this.identity.peerId : context.peer,
        responderPeerId: context.isInitiator ? context.peer : this.identity.peerId,
      });
      this.sessionRegistry.set(session.linkId, new SessionCipher(keys));
      logger.info(
        TAG,
        `encrypted session established with ${shortId(context.peer)} on ${session.linkId}`,
      );
      return true;
    } catch (err) {
      this.failSession(
        session,
        `key agreement failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private failSession(session: LinkSession, reason: string): void {
    logger.error(TAG, `${session.linkId}: ${reason}`);
    this.recordFailure(
      session.linkId,
      makeFailure('AuthenticationFailed', 'handshaking', reason),
    );
    this.bus.emit('handshakeFailed', {
      linkId: session.linkId,
      reason: 'AuthenticationFailed',
    });
    void this.transport.disconnect(session.linkId);
  }

  /**
   * Decide whether this peer is compatible, and on what terms.
   *
   * An incompatible peer is refused here, at the handshake, with a typed reason. The
   * alternative — letting it connect and then dropping every packet at the router — is
   * exactly the "connects and then mysteriously fails" behaviour worth avoiding.
   */
  private negotiate(
    linkId: LinkId,
    payload: {
      peerId: string;
      displayName: string;
      protocolVersion: number;
      minProtocolVersion?: number;
      capabilities?: Record<string, boolean>;
      publicKey?: string;
      challenge?: string;
      interests?: string[];
    },
  ): Negotiated | null {
    // Checked before anything else: refusing a blocked identity is cheaper than
    // negotiating a protocol version with someone who is about to be disconnected
    // anyway, and it means no capability or interest data from them is ever parsed.
    if (this.blockedPeerIds.has(payload.peerId)) {
      logger.warn(TAG, `refusing ${shortId(payload.peerId)}: blocked`);
      this.bus.emit('securityRefusal', {
        kind: 'blocked',
        peerId: payload.peerId,
        displayName: payload.displayName ?? null,
        detail: 'A blocked identity tried to connect and was refused.',
      });
      this.recordFailure(
        linkId,
        makeFailure('Blocked', 'handshaking', 'This identity is on your block list'),
      );
      void this.transport.disconnect(linkId);
      return null;
    }

    const remoteRange = {
      version: payload.protocolVersion,
      // A build predating minProtocolVersion only spoke its own version.
      min: payload.minProtocolVersion ?? payload.protocolVersion,
    };
    const outcome = negotiateVersion(LOCAL_VERSION, remoteRange);

    if (outcome.verdict === 'unsupported' || outcome.agreed === null) {
      logger.error(
        TAG,
        `refusing ${shortId(payload.peerId)}: ${outcome.explanation}`,
      );
      this.recordFailure(
        linkId,
        makeFailure('ProtocolMismatch', 'handshaking', outcome.explanation),
      );
      void this.transport.disconnect(linkId);
      return null;
    }

    if (outcome.verdict === 'degraded') {
      logger.warn(TAG, `${shortId(payload.peerId)}: ${outcome.explanation}`);
    }

    // A key that does not produce the claimed peerId is rejected before anything else
    // is believed about this peer.
    const publicKeyHex =
      typeof payload.publicKey === 'string' ? payload.publicKey : '';
    if (!publicKeyHex) {
      logger.error(TAG, `no public key from ${shortId(payload.peerId)}`);
      this.recordFailure(
        linkId,
        makeFailure(
          'AuthenticationFailed',
          'handshaking',
          'peer sent no public key',
        ),
      );
      void this.transport.disconnect(linkId);
      return null;
    }

    const remoteCaps = parseCapabilities(payload.capabilities);
    const localCaps = this.capabilitiesProvider();
    const agreed = agreeCapabilities(localCaps, remoteCaps);

    logger.info(
      TAG,
      `${shortId(payload.peerId)} capabilities: relay=${agreed.relay} ` +
        `encryption=${agreed.encryption} largeMtu=${agreed.largeMtu}`,
    );

    return {
      peerId: payload.peerId,
      displayName: payload.displayName,
      protocolVersion: outcome.agreed,
      capabilities: remoteCaps,
      agreed,
      compatibilityNote:
        outcome.verdict === 'exact' ? null : outcome.explanation,
      publicKey: publicKeyHex,
      // Bounded and de-duplicated here rather than at the UI, so nothing downstream ever
      // handles an unbounded list a stranger sent us.
      interests: sanitiseInterests(payload.interests),
    };
  }

  private completeHandshake(session: LinkSession, info: Negotiated): void {
    if (session.handshakeTimer) {
      clearTimeout(session.handshakeTimer);
      session.handshakeTimer = null;
    }

    if (info.peerId === this.identity?.peerId) {
      // Our own advertisement, reflected back. Re-dialling it would loop just as surely
      // as a superseded link would.
      logger.error(TAG, 'handshake with ourselves, dropping link');
      this.supersedeLink(session.linkId);
      return;
    }

    // Both phones advertise AND scan, so they can dial each other simultaneously and end
    // up with two links to the same peer. Resolve it deterministically: the peer with the
    // lower peerId keeps the central role. Both sides compute the same answer, so exactly
    // one link survives without any negotiation round-trip.
    const existingLink = this.routes.get(info.peerId);
    if (existingLink && existingLink !== session.linkId) {
      const selfId = this.identity?.peerId ?? '';
      const weShouldBeCentral = selfId < info.peerId;
      const keepThis =
        (session.role === 'central') === weShouldBeCentral;

      if (keepThis) {
        logger.info(
          TAG,
          `duplicate link to ${shortId(info.peerId)}: keeping ${session.linkId}, dropping ${existingLink}`,
        );
        this.supersedeLink(existingLink);
      } else {
        logger.info(
          TAG,
          `duplicate link to ${shortId(info.peerId)}: keeping ${existingLink}, dropping ${session.linkId}`,
        );
        this.supersedeLink(session.linkId);
        return;
      }
    }

    session.peerId = info.peerId;
    session.displayName = info.displayName;
    session.protocolVersion = info.protocolVersion;
    session.relay = info.agreed.relay;
    session.state = 'connected';

    const gatt = this.transport.getGatt(session.linkId);
    const metrics = this.metricsFor(info.peerId);
    metrics.markConnected();
    metrics.setMtu(gatt?.mtu ?? DEFAULT_ATT_MTU);

    this.bumpStats(session.linkId, 'successes');
    this.note(session.linkId, 'Connected', 'ok', info.displayName);
    // A fresh success clears the backoff, so the next drop starts from 1s again rather
    // than inheriting a long delay from a bad patch earlier in the session.
    this.reconnectAttempts.delete(session.linkId);

    this.routes.set(info.peerId, session.linkId);
    this.linkToPeer.set(session.linkId, info.peerId);

    const advertised = this.unidentified.get(session.linkId);
    this.unidentified.delete(session.linkId);

    const existing = this.peers.get(info.peerId);
    const peer: Peer = {
      peerId: info.peerId,
      peerIdPrefix: info.peerId.slice(0, 16),
      displayName: info.displayName,
      interests: info.interests,
      linkId: session.linkId,
      role: session.role,
      state: 'connected',
      rssi: advertised?.rssi ?? existing?.rssi ?? null,
      lastSeen: Date.now(),
      protocolVersion: info.protocolVersion,
      capabilities: info.capabilities,
      agreedCapabilities: info.agreed,
      compatibilityNote: info.compatibilityNote,
      publicKey: info.publicKey,
      authenticated: session.peerAuthenticated,
      queuedCount: this.queuedCountProvider(info.peerId),
      metrics: metrics.snapshot(),
      gatt,
      failure: null,
      firstSeen: existing?.firstSeen ?? advertised?.firstSeen ?? Date.now(),
      connectCount: (existing?.connectCount ?? 0) + 1,
      attempts: 0,
      failures: 0,
      reconnectAttempt: 0,
    };
    this.peers.set(info.peerId, peer);

    logger.info(
      TAG,
      `handshake complete with ${info.displayName} (${shortId(info.peerId)}) via ${session.role}`,
    );
    this.bus.emit('peerIdentified', {
      peerId: info.peerId,
      displayName: info.displayName,
    });
    this.bus.emit('peerConnected', peer);
    this.emitPeers();
  }

  // ---- commands ---------------------------------------------------------

  /**
   * Abandon an attempt the user no longer wants.
   *
   * Tapping Connect by accident should not commit the phone to a full timeout plus every
   * retry — and a cancelled attempt must not be recorded as evidence that the peer is
   * unreachable, because it is evidence of nothing at all.
   */
  async cancelConnect(linkId: LinkId): Promise<void> {
    this.cancelReconnect(linkId);
    this.note(linkId, 'Cancelled by user');
    try {
      await this.transport.cancelConnect(linkId);
    } catch (err) {
      logger.warn(TAG, `cancel of ${linkId} failed: ${String(err)}`);
    }
    const peer = this.unidentified.get(linkId);
    if (peer) {
      peer.state = 'disconnected';
      peer.failure = null;
    }
    this.emitPeers();
  }

  async connect(linkId: LinkId): Promise<void> {
    /**
     * A peripheral link cannot be dialled, and saying so is not a link failure.
     *
     * Only the remote side can open one — we are the peripheral on it. The transport
     * rejects the attempt correctly, but routing that rejection through `recordFailure`
     * marked the peer `failed`, and on the receiving phone that link is the live one:
     * messages were arriving over it while the composer sat disabled behind
     * "Connection failed". Refusing here, before any state is touched, keeps a category
     * error from being recorded as evidence about a healthy link.
     */
    if (!isCentralLink(linkId)) {
      logger.info(
        TAG,
        `ignoring dial of peripheral link ${linkId}; the remote peer owns that direction`,
      );
      return;
    }

    // A peer we have identified before and blocked since is refused before dialling at
    // all — no reason to spend a whole handshake round-trip finding out again what we
    // already know. A peer we have never identified still gets a chance to prove itself
    // and be refused at that point instead; see `negotiate`.
    const knownPeerId = this.linkToPeer.get(linkId);
    if (knownPeerId && this.blockedPeerIds.has(knownPeerId)) {
      throw new Error('This person is blocked');
    }

    // Opening a second link to a peer we can already reach is the cause of the
    // simultaneous-dial race: two links come up, the tie-break tears one down, and every
    // packet in flight on the losing link is counted as a failed send. Refusing the
    // redundant dial removes the race rather than cleaning up after it.
    const prefix =
      this.unidentified.get(linkId)?.peerIdPrefix ?? this.linkToPrefix.get(linkId);
    if (prefix) {
      const existing = this.findPeerByPrefix(prefix);
      if (existing?.peerId && existing.state === 'connected') {
        logger.info(
          TAG,
          `already connected to ${shortId(existing.peerId)} on ${existing.linkId}; ` +
            `not dialling ${linkId}`,
        );
        this.unidentified.delete(linkId);
        this.emitPeers();
        return;
      }
    }

    this.bumpStats(linkId, 'attempts');
    this.updateUnidentifiedState(linkId, 'connecting');
    this.emitPeers();
    try {
      await this.transport.connect(linkId);
      // linkUp fires from the transport; the handshake starts there.
    } catch (err) {
      // The transport rejects with a typed failure carrying the exact stage that broke.
      this.recordFailure(linkId, toLinkFailure(err, 'connecting', 'ConnectionRefused'));
      throw err;
    }
  }

  async disconnect(peerIdOrLinkId: string): Promise<void> {
    const linkId = this.routes.get(peerIdOrLinkId) ?? peerIdOrLinkId;
    // A manual disconnect must not immediately be undone by auto-reconnect.
    this.reconnectAttempts.delete(linkId);
    const timer = this.reconnectTimers.get(linkId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(linkId);
    }
    await this.transport.disconnect(linkId);
  }

  // ---- views ------------------------------------------------------------

  /** An identified peer whose peerId starts with this advertised prefix, if any. */
  private findPeerByPrefix(prefix: string): Peer | null {
    for (const peer of this.peers.values()) {
      if (peer.peerId && peer.peerId.startsWith(prefix)) {
        return peer;
      }
    }
    return null;
  }

  getPeers(): Peer[] {
    const now = Date.now();
    const list: Peer[] = [];

    for (const peer of this.peers.values()) {
      // Metrics, queue depth and attempt counters are live values, so they are refreshed
      // on read rather than snapshotted at handshake time and left to go stale.
      list.push({
        ...peer,
        ...this.liveCounters(peer.linkId),
        metrics: peer.peerId ? this.metricsSnapshot(peer.peerId) : null,
        queuedCount: peer.peerId ? this.queuedCountProvider(peer.peerId) : 0,
      });
    }
    for (const peer of this.unidentified.values()) {
      if (now - peer.lastSeen > PEER_STALE_MS && peer.state === 'disconnected') {
        continue;
      }
      // Suppress a pre-handshake record that is demonstrably the same phone as one we
      // have already identified — otherwise a simultaneous dial shows the peer twice,
      // once "[connected]" and once "[handshaking]".
      if (peer.peerIdPrefix && this.findPeerByPrefix(peer.peerIdPrefix)) {
        continue;
      }
      list.push({...peer, ...this.liveCounters(peer.linkId)});
    }

    return list.sort((a, b) => {
      const aConnected = a.state === 'connected' ? 0 : 1;
      const bConnected = b.state === 'connected' ? 0 : 1;
      if (aConnected !== bConnected) {
        return aConnected - bConnected;
      }
      return (b.rssi ?? -200) - (a.rssi ?? -200);
    });
  }

  getConnectedPeers(): Peer[] {
    return this.getPeers().filter(p => p.state === 'connected');
  }

  getPeer(peerId: string): Peer | null {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return null;
    }
    // Enriched exactly as getPeers() does. The two disagreeing would be worse than
    // either being wrong: a caller would see different numbers depending on which it
    // happened to use.
    return {
      ...peer,
      ...this.liveCounters(peer.linkId),
      metrics: peer.peerId ? this.metricsSnapshot(peer.peerId) : null,
      queuedCount: peer.peerId ? this.queuedCountProvider(peer.peerId) : 0,
    };
  }

  /** Attach a typed failure to whichever peer record represents this link. */
  private recordFailure(linkId: LinkId, failure: LinkFailure): void {
    this.bumpStats(linkId, 'failures');
    this.note(
      linkId,
      failure.reason === 'Cancelled' ? 'Cancelled' : 'Failed',
      failure.reason === 'Cancelled' ? 'progress' : 'error',
      `${failure.reason} during ${failure.phase}`,
    );
    const peerId = this.sessions.get(linkId)?.peerId ?? this.linkToPeer.get(linkId);
    const peer = peerId ? this.peers.get(peerId) : this.unidentified.get(linkId);
    if (peer) {
      peer.state = 'failed';
      peer.failure = failure;
    } else {
      const placeholder = blankPeer(linkId, 'failed');
      placeholder.failure = failure;
      this.unidentified.set(linkId, placeholder);
    }
    logger.error(
      TAG,
      `${linkId} failed in ${failure.phase}: ${failure.reason} - ${failure.message}`,
    );
    this.emitPeers();
  }

  private updateUnidentifiedState(linkId: LinkId, state: LinkState): void {
    const peer = this.unidentified.get(linkId);
    if (peer) {
      peer.state = state;
      if (state === 'connected' || state === 'discovering') {
        peer.failure = null;
      }
      return;
    }
    // A link we never saw advertise (an inbound peripheral connection) still deserves a
    // placeholder so the UI can show it.
    if (state !== 'disconnected') {
      this.unidentified.set(linkId, blankPeer(linkId, state));
    }
  }

  private emitPeers(): void {
    this.bus.emit('peersChanged', this.getPeers());
  }

  dispose(): void {
    for (const un of this.unsubscribers) {
      un();
    }
    this.unsubscribers = [];
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    for (const session of this.sessions.values()) {
      if (session.handshakeTimer) {
        clearTimeout(session.handshakeTimer);
      }
    }
    this.sessions.clear();
    this.routes.clear();
  }
}

/**
 * RSSI is a received-power figure in dBm. It correlates loosely with distance but is
 * heavily affected by orientation, bodies, walls and radio design, so it is only ever
 * presented as a coarse signal bucket — never as a distance in metres.
 */
export function signalStrength(rssi: number | null): SignalStrength {
  if (rssi === null) {
    return 'unknown';
  }
  if (rssi >= -60) {
    return 'strong';
  }
  if (rssi >= -80) {
    return 'medium';
  }
  return 'weak';
}
