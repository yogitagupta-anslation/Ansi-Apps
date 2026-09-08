/**
 * AttendanceScreen.tsx
 * -----------------------------------------------------------------------------
 * The main attendance register.
 *
 * Today is live — rows update as employees are detected. Past dates are read
 * from storage and are static, so live proximity is not shown for them: an
 * employee cannot be "nearby" on a day that has already ended.
 *
 * ABSENT means no advertisement was received from that employee that day. It is
 * the starting state, not a downgrade — nobody ever falls back to it after
 * checking in.
 * -----------------------------------------------------------------------------
 */

import React, { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { type AttendanceStatus } from '../attendance/attendanceTypes';
import { EmployeeListItem } from '../components/EmployeeListItem';
import { FilterChips } from '../components/FilterChips';
import { StatTile, StatTileRow } from '../components/StatTile';
import { SearchBar } from '../components/SearchBar';
import { DetectedEmptyState, EmployeeSkeleton, EmptyState } from '../components/states';
import { Screen, Txt } from '../components/ui';
import { todayDateString } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

type Filter = 'ALL' | AttendanceStatus;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Monday, September 7, 2026" — the approved date line. */
function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (
    WEEKDAYS[date.getDay()] + ', ' + MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + y
  );
}

export function AttendanceScreen() {
  const t = useTheme();
  const store = useAppStore();

  /**
   * TODAY ONLY, as the approved design has it: one date line, no stepper.
   *
   * Past days are not lost — History draws a month calendar and every cell
   * opens that day. This screen is the live register, and a day-stepper on a
   * live register invited the question "is this still updating?".
   */
  const date = todayDateString();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');

  const navigation = useNavigation<{
    navigate: (s: string, p?: object) => void;
    getParent: () => { navigate: (s: string) => void } | undefined;
  }>();

  const rows = store.attendanceRows;

  const counts = useMemo(() => {
    const source = rows ?? [];
    return {
      all: source.length,
      PRESENT: source.filter(r => r.status === 'PRESENT').length,
      LEFT: source.filter(r => r.status === 'LEFT').length,
      ABSENT: source.filter(r => r.status === 'ABSENT').length,
    };
  }, [rows]);

  /** Registry photo lookup — attendance rows carry no photo of their own. */
  const photoById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    store.employees.forEach(e => map.set(e.employeeId, e.photo));
    return map;
  }, [store.employees]);

  /** Same for department, which the row shows beside the id. */
  const deptById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    store.employees.forEach(e => map.set(e.employeeId, e.department || undefined));
    return map;
  }, [store.employees]);

  const visible = useMemo(() => {
    let list = rows ?? [];
    if (filter !== 'ALL') {
      list = list.filter(r => r.status === filter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        r =>
          r.employeeName.toLowerCase().includes(q) ||
          r.employeeId.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, filter, query]);

  return (
    <Screen>
      <View style={styles.header}>
        <Txt variant="display">Attendance</Txt>
        <Txt variant="subtitle" color={t.colors.textMuted} style={{ marginTop: 3 }}>
          {longDate(date)}
        </Txt>
      </View>

      {/* Read-outs, not controls: the chips below are the filter, and having
          two mechanisms for one job is what put a tinted ring on a tile. */}
      <StatTileRow>
        <StatTile count={counts.PRESENT} label="Present" tone="success" />
        <StatTile count={counts.LEFT} label="Left" tone="warning" />
        <StatTile count={counts.ABSENT} label="Absent" tone="neutral" />
      </StatTileRow>

      <SearchBar value={query} onChange={setQuery} placeholder="Search name or ID" />

      <FilterChips<Filter>
        active={filter}
        onChange={setFilter}
        /* No counts on the chips: the three tiles directly above already
           carry them, and the approved chip is a plain 32px pill. */
        options={[
          { key: 'ALL', label: 'All' },
          { key: 'PRESENT', label: 'Present' },
          { key: 'LEFT', label: 'Left' },
          { key: 'ABSENT', label: 'Absent' },
        ]}
      />

      {/* ================================= list ================================= */}
      {rows === null ? (
        <EmployeeSkeleton count={4} />
      ) : store.employees.length === 0 ? (
        <EmptyState
          art="noEmployeesRegistered"
          icon="users"
          title="No employees registered"
          message="You haven't added any employees yet. Add your first employee to start attendance tracking."
        />
      ) : visible.length === 0 ? (
        /*
         * Filters or search active: the agreed illustrated empty state with
         * "Clear Filters", exactly per the reference design. A day that
         * genuinely has no records for this status (no filters involved)
         * keeps the plain calendar message instead — clearing nothing
         * would be a button that lies.
         */
        query || filter !== 'ALL' ? (
          <DetectedEmptyState
            filtersActive
            onClearFilters={() => {
              setQuery('');
              setFilter('ALL');
            }}
          />
        ) : (
          <EmptyState
            art="noAttendanceToday"
            icon="calendar-days"
            title="No attendance yet today"
            message="The Host has not recorded anyone. Start scanning and employees appear here the moment they are confirmed nearby."
            /* The approved CTA. Home IS the scanner in v3 — the orbit toggles
               it — so this goes to the Home tab, not the old Scanner screen. */
            actionLabel="Go to scanner"
            actionIcon="radio"
            actionTone="soft"
            onAction={() => navigation.getParent()?.navigate('Home')}
          />
        )
      ) : (
        <View style={styles.list}>
          {visible.map(row => (
            <EmployeeListItem
              key={row.employeeId}
              row={row}
              photo={photoById.get(row.employeeId)}
              department={deptById.get(row.employeeId)}
              onPress={() =>
                navigation.navigate('EmployeeDetail', { employeeId: row.employeeId })
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 18 },
  list: { gap: 9 },
});
