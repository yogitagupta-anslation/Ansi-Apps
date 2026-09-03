import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Palette, radius, spacing } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

/** The "BLE synced" pill shown in the header of the multiplayer screens. */
export default function BleStatusBadge({ label, live = false }: { label: string; live?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.pill, live && styles.pillLive]}>
      <Ionicons name="bluetooth" size={12} color={live ? colors.correct : colors.accent} />
      <Text style={[styles.text, live && styles.textLive]}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
  },
  pillLive: {
    backgroundColor: colors.correctTint,
    borderColor: colors.correctBorder,
  },
  text: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  textLive: {
    color: colors.correct,
  },
});
