/**
 * The small shared pieces every store surface is assembled from.
 *
 * Each one exists because the same thing is drawn in three or more places and the
 * design gives it one set of numbers. Anything used once lives with its screen
 * instead of here.
 */

import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { BADGE_LABEL, type AppBadge } from '../registry';
import { iconTile, layout, radius, space, type, type HubPalette } from '../theme';

/* ------------------------------------------------------------- icon tile -- */

interface IconTileProps {
  glyph: string;
  /** The app's own accentSoft. The tile is the only place that colour appears. */
  tint: string;
  size: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The rounded square an app's emoji sits in. Radius and glyph size are both
 * functions of the tile size across the whole design, so they are computed rather
 * than passed — that is what keeps a 46px rail tile and an 88px hero tile looking
 * like the same object at two scales.
 */
export function IconTile({ glyph, tint, size, style }: IconTileProps): React.ReactElement {
  const t = iconTile(size);
  return (
    <View
      style={[
        {
          width: t.size,
          height: t.size,
          borderRadius: t.radius,
          backgroundColor: tint,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {/* lineHeight tracks fontSize so the glyph optically centres; RN lays emoji
          out with more leading than the web does. */}
      <Text style={{ fontSize: t.glyph, lineHeight: t.glyph * 1.15 }}>{glyph}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ mono -- */

interface MonoProps {
  children: React.ReactNode;
  theme: HubPalette;
  color?: string;
  size?: number;
  weight?: '500' | '600';
  /** The dotted rule under a figure. Off by default; the design uses it on stats. */
  underline?: boolean;
}

/**
 * A numeric value. The design sets these in a monospace face so columns of
 * figures line up; on Android that is the platform Roboto Mono, which is exactly
 * what the design asked for without bundling a font.
 *
 * The dotted underline is a View, not a border on the Text — React Native cannot
 * put a border on a text node.
 */
export function Mono({
  children,
  theme,
  color,
  size = 12,
  weight = '600',
  underline = false,
}: MonoProps): React.ReactElement {
  const label = (
    <Text
      style={{
        fontFamily: monoFace,
        fontSize: size,
        fontWeight: weight,
        color: color ?? theme.textDim,
      }}
    >
      {children}
    </Text>
  );
  if (!underline) return label;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        borderBottomWidth: 1,
        borderStyle: 'dotted',
        borderBottomColor: theme.borderStrong,
      }}
    >
      {label}
    </View>
  );
}

// Android's monospace IS Roboto Mono; iOS resolves to Menlo. Naming the family
// rather than bundling one keeps the numeric face without a font dependency.
const monoFace = 'monospace';

/* --------------------------------------------------------------- section -- */

interface SectionProps {
  children: React.ReactNode;
  /**
   * Rails set this false and apply the gutter to their own heading and content
   * separately, so the rail can bleed past the screen edge.
   */
  gutter?: boolean;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function Section({
  children,
  gutter = true,
  gap,
  style,
}: SectionProps): React.ReactElement {
  return (
    <View style={[gutter ? { paddingHorizontal: layout.gutter } : null, gap ? { gap } : null, style]}>
      {children}
    </View>
  );
}

interface SectionHeaderProps {
  title: string;
  theme: HubPalette;
  /** Right-hand text: a count, a pager, or an action label. */
  trailing?: string;
  onPressTrailing?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({
  title,
  theme,
  trailing,
  style,
}: SectionHeaderProps): React.ReactElement {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={[type.sectionTitle, { color: theme.text }]}>{title}</Text>
      {trailing ? (
        <Text style={[type.metaSoft, { color: theme.textDim }]}>{trailing}</Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- badges -- */

interface CapabilityBadgeProps {
  badge: AppBadge;
  theme: HubPalette;
}

/**
 * A capability badge. These are facts about the app — it uses the radio, it works
 * with no connection — not marketing, so they are rendered quietly on the recessed
 * surface rather than in the app's accent.
 */
export function CapabilityBadge({ badge, theme }: CapabilityBadgeProps): React.ReactElement {
  return (
    <View style={[styles.badge, { backgroundColor: theme.surfaceRaised }]}>
      <Text style={[type.badge, { color: theme.textDim }]}>{BADGE_LABEL[badge]}</Text>
    </View>
  );
}

/** A thin vertical rule between inline items. */
export function Divider({ theme }: { theme: HubPalette }): React.ReactElement {
  return <View style={[styles.divider, { backgroundColor: theme.borderStrong }]} />;
}

/** The 3-dot separator the design uses between meta values. */
export function MetaDot({ theme }: { theme: HubPalette }): React.ReactElement {
  return <View style={[styles.metaDot, { backgroundColor: theme.borderStrong }]} />;
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  badge: {
    height: 22,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { width: 1, height: 16 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
});
