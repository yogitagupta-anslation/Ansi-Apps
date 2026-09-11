/**
 * The Connection Space's conversation layer.
 *
 * Nothing is mocked that matters: a real `LocalDatabase` over a real
 * `MemoryStorageAdapter`, the real `ChatProtocol` codec, the real dedup and
 * persistence. The only stand-in is the session manager, because the alternative
 * is a radio.
 *
 * The invariant these tests exist to defend is the identity one. A conversation
 * is keyed by the stable `profileId`; `peerId` rotates on an epoch and
 * `deviceId` changes with the link. If either ever became the key, history would
 * fork exactly when someone went to look at it.
 */

import {
  ConversationService,
  canOpenChat,
  type ConversationMessage,
} from '../connections/ConversationService';
import { decodeChatMessage, encodeChatMessage } from '../connections/ChatProtocol';
import { GattMessageType, type GattMessage } from '../bluetooth/gatt/GattMessage';
import type { GattSessionManager } from '../bluetooth/gatt/GattSessionManager';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import type { ConnectionState, EventId, ProfileId } from '../types';

const EVENT: EventId = 'evt-chat';
const ADA: ProfileId = 'ep_ADA';
const GRACE: ProfileId = 'ep_GRACE';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface Sent {
  deviceId: string;
  type: number;
  payload: Uint8Array;
}

function makeHarness(options: { device?: string | null } = {}) {
  const adapter = new MemoryStorageAdapter();
  const db = new LocalDatabase(adapter);

  const sent: Sent[] = [];
  let inbound: ((deviceId: string, message: GattMessage) => void) | null = null;
  let failNextSend = false;

  /** Only the two members ConversationService actually touches. */
  const sessions = {
    subscribe: (events: { onMessage?: (deviceId: string, message: GattMessage) => void }) => {
      inbound = events.onMessage ?? null;
      return () => {
        inbound = null;
      };
    },
    send: async (deviceId: string, type: number, payload?: Uint8Array) => {
      if (failNextSend) {
        failNextSend = false;
        throw new Error('write_failed');
      }
      sent.push({ deviceId, type, payload: payload ?? new Uint8Array() });
      return 1;
    },
  } as unknown as GattSessionManager;

  /** Which link a person is on. Deliberately mutable: links come and go. */
  let deviceFor: string | null = options.device === undefined ? 'c:AA:BB' : options.device;
  const deviceOwners = new Map<string, ProfileId>([['c:AA:BB', ADA]]);

  let clock = 1_000;
  let sequence = 0;

  const service = new ConversationService({
    db,
    sessions,
    now: () => (clock += 1),
    newMessageId: () => `m${(sequence += 1)}`,
    deviceFor: () => deviceFor,
    profileForDevice: (deviceId) => deviceOwners.get(deviceId) ?? null,
  });

  service.start(EVENT);

  return {
    service,
    db,
    adapter,
    sent,
    deviceOwners,
    setDevice: (value: string | null) => {
      deviceFor = value;
    },
    failNextSend: () => {
      failNextSend = true;
    },
    /** Deliver a chat message as if it arrived over the radio. */
    deliver: (deviceId: string, payload: Uint8Array, type: number = GattMessageType.ChatMessage) => {
      inbound?.(deviceId, {
        version: 1,
        flags: 0,
        type,
        messageId: 1,
        payload,
      } as GattMessage);
    },
  };
}

/** Let the service's internal awaits settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------ *
 * 1 + 2. Who gets a Chat action
 * ------------------------------------------------------------------ */

describe('canOpenChat', () => {
  it('allows a connected person', () => {
    expect(canOpenChat('connected')).toBe(true);
  });

  it.each<ConnectionState>([
    'none',
    'outgoing_pending',
    'incoming_pending',
    'declined',
    'cancelled',
    'expired',
    'failed',
  ])('refuses %s', (state) => {
    // Every one of these is either "not yet" or "no". Offering to message
    // someone who never agreed is the thing this prevents.
    expect(canOpenChat(state)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The right conversation opens
 * ------------------------------------------------------------------ */

describe('conversation identity', () => {
  it('keeps two people apart', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'hello Ada');

    expect(h.service.messages(ADA)).toHaveLength(1);
    expect(h.service.messages(GRACE)).toHaveLength(0);
  });

  it('persists under the stable profileId, not a transport handle', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'hello');

    const stored = await h.db.get<ConversationMessage[]>(keys.conversation(EVENT, ADA));
    expect(stored).toHaveLength(1);

    // The keys table must never grow a row named after a rotating id.
    const allKeys = await h.adapter.getAllKeys();
    expect(allKeys.some((key) => key.includes('c:AA:BB'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 4 + 5. Sending
 * ------------------------------------------------------------------ */

describe('sending', () => {
  it('creates the outgoing message locally', async () => {
    const h = makeHarness();
    const message = await h.service.send(ADA, '  hi there  ');

    expect(message).toMatchObject({ mine: true, text: 'hi there', status: 'sent' });
    expect(h.service.messages(ADA)).toHaveLength(1);
  });

  it('goes out through the session manager as a chat message', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'over the air');

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].deviceId).toBe('c:AA:BB');
    expect(h.sent[0].type).toBe(GattMessageType.ChatMessage);

    // And the payload is really our protocol, not a coincidence.
    expect(decodeChatMessage(h.sent[0].payload)?.text).toBe('over the air');
  });

  it('marks a message failed when the transport refuses it', async () => {
    // The rule the whole layer exists to keep: never claim a delivery that did
    // not happen.
    const h = makeHarness();
    h.failNextSend();
    const message = await h.service.send(ADA, 'this will not go');

    expect(message.status).toBe('failed');
    expect(h.service.messages(ADA)[0].status).toBe('failed');
  });

  it('marks a message failed when there is no link at all', async () => {
    const h = makeHarness({ device: null });
    const message = await h.service.send(ADA, 'nobody there');

    expect(message.status).toBe('failed');
    expect(h.sent).toHaveLength(0);
  });

  it('keeps the id on retry so the far side still dedupes it', async () => {
    const h = makeHarness();
    h.failNextSend();
    const failed = await h.service.send(ADA, 'again');

    const retried = await h.service.retry(ADA, failed.id);

    expect(retried?.id).toBe(failed.id);
    expect(retried?.status).toBe('sent');
    expect(h.service.messages(ADA)).toHaveLength(1);
  });

  it('refuses an empty message', async () => {
    const h = makeHarness();
    await expect(h.service.send(ADA, '   ')).rejects.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * 6. Receiving
 * ------------------------------------------------------------------ */

describe('receiving', () => {
  it('shows an incoming message in the conversation', async () => {
    const h = makeHarness();
    h.deliver(
      'c:AA:BB',
      encodeChatMessage({ messageId: 'theirs-1', text: 'hello from Ada', sentAt: 5 }),
    );
    await flush();

    const messages = h.service.messages(ADA);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ mine: false, text: 'hello from Ada', status: 'received' });
  });

  it('publishes to subscribers without a refresh', async () => {
    // This is what makes a message appear while the screen is open.
    const h = makeHarness();
    const seen: ConversationMessage[][] = [];
    h.service.subscribe((profileId, messages) => {
      if (profileId === ADA) seen.push(messages);
    });

    h.deliver('c:AA:BB', encodeChatMessage({ messageId: 't1', text: 'ping', sentAt: 5 }));
    await flush();

    expect(seen.at(-1)).toHaveLength(1);
  });

  it('ignores a redelivered message', async () => {
    const h = makeHarness();
    const payload = encodeChatMessage({ messageId: 'dup', text: 'once', sentAt: 5 });

    h.deliver('c:AA:BB', payload);
    await flush();
    h.deliver('c:AA:BB', payload);
    await flush();

    expect(h.service.messages(ADA)).toHaveLength(1);
  });

  it('ignores a message on a link it cannot attribute to a person', async () => {
    // Filing it under a device id would create a conversation no screen can open.
    const h = makeHarness();
    h.deliver('c:UNKNOWN', encodeChatMessage({ messageId: 'x', text: 'who?', sentAt: 5 }));
    await flush();

    expect(h.service.messages(ADA)).toHaveLength(0);
  });

  it('ignores a malformed payload without disturbing the link', async () => {
    const h = makeHarness();
    h.deliver('c:AA:BB', new Uint8Array([0xff, 0x00, 0xff]));
    await flush();

    expect(h.service.messages(ADA)).toHaveLength(0);
  });

  it('ignores message types that are not chat', async () => {
    // The coordinator's request/accept traffic shares these links.
    const h = makeHarness();
    h.deliver(
      'c:AA:BB',
      encodeChatMessage({ messageId: 'not-chat', text: 'hi', sentAt: 5 }),
      GattMessageType.ConnectionRequest,
    );
    await flush();

    expect(h.service.messages(ADA)).toHaveLength(0);
  });

  it('stamps arrival with this phone s clock, not the sender s', async () => {
    // A wrong clock on the far side must not be able to file a message in the
    // middle of yesterday's history.
    const h = makeHarness();
    h.deliver(
      'c:AA:BB',
      encodeChatMessage({ messageId: 't', text: 'from the future', sentAt: 9_999_999_999 }),
    );
    await flush();

    expect(h.service.messages(ADA)[0].at).toBeLessThan(10_000);
  });
});

/* ------------------------------------------------------------------ *
 * 7. History survives
 * ------------------------------------------------------------------ */

describe('history', () => {
  it('is still there after a restart', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'remember this');

    // A new service over the same storage is what a relaunch looks like.
    const second = new ConversationService({
      db: new LocalDatabase(h.adapter),
      sessions: { subscribe: () => () => undefined, send: async () => 1 } as unknown as GattSessionManager,
      now: () => 1,
      newMessageId: () => 'x',
      deviceFor: () => null,
      profileForDevice: () => null,
    });
    second.start(EVENT);

    const restored = await second.load(ADA);
    expect(restored).toHaveLength(1);
    expect(restored[0].text).toBe('remember this');
  });

  it('keeps both sides of the conversation in order', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'mine');
    h.deliver('c:AA:BB', encodeChatMessage({ messageId: 't', text: 'theirs', sentAt: 5 }));
    await flush();

    expect(h.service.messages(ADA).map((m) => m.text)).toEqual(['mine', 'theirs']);
  });
});

/* ------------------------------------------------------------------ *
 * 8. A rotating peer id must not fork a conversation
 * ------------------------------------------------------------------ */

describe('rotating identity', () => {
  it('keeps one conversation when the device id changes underneath', async () => {
    /*
     * The epoch rotates, the far side re-advertises, and the radio hands us a
     * different address for the same person. Everything must land in the same
     * conversation, because it is the same person.
     */
    const h = makeHarness();
    await h.service.send(ADA, 'before the rotation');

    // New link, same person.
    h.deviceOwners.set('c:ZZ:99', ADA);
    h.setDevice('c:ZZ:99');

    h.deliver('c:ZZ:99', encodeChatMessage({ messageId: 'after', text: 'after', sentAt: 5 }));
    await flush();
    await h.service.send(ADA, 'and again');

    expect(h.service.messages(ADA).map((m) => m.text)).toEqual([
      'before the rotation',
      'after',
      'and again',
    ]);

    // One row on disk, not three.
    const allKeys = await h.adapter.getAllKeys();
    const chatKeys = allKeys.filter((key) => key.includes(':chat:'));
    expect(chatKeys).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 9. A dropped link is not a deleted conversation
 * ------------------------------------------------------------------ */

describe('disconnection', () => {
  it('keeps history when the link goes away', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'said before the drop');

    h.setDevice(null); // the link is gone

    expect(h.service.messages(ADA)).toHaveLength(1);
    const stored = await h.db.get<ConversationMessage[]>(keys.conversation(EVENT, ADA));
    expect(stored).toHaveLength(1);
  });

  it('records a new message as failed rather than losing it', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'first');
    h.setDevice(null);

    await h.service.send(ADA, 'sent into a dead link');

    const messages = h.service.messages(ADA);
    expect(messages).toHaveLength(2);
    expect(messages[1].status).toBe('failed');
    expect(messages[1].text).toBe('sent into a dead link');
  });
});

/* ------------------------------------------------------------------ *
 * 10. Nothing leaves the phone except over the radio
 * ------------------------------------------------------------------ */

describe('offline-first', () => {
  it('sends and receives without any network call', async () => {
    /*
     * The eventpulse Jest project runs on bare node with no react-native and no
     * mocks, so a `fetch` here would be the real one. Replacing it with a
     * throwing stub turns any accidental network call into a failed test rather
     * than a silent dependency.
     */
    const globals = globalThis as { fetch?: unknown };
    const original = globals.fetch;
    globals.fetch = () => {
      throw new Error('ConversationService must never reach the network');
    };

    try {
      const h = makeHarness();
      await h.service.send(ADA, 'strictly local');
      h.deliver('c:AA:BB', encodeChatMessage({ messageId: 't', text: 'also local', sentAt: 5 }));
      await flush();

      expect(h.service.messages(ADA)).toHaveLength(2);
    } finally {
      globals.fetch = original;
    }
  });

  it('stores the conversation on this device only', async () => {
    const h = makeHarness();
    await h.service.send(ADA, 'private');

    const allKeys = await h.adapter.getAllKeys();
    expect(allKeys).toContain(`eventpulse:${keys.conversation(EVENT, ADA)}`);
  });
});

/* ------------------------------------------------------------------ *
 * A schema bump must not delete a conversation
 * ------------------------------------------------------------------ */

describe('surviving a database migration', () => {
  it('keeps conversations, identity and the blocklist when the schema version changes', async () => {
    /*
     * `migrate()` drops every row on a version bump, on the reasoning that
     * everything in this store is a cache a sync can rebuild. Conversations
     * broke that assumption: they exist only on the two phones that had them,
     * and nothing anywhere can refetch one.
     */
    const adapter = new MemoryStorageAdapter();
    const db = new LocalDatabase(adapter);
    await db.open();

    await db.set(keys.conversation(EVENT, ADA), [{ id: 'm1', mine: true, text: 'keep me', at: 1, status: 'sent' }]);
    await db.set(keys.localProfileId, 'ep_STABLE');
    await db.set(keys.blocklist, [{ profileId: 'ep_RUDE', blockedAt: 1 }]);
    // A genuine cache, which SHOULD be dropped.
    await db.set(keys.directory(EVENT), [{ profileId: 'ep_X' }]);

    // A relaunch after a schema bump.
    await adapter.setItem('eventpulse:meta:version', '999');
    const reopened = new LocalDatabase(adapter);
    await reopened.open();

    expect(await reopened.get(keys.conversation(EVENT, ADA))).toHaveLength(1);
    expect(await reopened.get(keys.localProfileId)).toBe('ep_STABLE');
    expect(await reopened.get(keys.blocklist)).toHaveLength(1);
    // The cache is gone, as intended.
    expect(await reopened.get(keys.directory(EVENT))).toBeNull();
  });
});
