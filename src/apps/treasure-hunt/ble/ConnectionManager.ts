/**
 * Player-side connection lifecycle: connect to a host, keep the link alive,
 * and expose a single observable state the UI can bind to.
 *
 * Reconnection itself lives in ReconnectionManager; this class owns the
 * "connected / connecting / lost" state machine and the heartbeat.
 */
import {CONNECTION} from '../config/bleConfig';
import {MessageType} from '../models/messages';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {BleError, BleErrorCode, BleLinkState, type BlePeer} from './BleTypes';
import type {CentralTransport} from './transport/Transport';

const log = createLogger('ConnectionManager');

export interface ConnectionManagerEvents {
  stateChanged: BleLinkState;
  connected: BlePeer;
  lost: {peerId: string; reason: string};
  error: BleError;
}

export class ConnectionManager {
  readonly events = new Emitter<ConnectionManagerEvents>();

  private state: BleLinkState = BleLinkState.Idle;
  private peer: BlePeer | null = null;
  private targetDeviceId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sendPing: (() => void) | null = null;

  constructor(private readonly transport: CentralTransport) {}

  get linkState(): BleLinkState {
    return this.state;
  }

  get currentPeer(): BlePeer | null {
    return this.peer ? {...this.peer} : null;
  }

  get deviceId(): string | null {
    return this.targetDeviceId;
  }

  /** Supplies the heartbeat sender; wired by BleManager once routing exists. */
  attachHeartbeat(sendPing: () => void): void {
    this.sendPing = sendPing;
  }

  private setState(next: BleLinkState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.events.emit('stateChanged', next);
  }

  async connect(deviceId: string): Promise<BlePeer> {
    this.targetDeviceId = deviceId;
    this.setState(BleLinkState.Connecting);

    try {
      const peer = await this.transport.connect(deviceId);
      this.peer = peer;
      this.setState(BleLinkState.Connected);
      this.startHeartbeat();
      this.events.emit('connected', peer);
      return peer;
    } catch (err) {
      this.setState(BleLinkState.Failed);
      const error =
        err instanceof BleError
          ? err
          : new BleError('connection failed', BleErrorCode.ConnectFailed, err);
      this.events.emit('error', error);
      throw error;
    }
  }

  /** Called by BleManager when the transport reports the link is gone. */
  handleDisconnected(peerId: string, reason: string): void {
    if (this.peer?.peerId !== peerId) {
      return;
    }
    this.stopHeartbeat();
    this.peer = null;
    this.setState(BleLinkState.Disconnected);
    this.events.emit('lost', {peerId, reason});
  }

  /** Marks the link as being re-established, without clearing the target. */
  markReconnecting(): void {
    this.setState(BleLinkState.Reconnecting);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    const peerId = this.peer?.peerId;
    this.peer = null;
    this.targetDeviceId = null;
    this.setState(BleLinkState.Idle);
    if (peerId) {
      await this.transport.disconnect(peerId);
    }
  }

  /**
   * Periodic PING. A BLE link can go half-open: the OS still believes it is
   * connected while no data actually flows. Traffic in both directions is the
   * only reliable way to notice.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state !== BleLinkState.Connected) {
        return;
      }
      try {
        this.sendPing?.();
      } catch (err) {
        log.debug('heartbeat send failed', err);
      }
    }, CONNECTION.pingIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  dispose(): void {
    this.stopHeartbeat();
    this.peer = null;
    this.targetDeviceId = null;
    this.events.removeAllListeners();
  }
}

export {MessageType};
