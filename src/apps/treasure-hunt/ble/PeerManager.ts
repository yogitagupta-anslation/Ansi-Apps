/**
 * Tracks who is on the other end of each BLE link and how healthy it is.
 *
 * A "peer" is a radio link. A "player" is a game participant. The mapping is
 * one-to-one while connected, but a player outlives its peer: when a phone
 * drops off, the player keeps its slot and score during the reconnect grace
 * window, and is rebound to whatever new peerId the reconnect produces.
 */
import {CONNECTION} from '../config/bleConfig';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {BleLinkState, type BlePeer} from './BleTypes';

const log = createLogger('PeerManager');

export interface PeerManagerEvents {
  peerAdded: BlePeer;
  peerRemoved: {peerId: string; playerId?: string; reason: string};
  /** No traffic for longer than the idle timeout. */
  peerStale: {peerId: string; playerId?: string; silentMs: number};
  peersChanged: BlePeer[];
}

export class PeerManager {
  readonly events = new Emitter<PeerManagerEvents>();

  private peers = new Map<string, BlePeer>();
  private playerToPeer = new Map<string, string>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  startHealthChecks(): void {
    if (this.healthTimer) {
      return;
    }
    this.healthTimer = setInterval(() => this.checkHealth(), CONNECTION.pingIntervalMs);
  }

  stopHealthChecks(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  add(peer: BlePeer): void {
    this.peers.set(peer.peerId, {...peer});
    log.info(`peer ${peer.peerId} added (${this.peers.size} total)`);
    this.events.emit('peerAdded', {...peer});
    this.emitChanged();
  }

  remove(peerId: string, reason: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }
    this.peers.delete(peerId);
    if (peer.playerId) {
      this.playerToPeer.delete(peer.playerId);
    }
    log.info(`peer ${peerId} removed: ${reason}`);
    this.events.emit('peerRemoved', {peerId, playerId: peer.playerId, reason});
    this.emitChanged();
  }

  /** Attach a game identity to a link, once the peer has said who it is. */
  bindPlayer(peerId: string, playerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      log.warn(`cannot bind ${playerId}: peer ${peerId} is unknown`);
      return;
    }
    // Clear any previous binding for this player (reconnect on a new peerId).
    const previous = this.playerToPeer.get(playerId);
    if (previous && previous !== peerId) {
      const old = this.peers.get(previous);
      if (old) {
        delete old.playerId;
      }
    }
    peer.playerId = playerId;
    this.playerToPeer.set(playerId, peerId);
    this.emitChanged();
  }

  peerIdForPlayer(playerId: string): string | undefined {
    return this.playerToPeer.get(playerId);
  }

  playerIdForPeer(peerId: string): string | undefined {
    return this.peers.get(peerId)?.playerId;
  }

  get(peerId: string): BlePeer | undefined {
    return this.peers.get(peerId);
  }

  list(): BlePeer[] {
    return Array.from(this.peers.values()).map(peer => ({...peer}));
  }

  get count(): number {
    return this.peers.size;
  }

  markRx(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastRxAt = Date.now();
      if (peer.state === BleLinkState.Reconnecting) {
        peer.state = BleLinkState.Connected;
        this.emitChanged();
      }
    }
  }

  markTx(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.lastTxAt = Date.now();
    }
  }

  setMtu(peerId: string, mtu: number): void {
    const peer = this.peers.get(peerId);
    if (peer && peer.mtu !== mtu) {
      peer.mtu = mtu;
      this.emitChanged();
    }
  }

  private checkHealth(): void {
    const now = Date.now();
    for (const peer of this.peers.values()) {
      const silentMs = now - peer.lastRxAt;
      if (silentMs > CONNECTION.linkIdleTimeoutMs && peer.state === BleLinkState.Connected) {
        peer.state = BleLinkState.Reconnecting;
        log.warn(`peer ${peer.peerId} silent for ${silentMs}ms`);
        this.events.emit('peerStale', {
          peerId: peer.peerId,
          playerId: peer.playerId,
          silentMs,
        });
        this.emitChanged();
      }
    }
  }

  private emitChanged(): void {
    this.events.emit('peersChanged', this.list());
  }

  dispose(): void {
    this.stopHealthChecks();
    this.peers.clear();
    this.playerToPeer.clear();
    this.events.removeAllListeners();
  }
}
