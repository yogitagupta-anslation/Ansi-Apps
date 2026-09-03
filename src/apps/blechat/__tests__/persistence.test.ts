/**
 * What survives being killed.
 *
 * A chat app that silently loses your queued messages, your block list or your identity
 * when the process is killed has failed at something users notice immediately and cannot
 * work around. Nothing was covering that before this file existed.
 *
 * The restart is real rather than implied: `restart()` drops the module registry, so the
 * storage singleton, its in-memory caches and every derived object are rebuilt from
 * nothing. Only the AsyncStorage contents survive — which is exactly what a phone does
 * when the app is swiped away and reopened.
 */
import type {AppSettings, KnownPeer} from '../storage/LocalStorage';
import type {QueuedMessage} from '../messaging/MessageQueue';
import type {ChatMessage} from '../types/Message';
import {PROTOCOL_VERSION} from '../config/constants';

type StorageModule = typeof import('../storage/LocalStorage');

/** The device's storage, which outlives the JS instance. */
function deviceStore(): Map<string, string> {
  return (globalThis as unknown as {__asyncStorageStore: Map<string, string>})
    .__asyncStorageStore;
}

/**
 * Simulate the app being killed and reopened.
 *
 * resetModules() is the load-bearing call: without it the same singleton — including its
 * cached at-rest encryption key — would answer the second half of every test, and the
 * test would prove only that a Map still holds what was put in it.
 */
function restart(): StorageModule {
  jest.resetModules();
  return require('../storage/LocalStorage') as StorageModule;
}

function freshBoot(): StorageModule {
  deviceStore().clear();
  return restart();
}

function message(id: string, text: string, from: string): ChatMessage {
  const outgoing = from === 'peer-local';
  return {
    id,
    conversationId: 'peer-remote',
    originId: from,
    senderId: from,
    destinationId: outgoing ? 'peer-remote' : 'peer-local',
    text,
    timestamp: 1_000,
    receivedAt: 1_000,
    direction: outgoing ? 'outgoing' : 'incoming',
    status: 'received',
    protocolVersion: PROTOCOL_VERSION,
    ttl: 1,
    hopCount: 0,
    retryCount: 0,
  };
}

function queued(messageId: string, text: string): QueuedMessage {
  return {messageId, peerId: 'peer-remote', text, queuedAt: 1_000, attempts: 0};
}

describe('identity survives a restart', () => {
  it('keeps the same peerId and keypair, so peers still recognise this phone', async () => {
    const first = freshBoot();
    const before = await first.storage.loadOrCreateIdentity('Phone A');
    expect(before.peerId).toHaveLength(32);

    const after = await restart().storage.loadOrCreateIdentity('Phone A');

    // A regenerated identity would silently orphan every conversation and every trust
    // decision every other phone has recorded about this one.
    expect(after.peerId).toBe(before.peerId);
    expect(after.publicKey).toBe(before.publicKey);
    expect(after.privateKey).toBe(before.privateKey);
  });

  it('does not invent a second identity when reopened repeatedly', async () => {
    const first = freshBoot();
    const original = await first.storage.loadOrCreateIdentity('Phone A');
    for (let i = 0; i < 5; i++) {
      const again = await restart().storage.loadOrCreateIdentity('Phone A');
      expect(again.peerId).toBe(original.peerId);
    }
  });

  it('keeps the keypair when the name is empty — the identity IS the key', async () => {
    const first = freshBoot();
    const created = await first.storage.loadOrCreateIdentity('Yuvraj');

    // Simulate an identity stored with no name — however it got that way.
    await first.storage.saveIdentity({...created, displayName: ''});

    const reloaded = await restart().storage.loadOrCreateIdentity('');

    // Regenerating here would mint a NEW peerId: every conversation orphaned, every
    // verification on the other phone voided, and to that phone it would look like a
    // stranger had taken over the name. A display name is a label, not an identity.
    expect(reloaded.peerId).toBe(created.peerId);
    expect(reloaded.privateKey).toBe(created.privateKey);
    expect(reloaded.displayName).toBe('');
  });

  it('never invents a Phone-NNN placeholder name', async () => {
    const first = freshBoot();
    const created = await first.storage.loadOrCreateIdentity('');

    // A generated name the user never chose leaks: into settings, onto the air, and
    // into the known-peers list of every phone that met this one, where it sticks.
    expect(created.displayName).toBe('');
    expect(created.displayName).not.toMatch(/Phone-\d+/);

    const stored = deviceStore().get('@blechat/identity') ?? '';
    expect(stored).not.toMatch(/Phone-\d+/);
  });

  it('still regenerates an identity that genuinely has no keypair', async () => {
    freshBoot();
    // What a pre-authentication build left behind: an id, but nothing to prove it.
    deviceStore().set(
      '@blechat/identity',
      JSON.stringify({peerId: 'old-style-id', displayName: 'Yuvraj'}),
    );

    const reloaded = await restart().storage.loadOrCreateIdentity('Yuvraj');
    // Unprovable, so it must not be kept — this is the case the check exists for.
    expect(reloaded.peerId).not.toBe('old-style-id');
    expect(reloaded.privateKey).toBeTruthy();
  });

  it('creates an identity on genuine first launch', async () => {
    const a = await freshBoot().storage.loadOrCreateIdentity('Phone A');
    const b = await freshBoot().storage.loadOrCreateIdentity('Phone A');
    // Two separate installations must not collide.
    expect(a.peerId).not.toBe(b.peerId);
  });
});

describe('the outbox survives a restart', () => {
  const outbox: QueuedMessage[] = [
    queued('q1', 'first while you were away'),
    queued('q2', 'second while you were away'),
  ];

  it('still holds messages composed while the peer was unreachable', async () => {
    const first = freshBoot();
    await first.storage.saveOutbox(outbox);

    const restored = await restart().storage.loadOutbox();

    // These were never sent. Losing them on a restart would mean the user believes a
    // message is waiting to deliver when nothing is.
    expect(restored).toHaveLength(2);
    expect(restored.map(m => m.text)).toEqual([
      'first while you were away',
      'second while you were away',
    ]);
  });

  it('keeps queue order across the restart', async () => {
    const first = freshBoot();
    await first.storage.saveOutbox(outbox);
    const restored = await restart().storage.loadOutbox();
    expect(restored.map(m => m.messageId)).toEqual(['q1', 'q2']);
  });

  it('is encrypted on disk, not readable from the stored value', async () => {
    const first = freshBoot();
    await first.storage.saveOutbox(outbox);

    const raw = Array.from(deviceStore().values()).join('');
    expect(raw).not.toContain('first while you were away');
    expect(raw).not.toContain('peer-remote');

    // ...and the new instance can still read it, so the key survived too.
    expect(await restart().storage.loadOutbox()).toHaveLength(2);
  });

  it('comes back empty rather than throwing when nothing was queued', async () => {
    freshBoot();
    expect(await restart().storage.loadOutbox()).toEqual([]);
  });
});

describe('conversations survive a restart', () => {
  it('restores message history for a conversation', async () => {
    const first = freshBoot();
    await first.storage.saveMessages('peer-remote', [
      message('m1', 'hello', 'peer-remote'),
      message('m2', 'hi back', 'peer-local'),
    ]);

    const restored = await restart().storage.loadMessages('peer-remote');
    expect(restored.map(m => m.text)).toEqual(['hello', 'hi back']);
  });

  it('restores the conversation list, so the Chats tab is not empty on reopen', async () => {
    const first = freshBoot();
    await first.storage.saveMessages('peer-one', [message('m1', 'a', 'peer-one')]);
    await first.storage.saveMessages('peer-two', [message('m2', 'b', 'peer-two')]);

    const ids = await restart().storage.loadConversationIds();
    expect(ids.sort()).toEqual(['peer-one', 'peer-two']);
  });

  it('keeps conversations separate across the restart', async () => {
    const first = freshBoot();
    await first.storage.saveMessages('peer-one', [message('m1', 'for one', 'peer-one')]);
    await first.storage.saveMessages('peer-two', [message('m2', 'for two', 'peer-two')]);

    const reopened = restart();
    expect((await reopened.storage.loadMessages('peer-one'))[0].text).toBe('for one');
    expect((await reopened.storage.loadMessages('peer-two'))[0].text).toBe('for two');
  });

  it('stores message text encrypted', async () => {
    const first = freshBoot();
    await first.storage.saveMessages('peer-remote', [
      message('m1', 'the codeword is albatross', 'peer-remote'),
    ]);
    const raw = Array.from(deviceStore().values()).join('');
    expect(raw).not.toContain('albatross');
  });

  it('clearing history really removes it, and it stays gone after a restart', async () => {
    const first = freshBoot();
    await first.storage.saveMessages('peer-remote', [message('m1', 'delete me', 'x')]);
    await first.storage.clearMessages();

    const reopened = restart();
    expect(await reopened.storage.loadMessages('peer-remote')).toEqual([]);
    expect(await reopened.storage.loadConversationIds()).toEqual([]);
  });
});

describe('blocked peers survive a restart', () => {
  it('a peer blocked before the kill is still blocked after it', async () => {
    const first = freshBoot();
    await first.storage.saveBlockedPeers(['peer-abusive', 'peer-other']);

    const restored = await restart().storage.loadBlockedPeers();

    // The one persistence failure with a safety consequence: someone the user blocked
    // silently becoming connectable again after a restart.
    expect(restored).toContain('peer-abusive');
    expect(restored).toHaveLength(2);
  });

  it('unblocking also survives, so an unblock is not undone by a restart', async () => {
    const first = freshBoot();
    await first.storage.saveBlockedPeers(['peer-abusive']);
    await restart().storage.saveBlockedPeers([]);
    expect(await restart().storage.loadBlockedPeers()).toEqual([]);
  });
});

describe('trust and preferences survive a restart', () => {
  it('keeps verified peers, so a safety-number check is done once', async () => {
    const first = freshBoot();
    await first.storage.saveVerifiedPeers(['peer-verified']);
    expect(await restart().storage.loadVerifiedPeers()).toEqual(['peer-verified']);
  });

  it('keeps favourites', async () => {
    const first = freshBoot();
    await first.storage.saveFavoritePeers(['peer-fav']);
    expect(await restart().storage.loadFavoritePeers()).toEqual(['peer-fav']);
  });

  it('keeps the app lock PIN, so the lock is not bypassed by a restart', async () => {
    const first = freshBoot();
    await first.storage.saveAppLockPin('hash-of-pin');

    const lock = await restart().storage.loadAppLock();
    expect(lock.enabled).toBe(true);
    expect(lock.pinHash).toBe('hash-of-pin');
  });

  it('keeps the lock cleared once it is turned off', async () => {
    const first = freshBoot();
    await first.storage.saveAppLockPin('hash-of-pin');
    await restart().storage.clearAppLock();
    expect((await restart().storage.loadAppLock()).enabled).toBe(false);
  });

  it('keeps settings, including the profile-complete gate', async () => {
    const first = freshBoot();
    const settings: AppSettings = {
      ...first.DEFAULT_SETTINGS,
      displayName: 'Yuvraj',
      interests: ['Coding', 'Gym'],
      profileComplete: true,
      themeMode: 'dark',
      maxConnections: 4,
    };
    await first.storage.saveSettings(settings);

    const restored = await restart().storage.loadSettings();
    // profileComplete false after a restart would throw the user back to the signup gate.
    expect(restored.profileComplete).toBe(true);
    expect(restored.displayName).toBe('Yuvraj');
    expect(restored.interests).toEqual(['Coding', 'Gym']);
    expect(restored.themeMode).toBe('dark');
    expect(restored.maxConnections).toBe(4);
  });
});

describe('peer and group history survives a restart', () => {
  it('remembers peers met before, so Nearby is not blank on reopen', async () => {
    const first = freshBoot();
    const peer: KnownPeer = {
      peerId: 'peer-remote',
      displayName: 'Jaismeet',
      lastSeen: 5_000,
      interests: ['Music'],
    };
    await first.storage.rememberPeer(peer);

    const known = await restart().storage.loadKnownPeers();
    expect(known).toHaveLength(1);
    expect(known[0].displayName).toBe('Jaismeet');
    expect(known[0].interests).toEqual(['Music']);
  });

  it('keeps connection history, so "times connected" is not reset by a restart', async () => {
    const first = freshBoot();
    await first.storage.rememberPeer({
      peerId: 'peer-remote',
      displayName: 'Jaismeet',
      lastSeen: 9_000,
      connectCount: 12,
      firstSeen: 1_000,
      lastConnected: 9_000,
    });

    const known = (await restart().storage.loadKnownPeers())[0];
    // A count that silently restarts at zero every launch reads as history while only
    // describing this session — worse than showing nothing at all.
    expect(known.connectCount).toBe(12);
    expect(known.firstSeen).toBe(1_000);
    expect(known.lastConnected).toBe(9_000);
  });

  it('tolerates a peer stored by a build that had no history fields', async () => {
    const first = freshBoot();
    await first.storage.rememberPeer({
      peerId: 'peer-old',
      displayName: 'Older Build',
      lastSeen: 5_000,
    });
    const known = (await restart().storage.loadKnownPeers())[0];
    expect(known.displayName).toBe('Older Build');
    expect(known.connectCount).toBeUndefined();
  });

  it('keeps groups', async () => {
    const first = freshBoot();
    await first.storage.saveGroups([
      {
        id: 'g1',
        name: 'Team',
        members: ['peer-remote'],
        createdAt: 1_000,
        createdBy: 'peer-remote',
      },
    ]);
    const groups = await restart().storage.loadGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Team');
  });

  it('keeps a left group left, so a stale invite cannot rejoin it', async () => {
    const first = freshBoot();
    await first.storage.saveLeftGroups(['g1']);
    expect(await restart().storage.loadLeftGroups()).toEqual(['g1']);
  });
});

describe('replay protection survives a restart', () => {
  it('keeps the sequence counter, so a reopened app does not reuse numbers', async () => {
    const first = freshBoot();
    await first.storage.saveSequence(42);

    // Reusing sequence numbers after a restart would make our own honest packets look
    // like replays to the peer that still remembers the old ones.
    expect(await restart().storage.loadSequence()).toBe(42);
  });

  it('keeps seen ids, so a captured packet stays recognisable as a duplicate', async () => {
    const first = freshBoot();
    await first.storage.saveSeenIds(['id-1', 'id-2']);
    expect(await restart().storage.loadSeenIds()).toEqual(['id-1', 'id-2']);
  });

  it('keeps the replay window', async () => {
    const first = freshBoot();
    await first.storage.saveReplayWindow({'peer-remote': 17});
    expect(await restart().storage.loadReplayWindow()).toEqual({'peer-remote': 17});
  });
});

describe('a full session restored in one go', () => {
  it('brings back identity, chat, queue, blocks and settings together', async () => {
    const first = freshBoot();
    const identity = await first.storage.loadOrCreateIdentity('Phone A');
    await first.storage.saveSettings({
      ...first.DEFAULT_SETTINGS,
      displayName: 'Yuvraj',
      profileComplete: true,
    });
    await first.storage.saveMessages('peer-remote', [
      message('m1', 'see you tomorrow', 'peer-remote'),
    ]);
    await first.storage.saveOutbox([queued('q1', 'unsent')]);
    await first.storage.saveBlockedPeers(['peer-abusive']);
    await first.storage.rememberPeer({
      peerId: 'peer-remote',
      displayName: 'Jaismeet',
      lastSeen: 5_000,
    });

    // One restart, everything checked against it — the state a user actually returns to.
    const reopened = restart();
    expect((await reopened.storage.loadOrCreateIdentity('Phone A')).peerId).toBe(
      identity.peerId,
    );
    expect((await reopened.storage.loadSettings()).displayName).toBe('Yuvraj');
    expect((await reopened.storage.loadMessages('peer-remote'))[0].text).toBe(
      'see you tomorrow',
    );
    expect(await reopened.storage.loadOutbox()).toHaveLength(1);
    expect(await reopened.storage.loadBlockedPeers()).toEqual(['peer-abusive']);
    expect(await reopened.storage.loadKnownPeers()).toHaveLength(1);
  });

  it('survives many restarts in a row without drift', async () => {
    const first = freshBoot();
    await first.storage.saveBlockedPeers(['peer-abusive']);
    await first.storage.saveOutbox([queued('q1', 'still here')]);

    let current = restart();
    for (let i = 0; i < 10; i++) {
      current = restart();
    }
    expect(await current.storage.loadBlockedPeers()).toEqual(['peer-abusive']);
    expect((await current.storage.loadOutbox())[0].text).toBe('still here');
  });
});
