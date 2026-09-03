/**
 * Hardware-backed wrapping of the at-rest key.
 *
 * The Keystore itself cannot be tested off-device — it is hardware, and the JS side only
 * sees a promise. What CAN be tested, and is what actually breaks installations, is
 * everything around it: upgrading an existing key without losing the data it protects,
 * behaving sanely on a device with no Keystore, and doing something defensible when the
 * hardware key is gone after a restore.
 *
 * That last case is the dangerous one. Handled wrongly it either wipes a working
 * installation or leaves every read failing forever.
 */
import {
  storageKeyFromBase64,
  storageKeyToBase64,
  generateStorageKey,
  storageKeyToHex,
} from '../crypto/AtRestCrypto';

type StorageModule = typeof import('../storage/LocalStorage');

function deviceStore(): Map<string, string> {
  return (globalThis as unknown as {__asyncStorageStore: Map<string, string>})
    .__asyncStorageStore;
}

/** Stands in for the Keystore: a wrapper the test can make available, or take away. */
class FakeKeystore {
  available = true;
  /** Simulates the key being destroyed by a restore or reinstall. */
  invalidated = false;
  wrapCalls = 0;

  isAvailable = jest.fn(async () => this.available);

  wrap = jest.fn(async (plain: string) => {
    this.wrapCalls++;
    if (!this.available) {
      throw new Error('no keystore');
    }
    return `wrapped:${plain}`;
  });

  unwrap = jest.fn(async (blob: string) => {
    if (this.invalidated) {
      const err = new Error('gone') as Error & {code?: string};
      err.code = 'key_invalidated';
      throw err;
    }
    if (!blob.startsWith('wrapped:')) {
      throw new Error('bad blob');
    }
    return blob.slice('wrapped:'.length);
  });

  destroyKey = jest.fn(async () => true);
}

let keystore: FakeKeystore;

function loadStorage(): StorageModule {
  jest.resetModules();
  keystore = new FakeKeystore();
  jest.doMock('react-native', () => ({
    NativeModules: {SecureStore: keystore},
    Platform: {OS: 'android'},
  }));
  return require('../storage/LocalStorage') as StorageModule;
}

/** Reopen the app, keeping the same fake hardware. */
function restart(previous: FakeKeystore): StorageModule {
  jest.resetModules();
  keystore = previous;
  jest.doMock('react-native', () => ({
    NativeModules: {SecureStore: keystore},
    Platform: {OS: 'android'},
  }));
  return require('../storage/LocalStorage') as StorageModule;
}

function freshBoot(): StorageModule {
  deviceStore().clear();
  return loadStorage();
}

describe('at-rest key on a device with a working Keystore', () => {
  it('wraps a newly generated key instead of storing it in the clear', async () => {
    const mod = freshBoot();
    await mod.storage.saveOutbox([]);

    expect(deviceStore().has('@blechat/storageKeyWrapped')).toBe(true);
    // The unwrapped copy must not be left behind — it would defeat the whole exercise.
    expect(deviceStore().has('@blechat/storageKey')).toBe(false);
    expect(mod.storage.getKeyProtection()).toBe('hardware');
  });

  it('reads its own data back after a restart', async () => {
    const mod = freshBoot();
    await mod.storage.saveMessages('peer-1', []);
    await mod.storage.saveOutbox([]);

    const reopened = restart(keystore);
    // Same wrapped key, unwrapped by the same fake hardware.
    expect(await reopened.storage.loadOutbox()).toEqual([]);
    expect(reopened.storage.getKeyProtection()).toBe('hardware');
  });

  it('does not re-wrap on every launch', async () => {
    const mod = freshBoot();
    await mod.storage.saveOutbox([]);
    const afterFirst = keystore.wrapCalls;

    const reopened = restart(keystore);
    await reopened.storage.loadOutbox();

    // The probe wraps once; the point is that loading an existing key does not.
    expect(keystore.wrapCalls).toBe(afterFirst);
  });
});

describe('upgrading an installation that predates the Keystore', () => {
  it('adopts the existing key rather than abandoning stored messages', async () => {
    // An older build's state: a key sitting in the clear, with data encrypted under it.
    deviceStore().clear();
    const legacyKey = generateStorageKey();
    const legacyHex = storageKeyToHex(legacyKey);
    deviceStore().set('@blechat/storageKey', legacyHex);

    const mod = loadStorage();
    // A WRITE, not a read: readSecure returns early when nothing is stored, so it never
    // touches the key and the upgrade is (correctly) lazy. Reading an empty store would
    // test nothing.
    await mod.storage.saveOutbox([]);

    // Same key, now wrapped: the upgrade must not invent a new one, or every message
    // already on disk becomes unreadable.
    const wrapped = deviceStore().get('@blechat/storageKeyWrapped');
    expect(wrapped).toBeDefined();
    const recovered = storageKeyFromBase64(wrapped!.slice('wrapped:'.length));
    expect(recovered).not.toBeNull();
    expect(Array.from(recovered!)).toEqual(Array.from(legacyKey));
  });

  it('removes the unwrapped copy once the wrapped one is written', async () => {
    deviceStore().clear();
    deviceStore().set('@blechat/storageKey', storageKeyToHex(generateStorageKey()));

    const mod = loadStorage();
    await mod.storage.saveOutbox([]);

    expect(deviceStore().has('@blechat/storageKey')).toBe(false);
  });

  it('still reads messages written before the upgrade', async () => {
    deviceStore().clear();
    // Write under the legacy path first.
    const legacy = loadStorage();
    keystore.available = false;
    await legacy.storage.saveOutbox([]);
    await legacy.storage.saveMessages('peer-1', []);
    expect(deviceStore().has('@blechat/storageKey')).toBe(true);

    // Now the same installation on a build with a working Keystore.
    const upgraded = restart(keystore);
    keystore.available = true;
    expect(await upgraded.storage.loadOutbox()).toEqual([]);
    expect(await upgraded.storage.loadMessages('peer-1')).toEqual([]);
  });
});

describe('a device with no usable Keystore', () => {
  it('keeps working, storing the key the old way', async () => {
    deviceStore().clear();
    const mod = loadStorage();
    keystore.available = false;

    await mod.storage.saveOutbox([]);

    // Degrading is correct: refusing to start would be worse than the protection this
    // device can actually offer.
    expect(deviceStore().has('@blechat/storageKey')).toBe(true);
    expect(mod.storage.getKeyProtection()).toBe('software');
  });

  it('reports software protection honestly rather than claiming hardware', async () => {
    deviceStore().clear();
    const mod = loadStorage();
    keystore.available = false;
    await mod.storage.saveOutbox([]);
    expect(mod.storage.getKeyProtection()).not.toBe('hardware');
  });

  it('round-trips data normally without the Keystore', async () => {
    deviceStore().clear();
    const mod = loadStorage();
    keystore.available = false;
    await mod.storage.saveBlockedPeers(['peer-x']);

    const reopened = restart(keystore);
    expect(await reopened.storage.loadBlockedPeers()).toEqual(['peer-x']);
  });
});

describe('when the hardware key is gone (restore or reinstall)', () => {
  it('starts fresh instead of failing every read forever', async () => {
    const mod = freshBoot();
    await mod.storage.saveOutbox([]);
    expect(deviceStore().has('@blechat/storageKeyWrapped')).toBe(true);

    // The phone was restored onto new hardware: the wrapped blob came across, the key
    // that could open it did not.
    keystore.invalidated = true;
    const reopened = restart(keystore);

    // Must not throw, and must not spin retrying something that cannot succeed.
    await expect(reopened.storage.loadOutbox()).resolves.toEqual([]);
  });

  it('discards the unusable wrapped key rather than keeping it around', async () => {
    const mod = freshBoot();
    await mod.storage.saveOutbox([]);
    const original = deviceStore().get('@blechat/storageKeyWrapped');

    keystore.invalidated = true;
    const reopened = restart(keystore);
    await reopened.storage.loadOutbox();

    // Either replaced with a usable one or removed — never left as a blob that will
    // fail on every future launch.
    expect(deviceStore().get('@blechat/storageKeyWrapped')).not.toBe(original);
  });

  it('can store and read new data after the loss', async () => {
    const mod = freshBoot();
    await mod.storage.saveBlockedPeers(['old-peer']);

    keystore.invalidated = true;
    const afterRestore = restart(keystore);
    await afterRestore.storage.loadBlockedPeers();

    // The old data is gone — that is the honest cost of binding a key to hardware —
    // but the app is usable again from here.
    keystore.invalidated = false;
    await afterRestore.storage.saveBlockedPeers(['new-peer']);
    expect(await afterRestore.storage.loadBlockedPeers()).toEqual(['new-peer']);
  });
});

describe('key encoding at the native boundary', () => {
  it('round-trips a key through base64', () => {
    const key = generateStorageKey();
    const restored = storageKeyFromBase64(storageKeyToBase64(key));
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(key));
  });

  it('rejects anything that is not a 32-byte key', () => {
    expect(storageKeyFromBase64('')).toBeNull();
    expect(storageKeyFromBase64(null)).toBeNull();
    expect(storageKeyFromBase64(123)).toBeNull();
    expect(storageKeyFromBase64(storageKeyToBase64(new Uint8Array(16)))).toBeNull();
  });
});
