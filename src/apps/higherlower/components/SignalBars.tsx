import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Palette, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';
import { signalFor } from '../ble/signal';

/** Four-bar signal meter driven by RSSI (dBm), strongest at -45 and up. */
export default function SignalBars({ rssi, size = 'md' }: { rssi: number; size?: 'sm' | 'md' }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const filled = signalFor(rssi).bars;
  const unit = size === 'sm' ? 3 : 4;
  const label = signalFor(rssi).label;

  return (
    <View style={styles.row} accessibilityLabel={label}>
      {[1, 2, 3, 4].map((bar) => (
        <View
          key={bar}
          style={[
            styles.bar,
            {
              width: unit,
              height: unit * (bar + 1.5),
              backgroundColor: bar <= filled ? colors.accent : colors.divider,
            },
          ]}
        />
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
  bar: {
    borderRadius: 1,
  },
});
