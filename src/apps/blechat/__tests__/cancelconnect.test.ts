/**
 * Cancelling a connection is not a failure of anything.
 *
 * On a real phone, pressing Cancel produced an alert reading "Connection failed:
 * Operation was cancelled" — the app reporting the user's own decision back to them as an
 * error. The cause was one missing case: ble-plx rejects the in-flight connect with
 * OperationCancelled, nothing mapped that code, so it fell through to the phase fallback
 * and was classified ConnectionRefused. That is not just wrong wording. It marked the peer
 * failed, counted against it in the reconnect budget, and left a row the user had
 * cancelled sitting in an error state — so the next thing they tried was already
 * handicapped by the last thing they cancelled.
 */
import {BleError, BleErrorCode} from 'react-native-ble-plx';

import {classifyBleError} from '../ble/LinkErrors';

/** How ble-plx actually rejects a cancelled connect — code 2, that exact message. */
const MESSAGES = {
  [BleErrorCode.UnknownError]: 'Unknown error occurred',
  [BleErrorCode.OperationCancelled]: 'Operation was cancelled',
  [BleErrorCode.DeviceConnectionFailed]: 'Device connection failed',
} as never;

function bleError(errorCode: number): BleError {
  return new BleError(
    {
      errorCode,
      attErrorCode: null,
      iosErrorCode: null,
      androidErrorCode: null,
      reason: null,
    } as never,
    MESSAGES,
  );
}

/** How ble-plx actually rejects a cancelled connect. */
function cancelledByPlatform(): BleError {
  return bleError(BleErrorCode.OperationCancelled);
}

describe('a cancelled connect', () => {
  it('is classified as cancelled, not as a refusal by the peer', () => {
    const failure = classifyBleError(cancelledByPlatform(), 'connecting');
    expect(failure.reason).toBe('Cancelled');
  });

  it('is still cancelled when it lands in a later stage', () => {
    // Cancel can arrive at any point in the sequence; none of them make it a failure.
    for (const phase of [
      'discoveringServices',
      'negotiatingMtu',
      'enablingNotifications',
      'handshaking',
    ] as const) {
      expect(classifyBleError(cancelledByPlatform(), phase).reason).toBe('Cancelled');
    }
  });

  it('is recognised by its code even when the message gives nothing away', () => {
    // Pins the code mapping specifically. Without this, the message check below is
    // enough to make the other cases pass, and the enum case could be removed unnoticed.
    const mute = new BleError(
      {
        errorCode: BleErrorCode.OperationCancelled,
        attErrorCode: null,
        iosErrorCode: null,
        androidErrorCode: null,
        reason: null,
      } as never,
      {} as never,
    );
    expect(mute.message.toLowerCase()).not.toContain('cancel');
    expect(classifyBleError(mute, 'connecting').reason).toBe('Cancelled');
  });

  it('is recognised from a plain error, for stacks that throw no code', () => {
    expect(classifyBleError(new Error('Operation was cancelled'), 'connecting').reason).toBe(
      'Cancelled',
    );
    expect(classifyBleError(new Error('operation was canceled'), 'connecting').reason).toBe(
      'Cancelled',
    );
  });

  it('does not swallow a genuine refusal along with it', () => {
    // The guard above must not turn every connect failure into "cancelled" — a real
    // refusal has to keep pointing at the peer.
    const refused = bleError(BleErrorCode.DeviceConnectionFailed);
    expect(classifyBleError(refused, 'connecting').reason).toBe('ConnectionRefused');
  });
});

/**
 * The second half of the same bug, and the half that actually cost connections.
 *
 * Classifying a cancellation correctly only helps if PeerManager then treats it as the
 * non-event it is. It used to mark the peer `failed`, store the failure and count it in
 * the failure tally — so the peer you cancelled came back wearing an error you never
 * caused, and the reconnect logic backed off from someone who had never refused anything.
 */
import {PeerManager} from '../peers/PeerManager';
import {LoopbackTransport} from './support/LoopbackTransport';
import {VirtualAir} from './support/LoopbackTransport';
import {SessionRegistry} from '../crypto/SessionRegistry';

describe('a cancelled dial in PeerManager', () => {
  const LINK = 'c:aa:bb:cc:dd:ee';

  /**
   * A dial that hangs until the test decides how it ends — which is the only way to
   * reproduce the real sequence: the attempt is in flight, the user cancels, and the
   * platform's rejection arrives afterwards.
   */
  function hangingDial(): {manager: PeerManager; reject: (err: Error) => void} {
    const transport = new LoopbackTransport('n1', new VirtualAir(), 'Me', 'aabb', 185);
    let rejectDial!: (err: Error) => void;
    transport.connect = () =>
      new Promise<never>((_resolve, rej) => {
        rejectDial = rej;
      });
    return {
      manager: new PeerManager(transport, new SessionRegistry()),
      reject: err => rejectDial(err),
    };
  }

  it('leaves the peer disconnected rather than failed', async () => {
    const {manager, reject} = hangingDial();
    const dial = manager.connect(LINK);
    const settled = dial.catch(() => undefined);

    await manager.cancelConnect(LINK);
    reject(cancelledByPlatform());
    await settled;

    const peer = manager.getPeers().find(p => p.linkId === LINK);
    expect(peer?.state).not.toBe('failed');
    expect(peer?.failure).toBeNull();
    // And it is not held against them: a cancelled attempt is evidence of nothing.
    expect(peer?.failures ?? 0).toBe(0);
  });

  it('is recorded as cancelled however the platform words the rejection', async () => {
    // The rejection here carries no cancellation code and no telling message. It is
    // still a cancellation, because this device is the one that asked for it.
    const {manager, reject} = hangingDial();
    const settled = manager.connect(LINK).catch(() => undefined);

    await manager.cancelConnect(LINK);
    reject(new Error('Device disconnected'));
    await settled;

    const peer = manager.getPeers().find(p => p.linkId === LINK);
    expect(peer?.state).not.toBe('failed');
    expect(peer?.failure).toBeNull();
  });

  it('still records a real refusal', async () => {
    const {manager, reject} = hangingDial();
    const settled = manager.connect(LINK).catch(() => undefined);

    reject(bleError(BleErrorCode.DeviceConnectionFailed));
    await settled;

    const peer = manager.getPeers().find(p => p.linkId === LINK);
    expect(peer?.state).toBe('failed');
    expect(peer?.failure?.reason).toBe('ConnectionRefused');
  });

  it('does not carry a cancellation over into the next dial', async () => {
    const first = hangingDial();
    const settled = first.manager.connect(LINK).catch(() => undefined);
    await first.manager.cancelConnect(LINK);
    first.reject(cancelledByPlatform());
    await settled;

    // Same manager, new attempt: this one genuinely fails and must be recorded.
    const secondSettled = first.manager.connect(LINK).catch(() => undefined);
    first.reject(bleError(BleErrorCode.DeviceConnectionFailed));
    await secondSettled;

    const peer = first.manager.getPeers().find(p => p.linkId === LINK);
    expect(peer?.failure?.reason).toBe('ConnectionRefused');
  });
});
