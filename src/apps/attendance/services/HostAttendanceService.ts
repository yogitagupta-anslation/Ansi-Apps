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

/**
 * Which employees were broadcasting a check-out on the LAST advertisement we
 * saw from them.
 *
 * The flag is a level, not a pulse: it stays in every packet until a receipt
 * comes back, so an employee sends it several times a second. Acting on the
 * level re-recorded the departure on every one of those, walking leftTime
 * forward continuously — which appended a CHECK_OUT event per advertisement
 * (evicting real history from the 50-entry log), and, worse, meant the record
 * never held still: keyOf changes with leftTime, so the report being delivered
 * was stale before the connection finished and the employee never got the
 * receipt that would have told them to stop asking.
 *
 * So: act on the RISING EDGE. One request, one recorded departure. Lowering
 * the flag re-arms it, which is exactly what "check out again" needs — the
 * phone drops the flag when the receipt lands, and raising it later is a new
 * edge and a new, later departure.
 */
const checkOutIntentSeen = new Map<string, boolean>();

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
        /**
         * Still fire-and-forget: `void` on the whole chain means the scan
         * callback returns immediately and BLE callbacks never queue behind
         * disk writes. What is new is that the three steps now run IN ORDER
         * rather than racing, which is what lets a declared departure be
         * delivered on the same advertisement that announced it.
         */
        void (async () => {
          await attendanceManager.detectEmployee(detection);

          /**
           * The employee is declaring a departure.
           *
           * `Date.now()` is this Host's clock at the moment it saw the flag —
           * the only clock involved, so there is no skew to correct. The lag
           * behind the actual tap is one scan interval, because the flag rides
           * the advertisement instead of waiting for a connection.
           *
           * Ordered after detectEmployee on purpose: that call is what creates
           * or updates today's record, and recordDeclaredCheckOut refuses a
           * departure for an employee with no check-in. On a first sighting it
           * declines and the next advertisement (~1s later) succeeds, because
           * the phone keeps the flag up until a receipt comes back.
           *
           * Deliberately NOT gated on isNearby. The threshold exists to stop a
           * weak reflection from being mistaken for arrival — but this is not
           * an inference from signal strength, it is a statement the employee
           * made, and it is just as true from the far side of the room.
           */
          const wasSignalling = checkOutIntentSeen.get(detection.employeeId) === true;

          if (detection.checkOutIntent) {
            checkOutIntentSeen.set(detection.employeeId, true);
            if (!wasSignalling) {
              /**
               * One flag, two meanings, decided by what the record already
               * holds — which is why no second signal had to go on the air.
               *
               * A declared departure already standing means this press is the
               * employee taking it back: they are still here, and the radio
               * agrees, because we are reading this off a live advertisement.
               * Otherwise it is a departure being declared for the first time.
               *
               * The pair composes into the whole flow. Check out by mistake,
               * press again to undo; leave for real later, press once more.
               */
              const record = attendanceManager.getTodayRecord(detection.employeeId);
              const undoing =
                record?.leftTime != null && record.leftTimeSource === 'DECLARED';

              if (undoing) {
                await attendanceManager.cancelDeclaredCheckOut(detection.employeeId);
              } else {
                await attendanceManager.recordDeclaredCheckOut(
                  detection.employeeId,
                  Date.now(),
                );
              }
            }
          } else if (wasSignalling) {
            // Flag down: the request was answered, cancelled, or the phone went
            // off air. Re-arm so a later request is heard as a new one.
            checkOutIntentSeen.delete(detection.employeeId);
          }

          /**
           * Reply channel: hand the employee's CURRENT address plus their
           * record to the delivery service. The address is used now and never
           * stored, because Android rotates it.
           *
           * Reading the record AFTER the two awaits above is what makes the
           * receipt prompt: a departure recorded a moment ago changes
           * leftTime, which changes keyOf's fingerprint, which re-arms
           * delivery — so the employee's phone learns its own check-out time
           * on this same pass rather than waiting for something else to
           * change.
           */
          void StatusDeliveryService.maybeDeliver(
            detection.deviceId,
            attendanceManager.getTodayRecord(detection.employeeId),
          );
        })();
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
    // Edge state is meaningless once we stop listening: an employee still
    // holding their flag up must be heard afresh when scanning resumes, or
    // their request would be silently ignored for the rest of the day.
    checkOutIntentSeen.clear();
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
