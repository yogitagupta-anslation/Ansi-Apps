/**
 * EmployeesScreen.tsx
 * -----------------------------------------------------------------------------
 * The Host's employee registry.
 *
 * REGISTERED IS NOT PRESENT. Registration is an admin fact — "the Host will
 * listen for this ID". Attendance comes only from real detection. The card
 * shows them on separate rows so a glance cannot conflate them.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { deriveStatus } from '../attendance/attendanceTypes';
import { PageHeader } from '../components/AppHeader';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { AttendanceBadge, StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/states';
import { Button, Card, Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import type { Employee } from '../employees/employeeTypes';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

export function EmployeesScreen() {
  const navigation = useNavigation<{ navigate: (s: string, p?: object) => void }>();
  const t = useTheme();
  const store = useAppStore();

  const [query, setQuery] = useState('');

  const now = Date.now();
  const grace = store.settings.proximity.missingGracePeriodMs;
  const recordById = useMemo(
    () => new Map(store.todayRecords.map(r => [r.employeeId, r])),
    [store.todayRecords],
  );
  const detectedIds = useMemo(
    () => new Set(store.scan.detected.map(d => d.employeeId)),
    [store.scan.detected],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return store.employees;
    }
    return store.employees.filter(
      e =>
        e.displayName.toLowerCase().includes(q) ||
        e.employeeId.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q),
    );
  }, [store.employees, query]);

  /**
   * Add and edit both push AddEmployeeScreen rather than opening a sheet here.
   * There used to be a second copy of this form inline, which is how the two
   * drifted apart — one of them silently dropped the department field.
   */
  const openAdd = useCallback(
    () => navigation.navigate('AddEmployee'),
    [navigation],
  );

  const openEdit = useCallback(
    (employee: Employee) => navigation.navigate('AddEmployee', { employeeId: employee.employeeId }),
    [navigation],
  );

  const confirmDelete = useCallback(
    (employee: Employee) => {
      Alert.alert(
        'Remove ' + employee.displayName + '?',
        'They will no longer be detected. Past attendance records are kept — removing someone does not rewrite history.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => void store.employeeManager.removeEmployee(employee.employeeId),
          },
        ],
      );
    },
    [store.employeeManager],
  );

  return (
    <Screen>
      <PageHeader
        title="Employees"
        subtitle={store.employees.length + ' registered'}
        right={
          <Button title="Add" onPress={openAdd} icon="plus" size="sm" fullWidth={false} />
        }
      />

      {store.employees.length > 0 ? (
        <SearchBar value={query} onChange={setQuery} placeholder="Search name, ID or department…" />
      ) : null}

      {store.employees.length === 0 ? (
        <Card>
          <EmptyState
            art="noEmployeesRegistered"
            icon="users"
            title="No employees registered"
            message="You haven't added any employees yet. Add your first employee to start attendance tracking."
            actionLabel="Add employee"
            onAction={openAdd}
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="search-x"
            title="No employees found"
            message={'No employee matches "' + query + '". Try a different name, ID or department.'}
            actionLabel="Clear search"
            onAction={() => setQuery('')}
          />
        </Card>
      ) : (
        visible.map(employee => {
          const record = recordById.get(employee.employeeId) ?? null;
          const status = deriveStatus(record, now, grace);
          return (
            <Card
              key={employee.employeeId}
              onPress={() =>
                navigation.navigate('EmployeeDetail', { employeeId: employee.employeeId })
              }
              style={!employee.enabled ? { opacity: 0.62 } : undefined}>
              <View style={styles.row}>
                <EmployeeAvatar
                  name={employee.displayName}
                  employeeId={employee.employeeId}
                  size={46}
                  dimmed={!employee.enabled}
                  photo={employee.photo}
                />
                <View style={{ flex: 1, marginHorizontal: t.spacing.md }}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {employee.displayName}
                  </Txt>
                  <Txt variant="caption" color={t.colors.textMuted} numberOfLines={1}>
                    {employee.employeeId}
                    {employee.department ? '  ·  ' + employee.department : ''}
                  </Txt>
                </View>
                <StatusBadge
                  label={employee.enabled ? 'Registered' : 'Disabled'}
                  tone={employee.enabled ? 'accent' : 'neutral'}
                  size="sm"
                />
              </View>

              {/* Attendance shown separately from registration, on its own row. */}
              <View
                style={[
                  styles.statusRow,
                  { borderTopColor: t.colors.border, marginTop: t.spacing.md, paddingTop: t.spacing.md },
                ]}>
                <View style={styles.rowCenter}>
                  <AttendanceBadge status={status} size="sm" />
                  {record?.checkInTime ? (
                    <Txt variant="caption" color={t.colors.textMuted} style={{ marginLeft: t.spacing.sm }}>
                      {formatClockTime(record.checkInTime)}
                    </Txt>
                  ) : null}
                </View>

                {detectedIds.has(employee.employeeId) ? (
                  <View style={styles.rowCenter}>
                    <Icon name="circle-dot" size={11} color={t.colors.success} />
                    <Txt variant="caption" color={t.colors.success} style={{ marginLeft: 4 }}>
                      Nearby
                    </Txt>
                  </View>
                ) : null}
              </View>

              <View style={[styles.actions, { borderTopColor: t.colors.border, marginTop: t.spacing.md, paddingTop: t.spacing.sm }]}>
                <Pressable
                  onPress={() => openEdit(employee)}
                  accessibilityRole="button"
                  accessibilityLabel={'Edit ' + employee.displayName}
                  style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="pencil" size={15} color={t.colors.textSecondary} />
                  <Txt variant="captionMedium" color={t.colors.textSecondary} style={{ marginLeft: 6 }}>
                    Edit
                  </Txt>
                </Pressable>

                <Pressable
                  onPress={() => confirmDelete(employee)}
                  accessibilityRole="button"
                  accessibilityLabel={'Remove ' + employee.displayName}
                  style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="trash-2" size={15} color={t.colors.error} />
                  <Txt variant="captionMedium" color={t.colors.error} style={{ marginLeft: 6 }}>
                    Remove
                  </Txt>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  rowCenter: { alignItems: 'center', flexDirection: 'row' },
  statusRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  action: { alignItems: 'center', flexDirection: 'row', marginRight: 20, paddingVertical: 8 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%' },
  handleWrap: { alignItems: 'center', paddingBottom: 4, paddingTop: 10 },
  handle: { borderRadius: 3, height: 4, width: 40 },
  toggleRow: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
