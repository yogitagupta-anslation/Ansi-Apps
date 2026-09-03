/**
 * EmployeeManager.ts
 * -----------------------------------------------------------------------------
 * The Host's employee registry.
 *
 * This is the gate between "a BLE advertisement arrived" and "an employee was
 * detected". An advertisement carrying an id that is not registered here, or
 * that belongs to a disabled employee, never reaches the attendance engine.
 *
 * Holds an in-memory index because the scanner resolves an id on every single
 * advertisement - many times per second - and that lookup must be synchronous
 * and free. Storage remains the source of truth; this is a cache kept in sync
 * on every write.
 * -----------------------------------------------------------------------------
 */

import { EMPLOYEE_ID_PATTERN } from '../constants/appConfig';
import { MAX_EMPLOYEE_ID_BYTES } from '../constants/bluetoothConfig';
import { EmployeeStorage } from '../storage/EmployeeStorage';
import { log } from '../utils/logger';
import type { Employee, EmployeeInput } from './employeeTypes';

type EmployeeListener = (employees: Employee[]) => void;

export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Copy the optional profile fields off an input, trimmed, dropping blanks.
 *
 * Blank has to become `undefined` rather than `''`: an empty string would make
 * "no department" render as a stray separator in the list and would match every
 * substring search. Whitespace-only input is treated as blank for the same
 * reason.
 *
 * These fields were previously accepted by the form and then silently discarded
 * here, which is why department never appeared in the registry.
 */
function optionalFields(input: EmployeeInput): Pick<Employee, 'department' | 'phone' | 'email' | 'photo'> {
  const clean = (v: string | undefined) => {
    const trimmed = (v ?? '').trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    department: clean(input.department),
    phone: clean(input.phone),
    email: clean(input.email),
    // A data URI has no meaningful whitespace to trim, but blank -> undefined
    // still matters: an empty-string photo would render a broken Image.
    photo: clean(input.photo),
  };
}

export class EmployeeManager {
  private index = new Map<string, Employee>();
  private listeners = new Set<EmployeeListener>();
  private loaded = false;

  async initialize(): Promise<void> {
    const employees = await EmployeeStorage.getAll();
    this.index.clear();
    employees.forEach(e => this.index.set(e.employeeId, e));
    this.loaded = true;
    log.info('BLE', 'Employee registry loaded: ' + employees.length + ' employee(s)');
    this.notify();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Synchronous registry lookup, injected into the BLE scanner.
   *
   * Must stay synchronous and allocation-free: it runs on every advertisement.
   */
  resolve = (employeeId: string): Employee | null => {
    return this.index.get(employeeId) ?? null;
  };

  getAll(): Employee[] {
    return Array.from(this.index.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  getEnabled(): Employee[] {
    return this.getAll().filter(e => e.enabled);
  }

  getById(employeeId: string): Employee | null {
    return this.index.get(employeeId) ?? null;
  }

  count(): number {
    return this.index.size;
  }

  /* ----------------------------------------------------------- validation -- */

  /**
   * Validate before writing. The id length limit is not arbitrary - it comes
   * from the 31-byte BLE advertising packet, so an id that cannot be broadcast
   * is rejected at entry rather than failing silently on the employee's phone.
   */
  validate(input: EmployeeInput, options?: { allowExistingId?: string }): ValidationResult {
    const employeeId = input.employeeId.trim();
    const displayName = input.displayName.trim();

    if (employeeId.length === 0) {
      return { ok: false, message: 'Employee ID is required.' };
    }
    if (!EMPLOYEE_ID_PATTERN.test(employeeId)) {
      return {
        ok: false,
        message: 'Employee ID may only contain letters, numbers, hyphen and underscore.',
      };
    }
    if (employeeId.length > MAX_EMPLOYEE_ID_BYTES) {
      return {
        ok: false,
        message:
          'Employee ID must be ' +
          MAX_EMPLOYEE_ID_BYTES +
          ' characters or fewer so it fits in the BLE advertising packet.',
      };
    }
    if (displayName.length === 0) {
      return { ok: false, message: 'Employee name is required.' };
    }
    if (displayName.length > 60) {
      return { ok: false, message: 'Employee name is too long.' };
    }

    const clash = this.index.get(employeeId);
    if (clash && clash.employeeId !== options?.allowExistingId) {
      return {
        ok: false,
        message: 'An employee with ID "' + employeeId + '" already exists.',
      };
    }

    return { ok: true };
  }

  /* --------------------------------------------------------------- writes -- */

  async addEmployee(input: EmployeeInput): Promise<ValidationResult> {
    const validation = this.validate(input);
    if (!validation.ok) {
      return validation;
    }

    const now = Date.now();
    const employee: Employee = {
      employeeId: input.employeeId.trim(),
      displayName: input.displayName.trim(),
      ...optionalFields(input),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    await EmployeeStorage.upsert(employee);
    this.index.set(employee.employeeId, employee);
    log.info('BLE', 'Employee registered: ' + employee.employeeId);
    this.notify();
    return { ok: true };
  }

  async updateEmployee(
    originalId: string,
    input: EmployeeInput,
  ): Promise<ValidationResult> {
    const existing = this.index.get(originalId);
    if (!existing) {
      return { ok: false, message: 'That employee no longer exists.' };
    }

    const validation = this.validate(input, { allowExistingId: originalId });
    if (!validation.ok) {
      return validation;
    }

    const updated: Employee = {
      ...existing,
      employeeId: input.employeeId.trim(),
      displayName: input.displayName.trim(),
      ...optionalFields(input),
      enabled: input.enabled ?? existing.enabled,
      updatedAt: Date.now(),
    };

    // Changing the id means a different registry key, so remove the old row.
    if (updated.employeeId !== originalId) {
      await EmployeeStorage.remove(originalId);
      this.index.delete(originalId);
    }

    await EmployeeStorage.upsert(updated);
    this.index.set(updated.employeeId, updated);
    log.info('BLE', 'Employee updated: ' + updated.employeeId);
    this.notify();
    return { ok: true };
  }

  /**
   * Remove an employee from the registry.
   *
   * Their historical attendance records are intentionally left intact - past
   * attendance is a factual record of who was present on a given day, and
   * deleting a person should not rewrite history.
   */
  async removeEmployee(employeeId: string): Promise<void> {
    await EmployeeStorage.remove(employeeId);
    this.index.delete(employeeId);
    log.info('BLE', 'Employee removed from registry: ' + employeeId);
    this.notify();
  }

  /** Disable without deleting - for someone on leave. */
  async setEnabled(employeeId: string, enabled: boolean): Promise<void> {
    const existing = this.index.get(employeeId);
    if (!existing) {
      return;
    }
    const updated: Employee = { ...existing, enabled, updatedAt: Date.now() };
    await EmployeeStorage.setEnabled(employeeId, enabled);
    this.index.set(employeeId, updated);
    log.info('BLE', 'Employee ' + employeeId + (enabled ? ' enabled' : ' disabled'));
    this.notify();
  }

  /* -------------------------------------------------------- subscriptions -- */

  subscribe(listener: EmployeeListener): () => void {
    this.listeners.add(listener);
    listener(this.getAll());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const employees = this.getAll();
    this.listeners.forEach(listener => listener(employees));
  }
}
