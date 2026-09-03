import React, {useState} from 'react';
import {StyleSheet, View, type ViewStyle} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop, Text as SvgText, TSpan} from 'react-native-svg';
import type {Theme} from '../../config/theme';

/**
 * The two places the reference design uses a gradient: the wordmark and the primary
 * button. Both go through `react-native-svg` — the one native dependency this pass adds —
 * rather than `expo-linear-gradient` or a masked view, because a `<Svg>` already covers
 * both cases (a gradient `<Rect>` behind a button, gradient-filled `<Text>` for the
 * wordmark) with nothing else to install.
 */

/**
 * The "BLE" + "Chat" wordmark, one colour then a gradient.
 *
 * Both halves are drawn by the SAME `<SvgText>` run, as two `<TSpan>`s, rather than a
 * plain RN `<Text>` for "BLE" next to an SVG one for "Chat". Splitting it across two
 * renderers was the first version of this, and it showed: Android's SVG text layout and
 * RN's own `Text` do not share a font-metrics path, so the join had a visible seam — a
 * gap that did not match the run's own kerning, and a "C" that was subtly a different
 * weight to the "E" beside it. One text run has one set of metrics throughout, so there
 * is nothing for a seam to appear at.
 */
export function Wordmark({
  flat,
  flatColor,
  gradientText,
  gradient,
  fontSize,
  width,
  height,
}: {
  flat: string;
  flatColor: string;
  gradientText: string;
  gradient: readonly [string, string, string];
  fontSize: number;
  width: number;
  height: number;
}) {
  const id = 'wordmark';
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={gradient[0]} />
          <Stop offset="0.55" stopColor={gradient[1]} />
          <Stop offset="1" stopColor={gradient[2]} />
        </LinearGradient>
      </Defs>
      <SvgText
        x={0}
        y={height * 0.76}
        fontSize={fontSize}
        fontWeight="800"
        fontFamily="sans-serif">
        <TSpan fill={flatColor}>{flat}</TSpan>
        <TSpan fill={`url(#${id})`}>{gradientText}</TSpan>
      </SvgText>
    </Svg>
  );
}

/**
 * A gradient-filled rounded rect, with ordinary RN children laid over it.
 *
 * Children are absolutely positioned on top rather than drawn inside the `<Svg>`, so the
 * button content is real `Text`/`View` — it measures, wraps and accepts the app's normal
 * type components instead of being redrawn as vector glyphs.
 */
export function GradientSurface({
  gradient,
  radius,
  style,
  children,
}: {
  gradient: readonly [string, string, string];
  radius: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  const id = 'surface';
  // Measured, not "100%": an SVG rounded rect clamps rx and ry independently, each to
  // half of its OWN dimension. Asking for a pill (radius far bigger than the box) on a
  // button that is much wider than it is tall then clamps rx to half the width but ry to
  // half the height — two different corner radii, which is a full inscribed ellipse, not
  // a stadium. Capping both to half the real height keeps the ends semicircular and the
  // top/bottom edges flat, which is what "pill" actually means for a wide box.
  const [size, setSize] = useState({width: 0, height: 0});
  const cornerRadius = size.height > 0 ? Math.min(radius, size.height / 2) : 0;
  return (
    <View
      style={[styles.wrap, style]}
      onLayout={e => {
        const {width, height} = e.nativeEvent.layout;
        setSize({width, height});
      }}>
      {size.width > 0 && size.height > 0 && (
        <Svg style={StyleSheet.absoluteFill} width={size.width} height={size.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradient[0]} />
              <Stop offset="0.5" stopColor={gradient[1]} />
              <Stop offset="1" stopColor={gradient[2]} />
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={size.width}
            height={size.height}
            rx={cornerRadius}
            ry={cornerRadius}
            fill={`url(#${id})`}
          />
        </Svg>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {overflow: 'hidden'},
});

/** Convenience: the app's one brand gradient, wherever a theme is in scope. */
export function brandGradient(theme: Theme): readonly [string, string, string] {
  return theme.gradient;
}
