import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {alpha, colors, radius, spacing, typography} from '../theme';

/** How a panel is lit. Each tone belongs to the same stone-and-lantern set. */
export type PanelTone = 'stone' | 'gold' | 'arcane' | 'ember' | 'crystal';

interface ToneSpec {
  /** Outer metal rim. */
  rim: string;
  /** Inner bevel catching the light. */
  bevel: string;
  /** Corner brackets and header rule. */
  bracket: string;
  /** The wash laid over the dark panel body. */
  wash: string;
  /** Ribbon header fill. */
  ribbon: readonly [string, string];
  /** Ribbon label. */
  ribbonInk: string;
}

const TONES: Record<PanelTone, ToneSpec> = {
  stone: {
    rim: colors.stoneDark,
    bevel: colors.stoneLight,
    bracket: colors.stoneLight,
    wash: alpha(colors.moon, 0.03),
    ribbon: [colors.stone, colors.stoneDark],
    ribbonInk: colors.text,
  },
  gold: {
    rim: colors.goldDeep,
    bevel: colors.frameGoldLight,
    bracket: colors.gold,
    wash: alpha(colors.gold, 0.05),
    ribbon: [colors.frameGold, colors.goldDeep],
    ribbonInk: colors.goldInk,
  },
  arcane: {
    rim: colors.violetDeep,
    bevel: colors.violetBright,
    bracket: colors.violet,
    wash: alpha(colors.violet, 0.07),
    ribbon: [colors.ribbon, colors.violetDeep],
    ribbonInk: colors.text,
  },
  ember: {
    rim: colors.goldDeep,
    bevel: colors.amber,
    bracket: colors.orange,
    wash: alpha(colors.fire, 0.06),
    ribbon: [colors.ember, colors.goldDeep],
    ribbonInk: colors.text,
  },
  crystal: {
    rim: colors.blueDeep,
    bevel: colors.cyan,
    bracket: colors.crystal,
    wash: alpha(colors.crystal, 0.06),
    ribbon: [colors.blueDeep, colors.crystalDeep],
    ribbonInk: colors.text,
  },
};

/** One L-shaped gold bracket clasping a corner of the frame. */
function Bracket({
  corner,
  color,
  size,
}: {
  corner: 'tl' | 'tr' | 'bl' | 'br';
  color: string;
  size: number;
}) {
  const top = corner === 'tl' || corner === 'tr';
  const left = corner === 'tl' || corner === 'bl';
  return (
    <View
      pointerEvents="none"
      style={[
        styles.bracket,
        {
          width: size,
          height: size,
          borderColor: color,
          [top ? 'top' : 'bottom']: -1,
          [left ? 'left' : 'right']: -1,
          borderTopWidth: top ? 2 : 0,
          borderBottomWidth: top ? 0 : 2,
          borderLeftWidth: left ? 2 : 0,
          borderRightWidth: left ? 0 : 2,
          borderTopLeftRadius: corner === 'tl' ? radius.md : 0,
          borderTopRightRadius: corner === 'tr' ? radius.md : 0,
          borderBottomLeftRadius: corner === 'bl' ? radius.md : 0,
          borderBottomRightRadius: corner === 'br' ? radius.md : 0,
        },
      ]}
    />
  );
}

interface Props {
  children?: React.ReactNode;
  /** Ribbon header text. Omit for a plain framed panel. */
  title?: string;
  /** Small glyph shown left of the title. */
  icon?: string;
  tone?: PanelTone;
  padded?: boolean;
  /** Hide the corner brackets on small inline panels. */
  brackets?: boolean;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
}

/**
 * A carved stone panel with a metal rim and gold corner brackets.
 *
 * This is the frame every fantasy screen is built from. It stays translucent
 * so the GameBackground reads through it — never paint an opaque box over the
 * forest.
 */
export function FantasyPanel({
  children,
  title,
  icon,
  tone = 'stone',
  padded = true,
  brackets = true,
  style,
  bodyStyle,
}: Props) {
  const spec = TONES[tone];
  return (
    <View style={[styles.frame, {borderColor: spec.rim}, style]}>
      {/* Inner bevel: a hairline of lit metal just inside the rim. */}
      <View
        pointerEvents="none"
        style={[styles.bevel, {borderColor: alpha(spec.bevel, 0.35)}]}
      />
      <View pointerEvents="none" style={[styles.wash, {backgroundColor: spec.wash}]} />

      {title ? (
        <View style={styles.ribbonRow}>
          <View style={[styles.ribbon, {backgroundColor: spec.ribbon[0]}]}>
            <View
              style={[styles.ribbonShade, {backgroundColor: spec.ribbon[1]}]}
            />
            {icon ? <Text style={styles.ribbonIcon}>{icon}</Text> : null}
            <Text style={[styles.ribbonText, {color: spec.ribbonInk}]}>
              {title.toUpperCase()}
            </Text>
          </View>
          <View style={[styles.ribbonRule, {backgroundColor: alpha(spec.bracket, 0.4)}]} />
        </View>
      ) : null}

      <View style={[padded && styles.padded, bodyStyle]}>{children}</View>

      {brackets ? (
        <>
          <Bracket corner="tl" color={spec.bracket} size={14} />
          <Bracket corner="tr" color={spec.bracket} size={14} />
          <Bracket corner="bl" color={spec.bracket} size={14} />
          <Bracket corner="br" color={spec.bracket} size={14} />
        </>
      ) : null}
    </View>
  );
}

/** A filigree rule for separating rows inside a panel. */
export function FantasyDivider({tone = 'gold'}: {tone?: PanelTone}) {
  const spec = TONES[tone];
  return (
    <View style={styles.dividerRow}>
      <View style={[styles.dividerLine, {backgroundColor: alpha(spec.bracket, 0.28)}]} />
      <View style={[styles.dividerGem, {backgroundColor: spec.bracket}]} />
      <View style={[styles.dividerLine, {backgroundColor: alpha(spec.bracket, 0.28)}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: alpha(colors.night, 0.82),
    borderRadius: radius.lg,
    borderWidth: 2,
    overflow: 'visible',
  },
  bevel: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
  },
  padded: {
    padding: spacing.lg,
  },
  ribbonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  ribbon: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  ribbonShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
    opacity: 0.55,
  },
  ribbonIcon: {
    fontSize: 12,
    marginRight: 5,
  },
  ribbonText: {
    ...typography.sectionLabel,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  ribbonRule: {
    flex: 1,
    height: 1,
    marginLeft: spacing.sm,
  },
  bracket: {
    position: 'absolute',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerGem: {
    width: 5,
    height: 5,
    marginHorizontal: 6,
    transform: [{rotate: '45deg'}],
  },
});
