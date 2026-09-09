/**
 * StatusDeliveryService.ts
 * -----------------------------------------------------------------------------
 * HOST-only. The other half of the attendance reply channel: after the
 * attendance engine records a check-in (or marks someone as left), this
 * service CONNECTS to the employee's phone and writes the recorded status
 * into its GATT characteristic, so the employee can finally see their own
 * check-in on their own screen.
 *
 *     detection -> AttendanceManager (records) -> StatusDeliveryService
 *                -> ble-plx connect -> write statusReport -> disconnect
 *
 * DELIVERY RULES
 * --------------
 * - A report is delivered once per distinct content (status + times); when
 *   the record changes (a LEFT time appears, a re-check-in updates it),
 *   delivery re-arms automatically because the content fingerprint changed.
 * - One connection at a time, per-employee cooldown between attempts. BLE
 *   connects are expensive and the scan keeps running underneath; hammering
 *   the stack with parallel connects is how scans silently die.
 * - Failures retry on a later detection of the same employee. No persistent
 *   queue: if the employee never comes back in range there is nobody to
 *   deliver to anyway.
 * - LEFT delivery only works while the employee is still detectable (grace
 *   period edge: they may already be gone). Best effort, honestly logged.
 *
 * The employee's device address comes from the live scan result. Android
 * rotates addresses (~15 min), so the address is used IMMEDIATELY after a
 * detection and never stored.
 * -----------------------------------------------------------------------------
 */

import type { AttendanceRecord } from '../attendance/attendanceTypes';
import { getBleManager } from '../bluetooth/BleManager';
import {
  encodeStatusReport,
  packHistory,
  type HistoryDay,
  type StatusReport,
} from '../bluetooth/statusReport';
import { buildMonthlyReport } from '../attendance/monthlyReport';
import { AttendanceStorage } from '../storage/AttendanceStorage';
import { SERVICE_UUID_128, STATUS_CHAR_UUID } from '../constants/bluetoothConfig';
import { isHost } from '../role/RoleService';
import { bytesToBase64 } from '../utils/bytes';
import { describeError, log } from '../utils/logger';

/** Minimum gap between delivery attempts to the same employee. */
const ATTEMPT_COOLDOWN_MS = 20_000;
/** Give up a connection attempt after this long; the scan needs the radio. */
const CONNECT_TIMEOUT_MS = 8_000;
/**
 * Default ATT MTU is 23 bytes — far too small. 517 is the BLE maximum and is
 * requested because a report now carries a month of packed history (~460
 * bytes) alongside today's status. Android negotiates down if the peer cannot
 * manage it, and the delivery code trims history to whatever was agreed.
 */
const REQUESTED_MTU = 517;

interface DeliveryState {
  /** Content fingerprint of the last successfully delivered report. */
  deliveredKey: string | null;
  nextAttemptAt: number;
}

const stateByEmployee = new Map<string, DeliveryState>();
let inFlight = false;
let hostId = 'HOST';

function keyOf(record: AttendanceRecord): string {
  return [record.date, record.checkInTime, record.leftTime].join('|');
}

/** Minutes since local midnight, for the packed wire form. */
function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * This employee's month so far, as the Host recorded it.
 *
 * Only days the Host actually has a verdict on are included. Non-working days
 * are omitted entirely: the employee treats a day it was never told about as
 * "no record", which is the truthful reading — the phone genuinely cannot
 * distinguish a holiday from a day the office was shut.
 */
async function buildHistoryFor(employeeId: string, monthKey: string): Promise<HistoryDay[]> {
  const records = await AttendanceStorage.getAll();
  // The registry is not needed: this is one employee's own days, and
  // buildMonthlyReport falls back to the record's own name for unknown ids.
  const report = buildMonthlyReport({ monthKey, records, employees: [] });
  const mine = report.employees.find(e => e.employeeId === employeeId);
  if (!mine) {
    return [];
  }

  return mine.days
    .filter(d => d.status !== 'NOT_APPLICABLE')
    .map(d => {
      /**
       * A declared departure is reported as itself.
       *
       * The default below is the last OBSERVED detection, which matches the
       * Excel report. But when the employee STATED a departure, that statement
       * is the number their phone already showed them as confirmed, and
       * replacing it here with a later last-seen reading would silently
       * rewrite it on the following day's sync. Two real observations exist;
       * this picks the one the employee was told about, and labels it.
       */
      const declared = d.record?.leftTimeSource === 'DECLARED' && d.record.leftTime != null;

      return {
        date: d.date,
        status: d.status as HistoryDay['status'],
        checkInMinutes:
          d.record?.checkInTime != null ? minutesOfDay(d.record.checkInTime) : null,
        checkOutMinutes: declared
          ? minutesOfDay(d.record!.leftTime!)
          : d.record?.lastSeenTime != null
          ? minutesOfDay(d.record.lastSeenTime)
          : null,
        ...(declared ? { checkOutDeclared: true } : {}),
      };
    });
}

export const StatusDeliveryService = {
  /** The host id stamped into every report, for on-screen attribution. */
  setHostId(id: string): void {
    if (id.trim().length > 0) {
      hostId = id.trim();
    }
  },

  reset(): void {
    stateByEmployee.clear();
    inFlight = false;
  },

  /**
   * Called from the detection path with the employee's CURRENT address and
   * their attendance record. Decides whether anything new needs delivering
   * and, if so, performs one guarded connect-write-disconnect cycle.
   *
   * Never throws: delivery is best-effort and must not disturb scanning.
   */
  async maybeDeliver(deviceId: string, record: AttendanceRecord | null): Promise<void> {
    // Quietly a no-op off the Host role — the scan path cannot run there
    // anyway, but this service must never be the thing that throws.
    if (!isHost() || !record || record.checkInTime === null) {
      return;
    }

    const now = Date.now();
    const state = stateByEmployee.get(record.employeeId) ?? {
      deliveredKey: null,
      nextAttemptAt: 0,
    };

    const key = keyOf(record);
    if (state.deliveredKey === key || now < state.nextAttemptAt || inFlight) {
      return;
    }

    const manager = getBleManager();
    if (!manager) {
      return;
    }

    const report: StatusReport = {
      v: 1,
      employeeId: record.employeeId,
      status: record.leftTime !== null ? 'LEFT' : 'PRESENT',
      checkInTime: record.checkInTime,
      leftTime: record.leftTime,
      hostId,
      date: record.date,
      reportedAt: now,
    };

    inFlight = true;
    state.nextAttemptAt = now + ATTEMPT_COOLDOWN_MS;
    stateByEmployee.set(record.employeeId, state);

    try {
      log.info('SCAN', 'Delivering ' + report.status + ' to ' + record.employeeId);

      // Built before connecting: reading storage while a GATT link is open
      // holds the radio longer than necessary.
      const history = await buildHistoryFor(record.employeeId, record.date.slice(0, 7));

      const device = await manager.connectToDevice(deviceId, {
        timeout: CONNECT_TIMEOUT_MS,
      });
      try {
        // Default MTU cannot carry the payload; negotiate before writing.
        const withMtu = await device.requestMTU(REQUESTED_MTU);
        const budget = withMtu.mtu - 3; // ATT write header

        /**
         * Fit the history to whatever MTU was actually agreed, dropping the
         * OLDEST days first — recent days are the ones an employee checks.
         * Today's status is never sacrificed: if even the bare report will not
         * fit there is nothing useful to send.
         */
        /**
         * The declared-day list travels beside the packed history, because
         * unpackHistory's four-part tuple cannot carry an extra field without
         * older employee builds dropping every entry. It is trimmed in step
         * with the history so the two never disagree about which days exist.
         */
        const declaredFor = (ds: HistoryDay[]): { dc?: string } => {
          const marked = ds.filter(d => d.checkOutDeclared).map(d => d.date.slice(8, 10));
          return marked.length > 0 ? { dc: marked.join(',') } : {};
        };

        let days = history;
        let payload = encodeStatusReport({
          ...report,
          ...declaredFor(days),
          h: packHistory(days),
        });
        while (payload.length > budget && days.length > 0) {
          days = days.slice(1);
          payload = encodeStatusReport(
            days.length > 0
              ? { ...report, ...declaredFor(days), h: packHistory(days) }
              : report,
          );
        }
        if (payload.length > budget) {
          log.warn(
            'SCAN',
            'Status payload (' + payload.length + 'B) exceeds MTU ' + withMtu.mtu + ' - skipped',
          );
          return;
        }
        if (days.length < history.length) {
          log.info(
            'SCAN',
            'History trimmed to ' + days.length + ' of ' + history.length +
              ' days to fit MTU ' + withMtu.mtu,
          );
        }

        await device.discoverAllServicesAndCharacteristics();
        await device.writeCharacteristicWithResponseForService(
          SERVICE_UUID_128,
          STATUS_CHAR_UUID,
          bytesToBase64(payload),
        );

        state.deliveredKey = key;
        log.info(
          'SCAN',
          'Status delivered to ' + record.employeeId + ' (' + report.status +
            ', ' + days.length + ' history day(s), ' + payload.length + 'B)',
        );
      } finally {
        // Always release the link — a leaked connection blocks the peripheral
        // from being connected to again and drains both batteries.
        try {
          await manager.cancelDeviceConnection(deviceId);
        } catch {
          /* already disconnected */
        }
      }
    } catch (error) {
      log.warn(
        'SCAN',
        'Status delivery to ' + record.employeeId + ' failed: ' + describeError(error),
      );
    } finally {
      inFlight = false;
      stateByEmployee.set(record.employeeId, state);
    }
  },
};
