/**
 * Android GATT 133 handling.
 *
 * 133 is the single most common real-world Android BLE failure, and it is transient
 * nearly every time. The behaviour that matters: recognise it for what it is rather than
 * reporting "the peer refused us", retry it a bounded number of times with a real delay
 * in between, and never retry a failure whose answer cannot change.
 */
import {
  isRetryableConnectFailure,
  maxAttemptsFor,
  retryDelayMs,
  withConnectRetry,
} from '../ble/ConnectRetry';
import {BleLinkError, classifyBleError, isAndroidGattError} from '../ble/LinkErrors';
import {
  ANDROID_GATT_ERROR,
  CONNECT_MAX_ATTEMPTS,
  CONNECT_RETRY_MAX_DELAY_MS,
} from '../config/constants';
import type {LinkFailureReason} from '../types/BLE';

describe('recognising GATT 133', () => {
  it('spots the status in the platform message, however it is written', () => {
    for (const message of [
      'Device 11:22:33 was disconnected (status 133)',
      'GATT_ERROR',
      'connection failed, status: 133',
      'connectGatt failed with code=133',
      'STATUS 133',
    ]) {
      expect(isAndroidGattError(new Error(message))).toBe(true);
    }
  });

  it('reads the numeric code even when the message says nothing useful', () => {
    // "Device connection failed" on its own is indistinguishable from a genuine refusal;
    // the code is the only thing that tells them apart.
    const err = Object.assign(new Error('Device connection failed'), {
      androidErrorCode: ANDROID_GATT_ERROR,
    });
    expect(isAndroidGattError(err)).toBe(true);

    const other = Object.assign(new Error('Device connection failed'), {
      androidErrorCode: 22,
    });
    expect(isAndroidGattError(other)).toBe(false);
  });

  it('handles a non-error throw without blowing up the classifier', () => {
    expect(isAndroidGattError(null)).toBe(false);
    expect(isAndroidGattError(undefined)).toBe(false);
    expect(isAndroidGattError('status 133')).toBe(true);
  });

  it('does not mistake an unrelated 133 for a GATT status', () => {
    for (const message of [
      'wrote 133 bytes',
      'device AA:BB:CC:11:33:33 not found',
      'MTU negotiated: 133',
      'timed out after 1330ms',
    ]) {
      expect(isAndroidGattError(new Error(message))).toBe(false);
    }
  });

  it('classifies it as its own reason, not as a refusal', () => {
    // ble-plx reports 133 as DeviceConnectionFailed, which reads as "the peer said no" —
    // the opposite of the truth, and it would stop us retrying.
    const classified = classifyBleError(
      new Error('Device deviceB was disconnected (status 133)'),
      'connecting',
    );
    expect(classified.reason).toBe('AndroidGattError');
    expect(classified.phase).toBe('connecting');
  });
});

describe('what is worth retrying', () => {
  it('retries the failures whose outcome could genuinely differ', () => {
    for (const reason of [
      'AndroidGattError',
      'ConnectionTimeout',
      'ConnectionRefused',
      'DeviceUnavailable',
    ] as LinkFailureReason[]) {
      expect(isRetryableConnectFailure(reason)).toBe(true);
    }
  });

  it('does not retry a failure that will give the same answer', () => {
    // Retrying these burns seconds and battery to arrive back where we started, and
    // delays the honest error the user needs to act on.
    for (const reason of [
      'BluetoothOff',
      'PermissionDenied',
      'BluetoothUnsupported',
      'BluetoothUnauthorized',
      'ServiceNotFound',
      'CharacteristicNotFound',
      'ProtocolMismatch',
      'AuthenticationFailed',
      'Unknown',
    ] as LinkFailureReason[]) {
      expect(isRetryableConnectFailure(reason)).toBe(false);
    }
  });

  it('spends the most attempts on the cheapest, most recoverable failure', () => {
    // 133 is refused in well under a second, so retrying it is nearly free.
    expect(maxAttemptsFor('AndroidGattError')).toBe(CONNECT_MAX_ATTEMPTS);
    expect(maxAttemptsFor('ConnectionRefused')).toBe(2);
  });

  it('does not retry a timeout, which has already cost the full timeout', () => {
    // Three 15s timeouts is 45 seconds of spinner for a peer that is not answering —
    // and it holds the scan off long enough for that peer to age out of the nearby list.
    // Auto-reconnect retries on its own schedule anyway.
    expect(maxAttemptsFor('ConnectionTimeout')).toBe(1);
  });

  it('gives a timeout exactly one attempt in practice', async () => {
    const error = new BleLinkError('ConnectionTimeout', 'connecting', 'timed out');
    const attempt = jest.fn(async () => {
      throw error;
    });
    const {sleep, slept} = recorder();

    await expect(
      withConnectRetry({
        label: 'x',
        attempt,
        cleanup: async () => undefined,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('backs off, and stops growing at the cap', () => {
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
    expect(retryDelayMs(3)).toBeGreaterThan(retryDelayMs(2));
    expect(retryDelayMs(50)).toBe(CONNECT_RETRY_MAX_DELAY_MS);
  });

  it('waits a real amount of time before the first retry', () => {
    // Reconnecting immediately reproduces the most common cause of 133 — a previous
    // connection that has not finished going away.
    expect(retryDelayMs(1)).toBeGreaterThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------

function gattError(): BleLinkError {
  return new BleLinkError('AndroidGattError', 'connecting', 'status 133');
}

/** Collects the delays the policy asked for, without actually waiting. */
function recorder() {
  const slept: number[] = [];
  return {
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
    },
  };
}

describe('withConnectRetry', () => {
  it('returns the first success without retrying', async () => {
    const attempt = jest.fn(async () => 'connected');
    const cleanup = jest.fn(async () => undefined);
    const {sleep, slept} = recorder();

    await expect(
      withConnectRetry({label: 'x', attempt, cleanup, sleep}),
    ).resolves.toBe('connected');

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(slept).toEqual([]);
  });

  it('recovers from a 133 on the second attempt', async () => {
    // The whole point: a single attempt would have reported this peer unreachable.
    const attempt = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(gattError())
      .mockResolvedValueOnce('connected');
    const cleanup = jest.fn(async () => undefined);
    const {sleep, slept} = recorder();

    await expect(
      withConnectRetry({label: 'x', attempt, cleanup, sleep}),
    ).resolves.toBe('connected');

    expect(attempt).toHaveBeenCalledTimes(2);
    // The half-open GATT client from the failed attempt must be released first, or the
    // next attempt fails the same way.
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([retryDelayMs(1)]);
  });

  it('gives up after the attempt budget and rethrows the real error', async () => {
    const error = gattError();
    const attempt = jest.fn(async () => {
      throw error;
    });
    const {sleep, slept} = recorder();

    await expect(
      withConnectRetry({
        label: 'x',
        attempt,
        cleanup: async () => undefined,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(CONNECT_MAX_ATTEMPTS);
    expect(slept).toHaveLength(CONNECT_MAX_ATTEMPTS - 1);
  });

  it('does not retry a failure that cannot change', async () => {
    const error = new BleLinkError('BluetoothOff', 'connecting', 'off');
    const attempt = jest.fn(async () => {
      throw error;
    });
    const {sleep, slept} = recorder();

    await expect(
      withConnectRetry({
        label: 'x',
        attempt,
        cleanup: async () => undefined,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it('backs off further with each successive failure', async () => {
    const attempt = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(gattError())
      .mockRejectedValueOnce(gattError())
      .mockResolvedValueOnce('connected');
    const {sleep, slept} = recorder();

    await withConnectRetry({
      label: 'x',
      attempt,
      cleanup: async () => undefined,
      sleep,
      maxAttempts: 4,
    });

    expect(slept).toEqual([retryDelayMs(1), retryDelayMs(2)]);
    expect(slept[1]).toBeGreaterThan(slept[0]);
  });

  it('keeps going when cleanup itself fails', async () => {
    // There may be nothing left to clean up, and that must not become the failure the
    // caller sees instead of the connection error.
    const attempt = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(gattError())
      .mockResolvedValueOnce('connected');
    const cleanup = jest.fn(async () => {
      throw new Error('nothing to cancel');
    });
    const {sleep} = recorder();

    await expect(
      withConnectRetry({label: 'x', attempt, cleanup, sleep}),
    ).resolves.toBe('connected');
  });

  it('reports each retry so it can be surfaced rather than hidden', async () => {
    const attempt = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(gattError())
      .mockResolvedValueOnce('connected');
    const retries: Array<{attempt: number; reason: string}> = [];

    await withConnectRetry({
      label: 'x',
      attempt,
      cleanup: async () => undefined,
      sleep: async () => undefined,
      onRetry: info =>
        retries.push({attempt: info.attempt, reason: info.error.reason}),
    });

    expect(retries).toEqual([{attempt: 1, reason: 'AndroidGattError'}]);
  });

  it('tells each attempt which attempt it is', async () => {
    const seen: number[] = [];
    await withConnectRetry({
      label: 'x',
      attempt: async n => {
        seen.push(n);
        if (n < 3) {
          throw gattError();
        }
        return 'connected';
      },
      cleanup: async () => undefined,
      sleep: async () => undefined,
      maxAttempts: 3,
    });

    expect(seen).toEqual([1, 2, 3]);
  });
});
