/**
 * appConfig - the small shared vocabulary the attendance app is built on: the local
 * calendar day used as the attendance dedup key, the clock and date strings shown on
 * screen, the per-installation Host id, and the character set an employee id must
 * satisfy before it is allowed anywhere near the radio.
 *
 * Two themes run through this suite.
 *
 * LOCAL TIME. Attendance is a local-calendar idea: the working day starts at the
 * office's midnight, not Greenwich's. Every date and clock assertion here builds its
 * Date from LOCAL components and expects those same components back, so the suite means
 * the same thing on a machine in any timezone - and so a refactor to toISOString() or
 * getUTCHours() fails it rather than quietly moving a whole office's attendance a day.
 *
 * ABSENCE OF EVIDENCE. This app never renders a figure it has not observed. That rule
 * shows up here as validation and as fallbacks: DEFAULT_EMPLOYEE_ID is deliberately
 * empty and must FAIL EMPLOYEE_ID_PATTERN, so an unconfigured phone cannot advertise;
 * and formatDisplayDate must hand back what it was given rather than name a month it
 * cannot identify. Those are the assertions worth keeping, because a refactor that
 * "helpfully" supplied a default in either place would put a claim on the air, or on
 * screen, that no device ever made.
 *
 * Nothing here reads the wall clock or the real Math.random: dates and timestamps are
 * passed in explicitly, the clock is frozen only where a default argument has to be
 * exercised, and Math.random is driven from a fixed sequence.
 */

import {
  DEFAULT_EMPLOYEE_ID,
  DEFAULT_EMPLOYEE_NAME,
  DEFAULT_HOST_ID,
  EMPLOYEE_ID_PATTERN,
  formatClockTime,
  formatDisplayDate,
  generateHostId,
  todayDateString,
} from '../constants/appConfig';

/**
 * A wall-clock instant on 20 Aug 2026, built from LOCAL parts. Passing the epoch
 * milliseconds keeps formatClockTime deterministic while still asserting that it reads
 * the instant back in local time.
 */
function localInstant(hours: number, minutes: number): number {
  return new Date(2026, 7, 20, hours, minutes, 0, 0).getTime();
}

/** Drive Math.random from a fixed sequence so generateHostId is fully determined. */
function stubRandomSequence(values: readonly number[]): void {
  let index = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => {
    const value = values[index % values.length];
    index += 1;
    return value;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('todayDateString', () => {
  it('formats a local calendar day as YYYY-MM-DD', () => {
    expect(todayDateString(new Date(2026, 7, 20))).toBe('2026-08-20');
  });

  it('zero-pads a single-digit month', () => {
    // January is month 0 internally; an unpadded '1' would sort and compare wrongly
    // against the '10'..'12' keys already in storage.
    expect(todayDateString(new Date(2026, 0, 20))).toBe('2026-01-20');
  });

  it('zero-pads a single-digit day', () => {
    expect(todayDateString(new Date(2026, 7, 5))).toBe('2026-08-05');
  });

  it('zero-pads month and day together', () => {
    expect(todayDateString(new Date(2026, 8, 7))).toBe('2026-09-07');
  });

  it('leaves an already two-digit month and day alone', () => {
    expect(todayDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('keeps a leap day as itself', () => {
    expect(todayDateString(new Date(2024, 1, 29))).toBe('2024-02-29');
  });

  it('reads the LOCAL day at both edges of midnight, not the UTC day', () => {
    // The dedup key must not depend on where the office is. A UTC-based reading would
    // move one of these two instants onto the neighbouring day for every device that is
    // not sitting on the prime meridian.
    expect(todayDateString(new Date(2026, 7, 20, 0, 0, 0, 0))).toBe('2026-08-20');
    expect(todayDateString(new Date(2026, 7, 20, 23, 59, 59, 999))).toBe('2026-08-20');
  });

  it('falls back to the current local date when called with no Date', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 3, 12, 0, 0));

    expect(todayDateString()).toBe('2026-05-03');
  });
});

describe('formatClockTime', () => {
  it('formats a known morning instant as a zero-padded 12-hour time', () => {
    expect(formatClockTime(localInstant(9, 5))).toBe('09:05 AM');
  });

  it('zero-pads a single-digit hour', () => {
    expect(formatClockTime(localInstant(1, 30))).toBe('01:30 AM');
  });

  it('converts an afternoon hour to 12-hour form', () => {
    expect(formatClockTime(localInstant(13, 7))).toBe('01:07 PM');
  });

  it('renders midnight as 12:00 AM rather than 00:00 AM', () => {
    expect(formatClockTime(localInstant(0, 0))).toBe('12:00 AM');
  });

  it('renders noon as 12:00 PM rather than 00:00 PM', () => {
    expect(formatClockTime(localInstant(12, 0))).toBe('12:00 PM');
  });

  it('flips to PM exactly at noon, not after the noon hour', () => {
    // The two sides of the boundary: 11:59 is still morning, 12:01 is not.
    expect(formatClockTime(localInstant(11, 59))).toBe('11:59 AM');
    expect(formatClockTime(localInstant(12, 1))).toBe('12:01 PM');
  });

  it('keeps the hour after midnight in the 12 AM band', () => {
    expect(formatClockTime(localInstant(0, 45))).toBe('12:45 AM');
  });

  it('renders the last minute of the day as 11:59 PM', () => {
    expect(formatClockTime(localInstant(23, 59))).toBe('11:59 PM');
  });
});

describe('formatDisplayDate', () => {
  it('renders a stored date key as day, short month name, year', () => {
    expect(formatDisplayDate('2026-08-20')).toBe('20 Aug 2026');
  });

  it('drops the leading zero from a padded day', () => {
    expect(formatDisplayDate('2026-01-05')).toBe('5 Jan 2026');
  });

  it('maps the first and last months without an off-by-one', () => {
    expect(formatDisplayDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDisplayDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('never shifts the day it was handed, in any timezone', () => {
    // New Year's Day is the classic casualty of a Date round-trip: parsed as UTC and
    // printed locally it becomes 31 Dec for everyone west of Greenwich. This function
    // does string arithmetic instead, so the day it prints is the day it was given.
    expect(formatDisplayDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDisplayDate('2025-12-31')).toBe('31 Dec 2025');
  });

  it('hands back a string that is not a three-part date key unchanged', () => {
    // The honest answer to "I cannot read this" is to show it as-is, not to guess.
    expect(formatDisplayDate('2026-08')).toBe('2026-08');
    expect(formatDisplayDate('')).toBe('');
    expect(formatDisplayDate('2026-08-20-01')).toBe('2026-08-20-01');
  });

  it('does not invent a month name for a month number out of range', () => {
    // 13 has no name, and a month index of -1 must not wrap round to December. In both
    // cases the raw number is echoed back: unreadable, but not a fabrication.
    expect(formatDisplayDate('2026-13-01')).toBe('1 13 2026');
    expect(formatDisplayDate('2026-00-01')).toBe('1 00 2026');
  });

  it(
    'hands back a three-part string whose parts are not numbers unchanged, instead of printing NaN',
    () => {
      // REGRESSION GUARD. The `parts.length !== 3` guard exists to return the input
      // untouched when it cannot be read as a date, but it used to only count the parts -
      // it never checked that they were numeric. Any three-segment string slipped past it
      // and came out as 'NaN a not': a string that occupies a date's place on screen
      // while being no date at all.
      expect(formatDisplayDate('not-a-date')).toBe('not-a-date');
      expect(formatDisplayDate('2026-08-xx')).toBe('2026-08-xx');
    },
  );
});

describe('generateHostId', () => {
  it('builds a HOST- prefixed id of five uppercase hex digits', () => {
    stubRandomSequence([0.1, 0.2, 0.3, 0.4, 0.5]);

    expect(generateHostId()).toMatch(/^HOST-[0-9A-F]{5}$/);
  });

  it('reaches both ends of the hex alphabet without falling off it', () => {
    // Math.random() is specified as [0, 1). The bottom draw must select '0' and a draw
    // just short of 1 must select 'F' - an off-by-one in the index would yield an empty
    // character here and silently shorten the id.
    stubRandomSequence([0, 0.999999, 0.5, 0.0625, 0.9375]);

    expect(generateHostId()).toBe('HOST-0F81F');
  });

  it('returns a different id on each call', () => {
    // Driven from a fixed, varying sequence rather than the real generator: this asserts
    // that each call consumes fresh randomness, without betting the suite on luck.
    let draw = 0;
    jest.spyOn(Math, 'random').mockImplementation(() => {
      const value = ((draw * 7) % 16) / 16;
      draw += 1;
      return value;
    });

    const ids = [generateHostId(), generateHostId(), generateHostId()];

    expect(new Set(ids).size).toBe(3);
    ids.forEach(id => expect(id).toMatch(/^HOST-[0-9A-F]{5}$/));
  });

  it('never hands back the shared DEFAULT_HOST_ID', () => {
    // Every generated id must be distinguishable from the placeholder, or records from a
    // configured Host and an unconfigured one could not be told apart later.
    stubRandomSequence([0, 0, 0, 0, 0]);

    expect(generateHostId()).not.toBe(DEFAULT_HOST_ID);
  });

  it('produces an id made only of characters that survive the BLE payload charset', () => {
    // Host ids are stamped onto attendance records that travel over the air, so an id
    // this generates has to satisfy the same charset gate an employee id does.
    stubRandomSequence([0, 0.999999, 0.5, 0.0625, 0.9375]);

    expect(EMPLOYEE_ID_PATTERN.test(generateHostId())).toBe(true);
  });
});

describe('EMPLOYEE_ID_PATTERN', () => {
  it('accepts letters, digits, underscore and hyphen - the documented charset', () => {
    [
      'EMP001',
      'emp-001',
      'A_b-9',
      'abcdefghijklmnopqrstuvwxyz',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '0123456789',
      '_',
      '-',
      'a',
      '7',
    ].forEach(id => expect(EMPLOYEE_ID_PATTERN.test(id)).toBe(true));
  });

  it('accepts the DEFAULT_HOST_ID, which is stamped onto records the same way', () => {
    expect(EMPLOYEE_ID_PATTERN.test(DEFAULT_HOST_ID)).toBe(true);
  });

  it('rejects the empty id, so an unconfigured phone cannot advertise', () => {
    // DEFAULT_EMPLOYEE_ID is deliberately empty. If this pattern ever accepted it, every
    // unconfigured installation would broadcast the same identity - the single failure
    // that default exists to prevent.
    expect(DEFAULT_EMPLOYEE_ID).toBe('');
    expect(EMPLOYEE_ID_PATTERN.test(DEFAULT_EMPLOYEE_ID)).toBe(false);
    expect(EMPLOYEE_ID_PATTERN.test('')).toBe(false);
  });

  it('rejects whitespace anywhere in the id', () => {
    // Leading and trailing space matter as much as an internal one: two ids differing
    // only by a space would be two different people to the dedup key. \u00A0 is a
    // non-breaking space: invisible on screen, and not in the charset.
    [
      ' ',
      'EMP 001',
      ' EMP001',
      'EMP001 ',
      '	',
      'EMP	001',
      'EMP\u00A0001',
    ].forEach(id => expect(EMPLOYEE_ID_PATTERN.test(id)).toBe(false));
  });

  it('rejects punctuation outside the documented charset', () => {
    [
      'EMP.001',
      'EMP@001',
      'EMP/001',
      'EMP+001',
      'EMP:001',
      'EMP,001',
      'EMP#001',
      'EMP*001',
      'EMP%001',
      'EMP(001)',
      'EMP"001"',
      "EMP'001",
      'EMP\\001',
      'EMP|001',
      'EMP=001',
      'EMP?001',
      'EMP!001',
      'EMP;001',
      'EMP<001>',
      'EMP&001',
      'EMP$001',
      'EMP~001',
      'EMP001;',
      '.',
    ].forEach(id => expect(EMPLOYEE_ID_PATTERN.test(id)).toBe(false));
  });

  it('rejects non-ASCII characters, including ones that look like plain letters', () => {
    // The charset exists because the BLE payload encoding is ASCII-only. Written as
    // escapes so the intent survives any encoding round trip: an accented letter, a
    // Cyrillic 'EMP' that is pixel-identical to the Latin one, a fullwidth 'EMP', an
    // emoji, and a NUL byte that would truncate the payload outright.
    [
      'EMP\u00C9',
      '\u0415\u041C\u0420001',
      '\uFF25\uFF2D\uFF30001',
      'emp\u{1F600}',
      'EMP\u0000001',
    ].forEach(id => expect(EMPLOYEE_ID_PATTERN.test(id)).toBe(false));
  });

  it('anchors the whole string, so a second line cannot ride along on a valid one', () => {
    // JavaScript's $ without the m flag ends at the end of input, not at a line break.
    // If that ever changed, a well-formed first line would smuggle arbitrary text past
    // the gate and onto the air.
    ['EMP001\nDROP', 'EMP001\n', '\nEMP001', 'EMP001\r\nEMP002'].forEach(id =>
      expect(EMPLOYEE_ID_PATTERN.test(id)).toBe(false),
    );
  });

  it('gives the same answer for the same id every time it is asked', () => {
    // This regex is module-level state shared by the advertiser, the employee manager
    // and two screens. Adding a /g flag would make .test() carry lastIndex between
    // calls, so the same id would validate on one screen and be rejected on the next.
    expect(EMPLOYEE_ID_PATTERN.test('EMP001')).toBe(true);
    expect(EMPLOYEE_ID_PATTERN.test('EMP001')).toBe(true);
    expect(EMPLOYEE_ID_PATTERN.test('EMP001')).toBe(true);
    expect(EMPLOYEE_ID_PATTERN.lastIndex).toBe(0);
  });
});

describe('defaults', () => {
  it('ships no default employee identity at all', () => {
    // Both halves are empty on purpose. A placeholder name would show up on a Host's
    // screen as a person nobody ever observed.
    expect(DEFAULT_EMPLOYEE_ID).toBe('');
    expect(DEFAULT_EMPLOYEE_NAME).toBe('');
  });
});
