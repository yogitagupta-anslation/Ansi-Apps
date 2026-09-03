/**
 * Power-up activation and effects.
 *
 * Effects are intentionally read through query methods rather than mutating
 * game state, so an expiry that arrives late can never leave a player
 * permanently buffed. Whoever needs an effect asks "is this active right now?".
 */
import {POWERUP_SPECS, type PowerUpSpec} from '../config/gameConfig';
import {ItemKind, isPowerUpItem} from '../models/world';
import {Emitter} from '../utils/emitter';
import {createLogger} from '../utils/logger';
import type {PlayerManager} from './PlayerManager';

const log = createLogger('PowerUpManager');

export interface PowerUpActivation {
  playerId: string;
  kind: ItemKind;
  durationMs: number;
  expiresAt: number;
}

export interface PowerUpManagerEvents {
  activated: PowerUpActivation;
  expired: {playerId: string; kind: ItemKind};
}

export class PowerUpManager {
  readonly events = new Emitter<PowerUpManagerEvents>();

  constructor(private readonly players: PlayerManager) {}

  static specFor(kind: ItemKind): PowerUpSpec | undefined {
    return POWERUP_SPECS[kind];
  }

  /**
   * Spend one power-up from the player's bag and start its effect.
   * @returns the activation, or null when they were not holding one.
   */
  activate(playerId: string, kind: ItemKind): PowerUpActivation | null {
    if (!isPowerUpItem(kind)) {
      log.warn(`${kind} is not an activatable power-up`);
      return null;
    }

    const spec = POWERUP_SPECS[kind];
    if (!spec) {
      return null;
    }

    if (!this.players.consumeFromInventory(playerId, kind)) {
      log.debug(`${playerId} tried to use ${kind} without holding one`);
      return null;
    }

    const active = this.players.activatePowerUp(playerId, kind, spec.durationMs);
    if (!active) {
      return null;
    }

    const activation: PowerUpActivation = {
      playerId,
      kind,
      durationMs: spec.durationMs,
      expiresAt: active.expiresAt,
    };

    log.info(`${playerId} activated ${spec.label} for ${spec.durationMs}ms`);
    this.events.emit('activated', activation);
    return activation;
  }

  /**
   * Player side: apply an activation the host announced, without spending from
   * the local inventory copy (the host already did that).
   */
  applyRemoteActivation(playerId: string, kind: ItemKind, expiresAt: number): void {
    const durationMs = Math.max(0, expiresAt - Date.now());
    this.players.activatePowerUp(playerId, kind, durationMs);
    this.events.emit('activated', {playerId, kind, durationMs, expiresAt});
  }

  /** Sweep expired effects. Call from the game tick. */
  tick(atMs = Date.now()): void {
    const changed = this.players.expirePowerUps(atMs);
    for (const player of changed) {
      // Report each kind that is no longer running.
      for (const kind of Object.keys(POWERUP_SPECS) as ItemKind[]) {
        if (!this.players.hasActivePowerUp(player.id, kind, atMs)) {
          this.events.emit('expired', {playerId: player.id, kind});
        }
      }
    }
  }

  // -- effect queries --------------------------------------------------------

  /** Sharper proximity readings. */
  isRadarActive(playerId: string, atMs = Date.now()): boolean {
    return this.players.hasActivePowerUp(playerId, ItemKind.Radar, atMs);
  }

  /** Coarse bearing toward the treasure. */
  isHintActive(playerId: string, atMs = Date.now()): boolean {
    return this.players.hasActivePowerUp(playerId, ItemKind.Hint, atMs);
  }

  /** Faster virtual movement. */
  isSpeedBoostActive(playerId: string, atMs = Date.now()): boolean {
    return this.players.hasActivePowerUp(playerId, ItemKind.Energy, atMs);
  }

  /** Doubles points banked while running. */
  isDoublePointsActive(playerId: string, atMs = Date.now()): boolean {
    return this.players.hasActivePowerUp(playerId, ItemKind.DoublePoints, atMs);
  }

  /** Blocks tags from rivals. */
  isShieldActive(playerId: string, atMs = Date.now()): boolean {
    return this.players.hasActivePowerUp(playerId, ItemKind.Shield, atMs);
  }

  dispose(): void {
    this.events.removeAllListeners();
  }
}
