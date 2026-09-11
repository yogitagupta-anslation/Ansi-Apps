import {NativeEventEmitter, NativeModules} from 'react-native';

import {
  HITCH_RX_CHAR_UUID,
  HITCH_SERVICE_UUID,
  HITCH_TX_CHAR_UUID,
} from './advertisement';
import {
  decodeMessage,
  encodeMessage,
  fitsOneFrame,
  newRequestId,
  type RideAcceptMessage,
  type RideMessage,
  type RideRequestMessage,
} from './protocol';

/**
 * Phase 3: a ride request that actually crosses between two phones.
 *
 * Until now the passenger asked and the app answered itself. This carries the ask over a
 * real GATT connection to a real rider, whose phone shows a card, and whose tap on Accept
 * or Decline comes back over the same link. The passenger's match is now somebody's
 * decision rather than a local state transition.
 *
 * AGAIN, NO NEW BLUETOOTH. Both halves use native modules already in this repo, both of
 * which take the service UUIDs as parameters — so Hitch drives them with its own UUIDs and
 * nothing about BLE Chat changes:
 *
 *   passenger (central)   NativeModules.BleClient   connect / write / bleClientData
 *   rider (peripheral)    NativeModules.BlePeripheral   BlePeripheral:data / send
 *
 * The central module is the one BLE Chat wrote after ble-plx's write path proved unusable
 * on Android — it calls the API-33 overload that returns a real status. Reusing it means
 * the single hardest bug of that project does not have to be found again here.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. There is no encryption on this link and no identity
 * proof. A ride request contains two place names and a fare; the passenger's phone number
 * is not in it, and neither is the rider's. Adding a handshake would mean reimplementing
 * BLE Chat's key exchange, and doing that badly here would be worse than not claiming it —
 * so the app claims nothing, and `isTrusted` is absent rather than false.
 */

const TAG = '[RideLink]';

/** A request that goes unanswered is a rider who did not look at their phone. */
const REPLY_TIMEOUT_MS = 30_000;
/** Connecting to a phone that has walked away should not hang the UI. */
const CONNECT_TIMEOUT_MS = 12_000;

interface BleClientNative {
  connect(
    address: string,
    serviceUuid: string,
    rxUuid: string,
    txUuid: string,
  ): Promise<{address: string; mtu: number}>;
  disconnect(address: string): Promise<boolean>;
  write(address: string, base64: string, withResponse: boolean): Promise<boolean>;
}

interface PeripheralNative {
  send(centralId: string, base64Data: string): Promise<boolean>;
}

const client: BleClientNative | undefined = (
  NativeModules as {BleClient?: BleClientNative}
).BleClient;

const peripheral: PeripheralNative | undefined = (
  NativeModules as {BlePeripheral?: PeripheralNative}
).BlePeripheral;

export const canSendRequests = !!client;
export const canReceiveRequests = !!peripheral;

// ------------------------------------------------------------ passenger side

/**
 * A link kept open after a request was accepted.
 *
 * The request flow used to tear the connection down on every path, success included —
 * which is correct for a refusal and wrong for an acceptance, because the two people are
 * now going to want to talk. Handing the live link back is what lets the ride chat exist
 * at all; without it every message queues against a link that was already closed.
 *
 * The owner is responsible for closing it when the ride ends. A GATT connection left open
 * holds one of the handful of slots the radio has.
 */
export interface OpenRideLink {
  send: (base64: string) => Promise<boolean>;
  /** Frames from the other phone. Returns an unsubscribe. */
  onFrame: (handler: (base64: string) => void) => () => void;
  close: () => void;
}

export type RequestOutcome =
  | {status: 'accepted'; accept: RideAcceptMessage; link: OpenRideLink}
  | {status: 'declined'; why?: string}
  | {status: 'unreachable'; reason: string}
  | {status: 'timeout'};

/**
 * Ask one rider, and wait for a person to answer.
 *
 * The timeout is thirty seconds because the thing being waited on is a human being
 * noticing their phone, not a network round trip. Failing faster would report "no answer"
 * while the rider is still reaching into their pocket.
 *
 * The link is always torn down, on every path. A GATT connection left open holds one of
 * the handful of slots the radio has, and a passenger who asked three riders in a row
 * would otherwise exhaust the adapter and be unable to reach the fourth.
 */
export async function sendRideRequest(
  address: string,
  request: Omit<RideRequestMessage, 't' | 'v' | 'id'>,
): Promise<RequestOutcome> {
  if (!client) {
    return {status: 'unreachable', reason: 'This build cannot open a Bluetooth link.'};
  }

  const id = newRequestId();
  const frame = encodeMessage({...request, t: 'REQUEST', v: 1, id});
  if (!fitsOneFrame(frame)) {
    // Should be impossible: every field is capped on encode. If it ever happens, saying
    // so beats writing a truncated frame the other side cannot parse.
    return {status: 'unreachable', reason: 'The request was too large to send.'};
  }

  const emitter = new NativeEventEmitter(
    NativeModules.BleClient as ConstructorParameters<typeof NativeEventEmitter>[0],
  );

  return new Promise<RequestOutcome>(resolve => {
    let settled = false;
    /**
     * Torn down on every outcome EXCEPT an acceptance.
     *
     * A refusal, a timeout or an unreachable phone should give the slot back immediately.
     * An acceptance should not: the link becomes the ride's chat channel, and reopening it
     * a second later would be a second connection to a phone we are already talking to.
     */
    const finish = (outcome: RequestOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (outcome.status !== 'accepted') {
        subscription.remove();
        void client.disconnect(address).catch(() => undefined);
      }
      resolve(outcome);
    };

    const subscription = emitter.addListener(
      'bleClientData',
      (event: {address: string; base64: string}) => {
        if (event.address !== address) {
          return;
        }
        const message = decodeMessage(event.base64);
        // Anything that is not the answer to THIS request is ignored rather than treated
        // as one — a stale reply from a previous ask would otherwise match.
        if (!message || message.id !== id) {
          return;
        }
        if (message.t === 'ACCEPT') {
          // The request subscription stops here; the chat installs its own on the same
          // emitter, so frames are not delivered to two owners at once.
          subscription.remove();
          finish({
            status: 'accepted',
            accept: message,
            link: openLink(emitter, address, client),
          });
        } else if (message.t === 'DECLINE') {
          finish({status: 'declined', why: message.why});
        }
      },
    );

    const timer = setTimeout(() => finish({status: 'timeout'}), REPLY_TIMEOUT_MS);

    const connectTimer = setTimeout(() => {
      finish({status: 'unreachable', reason: 'They did not answer the connection.'});
    }, CONNECT_TIMEOUT_MS);

    void client
      .connect(address, HITCH_SERVICE_UUID, HITCH_RX_CHAR_UUID, HITCH_TX_CHAR_UUID)
      .then(() => {
        clearTimeout(connectTimer);
        return client.write(address, frame, true);
      })
      .catch((err: unknown) => {
        clearTimeout(connectTimer);
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(TAG, 'could not reach rider:', reason);
        finish({status: 'unreachable', reason});
      });
  });
}

/** Wraps an already-connected address as a link the chat can hold. */
function openLink(
  emitter: NativeEventEmitter,
  address: string,
  native: BleClientNative,
): OpenRideLink {
  return {
    send: async (base64: string) => {
      try {
        await native.write(address, base64, true);
        return true;
      } catch (err) {
        console.warn(TAG, 'chat write failed:', String(err));
        return false;
      }
    },
    onFrame: handler => {
      const sub = emitter.addListener(
        'bleClientData',
        (event: {address: string; base64: string}) => {
          if (event.address === address) {
            handler(event.base64);
          }
        },
      );
      return () => sub.remove();
    },
    close: () => {
      void native.disconnect(address).catch(() => undefined);
    },
  };
}

/**
 * The rider's side of the same link.
 *
 * A rider never dials: the passenger connected to them, so the peripheral already has a
 * central to answer. This wraps that central id as the same shape the passenger's side
 * hands back, so one RideChat works identically on both phones.
 */
export function riderLink(centralId: string): OpenRideLink {
  return {
    send: async (base64: string) => {
      if (!peripheral) {
        return false;
      }
      try {
        await peripheral.send(centralId, base64);
        return true;
      } catch (err) {
        console.warn(TAG, 'chat reply failed:', String(err));
        return false;
      }
    },
    onFrame: handler => {
      if (!peripheral) {
        return () => undefined;
      }
      const emitter = new NativeEventEmitter(
        NativeModules.BlePeripheral as ConstructorParameters<typeof NativeEventEmitter>[0],
      );
      const sub = emitter.addListener(
        'BlePeripheral:data',
        (event: {centralId: string; data: string}) => {
          if (event.centralId === centralId) {
            handler(event.data);
          }
        },
      );
      return () => sub.remove();
    },
    // The passenger owns the connection; a rider hanging up would drop their own ride.
    close: () => undefined,
  };
}

// ---------------------------------------------------------------- rider side

export interface IncomingRequest {
  /** The central that asked, needed to answer them. */
  centralId: string;
  request: RideRequestMessage;
  at: number;
}

/**
 * Listen for requests while online.
 *
 * The peripheral module is already advertising by the time this is called — going online
 * starts it — so this only attaches to the data event it was already emitting. Returns an
 * unsubscribe, because a rider going offline must stop being asked.
 */
export function listenForRequests(
  onRequest: (incoming: IncomingRequest) => void,
): () => void {
  if (!peripheral) {
    return () => undefined;
  }
  const emitter = new NativeEventEmitter(
    NativeModules.BlePeripheral as ConstructorParameters<typeof NativeEventEmitter>[0],
  );
  const subscription = emitter.addListener(
    'BlePeripheral:data',
    (event: {centralId: string; data: string}) => {
      const message = decodeMessage(event.data);
      if (!message || message.t !== 'REQUEST') {
        return;
      }
      onRequest({centralId: event.centralId, request: message, at: Date.now()});
    },
  );
  return () => subscription.remove();
}

/** Answer a request. The passenger is holding a spinner until this arrives. */
export async function respondToRequest(
  centralId: string,
  message: RideMessage,
): Promise<boolean> {
  if (!peripheral) {
    return false;
  }
  try {
    await peripheral.send(centralId, encodeMessage(message));
    return true;
  } catch (err) {
    console.warn(TAG, 'could not answer:', String(err));
    return false;
  }
}
