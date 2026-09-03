import React from 'react';
import {Image, StyleSheet, type ImageStyle, type StyleProp} from 'react-native';

/**
 * The treasure artwork, shared by every surface that shows a chest.
 *
 * There are two: an isolated chest for icons and hero shots, and a `grounded`
 * one from the UI kit that sits on spilled gold, rocks and leaves. The grounded
 * art belongs in the world, where it stands beside the other painted props;
 * the isolated one belongs anywhere a clean silhouette is wanted.
 *
 * Metro picks the @2x / @3x variant to match the screen density, so callers
 * only ever give a size in points.
 */
const CHEST = require('../assets/treasure-chest.png');
const CHEST_GROUNDED = require('../assets/treasure-chest-grounded.png');

/** The grounded art is wider than it is tall; the isolated one is square. */
const GROUNDED_RATIO = 218 / 305;

interface Props {
  /** Rendered width in points. */
  size?: number;
  /** Fades the chest, used for treasure that has already been claimed. */
  dimmed?: boolean;
  /** Use the kit's chest, spilling gold onto the ground around it. */
  grounded?: boolean;
  style?: StyleProp<ImageStyle>;
}

export function TreasureChest({
  size = 28,
  dimmed = false,
  grounded = false,
  style,
}: Props) {
  return (
    <Image
      source={grounded ? CHEST_GROUNDED : CHEST}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      style={[
        {width: size, height: grounded ? size * GROUNDED_RATIO : size},
        dimmed && styles.dimmed,
        style,
      ]}
    />
  );
}

export const TREASURE_CHEST_SOURCE = CHEST;

const styles = StyleSheet.create({
  dimmed: {
    opacity: 0.3,
  },
});
