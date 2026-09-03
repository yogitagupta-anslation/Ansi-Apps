/**
 * ProximityIndicator.tsx
 * -----------------------------------------------------------------------------
 * Renders signal strength QUALITATIVELY.
 *
 * RSSI is never converted to a distance anywhere in this app. A raw dBm figure
 * is shown for engineers, next to a Strong/Medium/Weak band for everyone else -
 * but never "3 metres", because RSSI genuinely cannot support that claim.
 * -----------------------------------------------------------------------------
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RSSI_MEDIUM, RSSI_STRONG, type ProximityBand } from '../constants/bluetoothConfig';
import { useTheme } from '../theme/ThemeContext';
import { Txt } from './ui';

export function bandForRssi(rssi: number): ProximityBand {
  if (rssi >= RSSI_STRONG) {
    return 'STRONG';
  }
  if (rssi >= RSSI_MEDIUM) {
    return 'MEDIUM';
  }
  return 'WEAK';
}

/** Four-bar signal meter. Bars filled = band strength. */
export function SignalBars({
  rssi,
  size = 16,
  color,
}: {
  rssi: number | null;
  size?: number;
  color?: string;
}) {
  const t = useTheme();

  const band = rssi === null ? null : bandForRssi(rssi);
  const filled = band === 'STRONG' ? 4 : band === 'MEDIUM' ? 3 : band === 'WEAK' ? 1 : 0;

  const activeColor =
    color ??
    (band === 'STRONG'
      ? t.colors.success
      : band === 'MEDIUM'
      ? t.colors.warning
      : band === 'WEAK'
      ? t.colors.error
      : t.colors.textMuted);

  return (
    <View style={[styles.bars, { height: size }]}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={{
            width: 3,
            height: size * (0.35 + i * 0.22),
            marginLeft: i === 0 ? 0 : 2,
            borderRadius: 1.5,
            backgroundColor: i < filled ? activeColor : t.colors.surfaceMuted,
          }}
        />
      ))}
    </View>
  );
}

export function ProximityIndicator({
  rssi,
  showValue = true,
}: {
  rssi: number | null;
  showValue?: boolean;
}) {
  const t = useTheme();

  if (rssi === null) {
    return (
      <View style={styles.row}>
        <SignalBars rssi={null} />
        <Txt variant="caption" color={t.colors.textMuted} style={{ marginLeft: 8 } as object}>
          Not detected
        </Txt>
      </View>
    );
  }

  const band = bandForRssi(rssi);
  const color =
    band === 'STRONG' ? t.colors.success : band === 'MEDIUM' ? t.colors.warning : t.colors.error;

  return (
    <View style={styles.row}>
      <SignalBars rssi={rssi} />
      <Txt variant="caption" color={color} style={{ marginLeft: 8 } as object}>
        {band}
      </Txt>
      {showValue ? (
        <Txt
          variant="caption"
          mono
          color={t.colors.textMuted}
          style={{ marginLeft: 6 } as object}>
          {rssi} dBm
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  bars: { alignItems: 'flex-end', flexDirection: 'row' },
});
