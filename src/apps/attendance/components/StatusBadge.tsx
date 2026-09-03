/**
 * StatusBadge.tsx
 * -----------------------------------------------------------------------------
 * The one component that renders attendance status, everywhere.
 *
 * ACCESSIBILITY: status is never communicated by colour alone. Every badge
 * carries a dot, a word, and an accessibility label — so it still reads
 * correctly in greyscale, for colour-blind users, and to a screen reader.
 *
 * LEFT is amber, not red. Someone who checked in and later went out of range
 * attended; colouring that as an error would misrepresent the record.
 *
 * ABSENT is red. This is a deliberate product decision, taken from the agreed
 * design: in an HR attendance context red-for-absent is the established
 * convention and reads as "needs attention" rather than "error". Because red
 * now carries a non-destructive meaning here, destructive controls are
 * distinguished by placement and an explicit confirm step, never by colour
 * alone — see SettingRow's `destructive` prop.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { AttendanceStatus } from '../attendance/attendanceTypes';
import { useTheme } from '../theme/ThemeContext';
import type { Theme } from '../theme/theme';
import { Icon, type IconName } from './Icon';
import { Txt } from './ui';

export type BadgeTone = 'success' | 'warning' | 'neutral' | 'info' | 'danger' | 'accent';

export interface StatusVisual {
  label: string;
  tone: BadgeTone;
  fg: string;
  bg: string;
}

/** Single source of truth for how each attendance status looks and reads. */
export function attendanceVisual(status: AttendanceStatus, t: Theme): StatusVisual {
  switch (status) {
    case 'PRESENT':
      return { label: 'Present', tone: 'success', fg: t.colors.success, bg: t.colors.successSoft };
    case 'LEFT':
      return { label: 'Left', tone: 'warning', fg: t.colors.warning, bg: t.colors.warningSoft };
    default:
      return { label: 'Absent', tone: 'danger', fg: t.colors.error, bg: t.colors.errorSoft };
  }
}

export function toneColors(tone: BadgeTone, t: Theme): { fg: string; bg: string } {
  switch (tone) {
    case 'success':
      return { fg: t.colors.success, bg: t.colors.successSoft };
    case 'warning':
      return { fg: t.colors.warning, bg: t.colors.warningSoft };
    case 'danger':
      return { fg: t.colors.error, bg: t.colors.errorSoft };
    case 'info':
      return { fg: t.colors.info, bg: t.colors.infoSoft };
    case 'accent':
      return { fg: t.colors.accent, bg: t.colors.accentSoft };
    default:
      return { fg: t.colors.textMuted, bg: t.colors.surfaceMuted };
  }
}

export function StatusBadge({
  label,
  tone = 'neutral',
  size = 'md',
  icon,
  style,
}: {
  label: string;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Replaces the dot. The label still carries the meaning. */
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const c = toneColors(tone, t);
  const dot = size === 'sm' ? 6 : 7;

  return (
    <View
      accessible
      accessibilityLabel={'Status: ' + label}
      style={[
        styles.badge,
        {
          backgroundColor: c.bg,
          borderRadius: t.radius.pill,
          paddingHorizontal: size === 'sm' ? t.spacing.sm : t.spacing.md,
          paddingVertical: size === 'sm' ? 3 : 5,
        },
        style,
      ]}>
      {/* Dot or icon - either way the badge stays legible without colour. */}
      {icon ? (
        <Icon name={icon} size={12} color={c.fg} style={{ marginRight: 5 } as object} />
      ) : (
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: c.fg,
            marginRight: 6,
          }}
        />
      )}
      <Txt variant="label" color={c.fg}>
        {label}
      </Txt>
    </View>
  );
}

/** Convenience wrapper for attendance specifically. */
export function AttendanceBadge({
  status,
  size = 'md',
}: {
  status: AttendanceStatus;
  size?: 'sm' | 'md';
}) {
  const t = useTheme();
  const v = attendanceVisual(status, t);
  return <StatusBadge label={v.label} tone={v.tone} size={size} />;
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row' },
});
