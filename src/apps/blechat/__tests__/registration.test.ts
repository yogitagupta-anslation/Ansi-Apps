/**
 * The path from "fresh install" to "the other phone sees my name".
 *
 * Every other test in this suite builds its stack by hand through VirtualPhone, which
 * skips BleChatService entirely. That left the composition root — where the identity is
 * created, where registration lands, and where the name reaches the handshake — with no
 * coverage at all. It is also exactly where the "Phone-671" bug lived: a generated
 * placeholder that reached the air, and an identity check that threw away the keypair
 * whenever the name was empty.
 *
 * These tests drive the real service, not a rebuild of it.
 */
type ServiceModule = typeof import('../services/BleChatService');
type StorageModule = typeof import('../storage/LocalStorage');

/**
 * Services started during a test. init() starts interval timers (seen-id persistence,
 * link rotation), and leaving them running holds the Jest worker open indefinitely —
 * the run hangs rather than fails, which is a worse way to find out.
 */
const started: ServiceModule[] = [];

afterEach(async () => {
  for (const mod of started.splice(0)) {
    await mod.bleChat.shutdown().catch(() => undefined);
  }
});

function deviceStore(): Map<string, string> {
  return (globalThis as unknown as {__asyncStorageStore: Map<string, string>})
    .__asyncStorageStore;
}

/** A fresh app process: nothing cached in memory, storage as the test left it. */
function boot(): {service: ServiceModule; storage: StorageModule} {
  jest.resetModules();
  const service = require('../services/BleChatService') as ServiceModule;
  started.push(service);
  return {
    service,
    storage: require('../storage/LocalStorage') as StorageModule,
  };
}

function freshInstall(): {service: ServiceModule; storage: StorageModule} {
  deviceStore().clear();
  return boot();
}

describe('first launch, before the user has registered', () => {
  it('creates a real keypair but no invented name', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();

    const identity = service.bleChat.getIdentity();
    expect(identity).not.toBeNull();
    // The identity is the keypair, and it must exist from the start.
    expect(identity!.peerId).toHaveLength(32);
    expect(identity!.privateKey).toBeTruthy();

    // The name is not. A generated one reaches the air and sticks in every peer's
    // known-list, and the user never chose it.
    expect(identity!.displayName).toBe('');
    expect(identity!.displayName).not.toMatch(/Phone-\d+/);
  });

  it('does not consider the profile complete', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();
    // This flag is what gates advertising and scanning. False here means nothing goes
    // on the air under a name the user has not chosen.
    expect(service.bleChat.getSettings().profileComplete).toBe(false);
  });

  it('writes no placeholder into storage either', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();

    const everything = Array.from(deviceStore().values()).join('');
    expect(everything).not.toMatch(/Phone-\d+/);
  });
});

describe('registration', () => {
  it('puts the chosen name on the identity that the handshake will send', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();
    const before = service.bleChat.getIdentity()!.peerId;

    await service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      interests: ['Coding', 'Gym'],
      profileComplete: true,
    });

    const identity = service.bleChat.getIdentity()!;
    // buildHello sends identity.displayName, not settings.displayName. If registration
    // only updated settings, every peer would meet an unnamed stranger.
    expect(identity.displayName).toBe('Yuvraj');
    // And the same person: registering must not mint a new identity.
    expect(identity.peerId).toBe(before);
  });

  it('marks the profile complete, which is what lets the radio start', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();
    await service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      profileComplete: true,
    });
    expect(service.bleChat.getSettings().profileComplete).toBe(true);
  });

  it('survives a restart with the same identity and name', async () => {
    const first = freshInstall();
    await first.service.bleChat.init();
    await first.service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      profileComplete: true,
    });
    const original = first.service.bleChat.getIdentity()!;

    const reopened = boot();
    await reopened.service.bleChat.init();
    const after = reopened.service.bleChat.getIdentity()!;

    // A changed peerId here is the failure that orphans every conversation and voids
    // every verification the other phone recorded.
    expect(after.peerId).toBe(original.peerId);
    expect(after.privateKey).toBe(original.privateKey);
    expect(after.displayName).toBe('Yuvraj');
  });

  it('keeps the identity when the name is later cleared', async () => {
    const first = freshInstall();
    await first.service.bleChat.init();
    await first.service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      profileComplete: true,
    });
    const original = first.service.bleChat.getIdentity()!;

    // However it happens, an empty name must not cost the user their identity.
    await first.storage.storage.saveIdentity({...original, displayName: ''});

    const reopened = boot();
    await reopened.service.bleChat.init();
    expect(reopened.service.bleChat.getIdentity()!.peerId).toBe(original.peerId);
  });

  it('renaming later keeps the same identity', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();
    await service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      profileComplete: true,
    });
    const before = service.bleChat.getIdentity()!.peerId;

    await service.bleChat.updateSettings({displayName: 'YG'});

    const identity = service.bleChat.getIdentity()!;
    expect(identity.displayName).toBe('YG');
    // Changing a label is not changing who you are.
    expect(identity.peerId).toBe(before);
  });
});

describe('what the other phone would receive', () => {
  it('never sees a name the user did not choose', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();
    await service.bleChat.updateSettings({
      displayName: 'Yuvraj',
      profileComplete: true,
    });

    // The exact value buildHello puts in the HELLO payload.
    const sent = service.bleChat.getIdentity()!.displayName;
    expect(sent).toBe('Yuvraj');
    expect(sent).not.toMatch(/Phone-\d+/);
  });

  it('reports a peerId that is a genuine commitment to the public key', async () => {
    const {service} = freshInstall();
    await service.bleChat.init();

    const identity = service.bleChat.getIdentity()!;
    const {peerIdFromPublicKey, publicKeyFromHex} = require('../crypto/Identity');
    const key = publicKeyFromHex(identity.publicKey);

    expect(key).not.toBeNull();
    // If this ever drifts, every peer would reject us for claiming an id our key does
    // not hash to — the handshake checks exactly this.
    expect(peerIdFromPublicKey(key)).toBe(identity.peerId);
  });
});
