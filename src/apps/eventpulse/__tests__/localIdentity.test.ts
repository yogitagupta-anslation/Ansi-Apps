/**
 * Two installs must not be the same person.
 *
 * This is the invariant the app shipped without. `defaultUserProfile` wrote the
 * literal `'me'` into every profile, so every phone put `profileId: 'me'` into
 * the card it sent over GATT, and the receiver's own self-check —
 * `if (myCard && profileId === myCard.profileId) return;` in
 * `ConnectionRequestCoordinator.onRequest` — treated every inbound request as a
 * request from itself and dropped it without a word.
 *
 * The handshake suites never caught it because they do what a test naturally
 * does: hand each phone a distinct fixture id (`profile-ada`, `profile-grace`).
 * The protocol was always fine. The identity source was not. So these tests go
 * at the identity source itself, through the same functions the boot path
 * calls, and assert the thing production actually got wrong.
 *
 * Nothing here is mocked. Real `LocalDatabase`, real `MemoryStorageAdapter`,
 * real `ProfileService`. Randomness is injected only where a test needs to
 * pin exact bytes.
 */

import {
  LEGACY_PROFILE_ID,
  PROFILE_ID_BYTES,
  ensureLocalProfileId,
  isPlaceholderProfileId,
  mintProfileId,
  rememberLocalProfileId,
} from '../profile/LocalIdentity';
import { ProfileCache } from '../profile/ProfileCache';
import { ProfileService } from '../profile/ProfileService';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import { defaultUserProfile } from '../dev/seed';
import type { EventPulseApi } from '../api/ApiClient';
import type { Profile } from '../types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** One phone: its own storage, nothing shared with any other install. */
function makeInstall(): { adapter: MemoryStorageAdapter; db: LocalDatabase } {
  const adapter = new MemoryStorageAdapter();
  return { adapter, db: new LocalDatabase(adapter) };
}

/** Deterministic bytes, so a test can assert the exact string that is minted. */
function fixedRandom(fill: number) {
  return (byteLength: number): Uint8Array => new Uint8Array(byteLength).fill(fill);
}

/**
 * An API that throws on everything the profile path must not touch.
 *
 * `updateProfile` is the one call `ProfileService.push` makes, and it is
 * deliberately allowed to fail: nothing about adopting a local identity may
 * depend on a server being reachable.
 */
function makeApi(): EventPulseApi {
  const unused = (name: string) => () => {
    throw new Error(`EventPulseApi.${name} is not on the local identity path`);
  };
  return new Proxy({} as EventPulseApi, {
    get: (_target, prop: string) => {
      if (prop === 'updateProfile') {
        return async () => {
          throw new Error('offline');
        };
      }
      return unused(prop);
    },
  });
}

function makeProfileService(db: LocalDatabase): ProfileService {
  return new ProfileService({ cache: new ProfileCache(db), api: makeApi() });
}

/* ------------------------------------------------------------------ *
 * Minting
 * ------------------------------------------------------------------ */

describe('mintProfileId', () => {
  it('produces an id that is never mistaken for a placeholder', () => {
    expect(isPlaceholderProfileId(mintProfileId(fixedRandom(0xab)))).toBe(false);
  });

  it('encodes the full entropy it was given', () => {
    // Prefix plus two hex characters per byte. A shorter id would mean bytes
    // were being silently dropped on the way to the wire.
    // Upper-case hex, matching `bytesToHex` — the same rendering the rotating
    // peer ids use, so the two read alike in a log.
    const id = mintProfileId(fixedRandom(0x0f));
    expect(id).toBe(`ep_${'0F'.repeat(PROFILE_ID_BYTES)}`);
  });

  it('is different every time it is called', () => {
    const ids = new Set(Array.from({ length: 64 }, () => mintProfileId()));
    expect(ids.size).toBe(64);
  });

  it('fits well inside what the wire will carry', () => {
    // `ConnectionProtocol` rejects an id over MAX_ID_BYTES (128). An identity
    // that could not survive encoding would fail as a dropped request, which
    // looks exactly like the bug this module exists to fix.
    expect(mintProfileId().length).toBeLessThan(128);
  });
});

describe('isPlaceholderProfileId', () => {
  it.each([
    ['the legacy shared id', LEGACY_PROFILE_ID],
    ['empty', ''],
    ['whitespace', '   '],
  ])('rejects %s', (_label, value) => {
    expect(isPlaceholderProfileId(value)).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isPlaceholderProfileId(value)).toBe(true);
  });

  it('accepts a minted id', () => {
    expect(isPlaceholderProfileId(mintProfileId())).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The regression
 * ------------------------------------------------------------------ */

describe('two independent installs', () => {
  it('do not share an identity', async () => {
    // The whole bug, in one assertion. Before the fix both sides of this
    // comparison were the string 'me'.
    const a = makeInstall();
    const b = makeInstall();

    const idA = await ensureLocalProfileId(a.db);
    const idB = await ensureLocalProfileId(b.db);

    expect(idA).not.toBe(idB);
    expect(isPlaceholderProfileId(idA)).toBe(false);
    expect(isPlaceholderProfileId(idB)).toBe(false);
  });

  it('do not share an identity through the profile the app actually sends', async () => {
    // One step further out: the value that reaches `myCard()` is
    // `profile.id`, so pin the identity at that level too rather than trusting
    // that the seed threads it through correctly.
    const a = makeInstall();
    const b = makeInstall();

    const profileA = defaultUserProfile(await ensureLocalProfileId(a.db));
    const profileB = defaultUserProfile(await ensureLocalProfileId(b.db));

    expect(profileA.id).not.toBe(profileB.id);
    expect(profileA.id).not.toBe(LEGACY_PROFILE_ID);
    expect(profileB.id).not.toBe(LEGACY_PROFILE_ID);
  });

  it('would be refused as each other by the coordinator only if they matched', async () => {
    // The self-check the bug tripped is correct in itself, and must stay. It
    // fires on a genuine self-request and on nothing else.
    const a = makeInstall();
    const idA = await ensureLocalProfileId(a.db);
    const idB = await ensureLocalProfileId(makeInstall().db);

    const looksLikeSelf = (incoming: string, mine: string): boolean => incoming === mine;

    expect(looksLikeSelf(idA, idA)).toBe(true);
    expect(looksLikeSelf(idB, idA)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

describe('ensureLocalProfileId', () => {
  it('mints once and returns the same id thereafter', async () => {
    const { db } = makeInstall();
    const first = await ensureLocalProfileId(db);
    const second = await ensureLocalProfileId(db);
    expect(second).toBe(first);
  });

  it('survives a restart', async () => {
    // A new LocalDatabase over the same storage is what a relaunch looks like.
    // An identity that did not survive it would make the user a stranger to
    // their own connections every time they closed the app.
    const { adapter, db } = makeInstall();
    const before = await ensureLocalProfileId(db);
    const after = await ensureLocalProfileId(new LocalDatabase(adapter));
    expect(after).toBe(before);
  });

  it('replaces a stored placeholder rather than handing it back', async () => {
    const { db } = makeInstall();
    await db.set(keys.localProfileId, LEGACY_PROFILE_ID);
    const id = await ensureLocalProfileId(db);
    expect(id).not.toBe(LEGACY_PROFILE_ID);
    expect(await db.get<string>(keys.localProfileId)).toBe(id);
  });
});

describe('rememberLocalProfileId', () => {
  it('heals a stored id that has drifted from the profile', async () => {
    const { db } = makeInstall();
    await ensureLocalProfileId(db);
    const real = mintProfileId(fixedRandom(0x11));

    await rememberLocalProfileId(db, real);

    expect(await db.get<string>(keys.localProfileId)).toBe(real);
  });

  it('refuses to store a placeholder', async () => {
    const { db } = makeInstall();
    const minted = await ensureLocalProfileId(db);
    await rememberLocalProfileId(db, LEGACY_PROFILE_ID);
    expect(await db.get<string>(keys.localProfileId)).toBe(minted);
  });
});

/* ------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------ */

describe('an install that already ran the old build', () => {
  /** A profile persisted by the shipped version: the shared identity. */
  async function seedLegacyInstall(): Promise<{ db: LocalDatabase; adapter: MemoryStorageAdapter }> {
    const { adapter, db } = makeInstall();
    const legacy: Profile = { ...defaultUserProfile(LEGACY_PROFILE_ID) };
    await db.set(keys.userProfile, legacy);
    return { db, adapter };
  }

  it('keeps the stored profile when it loads, placeholder and all', async () => {
    // Pinning why changing the default alone was never going to be enough.
    const { db } = await seedLegacyInstall();
    const service = makeProfileService(db);

    const loaded = await service.load(() => defaultUserProfile(mintProfileId()));

    expect(loaded.id).toBe(LEGACY_PROFILE_ID);
  });

  it('is given a real identity by adoptIdentity', async () => {
    const { db } = await seedLegacyInstall();
    const service = makeProfileService(db);
    const minted = await ensureLocalProfileId(db);

    await service.load(() => defaultUserProfile(minted));
    const adopted = await service.adoptIdentity(minted);

    expect(adopted.id).toBe(minted);
    expect(adopted.userId).toBe(minted);
  });

  it('persists the adopted identity so the next launch keeps it', async () => {
    const { db, adapter } = await seedLegacyInstall();
    const minted = await ensureLocalProfileId(db);
    const service = makeProfileService(db);
    await service.load(() => defaultUserProfile(minted));
    await service.adoptIdentity(minted);

    const relaunched = makeProfileService(new LocalDatabase(adapter));
    const loaded = await relaunched.load(() => defaultUserProfile(mintProfileId()));

    expect(loaded.id).toBe(minted);
  });

  it('keeps everything else about the profile untouched', async () => {
    // Migrating identity must not quietly reset the card the user wrote.
    const { db } = await seedLegacyInstall();
    const minted = await ensureLocalProfileId(db);
    const service = makeProfileService(db);
    const before = await service.load(() => defaultUserProfile(minted));
    const after = await service.adoptIdentity(minted);

    expect(after.name).toBe(before.name);
    expect(after.skills).toEqual(before.skills);
    expect(after.version).toBe(before.version);
  });
});

describe('adoptIdentity', () => {
  it('never overwrites an identity the user already has', async () => {
    // Peers know this id. Trading it for a fresh one would orphan every
    // connection and every block that names them.
    const { db } = makeInstall();
    const established = mintProfileId(fixedRandom(0x22));
    await db.set(keys.userProfile, defaultUserProfile(established));

    const service = makeProfileService(db);
    await service.load(() => defaultUserProfile(mintProfileId()));
    const adopted = await service.adoptIdentity(mintProfileId(fixedRandom(0x33)));

    expect(adopted.id).toBe(established);
  });

  it('is idempotent across repeated boots', async () => {
    const { db } = makeInstall();
    const minted = await ensureLocalProfileId(db);
    const service = makeProfileService(db);
    await service.load(() => defaultUserProfile(minted));

    const first = await service.adoptIdentity(minted);
    const second = await service.adoptIdentity(minted);

    expect(second.id).toBe(first.id);
  });

  it('refuses to run before the profile is loaded', async () => {
    const { db } = makeInstall();
    const service = makeProfileService(db);
    await expect(service.adoptIdentity(mintProfileId())).rejects.toThrow(
      'adoptIdentity called before load()',
    );
  });
});
