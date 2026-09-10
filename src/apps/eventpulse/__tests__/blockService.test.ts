/**
 * BlockService — the guarantee under test is the one its header singles out
 * (§42): a block takes effect instantly and offline, and is still in force
 * after the app has been killed and reopened.
 *
 * The boundaries are injected, so they are the real thing wherever that is
 * possible: the real `LocalDatabase` over the real `MemoryStorageAdapter`.
 * "Relaunch" therefore means a brand-new `LocalDatabase` over the same stored
 * bytes — a fresh write-through cache, exactly like a restarted process. Only
 * the network seam is faked (`FakeApi` below), because it is an interface the
 * service is handed rather than a collaborator it owns. `BlockService` itself
 * is never mocked.
 */

import { ApiError, type EventPulseApi } from '../api/ApiClient';
import {
  BlockService,
  REPORT_REASONS,
  type BlockRecord,
  type ReportInput,
} from '../security/BlockService';
import { LocalDatabase, MemoryStorageAdapter, keys } from '../storage/LocalDatabase';
import type { ProfileId } from '../types';

/** What `LocalDatabase` actually writes for `keys.blocklist`, namespace included. */
const BLOCKLIST_KEY = `eventpulse:${keys.blocklist}`;

interface ReportCall {
  profileId: ProfileId;
  reason: string;
  details: string | undefined;
}

function unsupported(name: string): Promise<never> {
  return Promise.reject(new Error(`FakeApi.${name} is outside the BlockService seam`));
}

/**
 * In-memory stand-in for the network seam. It records every call, can be told
 * to fail with a specific `ApiError`, and can hold `blockUser` open so a test
 * can observe the world between "block requested" and "server answered".
 */
class FakeApi {
  readonly blockCalls: ProfileId[] = [];
  readonly unblockCalls: ProfileId[] = [];
  readonly reportCalls: ReportCall[] = [];

  blockFailure: ApiError | null = null;
  unblockFailure: ApiError | null = null;
  reportFailure: ApiError | null = null;

  /** While true, `blockUser` never settles until `releaseBlock()` is called. */
  holdBlockCalls = false;

  private releaseHeldBlock: (() => void) | null = null;
  private announceBlockCall: (() => void) | null = null;

  readonly api: EventPulseApi = {
    listEvents: () => unsupported('listEvents'),
    getEvent: () => unsupported('getEvent'),
    joinEvent: () => unsupported('joinEvent'),
    leaveEvent: () => unsupported('leaveEvent'),
    getDirectory: () => unsupported('getDirectory'),
    getProfiles: () => unsupported('getProfiles'),
    publishPeerSchedule: () => unsupported('publishPeerSchedule'),
    updateProfile: () => unsupported('updateProfile'),
    updateEventProfile: () => unsupported('updateEventProfile'),
    updateVisibility: () => unsupported('updateVisibility'),
    listConnections: () => unsupported('listConnections'),
    requestConnection: () => unsupported('requestConnection'),
    respondToConnection: () => unsupported('respondToConnection'),
    searchAttendees: () => unsupported('searchAttendees'),
    blockUser: (profileId) => this.onBlock(profileId),
    unblockUser: (profileId) => this.onUnblock(profileId),
    reportUser: (profileId, reason, details) => this.onReport(profileId, reason, details),
  };

  /** Resolves the instant `blockUser` is entered, before its promise settles. */
  nextBlockCall(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.announceBlockCall = resolve;
    });
  }

  releaseBlock(): void {
    const release = this.releaseHeldBlock;
    this.releaseHeldBlock = null;
    if (release) release();
  }

  private onBlock(profileId: ProfileId): Promise<void> {
    this.blockCalls.push(profileId);
    const announce = this.announceBlockCall;
    this.announceBlockCall = null;
    if (announce) announce();
    if (this.blockFailure) return Promise.reject(this.blockFailure);
    if (this.holdBlockCalls) {
      return new Promise<void>((resolve) => {
        this.releaseHeldBlock = resolve;
      });
    }
    return Promise.resolve();
  }

  private onUnblock(profileId: ProfileId): Promise<void> {
    this.unblockCalls.push(profileId);
    return this.unblockFailure ? Promise.reject(this.unblockFailure) : Promise.resolve();
  }

  private onReport(profileId: ProfileId, reason: string, details?: string): Promise<void> {
    this.reportCalls.push({ profileId, reason, details });
    return this.reportFailure ? Promise.reject(this.reportFailure) : Promise.resolve();
  }
}

async function openDatabase(adapter: MemoryStorageAdapter): Promise<LocalDatabase> {
  const db = new LocalDatabase(adapter);
  await db.open();
  return db;
}

/** A fresh launch of the app over storage that already exists on the device. */
async function relaunch(adapter: MemoryStorageAdapter, api: FakeApi): Promise<BlockService> {
  const service = new BlockService(await openDatabase(adapter), api.api);
  await service.load();
  return service;
}

/** Reads the bytes on "disk", bypassing every in-memory cache. */
async function storedBlocklist(adapter: MemoryStorageAdapter): Promise<BlockRecord[]> {
  const raw = await adapter.getItem(BLOCKLIST_KEY);
  return raw === null ? [] : (JSON.parse(raw) as BlockRecord[]);
}

function onlyRecord(records: BlockRecord[]): BlockRecord {
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) throw new Error('expected exactly one block record');
  return record;
}

function blockedList(service: BlockService): ProfileId[] {
  return [...service.blockedIds()].sort();
}

const OFFLINE = (): ApiError => new ApiError('network', 'no route to host');

describe('BlockService', () => {
  let adapter: MemoryStorageAdapter;
  let api: FakeApi;
  let service: BlockService;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    api = new FakeApi();
    service = await relaunch(adapter, api);
  });

  describe('a block takes effect locally before the network hears about it', () => {
    it('reports the profile as blocked while the server call is still in flight', async () => {
      api.holdBlockCalls = true;
      const entered = api.nextBlockCall();

      const inFlight = service.block('attendee-1');
      await entered;

      expect(service.isBlocked('attendee-1')).toBe(true);
      expect(blockedList(service)).toEqual(['attendee-1']);
      expect(onlyRecord(service.list()).profileId).toBe('attendee-1');

      api.releaseBlock();
      await inFlight;
    });

    it('has already written the block to storage while the server call is in flight', async () => {
      api.holdBlockCalls = true;
      const entered = api.nextBlockCall();

      const inFlight = service.block('attendee-1');
      await entered;

      // A crash right here must not lose the block: read the raw bytes.
      expect(onlyRecord(await storedBlocklist(adapter)).profileId).toBe('attendee-1');

      api.releaseBlock();
      await inFlight;
    });

    it('marks the record pending until the server acknowledges, then clears the flag', async () => {
      api.holdBlockCalls = true;
      const entered = api.nextBlockCall();
      const inFlight = service.block('attendee-1');
      await entered;

      expect(onlyRecord(service.list()).pendingSync).toBe(true);

      api.releaseBlock();
      await inFlight;

      expect(onlyRecord(service.list()).pendingSync).toBe(false);
      expect(onlyRecord(await storedBlocklist(adapter)).pendingSync).toBe(false);
      expect(api.blockCalls).toEqual(['attendee-1']);
    });

    it('keeps the reason handed to block() on the stored record', async () => {
      await service.block('attendee-1', 'harassment');
      expect(onlyRecord(await storedBlocklist(adapter)).reason).toBe('harassment');
    });

    it('blocking the same profile twice leaves exactly one entry and one server call', async () => {
      await service.block('attendee-1');
      await service.block('attendee-1');

      expect(service.list()).toHaveLength(1);
      expect(service.blockedIds().size).toBe(1);
      expect(api.blockCalls).toEqual(['attendee-1']);
    });
  });

  describe('enforcement survives the app being killed and reopened', () => {
    it('still blocks the profile after a relaunch over the same storage', async () => {
      await service.block('attendee-1', 'spam');

      const reopened = await relaunch(adapter, api);

      expect(reopened.isBlocked('attendee-1')).toBe(true);
      expect(blockedList(reopened)).toEqual(['attendee-1']);
      expect(onlyRecord(reopened.list()).reason).toBe('spam');
    });

    it('carries an unacknowledged block across a relaunch so it can still be retried', async () => {
      api.blockFailure = OFFLINE();
      await service.block('attendee-1');

      const reopened = await relaunch(adapter, api);
      expect(onlyRecord(reopened.list()).pendingSync).toBe(true);

      api.blockFailure = null;
      await reopened.flush();

      expect(api.blockCalls).toEqual(['attendee-1', 'attendee-1']);
      expect(onlyRecord(reopened.list()).pendingSync).toBe(false);
    });

    it('does not resurrect a profile that was unblocked before the relaunch', async () => {
      await service.block('attendee-1');
      await service.block('attendee-2');
      await service.unblock('attendee-1');

      const reopened = await relaunch(adapter, api);

      expect(reopened.isBlocked('attendee-1')).toBe(false);
      expect(blockedList(reopened)).toEqual(['attendee-2']);
    });

    it('starts empty when storage has never held a blocklist', () => {
      expect(service.list()).toEqual([]);
      expect(service.blockedIds().size).toBe(0);
      expect(service.isBlocked('anyone')).toBe(false);
    });

    it('starts empty when the stored blocklist is an empty array', async () => {
      await adapter.setItem(BLOCKLIST_KEY, JSON.stringify([]));
      const reopened = await relaunch(adapter, api);
      expect(reopened.list()).toEqual([]);
    });

    it('starts empty rather than crashing when the stored blocklist is corrupt', async () => {
      await adapter.setItem(BLOCKLIST_KEY, '{not json at all');
      const reopened = await relaunch(adapter, api);
      expect(reopened.list()).toEqual([]);
      expect(reopened.isBlocked('attendee-1')).toBe(false);
    });

    it('a second load() does not discard blocks made since the first', async () => {
      await service.block('attendee-1');
      await service.load();
      expect(blockedList(service)).toEqual(['attendee-1']);
    });

    /**
     * DEFECT — src/apps/eventpulse/security/BlockService.ts:86-94 (block)
     * together with :59-65 (load). `block()` writes the whole in-memory map back
     * to storage without requiring, or awaiting, `load()`. A block made before
     * the load finishes therefore overwrites the persisted blocklist with a
     * single record, and the subsequent `load()` reads that truncated list back:
     * every previously blocked person silently becomes unblocked, which is
     * exactly the failure the module header says must never happen.
     */
    it('keeps already-persisted blocks when block() runs before load()', async () => {
      await service.block('attendee-1');
      await service.block('attendee-2');

      // Relaunch: the user taps Block before bootstrap's load() has resolved.
      const db = await openDatabase(adapter);
      const racing = new BlockService(db, api.api);
      await racing.block('attendee-3');
      await racing.load();

      const reopened = await relaunch(adapter, api);
      expect(blockedList(reopened)).toEqual(['attendee-1', 'attendee-2', 'attendee-3']);
    });
  });

  describe('unblocking', () => {
    it('removes the profile from the list, the set and storage', async () => {
      await service.block('attendee-1');
      await service.unblock('attendee-1');

      expect(service.isBlocked('attendee-1')).toBe(false);
      expect(service.list()).toEqual([]);
      expect(service.blockedIds().size).toBe(0);
      expect(await storedBlocklist(adapter)).toEqual([]);
      expect(api.unblockCalls).toEqual(['attendee-1']);
    });

    it('takes effect locally even when the server call fails', async () => {
      await service.block('attendee-1');
      api.unblockFailure = OFFLINE();

      await expect(service.unblock('attendee-1')).resolves.toBeUndefined();

      expect(service.isBlocked('attendee-1')).toBe(false);
      expect(await storedBlocklist(adapter)).toEqual([]);
    });

    it('is a no-op for a profile that was never blocked', async () => {
      await service.unblock('stranger');
      expect(api.unblockCalls).toEqual([]);
      expect(await adapter.getItem(BLOCKLIST_KEY)).toBeNull();
    });

    it('does not re-send a block that was withdrawn while still queued', async () => {
      api.blockFailure = OFFLINE();
      await service.block('attendee-1');
      await service.unblock('attendee-1');

      api.blockFailure = null;
      await service.flush();

      expect(api.blockCalls).toEqual(['attendee-1']); // the failed attempt only
      expect(service.isBlocked('attendee-1')).toBe(false);
    });

    /**
     * DEFECT — src/apps/eventpulse/security/BlockService.ts:111-116. The comment
     * there promises "the server converges on the next flush", but `flush()`
     * (:129-140) only walks records carrying `pendingSync`, and `unblock()` has
     * already deleted the record from the map. There is no queue and no retry
     * for an unblock, so one made offline never reaches the server: it keeps
     * refusing that person's connection requests forever.
     */
    it.failing('retries an unblock that failed offline on the next flush', async () => {
      await service.block('attendee-1');
      api.unblockFailure = OFFLINE();
      await service.unblock('attendee-1');
      expect(api.unblockCalls).toEqual(['attendee-1']);

      api.unblockFailure = null;
      await service.flush();

      expect(api.unblockCalls).toEqual(['attendee-1', 'attendee-1']);
    });
  });

  describe('offline blocking and flush()', () => {
    it('completes a block locally and queues it when the server is unreachable', async () => {
      api.blockFailure = OFFLINE();

      await expect(service.block('attendee-1', 'harassment')).resolves.toBeUndefined();

      expect(service.isBlocked('attendee-1')).toBe(true);
      const stored = onlyRecord(await storedBlocklist(adapter));
      expect(stored.pendingSync).toBe(true);
      expect(stored.reason).toBe('harassment');
      expect(api.blockCalls).toEqual(['attendee-1']);
    });

    it('drains the whole queue to the server once connectivity returns', async () => {
      api.blockFailure = OFFLINE();
      await service.block('attendee-1');
      await service.block('attendee-2');
      expect(api.blockCalls).toEqual(['attendee-1', 'attendee-2']);

      api.blockFailure = null;
      await service.flush();

      expect(api.blockCalls).toEqual([
        'attendee-1',
        'attendee-2',
        'attendee-1',
        'attendee-2',
      ]);
      expect(service.list().every((record) => record.pendingSync === false)).toBe(true);
    });

    it('writes the cleared pending flags to storage after a successful flush', async () => {
      api.blockFailure = OFFLINE();
      await service.block('attendee-1');
      api.blockFailure = null;
      await service.flush();

      expect(onlyRecord(await storedBlocklist(adapter)).pendingSync).toBe(false);
    });

    it('makes no server call when the queue is empty', async () => {
      await service.flush();
      expect(api.blockCalls).toEqual([]);
      expect(api.unblockCalls).toEqual([]);
      expect(await adapter.getItem(BLOCKLIST_KEY)).toBeNull();
    });

    it('makes no further server call when every block is already acknowledged', async () => {
      await service.block('attendee-1');
      await service.flush();
      expect(api.blockCalls).toEqual(['attendee-1']);
    });

    it('stops at the first failure and leaves the rest of the queue intact', async () => {
      api.blockFailure = OFFLINE();
      await service.block('attendee-1');
      await service.block('attendee-2');
      const attemptsSoFar = api.blockCalls.length;

      await service.flush();

      // One attempt, then it gives up for this round rather than hammering.
      expect(api.blockCalls.length).toBe(attemptsSoFar + 1);
      expect(service.list().every((record) => record.pendingSync === true)).toBe(true);

      api.blockFailure = null;
      await service.flush();
      expect(service.list().every((record) => record.pendingSync === false)).toBe(true);
    });

    /**
     * `block()` catches every rejection alike — `ApiError.retryable`
     * (ApiClient.ts:41-49) is never consulted at BlockService.ts:102-104. So a
     * permanent rejection is queued exactly like a transient one and retried on
     * every flush until some call finally succeeds. Asserting what actually
     * happens: the item is not dropped, and it is not abandoned either.
     */
    it('keeps a block queued after a non-retryable rejection and retries it later', async () => {
      const forbidden = new ApiError('forbidden', 'not a member of this event', 403);
      expect(forbidden.retryable).toBe(false);
      api.blockFailure = forbidden;

      await service.block('attendee-1');
      expect(onlyRecord(service.list()).pendingSync).toBe(true);

      await service.flush();
      expect(api.blockCalls).toEqual(['attendee-1', 'attendee-1']);
      expect(onlyRecord(service.list()).pendingSync).toBe(true);

      api.blockFailure = null;
      await service.flush();
      expect(onlyRecord(service.list()).pendingSync).toBe(false);
    });

    it('leaves local enforcement untouched no matter how the server answers', async () => {
      api.blockFailure = new ApiError('unauthorized', 'token expired', 401);
      await service.block('attendee-1');
      await service.flush();

      expect(service.isBlocked('attendee-1')).toBe(true);
      expect(blockedList(await relaunch(adapter, api))).toEqual(['attendee-1']);
    });
  });

  describe('reporting', () => {
    const harassment: ReportInput = { profileId: 'attendee-1', reason: 'harassment' };

    it('blocks the reported profile when alsoBlock is omitted', async () => {
      await service.report(harassment);

      expect(service.isBlocked('attendee-1')).toBe(true);
      expect(api.blockCalls).toEqual(['attendee-1']);
    });

    it('blocks the reported profile when alsoBlock is true', async () => {
      await service.report({ ...harassment, alsoBlock: true });
      expect(service.isBlocked('attendee-1')).toBe(true);
    });

    it('does not block when alsoBlock is explicitly false, but still sends the report', async () => {
      await service.report({ ...harassment, alsoBlock: false, details: 'shouted at me' });

      expect(service.isBlocked('attendee-1')).toBe(false);
      expect(api.blockCalls).toEqual([]);
      expect(api.reportCalls).toEqual([
        { profileId: 'attendee-1', reason: 'harassment', details: 'shouted at me' },
      ]);
    });

    it('sends the profile, reason and details to the server exactly once', async () => {
      await service.report({ ...harassment, details: 'followed me between sessions' });

      expect(api.reportCalls).toEqual([
        {
          profileId: 'attendee-1',
          reason: 'harassment',
          details: 'followed me between sessions',
        },
      ]);
    });

    it('records the report reason as the reason on the block it creates', async () => {
      await service.report({ profileId: 'attendee-1', reason: 'impersonation' });
      expect(onlyRecord(service.list()).reason).toBe('impersonation');
    });

    it('keeps the block when the report cannot be delivered, and says so', async () => {
      api.reportFailure = OFFLINE();

      // The delivery failure is surfaced, not swallowed — but the block, which
      // is the half that actually protects the user, still holds and persists.
      await expect(service.report(harassment)).rejects.toBeInstanceOf(ApiError);

      expect(service.isBlocked('attendee-1')).toBe(true);
      expect(blockedList(await relaunch(adapter, api))).toEqual(['attendee-1']);
    });

    it('offers exactly the five reasons the ReportInput type accepts, each labelled', () => {
      expect(REPORT_REASONS.map((entry) => entry.value)).toEqual([
        'harassment',
        'impersonation',
        'spam',
        'inappropriate_profile',
        'other',
      ]);
      expect(REPORT_REASONS.every((entry) => entry.label.length > 0)).toBe(true);
      expect(new Set(REPORT_REASONS.map((entry) => entry.value)).size).toBe(
        REPORT_REASONS.length,
      );
    });

    /**
     * REGRESSION (was a defect at BlockService.ts:119-126, fixed): a report used
     * to be fire-and-forget. Nothing was written anywhere and `flush()` knew only
     * about blocks, so a rejected `reportUser` lost the report for good. It is
     * now queued under `keys.reportQueue` and retried on the next flush.
     */
    it('re-delivers a report that failed to send when flush() runs', async () => {
      api.reportFailure = OFFLINE();
      await expect(service.report(harassment)).rejects.toBeInstanceOf(ApiError);
      expect(api.reportCalls).toHaveLength(1);

      api.reportFailure = null;
      await service.flush();

      expect(api.reportCalls).toHaveLength(2);
    });

    /**
     * DEFECT (the caller-visible half of the same swallow) —
     * src/apps/eventpulse/security/BlockService.ts:121-125. The catch turns a
     * failed delivery into a resolved promise, so the screen awaiting `report()`
     * tells the user their report was submitted when nothing left the device.
     * Since nothing is queued either, that message is simply untrue.
     */
    it('tells the caller when the report could not be delivered', async () => {
      api.reportFailure = OFFLINE();
      await expect(service.report(harassment)).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('subscribers', () => {
    it('delivers the current blocked set immediately on subscribe', async () => {
      await service.block('attendee-1');
      const seen: ProfileId[][] = [];

      service.subscribe((blocked) => seen.push([...blocked].sort()));

      expect(seen).toEqual([['attendee-1']]);
    });

    it('notifies on block and on unblock', async () => {
      const seen: ProfileId[][] = [];
      service.subscribe((blocked) => seen.push([...blocked].sort()));

      await service.block('attendee-1');
      await service.block('attendee-2');
      await service.unblock('attendee-1');

      expect(seen).toEqual([
        [],
        ['attendee-1'],
        ['attendee-1', 'attendee-2'],
        ['attendee-2'],
      ]);
    });

    it('notifies when load() restores a blocklist from storage', async () => {
      await service.block('attendee-1');

      const reopened = new BlockService(await openDatabase(adapter), api.api);
      const seen: ProfileId[][] = [];
      reopened.subscribe((blocked) => seen.push([...blocked].sort()));

      expect(seen).toEqual([[]]);
      await reopened.load();
      expect(seen).toEqual([[], ['attendee-1']]);
    });

    it('stops notifying after the returned unsubscribe is called', async () => {
      const seen: ProfileId[][] = [];
      const unsubscribe = service.subscribe((blocked) => seen.push([...blocked].sort()));

      await service.block('attendee-1');
      unsubscribe();
      await service.block('attendee-2');
      await service.unblock('attendee-1');

      expect(seen).toEqual([[], ['attendee-1']]);
      expect(blockedList(service)).toEqual(['attendee-2']);
    });

    it('does not notify for a duplicate block or an unblock of an unknown profile', async () => {
      await service.block('attendee-1');
      const seen: ProfileId[][] = [];
      service.subscribe((blocked) => seen.push([...blocked].sort()));

      await service.block('attendee-1');
      await service.unblock('stranger');

      expect(seen).toEqual([['attendee-1']]);
    });

    it('delivers a snapshot that later changes do not mutate', async () => {
      const deliveries: Set<ProfileId>[] = [];
      service.subscribe((blocked) => deliveries.push(blocked));

      await service.block('attendee-1');
      await service.block('attendee-2');

      expect(deliveries).toHaveLength(3);
      expect(deliveries[0]?.size).toBe(0);
      expect([...(deliveries[1] ?? [])]).toEqual(['attendee-1']);
    });

    it('keeps notifying the remaining subscribers when one unsubscribes', async () => {
      const first: number[] = [];
      const second: number[] = [];
      const stop = service.subscribe((blocked) => first.push(blocked.size));
      service.subscribe((blocked) => second.push(blocked.size));

      await service.block('attendee-1');
      stop();
      await service.block('attendee-2');

      expect(first).toEqual([0, 1]);
      expect(second).toEqual([0, 1, 2]);
    });
  });

  describe('the blocked set handed to the enforcement layers', () => {
    /**
     * Shape contract: `blockedIds()` is a `Set<ProfileId>` of the very strings
     * passed to `block()` — no peer ids, no wrapper objects. That is what
     * `AttendeeDirectory.setBlocked(profileIds)` consumes, which then maps them
     * to peer ids through `blockedPeerIds()` for `PeerRegistry.setSuppressed()`
     * (runtime/services.ts:200-206, presence/PresenceController.ts:224).
     */
    it('exposes exactly the profile ids that were blocked', async () => {
      await service.block('profile-aaa');
      await service.block('profile-bbb');

      const blocked = service.blockedIds();

      expect(blocked).toBeInstanceOf(Set);
      expect([...blocked].sort()).toEqual(['profile-aaa', 'profile-bbb']);
      expect([...blocked].every((id) => typeof id === 'string')).toBe(true);
      expect(blocked.has('profile-aaa')).toBe(true);
      expect(blocked.has('profile-ccc')).toBe(false);
    });

    it('returns a copy that a caller cannot use to alter enforcement', async () => {
      await service.block('attendee-1');
      const blocked = service.blockedIds();

      blocked.add('attendee-2');
      blocked.delete('attendee-1');

      expect(service.isBlocked('attendee-1')).toBe(true);
      expect(service.isBlocked('attendee-2')).toBe(false);
      expect(blockedList(service)).toEqual(['attendee-1']);
    });

    it('agrees with isBlocked() and list() on every membership question', async () => {
      await service.block('attendee-1');
      await service.block('attendee-2');
      await service.unblock('attendee-1');

      const blocked = service.blockedIds();
      const listed = service.list().map((record) => record.profileId);

      expect([...blocked]).toEqual(listed);
      expect(listed.every((id) => service.isBlocked(id))).toBe(true);
      expect(service.isBlocked('attendee-1')).toBe(false);
    });
  });

  describe('timestamps and ordering', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('stamps the record with the wall clock at the moment of the block', async () => {
      jest.setSystemTime(1_700_000_000_000);
      await service.block('attendee-1');
      expect(onlyRecord(service.list()).blockedAt).toBe(1_700_000_000_000);
    });

    it('lists the most recently blocked profile first', async () => {
      jest.setSystemTime(1_000);
      await service.block('attendee-1');
      jest.setSystemTime(3_000);
      await service.block('attendee-2');
      jest.setSystemTime(2_000);
      await service.block('attendee-3');

      expect(service.list().map((record) => record.profileId)).toEqual([
        'attendee-2',
        'attendee-3',
        'attendee-1',
      ]);
    });

    it('keeps the first blockedAt and reason when the same profile is blocked again', async () => {
      jest.setSystemTime(5_000);
      await service.block('attendee-1', 'spam');
      jest.setSystemTime(9_000);
      await service.block('attendee-1', 'harassment');

      const record = onlyRecord(service.list());
      expect(record.blockedAt).toBe(5_000);
      expect(record.reason).toBe('spam');
    });

    it('preserves blockedAt across a relaunch', async () => {
      jest.setSystemTime(4_242_000);
      await service.block('attendee-1');

      jest.setSystemTime(9_999_000);
      const reopened = await relaunch(adapter, api);

      expect(onlyRecord(reopened.list()).blockedAt).toBe(4_242_000);
    });
  });
});
