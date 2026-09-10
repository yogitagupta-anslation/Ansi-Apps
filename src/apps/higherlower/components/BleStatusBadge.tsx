import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Palette, radius, spacing, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

/**
 * The link-state pill in the multiplayer headers.
 *
 * A live room gets a filled dot as well as a colour, because "connected" and
 * "looking" differing only by hue is a distinction a colour-blind player cannot
 * make — and it is the single most important thing on these screens.
 */
export default function BleStatusBadge({ label, live = false }: { label: string; live?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.pill, live && styles.pillLive]} accessibilityLabel={label}>
      {live ? (
        <View style={styles.dot} />
      ) : (
        <Ionicons name="bluetooth" size={12} color={colors.accent} />
      )}
      <Text style={[styles.text, live && styles.textLive]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.xs + 2,
    maxWidth: 168,
    borderRadius: radius.pill,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.panelBorderStrong,
  },
  pillLive: {
    backgroundColor: colors.correctTint,
    borderColor: colors.correctBorder,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.correct,
  },
  text: {
    ...type.micro,
    color: colors.accent,
  },
  textLive: {
    color: colors.correct,
  },
});
