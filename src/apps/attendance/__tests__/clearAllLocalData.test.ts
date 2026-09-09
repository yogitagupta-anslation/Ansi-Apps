/**
 * clearAllLocalData.test.ts
 * -----------------------------------------------------------------------------
 * "Erase all local data" must actually erase all local data.
 *
 * The bug these tests exist for: clearAllLocalData named three keys by hand and
 * missed the two the EMPLOYEE side writes, so a person who asked to wipe their
 * device kept a stored copy of their own attendance — today's delivered status
 * and the whole delivered month — and it survived a restart. The dialog they
 * tapped promised the opposite.
 *
 * Two halves have to hold, and they fail independently:
 *   1. STORAGE  — every key the app owns is removed, including the two that
 *                 were invisible to the old hand-written list.
 *   2. MEMORY   — EmployeeStatusStore caches `cached` and `history` at module
 *                 level, so deleting the keys alone leaves the erased values on
 *                 screen until the next launch.
 *
 * The AsyncStorage mock in jest.setup.js keeps its backing map on globalThis
 * precisely so it survives jest.resetModules(), which is what lets the restart
 * case below be real rather than simulated.
 * -----------------------------------------------------------------------------
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmployeeStatusStore } from '../attendance/EmployeeStatusStore';
import { clearAllLocalData, STORAGE_KEYS, writeJson } from '../storage/AppStorage';
import type { StatusReport } from '../bluetooth/statusReport';

/**
 * Dated TODAY on purpose. getTodayReport() returns null for any other date —
 * past days are history, not current status — so a fixed date would make the
 * memory assertions below pass for the wrong reason.
 */
function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const NOW = Date.now();

const REPORT: StatusReport = {
  v: 1,
  employeeId: 'EMP_1',
  status: 'PRESENT',
  checkInTime: NOW - 60 * 60 * 1000,
  leftTime: null,
  hostId: 'HOST-A1B2',
  date: todayString(),
  reportedAt: NOW,
};

/** Everything the app is allowed to leave behind is nothing. */
async function seedEveryKey(): Promise<void> {
  await Promise.all(
    Object.values(STORAGE_KEYS).map(key => writeJson(key, { seeded: key })),
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  EmployeeStatusStore.clear();
});

describe('clearAllLocalData — storage', () => {
  it('removes every key the app owns, with none left behind', async () => {
    await seedEveryKey();
    // Guard the guard: a seeding bug would make the assertion below vacuous.
    expect((await AsyncStorage.getAllKeys()).length).toBe(
      Object.keys(STORAGE_KEYS).length,
    );

    await clearAllLocalData();

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('removes the employee-side keys the old hand-written list missed', async () => {
    // The regression itself, named. These two were private string literals
    // inside EmployeeStatusStore, so the wipe could not see them.
    await seedEveryKey();

    await clearAllLocalData();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.employeeStatusReport)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.employeeHistory)).toBeNull();
  });

  it('erases a real delivered report rather than only a synthetic key', async () => {
    // Goes through the store's own write path, so this covers the keys it
    // actually uses rather than the ones this test thinks it uses.
    await EmployeeStatusStore.accept(REPORT);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.employeeStatusReport)).not.toBeNull();

    await clearAllLocalData();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.employeeStatusReport)).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.employeeHistory)).toBeNull();
  });

  it('leaves nothing for a restart to reload', async () => {
    await EmployeeStatusStore.accept(REPORT);
    await clearAllLocalData();

    // A restart throws away every in-memory object while device storage stays
    // put — which is exactly why the mock's map lives on globalThis.
    jest.resetModules();
    const fresh = require('../attendance/EmployeeStatusStore')
      .EmployeeStatusStore as typeof EmployeeStatusStore;
    await fresh.initialize();

    expect(fresh.getTodayReport()).toBeNull();
    expect(fresh.getHistory()).toEqual([]);
  });
});

describe('EmployeeStatusStore.clear — memory', () => {
  it('drops the cached report, so the erased times leave the screen at once', async () => {
    await EmployeeStatusStore.accept(REPORT);
    expect(EmployeeStatusStore.getTodayReport()).not.toBeNull();

    EmployeeStatusStore.clear();

    // Without this the user watches the data they just erased stay on screen
    // until the next launch.
    expect(EmployeeStatusStore.getTodayReport()).toBeNull();
    expect(EmployeeStatusStore.getHistory()).toEqual([]);
    expect(EmployeeStatusStore.getLastSyncedAt()).toBeNull();
  });

  it('tells subscribers, rather than waiting to be asked', async () => {
    await EmployeeStatusStore.accept(REPORT);

    const seen: (StatusReport | null)[] = [];
    // subscribe() replays current state immediately; that first call is the
    // pre-clear value and is not what this asserts.
    const stop = EmployeeStatusStore.subscribe(r => seen.push(r));
    expect(seen).toHaveLength(1);

    EmployeeStatusStore.clear();

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();
    stop();
  });

  it('re-arms initialize, so a later load reads disk instead of short-circuiting', async () => {
    await EmployeeStatusStore.accept(REPORT);
    EmployeeStatusStore.clear();

    // `loaded` guards initialize(). Left true across a clear, this would return
    // early and the store would stay empty even where storage still held data.
    await writeJson(STORAGE_KEYS.employeeStatusReport, REPORT);
    await EmployeeStatusStore.initialize();

    expect(EmployeeStatusStore.getTodayReport()).not.toBeNull();
  });
});
