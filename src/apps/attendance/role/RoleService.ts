/**
 * RoleService.ts
 * -----------------------------------------------------------------------------
 * The single authority on what this device is allowed to do.
 *
 *   ONE device  = HOST      scans, detects employees, owns the attendance data
 *   MANY devices = EMPLOYEE advertises an identifier, never scans
 *
 * WHY THIS IS A SERVICE AND NOT JUST A SETTING
 *
 * Hiding a button is not enforcement. A screen can be deep-linked, a callback
 * can fire after a role change, a refactor can call the wrong function. So the
 * role is checked at the point where the BLE work actually happens, and a
 * violation throws rather than quietly doing the wrong thing.
 *
 * SYNCHRONOUS ON PURPOSE
 *
 * The guards run inside BLE start paths and, indirectly, scan callbacks. Those
 * cannot await storage. So the role is loaded once at startup into a module
 * cache and read synchronously afterwards; every write updates the cache and
 * storage together, so they cannot drift.
 * -----------------------------------------------------------------------------
 */

import { SETTINGS_KEYS, type AppRole } from '../constants/appConfig';
import { SettingsStorage } from '../storage/SettingsStorage';
import { log } from '../utils/logger';

/**
 * Thrown when a device attempts an operation its role does not permit.
 *
 * A distinct class so callers can tell a role violation - a programming error
 * or a genuine misuse - apart from an ordinary Bluetooth failure.
 */
export class RoleViolationError extends Error {
  readonly requiredRole: AppRole;
  readonly actualRole: AppRole | null;

  constructor(requiredRole: AppRole, actualRole: AppRole | null, operation: string) {
    super(
      requiredRole === 'HOST'
        ? 'Host functionality is unavailable on Employee devices. Blocked: ' + operation
        : 'Employee functionality is unavailable on Host devices. Blocked: ' + operation,
    );
    this.name = 'RoleViolationError';
    this.requiredRole = requiredRole;
    this.actualRole = actualRole;
  }
}

/** null means the role has not been chosen yet - first launch. */
let cachedRole: AppRole | null = null;
let loaded = false;

type RoleListener = (role: AppRole | null) => void;
const listeners = new Set<RoleListener>();

/**
 * Load the persisted role. Must be awaited once during startup, before any BLE
 * operation, so the synchronous guards below have a truthful value to read.
 */
export async function loadRole(): Promise<AppRole | null> {
  const stored = (await SettingsStorage.get(SETTINGS_KEYS.role)) as AppRole | null;
  cachedRole = stored === 'HOST' || stored === 'EMPLOYEE' ? stored : null;
  loaded = true;
  log.info('BLE', 'Device role: ' + (cachedRole ?? 'not chosen yet'));
  return cachedRole;
}

/** Synchronous read. Returns null before loadRole() has completed. */
export function getRole(): AppRole | null {
  return cachedRole;
}

export function isRoleLoaded(): boolean {
  return loaded;
}

export function isHost(): boolean {
  return cachedRole === 'HOST';
}

export function isEmployee(): boolean {
  return cachedRole === 'EMPLOYEE';
}

/** Persist a role and update the cache in the same step. */
export async function setRole(role: AppRole): Promise<void> {
  cachedRole = role;
  loaded = true;
  await SettingsStorage.set(SETTINGS_KEYS.role, role);
  log.info('BLE', 'Device role set to ' + role);
  listeners.forEach(listener => listener(role));
}

/** Clear the role, returning the device to the first-launch chooser. */
export async function clearRole(): Promise<void> {
  cachedRole = null;
  await SettingsStorage.remove(SETTINGS_KEYS.role);
  log.warn('BLE', 'Device role cleared');
  listeners.forEach(listener => listener(null));
}

export function subscribeToRole(listener: RoleListener): () => void {
  listeners.add(listener);
  listener(cachedRole);
  return () => {
    listeners.delete(listener);
  };
}

/* =============================================================================
 * GUARDS
 * -----------------------------------------------------------------------------
 * Called at the top of every role-restricted operation. They throw, rather
 * than returning false, so a violation cannot be accidentally ignored by a
 * caller that forgets to check a return value.
 * ========================================================================== */

export function assertHost(operation: string): void {
  if (cachedRole !== 'HOST') {
    const error = new RoleViolationError('HOST', cachedRole, operation);
    log.error('BLE', error.message);
    throw error;
  }
}

export function assertEmployee(operation: string): void {
  if (cachedRole !== 'EMPLOYEE') {
    const error = new RoleViolationError('EMPLOYEE', cachedRole, operation);
    log.error('BLE', error.message);
    throw error;
  }
}

/** Non-throwing variants, for rendering decisions rather than enforcement. */
export function canScan(): boolean {
  return isHost();
}

export function canAdvertise(): boolean {
  return isEmployee();
}
