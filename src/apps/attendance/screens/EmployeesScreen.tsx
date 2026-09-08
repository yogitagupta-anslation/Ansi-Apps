/**
 * EmployeesScreen.tsx
 * -----------------------------------------------------------------------------
 * The Host's employee registry.
 *
 * REGISTERED IS NOT PRESENT. Registration is an admin fact — "the Host will
 * listen for this ID". Attendance comes only from real detection. The row shows
 * the person and their id; the trailing word is today's real status, so a
 * glance cannot conflate "on the list" with "here".
 *
 * The approved layout groups people by department into one card per group. Edit
 * and Remove moved to the employee detail page that these rows open — the row
 * is now too compact to carry two more controls, and the detail page is where
 * you already are when you have decided to change something about a person.
 * -----------------------------------------------------------------------------
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { deriveStatus } from '../attendance/attendanceTypes';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { EmptyState } from '../components/states';
import { Card, Screen, Txt } from '../components/ui';
import type { Employee } from '../employees/employeeTypes';
import { useAppStore } from '../state/appStore';
import { gradients } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

/** Employees with no department still need a home in a grouped list. */
const UNASSIGNED = 'Unassigned';

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

  /** One card per department, departments alphabetical, people alphabetical. */
  const groups = useMemo(() => {
    const byDept = new Map<string, Employee[]>();
    for (const employee of visible) {
      const dept = employee.department?.trim() || UNASSIGNED;
      const list = byDept.get(dept);
      if (list) list.push(employee);
      else byDept.set(dept, [employee]);
    }
    return Array.from(byDept.entries())
      .sort(([a], [b]) =>
        // Unassigned sorts last however it compares alphabetically.
        a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
      )
      .map(([dept, people]) => ({
        dept,
        people: people.sort((x, y) => x.displayName.localeCompare(y.displayName)),
      }));
  }, [visible]);

  const departmentCount = useMemo(
    () => new Set(store.employees.map(e => e.department?.trim()).filter(Boolean)).size,
    [store.employees],
  );

  /**
   * Add and edit both push AddEmployeeScreen rather than opening a sheet here.
   * There used to be a second copy of this form inline, which is how the two
   * drifted apart — one of them silently dropped the department field.
   */
  const openAdd = useCallback(() => navigation.navigate('AddEmployee'), [navigation]);

  return (
    <Screen>
      {/* --------------------------------------------------------- header -- */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Txt variant="display">Employees</Txt>
          <Txt variant="subtitle" color={t.colors.textMuted} style={{ marginTop: 3 }}>
            {store.employees.length +
              ' registered' +
              (departmentCount > 0
                ? ' · ' + departmentCount + (departmentCount === 1 ? ' department' : ' departments')
                : '')}
          </Txt>
        </View>

        <Pressable
          onPress={openAdd}
          accessibilityRole="button"
          accessibilityLabel="Add employee"
          style={({ pressed }) => [styles.fabSlot, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
          <LinearGradient
            colors={[...gradients.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.fab, styles.fabGlow]}>
            <Icon name="plus" size={19} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>

      {store.employees.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <SearchBar value={query} onChange={setQuery} placeholder="Search the registry" />
        </View>
      ) : null}

      {/* ---------------------------------------------------------- lists -- */}
      {store.employees.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState
            art="noEmployeesRegistered"
            icon="users"
            title="No employees registered"
            message="Add someone with the ID their phone will broadcast, and the Host will start listening for them."
            actionLabel="Add first employee"
            onAction={openAdd}
          />
        </View>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search-x"
          title="No employees found"
          message={'No employee matches "' + query + '". Try a different name, ID or department.'}
          actionLabel="Clear search"
          onAction={() => setQuery('')}
        />
      ) : (
        groups.map(group => (
          <View key={group.dept}>
            <Txt variant="groupLabel" color={t.colors.textMuted} style={styles.groupLabel}>
              {group.dept.toUpperCase()}
            </Txt>

            <View
              style={[
                styles.groupCard,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: t.colors.border,
                  borderRadius: t.radius.card,
                },
                t.shadow(1),
              ]}>
              {group.people.map((employee, index) => {
                const record = recordById.get(employee.employeeId) ?? null;
                const status = deriveStatus(record, now, grace);
                const trailing = !employee.enabled
                  ? 'Disabled'
                  : status.charAt(0) + status.slice(1).toLowerCase();

                return (
                  <Pressable
                    key={employee.employeeId}
                    onPress={() =>
                      navigation.navigate('EmployeeDetail', { employeeId: employee.employeeId })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={employee.displayName + '. ' + trailing}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0
                        ? { borderTopColor: t.colors.border, borderTopWidth: StyleSheet.hairlineWidth }
                        : null,
                      pressed ? { backgroundColor: t.colors.surfaceMuted } : null,
                      !employee.enabled ? { opacity: 0.62 } : null,
                    ]}>
                    <EmployeeAvatar
                      name={employee.displayName}
                      employeeId={employee.employeeId}
                      size={38}
                      dimmed={!employee.enabled}
                      photo={employee.photo}
                      badge={
                        detectedIds.has(employee.employeeId) ? t.colors.success : undefined
                      }
                    />

                    <View style={styles.identity}>
                      <Txt variant="heading" numberOfLines={1}>
                        {employee.displayName}
                      </Txt>
                      <Txt
                        variant="caption"
                        color={t.colors.textMuted}
                        mono
                        numberOfLines={1}
                        style={{ marginTop: 2 }}>
                        {employee.employeeId}
                      </Txt>
                    </View>

                    <Txt style={[styles.trailing, { color: t.colors.textMuted }]}>{trailing}</Txt>
                    <Icon name="chevron-right" size={16} color={t.colors.textMuted} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-end', flexDirection: 'row', gap: 12 },
  fabSlot: { flexShrink: 0 },
  fab: { alignItems: 'center', borderRadius: 999, height: 40, justifyContent: 'center', width: 40 },
  fabGlow: {
    elevation: 8,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.55,
    shadowRadius: 11,
  },

  empty: { marginTop: 18 },
  groupLabel: { marginBottom: 10, marginTop: 22 },
  groupCard: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  identity: { flex: 1, minWidth: 0 },
  trailing: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 11.5 },
});
