/**
 * EmployeeDetailScreen.tsx
 * -----------------------------------------------------------------------------
 * One employee, as the HOST sees them: today's timeline, registry details, and
 * a link into their history.
 *
 * Host-side only, and that is the point — the Host is the device that actually
 * holds the attendance record, so this is the one screen in the app that can
 * honestly show a check-in time next to a status.
 *
 * "Currently in range" and the check-in time are separate facts and are shown
 * separately. An employee can be PRESENT (checked in this morning) while not
 * detected right now, and conflating the two would misreport both.
 * -----------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { AttendanceStatus } from '../attendance/attendanceTypes';
import { attendanceVisual } from '../components/StatusBadge';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Timeline, type TimelineEntry } from '../components/Timeline';
import { Button, Card, Screen, Txt } from '../components/ui';
import { EmptyState } from '../components/states';
import { formatClockTime, formatDisplayDate } from '../constants/appConfig';
import { useAppStore } from '../state/appStore';
import { useTheme } from '../theme/ThemeContext';

/** Timeline has its own narrow tone union, so map explicitly. */
function toneOf(status: AttendanceStatus): 'success' | 'warning' | 'danger' {
  return status === 'PRESENT' ? 'success' : status === 'LEFT' ? 'warning' : 'danger';
}

export function EmployeeDetailScreen() {
  const t = useTheme();
  const store = useAppStore();
  const navigation = useNavigation<{ navigate: (s: string) => void; goBack: () => void }>();
  const route = useRoute<{ key: string; name: string; params?: { employeeId?: string } }>();

  const employeeId = route.params?.employeeId ?? '';

  const row = store.attendanceRows.find(r => r.employeeId === employeeId) ?? null;
  const employee = store.employees.find(e => e.employeeId === employeeId) ?? null;

  const entries = useMemo<TimelineEntry[]>(() => {
    if (!row) {
      return [];
    }
    const record = row.record;
    const out: TimelineEntry[] = [];

    out.push({
      label: 'Checked in',
      value: record?.checkInTime ? formatClockTime(record.checkInTime) : 'Not yet today',
      detail: record?.checkInTime ? 'Recorded by this Host' : undefined,
      tone: record?.checkInTime ? 'success' : 'neutral',
    });

    out.push({
      label: 'Last seen',
      value: record?.lastSeenTime ? formatClockTime(record.lastSeenTime) : '—',
      detail: record?.lastSeenTime ? 'Last advertisement received' : 'No advertisement received',
      tone: record?.lastSeenTime ? 'success' : 'neutral',
    });

    if (record?.leftTime) {
      out.push({
        label: 'Marked as left',
        value: formatClockTime(record.leftTime),
        detail: 'Out of range past the grace period',
        tone: 'warning',
      });
    }

    out.push({
      label: 'Status',
      value: attendanceVisual(row.status, t).label,
      // Live proximity is a DIFFERENT fact from attendance status. Both shown.
      detail: row.currentlyNearby ? 'Currently in range' : 'Not currently in range',
      tone: toneOf(row.status),
    });

    return out;
  }, [row, t]);

  if (!employee) {
    return (
      <Screen>
        <PageHeader title="Employee" />
        <Card>
          <EmptyState
            icon="user-x"
            title="Employee not found"
            message="This employee is no longer in the registry on this device."
          />
        </Card>
        <Button title="Go back" onPress={() => navigation.goBack()} variant="neutral" />
      </Screen>
    );
  }

  const status = row?.status ?? 'ABSENT';
  const visual = attendanceVisual(status, t);

  return (
    <Screen>
      <PageHeader title="Employee details" onBack={() => navigation.goBack()} />

      {/* -------------------------------------------------------- identity -- */}
      <Card>
        <View style={styles.identity}>
          <EmployeeAvatar
            name={employee.displayName}
            employeeId={employee.employeeId}
            size={68}
            photo={employee.photo}
            badge={row?.currentlyNearby ? t.colors.success : undefined}
          />
          <View style={{ flex: 1, marginLeft: t.spacing.lg }}>
            <Txt variant="title" numberOfLines={2}>
              {employee.displayName}
            </Txt>
            <View style={[styles.metaRow, { marginTop: 6 }]}>
              <Txt variant="caption" color={t.colors.textMuted} mono>
                {employee.employeeId}
              </Txt>
              <View style={{ marginLeft: t.spacing.sm }}>
                <StatusBadge label={visual.label} tone={visual.tone} size="sm" />
              </View>
            </View>
          </View>
        </View>

        {!employee.enabled ? (
          <View
            style={[
              styles.disabled,
              {
                backgroundColor: t.colors.warningSoft,
                borderRadius: t.radius.sm,
                marginTop: t.spacing.md,
                padding: t.spacing.md,
              },
            ]}>
            <Icon name="pause" size={14} color={t.colors.warning} />
            <Txt variant="caption" color={t.colors.warning} style={{ marginLeft: 8, flex: 1 }}>
              Disabled — the scanner ignores this employee, so no new attendance
              is recorded for them.
            </Txt>
          </View>
        ) : null}
      </Card>

      {/* -------------------------------------------------------- timeline -- */}
      <Card>
        <Txt variant="heading" style={{ marginBottom: t.spacing.lg }}>
          Today's activity
        </Txt>
        <Timeline entries={entries} />
      </Card>

      {/* ---------------------------------------------------- registry info -- */}
      <Card>
        <Txt variant="heading" style={{ marginBottom: t.spacing.md }}>
          Employee info
        </Txt>
        <InfoRow icon="building-2" label="Department" value={employee.department ?? '—'} />
        <InfoRow icon="phone" label="Phone" value={employee.phone ?? '—'} />
        <InfoRow icon="mail" label="Email" value={employee.email ?? '—'} />
        <InfoRow
          icon="calendar-days"
          label="Registered on"
          value={formatDisplayDate(dateStringOf(employee.createdAt))}
        />
      </Card>

      <Button
        title="VIEW FULL HISTORY"
        onPress={() => navigation.navigate('History')}
        gradient
        size="lg"
      />
    </Screen>
  );
}

/* ---------------------------------------------------------------- InfoRow -- */

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.infoRow, { paddingVertical: 9 }]}>
      <Icon name={icon} size={15} color={t.colors.textMuted} />
      <Txt variant="caption" color={t.colors.textSecondary} style={{ flex: 1, marginLeft: 10 }}>
        {label}
      </Txt>
      <Txt variant="captionMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Txt>
    </View>
  );
}

/** Timestamp -> YYYY-MM-DD, so formatDisplayDate can render it. */
function dateStringOf(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', flexDirection: 'row' },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  disabled: { alignItems: 'center', flexDirection: 'row' },
  infoRow: { alignItems: 'center', flexDirection: 'row' },
});
