/**
 * statusReport — the over-the-air payload a Host writes back to an employee phone.
 *
 * The property under test is ROUND-TRIP FIDELITY: whatever the Host packed is what the
 * employee device must unpack, byte for byte and field for field. Two failure modes are
 * worse than a dropped report and get the most attention here:
 *
 *   1. A HALF-BUILT REPORT. These bytes arrive from an unauthenticated writer over the
 *      radio, so malformed, truncated and empty input must yield null — never a partial
 *      object, never a throw that takes the receiver down.
 *
 *   2. AN INVENTED FIGURE. A minute field the Host did not send, or sent unreadably, is
 *      null. It is never 0: 0 is a real observation (midnight), and a refactor that
 *      defaulted the unknown ones to it would turn "we were not told" into "arrived at
 *      00:00". The same applies to the history block as a whole — absent history is
 *      undefined, not an empty month.
 *
 * Filtering a report by employeeId is the RECEIVER's job (EmployeeStatusStore drops
 * reports about other people); the decoder's job is to decode faithfully and say so.
 */

import type { HistoryDay, StatusReport } from '../bluetooth/statusReport';
import {
  decodeStatusReport,
  encodeStatusReport,
  packHistory,
  unpackHistory,
} from '../bluetooth/statusReport';

/* ---------------------------------------------------------------- fixtures -- */

/** Fixed timestamps: nothing here may depend on the real clock. */
const CHECK_IN = 1_768_469_400_000; // within the accepted 2020..2100 window
const LEFT = 1_768_500_000_000;
const REPORTED = 1_768_501_000_000;

/** The decoder's accepted epoch window, restated so the boundary tests are readable. */
const MIN_TIME = 1_577_836_800_000; // 2020-01-01
const MAX_TIME = 4_102_444_800_000; // 2100-01-01

const EMPLOYEE_ID = 'EMP_0042';
const HOST_ID = 'HOST-A1B2';
const DATE = '2026-01-15';
const MONTH = '2026-01';

/** A well-formed report, in the same field order the decoder rebuilds. */
function reportFor(over: Partial<StatusReport> = {}): StatusReport {
  return {
    v: 1,
    employeeId: EMPLOYEE_ID,
    status: 'PRESENT',
    checkInTime: CHECK_IN,
    leftTime: null,
    hostId: HOST_ID,
    date: DATE,
    reportedAt: REPORTED,
    ...over,
  };
}

function historyDay(
  date: string,
  status: HistoryDay['status'],
  checkInMinutes: number | null = null,
  checkOutMinutes: number | null = null,
): HistoryDay {
  return { date, status, checkInMinutes, checkOutMinutes };
}

/** January has 31 days, so a full month here exercises the widest legal day number. */
const FULL_MONTH: HistoryDay[] = Array.from({ length: 31 }, (_, i) => {
  const dd = String(i + 1).padStart(2, '0');
  const absent = i % 5 === 0;
  return absent
    ? historyDay(`${MONTH}-${dd}`, 'ABSENT')
    : historyDay(`${MONTH}-${dd}`, i % 7 === 0 ? 'LEFT' : 'PRESENT', 540 + i, 1020 + i);
});

function asciiBytes(text: string): number[] {
  return Array.from(text, ch => ch.charCodeAt(0));
}

function asciiText(bytes: number[]): string {
  return bytes.map(b => String.fromCharCode(b)).join('');
}

/**
 * A payload built straight from an object, bypassing the typed encoder — the way a
 * hostile or buggy peer would send one. Keys set to undefined are omitted by
 * JSON.stringify, which is how the "field missing entirely" cases are expressed.
 */
function forged(over: Record<string, unknown> = {}): number[] {
  return asciiBytes(
    JSON.stringify({
      v: 1,
      employeeId: EMPLOYEE_ID,
      status: 'PRESENT',
      checkInTime: CHECK_IN,
      leftTime: null,
      hostId: HOST_ID,
      date: DATE,
      reportedAt: REPORTED,
      ...over,
    }),
  );
}

/** Narrows away the null so strict mode lets the assertions read the fields. */
function decodeOrFail(bytes: number[]): StatusReport {
  const decoded = decodeStatusReport(bytes);
  if (decoded === null) {
    throw new Error('expected these bytes to decode, but the decoder rejected them');
  }
  return decoded;
}

/* ----------------------------------------------------------------- packing -- */

describe('packHistory', () => {
  it('writes the documented DD:S:IN:OUT form', () => {
    expect(packHistory([historyDay('2026-01-21', 'PRESENT', 545, 1062)])).toBe(
      '21:P:545:1062',
    );
  });

  it('leaves both minute fields empty for a day with no observed times', () => {
    // The employee was recorded absent: there is no arrival to report. Writing 0 here
    // would claim a midnight check-in the Host never saw.
    const packed = packHistory([historyDay('2026-01-21', 'ABSENT')]);

    expect(packed).toBe('21:A::');
    expect(packed).not.toBe('21:A:0:0');
  });

  it('writes a genuine 0-minute check-in as 0, not as an empty field', () => {
    // 0 is an observation (midnight), and must survive as one.
    expect(packHistory([historyDay('2026-01-02', 'PRESENT', 0, null)])).toBe('02:P:0:');
  });

  it('separates the LEFT and PRESENT letters', () => {
    expect(packHistory([historyDay('2026-01-03', 'LEFT', 540, 1080)])).toBe(
      '03:L:540:1080',
    );
  });

  it('joins entries with commas', () => {
    expect(
      packHistory([
        historyDay('2026-01-01', 'PRESENT', 540, 1080),
        historyDay('2026-01-02', 'ABSENT'),
      ]),
    ).toBe('01:P:540:1080,02:A::');
  });

  it('packs nothing to an empty string', () => {
    expect(packHistory([])).toBe('');
  });
});

/* --------------------------------------------------------- packing round-trip -- */

describe('packHistory then unpackHistory', () => {
  it('round-trips PRESENT, LEFT and ABSENT with their minute fields', () => {
    const days = [
      historyDay(`${MONTH}-04`, 'PRESENT', 545, 1062),
      historyDay(`${MONTH}-05`, 'LEFT', 530, 990),
      historyDay(`${MONTH}-06`, 'ABSENT'),
    ];

    expect(unpackHistory(packHistory(days), MONTH)).toEqual(days);
  });

  it('round-trips a day that has a check-in but no check-out yet', () => {
    const days = [historyDay(`${MONTH}-07`, 'PRESENT', 545, null)];

    expect(unpackHistory(packHistory(days), MONTH)).toEqual(days);
  });

  it('round-trips a midnight check-in as 0 rather than losing it to null', () => {
    const days = [historyDay(`${MONTH}-08`, 'PRESENT', 0, 1)];

    expect(unpackHistory(packHistory(days), MONTH)).toEqual(days);
  });

  it('round-trips the last legal minute of the day', () => {
    const days = [historyDay(`${MONTH}-09`, 'LEFT', 1, 1439)];

    expect(unpackHistory(packHistory(days), MONTH)).toEqual(days);
  });

  it('round-trips a full 31-day month unchanged', () => {
    expect(unpackHistory(packHistory(FULL_MONTH), MONTH)).toEqual(FULL_MONTH);
  });

  it('keeps a single-digit day zero-padded so it survives the trip', () => {
    const days = [historyDay(`${MONTH}-01`, 'PRESENT', 600, 1000)];

    expect(packHistory(days)).toBe('01:P:600:1000');
    expect(unpackHistory(packHistory(days), MONTH)).toEqual(days);
  });
});

/* --------------------------------------------------------------- unpacking -- */

describe('unpackHistory', () => {
  it('dates every entry from the supplied month prefix', () => {
    // The wire form carries only the day; year and month come from the report.
    expect(unpackHistory('05:P:540:1080', '2025-12')).toEqual([
      historyDay('2025-12-05', 'PRESENT', 540, 1080),
    ]);
  });

  it('unpacks an empty string to no days at all', () => {
    expect(unpackHistory('', MONTH)).toEqual([]);
  });

  it('ignores empty entries left by stray commas', () => {
    expect(unpackHistory(',,11:P:1:2,,', MONTH)).toEqual([
      historyDay(`${MONTH}-11`, 'PRESENT', 1, 2),
    ]);
  });

  it('skips day numbers no calendar month has', () => {
    expect(unpackHistory('00:P::,32:P::,99:A::', MONTH)).toEqual([]);
  });

  it('skips a day the reported month does not contain', () => {
    // REGRESSION GUARD: the day check used to be a flat 1..31, so a report dated in a
    // 30-day month could mint 2026-09-31 — a day that does not exist. Downstream that
    // landed in the employee's stored history and was counted by summariseMonth.
    expect(unpackHistory('31:P:540:1080', '2026-09')).toEqual([]);
  });

  it('keeps the 31st of a month that really has one', () => {
    expect(unpackHistory('31:P:540:1080', '2026-01')).toEqual([
      historyDay('2026-01-31', 'PRESENT', 540, 1080),
    ]);
  });

  it('skips an entry with too few fields', () => {
    expect(unpackHistory('21:P:545', MONTH)).toEqual([]);
  });

  it('skips an entry with too many fields', () => {
    expect(unpackHistory('21:P:545:1062:9', MONTH)).toEqual([]);
  });

  it('skips an unknown status letter rather than guessing a status', () => {
    expect(unpackHistory('21:X:545:1062', MONTH)).toEqual([]);
    expect(unpackHistory('21:p:545:1062', MONTH)).toEqual([]);
  });

  it('skips a day that is not exactly two digits', () => {
    expect(unpackHistory('5:P:1:2', MONTH)).toEqual([]);
    expect(unpackHistory('021:P:1:2', MONTH)).toEqual([]);
    expect(unpackHistory('ab:P:1:2', MONTH)).toEqual([]);
  });

  it('keeps the readable entries on either side of a malformed one', () => {
    // Partial history beats none: one corrupt entry must not cost the whole month.
    expect(unpackHistory('04:P:540:1080,GARBAGE,06:A::', MONTH)).toEqual([
      historyDay(`${MONTH}-04`, 'PRESENT', 540, 1080),
      historyDay(`${MONTH}-06`, 'ABSENT'),
    ]);
  });

  it('reads an out-of-range minute as null, never as zero', () => {
    // 1440 is not a time of day. The honest answer is "unknown", and 0 would read as
    // "arrived at midnight" — a figure the device was never given.
    const days = unpackHistory('21:P:1440:9999', MONTH);

    expect(days).toHaveLength(1);
    expect(days[0].checkInMinutes).toBeNull();
    expect(days[0].checkOutMinutes).toBeNull();
  });

  it('reads a non-numeric minute as null, never as zero', () => {
    const days = unpackHistory('21:P:ab:-5', MONTH);

    expect(days).toHaveLength(1);
    expect(days[0].checkInMinutes).toBeNull();
    expect(days[0].checkOutMinutes).toBeNull();
  });

  it('keeps the day itself when only one of its minute fields is unreadable', () => {
    const days = unpackHistory('21:L:540:oops', MONTH);

    expect(days).toEqual([historyDay(`${MONTH}-21`, 'LEFT', 540, null)]);
  });

  it('accepts 1439 and rejects 1440 at the end-of-day boundary', () => {
    expect(unpackHistory('21:P:1439:1439', MONTH)[0].checkInMinutes).toBe(1439);
    expect(unpackHistory('21:P:1440:1440', MONTH)[0].checkInMinutes).toBeNull();
  });

  it('does not throw on arbitrary junk', () => {
    expect(() => unpackHistory(':::::,,,,::,x', MONTH)).not.toThrow();
    expect(unpackHistory(':::::,,,,::,x', MONTH)).toEqual([]);
  });
});

/* ---------------------------------------------------------------- encoding -- */

describe('encodeStatusReport', () => {
  it('encodes to ASCII bytes that read back as the wire JSON', () => {
    const report = reportFor();
    const bytes = encodeStatusReport(report);

    expect(bytes.every(b => b >= 0x20 && b <= 0x7e)).toBe(true);
    expect(JSON.parse(asciiText(bytes))).toEqual(report);
  });

  it('never puts the decoded history on the wire', () => {
    // historyDays is derived from h; shipping both would double the payload.
    const bytes = encodeStatusReport(
      reportFor({ h: packHistory(FULL_MONTH), historyDays: FULL_MONTH }),
    );
    const text = asciiText(bytes);

    expect(text).not.toContain('historyDays');
    expect(text).toContain(packHistory(FULL_MONTH));
  });

  it('sends leftTime as an explicit null rather than omitting it', () => {
    // The receiver rejects a report with no leftTime key, so "not left yet" has to be
    // stated, not implied by silence.
    expect(asciiText(encodeStatusReport(reportFor()))).toContain('"leftTime":null');
  });

  it('throws rather than silently mangling non-ASCII data', () => {
    expect(() => encodeStatusReport(reportFor({ hostId: 'HOST-Ω' }))).toThrow(
      /non-ASCII/,
    );
  });
});

/* ------------------------------------------------------------ round-tripping -- */

describe('encodeStatusReport then decodeStatusReport', () => {
  it('returns an equivalent report for a today-only PRESENT report', () => {
    const report = reportFor();

    expect(decodeStatusReport(encodeStatusReport(report))).toEqual(report);
  });

  it('returns an equivalent report for a LEFT report carrying its left time', () => {
    const report = reportFor({ status: 'LEFT', leftTime: LEFT });

    expect(decodeStatusReport(encodeStatusReport(report))).toEqual(report);
  });

  it('round-trips the packed history back into the same days', () => {
    const days = [
      historyDay(`${MONTH}-04`, 'PRESENT', 545, 1062),
      historyDay(`${MONTH}-05`, 'LEFT', 530, 990),
      historyDay(`${MONTH}-06`, 'ABSENT'),
    ];
    const decoded = decodeOrFail(encodeStatusReport(reportFor({ h: packHistory(days) })));

    expect(decoded.h).toBe(packHistory(days));
    expect(decoded.historyDays).toEqual(days);
  });

  it('round-trips a full month of history within one payload', () => {
    const bytes = encodeStatusReport(reportFor({ h: packHistory(FULL_MONTH) }));
    const decoded = decodeOrFail(bytes);

    expect(bytes.length).toBeLessThanOrEqual(1024);
    expect(decoded.historyDays).toEqual(FULL_MONTH);
  });

  it('re-encodes a decoded report to the identical bytes', () => {
    // Decode must add nothing to the wire form and lose nothing from it.
    const bytes = encodeStatusReport(reportFor({ h: packHistory(FULL_MONTH) }));

    expect(encodeStatusReport(decodeOrFail(bytes))).toEqual(bytes);
  });

  it('decodes a report about a different employee faithfully', () => {
    // Dropping other people's reports is the receiver's job. A decoder that filtered
    // here would hide forged traffic instead of surfacing it.
    const report = reportFor({ employeeId: 'SOMEONE_ELSE-9' });
    const decoded = decodeOrFail(encodeStatusReport(report));

    expect(decoded.employeeId).toBe('SOMEONE_ELSE-9');
    expect(decoded).toEqual(report);
  });

  it('preserves the reporting host so the UI can attribute what it shows', () => {
    const decoded = decodeOrFail(encodeStatusReport(reportFor({ hostId: 'HOST-ZZ99' })));

    expect(decoded.hostId).toBe('HOST-ZZ99');
  });

  it('accepts the exact epoch-window boundaries', () => {
    const low = reportFor({ checkInTime: MIN_TIME, reportedAt: MIN_TIME });
    const high = reportFor({ checkInTime: MAX_TIME, reportedAt: MAX_TIME });

    expect(decodeStatusReport(encodeStatusReport(low))).toEqual(low);
    expect(decodeStatusReport(encodeStatusReport(high))).toEqual(high);
  });
});

/* ------------------------------------------------------- decoding: unknowns -- */

describe('decodeStatusReport and the figures it was not given', () => {
  it('leaves historyDays undefined, not an empty list, when no history was sent', () => {
    const decoded = decodeOrFail(encodeStatusReport(reportFor()));

    expect(decoded.historyDays).toBeUndefined();
    expect('historyDays' in decoded).toBe(false);
    expect('h' in decoded).toBe(false);
  });

  it('leaves historyDays undefined when the history block was unreadable', () => {
    // An empty list would assert "this month had no recorded days", which is a claim
    // about the month. Undefined says only that nothing legible arrived.
    const decoded = decodeOrFail(forged({ h: 'total-garbage' }));

    expect(decoded.historyDays).toBeUndefined();
    expect(decoded.employeeId).toBe(EMPLOYEE_ID);
    expect(decoded.checkInTime).toBe(CHECK_IN);
  });

  it('keeps the rest of the report when only some history entries are readable', () => {
    const decoded = decodeOrFail(forged({ h: 'zz:Q:1:2,06:A::' }));

    expect(decoded.historyDays).toEqual([historyDay(`${MONTH}-06`, 'ABSENT')]);
    expect(decoded.status).toBe('PRESENT');
  });

  it('ignores a history field that is not a string', () => {
    const decoded = decodeOrFail(forged({ h: 42 }));

    expect('h' in decoded).toBe(false);
    expect(decoded.historyDays).toBeUndefined();
  });

  it('rejects a report whose leftTime is missing rather than assuming null', () => {
    // "No leftTime key" is not evidence the employee is still present, so the report is
    // dropped instead of being completed with a guess.
    expect(decodeStatusReport(forged({ leftTime: undefined }))).toBeNull();
  });

  it('keeps only the fields the protocol defines', () => {
    const decoded = decodeOrFail(forged({ injected: 'x', historyDays: [{ evil: 1 }] }));

    expect(Object.keys(decoded).sort()).toEqual([
      'checkInTime',
      'date',
      'employeeId',
      'hostId',
      'leftTime',
      'reportedAt',
      'status',
      'v',
    ]);
  });
});

/* -------------------------------------------------------- decoding: refusals -- */

describe('decodeStatusReport refusals', () => {
  const valid = forged();

  const malformed: Array<[string, number[]]> = [
    ['an empty byte array', []],
    ['a payload truncated mid-JSON', valid.slice(0, 40)],
    ['a payload missing its final brace', valid.slice(0, valid.length - 1)],
    ['a payload with its opening brace cut off', valid.slice(1)],
    ['a single stray brace', asciiBytes('{')],
    ['bytes that are not JSON at all', asciiBytes('not json, just noise')],
    ['a JSON number', asciiBytes('42')],
    ['a JSON string', asciiBytes('"a report, honest"')],
    ['a JSON null', asciiBytes('null')],
    ['a JSON array', asciiBytes('[1,2,3]')],
    ['an empty JSON object', asciiBytes('{}')],
    ['a NUL byte inside the payload', [...valid.slice(0, 10), 0x00, ...valid.slice(10)]],
    ['a byte above the ASCII range', [...valid.slice(0, 10), 0xc3, ...valid.slice(10)]],
    ['a negative byte value', [-1, ...valid.slice(1)]],
    ['an unknown payload version', forged({ v: 2 })],
    ['a missing version', forged({ v: undefined })],
    ['a string version', forged({ v: '1' })],
    ['a blank employeeId', forged({ employeeId: '' })],
    ['an employeeId with illegal characters', forged({ employeeId: 'emp 42!' })],
    ['an over-long employeeId', forged({ employeeId: 'E'.repeat(33) })],
    ['a non-string employeeId', forged({ employeeId: 42 })],
    ['a status the protocol never delivers', forged({ status: 'ABSENT' })],
    ['an unknown status', forged({ status: 'MAYBE' })],
    ['a missing status', forged({ status: undefined })],
    ['a LEFT report with no left time', forged({ status: 'LEFT', leftTime: null })],
    ['a missing checkInTime', forged({ checkInTime: undefined })],
    ['a checkInTime of zero', forged({ checkInTime: 0 })],
    ['a checkInTime before the accepted window', forged({ checkInTime: MIN_TIME - 1 })],
    ['a checkInTime after the accepted window', forged({ checkInTime: MAX_TIME + 1 })],
    ['a checkInTime sent as a string', forged({ checkInTime: String(CHECK_IN) })],
    ['a leftTime outside the accepted window', forged({ status: 'LEFT', leftTime: 1 })],
    ['a reportedAt outside the accepted window', forged({ reportedAt: MAX_TIME + 1 })],
    ['a missing reportedAt', forged({ reportedAt: undefined })],
    ['a blank hostId', forged({ hostId: '' })],
    ['an over-long hostId', forged({ hostId: 'H'.repeat(33) })],
    ['a missing hostId', forged({ hostId: undefined })],
    ['a date that is not YYYY-MM-DD', forged({ date: '2026-1-15' })],
    ['a date with a trailing time', forged({ date: '2026-01-15T00:00:00' })],
    ['a missing date', forged({ date: undefined })],
  ];

  it.each(malformed)('returns null, not a half-built report, for %s', (_label, bytes) => {
    expect(decodeStatusReport(bytes)).toBeNull();
  });

  it.each(malformed)('does not throw on %s', (_label, bytes) => {
    expect(() => decodeStatusReport(bytes)).not.toThrow();
  });

  it('rejects a PRESENT report that also claims a left time', () => {
    // REGRESSION GUARD: the source states the rule as "LEFT must carry a left time;
    // PRESENT must not claim one", but only the first half used to be enforced. A report
    // saying the employee is present AND gone is self-contradictory, and
    // EmployeeStatusStore turned it into a stored day that was PRESENT with a check-out.
    expect(decodeStatusReport(forged({ status: 'PRESENT', leftTime: LEFT }))).toBeNull();
  });

  it('refuses a payload larger than the accepted maximum', () => {
    expect(decodeStatusReport(forged({ h: 'x'.repeat(1000) }))).toBeNull();
  });

  it('refuses on size alone, one byte past the cap', () => {
    const padding = 1024 - forged({ h: '' }).length;
    const atCap = forged({ h: 'x'.repeat(padding) });
    const overCap = forged({ h: 'x'.repeat(padding + 1) });

    expect(atCap).toHaveLength(1024);
    expect(overCap).toHaveLength(1025);
    expect(decodeStatusReport(atCap)).not.toBeNull();
    expect(decodeStatusReport(overCap)).toBeNull();
  });

  it('survives every prefix of a valid payload', () => {
    // Truncation is what a dropped GATT write looks like. No prefix may throw, and none
    // but the whole thing may decode.
    for (let cut = 0; cut < valid.length; cut++) {
      const prefix = valid.slice(0, cut);
      expect(() => decodeStatusReport(prefix)).not.toThrow();
      expect(decodeStatusReport(prefix)).toBeNull();
    }

    expect(decodeStatusReport(valid)).not.toBeNull();
  });
});

/* ------------------------------------------------- declared check-outs -- */

/**
 * `dc` marks which days in the month carry a departure the EMPLOYEE stated,
 * as opposed to the last moment the Host's radio heard their phone.
 *
 * It is a separate top-level field rather than a fifth slot in the packed
 * tuple for one reason: unpackHistory requires exactly four colon-separated
 * parts and silently drops anything else, so widening the tuple would make an
 * older employee build lose its entire history the first time it met a newer
 * Host. decodeStatusReport ignores fields it does not know, so this key is
 * invisible to those builds instead.
 */
describe('decodeStatusReport — declared check-outs', () => {
  it('marks the listed history days as declared and leaves the rest observed', () => {
    const days = [
      historyDay(MONTH + '-08', 'LEFT', 540, 1080),
      historyDay(MONTH + '-09', 'LEFT', 540, 1090),
    ];
    const decoded = decodeOrFail(
      encodeStatusReport(reportFor({ h: packHistory(days), dc: '08' })),
    );

    const byDate = Object.fromEntries(
      (decoded.historyDays ?? []).map(d => [d.date, d]),
    );
    expect(byDate[MONTH + '-08'].checkOutDeclared).toBe(true);
    // Not merely absent-and-falsy: an unlisted day must carry no claim at all.
    expect(byDate[MONTH + '-09'].checkOutDeclared).toBeUndefined();
  });

  it("flags the report's OWN day when that day is listed", () => {
    const decoded = decodeOrFail(
      encodeStatusReport(
        reportFor({ status: 'LEFT', leftTime: LEFT, dc: DATE.slice(8, 10) }),
      ),
    );

    expect(decoded.leftTimeDeclared).toBe(true);
  });

  it("leaves the report's own day unflagged when the list covers other days", () => {
    const decoded = decodeOrFail(
      encodeStatusReport(reportFor({ status: 'LEFT', leftTime: LEFT, dc: '01' })),
    );

    expect(decoded.leftTimeDeclared).toBeUndefined();
  });

  it('treats a malformed list as "no day is declared" rather than rejecting the report', () => {
    // Unauthenticated radio input: the fallback loses a LABEL, never a day.
    for (const bad of ['8', 'xx', '08,', ',08', '08,,09', '0x08']) {
      const decoded = decodeStatusReport(
        encodeStatusReport(reportFor({ h: packHistory([historyDay(MONTH + '-08', 'LEFT', 540, 1080)]), dc: bad })),
      );

      expect(decoded).not.toBeNull();
      expect(decoded?.historyDays?.[0].checkOutDeclared).toBeUndefined();
      expect(decoded?.leftTimeDeclared).toBeUndefined();
    }
  });

  it('names a day the history block does not contain without inventing one', () => {
    const decoded = decodeOrFail(
      encodeStatusReport(
        reportFor({ h: packHistory([historyDay(MONTH + '-08', 'LEFT', 540, 1080)]), dc: '20' }),
      ),
    );

    expect(decoded.historyDays).toHaveLength(1);
    expect(decoded.historyDays?.[0].date).toBe(MONTH + '-08');
    expect(decoded.historyDays?.[0].checkOutDeclared).toBeUndefined();
  });

  it('survives a round trip so a Host can re-send what it received', () => {
    const decoded = decodeOrFail(
      encodeStatusReport(reportFor({ h: packHistory(FULL_MONTH), dc: '03,17' })),
    );

    expect(decoded.dc).toBe('03,17');
  });

  it('carries no declaration at all when the Host never sends the field', () => {
    // The old-Host case: every day reads as observed, which is what it was.
    const decoded = decodeOrFail(
      encodeStatusReport(reportFor({ h: packHistory(FULL_MONTH) })),
    );

    expect(decoded.dc).toBeUndefined();
    expect(decoded.leftTimeDeclared).toBeUndefined();
    expect((decoded.historyDays ?? []).every(d => d.checkOutDeclared === undefined)).toBe(true);
  });
});
