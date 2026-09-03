/**
 * Presence and signal indicators.
 *
 * Two separate ideas that are easy to conflate:
 *
 *  - **Availability** is a choice the person made: available, maybe, busy.
 *  - **Signal** is what our radio can see: how near, how confident, and whether
 *    they are still there.
 *
 * They get different visual languages — a coloured dot for the choice, bars for
 * the measurement — because a strong signal from a busy person means something
 * quite different from a weak signal from an available one.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProximityBand } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { availabilityColor, radius, space } from '../theme/tokens';
import { AppText } from './primitives';

export function PresenceDot({
  availability,
  size = 8,
}: {
  availability: string;
  size?: number;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={`Status: ${availability}`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: availabilityColor(colors, availability),
      }}
    />
  );
}

export function PresencePill({ availability }: { availability: string }): React.ReactElement {
  const { colors } = useTheme();
  const label =
    availability === 'available'
      ? 'Available'
      : availability === 'maybe'
        ? 'Maybe'
        : availability === 'busy'
          ? 'Busy'
          : 'Hidden';

  return (
    <View style={[styles.pill, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
      <PresenceDot availability={availability} />
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </View>
  );
}

const BAND_BARS: Record<ProximityBand, number> = {
  very_close: 4,
  close: 3,
  nearby: 2,
  far: 1,
};

/**
 * Signal strength as bars.
 *
 * The bars encode the *band*, not the raw RSSI, because the band is the only
 * thing we can honestly claim. `confidence` fades the whole control: a
 * half-transparent meter is the visual way of saying "we are not sure yet".
 */
export function SignalBars({
  band,
  confidence = 1,
  size = 12,
}: {
  band: ProximityBand;
  confidence?: number;
  size?: number;
}): React.ReactElement {
  const { colors } = useTheme();
  const filled = BAND_BARS[band];

  return (
    <View
      accessibilityLabel={`Signal: ${filled} of 4 bars`}
      style={[styles.bars, { height: size, opacity: 0.4 + 0.6 * confidence }]}
    >
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          style={{
            width: 2.5,
            borderRadius: 1.5,
            height: size * (0.34 + index * 0.22),
            backgroundColor: index < filled ? colors.accent : colors.borderStrong,
          }}
        />
      ))}
    </View>
  );
}

export function TrendArrow({ trend }: { trend: string }): React.ReactElement | null {
  const { colors } = useTheme();
  if (trend === 'steady') return null;
  return (
    <AppText variant="micro" style={{ color: trend === 'approaching' ? colors.accent : colors.textTertiary }}>
      {trend === 'approaching' ? '▲' : '▼'}
    </AppText>
  );
}

/** Compact "Close · 3-7 m" line used on cards and in the profile sheet. */
export function ProximityLabel({
  label,
  rangeLabel,
  provisional,
}: {
  label: string;
  rangeLabel: string;
  provisional?: boolean;
}): React.ReactElement {
  return (
    <AppText variant="caption" tone="secondary">
      {provisional ? 'Locating…' : `${label} · about ${rangeLabel}`}
    </AppText>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm - 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
});
