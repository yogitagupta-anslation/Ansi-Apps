/**
 * CheckInSuccessScreen.tsx
 * -----------------------------------------------------------------------------
 * The celebration moment for a check-in that has genuinely been recorded.
 *
 * USED ON BOTH SIDES, AND HONEST ON BOTH
 * --------------------------------------
 * HOST      — the device that wrote the record. Name and time come straight
 *             out of what was just written.
 * EMPLOYEE  — shown only when a Host has genuinely DELIVERED a status report
 *             over the BLE reply channel. The time rendered is the Host's
 *             recorded check-in time, not a local guess, and the Host id is
 *             displayed so the confirmation is always attributable.
 *
 * This was Host-only while advertising was one-way and unacknowledged. The
 * reply channel changed the facts, so the screen changed with them — the rule
 * was never "no celebration on the employee", it was "never claim what the
 * device does not know".
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Celebration } from '../components/Celebration';
import { EmployeeAvatar } from '../components/EmployeeAvatar';
import { Icon } from '../components/Icon';
import { Button, Card, Screen, Txt } from '../components/ui';
import { formatClockTime } from '../constants/appConfig';
import { useTheme } from '../theme/ThemeContext';

export function CheckInSuccessScreen({
  employeeName,
  employeeId,
  checkInTime,
  onDismiss,
  photo,
  variant = 'host',
  hostId,
}: {
  employeeName: string;
  employeeId: string;
  /** Registry photo, when the employee has one. */
  photo?: string;
  /** Straight from the written record — never Date.now() at render time. */
  checkInTime: number;
  onDismiss: () => void;
  /** Whose screen this is. Changes the wording, never the source of truth. */
  variant?: 'host' | 'employee';
  /** Which Host recorded it. Shown on the employee side as attribution. */
  hostId?: string;
}) {
  const t = useTheme();
  const isEmployee = variant === 'employee';

  return (
    <Screen scroll={false} contentStyle={styles.center}>
      <Celebration />

      <Txt variant="display" align="center" style={{ marginTop: t.spacing.xl }}>
        {isEmployee ? "You're checked in" : 'Attendance marked'}
      </Txt>
      <Txt
        variant="body"
        color={t.colors.textSecondary}
        align="center"
        style={{ marginTop: 6, maxWidth: 300 }}>
        {isEmployee ? 'You were marked present at ' : employeeName + ' was recorded as present at '}
        <Txt variant="bodyStrong" color={t.colors.success}>
          {formatClockTime(checkInTime)}
        </Txt>
      </Txt>

      <Card style={{ marginTop: t.spacing.xxl, width: '100%' }}>
        <View style={styles.row}>
          <EmployeeAvatar
            name={employeeName}
            employeeId={employeeId}
            size={48}
            photo={photo}
            badge={t.colors.success}
          />
          <View style={{ flex: 1, marginLeft: t.spacing.md }}>
            <Txt variant="bodyStrong" numberOfLines={1}>
              {employeeName}
            </Txt>
            <Txt variant="caption" color={t.colors.textMuted} mono>
              {employeeId}
            </Txt>
          </View>
          <Icon name="circle-check" size={22} color={t.colors.success} />
        </View>
      </Card>

      <Txt
        variant="caption"
        color={t.colors.textMuted}
        align="center"
        style={{ lineHeight: 18, marginTop: t.spacing.lg }}>
        {isEmployee
          ? // Attribution matters: this phone is REPORTING what a Host wrote,
            // it is not the authority on its own attendance.
            'Recorded by ' +
            (hostId ?? 'the office Host') +
            ' and delivered to this phone over Bluetooth.'
          : "Stored locally on this device. The status is also delivered to the employee's phone over Bluetooth while they are in range."}
      </Txt>

      <View style={{ marginTop: t.spacing.xxl, width: '100%' }}>
        <Button title="GREAT" onPress={onDismiss} variant="success" size="lg" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  row: { alignItems: 'center', flexDirection: 'row' },
});
