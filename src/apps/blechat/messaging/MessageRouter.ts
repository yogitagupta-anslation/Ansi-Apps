import {BROADCAST_ID} from '../config/constants';
import type {LinkId} from '../types/BLE';
import type {Packet, PacketType} from '../types/Packet';
import {EventBus} from '../utils/EventBus';
import {logger} from '../utils/logger';
import {shortId} from '../utils/id';
import type {ITransport} from '../types/Transport';
import {SeenMessageStore} from './Deduplication';
import {ReplayWindow, SequenceCounter} from './ReplayWindow';
import {
  isProtocolCompatible,
  type PacketCodec,
  PacketDecodeError,
} from './PacketCodec';

const TAG = 'Router';

/** What the router needs to know about peers, without depending on PeerManager. */
export interface PeerRouteResolver {
  /** The link currently able to reach this peer, or null. */
  resolveLink(peerId: string): LinkId | null;
  /** Every link that has completed its handshake. */
  establishedLinks(): LinkId[];
  peerIdForLink(linkId: LinkId): string | null;
}

export interface RouterCounters {
  tx: number;
  rx: number;
  ack: number;
  failed: number;
  duplicates: number;
  forwarded: number;
  dropped: number;
  /** Packets rejected by the sliding sequence window. */
  replayed: number;
  /** Packets whose senderId did not match the authenticated peer on that link. */
  spoofed: number;
}

export interface InboundPacket {
  linkId: LinkId;
  packet: Packet;
}

type RouterEvents = {
  packet: InboundPacket;
  counters: RouterCounters;
  lastPacket: {direction: 'tx' | 'rx'; packet: Packet; linkId: LinkId};
};

/**
 * Packet-level concerns: encode/decode, identity of a packet, deduplication, TTL, and
 * the decision about whether a packet is for us or for somebody else.
 *
 * It never touches BLE APIs — only the ITransport abstraction — so swapping BLE for a
 * Wi-Fi Direct transport later changes nothing here.
 */
export class MessageRouter {
  readonly bus = new EventBus<RouterEvents>();
  readonly seen: SeenMessageStore;
  /** Inbound replay protection, keyed by the AUTHENTICATED peer on the link. */
  readonly replay: ReplayWindow;
  /** Our outbound sequence numbers. Persisted, so it never restarts below its peers. */
  readonly sequence: SequenceCounter;

  /**
   * Called with every sequence number handed out, so the app layer can persist a
   * high-water mark. Our counter must never restart below where it left off, or our
   * peers' replay windows would reject our next messages as stale.
   */
  onSequenceAdvanced: ((seq: number) => void) | null = null;

  private handlers = new Map<PacketType, Array<(p: InboundPacket) => void>>();
  private counters: RouterCounters = {
    tx: 0,
    rx: 0,
    ack: 0,
    failed: 0,
    duplicates: 0,
    forwarded: 0,
    dropped: 0,
    replayed: 0,
    spoofed: 0,
  };

  constructor(
    private readonly transport: ITransport,
    private readonly codec: PacketCodec,
    private readonly resolver: PeerRouteResolver,
    private readonly getSelfId: () => string,
    seen?: SeenMessageStore,
    replay?: ReplayWindow,
    sequence?: SequenceCounter,
  ) {
    this.seen = seen ?? new SeenMessageStore();
    this.replay = replay ?? new ReplayWindow();
    this.sequence = sequence ?? new SequenceCounter();
  }

  getCounters(): RouterCounters {
    return {...this.counters};
  }

  on(type: PacketType, handler: (p: InboundPacket) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return () => {
      const current = this.handlers.get(type) ?? [];
      this.handlers.set(
        type,
        current.filter(h => h !== handler),
      );
    };
  }

  // ---- inbound ----------------------------------------------------------

  handleInbound(linkId: LinkId, bytes: Uint8Array): void {
    let packet: Packet;
    try {
      packet = this.codec.decode(bytes, linkId);
    } catch (err) {
      this.counters.dropped++;
      this.emitCounters();
      if (err instanceof PacketDecodeError) {
        logger.warn(TAG, `undecodable packet on ${linkId}: ${err.message}`);
      } else {
        logger.error(TAG, `decode failed on ${linkId}`, err);
      }
      return;
    }

    if (!isProtocolCompatible(packet.version)) {
      this.counters.dropped++;
      this.emitCounters();
      logger.warn(
        TAG,
        `protocol v${packet.version} from ${shortId(packet.senderId)} is incompatible, dropped`,
      );
      return;
    }

    this.counters.rx++;
    if (packet.type === 'ACK') {
      this.counters.ack++;
    }
    this.emitCounters();
    this.bus.emit('lastPacket', {direction: 'rx', packet, linkId});

    logger.info(
      TAG,
      `RX ${packet.type} ${shortId(packet.id)} from ${shortId(packet.senderId)}` +
        (packet.originId !== packet.senderId
          ? ` (origin ${shortId(packet.originId)})`
          : '') +
        ` ttl=${packet.ttl} hop=${packet.hopCount}`,
    );

    // Handshake packets are link-scoped: they never travel further than one hop and are
    // exempt from deduplication, since a reconnect legitimately repeats them. They are
    // also exempt from the sequence window, because they are what ESTABLISHES the
    // identity the window is keyed on — and they carry their own replay protection in
    // the form of a fresh challenge that a captured signature cannot answer.
    const isHandshake =
      packet.type === 'HELLO' ||
      packet.type === 'HELLO_ACK' ||
      packet.type === 'HELLO_CONFIRM';

    if (!isHandshake) {
      if (!this.checkSenderAndSequence(linkId, packet)) {
        return;
      }
      if (!this.seen.markIfNew(packet.id)) {
        this.counters.duplicates++;
        this.emitCounters();
        logger.debug(TAG, `duplicate ${shortId(packet.id)} ignored`);
        return;
      }
    }

    const selfId = this.getSelfId();
    const forUs =
      isHandshake ||
      packet.destinationId === selfId ||
      packet.destinationId === BROADCAST_ID ||
      packet.destinationId === '';

    if (forUs) {
      this.dispatch({linkId, packet});
    }

    // A broadcast is both consumed locally AND eligible for relaying.
    if (!forUs || packet.destinationId === BROADCAST_ID) {
      this.considerForwarding(linkId, packet);
    }
  }

  /**
   * Bind the packet to the peer that actually proved its identity on this link, then run
   * it past that peer's replay window.
   *
   * The binding is what makes the window trustworthy. `senderId` is just a field in a
   * JSON blob; without this check a connected peer could stamp somebody else's peerId on
   * a packet and have it filed into that peer's conversation — and, worse, drive that
   * peer's window forward so the real peer's next messages were rejected as old. Keying
   * on the authenticated identity rather than the claimed one closes both.
   */
  private checkSenderAndSequence(linkId: LinkId, packet: Packet): boolean {
    const authenticated = this.resolver.peerIdForLink(linkId);
    if (!authenticated) {
      this.counters.spoofed++;
      this.counters.dropped++;
      this.emitCounters();
      logger.warn(
        TAG,
        `${packet.type} ${shortId(packet.id)} on ${linkId} before the handshake ` +
          'completed, dropped',
      );
      return false;
    }

    if (packet.senderId !== authenticated) {
      this.counters.spoofed++;
      this.counters.dropped++;
      this.emitCounters();
      logger.error(
        TAG,
        `${linkId} is ${shortId(authenticated)} but sent a packet claiming to be ` +
          `${shortId(packet.senderId)}, dropped`,
      );
      return false;
    }

    const verdict = this.replay.accept(authenticated, packet.seq);
    if (!verdict.ok) {
      this.counters.replayed++;
      this.counters.dropped++;
      this.emitCounters();
      logger.warn(
        TAG,
        `${packet.type} ${shortId(packet.id)} seq=${packet.seq} from ` +
          `${shortId(authenticated)} rejected: ${verdict.reason}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Phase 2 hook. The full decision is already expressed here; only the actual relay
   * transmission is withheld, because Phase 1 is deliberately limited to direct links.
   *
   * When it is enabled, everything it needs is already in place: unique packet ids, the
   * seen-store above (which has already run, so a packet reaching this point has never
   * been forwarded before), and a TTL to decrement.
   */
  private considerForwarding(fromLink: LinkId, packet: Packet): void {
    if (packet.ttl <= 1) {
      this.counters.dropped++;
      this.emitCounters();
      logger.debug(TAG, `${shortId(packet.id)} expired (ttl ${packet.ttl})`);
      return;
    }

    const candidates = this.resolver
      .establishedLinks()
      .filter(l => l !== fromLink);

    if (candidates.length === 0) {
      return;
    }

    // Phase 1: relaying is designed but not enabled. Logged rather than hidden, so the
    // decision is observable during testing even though nothing is transmitted.
    logger.debug(
      TAG,
      `${shortId(packet.id)} would relay to ${candidates.length} link(s) as ` +
        `ttl=${packet.ttl - 1} hop=${packet.hopCount + 1} ` +
        '(forwarding lands in Phase 2)',
    );
  }

  private dispatch(inbound: InboundPacket): void {
    this.bus.emit('packet', inbound);
    const list = this.handlers.get(inbound.packet.type);
    if (!list || list.length === 0) {
      logger.warn(TAG, `no handler for ${inbound.packet.type}`);
      return;
    }
    for (const handler of list) {
      try {
        handler(inbound);
      } catch (err) {
        logger.error(TAG, `handler for ${inbound.packet.type} threw`, err);
      }
    }
  }

  // ---- outbound ---------------------------------------------------------

  /** Send over one specific link. Used for handshakes, before a peerId is known. */
  async sendOnLink(
    linkId: LinkId,
    packet: Packet,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    // Stamped here rather than in the builders so there is one counter for the whole
    // node, whatever produced the packet. A resend of the same message gets a NEW
    // sequence number, which is correct: the receiver's window accepts it (it is not
    // old) and the seen-id cache then recognises it as the duplicate it is. A captured
    // packet replayed verbatim carries the ORIGINAL number and is rejected outright.
    packet.seq = this.sequence.next();
    this.onSequenceAdvanced?.(packet.seq);
    const bytes = this.codec.encode(packet, linkId);
    try {
      await this.transport.send(linkId, bytes, onProgress);
      this.counters.tx++;
      this.emitCounters();
      this.bus.emit('lastPacket', {direction: 'tx', packet, linkId});
      logger.info(
        TAG,
        `TX ${packet.type} ${shortId(packet.id)} on ${linkId} (${bytes.length}B)`,
      );
    } catch (err) {
      this.counters.failed++;
      this.emitCounters();
      logger.error(
        TAG,
        `TX ${packet.type} ${shortId(packet.id)} failed on ${linkId}`,
        err,
      );
      throw err;
    }
  }

  /**
   * Send to a peer identity. Throws if no link can reach it — which is what makes a
   * "sent" status honest: it can only be set after this resolves.
   */
  async sendToPeer(
    peerId: string,
    packet: Packet,
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const linkId = this.resolver.resolveLink(peerId);
    if (!linkId) {
      throw new Error(`No route to peer ${shortId(peerId)}`);
    }
    await this.sendOnLink(linkId, packet, onProgress);
  }

  /** True when a link to this peer exists right now. */
  canReach(peerId: string): boolean {
    return this.resolver.resolveLink(peerId) !== null;
  }

  async broadcast(packet: Packet): Promise<number> {
    const links = this.resolver.establishedLinks();
    let delivered = 0;
    for (const linkId of links) {
      try {
        await this.sendOnLink(linkId, packet);
        delivered++;
      } catch {
        // Individual link failure must not abort the whole broadcast.
      }
    }
    return delivered;
  }

  private emitCounters(): void {
    this.bus.emit('counters', this.getCounters());
  }

  resetCounters(): void {
    this.counters = {
      tx: 0,
      rx: 0,
      ack: 0,
      failed: 0,
      duplicates: 0,
      forwarded: 0,
      dropped: 0,
      replayed: 0,
      spoofed: 0,
    };
    this.emitCounters();
  }
}
