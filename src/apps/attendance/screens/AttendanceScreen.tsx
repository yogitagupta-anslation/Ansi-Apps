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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  deriveStatus,
  type AttendanceRow,
  type AttendanceStatus,
} from '../attendance/attendanceTypes';
import { EmployeeListItem } from '../components/EmployeeListItem';
import { FilterChips } from '../components/FilterChips';
import { FilterSheet } from '../components/FilterSheet';
import { StatTile, StatTileRow } from '../components/StatTile';
import { PageHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { DetectedEmptyState, EmployeeSkeleton, EmptyState } from '../components/states';
import { Card, Screen, Txt } from '../components/ui';
import { formatDisplayDate, todayDateString } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

type Filter = 'ALL' | AttendanceStatus;

/** Shift a YYYY-MM-DD key by whole days, staying in local time. */
function shiftDate(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function AttendanceScreen() {
  const t = useTheme();
  const store = useAppStore();

  const today = todayDateString();
  const [date, setDate] = useState(today);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [pastRows, setPastRows] = useState<AttendanceRow[] | null>(null);
  const [department, setDepartment] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);

  const navigation = useNavigation<{ navigate: (s: string, p?: object) => void }>();

  const isToday = date === today;

  /**
   * Past dates come from storage. Employees are joined in so someone who never
   * checked in still appears as absent rather than silently vanishing.
   */
  const loadPast = useCallback(async () => {
    if (isToday) {
      setPastRows(null);
      return;
    }
    setPastRows(null);
    const records = await store.attendanceManager.getAttendanceForDate(date);
    const byId = new Map(records.map(r => [r.employeeId, r]));

    setPastRows(
      store.employees.map(employee => {
        const record = byId.get(employee.employeeId) ?? null;
        return {
          employeeId: employee.employeeId,
          employeeName: employee.displayName,
          record,
          // A past day is settled: derive with a huge "now" so anyone who
          // checked in and never returned reads as LEFT, not PRESENT.
          status: deriveStatus(record, Number.MAX_SAFE_INTEGER, 0),
          currentlyNearby: false,
          currentRssi: null,
        };
      }),
    );
  }, [date, isToday, store.attendanceManager, store.employees]);

  useEffect(() => {
    void loadPast();
  }, [loadPast]);

  const rows = isToday ? store.attendanceRows : pastRows;

  const counts = useMemo(() => {
    const source = rows ?? [];
    return {
      all: source.length,
      PRESENT: source.filter(r => r.status === 'PRESENT').length,
      LEFT: source.filter(r => r.status === 'LEFT').length,
      ABSENT: source.filter(r => r.status === 'ABSENT').length,
    };
  }, [rows]);

  /**
   * Departments actually present in the registry — the filter must never offer
   * a department nobody is in, which would look like a broken filter.
   */
  const departments = useMemo(() => {
    const set = new Set<string>();
    store.employees.forEach(e => {
      if (e.department) {
        set.add(e.department);
      }
    });
    return Array.from(set).sort();
  }, [store.employees]);

  /** Registry photo lookup — attendance rows carry no photo of their own. */
  const photoById = useMemo(() => {
    const map = new Map<string, string | undefined>();
    store.employees.forEach(e => map.set(e.employeeId, e.photo));
    return map;
  }, [store.employees]);

  const visible = useMemo(() => {
    let list = rows ?? [];
    if (filter !== 'ALL') {
      list = list.filter(r => r.status === filter);
    }
    if (department) {
      // AttendanceRow carries no department, so resolve through the registry.
      const inDept = new Set(
        store.employees.filter(e => e.department === department).map(e => e.employeeId),
      );
      list = list.filter(r => inDept.has(r.employeeId));
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
  }, [rows, filter, query, department, store.employees]);

  return (
    <Screen>
      <PageHeader
        title="Attendance"
        subtitle={counts.all + ' registered employees'}
        right={
          /**
           * Entry point to the monthly reports.
           *
           * The Host tab bar has no History tab (Home / Attendance / Employees
           * / Settings), so without this the reports screen sits three taps
           * deep behind an employee detail page — unreachable in practice for
           * a headline feature.
           */
          <Pressable
            onPress={() => navigation.navigate('History')}
            accessibilityRole="button"
            accessibilityLabel="Monthly attendance reports"
            style={({ pressed }) => [
              styles.reportsButton,
              {
                backgroundColor: pressed ? t.colors.surfaceMuted : t.colors.surface,
                borderColor: t.colors.border,
                borderRadius: t.radius.md,
              },
            ]}>
            <Icon name="file-spreadsheet" size={16} color={t.colors.primary} />
            <Txt variant="captionMedium" color={t.colors.primary} style={{ marginLeft: 6 }}>
              Reports
            </Txt>
          </Pressable>
        }
      />

      {/* ============================= date selector ============================= */}
      <Card style={{ marginBottom: t.spacing.md }}>
        <View style={styles.dateRow}>
          <Pressable
            onPress={() => setDate(shiftDate(date, -1))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={({ pressed }) => [styles.arrow, { opacity: pressed ? 0.5 : 1 }]}>
            <Icon name="chevron-left" size={20} color={t.colors.textSecondary} />
          </Pressable>

          <View style={{ alignItems: 'center', flex: 1 }}>
            <Txt variant="bodyStrong">{formatDisplayDate(date)}</Txt>
            <Txt variant="caption" color={t.colors.textMuted}>
              {isToday ? 'Today' : 'Past record'}
            </Txt>
          </View>

          {/* Cannot navigate into the future - there is nothing to show. */}
          <Pressable
            onPress={() => !isToday && setDate(shiftDate(date, 1))}
            disabled={isToday}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            style={({ pressed }) => [
              styles.arrow,
              { opacity: isToday ? 0.25 : pressed ? 0.5 : 1 },
            ]}>
            <Icon name="chevron-right" size={20} color={t.colors.textSecondary} />
          </Pressable>
        </View>
      </Card>

      {/* Tiles double as filters: tapping one narrows the list, tapping the
          active one clears back to All. Same state as the chips below. */}
      <StatTileRow>
        <StatTile
          count={counts.PRESENT}
          label="Present"
          tone="success"
          selected={filter === 'PRESENT'}
          onPress={() => setFilter(filter === 'PRESENT' ? 'ALL' : 'PRESENT')}
        />
        <StatTile
          count={counts.LEFT}
          label="Left"
          tone="warning"
          selected={filter === 'LEFT'}
          onPress={() => setFilter(filter === 'LEFT' ? 'ALL' : 'LEFT')}
        />
        <StatTile
          count={counts.ABSENT}
          label="Absent"
          tone="danger"
          selected={filter === 'ABSENT'}
          onPress={() => setFilter(filter === 'ABSENT' ? 'ALL' : 'ABSENT')}
        />
      </StatTileRow>

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search employee…" />
        </View>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          style={({ pressed }) => [
            styles.filterButton,
            {
              backgroundColor: department ? t.colors.primarySoft : t.colors.surface,
              borderColor: department ? t.colors.primary : t.colors.border,
              borderRadius: t.radius.md,
              opacity: pressed ? 0.7 : 1,
            },
          ]}>
          <Icon
            name="sliders-horizontal"
            size={18}
            color={department ? t.colors.primary : t.colors.textSecondary}
          />
        </Pressable>
      </View>

      <FilterChips<Filter>
        active={filter}
        onChange={setFilter}
        options={[
          { key: 'ALL', label: 'All', count: counts.all },
          { key: 'PRESENT', label: 'Present', count: counts.PRESENT },
          { key: 'LEFT', label: 'Left', count: counts.LEFT },
          { key: 'ABSENT', label: 'Absent', count: counts.ABSENT },
        ]}
      />

      {/* ================================= list ================================= */}
      {rows === null ? (
        <EmployeeSkeleton count={4} />
      ) : store.employees.length === 0 ? (
        <Card>
          <EmptyState
            art="noEmployeesRegistered"
            icon="users"
            title="No employees registered"
            message="You haven't added any employees yet. Add your first employee to start attendance tracking."
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          {/*
            * Filters or search active: the agreed illustrated empty state with
            * "Clear Filters", exactly per the reference design. A day that
            * genuinely has no records for this status (no filters involved)
            * keeps the plain calendar message instead — clearing nothing
            * would be a button that lies.
            */}
          {query || filter !== 'ALL' || department ? (
            <DetectedEmptyState
              filtersActive
              onClearFilters={() => {
                setQuery('');
                setFilter('ALL');
                setDepartment('');
              }}
            />
          ) : (
            <EmptyState
              art="noAttendanceToday"
              icon="calendar-days"
              title={isToday ? 'No attendance recorded today' : 'No attendance recorded'}
              message={
                isToday
                  ? 'There are no check-ins, lefts, or absences yet. Start scanning to record attendance.'
                  : 'Nothing was recorded on ' + formatDisplayDate(date) + '.'
              }
            />
          )}
        </Card>
      ) : (
        visible.map(row => (
          <EmployeeListItem
            key={row.employeeId}
            row={row}
            photo={photoById.get(row.employeeId)}
            onPress={() =>
              navigation.navigate('EmployeeDetail', { employeeId: row.employeeId })
            }
          />
        ))
      )}

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        status={filter}
        onStatusChange={setFilter}
        department={department}
        onDepartmentChange={setDepartment}
        departments={departments}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  reportsButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  filterButton: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  dateRow: { alignItems: 'center', flexDirection: 'row' },
  arrow: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
});
