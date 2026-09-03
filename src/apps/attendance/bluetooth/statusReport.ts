/**
 * statusReport.ts
 * -----------------------------------------------------------------------------
 * The payload the HOST writes back to an EMPLOYEE device over GATT after
 * recording attendance — the reply channel that finally lets an employee see
 * their REAL check-in status instead of a card explaining why they cannot.
 *
 * Direction:  Host (central, ble-plx)  --write-->  Employee (GATT server).
 *
 * Format: versioned ASCII JSON. The employee id pattern already guarantees
 * ASCII, host ids are generated ASCII, and every other field is a number, so
 * plain char-code encoding is lossless and needs no Buffer polyfill.
 *
 * HISTORY (`h`) is a deliberately terse STRING, not a JSON array. A month of
 * days as objects runs past 800 bytes and will not fit one GATT write; the
 * packed form is roughly a third of that. Entries are comma separated:
 *
 *     DD:S:IN:OUT     e.g.  21:P:545:1062
 *     DD:A::                a recorded working day the employee missed
 *
 * DD is the day of month, S is P|L|A, IN/OUT are minutes since local midnight
 * and may be empty. Non-working days are simply ABSENT from the string — the
 * receiver treats any day it was not told about as "no record", which is what
 * a non-working day is from the employee's side.
 *
 * TRUST BOUNDARY — read this before extending.
 * Any BLE central in range could connect and write bytes to the status
 * characteristic; BLE gives us no authentication without pairing, and pairing
 * would wreck the walk-in UX. Three mitigations are in place:
 *   1. the decoder validates shape, version and value ranges strictly,
 *   2. the employee device DROPS any report whose employeeId is not its own,
 *   3. the UI always attributes what it shows ("reported by HOST-XXXX"),
 *      so a forged report is at least visibly attributed, never presented as
 *      the phone's own knowledge.
 * For an offline attendance prototype that is an accepted, documented risk —
 * the same physical access could simply shadow the victim's badge.
 * -----------------------------------------------------------------------------
 */

import type { AttendanceStatus } from '../attendance/attendanceTypes';

export interface StatusReport {
  /** Payload version, for forward compatibility. */
  v: 1;
  /** The employee this report is about. Receiver MUST check it is their own. */
  employeeId: string;
  /** What the Host has recorded. ABSENT is never delivered — there is nothing to report. */
  status: Extract<AttendanceStatus, 'PRESENT' | 'LEFT'>;
  /** Check-in time as recorded by the Host (ms epoch). */
  checkInTime: number;
  /** Set when the Host has marked the employee as left (ms epoch). */
  leftTime: number | null;
  /** Which Host wrote this. Shown to the user as attribution. */
  hostId: string;
  /** Attendance date on the HOST, YYYY-MM-DD. Receiver discards stale days. */
  date: string;
  /** When the Host sent this report (ms epoch). */
  reportedAt: number;
  /**
   * Packed history for the report's month. Optional: a v1 Host omits it, and a
   * report whose history would not fit the negotiated MTU drops it rather than
   * failing. Decoded into `historyDays`.
   */
  h?: string;
  /** Decoded history. Never sent over the air; produced by decodeStatusReport. */
  historyDays?: HistoryDay[];
}

/** One past day, as reported by the Host. */
export interface HistoryDay {
  /** YYYY-MM-DD. */
  date: string;
  status: 'PRESENT' | 'LEFT' | 'ABSENT';
  /** Minutes since local midnight, or null when not applicable. */
  checkInMinutes: number | null;
  checkOutMinutes: number | null;
}

const STATUS_LETTER: Record<string, HistoryDay['status']> = {
  P: 'PRESENT',
  L: 'LEFT',
  A: 'ABSENT',
};

const LETTER_FOR: Record<HistoryDay['status'], string> = {
  PRESENT: 'P',
  LEFT: 'L',
  ABSENT: 'A',
};

/** Pack days into the wire form. Callers trim to fit the MTU. */
export function packHistory(days: HistoryDay[]): string {
  return days
    .map(d => {
      const dd = d.date.slice(8, 10);
      const inM = d.checkInMinutes === null ? '' : String(d.checkInMinutes);
      const outM = d.checkOutMinutes === null ? '' : String(d.checkOutMinutes);
      return dd + ':' + LETTER_FOR[d.status] + ':' + inM + ':' + outM;
    })
    .join(',');
}

/**
 * Unpack, using the report's own month for the year and month parts. Any
 * malformed entry is skipped rather than failing the whole report — a partial
 * history beats none, and this is unauthenticated radio input.
 */
export function unpackHistory(packed: string, monthPrefix: string): HistoryDay[] {
  const out: HistoryDay[] = [];
  packed.split(',').forEach(entry => {
    if (!entry) {
      return;
    }
    const parts = entry.split(':');
    if (parts.length !== 4) {
      return;
    }
    const [dd, letter, inM, outM] = parts;
    if (!/^\d{2}$/.test(dd)) {
      return;
    }
    const day = Number(dd);
    if (day < 1 || day > 31) {
      return;
    }
    const status = STATUS_LETTER[letter];
    if (!status) {
      return;
    }
    const minutes = (raw: string): number | null => {
      if (raw === '') {
        return null;
      }
      if (!/^\d{1,4}$/.test(raw)) {
        return null;
      }
      const value = Number(raw);
      return value >= 0 && value < 1440 ? value : null;
    };
    out.push({
      date: monthPrefix + '-' + dd,
      status,
      checkInMinutes: minutes(inM),
      checkOutMinutes: minutes(outM),
    });
  });
  return out;
}

/** Reasonable epoch bounds: 2020-01-01 .. 2100-01-01. Rejects garbage times. */
const MIN_TIME = 1_577_836_800_000;
const MAX_TIME = 4_102_444_800_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function encodeStatusReport(report: StatusReport): number[] {
  // `historyDays` is a decode-side convenience; shipping it would double the
  // payload with data already present in `h`.
  const { historyDays, ...wire } = report;
  void historyDays;
  const json = JSON.stringify(wire);
  const out: number[] = [];
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    // All legal field values are ASCII; anything else means a bug upstream.
    if (code > 0x7f) {
      throw new Error('StatusReport contains non-ASCII data: ' + json[i]);
    }
    out.push(code);
  }
  return out;
}

/**
 * Strict decode. Returns null for anything malformed rather than throwing —
 * these bytes arrive over the air from an unauthenticated writer, and a
 * corrupt packet must never crash the receiver.
 */
/**
 * Hard ceiling on an accepted payload.
 *
 * A today-only report is ~158 bytes; a full month of packed history adds
 * roughly 300 more. 1024 leaves headroom for a 31-day month while still
 * refusing anything that could only be an attempt to make the parser chew
 * through megabytes. The GATT server enforces its own cap too.
 */
const MAX_PAYLOAD_BYTES = 1024;

export function decodeStatusReport(bytes: number[]): StatusReport | null {
  if (bytes.length === 0 || bytes.length > MAX_PAYLOAD_BYTES) {
    return null;
  }

  let json = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x20 || b > 0x7e) {
      return null;
    }
    json += String.fromCharCode(b);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;

  if (r.v !== 1) {
    return null;
  }
  if (typeof r.employeeId !== 'string' || !ID_PATTERN.test(r.employeeId)) {
    return null;
  }
  if (r.status !== 'PRESENT' && r.status !== 'LEFT') {
    return null;
  }
  if (typeof r.checkInTime !== 'number' || r.checkInTime < MIN_TIME || r.checkInTime > MAX_TIME) {
    return null;
  }
  if (
    r.leftTime !== null &&
    (typeof r.leftTime !== 'number' || r.leftTime < MIN_TIME || r.leftTime > MAX_TIME)
  ) {
    return null;
  }
  if (typeof r.hostId !== 'string' || r.hostId.length === 0 || r.hostId.length > 32) {
    return null;
  }
  if (typeof r.date !== 'string' || !DATE_PATTERN.test(r.date)) {
    return null;
  }
  if (typeof r.reportedAt !== 'number' || r.reportedAt < MIN_TIME || r.reportedAt > MAX_TIME) {
    return null;
  }
  // LEFT must carry a left time; PRESENT must not claim one.
  if (r.status === 'LEFT' && r.leftTime === null) {
    return null;
  }

  // History is optional and best-effort: a malformed block is dropped, the
  // rest of the report still stands.
  const packed = typeof r.h === 'string' ? r.h : undefined;
  const historyDays = packed ? unpackHistory(packed, r.date.slice(0, 7)) : undefined;

  return {
    v: 1,
    employeeId: r.employeeId,
    status: r.status,
    checkInTime: r.checkInTime,
    leftTime: r.leftTime as number | null,
    hostId: r.hostId,
    date: r.date,
    reportedAt: r.reportedAt,
    ...(packed ? { h: packed } : {}),
    ...(historyDays && historyDays.length > 0 ? { historyDays } : {}),
  };
}
