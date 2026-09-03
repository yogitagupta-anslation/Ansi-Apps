/**
 * The single entry point the game layer uses to talk to other devices.
 *
 * Composes the whole BLE stack and hides the role difference: whether this
 * device is hosting (peripheral) or playing (central), the game calls the same
 * send/broadcast/on methods.
 *
 *   GameManager
 *        |
 *   BleManager  <- you are here
 *        |
 *   ReliableLayer -- MessageRouter -- PeerManager
 *        |
 *   Transport (CentralTransport | PeripheralTransport)
 *        |
 *   Native BLE
 *
 * The class is game-agnostic: it knows about envelopes, peers and links, not
 * about treasure. Reusing it for a different BLE game means keeping this file
 * and swapping everything in src/game.
 */
import {MessageType, PROTOCOL_VERSION} from '../models/messages';
import type {Envelope, GameMessage} from '../models/messages';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {
  BleAdapterState,
  BleError,
  BleErrorCode,
  BleLinkState,
  BleRole,
  type BlePeer,
  type DiscoveredHost,
} from './BleTypes';
import {BleAdvertiser} from './BleAdvertiser';
import {BleScanner} from './BleScanner';
import {ConnectionManager} from './ConnectionManager';
import {MessageRouter, type MessageContext, type MessageHandler} from './MessageRouter';
import {PeerManager} from './PeerManager';
import {ReconnectionManager} from './ReconnectionManager';
import {ReliableLayer} from './ReliableLayer';
import {requestBlePermissions} from './permissions';
import {
  createCentralTransport,
  createPeripheralTransport,
} from './transport';
import type {
  CentralTransport,
  PeripheralTransport,
  Transport,
} from './transport/Transport';

const log = createLogger('BleManager');

export interface BleManagerEvents {
  adapterState: BleAdapterState;
  linkState: BleLinkState;
  peersChanged: BlePeer[];
  hostsChanged: DiscoveredHost[];
  peerConnected: BlePeer;
  peerDisconnected: {peerId: string; playerId?: string; reason: string};
  advertisingChanged: boolean;
  error: BleError;
  /** Emitted after a reliable message exhausts its retries. */
  deliveryFailed: {peerId: string; message: Envelope; attempts: number};
  /**
   * Any inbound traffic from a peer, heartbeats included.
   *
   * Proof of life, separate from game messages: a player standing still sends
   * no movement, so without this the host would age them out as stale.
   */
  peerActivity: {peerId: string; playerId?: string};
}

export interface BleManagerInit {
  role: BleRole;
  /** Local game identity, stamped as senderId on every outgoing envelope. */
  localId: string;
  /**
   * Supply the transport instead of probing the native radio.
   *
   * The app never passes this -- `initialize()` probes the real stack and
   * throws if the hardware cannot do the job. It exists so integration tests
   * can drive the genuine ReliableLayer, Framer, codec and MessageRouter over
   * an in-memory link. It is NOT a fallback: if the probe fails in production
   * the error still surfaces.
   */
  transportFactory?: (role: BleRole) => Transport;
}

export class BleManager {
  readonly events = new Emitter<BleManagerEvents>();
  readonly router = new MessageRouter();
  readonly peers = new PeerManager();

  readonly role: BleRole;

  private transport: Transport | null = null;
  private reliable: ReliableLayer | null = null;
  private scanner: BleScanner | null = null;
  private advertiser: BleAdvertiser | null = null;
  private connection: ConnectionManager | null = null;
  private reconnection: ReconnectionManager | null = null;

  private localId: string;
  private adapterState: BleAdapterState = BleAdapterState.Unknown;
  private initialized = false;
  private readonly transportFactory: ((role: BleRole) => Transport) | undefined;

  constructor(init: BleManagerInit) {
    this.role = init.role;
    this.localId = init.localId;
    this.transportFactory = init.transportFactory;
  }

  /**
   * Adopt the game identity the host assigned.
   *
   * A joining player builds its BleManager before it has a playerId, so the
   * first envelopes would otherwise be stamped with the provisional id for the
   * rest of the match.
   */
  setLocalId(localId: string): void {
    this.localId = localId;
    this.reliable?.setLocalId(localId);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Request permissions, create the role-appropriate transport, and bring the
   * radio up. Throws a BleError the UI can present verbatim.
   */
  async initialize(): Promise<BleAdapterState> {
    if (this.initialized) {
      return this.adapterState;
    }

    // An injected transport means there is no radio to ask permission for.
    if (!this.transportFactory) {
      const permission = await requestBlePermissions(this.role);
      if (!permission.granted) {
        throw new BleError(
          permission.message ?? 'Bluetooth permission denied',
          BleErrorCode.PermissionDenied,
        );
      }
    }

    if (this.role === BleRole.Peripheral) {
      let peripheral: PeripheralTransport;
      if (this.transportFactory) {
        peripheral = this.transportFactory(this.role) as PeripheralTransport;
      } else {
        const probe = createPeripheralTransport();
        if (!probe.available) {
          throw new BleError(probe.reason, BleErrorCode.PeripheralUnavailable);
        }
        peripheral = probe.transport;
      }
      this.transport = peripheral;
      this.advertiser = new BleAdvertiser(peripheral);
      this.advertiser.events.on('advertisingChanged', value =>
        this.events.emit('advertisingChanged', value),
      );
      this.advertiser.events.on('error', error => this.events.emit('error', error));
    } else {
      let central: CentralTransport;
      if (this.transportFactory) {
        central = this.transportFactory(this.role) as CentralTransport;
      } else {
        const probe = createCentralTransport();
        if (!probe.available) {
          throw new BleError(probe.reason, BleErrorCode.Unsupported);
        }
        central = probe.transport;
      }
      this.transport = central;
      this.scanner = new BleScanner(central);
      this.scanner.events.on('hostsChanged', hosts =>
        this.events.emit('hostsChanged', hosts),
      );
      this.connection = new ConnectionManager(central);
      this.connection.events.on('stateChanged', state =>
        this.events.emit('linkState', state),
      );
      this.connection.events.on('error', error => this.events.emit('error', error));
      this.connection.attachHeartbeat(() => this.sendPing());
      this.reconnection = new ReconnectionManager(central, this.connection);
    }

    this.reliable = new ReliableLayer(
      {
        send: (peerId, payload) => this.requireTransport().send(peerId, payload),
        broadcast: (payload, exclude) => this.requireTransport().broadcast(payload, exclude),
        getPeerIds: () => this.peers.list().map(peer => peer.peerId),
      },
      this.localId,
    );

    this.wireTransportEvents();
    this.wireReliableEvents();
    this.peers.events.on('peersChanged', list => this.events.emit('peersChanged', list));

    const state = await this.requireTransport().initialize();
    this.adapterState = state;
    this.initialized = true;
    this.peers.startHealthChecks();

    log.info(`initialized as ${this.role}, adapter ${state}`);
    return state;
  }

  private requireTransport(): Transport {
    if (!this.transport) {
      throw new BleError('BleManager used before initialize()', BleErrorCode.Unknown);
    }
    return this.transport;
  }

  private requireReliable(): ReliableLayer {
    if (!this.reliable) {
      throw new BleError('BleManager used before initialize()', BleErrorCode.Unknown);
    }
    return this.reliable;
  }

  private wireTransportEvents(): void {
    const transport = this.requireTransport();

    transport.events.on('adapterState', state => {
      this.adapterState = state;
      this.events.emit('adapterState', state);
    });

    transport.events.on('peerConnected', peer => {
      this.peers.add(peer);
      this.events.emit('peerConnected', peer);
    });

    transport.events.on('peerDisconnected', ({peerId, reason}) => {
      const playerId = this.peers.playerIdForPeer(peerId);
      this.peers.remove(peerId, reason ?? 'disconnected');
      this.reliable?.forgetPeer(peerId);
      this.events.emit('peerDisconnected', {
        peerId,
        playerId,
        reason: reason ?? 'disconnected',
      });

      // Player side: a lost host link is worth chasing.
      if (this.role === BleRole.Central && this.connection) {
        this.connection.handleDisconnected(peerId, reason ?? 'disconnected');
        const deviceId = this.connection.deviceId;
        if (deviceId && this.reconnection) {
          this.reconnection.start(deviceId);
        }
      }
    });

    transport.events.on('data', ({peerId, bytes}) => {
      this.peers.markRx(peerId);
      this.requireReliable().handleIncoming(peerId, bytes);
    });

    transport.events.on('mtuChanged', ({peerId, mtu}) => {
      this.peers.setMtu(peerId, mtu);
    });

    transport.events.on('error', error => this.events.emit('error', error));
  }

  private wireReliableEvents(): void {
    const reliable = this.requireReliable();

    reliable.events.on('message', ({peerId, message}) => {
      // Proof of life first: this must count even for heartbeats, which are
      // answered below and never reach the game layer.
      const activePlayerId = this.peers.playerIdForPeer(peerId);
      this.events.emit('peerActivity', {
        peerId,
        ...(activePlayerId ? {playerId: activePlayerId} : {}),
      });

      // Answer heartbeats here so they never reach the game layer.
      if (message.type === MessageType.Ping) {
        this.send(peerId, MessageType.Pong, {});
        return;
      }
      if (message.type === MessageType.Pong) {
        return;
      }

      const context: MessageContext = {
        peerId,
        playerId: this.peers.playerIdForPeer(peerId) ?? message.senderId,
        receivedAt: Date.now(),
      };
      this.router.route(message, context);
    });

    reliable.events.on('deliveryFailed', payload => {
      this.events.emit('deliveryFailed', payload);
    });
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  send<T>(peerId: string, type: MessageType, payload: T): Envelope<T> {
    this.peers.markTx(peerId);
    return this.requireReliable().send(peerId, type, payload);
  }

  /** Send to a game player rather than a raw link. No-op if not connected. */
  sendToPlayer<T>(playerId: string, type: MessageType, payload: T): Envelope<T> | null {
    const peerId = this.peers.peerIdForPlayer(playerId);
    if (!peerId) {
      log.debug(`cannot send ${type}: player ${playerId} has no live link`);
      return null;
    }
    return this.send(peerId, type, payload);
  }

  broadcast<T>(type: MessageType, payload: T, excludePeerId?: string): Envelope<T> {
    return this.requireReliable().broadcast(type, payload, excludePeerId);
  }

  on<P>(type: MessageType, handler: MessageHandler<P>): () => void {
    return this.router.on(type, handler);
  }

  private sendPing(): void {
    for (const peer of this.peers.list()) {
      this.send(peer.peerId, MessageType.Ping, {});
    }
  }

  /** Bind a game identity to a link so sendToPlayer can find it later. */
  bindPlayer(peerId: string, playerId: string): void {
    this.peers.bindPlayer(peerId, playerId);
    // A reconnecting peer restarts its seq counter from 1.
    this.reliable?.resetPeerOrdering(peerId);
  }

  // -------------------------------------------------------------------------
  // Host-only
  // -------------------------------------------------------------------------

  async startAdvertising(gameCode: string): Promise<void> {
    if (!this.advertiser) {
      throw new BleError(
        'this BleManager was not created in host mode',
        BleErrorCode.PeripheralUnavailable,
      );
    }
    await this.advertiser.start(gameCode);
  }

  async stopAdvertising(): Promise<void> {
    await this.advertiser?.stop();
  }

  get isAdvertising(): boolean {
    return this.advertiser?.isAdvertising ?? false;
  }

  // -------------------------------------------------------------------------
  // Player-only
  // -------------------------------------------------------------------------

  async startScan(): Promise<void> {
    if (!this.scanner) {
      throw new BleError(
        'this BleManager was not created in player mode',
        BleErrorCode.Unsupported,
      );
    }
    await this.scanner.start();
  }

  async stopScan(): Promise<void> {
    await this.scanner?.stop();
  }

  getDiscoveredHosts(): DiscoveredHost[] {
    return this.scanner?.getHosts() ?? [];
  }

  findHostByGameCode(gameCode: string): DiscoveredHost | undefined {
    return this.scanner?.findByGameCode(gameCode);
  }

  async connectToHost(deviceId: string): Promise<BlePeer> {
    if (!this.connection) {
      throw new BleError(
        'this BleManager was not created in player mode',
        BleErrorCode.Unsupported,
      );
    }
    await this.stopScan();
    return this.connection.connect(deviceId);
  }

  async disconnectFromHost(): Promise<void> {
    this.reconnection?.cancel('user left the game');
    await this.connection?.disconnect();
  }

  get linkState(): BleLinkState {
    return this.connection?.linkState ?? BleLinkState.Idle;
  }

  get isReconnecting(): boolean {
    return this.reconnection?.isReconnecting ?? false;
  }

  /** The host link, from the player side. */
  get hostPeerId(): string | null {
    return this.connection?.currentPeer?.peerId ?? null;
  }

  onReconnected(handler: (peer: BlePeer) => void): () => void {
    if (!this.reconnection) {
      return () => undefined;
    }
    return this.reconnection.events.on('reconnected', handler);
  }

  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------

  get currentAdapterState(): BleAdapterState {
    return this.adapterState;
  }

  get isReady(): boolean {
    return this.initialized && this.adapterState === BleAdapterState.PoweredOn;
  }

  get connectedPeerCount(): number {
    return this.peers.count;
  }

  async refreshAdapterState(): Promise<BleAdapterState> {
    if (!this.transport) {
      return this.adapterState;
    }
    this.adapterState = await this.transport.getAdapterState();
    return this.adapterState;
  }

  async shutdown(): Promise<void> {
    log.info('shutting down');
    this.reconnection?.dispose();
    this.connection?.dispose();
    this.scanner?.dispose();
    this.advertiser?.dispose();
    this.reliable?.dispose();
    this.peers.dispose();
    this.router.clear();

    if (this.transport) {
      try {
        await this.transport.shutdown();
      } catch (err) {
        log.warn('transport shutdown threw', err);
      }
    }

    this.transport = null;
    this.reliable = null;
    this.scanner = null;
    this.advertiser = null;
    this.connection = null;
    this.reconnection = null;
    this.initialized = false;
    this.events.removeAllListeners();
  }
}

export {BleRole, BleAdapterState, BleLinkState, BleError, BleErrorCode, PROTOCOL_VERSION};
export type {GameMessage, MessageContext};
