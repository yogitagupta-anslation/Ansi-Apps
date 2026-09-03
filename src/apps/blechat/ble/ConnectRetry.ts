import {
  CONNECT_MAX_ATTEMPTS,
  CONNECT_RETRY_BASE_DELAY_MS,
  CONNECT_RETRY_MAX_DELAY_MS,
} from '../config/constants';
import type {LinkFailureReason} from '../types/BLE';
import {BleLinkError} from './LinkErrors';
import {logger} from '../utils/logger';

const TAG = 'Connect';

/**
 * Bounded connect retry.
 *
 * Android's connectGatt fails far more often than it should, and the failure is usually
 * transient: a stale GATT cache from a previous session, a reconnect issued before the
 * stack finished tearing the last one down, or simply too many links at once. All of them
 * surface as status 133 with no further detail. A single attempt therefore reports "peer
 * unreachable" for a peer that is sitting right there and would connect on the next try.
 *
 * Kept separate from BLECentral so the policy — what is worth retrying, how long to wait,
 * when to give up — is testable without a Bluetooth stack.
 */

/**
 * Which failures are worth another attempt.
 *
 * The distinction is whether the outcome could plausibly differ next time. A missing
 * service will still be missing; Bluetooth being off will still be off; a permission we
 * do not hold will not appear. Retrying those burns seconds and battery to arrive at the
 * same answer, and delays the honest error the user needs to see.
 */
export function isRetryableConnectFailure(reason: LinkFailureReason): boolean {
  switch (reason) {
    // AndroidGattError is the stack declining to say why, and is transient nearly every
    // time. The rest cover a peer that was advertising a moment ago and probably still
    // is — out of range for one attempt is not out of range forever.
    case 'AndroidGattError':
    case 'ConnectionTimeout':
    case 'ConnectionRefused':
    case 'DeviceUnavailable':
      return true;

    // Deterministic: the next attempt produces the same result.
    case 'PermissionDenied':
    case 'BluetoothOff':
    case 'BluetoothUnauthorized':
    case 'BluetoothUnsupported':
    case 'ServiceNotFound':
    case 'CharacteristicNotFound':
    case 'ProtocolMismatch':
    case 'AuthenticationFailed':
    case 'Cancelled':
      // The last of these is not a failure at all: the user asked us to stop.
      return false;

    default:
      return false;
  }
}

/**
 * How many attempts a given failure is worth, including the first.
 *
 * A flat budget is wrong because the failures cost wildly different amounts of time. A
 * 133 is refused in well under a second, so three attempts are nearly free and recover
 * most of them. A connection TIMEOUT has already spent CONNECT_TIMEOUT_MS before we hear
 * about it, so three of those is three quarters of a minute of a spinner — for a peer
 * that is, by definition, not answering. Auto-reconnect already retries on its own
 * schedule, so the inner loop does not need to.
 */
export function maxAttemptsFor(reason: LinkFailureReason): number {
  switch (reason) {
    case 'AndroidGattError':
      return CONNECT_MAX_ATTEMPTS;
    case 'ConnectionRefused':
    case 'DeviceUnavailable':
      return 2;
    case 'ConnectionTimeout':
      // One attempt: the 15s we already waited is the evidence, and repeating it just
      // holds the scan off long enough for the peer to age out of the nearby list.
      return 1;
    default:
      return 1;
  }
}

/**
 * Exponential backoff, capped.
 *
 * Backing off matters more than usual here: the most common cause of 133 is reconnecting
 * before the previous connection has finished going away, so retrying immediately
 * reproduces the exact condition that caused the failure.
 */
export function retryDelayMs(attempt: number): number {
  const delay = CONNECT_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(delay, CONNECT_RETRY_MAX_DELAY_MS);
}

export interface ConnectRetryOptions<T> {
  /** Human-readable target, for logs only. */
  label: string;
  /** One full connection attempt. `attempt` is 1-based. */
  attempt: (attempt: number) => Promise<T>;
  /**
   * Tear down whatever the failed attempt left behind, before the next one.
   *
   * Not optional in practice on Android: a half-open GATT client counts against the
   * connection limit and makes the next attempt fail the same way.
   */
  cleanup: (attempt: number) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /**
   * Stop retrying, checked before each further attempt.
   *
   * A user who cancels does not want the remaining budget spent on their behalf, and a
   * cancelled attempt is not evidence that the peer is unreachable.
   */
  shouldAbort?: () => boolean;
  maxAttempts?: number;
  onRetry?: (info: {attempt: number; delayMs: number; error: BleLinkError}) => void;
}

/**
 * Run `attempt` until it succeeds, the failure is not worth retrying, or the attempts run
 * out. The last error is rethrown unchanged, so the caller still reports the real reason.
 */
export async function withConnectRetry<T>(
  options: ConnectRetryOptions<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? CONNECT_MAX_ATTEMPTS);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await options.attempt(attempt);
    } catch (err) {
      lastError = err;

      const reason =
        err instanceof BleLinkError ? err.reason : ('Unknown' as LinkFailureReason);
      // Budgeted by what actually went wrong, not by a single number for everything.
      const budget = Math.min(maxAttempts, maxAttemptsFor(reason));
      const isLast = attempt >= budget;

      if (options.shouldAbort?.()) {
        logger.info(TAG, `${options.label}: abandoned after attempt ${attempt}`);
        throw new BleLinkError(
          'Cancelled',
          err instanceof BleLinkError ? err.phase : 'connecting',
          'Connection cancelled',
          err,
        );
      }

      if (isLast || !isRetryableConnectFailure(reason)) {
        // Say which it was, so a log never leaves it ambiguous whether we gave up
        // because the error was fatal or because we ran out of attempts.
        if (attempt > 1 || isLast) {
          logger.warn(
            TAG,
            `${options.label}: giving up after ${attempt} attempt(s) — ` +
              (isRetryableConnectFailure(reason)
                ? `still failing with ${reason}`
                : `${reason} will not change on a retry`),
          );
        }
        throw err;
      }

      const delayMs = retryDelayMs(attempt);
      logger.warn(
        TAG,
        `${options.label}: attempt ${attempt}/${budget} failed with ${reason}, ` +
          `retrying in ${delayMs}ms`,
      );
      options.onRetry?.({
        attempt,
        delayMs,
        error: err instanceof BleLinkError ? err : new BleLinkError(
          reason,
          'connecting',
          err instanceof Error ? err.message : String(err),
          err,
        ),
      });

      try {
        await options.cleanup(attempt);
      } catch {
        // Cleanup is best-effort — there may be nothing left to clean up.
      }
      await options.sleep(delayMs);
    }
  }

  throw lastError;
}
