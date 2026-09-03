/**
 * EmployeeStorage.ts
 * -----------------------------------------------------------------------------
 * Persistence for the Host's employee registry.
 *
 * Registration is an ADMIN fact and is completely independent of attendance:
 * being in this table means "the Host will listen for this ID", never
 * "this person is present".
 * -----------------------------------------------------------------------------
 */

import type { Employee } from '../employees/employeeTypes';
import { readJson, STORAGE_KEYS, WriteQueue, writeJson } from './AppStorage';

const queue = new WriteQueue();

async function readAll(): Promise<Employee[]> {
  return readJson<Employee[]>(STORAGE_KEYS.employees, []);
}

export const EmployeeStorage = {
  async getAll(): Promise<Employee[]> {
    return readAll();
  },

  async getById(employeeId: string): Promise<Employee | null> {
    const all = await readAll();
    return all.find(e => e.employeeId === employeeId) ?? null;
  },

  async upsert(employee: Employee): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      const index = all.findIndex(e => e.employeeId === employee.employeeId);
      if (index >= 0) {
        all[index] = employee;
      } else {
        all.push(employee);
      }
      await writeJson(STORAGE_KEYS.employees, all);
    });
  },

  /**
   * Remove from the registry.
   *
   * Historical attendance is intentionally left intact: past attendance is a
   * factual record of who was present on a given day, and removing a person
   * from the roster should not rewrite it.
   */
  async remove(employeeId: string): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      await writeJson(
        STORAGE_KEYS.employees,
        all.filter(e => e.employeeId !== employeeId),
      );
    });
  },

  async setEnabled(employeeId: string, enabled: boolean): Promise<void> {
    await queue.run(async () => {
      const all = await readAll();
      const index = all.findIndex(e => e.employeeId === employeeId);
      if (index < 0) {
        return;
      }
      all[index] = { ...all[index], enabled, updatedAt: Date.now() };
      await writeJson(STORAGE_KEYS.employees, all);
    });
  },

  async count(): Promise<number> {
    return (await readAll()).length;
  },
};
