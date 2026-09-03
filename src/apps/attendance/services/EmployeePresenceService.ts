/**
 * EmployeePresenceService.ts
 * -----------------------------------------------------------------------------
 * EMPLOYEE-only application service.
 *
 *     UI -> EmployeePresenceService -> BleAdvertiser -> native Kotlin advertiser
 *
 * "Presence" here means only "this device is broadcasting its identity".
 * The Host still owns attendance — but since the reply channel was added the
 * Host CONNECTS BACK and writes the recorded status into this device's GATT
 * characteristic. Reports arriving there are validated, filtered to this
 * device's own employee id, and stored in EmployeeStatusStore; they are the
 * only source the UI may show a check-in time from.
 * -----------------------------------------------------------------------------
 */

import {
  startAdvertising,
  stopAdvertising,
  subscribeToStatusReports,
  validateEmployeeId,
  type AdvertiseResult,
} from '../bluetooth/BleAdvertiser';
import { EmployeeStatusStore } from '../attendance/EmployeeStatusStore';
import { assertEmployee, RoleViolationError } from '../role/RoleService';
import { log } from '../utils/logger';

let statusSubscription: (() => void) | null = null;

export const EmployeePresenceService = {
  /** Begin broadcasting this employee's identifier over real BLE. */
  async startBroadcasting(employeeId: string): Promise<AdvertiseResult> {
    try {
      assertEmployee('EmployeePresenceService.startBroadcasting');
    } catch (error) {
      if (error instanceof RoleViolationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }

    const validationError = validateEmployeeId(employeeId);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const result = await startAdvertising(employeeId);

    if (result.success) {
      // (Re)arm the reply-channel listener. The filter to OUR OWN id is a
      // trust-boundary rule, not tidiness: any central can write to the
      // characteristic, and a report about someone else is either a Host bug
      // or an impersonation attempt — both get dropped and logged.
      statusSubscription?.();
      const ownId = employeeId.trim();
      statusSubscription = subscribeToStatusReports(report => {
        if (report.employeeId !== ownId) {
          log.warn(
            'ADVERTISE',
            'Dropped status report addressed to ' + report.employeeId + ' (we are ' + ownId + ')',
          );
          return;
        }
        void EmployeeStatusStore.accept(report);
      });
    }

    return result;
  },

  /**
   * Stop broadcasting.
   *
   * Not role-guarded, for the same reason as stopScanning: a device leaving
   * the Employee role must still be able to release the radio, and a leaked
   * advertisement holds a slot in the Bluetooth stack until Bluetooth is
   * toggled or the phone reboots.
   */
  async stopBroadcasting(): Promise<AdvertiseResult> {
    return stopAdvertising();
  },

  /** Release Employee-owned BLE resources, e.g. before a role change. */
  async teardown(): Promise<void> {
    log.info('ADVERTISE', 'Employee presence service tearing down');
    statusSubscription?.();
    statusSubscription = null;
    await stopAdvertising();
  },
};
