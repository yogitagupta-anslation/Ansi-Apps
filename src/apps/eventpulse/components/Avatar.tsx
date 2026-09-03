/**
 * Avatar — one component, four kinds, three sizes.
 *
 * Most people at an event never upload a photo, so the fallbacks are the common
 * case and have to look deliberate rather than like a missing image. Initials
 * and generated avatars derive their colour from a hash of the name, which
 * gives everyone a stable, recognisable identity across the map, the list and
 * the profile sheet without anyone doing any work.
 *
 * At map size the avatar is 36 px on a busy canvas, so: no photo detail worth
 * rendering, high contrast, and a status ring that reads at a glance.
 */

import React, { memo } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fnv1a32 } from '../utils/bytes';
import { avatarGlyphMetrics, initialsFor } from '../profile/avatarGlyph';

import type { Avatar as AvatarModel } from '../types';
import { useTheme } from '../theme/ThemeProvider';
import { availabilityColor, typography } from '../theme/tokens';

export { avatarGlyphMetrics, initialsFor };

export type AvatarSize = 'map' | 'list' | 'large' | 'hero';

const SIZES: Record<AvatarSize, number> = {
  map: 40,
  list: 46,
  large: 64,
  hero: 96,
};

export interface AvatarProps {
  avatar?: AvatarModel | null;
  name: string;
  size?: AvatarSize;
  /** Availability drives the ring colour. Omit for no ring. */
  availability?: string;
  /** Thicker ring + accent colour, for the selected or navigated person. */
  highlighted?: boolean;
  /** Rendered dimmer, for people who have gone quiet. */
  dimmed?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Six deterministic patterns for generated avatars.
 *
 * One shared blob made every generated avatar look like every other one, which
 * defeats the point: at 40 px on a crowded map, the *silhouette* is what makes
 * someone recognisable before you can read their name. Each shape is placed to
 * sweep the edge of the circle and leave the middle clear, so the initials keep
 * their contrast whichever pattern comes up.
 *
 * Plain Views rather than SVG: a hall can hold a hundred of these on screen and
 * two absolutely-positioned Views are dramatically cheaper than a vector tree.
 */
function patternShapes(seed: string, d: number): ViewStyle[] {
  const variant = fnv1a32(seed) % 6;
  const round = (size: number): number => size / 2;

  switch (variant) {
    case 0: // lower-left sweep
      return [{ width: d * 0.78, height: d * 0.78, borderRadius: round(d * 0.78), top: d * 0.54, left: -d * 0.24 }];
    case 1: // top band
      return [{ width: d * 1.4, height: d * 0.34, top: -d * 0.06, left: -d * 0.2 }];
    case 2: // diagonal wedge from the corner
      return [{ width: d * 0.9, height: d * 0.9, borderRadius: round(d * 0.28), top: d * 0.6, left: d * 0.55, transform: [{ rotate: '38deg' }] }];
    case 3: // two corner dots
      return [
        { width: d * 0.3, height: d * 0.3, borderRadius: round(d * 0.3), top: d * 0.06, left: d * 0.06 },
        { width: d * 0.44, height: d * 0.44, borderRadius: round(d * 0.44), top: d * 0.66, left: d * 0.66 },
      ];
    case 4: // right column
      return [{ width: d * 0.36, height: d * 1.2, top: -d * 0.1, left: d * 0.74 }];
    default: // concentric arc, hollow so the initials sit inside it
      return [
        { width: d * 1.06, height: d * 1.06, borderRadius: round(d * 1.06), top: d * 0.52, left: d * 0.5 },
      ];
  }
}

function AvatarComponent({
  avatar,
  name,
  size = 'list',
  availability,
  highlighted,
  dimmed,
  style,
}: AvatarProps): React.ReactElement {
  const { colors, isDark } = useTheme();
  const dimension = SIZES[size];
  const hue = avatar?.hue ?? 210;

  const ringColor = highlighted
    ? colors.accent
    : availability
      ? availabilityColor(colors, availability)
      : 'transparent';
  const ringWidth = highlighted ? 3 : availability ? 2 : 0;

  // Generated and initials avatars share a hue but differ in treatment, so two
  // people with similar names still look distinct at 40 px.
  const fill = `hsl(${hue}, ${isDark ? 42 : 62}%, ${isDark ? 34 : 82}%)`;
  const glyphColor = isDark ? `hsl(${hue}, 85%, 86%)` : `hsl(${hue}, 70%, 20%)`;
  // The generated avatar's blob crosses the initials. On a dark fill it can be
  // bold; on a light one it has to stay pale, or the dark glyph loses contrast
  // exactly where the two overlap.
  const blobColor = `hsl(${(hue + 40) % 360}, ${isDark ? 55 : 58}%, ${isDark ? 46 : 79}%)`;
  const blobOpacity = isDark ? 0.85 : 0.6;

  const glyph = avatarGlyphMetrics(dimension);
  const glyphStyle = {
    ...typography.bodyStrong,
    ...glyph,
    color: glyphColor,
    textAlign: 'center' as const,
    // Android pads text vertically using the font's own metrics, which shifts
    // initials off the centre of a circle by a couple of pixels. Nothing else
    // in the app is centred this precisely, so it only shows up here.
    includeFontPadding: false,
  };

  const inner = (): React.ReactNode => {
    if (avatar?.kind === 'photo' && avatar.uri) {
      return (
        <Image
          source={{ uri: avatar.uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      );
    }
    if (avatar?.kind === 'emoji' && avatar.emoji) {
      return (
        <Text
          style={{
            fontSize: dimension * 0.5,
            lineHeight: dimension * 0.6,
            textAlign: 'center',
            includeFontPadding: false,
          }}
        >
          {avatar.emoji}
        </Text>
      );
    }
    if (avatar?.kind === 'generated') {
      return (
        <View style={styles.generated}>
          {patternShapes(avatar.avatarId ?? name, dimension).map((shape, index) => (
            <View
              key={index}
              style={[styles.patternShape, shape, { backgroundColor: blobColor, opacity: blobOpacity }]}
            />
          ))}
          <Text style={glyphStyle}>{initialsFor(name)}</Text>
        </View>
      );
    }
    return <Text style={glyphStyle}>{initialsFor(name)}</Text>;
  };

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        {
          width: dimension + ringWidth * 2,
          height: dimension + ringWidth * 2,
          borderRadius: (dimension + ringWidth * 2) / 2,
          borderWidth: ringWidth,
          borderColor: ringColor,
          opacity: dimmed ? 0.45 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View
        style={[
          styles.body,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 2,
            backgroundColor: fill,
          },
        ]}
      >
        {inner()}
      </View>
    </View>
  );
}

export const Avatar = memo(AvatarComponent);

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  generated: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternShape: {
    position: 'absolute',
  },
});
