/**
 * HistoryScreen.tsx
 * -----------------------------------------------------------------------------
 * Attendance history, grouped by day and read entirely from local storage.
 * Works offline because there is nowhere else for the data to be.
 *
 * Tapping a day expands the individual records for it.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import type { AttendanceDaySummary, AttendanceRecord } from '../attendance/attendanceTypes';
import { AttendanceReports } from '../components/AttendanceReports';
import { EmployeeHistory } from '../components/EmployeeHistory';
import { PageHeader } from '../components/AppHeader';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { Segmented } from '../components/Segmented';
import { StatTile, StatTileRow } from '../components/StatTile';
import { StatusBadge } from '../components/StatusBadge';
import { EmployeeSkeleton, EmptyState } from '../components/states';
import { Card, Screen, SectionHeader, Txt } from '../components/ui';
import { formatClockTime, formatDisplayDate, todayDateString } from '../constants/appConfig';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function HistoryScreen() {
  const t = useTheme();
  /**
   * This screen is BOTH an Employee tab root and a pushed screen in the Host's
   * stacks. Only the pushed case has somewhere to go back to, so the arrow is
   * conditional — a dead back button on a tab root is worse than none.
   */
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();
  const store = useAppStore();
  const isEmployee = store.settings.role === 'EMPLOYEE';

  const [days, setDays] = useState<AttendanceDaySummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'DAY' | 'SUMMARY'>('DAY');

  const load = useCallback(async () => {
    setDays(await store.attendanceManager.getAttendanceHistory(90));
  }, [store.attendanceManager]);

  useEffect(() => {
    void load();
    // Reload when today's records change so a fresh check-in appears here too.
  }, [load, store.todayRecords.length]);

  const toggle = useCallback(
    async (date: string) => {
      if (expanded === date) {
        setExpanded(null);
        return;
      }
      setExpanded(date);
      setRecords(await store.attendanceManager.getAttendanceForDate(date));
    },
    [expanded, store.attendanceManager],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const today = todayDateString();
  const visibleDays = (days ?? []).filter(d =>
    query ? formatDisplayDate(d.date).toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  /**
   * EMPLOYEE: their own synced days, and nothing else. Returned early rather
   * than threading `isEmployee` through the Host sections below — those render
   * company-wide history and monthly exports, none of which an employee device
   * holds or may see.
   */
  if (isEmployee) {
    return (
      <Screen
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
        }>
        <PageHeader
          onBack={canGoBack ? () => navigation.goBack() : undefined}
          title="History"
          subtitle={
            store.employeeHistory.length +
            ' day' +
            (store.employeeHistory.length === 1 ? '' : 's') +
            ' synced to this phone'
          }
        />
        <EmployeeHistory
          days={store.employeeHistory}
          lastSyncedAt={store.employeeLastSyncedAt}
        />
      </Screen>
    );
  }

  return (
    <Screen
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
      }>
      <PageHeader
        onBack={canGoBack ? () => navigation.goBack() : undefined}
        title="History"
        subtitle={
          days
            ? days.length + ' day' + (days.length === 1 ? '' : 's') + ' recorded'
            : 'Loading…'
        }
      />

      {/*
        * HOST ONLY. This screen is in both role's tab stacks, so the gate lives
        * here rather than in the navigator — and ReportExportService asserts
        * the role again before reading company-wide records. An Employee
        * device holds only its own delivered status and must never see, let
        * alone export, everyone else's attendance.
        */}
      <AttendanceReports />

      <SectionHeader title="Daily history" style={{ marginTop: t.spacing.xl }} />

      <Segmented
        options={[
          { value: 'DAY' as const, label: 'Day view' },
          { value: 'SUMMARY' as const, label: 'Summary' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'DAY' && days && days.length > 3 ? (
        <SearchBar value={query} onChange={setQuery} placeholder="Search by date…" />
      ) : null}

      {view === 'SUMMARY' && days && days.length > 0 ? (
        <>
          {/* Totals across every recorded day, not an average — a mean would
              hide the shape of the data and invites over-reading. */}
          <StatTileRow>
            <StatTile
              count={days.reduce((n, d) => n + d.presentCount, 0)}
              label="Attended"
              tone="success"
            />
            <StatTile
              count={days.reduce((n, d) => n + d.leftCount, 0)}
              label="Left early"
              tone="warning"
            />
            <StatTile count={days.length} label="Days" tone="neutral" />
          </StatTileRow>
          <Txt
            variant="caption"
            color={t.colors.textMuted}
            style={{ marginBottom: t.spacing.lg }}>
            Totals across all {days.length} recorded day
            {days.length === 1 ? '' : 's'} held on this device.
          </Txt>
        </>
      ) : null}

      {days === null ? (
        <EmployeeSkeleton count={4} />
      ) : visibleDays.length === 0 ? (
        <Card>
          {/* Role-aware: on an Employee device this is empty BY DESIGN, because
              attendance lives on the Host. Saying so beats implying data loss. */}
          <EmptyState
            /* A search that matched nothing is a filter result, not an empty
               archive — the illustration would overstate it. */
            art={query ? undefined : 'noHistory'}
            icon="calendar-days"
            title={query ? 'No matching days' : 'No attendance history'}
            message={
              query
                ? 'Try a different date.'
                : "You don't have any past attendance records. Check back later to view attendance history."
            }
          />
        </Card>
      ) : (
        visibleDays.map(day => {
          const isOpen = expanded === day.date;
          return (
            <Card key={day.date} padded={false} style={{ marginBottom: t.spacing.sm }}>
              <Pressable
                onPress={() => toggle(day.date)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
                <View style={[styles.dayRow, { padding: t.spacing.lg }]}>
                  <View
                    style={[
                      styles.dateBlock,
                      { backgroundColor: t.colors.primarySoft, borderRadius: t.radius.md },
                    ]}>
                    <Txt variant="overline" color={t.colors.primary}>
                      {formatDisplayDate(day.date).split(' ')[1]?.toUpperCase() ?? ''}
                    </Txt>
                    <Txt variant="bodyStrong" color={t.colors.primary}>
                      {formatDisplayDate(day.date).split(' ')[0]}
                    </Txt>
                  </View>

                  <View style={{ flex: 1, marginLeft: t.spacing.md }}>
                    <Txt variant="bodyStrong">
                      {formatDisplayDate(day.date)}
                      {day.date === today ? '  ·  Today' : ''}
                    </Txt>
                    <View style={[styles.countRow, { marginTop: 4 }]}>
                      <StatusBadge label={day.presentCount + ' attended'} tone="success" size="sm" />
                      {day.leftCount > 0 ? (
                        <View style={{ marginLeft: 6 }}>
                          <StatusBadge label={day.leftCount + ' left'} tone="warning" size="sm" />
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <Icon
                    name={isOpen ? 'chevron-left' : 'chevron-right'}
                    size={18}
                    color={t.colors.textMuted}
                  />
                </View>
              </Pressable>

              {isOpen ? (
                <View
                  style={{
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: t.colors.border,
                    paddingHorizontal: t.spacing.lg,
                    paddingBottom: t.spacing.sm,
                  }}>
                  {records.length === 0 ? (
                    <Txt variant="caption" color={t.colors.textMuted} style={{ paddingVertical: 14 }}>
                      No records for this day.
                    </Txt>
                  ) : (
                    records.map(record => (
                      <View key={record.id} style={[styles.recordRow, { paddingVertical: t.spacing.md }]}>
                        <EmployeeAvatar
                          name={record.employeeName}
                          employeeId={record.employeeId}
                          size={34}
                          photo={
                            store.employees.find(e => e.employeeId === record.employeeId)?.photo
                          }
                        />
                        <View style={{ flex: 1, marginLeft: t.spacing.md }}>
                          <Txt variant="bodyMedium" numberOfLines={1}>
                            {record.employeeName}
                          </Txt>
                          <Txt variant="caption" color={t.colors.textMuted}>
                            {record.employeeId}
                          </Txt>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Txt variant="captionMedium" color={t.colors.success}>
                            {record.checkInTime ? formatClockTime(record.checkInTime) : '—'}
                          </Txt>
                          <Txt variant="caption" color={t.colors.textMuted}>
                            {record.leftTime
                              ? 'left ' + formatClockTime(record.leftTime)
                              : record.lastSeenTime
                              ? 'seen ' + formatClockTime(record.lastSeenTime)
                              : ''}
                          </Txt>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayRow: { alignItems: 'center', flexDirection: 'row' },
  dateBlock: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8, minWidth: 54 },
  countRow: { flexDirection: 'row' },
  recordRow: { alignItems: 'center', flexDirection: 'row' },
});
