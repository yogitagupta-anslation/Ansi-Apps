import {SeenMessageStore} from '../../messaging/Deduplication';
import {MessageRouter} from '../../messaging/MessageRouter';
import {MessageService} from '../../messaging/MessageService';
import {SecurePacketCodec} from '../../messaging/PacketCodec';
import {SessionRegistry} from '../../crypto/SessionRegistry';
import {PeerManager} from '../../peers/PeerManager';
import type {ChatMessage} from '../../types/Message';
import type {PeerIdentity} from '../../types/Peer';
import {peerIdPrefix} from '../../utils/id';
import {
  generateKeyPair,
  peerIdFromPublicKey,
  publicKeyToHex,
} from '../../crypto/Identity';
import {bytesToHex} from '../../utils/bytes';
import {localCapabilities} from '../../messaging/Negotiation';
import {SessionMetrics} from '../../peers/LinkMetrics';
import {LoopbackTransport, VirtualAir} from './LoopbackTransport';

/**
 * One complete application stack minus the UI and the radio.
 *
 * Assembled exactly the way BleChatService assembles the real one, so the wiring under
 * test is the production wiring: transport bytes -> router -> {PeerManager, MessageService}.
 */
export class VirtualPhone {
  readonly identity: PeerIdentity;
  readonly transport: LoopbackTransport;
  readonly router: MessageRouter;
  readonly peerManager: PeerManager;
  readonly messages: MessageService;
  readonly session = new SessionMetrics();
  /** Live per-link ciphers, shared between PeerManager and the codec as in production. */
  readonly sessions = new SessionRegistry();

  /** Mutable, exactly as in production: the provider is read at handshake time. */
  interests: string[] = [];

  constructor(
    readonly nodeId: string,
    displayName: string,
    air: VirtualAir,
    mtu?: number,
    interests: string[] = [],
  ) {
    this.interests = interests;
    // Real keypair, so the harness exercises the genuine authenticated handshake
    // rather than a stand-in that skips verification.
    const keys = generateKeyPair();
    this.identity = {
      peerId: peerIdFromPublicKey(keys.publicKey),
      displayName,
      publicKey: publicKeyToHex(keys.publicKey),
      privateKey: bytesToHex(keys.privateKey),
    };

    this.transport = new LoopbackTransport(
      nodeId,
      air,
      displayName,
      peerIdPrefix(this.identity.peerId),
      mtu,
    );

    // The same shared registry the real composition root uses, so every test in this
    // suite runs over the genuinely encrypted transport rather than around it. Using a
    // plain codec here would leave the encryption layer untested by everything except
    // its own unit tests.
    this.peerManager = new PeerManager(this.transport, this.sessions);
    this.router = new MessageRouter(
      this.transport,
      new SecurePacketCodec(this.sessions),
      this.peerManager,
      () => this.identity.peerId,
      new SeenMessageStore(),
    );
    this.messages = new MessageService(this.router);

    this.peerManager.setIdentity(this.identity);
    // Reconnect backoff would leave stray timers running after a test finishes.
    this.peerManager.setAutoReconnect(false);
    this.messages.setIdentity(this.identity);

    // The single line of coupling between transport and messaging, same as production.
    this.transport.onData(({linkId, data}) => {
      this.router.handleInbound(linkId, data);
    });

    this.peerManager.attachRouter(this.router);
    this.messages.attach();

    // Mirror the production composition root exactly, so the harness exercises the real
    // wiring rather than a simplified stand-in.
    this.peerManager.setCapabilitiesProvider(() =>
      localCapabilities({relay: true, largeMtu: mtu !== undefined && mtu > 23}),
    );
    this.peerManager.setInterestsProvider(() => this.interests);
    this.peerManager.setQueuedCountProvider(id => this.messages.queue.countFor(id));
    this.messages.setMetricsProvider(id => this.peerManager.metricsFor(id));

    // Flush the outbox when a peer comes back, exactly as BleChatService does on
    // 'peerConnected'. Without this the harness quietly under-models production: a
    // reconnect would leave queued messages sitting there, and any test of "messages
    // written while away are delivered when the peer returns" would be testing an
    // explicit flush call that the real app never needs.
    this.peerManager.bus.on('peerConnected', peer => {
      if (!peer.peerId) {
        return;
      }
      this.messages.flushQueue(peer.peerId).catch(() => undefined);
    });

    this.transport.bus.on('txFrame', ({linkId, bytes}) => {
      this.session.bytesTx += bytes;
      const id = this.peerManager.peerIdForLink(linkId);
      if (id) {
        this.peerManager.metricsFor(id).recordTxFrame(bytes);
      }
    });
    this.transport.bus.on('rxFrame', ({linkId, bytes}) => {
      this.session.bytesRx += bytes;
      const id = this.peerManager.peerIdForLink(linkId);
      if (id) {
        this.peerManager.metricsFor(id).recordRxFrame(bytes);
      }
    });

    this.peerManager.start();
  }

  get peerId(): string {
    return this.identity.peerId;
  }

  startAdvertising(): void {
    this.transport.startAdvertising();
  }

  async scan(): Promise<void> {
    await this.transport.startScanning();
  }

  conversationWith(peerId: string): ChatMessage[] {
    return this.messages.getMessages(peerId);
  }

  isConnectedTo(peerId: string): boolean {
    return this.peerManager.getPeer(peerId)?.state === 'connected';
  }

  dispose(): void {
    this.messages.dispose();
    this.peerManager.dispose();
  }
}

/** Poll until `predicate` holds, or fail with a readable message. */
export async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for: ${description}`);
    }
    await new Promise<void>(resolve => setTimeout(() => resolve(), 5));
  }
}
