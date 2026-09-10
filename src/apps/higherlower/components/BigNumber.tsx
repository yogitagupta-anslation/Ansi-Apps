import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Palette, spacing, tabular, trackingFor, type } from '../theme/tokens';
import { useTheme, useThemedStyles } from '../theme/ThemeProvider';

interface BigNumberProps {
  /** Digits to show. Empty string renders the placeholder instead. */
  value: string;
  /** Shown before anything is typed; rendered small and dim so it reads as an
   * empty field rather than as content. */
  placeholder?: string;
  caption?: string;
  /** Ink for the digits. Defaults to the palette's primary text color. */
  tone?: string;
  /** Dims the digits -- used while the entry is not yet committed. */
  muted?: boolean;
  /**
   * Ceiling for the type size, from the height the board can actually spare.
   *
   * Without one the readout is sized purely by digit count, overflows whatever
   * box it was given on a short screen, and -- since a React Native View does
   * not clip -- draws straight over the row beneath it.
   */
  maxSize?: number;
}

/** Font size shrinks as digits pile up so 1000 fits the same box as 7. */
function sizeFor(length: number): number {
  if (length <= 2) return 108;
  if (length === 3) return 92;
  if (length === 4) return 76;
  return 60;
}

/**
 * The headline readout -- the typed guess on the game screen, the revealed
 * target on the result screen.
 */
export default function BigNumber({
  value,
  placeholder = '––',
  caption,
  tone,
  muted = false,
  maxSize,
}: BigNumberProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ink = tone ?? colors.textPrimary;
  const empty = value.length === 0;
  const showing = empty ? placeholder : value;
  // At full weight and size a dash is a solid bar, which reads as content;
  // shrink and fade the placeholder so the field reads as waiting for input.
  const baseSize = Math.min(sizeFor(showing.length), maxSize ?? Number.POSITIVE_INFINITY);
  const fontSize = baseSize * (empty ? 0.55 : 1);

  return (
    <View style={styles.wrap}>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      <Text
        accessibilityRole="text"
        accessibilityLabel={empty ? 'No guess entered' : `Guess ${value}`}
        style={[
          styles.number,
          {
            fontSize,
            letterSpacing: trackingFor(fontSize),
            // Line box keeps the full height so typing the first digit does
            // not shove the banner below it down the screen.
            lineHeight: baseSize * 1.06,
            color: empty ? colors.textMuted : ink,
            opacity: muted ? 0.55 : empty ? 0.4 : 1,
            // The glow is a dark-mode device; the light palette zeroes it out.
            textShadowColor: empty ? 'transparent' : ink,
            textShadowRadius: colors.numberGlow,
          },
        ]}
      >
        {showing}
      </Text>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  caption: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  number: {
    ...type.numDisplay,
    ...tabular,
    // Size and line height are computed per render, so the scale's own values
    // are overridden below -- what is inherited here is the family.
    textShadowOffset: { width: 0, height: 0 },
  },
});
