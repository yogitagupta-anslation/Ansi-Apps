/**
 * HostAttendanceService.ts
 * -----------------------------------------------------------------------------
 * HOST-only application service. The seam between "the Host wants to detect
 * employees" and the BLE scanner.
 *
 *     UI -> HostAttendanceService -> BleScanner -> native BLE
 *                                 -> AttendanceManager -> storage
 *
 * This is where scanning is wired to attendance. No React component starts a
 * scan or feeds the attendance engine directly.
 *
 * Every entry point asserts the HOST role. BleScanner asserts it too - the
 * double check is deliberate: this layer gives a friendly, catchable failure,
 * and the BLE layer guarantees the rule holds even if something bypasses this
 * service entirely.
 * -----------------------------------------------------------------------------
 */

import type { AttendanceManager } from '../attendance/AttendanceManager';
import {
  startScan,
  stopScan,
  updateScannerConfig,
  type StartScanResult,
} from '../bluetooth/BleScanner';
import type { ProximityConfig } from '../constants/proximityConfig';
import type { EmployeeManager } from '../employees/EmployeeManager';
import { assertHost, isHost, RoleViolationError } from '../role/RoleService';
import { StatusDeliveryService } from './StatusDeliveryService';
import { log } from '../utils/logger';

export interface HostScanOptions {
  proximity: ProximityConfig;
  verboseLogging: boolean;
  employeeManager: EmployeeManager;
  attendanceManager: AttendanceManager;
  /** Stamped into delivered status reports for on-screen attribution. */
  hostId: string;
}

export const HostAttendanceService = {
  /**
   * Begin real BLE scanning and route every detection into the attendance
   * engine. Returns the scanner's own result - it never reports success for a
   * scan that did not start.
   */
  startScanning(options: HostScanOptions): StartScanResult {
    try {
      assertHost('HostAttendanceService.startScanning');
    } catch (error) {
      if (error instanceof RoleViolationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }

    const { proximity, verboseLogging, employeeManager, attendanceManager, hostId } = options;

    StatusDeliveryService.setHostId(hostId);

    return startScan({
      rssiThreshold: proximity.minimumRssi,
      detectionTimeoutMs: proximity.detectionWindowMs,
      verboseLogging,
      // Required for screen-off scanning on Android 8.1+; without a filter the
      // platform silently returns nothing once the screen is off.
      useServiceUuidFilter: true,
      resolveEmployee: employeeManager.resolve,
      onDetection: detection => {
        // Fire-and-forget: the scan callback must never await storage, or BLE
        // callbacks would queue behind disk writes.
        void attendanceManager.detectEmployee(detection);

        /**
         * Reply channel: hand the employee's CURRENT address plus their
         * record to the delivery service. On the very first detection the
         * record may not be written yet — maybeDeliver treats null as a
         * no-op and the next advertisement (~1s later) retries with the
         * record in place. The address is used now and never stored, because
         * Android rotates it.
         */
        void StatusDeliveryService.maybeDeliver(
          detection.deviceId,
          attendanceManager.getTodayRecord(detection.employeeId),
        );
      },
    });
  },

  /**
   * Stop scanning.
   *
   * Deliberately NOT role-guarded: stopping is always safe, and a device that
   * has just switched away from Host must still be able to shut its scanner
   * down. Refusing to stop would strand the radio.
   */
  stopScanning(): void {
    stopScan();
  },

  /** Apply changed settings to a running scan without restarting the radio. */
  applyConfig(proximity: ProximityConfig, verboseLogging: boolean): void {
    if (!isHost()) {
      return;
    }
    updateScannerConfig({
      rssiThreshold: proximity.minimumRssi,
      detectionTimeoutMs: proximity.detectionWindowMs,
      verboseLogging,
    });
  },

  /** Release Host-owned BLE resources, e.g. before a role change. */
  teardown(): void {
    log.info('SCAN', 'Host attendance service tearing down');
    StatusDeliveryService.reset();
    stopScan();
  },
};
