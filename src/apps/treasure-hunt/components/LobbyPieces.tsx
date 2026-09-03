import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, Text, View} from 'react-native';
import {alpha, colors, radius, spacing, typography} from '../theme';

interface CodeProps {
  code: string;
  caption: string;
}

/** The gold-bordered card that shows the four-digit lobby code. */
export function GameCodeCard({code, caption}: CodeProps) {
  return (
    <View style={styles.codeCard}>
      <Text style={typography.sectionLabel}>Game Code</Text>
      <Text style={typography.gameCode}>{code}</Text>
      <Text style={styles.codeCaption}>{caption}</Text>
    </View>
  );
}

interface StatusProps {
  label: string;
  color?: string;
  pulsing?: boolean;
}

/** The small "BLE ADVERTISING..." style line under the code card. */
export function StatusLine({label, color = colors.cyan, pulsing = true}: StatusProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulsing) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1, duration: 700, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0.25, duration: 700, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulsing]);

  return (
    <View style={styles.statusRow}>
      <Animated.View
        style={[styles.statusDot, {backgroundColor: color, opacity: pulse}]}
      />
      <Text style={[styles.statusText, {color}]}>{label}</Text>
    </View>
  );
}

/** Three-bar signal strength meter. */
export const styles = StyleSheet.create({
  codeCard: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: alpha(colors.gold, 0.55),
    backgroundColor: alpha(colors.gold, 0.08),
    gap: 2,
  },
  codeCaption: {
    ...typography.bodyMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 16,
  },
  bar: {
    width: 4,
    borderRadius: 1,
  },
});
