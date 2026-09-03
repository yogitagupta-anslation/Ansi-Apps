import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {alpha, colors, elevate, radius, spacing} from '../theme';

interface Props {
  children: React.ReactNode;
  padded?: boolean;
  /** Optional accent used for the rim and brackets, e.g. gold on the code card. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
}

const BRACKET = 12;

/**
 * The carved card every grouped block sits on.
 *
 * Kept translucent so the GameBackground reads through it — the panels are
 * meant to feel cut into the scene, not pasted over it. For a titled, ribboned
 * frame use FantasyPanel instead; this is its plain sibling.
 */
export function Panel({children, padded = true, accent, style}: Props) {
  const rim = accent ?? colors.stoneDark;
  const bracket = accent ?? colors.stoneLight;
  return (
    <View style={[styles.panel, {borderColor: rim}, elevate(3), style]}>
      <View
        pointerEvents="none"
        style={[styles.bevel, {borderColor: alpha(bracket, 0.3)}]}
      />
      <View style={padded && styles.padded}>{children}</View>

      {(
        [
          ['tl', {top: -1, left: -1}],
          ['tr', {top: -1, right: -1}],
          ['bl', {bottom: -1, left: -1}],
          ['br', {bottom: -1, right: -1}],
        ] as const
      ).map(([corner, pos]) => {
        const top = corner[0] === 't';
        const left = corner[1] === 'l';
        return (
          <View
            key={corner}
            pointerEvents="none"
            style={[
              styles.bracket,
              pos,
              {
                borderColor: alpha(bracket, 0.85),
                borderTopWidth: top ? 2 : 0,
                borderBottomWidth: top ? 0 : 2,
                borderLeftWidth: left ? 2 : 0,
                borderRightWidth: left ? 0 : 2,
                borderTopLeftRadius: top && left ? radius.md : 0,
                borderTopRightRadius: top && !left ? radius.md : 0,
                borderBottomLeftRadius: !top && left ? radius.md : 0,
                borderBottomRightRadius: !top && !left ? radius.md : 0,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: alpha(colors.night, 0.8),
    borderRadius: radius.lg,
    borderWidth: 2,
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
  padded: {
    padding: spacing.lg,
  },
  bracket: {
    position: 'absolute',
    width: BRACKET,
    height: BRACKET,
  },
});
