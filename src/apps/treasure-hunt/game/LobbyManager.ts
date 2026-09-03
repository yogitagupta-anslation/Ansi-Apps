/**
 * Lobby: admitting players before the hunt starts.
 *
 * Owns the join policy -- code check, capacity, protocol compatibility, phase --
 * so GameManager stays out of the business of who is allowed in.
 */
import {MAX_CONCURRENT_PEERS} from '../config/bleConfig';
import {GamePhase, type GameConfig} from '../models/game';
import {PROTOCOL_VERSION} from '../models/messages';
import type {GameJoinPayload, GameJoinRejectedPayload} from '../models/messages';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import {generateGameCode} from '../utils/prng';

const log = createLogger('LobbyManager');

export interface LobbyManagerEvents {
  opened: {gameCode: string};
  closed: void;
  joinRejected: {peerId: string; reason: GameJoinRejectedPayload};
}

export type JoinDecision =
  | {accepted: true}
  | {accepted: false; rejection: GameJoinRejectedPayload};

export class LobbyManager {
  readonly events = new Emitter<LobbyManagerEvents>();

  private code: string | null = null;
  private open = false;

  get gameCode(): string | null {
    return this.code;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Open a lobby, generating a four-digit code players can read aloud. */
  openLobby(existingCode?: string): string {
    this.code = existingCode ?? generateGameCode();
    this.open = true;
    log.info(`lobby ${this.code} open`);
    this.events.emit('opened', {gameCode: this.code});
    return this.code;
  }

  closeLobby(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    log.info(`lobby ${this.code} closed`);
    this.events.emit('closed', undefined);
  }

  /**
   * Decide whether a join request is admitted.
   *
   * @param currentPlayerCount includes the host.
   */
  evaluateJoin(
    request: GameJoinPayload,
    currentPlayerCount: number,
    config: GameConfig,
    phase: GamePhase,
    peerId: string,
    isRejoin = false,
  ): JoinDecision {
    const reject = (rejection: GameJoinRejectedPayload): JoinDecision => {
      log.warn(`rejecting ${request.name} from ${peerId}: ${rejection.reason}`);
      this.events.emit('joinRejected', {peerId, reason: rejection});
      return {accepted: false, rejection};
    };

    if (request.protocolVersion !== PROTOCOL_VERSION) {
      return reject({
        reason: 'VERSION_MISMATCH',
        message:
          `This hunt speaks protocol v${PROTOCOL_VERSION} but you are on ` +
          `v${request.protocolVersion}. Update the app on both phones.`,
      });
    }

    if (this.code && request.gameCode !== this.code) {
      return reject({
        reason: 'WRONG_CODE',
        message: 'That game code does not match this hunt.',
      });
    }

    // A player who dropped mid-match is always allowed back to their slot.
    if (isRejoin) {
      return {accepted: true};
    }

    if (phase !== GamePhase.Lobby) {
      return reject({
        reason: 'ALREADY_STARTED',
        message: 'This hunt has already begun. Ask the host for a rematch.',
      });
    }

    // Two independent caps: the host's chosen size, and what BLE can carry.
    const cap = Math.min(config.maxPlayers, MAX_CONCURRENT_PEERS + 1);
    if (currentPlayerCount >= cap) {
      return reject({
        reason: 'GAME_FULL',
        message: `This hunt is full (${cap} hunters).`,
      });
    }

    return {accepted: true};
  }

  /** Cap actually enforced, given both the config and the BLE limit. */
  effectiveMaxPlayers(config: GameConfig): number {
    return Math.min(config.maxPlayers, MAX_CONCURRENT_PEERS + 1);
  }

  reset(): void {
    this.code = null;
    this.open = false;
  }

  dispose(): void {
    this.reset();
    this.events.removeAllListeners();
  }
}
