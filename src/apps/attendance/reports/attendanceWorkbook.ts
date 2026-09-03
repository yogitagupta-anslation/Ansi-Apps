/**
 * attendanceWorkbook.ts
 * -----------------------------------------------------------------------------
 * Turns a MonthlyReport into a formatted, auditable .xlsx workbook (base64).
 *
 * FOUR SHEETS, four questions:
 *
 *   Summary            how did each employee's month go, with hours
 *   Daily Attendance   one row per employee per working day — the audit trail
 *   Monthly View       the P/L/A grid, times in each cell's note
 *   Employee Details   the same days grouped per employee, with subtotals
 *
 * EVERY TIME IN HERE IS AN OBSERVED BLE EVENT. Nothing is estimated:
 *
 *   Check-In    record.checkInTime    first confirmed detection of the day
 *   Check-Out   record.lastSeenTime   LAST confirmed detection of the day
 *   Duration    lastSeenTime - checkInTime
 *   Marked Left record.leftTime       when the grace period elapsed
 *
 * Check-Out is lastSeenTime, NOT leftTime, and that distinction is the whole
 * honesty of the report. leftTime is `lastSeen + gracePeriod` — the moment the
 * Host concluded somebody had gone, which is not a moment anybody was seen.
 * Using it as the check-out would silently pad every shift by the grace
 * period. It is still reported, in its own column, under its own name.
 *
 * Dates and times are written as REAL Excel values with number formats, not as
 * strings, so an administrator can sort, filter and compute with them.
 *
 * No BLE internals appear anywhere: no RSSI, no MAC address, no service UUID.
 * -----------------------------------------------------------------------------
 */

import XLSX from 'xlsx-js-style';
import { applyFreezePanes, type FreezeSpec } from './freezePanes';
import type {
  DayCellStatus,
  EmployeeMonthSummary,
  MonthlyReport,
} from '../attendance/monthlyReport';
import { formatClockTime } from '../constants/appConfig';

/* ================================================================= style == */

const NAVY = '1F3864';
const BORDER = { style: 'thin' as const, color: { rgb: 'D0D7E2' } };
const box = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const headerStyle = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { fgColor: { rgb: NAVY } },
  alignment: { horizontal: 'center' as const, vertical: 'center' as const, wrapText: true },
  border: box,
};

const titleStyle = {
  font: { bold: true, sz: 16, color: { rgb: NAVY } },
  alignment: { horizontal: 'left' as const },
};

const sectionStyle = {
  font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: '3B5C93' } },
  alignment: { horizontal: 'left' as const },
};

const labelStyle = { font: { bold: true, sz: 10, color: { rgb: '444444' } } };
const cell = { font: { sz: 10 }, border: box };
const centered = { ...cell, alignment: { horizontal: 'center' as const } };
const boldCentered = { ...centered, font: { sz: 10, bold: true } };

/** Status tints. Support only — the letter or word always carries the meaning. */
const STATUS_FILL: Record<string, string> = {
  PRESENT: 'E3F5EA',
  LEFT: 'FDF3DC',
  ABSENT: 'FCE6E6',
};

function statusStyle(status: DayCellStatus) {
  const fill = STATUS_FILL[status];
  return {
    ...centered,
    font: { sz: 10, bold: status === 'ABSENT' },
    ...(fill ? { fill: { fgColor: { rgb: fill } } } : {}),
  };
}

/* ============================================================ excel values == */

const MS_PER_DAY = 86_400_000;
/** Excel's epoch offset: serial 25569 is 1970-01-01. */
const EPOCH_OFFSET = 25569;

const FMT_DATE = 'dd mmm yyyy';
const FMT_TIME = 'hh:mm AM/PM';
/** [h] lets a duration exceed 24h without wrapping to zero. */
const FMT_DURATION = '[h]:mm';
const FMT_HOURS = '0.00';
const FMT_PERCENT = '0.0%';

/**
 * Excel stores a date as days since 1899-12-30 and has NO timezone. Shifting by
 * the local offset makes the sheet show the same wall-clock time the Host
 * displayed when it recorded the event.
 */
function dateSerial(dateString: string): number {
  const [y, m, d] = dateString.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY + EPOCH_OFFSET;
}

/** Time of day as a fraction, in the Host's local time. */
function timeFraction(ms: number): number {
  const d = new Date(ms);
  return (
    (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86_400
  );
}

function durationFraction(ms: number): number {
  return ms / MS_PER_DAY;
}

type Cell = XLSX.CellObject;

const txt = (v: string, s: object = cell): Cell => ({ v, t: 's', s } as Cell);
const num = (v: number, z: string, s: object = centered): Cell =>
  ({ v, t: 'n', z, s } as Cell);
/** An empty-but-styled cell, so borders stay continuous across a row. */
const dash = (s: object = centered): Cell => ({ v: '—', t: 's', s } as Cell);

const timeCell = (ms: number | null, s: object = centered): Cell =>
  ms === null ? dash(s) : num(timeFraction(ms), FMT_TIME, s);

const durationCell = (ms: number | null, s: object = centered): Cell =>
  ms === null ? dash(s) : num(durationFraction(ms), FMT_DURATION, s);

/* ================================================================ helpers == */

/** Letter for the matrix grid. */
function statusLetter(status: DayCellStatus): string {
  switch (status) {
    case 'PRESENT':
      return 'P';
    case 'LEFT':
      return 'L';
    case 'ABSENT':
      return 'A';
    default:
      return '—';
  }
}

function hours(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Write a row of prepared cells at `r`, starting at column 0. */
function putRow(ws: XLSX.WorkSheet, r: number, cells: Cell[]): void {
  cells.forEach((c, i) => {
    ws[XLSX.utils.encode_cell({ r, c: i })] = c;
  });
}

/** Grow the sheet's declared range to cover everything written. */
function setRange(ws: XLSX.WorkSheet, rows: number, cols: number): void {
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(0, rows - 1), c: Math.max(0, cols - 1) },
  });
}

/* ============================================================== sheet one == */

const SUMMARY_HEADERS = [
  'Employee ID',
  'Employee Name',
  'Department',
  'Working Days',
  'Present',
  'Left / Early Leave',
  'Absent',
  'Total Hours',
  'Avg Hours / Day',
  'Attendance %',
  'Last Check-In',
  'Last Check-Out',
];

function buildSummarySheet(
  report: MonthlyReport,
  context: WorkbookContext,
): { ws: XLSX.WorkSheet; headerRow: number } {
  const ws: XLSX.WorkSheet = {};
  let r = 0;

  putRow(ws, r++, [txt('Attendance Report — ' + report.monthLabel, titleStyle)]);
  r++;

  putRow(ws, r++, [txt('REPORT DETAILS', sectionStyle)]);
  const detail = (label: string, value: Cell) => putRow(ws, r++, [txt(label, labelStyle), value]);
  detail('Office', txt(context.officeName, { font: { sz: 10 } }));
  detail('Host ID', txt(context.hostId, { font: { sz: 10 } }));
  detail('Report month', txt(report.monthLabel, { font: { sz: 10 } }));
  detail('Employees', num(report.totalEmployees, '0', { font: { sz: 10 } }));
  detail('Recorded working days', num(report.workingDays, '0', { font: { sz: 10 } }));
  detail(
    'Generated',
    num(
      dateSerial(context.generatedDate) + timeFraction(context.generatedAt),
      FMT_DATE + ' ' + FMT_TIME,
      { font: { sz: 10 } },
    ),
  );
  r++;

  putRow(ws, r++, [txt('MONTH TOTALS', sectionStyle)]);
  putRow(ws, r++, [
    txt('Present', labelStyle),
    num(report.totals.present, '0', boldCentered),
    txt('Left', labelStyle),
    num(report.totals.left, '0', boldCentered),
    txt('Absent', labelStyle),
    num(report.totals.absent, '0', boldCentered),
  ]);
  r++;

  putRow(ws, r++, [txt('EMPLOYEE SUMMARY', sectionStyle)]);
  const headerRow = r;
  putRow(ws, r++, SUMMARY_HEADERS.map(h => txt(h, headerStyle)));

  report.employees.forEach(e => {
    const attended = e.present + e.left;
    putRow(ws, r++, [
      txt(e.employeeId),
      txt(e.employeeName),
      txt(e.department ?? '—'),
      num(e.applicableDays, '0'),
      num(e.present, '0', statusStyle('PRESENT')),
      num(e.left, '0', statusStyle('LEFT')),
      num(e.absent, '0', statusStyle('ABSENT')),
      num(hours(e.totalPresenceMs), FMT_HOURS),
      num(hours(e.averagePresenceMs), FMT_HOURS),
      num(
        e.applicableDays > 0 ? attended / e.applicableDays : 0,
        FMT_PERCENT,
        boldCentered,
      ),
      timeCell(e.lastCheckIn),
      timeCell(e.lastCheckOut),
    ]);
  });

  setRange(ws, r, SUMMARY_HEADERS.length);

  ws['!cols'] = [
    { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 17 },
    { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 13 }, { wch: 15 }, { wch: 15 },
  ];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
  ];
  if (report.employees.length > 0) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRow, c: 0 },
        e: { r: headerRow + report.employees.length, c: SUMMARY_HEADERS.length - 1 },
      }),
    };
  }
  return { ws, headerRow: headerRow + 1 };
}

/* ============================================================== sheet two == */

const DAILY_HEADERS = [
  'Date',
  'Employee ID',
  'Employee Name',
  'Status',
  'Check-In',
  'Check-Out (last seen)',
  'Duration',
  'First Seen',
  'Last Seen',
  'Marked Left',
];

function buildDailySheet(report: MonthlyReport): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let r = 0;
  putRow(ws, r++, DAILY_HEADERS.map(h => txt(h, headerStyle)));

  // Date-major: the sheet reads like a register — everyone for the 3rd, then
  // everyone for the 4th. Employee-major would bury "who was in that day".
  report.workingDates.forEach(date => {
    report.employees.forEach(e => {
      const day = e.days.find(d => d.date === date);
      if (!day || day.status === 'NOT_APPLICABLE') {
        return;
      }
      const rec = day.record;
      putRow(ws, r++, [
        num(dateSerial(date), FMT_DATE, { ...cell, alignment: { horizontal: 'left' as const } }),
        txt(e.employeeId),
        txt(e.employeeName),
        txt(day.status, statusStyle(day.status)),
        timeCell(rec?.checkInTime ?? null),
        timeCell(rec?.lastSeenTime ?? null),
        durationCell(day.presenceMs),
        timeCell(rec?.firstDetectedAt ?? null),
        timeCell(rec?.lastSeenTime ?? null),
        timeCell(rec?.leftTime ?? null),
      ]);
    });
  });

  setRange(ws, r, DAILY_HEADERS.length);
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 11 }, { wch: 12 },
    { wch: 20 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 13 },
  ];
  if (r > 1) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: r - 1, c: DAILY_HEADERS.length - 1 },
      }),
    };
  }
  return ws;
}

/* ============================================================ sheet three == */

/** The note Excel shows when a grid cell is opened. */
function dayNote(e: EmployeeMonthSummary, dateLabel: string, day: EmployeeMonthSummary['days'][number]): string {
  const rec = day.record;
  const lines = [e.employeeName + ' — ' + dateLabel, 'Status: ' + day.status];
  if (rec?.checkInTime) {
    lines.push('Check-in: ' + formatClockTime(rec.checkInTime));
  }
  if (rec?.lastSeenTime) {
    lines.push('Check-out (last seen): ' + formatClockTime(rec.lastSeenTime));
  }
  if (day.presenceMs !== null) {
    const mins = Math.floor(day.presenceMs / 60_000);
    lines.push('Duration: ' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm');
  }
  if (rec?.leftTime) {
    lines.push('Marked left: ' + formatClockTime(rec.leftTime));
  }
  return lines.join('\n');
}

function buildMatrixSheet(report: MonthlyReport): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const dayNumbers = report.allDates.map(d => Number(d.slice(8, 10)));
  const headers = [
    'Employee ID',
    'Employee',
    ...dayNumbers.map(String),
    'Present',
    'Left',
    'Absent',
    'Attendance %',
  ];

  let r = 0;
  putRow(ws, r++, headers.map(h => txt(h, headerStyle)));

  report.employees.forEach(e => {
    const row: Cell[] = [txt(e.employeeId), txt(e.employeeName)];

    e.days.forEach((day, i) => {
      const c = txt(statusLetter(day.status), statusStyle(day.status));
      // Times live in the cell note, so the grid stays a grid — §6's "show
      // check-in/check-out when the date cell is opened".
      if (day.status !== 'NOT_APPLICABLE') {
        (c as { c?: unknown[] }).c = [
          { a: 'Attendance', t: dayNote(e, report.allDates[i], day) },
        ];
      }
      row.push(c);
    });

    row.push(
      num(e.present, '0', boldCentered),
      num(e.left, '0', boldCentered),
      num(e.absent, '0', boldCentered),
      num(
        e.applicableDays > 0 ? (e.present + e.left) / e.applicableDays : 0,
        FMT_PERCENT,
        boldCentered,
      ),
    );
    putRow(ws, r++, row);
  });

  r++;
  putRow(ws, r++, [
    txt('Legend', labelStyle),
    txt(
      'P = Present   L = Left / early leave   A = Absent   — = Non-working day or before registration.  Open a cell for its times.',
      { font: { sz: 10 } },
    ),
  ]);

  setRange(ws, r, headers.length);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    ...dayNumbers.map(() => ({ wch: 4 })),
    { wch: 9 }, { wch: 7 }, { wch: 8 }, { wch: 13 },
  ];
  return ws;
}

/* ============================================================= sheet four == */

const DETAIL_HEADERS = [
  'Date',
  'Status',
  'Check-In',
  'Check-Out (last seen)',
  'Duration',
  'Marked Left',
];

function buildEmployeeDetailSheet(report: MonthlyReport): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let r = 0;

  putRow(ws, r++, [txt('Employee-wise attendance — ' + report.monthLabel, titleStyle)]);
  r++;

  report.employees.forEach(e => {
    // One block per employee: identity, their days, then a subtotal that an
    // auditor can check against the Summary sheet without re-adding anything.
    putRow(ws, r++, [
      txt(e.employeeId + '  ·  ' + e.employeeName, sectionStyle),
    ]);
    ws['!merges'] = ws['!merges'] ?? [];
    ws['!merges'].push({ s: { r: r - 1, c: 0 }, e: { r: r - 1, c: DETAIL_HEADERS.length - 1 } });

    putRow(ws, r++, DETAIL_HEADERS.map(h => txt(h, headerStyle)));

    const workingDays = e.days.filter(d => d.status !== 'NOT_APPLICABLE');
    if (workingDays.length === 0) {
      putRow(ws, r++, [txt('No recorded working days this month', { font: { sz: 10, italic: true } })]);
    }
    workingDays.forEach(day => {
      const rec = day.record;
      putRow(ws, r++, [
        num(dateSerial(day.date), FMT_DATE, { ...cell, alignment: { horizontal: 'left' as const } }),
        txt(day.status, statusStyle(day.status)),
        timeCell(rec?.checkInTime ?? null),
        timeCell(rec?.lastSeenTime ?? null),
        durationCell(day.presenceMs),
        timeCell(rec?.leftTime ?? null),
      ]);
    });

    putRow(ws, r++, [
      txt('Subtotal', labelStyle),
      txt(e.present + 'P / ' + e.left + 'L / ' + e.absent + 'A', boldCentered),
      txt('Total hours', labelStyle),
      num(hours(e.totalPresenceMs), FMT_HOURS, boldCentered),
      txt('Attendance', labelStyle),
      num(
        e.applicableDays > 0 ? (e.present + e.left) / e.applicableDays : 0,
        FMT_PERCENT,
        boldCentered,
      ),
    ]);
    r++;
  });

  setRange(ws, r, DETAIL_HEADERS.length);
  ws['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 11 }, { wch: 13 },
  ];
  return ws;
}

/* ==================================================================== entry == */

export interface WorkbookContext {
  officeName: string;
  hostId: string;
  generatedAt: number;
  /** YYYY-MM-DD of generatedAt, in the Host's local time. */
  generatedDate: string;
}

export function buildAttendanceWorkbook(
  report: MonthlyReport,
  context: WorkbookContext,
): string {
  const wb = XLSX.utils.book_new();

  const summary = buildSummarySheet(report, context);
  XLSX.utils.book_append_sheet(wb, summary.ws, 'Summary');
  XLSX.utils.book_append_sheet(wb, buildDailySheet(report), 'Daily Attendance');
  XLSX.utils.book_append_sheet(wb, buildMatrixSheet(report), 'Monthly View');
  XLSX.utils.book_append_sheet(wb, buildEmployeeDetailSheet(report), 'Employee Details');

  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  /**
   * Freeze panes are injected after writing: the library cannot express them.
   * Order matches the order the sheets were appended.
   */
  const freezes: FreezeSpec[] = [
    { columns: 0, rows: summary.headerRow },
    { columns: 0, rows: 1 },
    // Header AND the two identity columns, so scrolling to the 28th never
    // loses track of whose row it is.
    { columns: 2, rows: 1 },
    // Employee Details repeats headers per block, so only the title is frozen.
    { columns: 0, rows: 0 },
  ];
  return applyFreezePanes(base64, freezes);
}

/** attendance_August_2026.xlsx — follows the selected month. */
export function reportFileName(report: MonthlyReport): string {
  return 'attendance_' + report.monthLabel.replace(/\s+/g, '_') + '.xlsx';
}
