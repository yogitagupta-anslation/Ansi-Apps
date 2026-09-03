/**
 * EmployeeListItem.tsx
 * -----------------------------------------------------------------------------
 * The attendance row used on the Host dashboard and the Attendance screen.
 *
 * Deliberately free of BLE jargon. A manager scanning this list wants to know
 * who is here and when they arrived — not RSSI, UUIDs or advertisement counts.
 * Those live on the Debug screen.
 *
 * "Nearby" is shown as a plain-language live indicator, and is kept visually
 * subordinate to the attendance status, because the two are different things:
 * PRESENT is a stored fact, nearby is a momentary observation.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AttendanceRow } from '../attendance/attendanceTypes';
import { formatClockTime } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';
import { AttendanceBadge } from './StatusBadge';
import { EmployeeAvatar } from './EmployeeAvatar';
import { Icon } from './Icon';
import { Card, Txt } from './ui';

export function EmployeeListItem({
  row,
  onPress,
  photo,
}: {
  row: AttendanceRow;
  onPress?: () => void;
  /** Registry photo, resolved by the caller. Initials remain the fallback. */
  photo?: string;
}) {
  const t = useTheme();
  const record = row.record;
  const isAbsent = row.status === 'ABSENT';

  return (
    <Card onPress={onPress} style={{ marginBottom: t.spacing.sm }}>
      <View style={styles.top}>
        <EmployeeAvatar
          name={row.employeeName}
          employeeId={row.employeeId}
          size={44}
          dimmed={isAbsent}
          photo={photo}
        />

        <View style={{ flex: 1, marginHorizontal: t.spacing.md }}>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {row.employeeName}
          </Txt>
          <Txt variant="caption" color={t.colors.textMuted} numberOfLines={1}>
            {row.employeeId}
          </Txt>
        </View>

        <AttendanceBadge status={row.status} />
      </View>

      {/* Times only appear once there is something to show, so an absent row
          stays clean rather than filled with em dashes. */}
      {record?.checkInTime ? (
        <View style={[styles.times, { borderTopColor: t.colors.border, marginTop: t.spacing.md, paddingTop: t.spacing.md }]}>
          <TimeItem label="Check-in" value={formatClockTime(record.checkInTime)} />
          <TimeItem
            label="Last seen"
            value={record.lastSeenTime ? formatClockTime(record.lastSeenTime) : '—'}
          />
          {record.leftTime ? (
            <TimeItem
              label="Left"
              value={formatClockTime(record.leftTime)}
              color={t.colors.warning}
            />
          ) : (
            <View style={styles.timeItem}>
              <Txt variant="overline" color={t.colors.textMuted}>
                NOW
              </Txt>
              <View style={styles.nowRow}>
                {row.currentlyNearby ? (
                  <>
                    <Icon name="circle-dot" size={11} color={t.colors.success} />
                    <Txt variant="captionMedium" color={t.colors.success} style={{ marginLeft: 4 }}>
                      Nearby
                    </Txt>
                  </>
                ) : (
                  <Txt variant="caption" color={t.colors.textMuted}>
                    Not detected
                  </Txt>
                )}
              </View>
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function TimeItem({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.timeItem}>
      <Txt variant="overline" color={t.colors.textMuted}>
        {label.toUpperCase()}
      </Txt>
      <Txt variant="captionMedium" color={color ?? t.colors.textPrimary} style={{ marginTop: 2 }}>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', flexDirection: 'row' },
  times: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row' },
  timeItem: { flex: 1 },
  nowRow: { alignItems: 'center', flexDirection: 'row', marginTop: 2 },
});
