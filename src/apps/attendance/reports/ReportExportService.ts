/**
 * ReportExportService.ts
 * -----------------------------------------------------------------------------
 * HOST-only. Reads persisted attendance, builds the monthly workbook, and hands
 * it to the native share sheet.
 *
 * ROLE GUARD, not a hidden button. The Reports UI is only rendered for a Host,
 * but the guard lives here too — same pattern as BleScanner.startScan. An
 * Employee device holds only its own delivered status, never the company's
 * records, and this service must refuse rather than rely on a screen not being
 * reachable.
 *
 * Reads go straight to AttendanceStorage, never React state: a report of
 * "August" must include days the app has not held in memory since it launched.
 * -----------------------------------------------------------------------------
 */

import { NativeModules, Platform } from 'react-native';
import {
  buildMonthlyReport,
  monthsWithData,
  type MonthlyReport,
} from '../attendance/monthlyReport';
import type { Employee } from '../employees/employeeTypes';
import { isHost } from '../role/RoleService';
import { AttendanceStorage } from '../storage/AttendanceStorage';
import { describeError, log } from '../utils/logger';
import { dateStringOf } from '../attendance/monthlyReport';
import { buildAttendanceWorkbook, reportFileName } from './attendanceWorkbook';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface FileShareNative {
  shareBase64File(base64: string, fileName: string, mimeType: string): Promise<boolean>;
}

const NativeFileShare: FileShareNative | undefined =
  Platform.OS === 'android' ? NativeModules.FileShare : undefined;

export type ExportOutcome =
  | { ok: true; fileName: string; shared: boolean }
  | { ok: false; message: string };

export const ReportExportService = {
  /** Months that actually hold records, newest first. Empty when none do. */
  async availableMonths(): Promise<string[]> {
    if (!isHost()) {
      return [];
    }
    return monthsWithData(await AttendanceStorage.getAll());
  },

  /** Build one month's report from persisted records. */
  async loadReport(monthKey: string, employees: Employee[]): Promise<MonthlyReport | null> {
    if (!isHost()) {
      log.warn('ATTENDANCE', 'Report requested on a non-Host device - refused');
      return null;
    }
    const records = await AttendanceStorage.getAll();
    return buildMonthlyReport({ monthKey, records, employees });
  },

  /**
   * Generate and share the workbook.
   *
   * Never throws: every failure comes back as a readable message so the screen
   * can show it instead of the app dying mid-export.
   */
  async exportReport(
    report: MonthlyReport,
    context: { officeName: string; hostId: string },
  ): Promise<ExportOutcome> {
    if (!isHost()) {
      return { ok: false, message: 'Only the Host device can export attendance reports.' };
    }
    if (report.isEmpty) {
      return {
        ok: false,
        message: 'No attendance data is available for ' + report.monthLabel + '.',
      };
    }
    if (!NativeFileShare) {
      return { ok: false, message: 'File sharing is not available on this platform.' };
    }

    const fileName = reportFileName(report);
    try {
      const generatedAt = Date.now();
      const base64 = buildAttendanceWorkbook(report, {
        officeName: context.officeName,
        hostId: context.hostId,
        generatedAt,
        // Local calendar date, matching how records are keyed.
        generatedDate: dateStringOf(generatedAt),
      });

      log.info(
        'ATTENDANCE',
        'Report built: ' + fileName + ' (' + report.employees.length + ' employees, ' +
          report.workingDays + ' working days)',
      );

      const shared = await NativeFileShare.shareBase64File(base64, fileName, XLSX_MIME);
      return { ok: true, fileName, shared };
    } catch (error) {
      log.error('ATTENDANCE', 'Report export failed: ' + describeError(error));
      return { ok: false, message: 'Unable to generate report. Please try again.' };
    }
  },
};
