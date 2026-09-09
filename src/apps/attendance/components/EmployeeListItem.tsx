/**
 * EmployeeListItem.tsx
 * -----------------------------------------------------------------------------
 * The attendance row used by the Attendance register.
 *
 * Deliberately free of BLE jargon. A manager scanning this list wants to know
 * who is here and when they arrived — not RSSI, UUIDs or advertisement counts.
 * Those live on the Debug screen.
 *
 * The pill on the right names the recorded status and carries its colour.
 * "Currently nearby" is a momentary observation rather than a stored fact, so
 * it rides on the avatar as a live dot instead of competing with it.
 *
 * ABSENT is slate, never red: an employee who has not arrived has done nothing
 * wrong, and colouring it as an error would misrepresent the record.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AttendanceRow } from '../attendance/attendanceTypes';
import { formatClockTime } from '../constants/appConfig';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { EmployeeAvatar } from './EmployeeAvatar';
import { Txt } from './ui';

export function EmployeeListItem({
  row,
  onPress,
  photo,
  department,
}: {
  row: AttendanceRow;
  onPress?: () => void;
  /** Registry photo, resolved by the caller. Initials remain the fallback. */
  photo?: string;
  /** Registry department, resolved by the caller. Omitted when unknown. */
  department?: string;
}) {
  const t = useTheme();
  const record = row.record;
  const isAbsent = row.status === 'ABSENT';

  const tone =
    row.status === 'PRESENT'
      ? { fg: t.colors.success, soft: t.colors.successSoft }
      : row.status === 'LEFT'
      ? { fg: t.colors.warning, soft: t.colors.warningSoft }
      : { fg: t.colors.textMuted, soft: t.colors.surfaceMuted };

  /**
   * "09:02 → now" while still present, "09:02 → 17:30" once settled — and
   * "09:02 → 17:00 declared" when the employee said so themselves.
   *
   * The word goes on the line carrying the NUMBER, not beside it, because this
   * is the line a Host actually reads. Two departures can put a time here and
   * they do not mean the same thing:
   *
   *   inferred  the grace period elapsed in silence. The Host stopped hearing
   *             them, which is why the time is the last thing it observed.
   *   declared  they pressed Check out on their own phone and this Host read
   *             it off the air. The radio may still hear them perfectly well.
   *
   * That second case is exactly why the label is not optional. `deriveStatus`
   * reads radio silence alone, so for up to one grace period the pill can say
   * PRESENT in green, the avatar can carry its live "currently nearby" dot,
   * and this line can carry a departure time — all three true at once. Without
   * the word, that reads as a contradiction or a bug. With it, it reads as
   * what it is: they told us they were leaving, and we can still hear them.
   */
  const declared = record?.leftTimeSource === 'DECLARED';

  const span = record?.checkInTime
    ? formatClockTime(record.checkInTime) +
      ' → ' +
      (record.leftTime ? formatClockTime(record.leftTime) : 'now') +
      (declared ? ' declared' : '')
    : '—';

  const body = (
    <View
      style={[
        styles.row,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadow(1),
      ]}>
      <EmployeeAvatar
        name={row.employeeName}
        employeeId={row.employeeId}
        size={40}
        dimmed={isAbsent}
        photo={photo}
        badge={row.currentlyNearby ? t.colors.success : undefined}
      />

      <View style={styles.identity}>
        <Txt variant="heading" numberOfLines={1}>
          {row.employeeName}
        </Txt>
        <Txt
          color={t.colors.textMuted}
          mono
          numberOfLines={1}
          style={styles.identityLine}>
          {department ? row.employeeId + ' · ' + department : row.employeeId}
        </Txt>
      </View>

      <View style={styles.right}>
        <View style={[styles.pill, { backgroundColor: tone.soft, borderRadius: t.radius.pill }]}>
          <Txt style={[styles.pillLabel, { color: tone.fg }]}>{row.status}</Txt>
        </View>
        <Txt style={[styles.span, numeric, { color: t.colors.textMuted }]}>{span}</Txt>
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={row.employeeName + '. ' + row.status.toLowerCase() + '. ' + span}
      style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  identity: { flex: 1, minWidth: 0 },
  identityLine: { fontSize: 11, marginTop: 3 },
  right: { alignItems: 'flex-end' },
  pill: { alignItems: 'center', height: 22, justifyContent: 'center', paddingHorizontal: 9 },
  // Named family, not a numeric weight — Android does not synthesise weights
  // for a custom font, so fontWeight '800' would render Regular.
  pillLabel: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.7,
  },
  span: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 11.5, marginTop: 5 },
});
