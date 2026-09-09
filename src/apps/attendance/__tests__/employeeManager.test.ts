/**
 * EmployeeManager — the Host's registry of the ids the scanner is allowed to match.
 *
 * Two kinds of assertion carry the weight here.
 *
 * The first is ABSENCE OF DATA. A field the user left blank must come back as
 * `undefined`, never as `''`. An empty string is a claim: it renders as a stray
 * separator in the directory, it matches every substring search, and an empty-string
 * photo renders a broken image. "Nobody told us their department" and "their department
 * is blank" are different facts, and a refactor that collapses the first into the second
 * turns a gap in the record into an assertion about a person.
 *
 * The second is REJECTION AT ENTRY. The employeeId is the only value that ever travels
 * over the air, so an id the BLE advertising packet cannot carry has to be refused here,
 * while a human is looking at the error — not silently, later, on the employee's phone.
 *
 * The clock is frozen rather than read: createdAt/updatedAt are stamped from Date.now()
 * inside the manager, and an assertion about them must not depend on when it ran.
 */

import { MAX_EMPLOYEE_ID_BYTES } from '../constants/bluetoothConfig';
import { EmployeeManager } from '../employees/EmployeeManager';
import type { Employee, EmployeeInput } from '../employees/employeeTypes';
import { clearAllLocalData } from '../storage/AppStorage';
import { EmployeeStorage } from '../storage/EmployeeStorage';

/** A fixed wall clock, so createdAt/updatedAt are facts rather than "roughly now". */
const T0 = 1_700_000_000_000;
const ONE_MINUTE = 60_000;

function input(employeeId: string, over: Partial<EmployeeInput> = {}): EmployeeInput {
  return { employeeId, displayName: 'Ada Lovelace', ...over };
}

/** Add, and assert it took — so a later assertion cannot pass against an empty registry. */
async function add(mgr: EmployeeManager, value: EmployeeInput): Promise<Employee> {
  const result = await mgr.addEmployee(value);
  expect(result).toEqual({ ok: true });
  const created = mgr.getById(value.employeeId.trim());
  expect(created).not.toBeNull();
  return created as Employee;
}

let manager: EmployeeManager;

beforeEach(async () => {
  jest.useFakeTimers({
    now: T0,
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'performance',
      'hrtime',
    ],
  });

  // The AsyncStorage stub deliberately survives jest.resetModules() — it models a device
  // whose storage outlives the process — so a suite that does not wipe it explicitly is
  // reading the previous test's registry.
  await clearAllLocalData();

  manager = new EmployeeManager();
  await manager.initialize();
});

afterEach(() => {
  jest.useRealTimers();
});

/* =========================================================== blank optionals === */

describe('optional fields left blank', () => {
  it('stores a blank title as undefined, not as an empty string', async () => {
    const created = await add(manager, input('EMP_T1', { title: '' }));

    expect(created.title).toBeUndefined();
    expect(created.title).not.toBe('');
  });

  it('stores a blank office as undefined, not as an empty string', async () => {
    const created = await add(manager, input('EMP_O1', { office: '' }));

    expect(created.office).toBeUndefined();
    expect(created.office).not.toBe('');
  });

  it('stores blank department, phone, email and photo as undefined, not as empty strings', async () => {
    const created = await add(
      manager,
      input('EMP_B1', { department: '', phone: '', email: '', photo: '' }),
    );

    expect(created.department).toBeUndefined();
    expect(created.phone).toBeUndefined();
    expect(created.email).toBeUndefined();
    expect(created.photo).toBeUndefined();
  });

  it('treats a whitespace-only optional field as blank rather than as a value', async () => {
    // A space typed into the title box is not a job title. Kept as ' ' it would render a
    // separator with nothing after it, and would match every substring search.
    const created = await add(
      manager,
      input('EMP_W1', { title: '   ', office: '\t', department: ' \n ' }),
    );

    expect(created.title).toBeUndefined();
    expect(created.office).toBeUndefined();
    expect(created.department).toBeUndefined();
  });

  it('leaves an optional field undefined when the input never mentions it at all', async () => {
    const created = await add(manager, input('EMP_M1'));

    expect(created.department).toBeUndefined();
    expect(created.title).toBeUndefined();
    expect(created.office).toBeUndefined();
    expect(created.phone).toBeUndefined();
    expect(created.email).toBeUndefined();
    expect(created.photo).toBeUndefined();
  });

  it('persists no empty string for any blank optional field, so a reload cannot revive one', async () => {
    await add(
      manager,
      input('EMP_P1', {
        displayName: 'Grace Hopper',
        department: '',
        title: '',
        office: '',
        phone: '',
        email: '',
        photo: '',
      }),
    );

    // Read back through storage: this is what the next launch of the app would load.
    const stored = await EmployeeStorage.getById('EMP_P1');
    expect(stored).not.toBeNull();
    expect(stored?.title).toBeUndefined();
    expect(stored?.office).toBeUndefined();
    expect(Object.values(stored as object)).not.toContain('');
  });

  it('keeps a supplied optional field, trimmed of its surrounding whitespace', async () => {
    const created = await add(
      manager,
      input('EMP_S1', { title: '  Engineer  ', office: ' HQ - Floor 4 ' }),
    );

    expect(created.title).toBe('Engineer');
    expect(created.office).toBe('HQ - Floor 4');
  });
});

/* ================================================================ validation === */

describe('employeeId validation at entry', () => {
  it('rejects an id containing a character the BLE payload cannot carry', async () => {
    const result = await manager.addEmployee(input('EMP 001'));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/letters, numbers/i);
  });

  it('rejects a bad id before writing anything, rather than failing later on the phone', async () => {
    await manager.addEmployee(input('EMP/001'));

    expect(manager.count()).toBe(0);
    expect(manager.resolve('EMP/001')).toBeNull();
    expect(await EmployeeStorage.getAll()).toEqual([]);
  });

  it('rejects an id whose only fault is a non-ASCII character', async () => {
    const result = await manager.addEmployee(input('EMP_Uenicodé'));

    expect(result.ok).toBe(false);
    expect(manager.count()).toBe(0);
  });

  it('rejects an empty employee id with the "required" message, not the pattern message', async () => {
    const result = await manager.addEmployee(input('   '));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/required/i);
  });

  it('accepts an id of exactly the BLE packet limit but rejects one character more', async () => {
    const atLimit = 'A'.repeat(MAX_EMPLOYEE_ID_BYTES);
    const overLimit = 'A'.repeat(MAX_EMPLOYEE_ID_BYTES + 1);

    expect(await manager.addEmployee(input(atLimit))).toEqual({ ok: true });

    const rejected = await manager.addEmployee(input(overLimit));
    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && rejected.message).toContain(
      String(MAX_EMPLOYEE_ID_BYTES),
    );
  });

  it('rejects a blank display name even when the id is valid', async () => {
    const result = await manager.addEmployee(input('EMP_N1', { displayName: '   ' }));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/name is required/i);
    expect(manager.count()).toBe(0);
  });

  it('rejects a display name longer than 60 characters', async () => {
    const result = await manager.addEmployee(
      input('EMP_N2', { displayName: 'a'.repeat(61) }),
    );

    expect(result.ok).toBe(false);
    expect(manager.count()).toBe(0);
  });
});

/* ================================================================ duplicates === */

describe('duplicate employee ids', () => {
  it('rejects a second employee registered under an id already in the registry', async () => {
    await add(manager, input('EMP_D1', { displayName: 'Ada Lovelace' }));

    const result = await manager.addEmployee(
      input('EMP_D1', { displayName: 'Alan Turing' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('EMP_D1');
  });

  it('leaves the original employee untouched when a duplicate id is rejected', async () => {
    // The id is what the scanner matches on, so silently overwriting Ada with Alan would
    // credit her attendance to him.
    await add(manager, input('EMP_D2', { displayName: 'Ada Lovelace' }));
    await manager.addEmployee(input('EMP_D2', { displayName: 'Alan Turing' }));

    expect(manager.getById('EMP_D2')?.displayName).toBe('Ada Lovelace');
    expect(manager.count()).toBe(1);
    expect(await EmployeeStorage.count()).toBe(1);
  });

  it('detects a duplicate on the trimmed id, so padding cannot smuggle one in', async () => {
    await add(manager, input('EMP_D3'));

    const result = await manager.addEmployee(input('  EMP_D3  '));

    expect(result.ok).toBe(false);
    expect(manager.count()).toBe(1);
  });

  it('does not call an employee a duplicate of themselves when their own row is edited', async () => {
    await add(manager, input('EMP_D4', { displayName: 'Ada Lovelace' }));

    const result = await manager.updateEmployee(
      'EMP_D4',
      input('EMP_D4', { displayName: 'Ada L. Byron' }),
    );

    expect(result).toEqual({ ok: true });
    expect(manager.getById('EMP_D4')?.displayName).toBe('Ada L. Byron');
  });

  it('rejects an edit that moves an employee onto an id somebody else already holds', async () => {
    await add(manager, input('EMP_D5', { displayName: 'Ada Lovelace' }));
    await add(manager, input('EMP_D6', { displayName: 'Alan Turing' }));

    const result = await manager.updateEmployee('EMP_D5', input('EMP_D6'));

    expect(result.ok).toBe(false);
    expect(manager.getById('EMP_D6')?.displayName).toBe('Alan Turing');
    expect(manager.count()).toBe(2);
  });
});

/* ==================================================================== create === */

describe('addEmployee', () => {
  it('enables a new employee by default when the input says nothing about it', async () => {
    const created = await add(manager, input('EMP_C1'));

    expect(created.enabled).toBe(true);
  });

  it('honours enabled: false so someone can be registered but not yet scanned for', async () => {
    const created = await add(manager, input('EMP_C2', { enabled: false }));

    expect(created.enabled).toBe(false);
    expect(manager.getEnabled()).toEqual([]);
  });

  it('stamps createdAt and updatedAt from the clock at the moment of the write', async () => {
    const created = await add(manager, input('EMP_C3'));

    expect(created.createdAt).toBe(T0);
    expect(created.updatedAt).toBe(T0);
  });

  it('trims the id and name before storing, so the scanner matches the trimmed id', async () => {
    await manager.addEmployee(input('  EMP_C4  ', { displayName: '  Ada Lovelace  ' }));

    expect(manager.resolve('EMP_C4')?.displayName).toBe('Ada Lovelace');
    expect(manager.resolve('  EMP_C4  ')).toBeNull();
  });

  it('makes the new employee resolvable and persists them for the next launch', async () => {
    await add(manager, input('EMP_C5'));

    expect(manager.resolve('EMP_C5')).not.toBeNull();

    // A fresh manager is what a restart looks like: memory is gone, storage is not.
    const restarted = new EmployeeManager();
    expect(restarted.isLoaded()).toBe(false);
    await restarted.initialize();

    expect(restarted.isLoaded()).toBe(true);
    expect(restarted.resolve('EMP_C5')?.displayName).toBe('Ada Lovelace');
  });

  it('returns null from resolve for an id that was never registered', async () => {
    await add(manager, input('EMP_C6'));

    expect(manager.resolve('EMP_NOT_REGISTERED')).toBeNull();
  });
});

/* ==================================================================== update === */

describe('updateEmployee', () => {
  it('preserves createdAt and moves updatedAt to the time of the edit', async () => {
    const created = await add(manager, input('EMP_U1'));
    jest.setSystemTime(T0 + ONE_MINUTE);

    await manager.updateEmployee('EMP_U1', input('EMP_U1', { displayName: 'Ada Byron' }));

    const updated = manager.getById('EMP_U1');
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).toBe(T0 + ONE_MINUTE);
  });

  it('preserves enabled when the edit does not mention it', async () => {
    await add(manager, input('EMP_U2', { enabled: false }));

    await manager.updateEmployee('EMP_U2', input('EMP_U2', { displayName: 'Ada Byron' }));

    expect(manager.getById('EMP_U2')?.enabled).toBe(false);
  });

  it('clears an optional field to undefined, not to an empty string, when the user empties the box', async () => {
    await add(manager, input('EMP_U3', { title: 'Engineer', office: 'HQ' }));

    await manager.updateEmployee('EMP_U3', input('EMP_U3', { title: '', office: '' }));

    const updated = manager.getById('EMP_U3');
    expect(updated?.title).toBeUndefined();
    expect(updated?.office).toBeUndefined();
  });

  it(
    'replaces the optional fields wholesale: an edit that omits one clears it',
    async () => {
      // CONTRACT, not an oversight. updateEmployee takes a whole employee, not a patch.
      //
      // It cannot do otherwise: optionalFields() runs every value through clean(),
      // which maps BOTH undefined and '' to undefined. By the time the merge happens,
      // "said nothing about title" and "emptied the title box" are the same value, so
      // no `?? existing.title` can tell them apart — adding one would simply make
      // clearing a field impossible, breaking the test directly above.
      //
      // (`enabled: input.enabled ?? existing.enabled` is not the same case: enabled is
      // a boolean and never passes through clean(), so undefined there does mean
      // "not supplied".)
      //
      // The single caller honours this. AddEmployeeScreen.tsx:91 submits a complete
      // input built from a form seeded with the existing employee, so no field is ever
      // accidentally omitted. Any future caller must do the same.
      await add(manager, input('EMP_U4', { title: 'Engineer', department: 'IT' }));

      await manager.updateEmployee(
        'EMP_U4',
        input('EMP_U4', { displayName: 'Ada Byron' }),
      );

      expect(manager.getById('EMP_U4')?.title).toBeUndefined();
      expect(manager.getById('EMP_U4')?.department).toBeUndefined();
      // What the edit DID supply is kept, so this is a replace and not a wipe.
      expect(manager.getById('EMP_U4')?.displayName).toBe('Ada Byron');
    },
  );

  it('refuses to update an employee who is not in the registry', async () => {
    const result = await manager.updateEmployee('EMP_GHOST', input('EMP_GHOST'));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/no longer exists/i);
    expect(manager.count()).toBe(0);
  });

  it('re-keys the registry when the employee id itself changes', async () => {
    await add(manager, input('EMP_U5', { displayName: 'Ada Lovelace' }));

    const result = await manager.updateEmployee('EMP_U5', input('EMP_U6'));

    expect(result).toEqual({ ok: true });
    expect(manager.resolve('EMP_U5')).toBeNull();
    expect(manager.resolve('EMP_U6')?.displayName).toBe('Ada Lovelace');
    expect(manager.count()).toBe(1);
  });

  it('deletes the old row from storage when the id changes, leaving no ghost behind', async () => {
    await add(manager, input('EMP_U7'));

    await manager.updateEmployee('EMP_U7', input('EMP_U8'));

    expect(await EmployeeStorage.getById('EMP_U7')).toBeNull();
    expect(await EmployeeStorage.count()).toBe(1);
  });

  it('rejects an edit that makes the id unbroadcastable, leaving the stored row intact', async () => {
    await add(manager, input('EMP_U9'));

    const result = await manager.updateEmployee('EMP_U9', input('EMP U9'));

    expect(result.ok).toBe(false);
    expect(manager.resolve('EMP_U9')).not.toBeNull();
    expect(manager.count()).toBe(1);
  });
});

/* ==================================================================== remove === */

describe('removeEmployee', () => {
  it('does not throw when asked to remove an id that was never registered', async () => {
    await expect(manager.removeEmployee('EMP_NEVER_EXISTED')).resolves.toBeUndefined();
  });

  it('leaves the rest of the registry alone when an unknown id is removed', async () => {
    await add(manager, input('EMP_R1'));

    await manager.removeEmployee('EMP_NEVER_EXISTED');

    expect(manager.count()).toBe(1);
    expect(manager.resolve('EMP_R1')).not.toBeNull();
    expect(await EmployeeStorage.count()).toBe(1);
  });

  it('stops resolving a removed employee, in memory and in storage', async () => {
    await add(manager, input('EMP_R2'));

    await manager.removeEmployee('EMP_R2');

    expect(manager.resolve('EMP_R2')).toBeNull();
    expect(manager.count()).toBe(0);
    expect(await EmployeeStorage.getById('EMP_R2')).toBeNull();
  });
});

/* ============================================================== enable/disable == */

describe('setEnabled', () => {
  it('drops a disabled employee from getEnabled but keeps them in the registry', async () => {
    await add(manager, input('EMP_E1', { displayName: 'Ada Lovelace' }));
    await add(manager, input('EMP_E2', { displayName: 'Alan Turing' }));

    await manager.setEnabled('EMP_E1', false);

    expect(manager.getEnabled().map(e => e.employeeId)).toEqual(['EMP_E2']);
    expect(manager.count()).toBe(2);
    expect(manager.getById('EMP_E1')?.enabled).toBe(false);
  });

  it('does nothing, and does not throw, for an id that is not registered', async () => {
    await expect(manager.setEnabled('EMP_GHOST', false)).resolves.toBeUndefined();

    expect(manager.count()).toBe(0);
  });
});

/* =============================================================== reads/notify === */

describe('registry reads and subscriptions', () => {
  it('sorts getAll by display name rather than by insertion order', async () => {
    await add(manager, input('EMP_L1', { displayName: 'Zoe Zeta' }));
    await add(manager, input('EMP_L2', { displayName: 'Ada Alpha' }));
    await add(manager, input('EMP_L3', { displayName: 'Mia Mu' }));

    expect(manager.getAll().map(e => e.displayName)).toEqual([
      'Ada Alpha',
      'Mia Mu',
      'Zoe Zeta',
    ]);
  });

  it('delivers the current registry to a new subscriber immediately', async () => {
    await add(manager, input('EMP_V1'));
    const seen: string[][] = [];

    manager.subscribe(list => seen.push(list.map(e => e.employeeId)));

    expect(seen).toEqual([['EMP_V1']]);
  });

  it('notifies subscribers on add and on remove, and stops after unsubscribe', async () => {
    const seen: number[] = [];
    const unsubscribe = manager.subscribe(list => seen.push(list.length));

    await add(manager, input('EMP_V2'));
    await manager.removeEmployee('EMP_V2');
    unsubscribe();
    await add(manager, input('EMP_V3'));

    expect(seen).toEqual([0, 1, 0]);
  });
});
