/**
 * StatTile.tsx
 * -----------------------------------------------------------------------------
 * The three-across count tiles: a large number over a small label, tinted by
 * attendance state.
 *
 * The number is the content, so it gets the size and the colour; the label is
 * support and stays muted. Counts are zero-padded to two digits so the three
 * tiles keep identical optical weight and do not jitter as counts cross 9/10.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { AttendanceStatus } from '../attendance/attendanceTypes';
import { numeric } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export type StatTone = 'success' | 'warning' | 'danger' | 'neutral';

export function statToneFor(status: AttendanceStatus): StatTone {
  return status === 'PRESENT' ? 'success' : status === 'LEFT' ? 'warning' : 'danger';
}

export function StatTile({
  count,
  label,
  tone,
  selected = false,
  onPress,
  style,
}: {
  count: number;
  label: string;
  tone: StatTone;
  /** Draws the ring brighter, for when the tile doubles as a filter control. */
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();

  const map: Record<StatTone, { fg: string; bg: string; border: string }> = {
    success: { fg: t.colors.success, bg: t.colors.successSoft, border: t.colors.successBorder },
    warning: { fg: t.colors.warning, bg: t.colors.warningSoft, border: t.colors.warningBorder },
    danger: { fg: t.colors.error, bg: t.colors.errorSoft, border: t.colors.error },
    neutral: { fg: t.colors.textSecondary, bg: t.colors.surfaceRaised, border: t.colors.border },
  };
  const c = map[tone];

  const body = (
    <View
      style={[
        styles.tile,
        {
          // v3: the card surface, with the tone carried by the number alone.
          // A tinted plate under a tinted number reads as two signals for one
          // fact, and the three tiles stop looking like one control.
          backgroundColor: t.colors.surface,
          // Neutral hairline unless the tile is the active filter: the tone
          // already lives in the number, and a tinted border on all three made
          // them read as three selected chips.
          borderColor: selected ? c.fg : t.colors.border,
          borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        },
        t.shadow(1),
        style,
      ]}>
      <Txt style={[styles.count, numeric, { color: c.fg }]}>
        {/* Two digits keeps the three tiles optically balanced. */}
        {count < 10 ? '0' + count : String(count)}
      </Txt>
      <Txt style={[styles.label, { color: t.colors.textMuted }]}>{label.toUpperCase()}</Txt>
    </View>
  );

  if (!onPress) {
    return body;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={count + ' ' + label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [{ flex: 1 }, pressed ? { opacity: 0.75 } : null]}>
      {body}
    </Pressable>
  );
}

/** The three tiles side by side, evenly spaced. */
export function StatTileRow({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.row, { gap: 9, marginBottom: t.spacing.lg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 16,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  count: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 26,
    letterSpacing: -1,
    lineHeight: 33,
  },
  label: {
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    fontSize: 10,
    letterSpacing: 0.8,
    marginTop: 3,
  },
  row: { flexDirection: 'row' },
});
