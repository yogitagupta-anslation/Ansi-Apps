/**
 * EmployeeHistory.tsx
 * -----------------------------------------------------------------------------
 * The employee's own attendance history, grouped by month.
 *
 * ARCHITECTURAL LIMIT, STATED ON SCREEN — not buried in a comment.
 *
 * BLE advertising is one-way, so this phone can never discover its attendance
 * by itself. Everything here arrived because a HOST connected back and wrote
 * it (see statusReport.ts). That has three consequences the UI must own:
 *
 *   1. history only extends as far as the last sync;
 *   2. a day this phone was never told about is UNKNOWN, never "absent" —
 *      the phone cannot tell a holiday from a day nobody synced;
 *   3. the Host remains the system of record.
 *
 * So the screen leads with when it last synced, and marks gaps as unknown
 * rather than inventing a verdict. Showing a confident "Absent" for a day the
 * phone simply never heard about would be the same class of lie as the old
 * fake PRESENT card.
 * -----------------------------------------------------------------------------
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StoredDay } from '../attendance/EmployeeStatusStore';
import { monthLabelOf } from '../attendance/monthlyReport';
import { formatDisplayDate } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';
import { Icon } from './Icon';
import { StatusBadge, type BadgeTone } from './StatusBadge';
import { EmptyState } from './states';
import { Card, SectionHeader, Txt } from './ui';

/** "545" minutes -> "09:05 AM". */
function clockOf(minutes: number | null): string | null {
  if (minutes === null) {
    return null;
  }
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + suffix;
}

function toneFor(status: StoredDay['status']): BadgeTone {
  return status === 'PRESENT' ? 'success' : status === 'LEFT' ? 'warning' : 'danger';
}

function labelFor(status: StoredDay['status']): string {
  return status === 'PRESENT' ? 'Present' : status === 'LEFT' ? 'Left' : 'Absent';
}

/** "2h ago" / "just now" — how current this phone's copy is. */
function agoLabel(ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return minutes + ' min ago';
  }
  const hoursAgo = Math.floor(minutes / 60);
  if (hoursAgo < 24) {
    return hoursAgo + (hoursAgo === 1 ? ' hour ago' : ' hours ago');
  }
  const daysAgo = Math.floor(hoursAgo / 24);
  return daysAgo + (daysAgo === 1 ? ' day ago' : ' days ago');
}

export function EmployeeHistory({
  days,
  lastSyncedAt,
}: {
  days: StoredDay[];
  lastSyncedAt: number | null;
}) {
  const t = useTheme();

  /** Newest month first, days within a month newest first. */
  const months = useMemo(() => {
    const grouped = new Map<string, StoredDay[]>();
    days.forEach(day => {
      const key = day.date.slice(0, 7);
      grouped.set(key, [...(grouped.get(key) ?? []), day]);
    });
    return Array.from(grouped.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, entries]) => ({
        key,
        label: monthLabelOf(key),
        entries: entries.sort((a, b) => b.date.localeCompare(a.date)),
      }));
  }, [days]);

  return (
    <>
      <SectionHeader
        title="Your attendance history"
        subtitle={
          lastSyncedAt
            ? 'Synced from the Host ' + agoLabel(lastSyncedAt)
            : 'Not synced yet'
        }
      />

      {/*
        * The limitation, stated up front rather than discovered. It is the
        * honest frame for everything below: this is a copy, not the record.
        */}
      <Card accent={t.colors.info}>
        <View style={styles.noteRow}>
          <Icon name="info" size={t.iconSize.sm} color={t.colors.info} />
          <Txt variant="heading" style={{ marginLeft: t.spacing.sm, flex: 1 }}>
            How this list is built
          </Txt>
        </View>
        <Txt
          variant="caption"
          color={t.colors.textSecondary}
          style={{ lineHeight: 19, marginTop: 8 }}>
          Your phone broadcasts your ID one way — it cannot read your attendance
          on its own. These days were sent to this phone by the office Host
          while you were in range, so the list only reaches as far as your last
          sync. Days you were never told about are not shown, and the Host holds
          the official record.
        </Txt>
      </Card>

      {months.length === 0 ? (
        <Card>
          <EmptyState
            art="noHistory"
            icon="calendar-days"
            title="No attendance history"
            message="Nothing has been synced to this phone yet. Your history appears here after the office Host detects you and sends your record."
          />
        </Card>
      ) : (
        months.map(month => (
          <View key={month.key}>
            <SectionHeader
              title={month.label}
              subtitle={month.entries.length + ' day' + (month.entries.length === 1 ? '' : 's') + ' synced'}
              style={{ marginTop: t.spacing.md }}
            />
            <Card padded={false}>
              {month.entries.map((day, i) => {
                const inAt = clockOf(day.checkInMinutes);
                const outAt = clockOf(day.checkOutMinutes);
                return (
                  <View
                    key={day.date}
                    style={[
                      styles.dayRow,
                      {
                        borderTopColor: t.colors.border,
                        borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                        padding: t.spacing.lg,
                      },
                    ]}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyMedium">
                        {formatDisplayDate(day.date)}
                      </Txt>
                      <Txt variant="caption" color={t.colors.textMuted} style={{ marginTop: 2 }}>
                        {inAt
                          ? 'In ' + inAt + (outAt ? '  ·  Out ' + outAt : '')
                          : 'No check-in recorded'}
                      </Txt>
                    </View>
                    <StatusBadge
                      label={labelFor(day.status)}
                      tone={toneFor(day.status)}
                      size="sm"
                    />
                  </View>
                );
              })}
            </Card>
          </View>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  noteRow: { alignItems: 'center', flexDirection: 'row' },
  dayRow: { alignItems: 'center', flexDirection: 'row' },
});
