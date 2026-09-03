import type {LinkFailure, LinkFailureReason, LinkState} from '../types/BLE';

/**
 * Anything that can describe itself as a typed link failure.
 *
 * Declared structurally, and here rather than in ble/, so PeerManager can extract a rich
 * failure from a rejected connect() without importing the BLE layer. BleLinkError
 * satisfies it; so would a future Wi-Fi transport's error type.
 */
export interface LinkFailureCarrier {
  toFailure(): LinkFailure;
}

export function isLinkFailureCarrier(err: unknown): err is LinkFailureCarrier {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as LinkFailureCarrier).toFailure === 'function'
  );
}

/** Extract a typed failure, falling back to an Unknown one for plain throws. */
export function toLinkFailure(
  err: unknown,
  phase: LinkState,
  fallback: LinkFailureReason = 'Unknown',
): LinkFailure {
  if (isLinkFailureCarrier(err)) {
    return err.toFailure();
  }
  return {
    reason: fallback,
    phase,
    message: err instanceof Error ? err.message : String(err),
    timestamp: Date.now(),
  };
}

export function makeFailure(
  reason: LinkFailureReason,
  phase: LinkState,
  message: string,
): LinkFailure {
  return {reason, phase, message, timestamp: Date.now()};
}
